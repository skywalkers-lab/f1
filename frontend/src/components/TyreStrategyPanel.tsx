import { AppState } from '../lib/types'
import { TyreHistory } from '../lib/tyreHistoryManager'
import { useTyreStrategyAnalysis } from '../hooks/useTyreStrategyAnalysis'
import { TyreEngineeringPanel } from './TyreEngineeringPanel'
import { TyreGraph } from './tyre/TyreGraph'

type Locale = 'ko' | 'en'
type Props = { state: AppState | null; locale: Locale; history: TyreHistory }

function text(locale: Locale) {
  return locale === 'ko'
    ? {
        title: '타이어 마모 전략 그래프',
        subtitle: '상황 · 분석 · 결정 흐름 기반 피트 타이밍 시스템',
        cliff: '클리프 임계',
        undercut: '언더컷 윈도우',
        focus: '집중 차량',
        noState: '텔레메트리 수신 대기 중',
        estPit: '예상 피트 랩',
        action: '액션 시그널',
        scenarios: '전략 시나리오 트리',
        influence: '전략 영향 차량',
      }
    : {
        title: 'Tyre Wear Strategy Graph',
        subtitle: 'Situation · analysis · decision flow for pit timing',
        cliff: 'Cliff threshold',
        undercut: 'Undercut window',
        focus: 'Focused drivers',
        noState: 'Waiting for telemetry stream',
        estPit: 'Estimated pit lap',
        action: 'Action signal',
        scenarios: 'Scenario tree',
        influence: 'Strategic rivals',
      }
}

