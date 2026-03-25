import { AppState } from '../lib/types'
import { usePaceAnalysis } from '../hooks/usePaceAnalysis'

type Props = { state: AppState | null }

export function PaceAnalysisPanel({ state }: Props) {
  const analysis = usePaceAnalysis(state, 4)

  if (!state) {
    return (
      <section className="panel pace-panel">
        <div className="panel-header"><h3>페이스 분석</h3><div className="small">라이브 페이스 대기</div></div>
        <div className="panel-empty-state">현재 랩 기록을 수신하면 롤링 평균, 트렌드, 이상치 기반 전략 시그널을 표시합니다.</div>
      </section>
    )
  }

  return (
    <section className="panel pace-panel">
      <div className="panel-header">
        <h3>
          페이스 분석
          <span className="badge-raw">RAW</span>
          <span className="badge-est">EST</span>
        </h3>
        <div className="small">Rolling Avg {analysis.rollingWindow}랩 기준</div>
      </div>

      <div className="kpi-grid pace-kpi-grid">
        <div className="kpi">
          <div className="label">베스트 랩 RAW</div>
          <div className="value">{analysis.bestLapText}</div>
        </div>
        <div className="kpi">
          <div className="label">평균 페이스 EST</div>
          <div className="value">{analysis.avgLapText}</div>
        </div>
        <div className={`kpi ${analysis.currentLap.isLive ? 'kpi-live' : ''}`}>
          <div className="label">현재 랩</div>
          <div className="value">{analysis.currentLap.text}</div>
          <div className="small">{analysis.currentLap.statusText}</div>
        </div>
        <div className={`kpi trend-kpi is-${analysis.trend.direction}`}>
          <div className="label">페이스 트렌드</div>
          <div className="value">{analysis.trend.label}</div>
          <div className="small">기울기 {analysis.trend.slopeMsPerLap.toFixed(0)} ms/lap</div>
        </div>
      </div>

      <div className="pace-summary-grid pace-strategy-grid">
        <div className="kpi">
          <div className="label">최근 최고 랩</div>
          <div className="value">{analysis.bestRecent.lap ? `L${analysis.bestRecent.lap}` : '-'}</div>
          <div className="small">{analysis.bestRecent.lapTimeText}</div>
        </div>
        <div className={`kpi spread-kpi tone-${analysis.spread.tone}`}>
          <div className="label">페이스 스프레드</div>
          <div className="value">{analysis.spread.label}</div>
          <div className="small">낮을수록 안정적</div>
        </div>
        <div className={`kpi consistency-kpi tone-${analysis.consistency.tone}`}>
          <div className="label">일관성 등급</div>
          <div className="value">{analysis.consistency.label}</div>
          <div className="small">Outlier {analysis.outlierCount}랩 감지</div>
        </div>
        <div className={`kpi pit-signal-kpi ${analysis.pitSignal.shouldPitSoon ? 'is-alert' : 'is-hold'}`}>
          <div className="label">전략 시그널</div>
          <div className="value">{analysis.pitSignal.label}</div>
          <div className="small">{analysis.pitSignal.reason}</div>
        </div>
      </div>

      <div className="consistency-meter" aria-label="Pace consistency meter">
        <span className={`meter-${analysis.consistency.tone}`} style={{ width: `${analysis.consistency.meterPct}%` }} />
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>랩</th>
              <th>랩타임</th>
              <th>vs Rolling Avg</th>
              <th>변화</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {analysis.rows.map((row) => (
              <tr key={row.lap} className={`${row.isBestRecent ? 'row-best-lap' : ''} ${row.isOutlier ? 'row-outlier' : ''}`}>
                <td>L{row.lap}</td>
                <td>{row.lapTimeText}</td>
                <td className={`delta-cell delta-${row.deltaTone}`}>{row.deltaToRollingAvgText}</td>
                <td className={`change-cell change-${row.changeSymbol.toLowerCase()}`}>{row.changeSymbol}</td>
                <td>
                  {row.isBestRecent ? <span className="row-badge best">BEST</span> : null}
                  {row.isOutlier ? <span className="row-badge outlier">OUTLIER</span> : null}
                  {!row.isBestRecent && !row.isOutlier ? <span className="row-badge normal">NOMINAL</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
