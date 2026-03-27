import test from 'node:test'
import assert from 'node:assert/strict'
import {
  F1_PACKET_IDS,
  createFrameAggregator,
} from '../src/index.js'

function env(packetId, frameIdentifier, receivedAtMs = Date.now()) {
  return {
    receivedAtMs,
    header: {
      packetId,
      frameIdentifier,
    },
  }
}

test('frame aggregator should detect duplicates and gaps', () => {
  const agg = createFrameAggregator({
    requiredPacketIds: [
      F1_PACKET_IDS.MOTION,
      F1_PACKET_IDS.SESSION,
    ],
  })

  agg.pushEnvelope(env(F1_PACKET_IDS.MOTION, 10))
  agg.pushEnvelope(env(F1_PACKET_IDS.MOTION, 10))
  agg.pushEnvelope(env(F1_PACKET_IDS.MOTION, 12))

  const snap = agg.snapshot()
  assert.equal(snap.duplicates, 1)
  assert.equal(snap.gaps, 1)
})

test('frame aggregator coverage should be full when required packets exist', () => {
  const agg = createFrameAggregator({
    requiredPacketIds: [
      F1_PACKET_IDS.MOTION,
      F1_PACKET_IDS.SESSION,
    ],
  })

  agg.pushEnvelope(env(F1_PACKET_IDS.MOTION, 44))
  agg.pushEnvelope(env(F1_PACKET_IDS.SESSION, 44))

  const snap = agg.snapshot()
  assert.equal(snap.coverageRatio, 1)
  assert.equal(typeof snap.health.scorePct, 'number')
})