export function TyreStrategyPanel({ state, locale, history }: Props) {
  const labels = text(locale)
  const cliffLow = 0.7
  const cliffHigh = 0.8
  const analysis = useTyreStrategyAnalysis(state, history)

  const graphPredictions = Object.fromEntries(
    Object.values(analysis.predictions).map((prediction) => [
      prediction.carIndex,
      {
        carIndex: prediction.carIndex,
        cliffLap: prediction.meanCliffLap,
        slopePerLap: prediction.slopePerLap,
        confidence: prediction.confidencePct / 100,
      },
    ]),
  )

  if (!state) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h3>{labels.title}</h3>
        </div>
        <div className="small">{labels.noState}</div>
      </section>
    )
  }

  return (
    <section className="panel tyre-strategy-panel">
      <div className="panel-header">
        <h3>{labels.title}</h3>
        <div className="small">{labels.subtitle}</div>
      </div>

      <div className={`tyre-strategy-action is-${analysis.actionSignal.tone}`}>
        <div>
          <div className="label">{labels.action}</div>
          <div className="value">{analysis.actionSignal.call}</div>
        </div>
        <div className="tyre-strategy-action-copy">
          <strong>{analysis.actionSignal.headline}</strong>
          <span>{analysis.actionSignal.rationale}</span>
        </div>
      </div>

      <TyreEngineeringPanel state={state} history={history} />

      <div className="tyre-meta-row">
        <span className="chip">{labels.cliff}: {(cliffLow * 100).toFixed(0)}%~{(cliffHigh * 100).toFixed(0)}%</span>
        <span className="chip">
          {labels.focus}: {analysis.selection.highlightedIds.length}
        </span>
        <span className="chip">
          {labels.undercut}: {analysis.undercutWindows.length}
        </span>
        <span className="chip">CI: {analysis.playerPrediction ? `${analysis.playerPrediction.confidencePct}%` : '-'}</span>
      </div>

      <div className="tyre-forecast-grid">
        <div className="kpi">
          <div className="label">{locale === 'ko' ? '플레이어 클리프' : 'Player cliff'}</div>
          <div className="value">{analysis.playerPrediction ? `L${analysis.playerPrediction.meanCliffLap.toFixed(1)}` : '-'}</div>
          <div className="small">
            {analysis.playerPrediction
              ? `CI L${analysis.playerPrediction.lowLap.toFixed(1)}-${analysis.playerPrediction.highLap.toFixed(1)} · dW/dLap ${(analysis.playerPrediction.slopePerLap * 100).toFixed(2)}%`
              : labels.noState}
          </div>
        </div>
        <div className="kpi">
          <div className="label">{locale === 'ko' ? '최우선 언더컷' : 'Top undercut'}</div>
          <div className="value">{analysis.undercutWindows[0] ? `#${analysis.undercutWindows[0].rivalCarIndex}` : '-'}</div>
          <div className="small">
            {analysis.undercutWindows[0]
              ? `${analysis.undercutWindows[0].successProbabilityPct}% · +${analysis.undercutWindows[0].expectedGainS.toFixed(2)}s`
              : labels.noState}
          </div>
        </div>
      </div>

      <div className="tyre-strategy-influence-grid">
        <div className="kpi">
          <div className="label">{labels.influence}</div>
          <div className="reason-list">
            {analysis.selection.reasons.map((item) => (
              <div className="reason-line" key={item.carIndex}>
                #{item.carIndex} · {item.role} · {item.reason}
              </div>
            ))}
          </div>
        </div>

        <div className="kpi">
          <div className="label">Decision Basis</div>
          <div className="reason-list">
            {analysis.decisionLog.map((item) => (
              <div key={item.label} className={`reason-line is-${item.tone}`}>
                {item.label}: {item.value}
              </div>
            ))}
          </div>
        </div>
      </div>

      <TyreGraph
        history={history}
        highlightedIds={analysis.graph.highlightedIds}
        fadedIds={analysis.graph.fadedIds}
        playerCarIndex={state.player_car_index}
        predictions={graphPredictions}
        windows={analysis.undercutWindows.map((window) => ({
          rivalCarIndex: window.rivalCarIndex,
          startLap: window.startLap,
          endLap: window.endLap,
          score: window.opportunityScore / 100,
          reason: window.reason,
        }))}
        pitMarkers={analysis.graph.pitMarkers}
        crossovers={analysis.graph.crossovers}
        locale={locale}
        cliffLow={cliffLow}
        cliffHigh={cliffHigh}
      />

      <div className="tyre-graph-legend" aria-label={locale === 'ko' ? '타이어 그래프 범례' : 'Tyre graph legend'}>
        <span className="legend-item"><span className="legend-dot tyre-player" />{locale === 'ko' ? '플레이어' : 'Player'}</span>
        <span className="legend-item"><span className="legend-dot tyre-soft" />SOFT</span>
        <span className="legend-item"><span className="legend-dot tyre-medium" />MEDIUM</span>
        <span className="legend-item"><span className="legend-dot tyre-hard" />HARD</span>
        <span className="legend-item"><span className="legend-dot tyre-cliff" />{locale === 'ko' ? '클리프 예측' : 'Cliff prediction'}</span>
      </div>

      <div className="tyre-bottom-grid">
        <div className="kpi">
          <div className="label">{labels.scenarios}</div>
          <div className="reason-list">
            {analysis.scenarios.player.length === 0 ? (
              <div className="reason-line">{locale === 'ko' ? '전략 시뮬레이션 데이터 부족' : 'Not enough data for strategy simulation'}</div>
            ) : (
              analysis.scenarios.player.map((scenario) => (
                <div className={`reason-line tyre-scenario-line is-${scenario.tone}`} key={scenario.id}>
                  {scenario.label} · L{scenario.pitLap} · {scenario.summary}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="kpi">
          <div className="label">{labels.undercut}</div>
          <div className="reason-list">
            {analysis.undercutWindows.length === 0 ? (
              <div className="reason-line">{locale === 'ko' ? '현재 유효 구간 없음' : 'No actionable window currently'}</div>
            ) : (
              analysis.undercutWindows.slice(0, 4).map((w) => (
                <div className={`reason-line tyre-window-line is-${w.successProbabilityPct >= 65 ? 'positive' : w.successProbabilityPct >= 50 ? 'neutral' : 'warning'}`} key={w.rivalCarIndex}>
                  #{w.rivalCarIndex} · L{w.startLap.toFixed(1)}~{w.endLap.toFixed(1)} · P{w.successProbabilityPct}% · Gain +{w.expectedGainS.toFixed(2)}s · Fail -{w.failureLossS.toFixed(2)}s
                </div>
              ))
            )}
          </div>
        </div>

        <div className="kpi">
          <div className="label">Rival Scenarios</div>
          <div className="reason-list">
            {analysis.scenarios.rivals.length === 0 ? (
              <div className="reason-line">{locale === 'ko' ? '직접 영향 경쟁차 없음' : 'No direct strategic rival detected'}</div>
            ) : (
              analysis.scenarios.rivals.map((rival) => (
                <div className="reason-line" key={rival.carIndex}>
                  #{rival.carIndex} · {rival.role} · {rival.scenarios[0]?.label ?? '-'} @ L{rival.scenarios[0]?.pitLap ?? '-'}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
