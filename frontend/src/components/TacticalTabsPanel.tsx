import { useEffect, useMemo, useState } from 'react'
import { AppState } from '../lib/types'
import { TyreHistory } from '../lib/tyreHistoryManager'
import { StrategyHealthPanel } from './StrategyHealthPanel'
import { TyreStrategyPanel } from './TyreStrategyPanel'

type Locale = 'ko' | 'en'
type Tab = 'tyre' | 'strategy'

type Props = {
  state: AppState | null
  locale: Locale
  history: TyreHistory
}

export function TacticalTabsPanel({ state, locale, history }: Props) {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const raw = window.localStorage.getItem('pitwall:tactical-tab')
      return raw === 'strategy' ? 'strategy' : 'tyre'
    } catch {
      return 'tyre'
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem('pitwall:tactical-tab', tab)
    } catch {
      // Ignore persistence issues.
    }
  }, [tab])

  const labels = useMemo(
    () =>
      locale === 'ko'
        ? {
            title: '전술 워크스테이션',
            tyre: '타이어',
            strategy: '전략',
            subtitle: 'TYRE / STRATEGY',
          }
        : {
            title: 'Tactical Workstation',
            tyre: 'TYRE',
            strategy: 'STRATEGY',
            subtitle: 'Tyre / Strategy',
          },
    [locale],
  )

  const tyreTabId = 'tactical-tab-tyre'
  const strategyTabId = 'tactical-tab-strategy'
  const panelId = tab === 'tyre' ? 'tactical-panel-tyre' : 'tactical-panel-strategy'

  return (
    <section className="panel tactical-tabs-panel">
      <div className="panel-header">
        <h3>{labels.title}</h3>
        <div className="small">{labels.subtitle}</div>
      </div>

      <div className="tactical-tabs" role="tablist" aria-label="Tactical tabs">
        <button
          id={tyreTabId}
          className={`gap-mode-btn ${tab === 'tyre' ? 'is-active' : ''}`}
          type="button"
          onClick={() => setTab('tyre')}
          role="tab"
          aria-selected={tab === 'tyre'}
          aria-controls="tactical-panel-tyre"
          tabIndex={tab === 'tyre' ? 0 : -1}
        >
          {labels.tyre}
        </button>
        <button
          id={strategyTabId}
          className={`gap-mode-btn ${tab === 'strategy' ? 'is-active' : ''}`}
          type="button"
          onClick={() => setTab('strategy')}
          role="tab"
          aria-selected={tab === 'strategy'}
          aria-controls="tactical-panel-strategy"
          tabIndex={tab === 'strategy' ? 0 : -1}
        >
          {labels.strategy}
        </button>
      </div>

      <div className="tactical-tab-body" role="tabpanel" id={panelId} aria-labelledby={tab === 'tyre' ? tyreTabId : strategyTabId}>
        {tab === 'tyre' ? <TyreStrategyPanel state={state} locale={locale} history={history} /> : null}
        {tab === 'strategy' ? <StrategyHealthPanel state={state} /> : null}
      </div>
    </section>
  )
}
