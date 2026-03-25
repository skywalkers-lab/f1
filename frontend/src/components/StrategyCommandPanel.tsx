import { memo, useMemo } from 'react'
import { AppState } from '../lib/types'
import { StrategyEngineOutput } from '../lib/strategyEngine'
import { useStrategyAnalysis } from '../hooks/useStrategyAnalysis'

type Locale = 'ko' | 'en'

type Props = {
  state: AppState | null
  decision: StrategyEngineOutput | null
  locale: Locale
}

function PanelComponent({ state, decision, locale }: Props) {
  const analysis = useStrategyAnalysis(state, decision)

  const copy = useMemo(
    () =>
      locale === 'ko'
        ? {
            title: '전략 의사결정 엔진',
            subtitle: '결론 → 비교 → 트리거 → 실행 통제',
            noData: '타이어 히스토리와 리더보드가 누적되면 전략 엔진이 시나리오를 계산합니다.',
            recommendation: 'Recommendation Rule',
            simulation: 'Decision Space Matrix',
            reasoning: 'Causal Decision Log',
            execution: 'Execution Timing Control',
            horizon: '시뮬레이션 구간',
            projected: '예상 포지션',
            rejoin: '리조인',
            gain: '예상 이득',
            lapDelta: '랩 델타',
            risk: '리스크',
            confidence: '확신도',
            trigger: '트리거',
            fallback: '대안',
            actionNow: '즉시 명령',
            crossover: '교차 지점',
            downside: '다운사이드',
          }
        : {
            title: 'Strategy Decision Engine',
            subtitle: 'Conclusion → Comparison → Trigger → Execution Control',
            noData: 'The engine will start scoring scenarios when tyre history and leaderboard data accumulate.',
            recommendation: 'Recommendation Rule',
            simulation: 'Decision Space Matrix',
            reasoning: 'Causal Decision Log',
            execution: 'Execution Timing Control',
            horizon: 'Simulation horizon',
            projected: 'Projected position',
            rejoin: 'Rejoin',
            gain: 'Expected gain',
            lapDelta: 'Lap delta',
            risk: 'Traffic risk',
            confidence: 'Confidence',
            trigger: 'Trigger',
            fallback: 'Fallback',
            actionNow: 'Immediate command',
            crossover: 'Crossover',
            downside: 'Downside',
          },
    [locale],
  )

  if (!state || !decision || !analysis.ready) {
    return (
      <section className="panel strategy-command-panel">
        <div className="panel-header">
          <h3>{copy.title}</h3>
          <div className="small">{copy.subtitle}</div>
        </div>
        <div className="panel-empty-state">{copy.noData}</div>
      </section>
    )
  }

  const best = analysis.scenarioRows[0]
  const visibleScenarios = analysis.scenarioRows
  const hiddenScenarioCount = Math.max(0, (decision.scenarios?.length ?? 0) - visibleScenarios.length)

  return (
    <section className="panel strategy-command-panel">
      <div className="panel-header">
        <h3>{copy.title}</h3>
        <div className="small">
          {copy.horizon}: {analysis.simulationHorizon} laps
        </div>
      </div>

      <div className={`strategy-alert-banner level-${analysis.attention.level}`}>
        {analysis.attention.message}
      </div>

      <div className={`recommendation-hero is-${analysis.titleTone} ${analysis.attention.strategyChanged ? 'is-updated' : ''}`}>
        <div className="recommendation-rule-block">
          <div className="label">{copy.recommendation}</div>
          <div className="recommendation-call">{analysis.recommendation.headline}</div>
          <div className="small">{analysis.recommendation.subline}</div>
          <div className="strategy-rule-list">
            <div className="strategy-rule-row"><strong>Timing:</strong> {analysis.recommendation.timing}</div>
            <div className="strategy-rule-row"><strong>{copy.trigger}:</strong> {analysis.recommendation.triggerSummary}</div>
            <div className="strategy-rule-row"><strong>{copy.fallback}:</strong> {analysis.recommendation.fallback}</div>
          </div>
        </div>
        <div className="recommendation-meta-grid">
          <div className="kpi">
            <div className="label">{copy.gain}</div>
            <div className="value">{best?.expectedGainText ?? '-'}</div>
          </div>
          <div className={`kpi ${analysis.attention.confidenceDrop ? 'kpi-alert' : ''}`}>
            <div className="label">{copy.confidence}</div>
            <div className="value">{analysis.recommendation.confidenceText}</div>
          </div>
          <div className={`kpi ${analysis.attention.riskSpike ? 'kpi-alert' : ''}`}>
            <div className="label">{copy.risk}</div>
            <div className="value">{best?.riskLabel ?? '-'}</div>
          </div>
          <div className="kpi">
            <div className="label">{copy.crossover}</div>
            <div className="value">{analysis.recommendationMatrix.crossoverSummary}</div>
          </div>
        </div>
      </div>

      <div className="panel-header strategy-subhead">
        <h3>{copy.simulation}</h3>
        <div className="small">{copy.actionNow}: {analysis.executionCommands[0]?.command ?? '-'}</div>
      </div>

      <div className="small strategy-alert-inline">{analysis.recommendationMatrix.trafficAlert}</div>

      <div className="scenario-grid strategy-scenario-grid">
        {visibleScenarios.map((scenario) => (
          <article key={scenario.id} className={`scenario-card ${scenario.id === decision.recommendation.call ? 'is-best' : ''}`}>
            <div className="scenario-card-head">
              <h4>{scenario.rank}. {scenario.label}</h4>
              <span className={`scenario-risk is-${scenario.riskBand}`}>{copy.risk}: {scenario.riskBand.toUpperCase()}</span>
            </div>
            <div className="scenario-kpis">
              <div>
                <div className="label">{copy.projected}</div>
                <div className="value">{scenario.projectedText}</div>
              </div>
              <div>
                <div className="label">{copy.rejoin}</div>
                <div className="value">{scenario.rejoinText}</div>
              </div>
              <div>
                <div className="label">{copy.gain}</div>
                <div className="value">{scenario.expectedGainText}</div>
              </div>
              <div>
                <div className="label">{copy.lapDelta}</div>
                <div className={`value ${scenario.lapDeltaMs > 0 ? 'delta-up' : scenario.lapDeltaMs < 0 ? 'delta-down' : ''}`}>{scenario.lapDeltaText}</div>
              </div>
              <div>
                <div className="label">Timing</div>
                <div className="value">{scenario.timingText}</div>
              </div>
              <div>
                <div className="label">{copy.downside}</div>
                <div className="value">{scenario.downsideLabel}</div>
              </div>
            </div>

            <div className="scenario-curve" aria-label={`${scenario.label} delta curve vs baseline`}>
              {scenario.curve.map((lap) => (
                <div key={lap.lap} className="scenario-curve-row">
                  <span className="curve-lap">L{lap.lap}</span>
                  <span className="curve-track">
                    <span className="curve-fill" style={{ width: `${lap.normalizedPct}%` }} />
                  </span>
                  <span className={`curve-delta ${lap.deltaToBaselineMs > 0 ? 'is-pos' : lap.deltaToBaselineMs < 0 ? 'is-neg' : ''}`}>{lap.deltaToBaselineText}</span>
                </div>
              ))}
            </div>

            <div className="reason-list">
              <div className="reason-line"><strong>{copy.trigger}:</strong> {scenario.triggerRule}</div>
              <div className="reason-line"><strong>{copy.fallback}:</strong> {scenario.fallbackRule}</div>
              <div className="reason-line"><strong>Sensitivity:</strong> {scenario.pitWindowSensitivity}</div>
            </div>

            <div className="small scenario-trace strategy-crossover-note">
              {copy.crossover}: {scenario.crossoverLap ? `L${scenario.crossoverLap}` : '없음'}
            </div>
          </article>
        ))}
      </div>
      {hiddenScenarioCount > 0 ? <div className="small scenario-grid-note">+{hiddenScenarioCount}개 시나리오는 Decision Log에서 확인</div> : null}

      <div className="strategy-command-bottom">
        <div className="kpi strategy-log-card">
          <div className="label">{copy.reasoning}</div>
          <div className="reason-list">
            {analysis.decisionCausalLog.map((entry) => (
              <div key={entry.id} className={`reason-line is-${entry.tone}`}>
                <strong>{entry.cause}</strong>{' -> '}{entry.impact}{' -> '}{entry.conclusion}
              </div>
            ))}
          </div>
        </div>

        <div className="kpi strategy-log-card">
          <div className="label">{copy.execution}</div>
          <div className="reason-list">
            {analysis.executionCommands.map((item) => (
              <div key={item.command} className={`reason-line execution-row is-${item.status}`}>
                <strong>{item.command}</strong>{` [${item.timing}] -> ${item.condition}`}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

export const StrategyCommandPanel = memo(PanelComponent)