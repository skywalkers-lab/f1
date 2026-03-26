import { memo, useMemo } from 'react'
import { AppState } from '../lib/types'

type Props = { state: AppState | null; wsConnected: boolean }

interface UdpStats {
  packetsReceived: number
  packetsDropped: number
  decodeErrors: number
  isConnected: boolean
  timeSinceLastPacket: number | null
  connectionUptime: number | null
}

type BridgeStats = {
  messagesPublished?: number
  messagesFailed?: number
  reconnectCount?: number
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round((bytes / Math.pow(k, i)) * 10) / 10 + ' ' + sizes[i]
}

function formatUptime(ms: number | null): string {
  if (ms === null) return '-'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

function getPacketLossPercentage(received: number, dropped: number): string {
  if (received === 0) return '-'
  const total = received + dropped
  const percentage = (dropped / total) * 100
  return percentage.toFixed(2)
}

function getConnectionStatus(udpStats: UdpStats | null, wsConnected: boolean): { label: string; color: string } {
  const udpConnected = udpStats?.isConnected ?? false
  const wsStatus = wsConnected ? 'connected' : 'disconnected'
  const udpStatus = udpConnected ? 'connected' : 'disconnected'

  if (udpConnected && wsConnected) {
    return { label: '정상', color: '#38a169' }
  } else if (udpConnected || wsConnected) {
    return { label: '부분', color: '#d69e2e' }
  }
  return { label: '끊김', color: '#e53e3e' }
}

export const NetworkStatusPanel = memo(function NetworkStatusPanel({ state, wsConnected }: Props) {
  const udpStats = useMemo(() => {
    return state?.udp_stats
  }, [state])

  const bridgeStats = useMemo(() => {
    return state?.bridge_stats as BridgeStats | undefined
  }, [state])

  const connectionStatus = getConnectionStatus(udpStats ?? null, wsConnected)
  const packetLossRate = udpStats ? getPacketLossPercentage(udpStats.packetsReceived, udpStats.packetsDropped) : '-'

  return (
    <div className="panel telemetry-frame" style={{ padding: '12px', fontSize: '11px', fontFamily: 'monospace' }}>
      <div style={{ marginBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '6px' }}>네트워크 상태</div>

        {/* Connection Status Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '8px' }}>
          <div>
            <div style={{ color: '#888' }}>전체 연결</div>
            <div style={{ color: connectionStatus.color, fontWeight: 'bold' }}>{connectionStatus.label}</div>
          </div>
          <div>
            <div style={{ color: '#888' }}>UDP 상태</div>
            <div style={{ color: udpStats?.isConnected ? '#38a169' : '#e53e3e' }}>
              {udpStats?.isConnected ? '연결됨' : '끊김'}
            </div>
          </div>
          <div>
            <div style={{ color: '#888' }}>WS 상태</div>
            <div style={{ color: wsConnected ? '#38a169' : '#e53e3e' }}>
              {wsConnected ? '연결됨' : '끊김'}
            </div>
          </div>
          <div>
            <div style={{ color: '#888' }}>손실률</div>
            <div>{packetLossRate}%</div>
          </div>
        </div>

        {/* UDP Statistics */}
        {udpStats && (
          <div style={{ fontSize: '10px', marginBottom: '8px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              <div>
                <div style={{ color: '#888' }}>수신함</div>
                <div>{udpStats.packetsReceived.toLocaleString()}</div>
              </div>
              <div>
                <div style={{ color: '#888' }}>손실</div>
                <div style={{ color: udpStats.packetsDropped > 0 ? '#d69e2e' : '#888' }}>
                  {udpStats.packetsDropped.toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ color: '#888' }}>에러</div>
                <div style={{ color: udpStats.decodeErrors > 0 ? '#d69e2e' : '#888' }}>
                  {udpStats.decodeErrors.toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ color: '#888' }}>마지막</div>
                <div>{udpStats.timeSinceLastPacket ?? 0 < 1000 ? '방금' : `${Math.ceil((udpStats.timeSinceLastPacket ?? 0) / 1000)}s`}</div>
              </div>
              <div>
                <div style={{ color: '#888' }}>연결 시간</div>
                <div>{formatUptime(udpStats.connectionUptime)}</div>
              </div>
              <div>
                <div style={{ color: '#888' }}>총 데이터</div>
                <div>{formatBytes(udpStats.packetsReceived * 1200)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Bridge Statistics */}
        {bridgeStats && (
          <div style={{ fontSize: '10px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '6px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              <div>
                <div style={{ color: '#888' }}>발행됨</div>
                <div>{(bridgeStats.messagesPublished || 0).toLocaleString()}</div>
              </div>
              <div>
                <div style={{ color: '#888' }}>실패</div>
                <div style={{ color: (bridgeStats.messagesFailed || 0) > 0 ? '#d69e2e' : '#888' }}>
                  {(bridgeStats.messagesFailed || 0).toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ color: '#888' }}>재연결</div>
                <div>{(bridgeStats.reconnectCount || 0).toLocaleString()}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Performance Indicators */}
      <div style={{ fontSize: '10px' }}>
        <div style={{ fontWeight: 'bold', fontSize: '11px', marginBottom: '4px', color: '#888' }}>네트워크 통계</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <div>
            <div style={{ color: '#888' }}>수신 속도</div>
            <div>{udpStats ? `${udpStats.packetsReceived > 0 ? Math.round(udpStats.packetsReceived / ((udpStats.connectionUptime || 1) / 1000)) : 0} p/s` : '-'}</div>
          </div>
          <div>
            <div style={{ color: '#888' }}>피드 건강도</div>
            <div>{packetLossRate === '-' ? '-' : `${(100 - Number(packetLossRate)).toFixed(1)}%`}</div>
          </div>
        </div>
      </div>

      {/* Feed Health from stabilizer */}
      {state?.feed_health && (
        <div style={{ fontSize: '10px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '6px', marginTop: '8px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '11px', marginBottom: '4px', color: '#888' }}>피드 안정성 (Stabilizer)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
            <div>
              <div style={{ color: '#888' }}>종합 점수</div>
              <div style={{ color: state.feed_health.composite_score >= 80 ? '#38a169' : state.feed_health.composite_score >= 50 ? '#d69e2e' : '#e53e3e', fontWeight: 'bold' }}>
                {state.feed_health.composite_score.toFixed(0)} ({state.feed_health.quality_label})
              </div>
            </div>
            <div>
              <div style={{ color: '#888' }}>패킷 손실</div>
              <div>{state.feed_health.packet_loss_pct.toFixed(1)}%</div>
            </div>
            <div>
              <div style={{ color: '#888' }}>지터</div>
              <div>{state.feed_health.avg_jitter_ms.toFixed(1)}ms</div>
            </div>
            <div>
              <div style={{ color: '#888' }}>순서 이탈</div>
              <div>{state.feed_health.out_of_order_pct.toFixed(1)}%</div>
            </div>
            <div>
              <div style={{ color: '#888' }}>갭 발생률</div>
              <div>{state.feed_health.gap_rate.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ color: '#888' }}>보간 비율</div>
              <div>{state.feed_health.interpolation_pct.toFixed(1)}%</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
