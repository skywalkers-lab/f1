import { useState, useEffect, useCallback } from 'react'
import {
  listSessions, loadSession, deleteSession, exportSession,
  getAnalysisReport,
  type SessionSummary, type SessionData, type AnalysisReport,
  type LapAnalysisItem, type TimelineEvent,
} from '../lib/api'

type Props = { }

function msToTime(ms: number): string {
  if (ms <= 0) return '—'
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const millis = ms % 1000
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`
}

function formatDuration(s: number): string {
  const mins = Math.floor(s / 60)
  const secs = Math.floor(s % 60)
  return `${mins}m ${secs}s`
}

export function PostRaceAnalysisView(_props: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [report, setReport] = useState<AnalysisReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeSection, setActiveSection] = useState<string>('overview')
  const [selectedLapRange, setSelectedLapRange] = useState<[number, number] | null>(null)

  // Load session list
  useEffect(() => {
    listSessions().then(setSessions).catch(() => {})
  }, [])

  const handleSelectSession = useCallback(async (filename: string) => {
    setSelectedFile(filename)
    setLoading(true)
    setReport(null)
    try {
      const r = await getAnalysisReport(filename)
      setReport(r)
    } catch {
      setReport(null)
    }
    setLoading(false)
  }, [])

  const handleDelete = useCallback(async (filename: string) => {
    await deleteSession(filename)
    setSessions(prev => prev.filter(s => s.filename !== filename))
    if (selectedFile === filename) {
      setSelectedFile(null)
      setReport(null)
    }
  }, [selectedFile])

  const handleExport = useCallback(async (filename: string) => {
    const data = await exportSession(filename)
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleRefresh = useCallback(() => {
    listSessions().then(setSessions).catch(() => {})
  }, [])

  // Filter laps by selected range
  const filteredLaps = report?.lap_analysis?.filter(l => {
    if (!selectedLapRange) return true
    return l.lap >= selectedLapRange[0] && l.lap <= selectedLapRange[1]
  }) ?? []

  const sections = ['overview', 'laps', 'stints', 'pitstops', 'strategy', 'fuel_ers', 'balance', 'timeline']

  return (
    <div className="post-race-analysis">
      {/* Session Selector */}
      <div className="analysis-session-selector">
        <div className="pw-panel">
          <div className="pw-panel-header">
            <span className="pw-panel-title">RACE SESSIONS</span>
            <button className="small-btn" onClick={handleRefresh}>REFRESH</button>
          </div>
          {sessions.length === 0 ? (
            <div className="empty-state">No recorded sessions yet. Sessions are auto-recorded during races.</div>
          ) : (
            <div className="session-list">
              {sessions.map(s => (
                <button
                  key={s.filename}
                  type="button"
                  className={`session-item ${selectedFile === s.filename ? 'is-selected' : ''}`}
                  onClick={() => handleSelectSession(s.filename)}
                  aria-label={`Select session ${s.filename}`}
                >
                  <div className="session-item-main">
                    <span className="session-track">{s.track}</span>
                    <span className="session-type">{s.session_type}</span>
                    <span className="session-pos">P{s.final_position}</span>
                  </div>
                  <div className="session-item-meta">
                    <span>{msToTime(s.best_lap_ms)}</span>
                    <span>{s.total_laps} laps</span>
                    <span>{formatDuration(s.duration_s)}</span>
                    <span>{s.total_pit_stops} stops</span>
                  </div>
                  <div className="session-item-actions">
                    <button type="button" className="small-btn" onClick={(e) => { e.stopPropagation(); handleExport(s.filename) }}>EXPORT</button>
                    <button type="button" className="small-btn is-danger" onClick={(e) => { e.stopPropagation(); handleDelete(s.filename) }}>DELETE</button>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Analysis Report */}
      {loading && <div className="analysis-loading">Generating analysis report...</div>}

      {report && (
        <div className="analysis-report">
          {/* Section Navigation */}
          <nav className="analysis-section-nav">
            {sections.map(sec => (
              <button
                key={sec}
                className={`section-btn ${activeSection === sec ? 'is-active' : ''}`}
                onClick={() => setActiveSection(sec)}
              >
                {sec.toUpperCase().replace('_', ' ')}
              </button>
            ))}
          </nav>

          {/* Overview */}
          {activeSection === 'overview' && (
            <div className="analysis-section">
              <section className="pw-panel">
                <div className="pw-panel-header">
                  <span className="pw-panel-title">RACE OVERVIEW — {report.track}</span>
                  <span className="pw-panel-badge is-ok">P{report.final_position}</span>
                </div>
                <div className="analysis-kpi-grid">
                  <div className="analysis-kpi">
                    <span className="analysis-kpi-label">BEST LAP</span>
                    <span className="analysis-kpi-value is-ok">{msToTime(report.best_lap_ms)}</span>
                  </div>
                  <div className="analysis-kpi">
                    <span className="analysis-kpi-label">TOTAL TIME</span>
                    <span className="analysis-kpi-value">{formatDuration(report.total_time_s)}</span>
                  </div>
                  <div className="analysis-kpi">
                    <span className="analysis-kpi-label">LAPS</span>
                    <span className="analysis-kpi-value">{report.total_laps}</span>
                  </div>
                  <div className="analysis-kpi">
                    <span className="analysis-kpi-label">PIT STOPS</span>
                    <span className="analysis-kpi-value">{report.pit_stop_analysis?.length ?? 0}</span>
                  </div>
                  <div className="analysis-kpi">
                    <span className="analysis-kpi-label">STRATEGY ACCURACY</span>
                    <span className={`analysis-kpi-value ${(report.strategy_evaluation?.accuracy_pct ?? 0) >= 60 ? 'is-ok' : 'is-critical'}`}>
                      {report.strategy_evaluation?.accuracy_pct ?? 0}%
                    </span>
                  </div>
                  <div className="analysis-kpi">
                    <span className="analysis-kpi-label">TRAFFIC LOST</span>
                    <span className="analysis-kpi-value is-warn">{report.traffic_impact?.estimated_time_lost_s ?? 0}s</span>
                  </div>
                </div>
                {/* Narrative */}
                <div className="race-narrative">
                  <p>{report.race_narrative}</p>
                </div>
                {/* Key Findings */}
                {report.key_findings.length > 0 && (
                  <div className="key-findings">
                    <div className="sub-header">KEY FINDINGS</div>
                    <ul>
                      {report.key_findings.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* Lap Analysis */}
          {activeSection === 'laps' && (
            <div className="analysis-section">
              <section className="pw-panel">
                <div className="pw-panel-header">
                  <span className="pw-panel-title">LAP TIME HISTORY</span>
                  {selectedLapRange && (
                    <button className="small-btn" onClick={() => setSelectedLapRange(null)}>CLEAR FILTER</button>
                  )}
                </div>
                {/* Lap time bar chart */}
                <div className="lap-chart">
                  {report.lap_analysis.map(l => {
                    const maxDelta = Math.max(...report.lap_analysis.filter(x => x.lap_time_ms > 0).map(x => x.delta_to_best_s), 1)
                    const pct = l.lap_time_ms > 0 ? Math.max(5, (1 - l.delta_to_best_s / Math.max(maxDelta, 5)) * 100) : 5
                    const isInRange = !selectedLapRange || (l.lap >= selectedLapRange[0] && l.lap <= selectedLapRange[1])
                    return (
                      <div
                        key={l.lap}
                        className={`lap-bar-wrapper ${l.is_pit_lap ? 'is-pit' : ''} ${l.is_outlier ? 'is-outlier' : ''} ${isInRange ? '' : 'is-dimmed'}`}
                        onClick={() => setSelectedLapRange(selectedLapRange ? null : [l.lap, l.lap])}
                        title={`Lap ${l.lap}: ${(l.lap_time_s).toFixed(3)}s | Δbest: +${l.delta_to_best_s.toFixed(3)}s | P${l.position} | ${l.tyre_compound}`}
                      >
                        <div className={`lap-bar ${l.is_pit_lap ? 'pit-lap' : ''}`} style={{ height: `${pct}%` }} />
                        <span className="lap-bar-label">{l.lap}</span>
                      </div>
                    )
                  })}
                </div>
                {/* Lap table */}
                <div className="pace-table-wrap">
                  <table className="scenario-table">
                    <thead>
                      <tr>
                        <th>LAP</th><th>TIME</th><th>Δ BEST</th><th>Δ AVG</th>
                        <th>POS</th><th>TYRE</th><th>AGE</th><th>FUEL</th><th>STINT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLaps.map(l => (
                        <tr key={l.lap} className={`${l.is_pit_lap ? 'is-pit-row' : ''} ${l.is_outlier ? 'is-outlier-row' : ''}`}>
                          <td className="mono">{l.lap}</td>
                          <td className="mono">{l.lap_time_s > 0 ? l.lap_time_s.toFixed(3) : '—'}</td>
                          <td className={`mono ${l.delta_to_best_s < 0.5 ? 'is-ok' : l.delta_to_best_s > 2 ? 'is-critical' : ''}`}>
                            +{l.delta_to_best_s.toFixed(3)}
                          </td>
                          <td className={`mono ${l.delta_to_avg_s < 0 ? 'is-ok' : 'is-critical'}`}>
                            {l.delta_to_avg_s > 0 ? '+' : ''}{l.delta_to_avg_s.toFixed(3)}
                          </td>
                          <td className="mono">P{l.position}</td>
                          <td>{l.tyre_compound}</td>
                          <td className="mono">{l.tyre_age}</td>
                          <td className="mono">{l.fuel_remaining.toFixed(1)}</td>
                          <td className="mono">{l.stint_number}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* Stint Analysis */}
          {activeSection === 'stints' && (
            <div className="analysis-section">
              <section className="pw-panel">
                <div className="pw-panel-header">
                  <span className="pw-panel-title">STINT ANALYSIS</span>
                </div>
                <div className="stint-cards">
                  {report.stint_analysis.map(s => (
                    <div key={s.stint_number} className={`stint-card ${s.tyre_cliff_detected ? 'has-cliff' : ''}`}>
                      <div className="stint-header">
                        <span className="stint-number">STINT {s.stint_number}</span>
                        <span className="stint-compound">{s.compound}</span>
                        <span className="stint-laps">Laps {s.start_lap}–{s.end_lap} ({s.total_laps})</span>
                      </div>
                      <div className="stint-metrics">
                        <div className="stint-metric">
                          <span className="label">BEST</span>
                          <span className="value">{s.best_lap_time_s.toFixed(3)}s</span>
                        </div>
                        <div className="stint-metric">
                          <span className="label">AVG</span>
                          <span className="value">{s.avg_lap_time_s.toFixed(3)}s</span>
                        </div>
                        <div className="stint-metric">
                          <span className="label">DEG RATE</span>
                          <span className={`value ${s.degradation_rate_s > 0.1 ? 'is-critical' : 'is-ok'}`}>
                            {s.degradation_rate_s.toFixed(4)}s/lap
                          </span>
                        </div>
                        {s.tyre_cliff_detected && (
                          <div className="stint-metric">
                            <span className="label">CLIFF</span>
                            <span className="value is-critical">Lap {s.cliff_lap}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* Pit Stop Analysis */}
          {activeSection === 'pitstops' && (
            <div className="analysis-section">
              <section className="pw-panel">
                <div className="pw-panel-header">
                  <span className="pw-panel-title">PIT STOP ANALYSIS</span>
                </div>
                {report.pit_stop_analysis.length === 0 ? (
                  <div className="empty-state">No pit stops recorded.</div>
                ) : (
                  <div className="pit-stop-cards">
                    {report.pit_stop_analysis.map((p, i) => (
                      <div key={i} className={`pit-card ${p.position_delta < 0 ? 'is-gain' : p.position_delta > 0 ? 'is-loss' : ''}`}>
                        <div className="pit-header">
                          <span>Lap {p.lap}</span>
                          <span className={p.position_delta <= 0 ? 'is-ok' : 'is-critical'}>
                            {p.position_delta > 0 ? '+' : ''}{p.position_delta} pos
                          </span>
                        </div>
                        <div className="pit-detail">
                          <span>{p.compound_before} → {p.compound_after}</span>
                          <span>P{p.position_before} → P{p.position_after}</span>
                          <span>{(p.pit_duration_ms / 1000).toFixed(1)}s stop</span>
                        </div>
                        <div className="pit-analysis">
                          {p.was_undercut && (
                            <span className={p.undercut_success ? 'is-ok' : 'is-critical'}>
                              UNDERCUT {p.undercut_success ? '✓' : '✗'}
                            </span>
                          )}
                          {p.was_overcut && (
                            <span className={p.overcut_success ? 'is-ok' : 'is-critical'}>
                              OVERCUT {p.overcut_success ? '✓' : '✗'}
                            </span>
                          )}
                          <span>Net impact: {p.net_time_impact_s.toFixed(1)}s</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* Strategy Evaluation */}
          {activeSection === 'strategy' && report.strategy_evaluation && (
            <div className="analysis-section">
              <section className="pw-panel">
                <div className="pw-panel-header">
                  <span className="pw-panel-title">STRATEGY EVALUATION</span>
                  <span className={`pw-panel-badge ${report.strategy_evaluation.accuracy_pct >= 60 ? 'is-ok' : 'is-critical'}`}>
                    {report.strategy_evaluation.accuracy_pct}% ACCURACY
                  </span>
                </div>
                <div className="analysis-kpi-grid">
                  <div className="analysis-kpi">
                    <span className="analysis-kpi-label">TOTAL DECISIONS</span>
                    <span className="analysis-kpi-value">{report.strategy_evaluation.total_decisions}</span>
                  </div>
                  <div className="analysis-kpi">
                    <span className="analysis-kpi-label">PIT NOW CALLS</span>
                    <span className="analysis-kpi-value">{report.strategy_evaluation.pit_now_count}</span>
                  </div>
                  <div className="analysis-kpi">
                    <span className="analysis-kpi-label">STAY OUT CALLS</span>
                    <span className="analysis-kpi-value">{report.strategy_evaluation.stay_out_count}</span>
                  </div>
                  <div className="analysis-kpi">
                    <span className="analysis-kpi-label">CORRECT</span>
                    <span className="analysis-kpi-value is-ok">{report.strategy_evaluation.correct_decisions}</span>
                  </div>
                </div>
                <div className="strategy-verdict">
                  <div className="sub-header">VERDICT</div>
                  <p>{report.strategy_evaluation.overall_verdict}</p>
                </div>
                {report.strategy_evaluation.improvement_suggestions.length > 0 && (
                  <div className="strategy-suggestions">
                    <div className="sub-header">IMPROVEMENT SUGGESTIONS</div>
                    <ul>
                      {report.strategy_evaluation.improvement_suggestions.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}
                {report.strategy_evaluation.key_moments.length > 0 && (
                  <>
                    <div className="sub-header">KEY MOMENTS</div>
                    <div className="pace-table-wrap">
                      <table className="scenario-table">
                        <thead>
                          <tr><th>LAP</th><th>CALL</th><th>CONF</th><th>CORRECT</th></tr>
                        </thead>
                        <tbody>
                          {report.strategy_evaluation.key_moments.map((m, i) => (
                            <tr key={i}>
                              <td className="mono">{m.lap}</td>
                              <td>{m.action}</td>
                              <td>{m.confidence}</td>
                              <td className={m.was_correct ? 'is-ok' : 'is-critical'}>{m.was_correct ? '✓' : '✗'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            </div>
          )}

          {/* Fuel & ERS */}
          {activeSection === 'fuel_ers' && report.fuel_ers_pattern && (
            <div className="analysis-section">
              <section className="pw-panel">
                <div className="pw-panel-header">
                  <span className="pw-panel-title">FUEL & ERS PATTERNS</span>
                </div>
                <div className="analysis-kpi-grid">
                  <div className="analysis-kpi">
                    <span className="analysis-kpi-label">AVG FUEL/LAP</span>
                    <span className="analysis-kpi-value">{report.fuel_ers_pattern.avg_fuel_per_lap.toFixed(3)} kg</span>
                  </div>
                  <div className="analysis-kpi">
                    <span className="analysis-kpi-label">FUEL CRITICAL LAP</span>
                    <span className={`analysis-kpi-value ${report.fuel_ers_pattern.fuel_critical_lap ? 'is-critical' : 'is-ok'}`}>
                      {report.fuel_ers_pattern.fuel_critical_lap ?? 'N/A'}
                    </span>
                  </div>
                  <div className="analysis-kpi">
                    <span className="analysis-kpi-label">ERS EFFICIENCY</span>
                    <span className="analysis-kpi-value">{(report.fuel_ers_pattern.ers_deployment_efficiency * 100).toFixed(1)}%</span>
                  </div>
                </div>
                {/* Fuel consumption chart */}
                <div className="sub-header">FUEL CONSUMPTION PER LAP</div>
                <div className="fuel-chart">
                  {report.fuel_ers_pattern.fuel_consumption_per_lap.map((v, i) => {
                    const maxV = Math.max(...report.fuel_ers_pattern.fuel_consumption_per_lap, 0.01)
                    return (
                      <div key={i} className="fuel-bar-wrapper" title={`Lap ${i + 1}: ${v.toFixed(3)} kg`}>
                        <div className="fuel-bar" style={{ height: `${(v / maxV) * 100}%` }} />
                        <span className="fuel-bar-label">{i + 1}</span>
                      </div>
                    )
                  })}
                </div>
                {/* ERS levels */}
                <div className="sub-header">ERS LEVEL PER LAP</div>
                <div className="ers-chart">
                  {report.fuel_ers_pattern.ers_usage_histogram.map((v, i) => (
                    <div key={i} className="ers-bar-wrapper" title={`Lap ${i + 1}: ${(v * 100).toFixed(1)}%`}>
                      <div className="ers-bar" style={{ height: `${v * 100}%` }} />
                      <span className="ers-bar-label">{i + 1}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* Balance Trend */}
          {activeSection === 'balance' && (
            <div className="analysis-section">
              <section className="pw-panel">
                <div className="pw-panel-header">
                  <span className="pw-panel-title">VEHICLE BALANCE TREND</span>
                </div>
                {report.balance_trend.length === 0 ? (
                  <div className="empty-state">No balance data available.</div>
                ) : (
                  <div className="balance-trend-chart">
                    {report.balance_trend.map(b => (
                      <div key={b.lap} className="balance-col" title={`Lap ${b.lap}: US=${b.understeer_score.toFixed(2)} OS=${b.oversteer_score.toFixed(2)}`}>
                        <div className="balance-bar-stack">
                          <div className="balance-us-bar" style={{ height: `${b.understeer_score * 100}%` }} />
                          <div className="balance-os-bar" style={{ height: `${b.oversteer_score * 100}%` }} />
                        </div>
                        <span className={`balance-label ${b.dominant === 'understeer' ? 'is-warn' : b.dominant === 'oversteer' ? 'is-critical' : ''}`}>
                          {b.lap}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="balance-legend">
                  <span className="legend-item"><span className="legend-dot us" /> Understeer</span>
                  <span className="legend-item"><span className="legend-dot os" /> Oversteer</span>
                </div>
              </section>
            </div>
          )}

          {/* Timeline */}
          {activeSection === 'timeline' && (
            <div className="analysis-section">
              <section className="pw-panel">
                <div className="pw-panel-header">
                  <span className="pw-panel-title">RACE TIMELINE</span>
                </div>
                {report.timeline_events.length === 0 ? (
                  <div className="empty-state">No timeline events.</div>
                ) : (
                  <div className="timeline">
                    {report.timeline_events.map((e, i) => (
                      <div key={i} className={`timeline-item type-${e.type}`}>
                        <span className="timeline-lap">LAP {e.lap}</span>
                        <span className="timeline-type">{e.type.replace('_', ' ').toUpperCase()}</span>
                        <span className="timeline-detail">{e.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
