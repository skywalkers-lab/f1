import WebSocket from 'ws'

export class BridgeClient {
  constructor({ relayWsUrl, bridgeId, token, authToken, sessionId, mode = 'bridge', onDriverCommand = null }) {
    this.relayWsUrl = relayWsUrl
    this.bridgeId = bridgeId
    this.token = token
    this.authToken = authToken
    this.sessionId = sessionId || 'public'
    this.mode = mode
    this.onDriverCommand = onDriverCommand
    this.ws = null
    this.closed = false
    this.seq = 0
    this.retryMs = 800
    this.maxRetryMs = 10000
    this.isConnected = false
    this.connectionStartTime = null
    this.lastMessageTime = null
    this.stats = {
      messagesPublished: 0,
      messagesFailed: 0,
      reconnectCount: 0,
    }
    this.heartbeatTimer = null
    this.heartbeatIntervalMs = 5000 // Send heartbeat every 5 seconds
    this.heartbeatTimeoutMs = 10000 // Timeout if no response for 10 seconds
  }

  connect() {
    if (this.closed) return

    const u = new URL(this.relayWsUrl)
    if (this.mode === 'driver') {
      u.searchParams.set('role', 'viewer')
      u.searchParams.set('viewerRole', 'driver')
      u.searchParams.set('clientId', this.bridgeId)
      if (this.authToken) u.searchParams.set('auth', this.authToken)
    } else {
      u.searchParams.set('role', 'bridge')
      u.searchParams.set('bridgeId', this.bridgeId)
      if (this.token) u.searchParams.set('token', this.token)
    }
    u.searchParams.set('sessionId', this.sessionId)

    console.log(`[bridge-client] Connecting to relay at ${u.origin}...`)
    this.ws = new WebSocket(u)

    this.ws.on('open', () => {
      this.isConnected = true
      this.connectionStartTime = Date.now()
      this.lastMessageTime = Date.now()
      this.retryMs = 800
      console.log(`[bridge-client] Connected to relay as ${this.bridgeId}`)
      this._startHeartbeat()
    })

    this.ws.on('message', (raw) => {
      this.lastMessageTime = Date.now()
      try {
        const msg = JSON.parse(String(raw))
        if (msg.type === 'heartbeat') {
          // Send pong to acknowledge heartbeat
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'pong' }))
          }
        } else if (msg.type === 'pong') {
          // Heartbeat acknowledged, no action needed
        } else if (msg.type === 'driver_command') {
          if (typeof this.onDriverCommand === 'function') {
            this.onDriverCommand(msg.command)
          }
        } else {
          console.debug(`[bridge-client] Received message type: ${msg.type}`)
        }
      } catch (err) {
        console.warn(`[bridge-client] Failed to parse message:`, err.message)
      }
    })

    this.ws.on('close', (code, reason) => {
      this.isConnected = false
      this._stopHeartbeat()
      console.warn(`[bridge-client] Disconnected from relay (code: ${code}, reason: ${String(reason)})`)
      
      if (!this.closed) {
        this.stats.reconnectCount += 1
        const delay = Math.min(this.retryMs, this.maxRetryMs)
        console.log(`[bridge-client] Reconnecting in ${delay}ms... (attempt ${this.stats.reconnectCount})`)
        setTimeout(() => this.connect(), delay)
        this.retryMs = Math.min(this.retryMs * 1.8, this.maxRetryMs)
      }
    })

    this.ws.on('error', (err) => {
      console.warn('[bridge-client] WebSocket error:', err.message)
      this.isConnected = false
      this._stopHeartbeat()
    })
  }

  _startHeartbeat() {
    this._stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'heartbeat' }))
        } catch (err) {
          console.warn('[bridge-client] Failed to send heartbeat:', err.message)
        }
      }
    }, this.heartbeatIntervalMs)
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  publish(state) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.stats.messagesFailed += 1
      return false
    }

    try {
      this.seq += 1
      const resolvedSessionId = this.sessionId || String(state?.session_uid || 'public')
      this.ws.send(
        JSON.stringify({
          type: this.mode === 'driver' ? 'telemetry_snapshot' : 'state',
          version: this.mode === 'driver' ? 1 : undefined,
          source: this.bridgeId,
          sourceClientId: this.bridgeId,
          seq: this.seq,
          sessionId: resolvedSessionId,
          ts: Date.now(),
          payload: state,
        }),
      )
      this.stats.messagesPublished += 1
      this.lastMessageTime = Date.now()
      return true
    } catch (err) {
      console.warn('[bridge-client] Failed to publish state:', err.message)
      this.stats.messagesFailed += 1
      return false
    }
  }

  ackCommand(commandId, status = 'received') {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    try {
      this.ws.send(
        JSON.stringify({
          type: 'command_ack',
          version: 1,
          sessionId: this.sessionId,
          sourceClientId: this.bridgeId,
          commandId,
          status,
          timestamp: Date.now(),
        }),
      )
      return true
    } catch {
      return false
    }
  }

  getStats() {
    return {
      ...this.stats,
      isConnected: this.isConnected,
      connectionUptime: this.connectionStartTime ? Date.now() - this.connectionStartTime : null,
      timeSinceLastMessage: this.lastMessageTime ? Date.now() - this.lastMessageTime : null,
    }
  }

  close() {
    this.closed = true
    this._stopHeartbeat()
    if (this.ws) {
      this.ws.close()
    }
  }
}
