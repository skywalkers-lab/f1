import dgram from 'node:dgram'
import dotenv from 'dotenv'
import { parseF1Packet } from './f1udpParser.js'
import { AppStateBuilder } from './appStateBuilder.js'
import { BridgeClient } from './bridgeClient.js'
import {
  F1_PACKET_IDS,
  createFrameAggregator,
} from '@f1/shared-protocol'
import {
  JitterMonitor,
  PacketLossEstimator,
  FrameCorrectionWindow,
  SourceQualityScorer,
  DeadReckoningFallback,
} from './bridgeEnhancements.js'

dotenv.config()

const UDP_HOST = process.env.UDP_HOST || '0.0.0.0'
const UDP_PORT = Number(process.env.UDP_PORT || 20777)
const RELAY_WS_URL = process.env.RELAY_WS_URL || 'ws://localhost:8080/ws'
const BRIDGE_ID = process.env.BRIDGE_ID || `bridge-${Math.random().toString(16).slice(2, 8)}`
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || ''
const DRIVER_AUTH_TOKEN = process.env.DRIVER_AUTH_TOKEN || ''
const CLIENT_MODE = (process.env.CLIENT_MODE || (DRIVER_AUTH_TOKEN ? 'driver' : 'bridge')).toLowerCase()
const SESSION_ID = process.env.SESSION_ID || 'public'
const PUBLISH_HZ = Number(process.env.PUBLISH_HZ || 15)
const PLAYER_CAR_INDEX = Number(process.env.PLAYER_CAR_INDEX || 0)

// Watchdog timer configuration
const UDP_TIMEOUT_MS = Number(process.env.UDP_TIMEOUT_MS || 5000)

// UDP receiver statistics
const udpStats = {
  packetsReceived: 0,
  packetsDropped: 0,
  decodeErrors: 0,
  lastPacketTime: null,
  isConnected: false,
  connectionStartTime: null,
  errorCount: 0,
  lastErrorTime: null,
}

const builder = new AppStateBuilder(PLAYER_CAR_INDEX)
const bridge = new BridgeClient({
  relayWsUrl: RELAY_WS_URL,
  bridgeId: BRIDGE_ID,
  token: BRIDGE_TOKEN,
  authToken: DRIVER_AUTH_TOKEN,
  sessionId: SESSION_ID,
  mode: CLIENT_MODE === 'driver' ? 'driver' : 'bridge',
  onDriverCommand: (command) => {
    if (!command) return
    console.log(`[driver-command] ${command.priority || 'normal'} ${command.type}: ${command.message}`)
    if (command.id) {
      bridge.ackCommand(command.id, 'received')
    }
  },
})

// #16 Jitter monitor
const jitterMonitor = new JitterMonitor(PUBLISH_HZ)
// #17 Packet loss estimator
const packetLoss = new PacketLossEstimator()
// #18 Out-of-order frame correction
const frameCorrection = new FrameCorrectionWindow(4, 50)
// #24 Multi-source quality scorer
const sourceScorer = new SourceQualityScorer()
// #25 Dead-reckoning fallback
const deadReckoning = new DeadReckoningFallback(500)
const frameAggregator = createFrameAggregator({
  requiredPacketIds: [
    F1_PACKET_IDS.MOTION,
    F1_PACKET_IDS.SESSION,
    F1_PACKET_IDS.LAP_DATA,
    F1_PACKET_IDS.CAR_TELEMETRY,
    F1_PACKET_IDS.CAR_STATUS,
    F1_PACKET_IDS.PARTICIPANTS,
  ],
})

const socket = dgram.createSocket('udp4')

// Watchdog timer to detect UDP timeout
let watchdogTimer = null

function resetWatchdog() {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer)
  }
  
  watchdogTimer = setTimeout(() => {
    const elapsed = Date.now() - udpStats.lastPacketTime
    console.warn(`[bridge] UDP timeout: no packets for ${elapsed}ms (threshold: ${UDP_TIMEOUT_MS}ms)`)
    udpStats.isConnected = false
    
    // Try to restart UDP listener
    console.log('[bridge] Attempting to restart UDP listener...')
    socket.close()
    socket.bind(UDP_PORT, UDP_HOST, () => {
      console.log(`[bridge] UDP restarted on ${UDP_HOST}:${UDP_PORT}`)
    })
  }, UDP_TIMEOUT_MS)
}

socket.on('error', (err) => {
  udpStats.errorCount += 1
  udpStats.lastErrorTime = Date.now()
  console.error(`[bridge] UDP error (${udpStats.errorCount}):`, err.message)
})

