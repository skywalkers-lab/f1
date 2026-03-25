import fs from 'node:fs'
import path from 'node:path'
import { buildActionSpace } from './strategy/actionSpace.js'
import { ContextualBanditModel } from './strategy/banditModel.js'
import { FeatureBuilder } from './strategy/featureBuilder.js'
import { TyreDegradationModel } from './strategy/tyreDegradationModel.js'
import { TrafficAnalyzer } from './strategy/trafficAnalyzer.js'
import { PitStrategySimulator } from './strategy/pitStrategySimulator.js'
import { RewardEvaluator } from './strategy/rewardEvaluator.js'
import { clamp, num } from './strategy/utils.js'

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function contextDigest(context) {
  return [
    context.streamKey || context.sessionUid || 'default',
    num(context.lap, 1),
    num(context.playerPosition, 22),
    num(context.fuel, 0).toFixed(2),
    num(context.ers, 0).toFixed(0),
    num(context.tyreWear, 0).toFixed(3),
    num(context.gapAhead, 0).toFixed(3),
    num(context.gapBehind, 0).toFixed(3),
    num(context.trafficDensity, 0).toFixed(3),
  ].join('|')
}

export class StrategyTrainer {
  constructor({
    modelPath,
    feedbackLogPath,
    policy = 'softmax',
    epsilon = 0.08,
    temperature = 0.65,
    decisionHorizonLaps = 8,
  }) {
    this.modelPath = modelPath
    this.feedbackLogPath = feedbackLogPath
    this.policy = policy
    this.epsilon = epsilon
    this.temperature = temperature
    this.decisionHorizonLaps = decisionHorizonLaps

    this.actions = buildActionSpace()
    this.actionIds = this.actions.map((a) => a.id)

    this.featureBuilder = new FeatureBuilder()
    this.tyreModel = new TyreDegradationModel()
    this.trafficAnalyzer = new TrafficAnalyzer()
    this.simulator = new PitStrategySimulator({ tyreModel: this.tyreModel, trafficAnalyzer: this.trafficAnalyzer })
    this.rewardEvaluator = new RewardEvaluator({ gamma: 0.92, rolloutWeight: 0.62 })

    this.bandit = new ContextualBanditModel({
      actionIds: this.actionIds,
      featureSize: this.featureBuilder.featureNames.length,
      epsilon,
      temperature,
      learningRate: 0.028,
      l2: 0.0002,
      gradClipNorm: 1.15,
    })

    this.totalUpdates = 0
    this.lastDecision = null
    this.lastContextDigest = ''
    this.lastUpdateMs = 0

    this.loadModel()
  }

  isKnownAction(actionId) {
    return this.actionIds.includes(actionId)
  }

  buildDecisionContext(context = {}) {
    const c = { ...context }
    c.lap = Math.max(1, num(c.lap, 1))
    c.totalLaps = Math.max(c.lap, num(c.totalLaps, 58))
    c.lapsRemaining = Math.max(0, num(c.lapsRemaining, c.totalLaps - c.lap))
    c.playerPosition = clamp(num(c.playerPosition, 22), 1, 22)
    c.fuel = Math.max(0, num(c.fuel, 0))
    c.maxFuel = Math.max(num(c.maxFuel, 0), c.fuel + num(c.fuelBurnPerLap, 1.6) * c.lapsRemaining)
    c.ers = Math.max(0, num(c.ers, 0))
    c.maxErs = Math.max(1_000_000, num(c.maxErs, 4_000_000))
    c.tyreWear = clamp(num(c.tyreWear, 0), 0, 1)
    c.tyreTemp = num(c.tyreTemp, 92)
    c.gapAhead = Math.max(0, num(c.gapAhead, 3.5))
    c.gapBehind = Math.max(0, num(c.gapBehind, 3.5))
    c.trafficDensity = clamp(num(c.trafficDensity, 0.3), 0, 1)
    c.currentCompound = c.currentCompound || 'MEDIUM'
    c.trackId = c.trackId || 'TRACK_UNKNOWN'
    c.baseLapTime = Math.max(50, num(c.baseLapTime, 90))
    c.lastLapTime = Math.max(50, num(c.lastLapTime, c.baseLapTime))
    c.sector1Time = Math.max(10, num(c.sector1Time, c.lastLapTime / 3))
    c.sector2Time = Math.max(10, num(c.sector2Time, c.lastLapTime / 3))
    c.sector3Time = Math.max(10, num(c.sector3Time, c.lastLapTime / 3))
    c.pitWindowOpen = !!c.pitWindowOpen
    c.scProbability = clamp(num(c.scProbability, 0.05), 0, 0.8)
    c.vscProbability = clamp(num(c.vscProbability, 0.08), 0, 0.8)
    c.fuelBurnPerLap = Math.max(0.5, num(c.fuelBurnPerLap, 1.6))
    c.degradationSlope = num(c.degradationSlope, 0.03)
    return c
  }

  _simulateAll(decisionContext, horizonLaps) {
    const sims = []
    for (const action of this.actions) {
      const sim = this.simulator.simulate(action, decisionContext, horizonLaps)
      sims.push({ action, sim })
    }

    const baseline = sims.find((s) => s.action.type === 'STAY')?.sim || sims[0]?.sim
    return { sims, baseline }
  }

