import { useEffect, useState } from 'react'
import { joinRoom, type RoomRole } from '../lib/multiplayerSession'
import { RELAY_API_BASE } from '../lib/env'

type Props = {
  isOpen: boolean
  onClose: () => void
  sessionKey?: string
  trackKey?: string
  onConnectionApplied?: () => void
}

type Settings = {
  locale: 'ko' | 'en'
  cadenceFast: number
  cadenceMedium: number
  wsUrl: string
  theme: 'dark' | 'engineering'
  showMinimap: boolean
  showBottomBar: boolean
  soundEnabled: boolean
  roomId: string
  clientId: string
  roomRole: RoomRole
  roomAuthToken: string
  roomAuthExpiresAt: number
}

const DEFAULTS: Settings = {
  locale: 'ko',
  cadenceFast: 100,
  cadenceMedium: 400,
  wsUrl: '',
  theme: 'dark',
  showMinimap: true,
  showBottomBar: true,
  soundEnabled: false,
  roomId: '',
  clientId: '',
  roomRole: 'engineer',
  roomAuthToken: '',
  roomAuthExpiresAt: 0,
}

type JoinStatus = 'idle' | 'joining' | 'success' | 'error'

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function wsToHttpBase(wsLike: string): string {
  try {
    const parsed = new URL(wsLike)
    const protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:'
    return `${protocol}//${parsed.host}`
  } catch {
    return ''
  }
}

function getRelayApiCandidates(wsOverride: string): string[] {
  const host = window.location.host
  const hostname = window.location.hostname
  const fromWs = wsToHttpBase(wsOverride)
  return uniqueStrings([
    RELAY_API_BASE,
    fromWs,
    `${window.location.protocol}//${host}`,
    `${window.location.protocol}//${hostname}:8080`,
    `${window.location.protocol}//${hostname}:8765`,
    `${window.location.protocol}//127.0.0.1:8080`,
    `${window.location.protocol}//127.0.0.1:8765`,
  ])
}

function profileStorageKeys(sessionKey: string, trackKey: string): string[] {
  const normalizedSession = sessionKey || 'global'
  const normalizedTrack = trackKey || 'all'
  return [
    `pitwall:settings:${normalizedSession}:${normalizedTrack}`,
    `pitwall:settings:${normalizedSession}:all`,
    'pitwall:settings',
  ]
}

function loadSettings(sessionKey: string, trackKey: string): Settings {
  try {
    const keys = profileStorageKeys(sessionKey, trackKey)
    for (const key of keys) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      return { ...DEFAULTS, ...JSON.parse(raw) }
    }
  } catch { /* ignore */ }
  return { ...DEFAULTS }
}

function saveSettings(s: Settings, sessionKey: string, trackKey: string) {
  try {
    const keys = profileStorageKeys(sessionKey, trackKey)
    localStorage.setItem(keys[0], JSON.stringify(s))
  } catch { /* ignore */ }
}

