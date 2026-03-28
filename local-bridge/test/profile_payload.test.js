import test from 'node:test'
import assert from 'node:assert/strict'
import { AppStateBuilder } from '../src/appStateBuilder.js'

test('engineer profile excludes raw payloads', () => {
  const builder = new AppStateBuilder(0)
  builder.state.session_uid = '12345678901234567890'
  builder.state.raw.latest_packet_payloads.motion = { rawBase64: 'abc' }

  const snapshot = builder.snapshot('engineer')
  assert.equal(snapshot.profile, 'engineer')
  assert.equal(snapshot.session_uid, '12345678901234567890')
  assert.equal('raw' in snapshot, false)
})

test('debug profile includes raw payloads', () => {
  const builder = new AppStateBuilder(0)
  builder.state.raw.latest_packet_payloads.motion = { rawBase64: 'abc' }

  const snapshot = builder.snapshot('debug')
  assert.equal(snapshot.profile, 'debug')
  assert.equal(snapshot.raw.latest_packet_payloads.motion.rawBase64, 'abc')
})
