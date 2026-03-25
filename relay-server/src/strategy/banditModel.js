import { argmax, clamp, dot, l2norm, pickByProbability, stableSoftmax } from './utils.js'

export class ContextualBanditModel {
  constructor({ actionIds, featureSize, epsilon = 0.08, temperature = 0.65, learningRate = 0.028, l2 = 0.0002, gradClipNorm = 1.15 }) {
    this.actionIds = actionIds
    this.featureSize = featureSize
    this.epsilon = epsilon
    this.temperature = temperature
    this.learningRate = learningRate
    this.l2 = l2
    this.gradClipNorm = gradClipNorm

    this.weights = Object.fromEntries(actionIds.map((id) => [id, new Array(featureSize).fill(0)]))
    this.counts = Object.fromEntries(actionIds.map((id) => [id, 0]))

    this.rewardStats = {
      count: 0,
      mean: 0,
      m2: 0,
    }
  }

  _normReward(rawReward) {
    this.rewardStats.count += 1
    const c = this.rewardStats.count
    const delta = rawReward - this.rewardStats.mean
    this.rewardStats.mean += delta / c
    const delta2 = rawReward - this.rewardStats.mean
    this.rewardStats.m2 += delta * delta2

    const variance = c > 1 ? this.rewardStats.m2 / (c - 1) : 1
    const std = Math.max(0.2, Math.sqrt(variance))

    return clamp((rawReward - this.rewardStats.mean) / (2.5 * std), -1, 1)
  }

  scores(features) {
    return this.actionIds.map((id) => dot(this.weights[id], features))
  }

  rank(features) {
    const sc = this.scores(features)
    return this.actionIds
      .map((id, i) => ({ actionId: id, score: sc[i] }))
      .sort((a, b) => b.score - a.score)
  }

  choose(features, { policy = 'softmax', epsilon = this.epsilon, temperature = this.temperature } = {}) {
    const scores = this.scores(features)
    const ranked = this.rank(features)

    if (policy === 'epsilon-greedy') {
      if (Math.random() < epsilon) {
        const pick = this.actionIds[Math.floor(Math.random() * this.actionIds.length)]
        return { actionId: pick, exploration: true, policy, ranked }
      }
      return { actionId: ranked[0].actionId, exploration: false, policy, ranked }
    }

    const probs = stableSoftmax(scores, temperature)
    const actionId = pickByProbability(this.actionIds, probs)
    const greedy = this.actionIds[argmax(scores)]
    return {
      actionId,
      exploration: actionId !== greedy,
      policy: 'softmax',
      ranked,
      probabilities: Object.fromEntries(this.actionIds.map((id, i) => [id, probs[i]])),
    }
  }

  update({ actionId, features, reward, importanceWeight = 1 }) {
    const w = this.weights[actionId]
    if (!w) return { ok: false, reason: 'unknown action' }

    const normalizedReward = this._normReward(reward)
    const pred = dot(w, features)
    const error = normalizedReward - pred

    const grads = new Array(features.length)
    for (let i = 0; i < features.length; i += 1) {
      grads[i] = importanceWeight * (error * features[i] - this.l2 * w[i])
    }

    const norm = l2norm(grads)
    const clipScale = norm > this.gradClipNorm ? this.gradClipNorm / norm : 1

    for (let i = 0; i < features.length; i += 1) {
      w[i] += this.learningRate * grads[i] * clipScale
    }

    this.counts[actionId] += 1

    return {
      ok: true,
      pred,
      error,
      normalizedReward,
      gradNorm: norm,
      clipped: clipScale < 1,
      actionCount: this.counts[actionId],
    }
  }
}
