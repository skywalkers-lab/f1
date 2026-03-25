export function num(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function dot(a, b) {
  let out = 0
  for (let i = 0; i < a.length; i += 1) out += a[i] * b[i]
  return out
}

export function l2norm(arr) {
  let sum = 0
  for (let i = 0; i < arr.length; i += 1) sum += arr[i] * arr[i]
  return Math.sqrt(sum)
}

export function stableSoftmax(values, temperature = 1) {
  const t = Math.max(1e-5, temperature)
  const maxV = Math.max(...values)
  const exps = values.map((v) => Math.exp((v - maxV) / t))
  const sum = exps.reduce((a, b) => a + b, 0) || 1
  return exps.map((e) => e / sum)
}

export function argmax(values) {
  let bestIdx = 0
  let bestVal = -Infinity
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > bestVal) {
      bestVal = values[i]
      bestIdx = i
    }
  }
  return bestIdx
}

export function pickByProbability(items, probs, rnd = Math.random()) {
  let acc = 0
  for (let i = 0; i < items.length; i += 1) {
    acc += probs[i]
    if (rnd <= acc || i === items.length - 1) return items[i]
  }
  return items[items.length - 1]
}
