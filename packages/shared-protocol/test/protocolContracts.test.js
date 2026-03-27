import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMMAND_PRIORITIES,
  COMMAND_TYPES,
  WS_MESSAGE_TYPES,
  buildProtocolEnvelope,
  createFrameAggregator,
  isCommandExpired,
  remainingCommandTtl,
  validateAndNormalizeCommand,
} from '../src/index.js'
import { validateProtocolEnvelope } from '../src/wsProtocol.js'

test('validateAndNormalizeCommand should normalize command fields with TTL clamps', () => {
  const result = validateAndNormalizeCommand({
    type: COMMAND_TYPES.BOX_THIS_LAP,
    ttlMs: 999_999,
    priority: 99,
    tags: ['Strategy', 42, 'strategy'],
  }, 1000)

  assert.equal(result.ok, true)
  assert.equal(result.command.type, COMMAND_TYPES.BOX_THIS_LAP)
  assert.equal(result.command.priority, COMMAND_PRIORITIES.CRITICAL)
  assert.equal(result.command.ttlMs, 120_000)
  assert.deepEqual(result.command.tags, ['strategy', '42'])
})

test('command expiry helpers should expose ttl status', () => {
  const normalized = validateAndNormalizeCommand({ type: COMMAND_TYPES.PUSH, ttlMs: 2000, createdAtMs: 1000 })
  assert.equal(normalized.ok, true)
  assert.equal(isCommandExpired(normalized.command, 1500), false)
  assert.equal(isCommandExpired(normalized.command, 3000), true)
  assert.equal(remainingCommandTtl(normalized.command, 2500), 500)
})

test('buildProtocolEnvelope should create stable websocket envelope shape', () => {
  const envelope = buildProtocolEnvelope(WS_MESSAGE_TYPES.COMMAND, { foo: 'bar' }, {
    roomId: 'room-1',
    role: 'engineer',
    sentAtMs: 123,
  })

  assert.equal(envelope.type, WS_MESSAGE_TYPES.COMMAND)
  assert.equal(envelope.roomId, 'room-1')
  assert.equal(envelope.role, 'engineer')
  assert.equal(envelope.sentAtMs, 123)
  assert.deepEqual(envelope.payload, { foo: 'bar' })
})

test('validateProtocolEnvelope should reject malformed messages', () => {
  const malformed = validateProtocolEnvelope({ type: '', protocolVersion: 1, sentAtMs: Date.now() })
  assert.equal(malformed.ok, false)
})

test('validateProtocolEnvelope should normalize valid payload', () => {
  const now = Date.now()
  const valid = validateProtocolEnvelope({
    type: WS_MESSAGE_TYPES.HEARTBEAT,
    protocolVersion: 2,
    sentAtMs: now,
    payload: { alive: true },
  })

  assert.equal(valid.ok, true)
  assert.equal(valid.envelope.type, WS_MESSAGE_TYPES.HEARTBEAT)
  assert.equal(valid.envelope.protocolVersion, 2)
})

test('frame aggregator should count out-of-order frames', () => {
  const agg = createFrameAggregator()
  agg.pushEnvelope({
    receivedAtMs: 1,
    header: { packetId: 1, frameIdentifier: 10, sessionUID: 'A', playerCarIndex: 1 },
  })
  agg.pushEnvelope({
    receivedAtMs: 2,
    header: { packetId: 1, frameIdentifier: 9, sessionUID: 'A', playerCarIndex: 1 },
  })

  const snapshot = agg.snapshot()
  assert.equal(snapshot.outOfOrder, 1)
})

test('frame aggregator should track multi-session metrics', () => {
  const agg = createFrameAggregator()
  agg.pushEnvelope({
    receivedAtMs: 10,
    header: { packetId: 1, frameIdentifier: 1, sessionUID: 'A', playerCarIndex: 1 },
  })
  agg.pushEnvelope({
    receivedAtMs: 20,
    header: { packetId: 1, frameIdentifier: 1, sessionUID: 'B', playerCarIndex: 2 },
  })

  const snapshot = agg.snapshot()
  assert.equal(snapshot.sessionCount, 2)
  assert.equal(snapshot.sessions.length, 2)
})

test('frame aggregator should support single-session reset', () => {
  const agg = createFrameAggregator()
  agg.pushEnvelope({
    receivedAtMs: 10,
    header: { packetId: 1, frameIdentifier: 1, sessionUID: 'A', playerCarIndex: 1 },
  })
  agg.pushEnvelope({
    receivedAtMs: 20,
    header: { packetId: 1, frameIdentifier: 1, sessionUID: 'B', playerCarIndex: 2 },
  })

  agg.reset('A:1')

  const snapshot = agg.snapshot()
  assert.equal(snapshot.sessionCount, 1)
})