  decide(context = {}, opts = {}) {
    const decisionContext = this.buildDecisionContext(context)
    const digest = contextDigest(decisionContext)
    const now = Date.now()

    if (digest === this.lastContextDigest && this.lastDecision && now - this.lastUpdateMs < 250) {
      return { ...this.lastDecision, cacheHit: true }
    }

    const { vector, featureNames, context: enrichedContext } = this.featureBuilder.build(decisionContext)
    const horizonLaps = Math.max(5, Math.min(10, num(opts.horizonLaps, this.decisionHorizonLaps)))

    const { sims, baseline } = this._simulateAll(enrichedContext, horizonLaps)

    const heuristicRewards = {}
    for (const entry of sims) {
      const eva = this.rewardEvaluator.evaluate(entry.sim, baseline)
      heuristicRewards[entry.action.id] = eva
    }

    const rankedBandit = this.bandit.rank(vector)
    const blendAlpha = clamp(num(opts.blendAlpha, 0.62), 0, 1)

    const mergedRanking = rankedBandit
      .map((b) => {
        const h = heuristicRewards[b.actionId]?.reward ?? 0
        const mergedScore = blendAlpha * b.score + (1 - blendAlpha) * h
        return {
          actionId: b.actionId,
          banditScore: b.score,
          heuristicReward: h,
          mergedScore,
        }
      })
      .sort((a, b) => b.mergedScore - a.mergedScore)

    const policySelection = this.bandit.choose(vector, {
      policy: opts.policy || this.policy,
      epsilon: num(opts.epsilon, this.epsilon),
      temperature: num(opts.temperature, this.temperature),
    })

    const policyPick = mergedRanking.find((x) => x.actionId === policySelection.actionId)
    const bestMerged = mergedRanking[0]
    const selected = policyPick && policySelection.exploration ? policyPick : bestMerged

    const recommendation = {
      ts: new Date().toISOString(),
      actionId: selected.actionId,
      exploration: !!policySelection.exploration,
      policy: policySelection.policy,
      horizonLaps,
      featureNames,
      features: vector,
      temporal: enrichedContext.temporal,
      topCandidates: mergedRanking.slice(0, 8),
      simulation: sims
        .filter((x) => mergedRanking.slice(0, 5).some((m) => m.actionId === x.action.id))
        .map((x) => ({ actionId: x.action.id, ...x.sim })),
      cacheHit: false,
    }

    this.lastContextDigest = digest
    this.lastDecision = recommendation
    this.lastUpdateMs = now

    return recommendation
  }

  score(context = {}) {
    return this.decide(context, { policy: 'epsilon-greedy', epsilon: 0 })
  }

  update({ action, reward, context, nStepRewards = [] }) {
    if (!this.isKnownAction(action)) {
      return { ok: false, reason: 'unknown action' }
    }

    const decisionContext = this.buildDecisionContext(context || {})
    const { vector } = this.featureBuilder.build(decisionContext)

    let delayed = 0
    for (let i = 0; i < nStepRewards.length; i += 1) {
      delayed += Math.pow(0.92, i + 1) * num(nStepRewards[i], 0)
    }

    const rawReward = clamp(num(reward, 0) + delayed, -2, 2)

    const updated = this.bandit.update({ actionId: action, features: vector, reward: rawReward, importanceWeight: 1 })
    if (!updated.ok) return updated

    this.totalUpdates += 1

    const logPayload = {
      ts: Date.now(),
      action,
      reward,
      delayed,
      rawReward,
      normalizedReward: updated.normalizedReward,
      pred: updated.pred,
      error: updated.error,
      gradNorm: updated.gradNorm,
      clipped: updated.clipped,
      context: decisionContext,
    }

    ensureDir(this.feedbackLogPath)
    fs.appendFileSync(this.feedbackLogPath, `${JSON.stringify(logPayload)}\n`, 'utf8')

    if (this.totalUpdates % 20 === 0) {
      this.saveModel()
    }

    return {
      ok: true,
      totalUpdates: this.totalUpdates,
      actionUpdates: updated.actionCount,
      model: this.status(),
      train: {
        pred: updated.pred,
        error: updated.error,
        normalizedReward: updated.normalizedReward,
        gradNorm: updated.gradNorm,
        clipped: updated.clipped,
      },
    }
  }

  loadModel() {
    try {
      if (!fs.existsSync(this.modelPath)) return
      const raw = fs.readFileSync(this.modelPath, 'utf8')
      const saved = JSON.parse(raw)

      if (saved?.weights) {
        for (const actionId of this.actionIds) {
          const row = saved.weights[actionId]
          if (Array.isArray(row) && row.length === this.featureBuilder.featureNames.length) {
            this.bandit.weights[actionId] = row.map((v) => num(v, 0))
          }
        }
      }

      if (saved?.counts) {
        for (const actionId of this.actionIds) {
          this.bandit.counts[actionId] = num(saved.counts[actionId], 0)
        }
      }

      if (saved?.rewardStats) {
        this.bandit.rewardStats = {
          count: num(saved.rewardStats.count, 0),
          mean: num(saved.rewardStats.mean, 0),
          m2: num(saved.rewardStats.m2, 0),
        }
      }

      this.totalUpdates = num(saved?.totalUpdates, 0)
    } catch (err) {
      console.error('[relay] failed to load strategy model:', err)
    }
  }

  saveModel() {
    ensureDir(this.modelPath)
    fs.writeFileSync(
      this.modelPath,
      JSON.stringify(
        {
          featureNames: this.featureBuilder.featureNames,
          weights: this.bandit.weights,
          counts: this.bandit.counts,
          rewardStats: this.bandit.rewardStats,
          policy: this.policy,
          epsilon: this.epsilon,
          temperature: this.temperature,
          totalUpdates: this.totalUpdates,
          actionSpaceSize: this.actions.length,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    )
  }

  status() {
    return {
      totalUpdates: this.totalUpdates,
      actionSpaceSize: this.actions.length,
      actionIds: this.actionIds,
      featureNames: this.featureBuilder.featureNames,
      policy: this.policy,
      epsilon: this.epsilon,
      temperature: this.temperature,
      rewardStats: this.bandit.rewardStats,
      banditCounts: this.bandit.counts,
    }
  }
}
