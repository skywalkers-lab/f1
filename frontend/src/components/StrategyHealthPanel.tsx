import { useEffect, useMemo, useState } from 'react'
import { AppState } from '../lib/types'
import { formatConfidence, formatRaceControl, formatStrategyAction, formatStrategyKey, formatTyreCompound, formatWeatherState } from '../lib/f1Terms'
import { postStrategyFeedback } from '../lib/ws'
import { FeedbackCause, StrategyFeedbackRecord, useStrategyHealthAnalysis } from '../hooks/useStrategyHealthAnalysis'

type Props = { state: AppState | null }

export function StrategyHealthPanel({ state }: Props) {
  const [feedbackStatus, setFeedbackStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const [feedbackHistory, setFeedbackHistory] = useState<StrategyFeedbackRecord[]>([])
  const [actualDeltaMs, setActualDeltaMs] = useState<number>(0)
  const [feedbackCause, setFeedbackCause] = useState<FeedbackCause>('execution')
  const strategy = state?.strategy
  const analysis = useStrategyHealthAnalysis(state, feedbackHistory)
  const confidenceClass =
    analysis.confidenceIndex.tone === 'ok' || strategy?.confidence === 'high'
      ? 'is-high'
      : analysis.confidenceIndex.tone === 'watch' || strategy?.confidence === 'medium'
        ? 'is-medium'
        : 'is-low'

  const keyInputOrder = [
    'laps_remaining',
    'tyre_age',
    'fuel_remaining_kg',
    'traffic_density',
    'pit_loss_est_s',
    'sc_vsc_status',
    'weather_state',
  ]

  const keyInputEntries = keyInputOrder
    .filter((k) => strategy?.key_inputs?.[k] !== undefined)
    .map((k) => [k, strategy?.key_inputs?.[k]])

  const context = useMemo(() => {
    if (!state) return null
    return {
      sessionType: state.session_type,
      weather: state.weather_state,
      track: state.track,
      action: strategy?.action,
      score: strategy?.score,
      playerPosition: state.player.position,
      lap: state.player.lap,
      tyre: state.player.tyre_compound,
      fuel: state.player.fuel,
      ers: state.player.ers,
      keyInputs: strategy?.key_inputs ?? {},
    }
  }, [state, strategy?.action, strategy?.score, strategy?.key_inputs])

  useEffect(() => {
    if (feedbackStatus === 'idle' || feedbackStatus === 'sending') return
    const timer = window.setTimeout(() => setFeedbackStatus('idle'), 2200)
    return () => window.clearTimeout(timer)
  }, [feedbackStatus])

  async function sendFeedback(reward: number) {
    if (!strategy?.action) return
    setFeedbackStatus('sending')
    const expected = analysis.feedbackReadiness.expectedDeltaMs
    const actual = Number.isFinite(actualDeltaMs) ? actualDeltaMs : 0
    const nextRecord: StrategyFeedbackRecord = {
      id: `${Date.now()}-${reward}`,
      timestamp: Date.now(),
      action: strategy.action,
      reward,
      expectedDeltaMs: expected,
      actualDeltaMs: actual,
      cause: feedbackCause,
    }

    const ok = await postStrategyFeedback({
      action: strategy.action,
      reward,
      context: {
        ...(context ?? {}),
        expectedDeltaMs: expected,
        actualDeltaMs: actual,
        deltaErrorMs: actual - expected,
        failureCause: feedbackCause,
      },
    })
    if (ok) {
      setFeedbackHistory((prev) => [...prev.slice(-19), nextRecord])
    }
    setFeedbackStatus(ok ? 'ok' : 'error')
  }

  function renderKeyValue(key: string, value: string | number | undefined): string {
    if (value === undefined) return '-'
    if (key === 'pit_window_status') return value === 'OPEN' ? '오픈' : '클로즈'
    if (key === 'sc_vsc_status') return formatRaceControl(String(value))
    if (key === 'weather_state') return formatWeatherState(String(value))
    if (key === 'tyre_compound') return formatTyreCompound(String(value))
    return String(value)
  }

  if (!strategy) {
    return (
      <section className="panel strategy-health-panel">
        <div className="panel-header">
          <h3>전략 & 상태</h3>
          <div className="small">추천 모델 입력 대기</div>
        </div>
        <div className="panel-empty-state">현재 세션 데이터가 충분하지 않아 전략 후보를 아직 계산하지 못했습니다.</div>
      </section>
    )
  }

  return (
    <section className="panel strategy-health-panel">
      <div className="panel-header">
        <h3>
          전략 & 상태 <span className="badge-est">EST</span>
        </h3>
        <div className={`confidence-pill ${confidenceClass}`}>신뢰도: {formatConfidence(strategy?.confidence ?? 'low')}</div>
      </div>

      <div className={`strategy-health-alert is-${analysis.alerts.tone}`}>
        <strong>검증 알림</strong>
        <span>{analysis.alerts.message}</span>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 8 }}>
        <div className="kpi">
          <div className="label">액션 EST</div>
          <div className="value">{formatStrategyAction(strategy?.action ?? 'STAY_OUT')}</div>
        </div>
        <div className="kpi">
          <div className="label">점수 EST</div>
          <div className="value">{analysis.scorePct}%</div>
        </div>
        <div className="kpi">
          <div className="label">피트 손실 EST</div>
          <div className="value">{String(strategy?.key_inputs?.pit_loss_est_s ?? '-')}s</div>
        </div>
      </div>

      <div className="kpi" style={{ marginBottom: 8 }}>
        <div className="label">판단 격차</div>
        <div className="value" style={{ fontSize: 13 }}>{analysis.strategyGap.toFixed(3)}</div>
        <div className={`small strategy-stability is-${analysis.strategyStability.tone}`}>{analysis.strategyStability.label}</div>
      </div>

      <div className="kpi" style={{ marginBottom: 8 }}>
        <div className="label">신뢰도 분해</div>
        <div className="strategy-health-breakdown">
          {analysis.confidenceBreakdown.map((factor) => (
            <div key={factor.key} className={`strategy-health-factor is-${factor.tone}`}>
              <div className="factor-head">
                <span>{factor.label}</span>
                <strong>{factor.score.toFixed(0)}</strong>
              </div>
              <div className="candidate-bar-track" aria-label={`${factor.label} score`}>
                <span className="candidate-bar-fill" style={{ width: `${Math.max(6, Math.min(100, factor.score))}%` }} />
              </div>
              <div className="small">{factor.detail}</div>
            </div>
          ))}
        </div>
        <div className={`small strategy-confidence-index is-${analysis.confidenceIndex.tone}`}>
          종합: {analysis.confidenceIndex.score} / 100 ({analysis.confidenceIndex.label})
        </div>
      </div>

      <div className="strategy-inputs" style={{ marginBottom: 8 }}>
        {keyInputEntries.map(([key, value]) => (
          <span className="chip" key={String(key)}>
            {formatStrategyKey(String(key))}: {renderKeyValue(String(key), value as string | number | undefined)}
          </span>
        ))}
      </div>

      <div className="small" style={{ marginBottom: 8 }}>
        <span className="health-dot" style={{ background: '#5cff95' }} />DRS
        <span className="health-dot" style={{ background: '#5cff95', marginLeft: 10 }} />ERS
        <span className="health-dot" style={{ background: '#ffce52', marginLeft: 10 }} />Aero
        <span className="health-dot" style={{ background: '#5cff95', marginLeft: 10 }} />Powertrain
      </div>

      <div className="kpi" style={{ marginBottom: 8 }}>
        <div className="label">입력 기여도</div>
        <div className="strategy-health-breakdown">
          {analysis.inputContributions.slice(0, 5).map((item) => (
            <div key={item.key} className="strategy-health-factor is-watch">
              <div className="factor-head">
                <span>{formatStrategyKey(item.label)}</span>
                <strong>{item.impactScore.toFixed(0)}</strong>
              </div>
              <div className="candidate-bar-track" aria-label={`${item.label} contribution`}>
                <span className="candidate-bar-fill" style={{ width: `${Math.max(6, Math.min(100, item.impactScore))}%` }} />
              </div>
              <div className="small">
                값 {renderKeyValue(item.label, item.rawValue)} / {item.impactText}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="kpi" style={{ marginBottom: 8 }}>
        <div className="label">추천 근거 재구성</div>
        <div className="reason-list">
          {analysis.causalReasons.map((reason) => (
            <div className={`reason-line strategy-causal-line is-${reason.tone}`} key={reason.id}>
              원인: {reason.cause} | 영향: {reason.impact} | 결론: {reason.conclusion}
            </div>
          ))}
        </div>
      </div>

      <div className="kpi" style={{ marginBottom: 8 }}>
        <div className="label">전략 피드백 루프</div>
        <div className={`small strategy-feedback-ready ${analysis.feedbackReadiness.ready ? 'is-ready' : ''}`}>
          {analysis.feedbackReadiness.trigger} | 권장 액션: {formatStrategyAction(analysis.feedbackReadiness.recommendedAction)} | 기대 변화:{' '}
          {analysis.feedbackReadiness.expectedDeltaMs >= 0 ? '+' : ''}
          {(analysis.feedbackReadiness.expectedDeltaMs / 1000).toFixed(3)}s
        </div>
        <div className="strategy-feedback-form">
          <label>
            실제 변화(ms)
            <input
              type="number"
              value={actualDeltaMs}
              onChange={(e: { target: { value: string } }) => setActualDeltaMs(Number(e.target.value))}
              className="strategy-feedback-input"
            />
          </label>
          <label>
            실패 원인
            <select value={feedbackCause} onChange={(e: { target: { value: string } }) => setFeedbackCause(e.target.value as FeedbackCause)} className="strategy-feedback-input">
              <option value="execution">실행 지연</option>
              <option value="traffic">트래픽/혼잡</option>
              <option value="tyre">타이어 열화</option>
              <option value="timing">타이밍 미스</option>
              <option value="weather">기상 변동</option>
              <option value="other">기타</option>
            </select>
          </label>
        </div>
        <div className="strategy-feedback-row">
          <button type="button" className="gap-mode-btn" onClick={() => sendFeedback(1)} disabled={feedbackStatus === 'sending'}>
            추천 적중 (+1)
          </button>
          <button type="button" className="gap-mode-btn" onClick={() => sendFeedback(0)} disabled={feedbackStatus === 'sending'}>
            보통 (0)
          </button>
          <button type="button" className="gap-mode-btn" onClick={() => sendFeedback(-1)} disabled={feedbackStatus === 'sending'}>
            추천 실패 (-1)
          </button>
        </div>
        <div className="small">
          상태:{' '}
          {feedbackStatus === 'sending'
            ? '전송 중'
            : feedbackStatus === 'ok'
              ? '전송 완료'
              : feedbackStatus === 'error'
                ? '전송 실패'
                : '대기'}
        </div>
        <div className={`small strategy-feedback-trend is-${analysis.feedbackTrend.tone}`}>
          최근 {analysis.feedbackTrend.sampleCount}건 | 성공률 {analysis.feedbackTrend.successRatePct}% | 오차 평균 {analysis.feedbackTrend.avgErrorText} | {analysis.feedbackTrend.trendLabel}
        </div>
      </div>

      <div className={`small strategy-conditional-callout ${analysis.conditionalDecision.enabled ? 'is-on' : ''}`}>
        {analysis.conditionalDecision.message}
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>순위</th>
            <th>후보 액션</th>
            <th>예상 이득</th>
            <th>리스크</th>
            <th>다운사이드</th>
            <th>강도</th>
            <th>근거</th>
          </tr>
        </thead>
        <tbody>
          {analysis.candidateInsights.map((c, idx) => (
            <tr key={c.action} className={`${idx === 0 ? 'candidate-best' : ''} ${c.isConditional ? 'candidate-conditional' : ''}`}>
              <td>#{idx + 1}</td>
              <td>{formatStrategyAction(c.action)}</td>
              <td className={c.expectedGainMs >= 0 ? 'gap-positive' : 'gap-negative'}>{c.expectedGainText}</td>
              <td className={`strategy-risk-cell is-${c.risk}`}>{c.risk.toUpperCase()}</td>
              <td className={c.downsideMs >= 0 ? 'gap-positive' : 'gap-negative'}>{c.downsideText}</td>
              <td>
                <div className="candidate-bar-track" aria-label={`${c.action} score intensity`}>
                  <span className="candidate-bar-fill" style={{ width: `${Math.max(6, Math.min(100, c.intensityPct))}%` }} />
                </div>
              </td>
              <td>{c.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
