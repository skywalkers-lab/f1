import { F1_PACKET_IDS } from './udpProtocol.js'

const DEFAULT_REQUIRED_PACKET_IDS = Object.freeze([
  F1_PACKET_IDS.SESSION,
  F1_PACKET_IDS.LAP_DATA,
  F1_PACKET_IDS.CAR_TELEMETRY,
  F1_PACKET_IDS.CAR_STATUS,
])

const DEFAULT_MAX_FRAMES = 400
const DEFAULT_RETAIN_FRAMES = 300

function toInt(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

function normalizePacketIdList(packetIds) {
  if (!Array.isArray(packetIds) || packetIds.length === 0) {
    return [...DEFAULT_REQUIRED_PACKET_IDS]
  }
  return [...new Set(packetIds.map((packetId) => Number(packetId)).filter(Number.isInteger))]
}

function createSessionCounters() {
  return {
    packets: 0,
    duplicates: 0,
    gaps: 0,
    outOfOrder: 0,
    invalidPackets: 0,
    lastFrameIdentifier: null,
    latestTimestamp: 0,
    firstTimestamp: 0,
    latestFrameIdentifier: null,
  }
}

export function computeTelemetryFeedHealth({
  duplicates = 0,
  gaps = 0,
  outOfOrder = 0,
  invalidPackets = 0,
  coverageRatio = 0,
  packets = 0,
}) {
  const normalizedCoverage = Math.max(0, Math.min(1, Number(coverageRatio) || 0))
  const packetPenalty = packets < 20 ? (20 - packets) * 1.5 : 0

  const totalPenalty =
    duplicates * 3.5 +
    gaps * 8.5 +
    outOfOrder * 6 +
    invalidPackets * 12 +
    (1 - normalizedCoverage) * 45 +
    packetPenalty

  const scorePct = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)))

  return {
    scorePct,
    status: scorePct >= 90 ? 'excellent' : scorePct >= 75 ? 'good' : scorePct >= 50 ? 'degraded' : 'critical',
  }
}

function defaultSessionKeyFactory(envelope) {
  const header = envelope?.header || {}
  return `${header.sessionUID || 'unknown'}:${header.playerCarIndex ?? 'x'}`
}

