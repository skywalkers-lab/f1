import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import WebSocket from 'ws'
import { decode } from '@msgpack/msgpack'

function startRelay(port) {
  const child = spawn('node', ['src/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      BRIDGE_TOKENS: 'test-token',
      ENABLE_PROMETHEUS_METRICS: '1',
      STREAM_HZ: '30',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('relay start timeout'))
    }, 8000)

    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('relay listening')) {
        clearTimeout(timeout)
        resolve(child)
      }
    })

    child.once('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

async function stopRelay(child) {
  if (!child || child.killed) return
  await new Promise((resolve) => {
    child.once('exit', () => resolve())
    child.kill('SIGTERM')
  })
}

function waitForOpen(ws) {
  return once(ws, 'open')
}

test('viewer receives ordered msgpack state frames', async () => {
  const port = 18400 + Math.floor(Math.random() * 200)
  const child = await startRelay(port)

  const base = `ws://127.0.0.1:${port}/ws`
  const bridge = new WebSocket(`${base}?role=bridge&bridgeId=b1&token=test-token&sessionId=s1`)
  const viewerA = new WebSocket(`${base}?role=viewer&viewerRole=spectator&sessionId=s1&encoding=msgpack`)
  const viewerB = new WebSocket(`${base}?role=viewer&viewerRole=spectator&sessionId=s1&encoding=msgpack`)

  const seenA = []
  const seenB = []

  viewerA.on('message', (raw, isBinary) => {
    if (!isBinary) return
    const parsed = decode(raw)
    if (parsed?.type === 'state') seenA.push(parsed.meta?.eventId)
  })
  viewerB.on('message', (raw, isBinary) => {
    if (!isBinary) return
    const parsed = decode(raw)
    if (parsed?.type === 'state') seenB.push(parsed.meta?.eventId)
  })

  try {
    await Promise.all([waitForOpen(bridge), waitForOpen(viewerA), waitForOpen(viewerB)])

    for (let i = 1; i <= 10; i += 1) {
      bridge.send(JSON.stringify({
        type: 'state',
        source: 'b1',
        seq: i,
        sessionId: 's1',
        payload: {
          session_uid: '12345678901234567890',
          last_frame_identifier: i,
          player: { lap: i, position: 1 },
        },
      }))
    }

    await new Promise((resolve) => setTimeout(resolve, 800))

    assert.ok(seenA.length > 0)
    assert.ok(seenB.length > 0)

    const sortedA = [...seenA].sort((a, b) => a - b)
    assert.deepEqual(seenA, sortedA)
  } finally {
    bridge.close()
    viewerA.close()
    viewerB.close()
    await stopRelay(child)
  }
})