export function SettingsModal({
  isOpen,
  onClose,
  sessionKey = 'global',
  trackKey = 'all',
  onConnectionApplied,
}: Props) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings(sessionKey, trackKey))
  const [roomPassword, setRoomPassword] = useState('')
  const [joinStatus, setJoinStatus] = useState<JoinStatus>('idle')
  const [joinMessage, setJoinMessage] = useState('')

  useEffect(() => {
    if (isOpen) {
      setSettings(loadSettings(sessionKey, trackKey))
      setRoomPassword('')
      setJoinStatus('idle')
      setJoinMessage('')
    }
  }, [isOpen, sessionKey, trackKey])

  if (!isOpen) return null

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    const roomId = settings.roomId.trim()
    const clientId = settings.clientId.trim()

    if (!roomId) {
      saveSettings({ ...settings, roomAuthToken: '', roomAuthExpiresAt: 0 }, sessionKey, trackKey)
      onConnectionApplied?.()
      onClose()
      return
    }

    if (!clientId) {
      setJoinStatus('error')
      setJoinMessage('Client ID를 입력해 주세요.')
      return
    }

    if (!roomPassword && !settings.roomAuthToken) {
      setJoinStatus('error')
      setJoinMessage('Room Password 또는 기존 인증 토큰이 필요합니다.')
      return
    }

    if (!roomPassword && settings.roomAuthToken) {
      saveSettings({ ...settings, roomId, clientId }, sessionKey, trackKey)
      setJoinStatus('success')
      setJoinMessage('기존 인증 토큰으로 연결을 재적용합니다.')
      onConnectionApplied?.()
      onClose()
      return
    }

    setJoinStatus('joining')
    setJoinMessage('방에 입장 중입니다...')

    const role: RoomRole = 'engineer'
    const apiCandidates = getRelayApiCandidates(settings.wsUrl)
    let lastError = '방 입장에 실패했습니다.'

    for (const apiBase of apiCandidates) {
      try {
        const joined = await joinRoom(apiBase, {
          roomId,
          password: roomPassword,
          role,
          clientId,
        })

        const nextSettings: Settings = {
          ...settings,
          roomId: joined.roomId,
          clientId: joined.clientId,
          roomRole: joined.role,
          roomAuthToken: joined.authToken,
          roomAuthExpiresAt: Date.now() + joined.expiresInMs,
        }

        saveSettings(nextSettings, sessionKey, trackKey)
        setJoinStatus('success')
        setJoinMessage('방 입장 성공. 연결을 재시작합니다.')
        onConnectionApplied?.()
        onClose()
        return
      } catch (error) {
        lastError = String(error instanceof Error ? error.message : error)
      }
    }

    setJoinStatus('error')
    if (lastError.includes('room not found')) {
      setJoinMessage('해당 Room ID를 찾을 수 없습니다.')
    } else if (lastError.includes('invalid room password')) {
      setJoinMessage('Room Password가 올바르지 않습니다.')
    } else if (lastError.includes('rate limit')) {
      setJoinMessage('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.')
    } else {
      setJoinMessage('방 입장에 실패했습니다. 네트워크 상태를 확인해 주세요.')
    }
  }

  const handleReset = () => {
    const reset = { ...DEFAULTS }
    setSettings(reset)
    saveSettings(reset, sessionKey, trackKey)
  }

  const handleSelect = (key: 'locale' | 'theme') => (e: { target: { value: string } }) => {
    update(key, e.target.value as Settings[typeof key])
  }
  const handleCheck = (key: 'showMinimap' | 'showBottomBar' | 'soundEnabled') => (e: { target: { checked: boolean } }) => {
    update(key, e.target.checked)
  }
  const handleNumber = (key: 'cadenceFast' | 'cadenceMedium', fallback: number) => (e: { target: { value: string } }) => {
    update(key, parseInt(e.target.value, 10) || fallback)
  }
  const handleText = (key: 'wsUrl' | 'roomId' | 'clientId') => (e: { target: { value: string } }) => {
    update(key, e.target.value)
  }

  return (
    <div className="settings-overlay" onClick={(e: { target: EventTarget; currentTarget: EventTarget }) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="settings-modal">
        <div className="settings-header">
          <span className="settings-title">SETTINGS</span>
          <button type="button" className="settings-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          {/* Display */}
          <section className="settings-section">
            <h3 className="settings-section-title">DISPLAY</h3>
            <div className="settings-row">
              <label className="settings-label">Language / 언어</label>
              <select className="settings-select" value={settings.locale} onChange={handleSelect('locale')}>
                <option value="ko">한국어</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="settings-row">
              <label className="settings-label">Theme</label>
              <select className="settings-select" value={settings.theme} onChange={handleSelect('theme')}>
                <option value="dark">Dark</option>
                <option value="engineering">Engineering</option>
              </select>
            </div>
            <div className="settings-row">
              <label className="settings-label">Show Minimap</label>
              <input className="settings-checkbox" type="checkbox" checked={settings.showMinimap} onChange={handleCheck('showMinimap')} />
            </div>
            <div className="settings-row">
              <label className="settings-label">Show Bottom Bar</label>
              <input className="settings-checkbox" type="checkbox" checked={settings.showBottomBar} onChange={handleCheck('showBottomBar')} />
            </div>
          </section>

          {/* Performance */}
          <section className="settings-section">
            <h3 className="settings-section-title">PERFORMANCE</h3>
            <div className="settings-row">
              <label className="settings-label">Fast Cadence (ms)</label>
              <input className="settings-input" type="number" min={50} max={500} step={50} value={settings.cadenceFast} onChange={handleNumber('cadenceFast', 100)} />
            </div>
            <div className="settings-row">
              <label className="settings-label">Medium Cadence (ms)</label>
              <input className="settings-input" type="number" min={100} max={2000} step={100} value={settings.cadenceMedium} onChange={handleNumber('cadenceMedium', 400)} />
            </div>
          </section>

          {/* Connection */}
          <section className="settings-section">
            <h3 className="settings-section-title">CONNECTION</h3>
            <div className="settings-row">
              <label className="settings-label">WebSocket URL (override)</label>
              <input className="settings-input settings-input-wide" type="text" placeholder="ws://localhost:8765/ws" value={settings.wsUrl} onChange={handleText('wsUrl')} />
            </div>
            <div className="settings-row">
              <label className="settings-label">Room ID</label>
              <input className="settings-input settings-input-wide" type="text" placeholder="public" value={settings.roomId} onChange={handleText('roomId')} />
            </div>
            <div className="settings-row">
              <label className="settings-label">Room Password</label>
              <input className="settings-input settings-input-wide" type="password" placeholder="Enter room password" value={roomPassword} onChange={(e: { target: { value: string } }) => setRoomPassword(e.target.value)} />
            </div>
            <div className="settings-row">
              <label className="settings-label">Client ID</label>
              <input className="settings-input settings-input-wide" type="text" placeholder="engineer-alpha" value={settings.clientId} onChange={handleText('clientId')} />
            </div>
            <div className="settings-row">
              <label className="settings-label">Role</label>
              <input className="settings-input" type="text" value="engineer" disabled />
            </div>
            <div className="settings-row">
              <label className="settings-label">Sound Notifications</label>
              <input className="settings-checkbox" type="checkbox" checked={settings.soundEnabled} onChange={handleCheck('soundEnabled')} />
            </div>
            {joinStatus !== 'idle' && (
              <div className={`settings-status settings-status-${joinStatus}`}>
                {joinMessage}
              </div>
            )}
          </section>
        </div>

        <div className="settings-footer">
          <button type="button" className="settings-btn settings-btn-reset" onClick={handleReset} disabled={joinStatus === 'joining'}>RESET</button>
          <button type="button" className="settings-btn settings-btn-cancel" onClick={onClose}>CANCEL</button>
          <button type="button" className="settings-btn settings-btn-save" onClick={handleSave} disabled={joinStatus === 'joining'}>
            {joinStatus === 'joining' ? 'JOINING...' : 'SAVE'}
          </button>
        </div>
      </div>
    </div>
  )
}