export function createFrameAggregator(options = {}) {
  const requiredPacketIds = normalizePacketIdList(options.requiredPacketIds)
  const maxFrames = Math.max(30, toInt(options.maxFrames, DEFAULT_MAX_FRAMES))
  const retainFrames = Math.min(maxFrames - 1, Math.max(10, toInt(options.retainFrames, DEFAULT_RETAIN_FRAMES)))
  const sessionKeyFactory = typeof options.sessionKeyFactory === 'function'
    ? options.sessionKeyFactory
    : defaultSessionKeyFactory

  const stateBySession = new Map()

  function ensureSession(sessionKey) {
    const existing = stateBySession.get(sessionKey)
    if (existing) return existing

    const created = {
      perFrame: new Map(),
      counters: createSessionCounters(),
      packetFrequency: new Map(),
      requiredPacketIds,
    }
    stateBySession.set(sessionKey, created)
    return created
  }

  function pruneFrames(sessionState) {
    if (sessionState.perFrame.size <= maxFrames) return
    const sortedKeys = [...sessionState.perFrame.keys()].sort((a, b) => a - b)
    while (sortedKeys.length > retainFrames) {
      sessionState.perFrame.delete(sortedKeys.shift())
    }
  }

  function pushEnvelope(envelope) {
    const frameIdentifier = envelope?.header?.frameIdentifier
    const packetId = envelope?.header?.packetId
    const receivedAtMs = toInt(envelope?.receivedAtMs, Date.now())

    const sessionKey = sessionKeyFactory(envelope)
    const sessionState = ensureSession(sessionKey)
    const counters = sessionState.counters

    if (!Number.isInteger(frameIdentifier) || !Number.isInteger(packetId)) {
      counters.invalidPackets += 1
      return false
    }

    counters.packets += 1
    counters.latestTimestamp = Math.max(counters.latestTimestamp, receivedAtMs)
    counters.firstTimestamp = counters.firstTimestamp === 0 ? receivedAtMs : counters.firstTimestamp
    counters.latestFrameIdentifier = counters.latestFrameIdentifier === null
      ? frameIdentifier
      : Math.max(counters.latestFrameIdentifier, frameIdentifier)

    if (counters.lastFrameIdentifier !== null) {
      if (frameIdentifier < counters.lastFrameIdentifier) {
        counters.outOfOrder += 1
      } else if (frameIdentifier > counters.lastFrameIdentifier + 1) {
        counters.gaps += frameIdentifier - counters.lastFrameIdentifier - 1
      }
    }

    const frameState = sessionState.perFrame.get(frameIdentifier) || {
      packetIds: new Set(),
      packetById: new Map(),
      firstSeenAtMs: receivedAtMs,
      lastSeenAtMs: receivedAtMs,
    }

    if (frameState.packetIds.has(packetId)) {
      counters.duplicates += 1
    }

    frameState.packetIds.add(packetId)
    frameState.packetById.set(packetId, envelope)
    frameState.lastSeenAtMs = receivedAtMs
    sessionState.perFrame.set(frameIdentifier, frameState)

    sessionState.packetFrequency.set(packetId, (sessionState.packetFrequency.get(packetId) || 0) + 1)

    counters.lastFrameIdentifier = counters.lastFrameIdentifier === null
      ? frameIdentifier
      : Math.max(counters.lastFrameIdentifier, frameIdentifier)

    pruneFrames(sessionState)
    return true
  }

  function buildSessionSnapshot(sessionKey, sessionState) {
    const counters = sessionState.counters
    const trackedFrames = sessionState.perFrame.size

    const coveredFrames = [...sessionState.perFrame.values()].filter((frame) =>
      sessionState.requiredPacketIds.every((packetId) => frame.packetIds.has(packetId))
    ).length

    const coverageRatio = trackedFrames === 0 ? 0 : coveredFrames / trackedFrames
    const health = computeTelemetryFeedHealth({
      duplicates: counters.duplicates,
      gaps: counters.gaps,
      outOfOrder: counters.outOfOrder,
      invalidPackets: counters.invalidPackets,
      coverageRatio,
      packets: counters.packets,
    })

    return {
      sessionKey,
      packets: counters.packets,
      duplicates: counters.duplicates,
      gaps: counters.gaps,
      outOfOrder: counters.outOfOrder,
      invalidPackets: counters.invalidPackets,
      trackedFrames,
      requiredPacketIds: sessionState.requiredPacketIds,
      coverageRatio,
      latestTimestamp: counters.latestTimestamp,
      firstTimestamp: counters.firstTimestamp,
      latestFrameIdentifier: counters.latestFrameIdentifier,
      health,
      packetFrequency: Object.fromEntries(sessionState.packetFrequency.entries()),
    }
  }

  function snapshot() {
    const sessionSnapshots = [...stateBySession.entries()].map(([sessionKey, sessionState]) =>
      buildSessionSnapshot(sessionKey, sessionState)
    )

    const aggregate = sessionSnapshots.reduce((acc, item) => {
      acc.packets += item.packets
      acc.duplicates += item.duplicates
      acc.gaps += item.gaps
      acc.outOfOrder += item.outOfOrder
      acc.invalidPackets += item.invalidPackets
      acc.trackedFrames += item.trackedFrames
      acc.coverageRatio += item.coverageRatio
      acc.latestTimestamp = Math.max(acc.latestTimestamp, item.latestTimestamp)
      return acc
    }, {
      packets: 0,
      duplicates: 0,
      gaps: 0,
      outOfOrder: 0,
      invalidPackets: 0,
      trackedFrames: 0,
      coverageRatio: 0,
      latestTimestamp: 0,
    })

    const sessionCount = sessionSnapshots.length
    aggregate.coverageRatio = sessionCount === 0 ? 0 : aggregate.coverageRatio / sessionCount
    const health = computeTelemetryFeedHealth(aggregate)

    return {
      ...aggregate,
      sessionCount,
      requiredPacketIds,
      health,
      sessions: sessionSnapshots,
    }
  }

  function reset(sessionKey = null) {
    if (sessionKey === null) {
      stateBySession.clear()
      return
    }
    stateBySession.delete(String(sessionKey))
  }

  return {
    pushEnvelope,
    snapshot,
    reset,
  }
}
