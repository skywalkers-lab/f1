import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

function startRelay(port) {
  const child = spawn('node', ['src/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      BRIDGE_TOKENS: 'test-token',
      ENABLE_PROMETHEUS_METRICS: '1',
      STREAM_HZ: '15',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('relay start timeout'))
    }, 8000)

    child.stdout.on('data', (chunk) => {
      const text = String(chunk)
      if (text.includes('relay listening')) {
        clearTimeout(timeout)
        resolve(child)
      }
    })

    child.once('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    child.once('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timeout)
        reject(new Error(`relay exited early (${code})`))
      }
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

test('metrics endpoint exposes pitwall metric names and content-type', async () => {
  const port = 18100 + Math.floor(Math.random() * 300)
  const child = await startRelay(port)

  try {
    const res = await fetch(`http://127.0.0.1:${port}/metrics`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') || '', /text\/plain/)

    const body = await res.text()
    assert.match(body, /pitwall_ws_connected_clients/)
    assert.match(body, /pitwall_session_active_count/)
    assert.match(body, /pitwall_fanout_frame_duration_seconds/)
  } finally {
    await stopRelay(child)
  }
})