socket.on('message', (msg, rinfo) => {
  udpStats.packetsReceived += 1
  udpStats.lastPacketTime = Date.now()
  
  if (!udpStats.isConnected) {
    udpStats.isConnected = true
    udpStats.connectionStartTime = Date.now()
    console.log(`[bridge] UDP connection established from ${rinfo.address}:${rinfo.port}`)
  }
  
  resetWatchdog()

  const parsed = parseF1Packet(msg)
  if (!parsed) {
    udpStats.packetsDropped += 1
    builder.markPacketDropped()
    return
  }

  if (parsed.raw) {
    frameAggregator.pushEnvelope(parsed.raw)
  }

  // #17 Record packet for loss estimation
  if (parsed.header) {
    packetLoss.record(parsed.type, parsed.header.frameIdentifier)
    sourceScorer.recordFrame(BRIDGE_ID, { frameId: parsed.header.frameIdentifier })
  }

  // #18 Insert into correction window and process in order
  const ordered = frameCorrection.insert(parsed)
  for (const pkt of ordered) {
    try {
      builder.applyPacket(pkt)
      // #25 Update dead-reckoning for motion packets
      if (pkt.type === 'motion' && Array.isArray(pkt.data)) {
        for (const car of pkt.data) {
          deadReckoning.update(car.carIndex, car)
        }
      }
    } catch (err) {
      udpStats.decodeErrors += 1
      builder.state.ingest_stats.decode_errors += 1
      if (udpStats.decodeErrors <= 10 || udpStats.decodeErrors % 100 === 0) {
        console.warn(`[bridge] decode/apply error (${udpStats.decodeErrors}):`, err.message)
      }
    }
  }
})

socket.on('listening', () => {
  const addr = socket.address()
  console.log(`[bridge] UDP listener started on ${addr.address}:${addr.port}`)
})

socket.bind(UDP_PORT, UDP_HOST, () => {
  console.log(`[bridge] UDP listening on ${UDP_HOST}:${UDP_PORT}`)
  bridge.connect()
})

const publishIntervalMs = Math.max(16, Math.round(1000 / Math.max(1, PUBLISH_HZ)))
let currentIntervalMs = publishIntervalMs
let ticker = null

function startTicker() {
  ticker = setInterval(() => {
    // #16 Record publish for jitter monitoring
    jitterMonitor.recordPublish()

    // Flush any delayed frames from the correction window
    const forced = frameCorrection.forceFlush()
    for (const pkt of forced) {
      try { builder.applyPacket(pkt) } catch { /* already logged */ }
    }

    const state = builder.snapshot()

    // Attach UDP stats to state for monitoring
    state.udp_stats = {
      packetsReceived: udpStats.packetsReceived,
      packetsDropped: udpStats.packetsDropped,
      decodeErrors: udpStats.decodeErrors,
      isConnected: udpStats.isConnected,
      timeSinceLastPacket: udpStats.lastPacketTime ? Date.now() - udpStats.lastPacketTime : null,
      connectionUptime: udpStats.connectionStartTime ? Date.now() - udpStats.connectionStartTime : null,
    }

    // #17 Attach per-type packet loss stats
    state.packet_loss_stats = packetLoss.getStats()

    // #16 Attach jitter stats
    state.jitter_stats = jitterMonitor.getStats()

    // #18 Attach frame correction stats
    state.frame_correction_stats = frameCorrection.getStats()

    // #24 Attach source quality scores
    state.source_quality = sourceScorer.getScores()
    state.feed_health = frameAggregator.snapshot()
    builder.applyFeedHealth(state.feed_health)
    state.ingest_stats.feed_health_score_pct = state.feed_health.health.scorePct

    // Log statistics every 30 seconds
    if (udpStats.packetsReceived % (2000 / (publishIntervalMs || 16)) === 0 && udpStats.packetsReceived > 0) {
      const jStats = jitterMonitor.getStats()
      console.log(`[bridge] UDP stats - received: ${udpStats.packetsReceived}, dropped: ${udpStats.packetsDropped}, errors: ${udpStats.decodeErrors}, connected: ${udpStats.isConnected}, jitter: ${jStats.jitterMs}ms, adaptedHz: ${jStats.adaptedHz}`)
    }

    bridge.publish(state)

    // #16 Adapt publish rate based on jitter
    const newInterval = jitterMonitor.getAdaptedIntervalMs()
    if (Math.abs(newInterval - currentIntervalMs) > 5) {
      currentIntervalMs = newInterval
      clearInterval(ticker)
      startTicker()
    }
  }, currentIntervalMs)
}

startTicker()

function shutdown() {
  clearInterval(ticker)
  if (watchdogTimer) {
    clearTimeout(watchdogTimer)
  }
  bridge.close()
  socket.close()
  console.log(`[bridge] Final frame correction stats: ${JSON.stringify(frameCorrection.getStats())}`)
  console.log(`[bridge] Final packet loss stats: ${JSON.stringify(packetLoss.getStats())}`)
  console.log('[bridge] Shutdown complete')
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
