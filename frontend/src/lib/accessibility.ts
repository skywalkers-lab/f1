// #46 — Accessibility pass for high-density dashboard controls
// Provides utilities for ARIA attributes, keyboard navigation,
// focus management, and screen-reader friendly labels.

/**
 * Generate ARIA props for a live-updating telemetry value.
 */
export function telemetryLiveRegion(label: string, value: string | number, polite = true) {
  return {
    role: 'status' as const,
    'aria-label': `${label}: ${value}`,
    'aria-live': (polite ? 'polite' : 'assertive') as 'polite' | 'assertive',
    'aria-atomic': true,
  }
}

/**
 * ARIA props for a panel section header.
 */
export function panelHeading(title: string, level: 2 | 3 | 4 = 2) {
  return {
    role: 'heading' as const,
    'aria-level': level,
    'aria-label': title,
  }
}

/**
 * ARIA props for the leaderboard table.
 */
export function leaderboardTable() {
  return {
    role: 'table' as const,
    'aria-label': 'Race Leaderboard',
    'aria-description': 'Live race positions, gaps, and driver information',
  }
}

/**
 * ARIA props for a clickable lap cell in replay.
 */
export function lapCellButton(lap: number, isSelected: boolean, isBest: boolean) {
  return {
    role: 'button' as const,
    'aria-label': `Lap ${lap}${isBest ? ', session best' : ''}`,
    'aria-pressed': isSelected,
    tabIndex: 0,
  }
}

/**
 * Keyboard navigation handler for grid-like layouts (lap grid, leaderboard).
 * Returns the new focused index based on arrow key input.
 */
export function gridKeyboardNav(
  e: { key: string; preventDefault: () => void },
  currentIndex: number,
  totalItems: number,
  columns: number,
): number | null {
  let next: number | null = null
  switch (e.key) {
    case 'ArrowRight':
      next = Math.min(totalItems - 1, currentIndex + 1)
      break
    case 'ArrowLeft':
      next = Math.max(0, currentIndex - 1)
      break
    case 'ArrowDown':
      next = Math.min(totalItems - 1, currentIndex + columns)
      break
    case 'ArrowUp':
      next = Math.max(0, currentIndex - columns)
      break
    default:
      return null
  }
  e.preventDefault()
  return next
}

/**
 * Generate skip-navigation link props for dashboard sections.
 */
export function skipNavLink(targetId: string, label: string) {
  return {
    href: `#${targetId}`,
    className: 'sr-only focus:not-sr-only',
    children: label,
  }
}

/**
 * Section landmark IDs for skip navigation.
 */
export const LANDMARKS = {
  leaderboard: 'pw-leaderboard',
  strategy: 'pw-strategy',
  telemetry: 'pw-telemetry',
  minimap: 'pw-minimap',
  raceControl: 'pw-race-control',
  replay: 'pw-replay',
  settings: 'pw-settings',
} as const

/**
 * CSS class utility for visually hidden but screen-reader accessible.
 */
export const SR_ONLY_STYLE: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  borderWidth: 0,
}

/**
 * High-contrast color pairs for accessibility.
 */
export const A11Y_COLORS = {
  ok: { fg: '#00ff88', bg: '#0a2a1a' },
  warn: { fg: '#ffaa00', bg: '#2a2000' },
  critical: { fg: '#ff4444', bg: '#2a0a0a' },
  info: { fg: '#44aaff', bg: '#0a1a2a' },
  muted: { fg: '#888888', bg: '#1a1a1a' },
} as const
