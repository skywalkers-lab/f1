import { memo } from 'react'

export type SidebarId = 'strategy' | 'live' | 'timing' | 'track' | 'weather' | 'radio' | 'system'

const SIDEBAR_ITEMS: { id: SidebarId; icon: string; label: string }[] = [
  { id: 'strategy', icon: '📋', label: 'STRAT' },
  { id: 'live', icon: '🏁', label: 'GP LIVE' },
  { id: 'timing', icon: '📊', label: 'TIMING' },
  { id: 'track', icon: '🛣️', label: 'TRACK' },
  { id: 'weather', icon: '⛅', label: 'WEATHER' },
  { id: 'radio', icon: '📻', label: 'RADIO' },
  { id: 'system', icon: '⚙️', label: 'SYSTEM' },
]

type Props = {
  activeId: SidebarId
  onSelect: (id: SidebarId) => void
}

export const SidebarNav = memo(function SidebarNav({ activeId, onSelect }: Props) {
  return (
    <nav className="left-sidebar">
      {SIDEBAR_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`sidebar-btn ${item.id === activeId ? 'is-active' : ''}`}
          onClick={() => onSelect(item.id)}
        >
          <span className="sidebar-icon">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  )
})
