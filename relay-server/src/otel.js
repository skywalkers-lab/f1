import { trace } from '@opentelemetry/api'

export async function initOtel(serviceName = 'pitwall-relay-server') {
  let sdk = null

  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node')
    sdk = new NodeSDK({
      serviceName,
    })
    await sdk.start()
  } catch (error) {
    console.warn('[otel] initialization skipped:', String(error?.message || error))
  }

  const tracer = trace.getTracer(serviceName)

  async function shutdown() {
    if (!sdk) return
    try {
      await sdk.shutdown()
    } catch {
      // telemetry shutdown should not break process termination
    }
  }

  return { tracer, shutdown }
}
