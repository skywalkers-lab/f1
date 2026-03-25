import { AppState } from '../lib/types'
import { TyreHistory } from '../lib/tyreHistoryManager'
import { useTyreEngineeringAnalysis } from '../hooks/useTyreEngineeringAnalysis'

type Props = { state: AppState | null; history: TyreHistory }

export function TyreEngineeringPanel({ state, history }: Props) {
  const analysis = useTyreEngineeringAnalysis(state, history)

  if (!state || !analysis.ready) {
    return (
      <section className="panel tyre-engineering-panel">
        <div className="panel-header">
          <h3>타이어 엔지니어링</h3>
          <div className="small">TYRE ENGINEERING</div>
        </div>
        <div className="panel-empty-state">텔레메트리와 타이어 히스토리가 누적되면 열화, 온도, 피트 타이밍 분석을 표시합니다.</div>
      </section>
    )
  }

  return (
    <section className="panel tyre-engineering-panel">
      <div className="panel-header">
        <h3>타이어 엔지니어링</h3>
        <div className="small">현재: {analysis.compoundLabel}</div>
      </div>

      <div className={`tyre-engineering-alert is-${analysis.pitTiming.tone}`}>
        <strong>{analysis.pitTiming.label}</strong>
        <span>{analysis.pitTiming.detail}</span>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 8 }}>
        <div className="kpi">
          <div className="label">현재 세트</div>
          <div className={`value tyre-compound-value is-${analysis.compoundTone}`}>{analysis.compoundLabel}</div>
          <div className="small">Stint {analysis.stintLap}</div>
        </div>
        <div className="kpi">
          <div className="label">열 상태</div>
          <div className={`value tyre-thermal-value is-${analysis.thermal.tone}`}>{analysis.thermal.temperatureC}°C</div>
          <div className="small">{analysis.thermal.stateLabel} · Grip {analysis.thermal.gripLevelPct}%</div>
        </div>
        <div className="kpi">
          <div className="label">총 랩손실</div>
          <div className={`value tyre-loss-value is-${analysis.pitTiming.tone}`}>+{analysis.totalLapLossS.toFixed(2)}s</div>
          <div className="small">corner aggregate</div>
        </div>
      </div>

      <div className="tyre-engineering-grid">
        <div className="kpi">
          <div className="label">스틴트 단계</div>
          <div className={`value tyre-phase-value is-${analysis.stint.tone}`}>{analysis.stint.phaseLabel}</div>
          <div className="small">{analysis.stint.detail}</div>
        </div>
        <div className="kpi">
          <div className="label">온도 해석</div>
          <div className={`value tyre-phase-value is-${analysis.thermal.tone}`}>{analysis.thermal.stateLabel}</div>
          <div className="small">{analysis.thermal.warning}</div>
        </div>
        <div className="kpi">
          <div className="label">밸런스</div>
          <div className={`value tyre-phase-value is-${analysis.imbalance.tone}`}>{analysis.imbalance.handlingLabel}</div>
          <div className="small">spread {analysis.imbalance.spreadPct.toFixed(1)}% · {analysis.imbalance.detail}</div>
        </div>
      </div>

      <div className="kpi" style={{ marginBottom: 8 }}>
        <div className="label">코너별 타이어 영향</div>
        <div className="tyre-corner-grid">
          {analysis.corners.map((corner) => (
            <div key={corner.id} className={`tyre-corner-card is-${corner.tone}`} aria-label={`${corner.id} wear ${corner.wearPct}%, lap loss +${corner.lapTimeLossS.toFixed(2)}s`}>
              <div className="tyre-corner-head">
                <strong>{corner.id}</strong>
                <span>{corner.label}</span>
              </div>
              <div className="bar tyre-corner-bar" aria-hidden="true">
                <span style={{ width: `${corner.wearPct}%` }} />
              </div>
              <div className="tyre-corner-metrics">
                <span>Wear {corner.wearPct.toFixed(0)}%</span>
                <span>Grip -{corner.gripLossPct.toFixed(1)}%</span>
                <span>{corner.id} +{corner.lapTimeLossS.toFixed(2)}s</span>
              </div>
              <div className="small">{corner.temperatureC}°C · {corner.thermalState} · dW/dLap {corner.degradationRatePctPerLap.toFixed(2)}%</div>
            </div>
          ))}
        </div>
      </div>

      <div className="tyre-engineering-grid">
        <div className="kpi">
          <div className="label">열화 예측 5랩</div>
          <div className="tyre-forecast-list">
            {analysis.forecast.points.map((point) => (
              <div key={point.lapOffset} className={`tyre-forecast-row is-${point.riskTone}`}>
                <span>L+{point.lapOffset}</span>
                <span>Wear {point.projectedWearPct.toFixed(0)}%</span>
                <span>Loss +{point.projectedLapLossS.toFixed(2)}s</span>
              </div>
            ))}
          </div>
          <div className="small">{analysis.forecast.summary}</div>
        </div>

        <div className="kpi">
          <div className="label">재고 & 전략 시나리오</div>
          <div className="tyre-inventory-list">
            {analysis.inventory.map((item) => (
              <div key={item.compound} className={`tyre-inventory-row is-${item.tone}`}>
                <strong>{item.label}</strong>
                <span>{item.remainingSets} sets</span>
                <span>{item.scenario}</span>
              </div>
            ))}
          </div>
          <div className="small">현재 세트와 잔여 랩 기준 추정 시나리오</div>
        </div>
      </div>
    </section>
  )
}
