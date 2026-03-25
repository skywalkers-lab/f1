import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { TyreHistory, TyreWearPoint } from '../../lib/tyreHistoryManager'
import { WearPrediction } from '../../lib/wearPrediction'
import { UndercutWindow } from '../../lib/undercutAnalyzer'
import { TyreStrategyAnalysis } from '../../hooks/useTyreStrategyAnalysis'

type Locale = 'ko' | 'en'

type Props = {
  history: TyreHistory
  highlightedIds: number[]
  fadedIds: number[]
  playerCarIndex: number
  predictions: Record<number, WearPrediction>
  windows: UndercutWindow[]
  pitMarkers?: TyreStrategyAnalysis['graph']['pitMarkers']
  crossovers?: TyreStrategyAnalysis['graph']['crossovers']
  locale: Locale
  cliffLow: number
  cliffHigh: number
}

type Domain = {
  minLap: number
  maxLap: number
}

const AXIS_PAD = { left: 40, right: 20, top: 20, bottom: 30 }
const COMPOUND_COLORS: Record<string, string> = {
  SOFT: '#ff655f',
  MEDIUM: '#f7c74d',
  HARD: '#78b8ff',
  UNKNOWN: '#a5bfce',
}

function useContainerSize() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 800, height: 300 })

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const update = () => setSize({ width: Math.max(320, node.clientWidth), height: Math.max(220, node.clientHeight) })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return { ref, size }
}

function getDomain(history: TyreHistory, ids: number[]): Domain {
  const laps: number[] = []
  for (const id of ids) {
    const points = history[id] ?? []
    for (const p of points) laps.push(p.lap)
  }
  if (laps.length === 0) return { minLap: 0, maxLap: 1 }
  return {
    minLap: Math.min(...laps),
    maxLap: Math.max(Math.min(...laps) + 1, ...laps),
  }
}

function downsample(points: TyreWearPoint[], max = 90): TyreWearPoint[] {
  if (points.length <= max) return points
  const stride = Math.ceil(points.length / max)
  const sampled: TyreWearPoint[] = []
  for (let i = 0; i < points.length; i += stride) sampled.push(points[i])
  const last = points[points.length - 1]
  if (sampled[sampled.length - 1] !== last) sampled.push(last)
  return sampled
}

function smoothWear(points: TyreWearPoint[], alpha = 0.42): TyreWearPoint[] {
  if (points.length < 3) return points
  const smoothed: TyreWearPoint[] = []
  let prev = points[0].wear
  for (const point of points) {
    prev = alpha * point.wear + (1 - alpha) * prev
    smoothed.push({ ...point, wear: prev })
  }
  return smoothed
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#b8d0df', align: CanvasTextAlign = 'left') {
  ctx.save()
  ctx.font = '11px Space Mono, monospace'
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.fillText(text, x, y)
  ctx.restore()
}

function markerColor(tone: 'ok' | 'watch' | 'critical'): string {
  if (tone === 'ok') return '#7ef0bc'
  if (tone === 'watch') return '#ffd17e'
  return '#ff979f'
}

function draw(ctx: CanvasRenderingContext2D, width: number, height: number, props: Props): void {
  const { history, highlightedIds, fadedIds, playerCarIndex, predictions, windows, pitMarkers = [], crossovers = [], cliffLow, cliffHigh, locale } = props
  const domain = getDomain(history, highlightedIds)
  const x0 = AXIS_PAD.left
  const y0 = AXIS_PAD.top
  const w = width - AXIS_PAD.left - AXIS_PAD.right
  const h = height - AXIS_PAD.top - AXIS_PAD.bottom

  const toX = (lap: number) => x0 + ((lap - domain.minLap) / (domain.maxLap - domain.minLap || 1)) * w
  const toY = (wear: number) => y0 + (1 - wear) * h

  ctx.clearRect(0, 0, width, height)

  ctx.fillStyle = '#0a1218'
  ctx.fillRect(x0, y0, w, h)

  const lapSpan = Math.max(1, domain.maxLap - domain.minLap)
  const xTickStep = lapSpan <= 8 ? 1 : lapSpan <= 20 ? 2 : 5
  const startTick = Math.ceil(domain.minLap / xTickStep) * xTickStep
  for (let lap = startTick; lap <= domain.maxLap; lap += xTickStep) {
    const x = toX(lap)
    ctx.strokeStyle = 'rgba(59, 96, 113, 0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y0)
    ctx.lineTo(x, y0 + h)
    ctx.stroke()
    drawText(ctx, `L${lap}`, x, y0 + h + 15, '#86a8bc', 'center')
  }

  const cliffY1 = toY(cliffLow)
  const cliffY2 = toY(cliffHigh)
  ctx.fillStyle = 'rgba(255, 76, 76, 0.12)'
  ctx.fillRect(x0, Math.min(cliffY1, cliffY2), w, Math.abs(cliffY2 - cliffY1))
  ctx.setLineDash([5, 4])
  ctx.strokeStyle = 'rgba(255, 122, 122, 0.65)'
  ctx.beginPath()
  ctx.moveTo(x0, cliffY1)
  ctx.lineTo(x0 + w, cliffY1)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x0, cliffY2)
  ctx.lineTo(x0 + w, cliffY2)
  ctx.stroke()
  ctx.setLineDash([])
  drawText(ctx, `${locale === 'ko' ? '주의' : 'Watch'} ${(cliffLow * 100).toFixed(0)}%`, x0 + 6, cliffY1 - 5, '#ffba9f')
  drawText(ctx, `${locale === 'ko' ? '클리프' : 'Cliff'} ${(cliffHigh * 100).toFixed(0)}%`, x0 + 6, cliffY2 - 5, '#ff9b9b')

  for (const window of windows.slice(0, 3)) {
    const wx0 = toX(window.startLap)
    const wx1 = toX(window.endLap)
    ctx.fillStyle = 'rgba(0, 185, 255, 0.11)'
    ctx.fillRect(Math.min(wx0, wx1), y0, Math.abs(wx1 - wx0), h)
  }

  ctx.strokeStyle = '#27414f'
  ctx.lineWidth = 1
  ctx.strokeRect(x0, y0, w, h)

  for (let i = 0; i <= 5; i += 1) {
    const y = y0 + (h * i) / 5
    ctx.strokeStyle = i === 0 || i === 5 ? '#31515f' : 'rgba(58, 95, 112, 0.45)'
    ctx.beginPath()
    ctx.moveTo(x0, y)
    ctx.lineTo(x0 + w, y)
    ctx.stroke()
    drawText(ctx, `${(100 - i * 20).toFixed(0)}%`, x0 - 6, y + 4, '#7ea0b5', 'right')
  }

  const fadedRenderable = fadedIds.slice(0, 5)
  const ordered = [...fadedRenderable, ...highlightedIds]
  const labelCars = new Set<number>([playerCarIndex, ...highlightedIds.filter((id) => id !== playerCarIndex).slice(0, 2)])

  for (const carIndex of ordered) {
    const points = smoothWear(downsample(history[carIndex] ?? []))
    if (points.length < 2) continue
    const latest = points[points.length - 1]
    const isPlayer = carIndex === playerCarIndex
    const isHighlighted = highlightedIds.includes(carIndex)
    const color = COMPOUND_COLORS[latest.compound] || COMPOUND_COLORS.UNKNOWN

    ctx.beginPath()
    ctx.setLineDash(latest.wear >= cliffLow ? [6, 4] : [])
    ctx.lineWidth = isPlayer ? 3.4 : isHighlighted ? 2.4 : 1
    ctx.strokeStyle = isPlayer ? '#83eeff' : isHighlighted ? color : 'rgba(104, 130, 146, 0.18)'
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i]
      const x = toX(p.lap)
      const y = toY(p.wear)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.setLineDash([])

    if (isHighlighted) {
      const lx = toX(latest.lap)
      const ly = toY(latest.wear)
      ctx.fillStyle = isPlayer ? '#6be4ff' : color
      ctx.beginPath()
      ctx.arc(lx, ly, isPlayer ? 3.5 : 2.2, 0, Math.PI * 2)
      ctx.fill()
      if (labelCars.has(carIndex)) {
        drawText(ctx, `#${carIndex}`, lx + 6, ly - 4, '#d7ecf8')
      }
    }
  }

  for (const prediction of Object.values(predictions)) {
    const x = toX(prediction.cliffLap)
    if (x < x0 || x > x0 + w) continue
    ctx.strokeStyle = prediction.carIndex === playerCarIndex ? '#91ebff' : 'rgba(194, 220, 236, 0.55)'
    ctx.lineWidth = prediction.carIndex === playerCarIndex ? 1.6 : 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(x, y0)
    ctx.lineTo(x, y0 + h)
    ctx.stroke()
    ctx.setLineDash([])
  }

  for (const marker of pitMarkers.slice(0, 8)) {
    const x = toX(marker.lap)
    if (x < x0 || x > x0 + w) continue
    ctx.strokeStyle = markerColor(marker.tone)
    ctx.lineWidth = 1.1
    ctx.beginPath()
    ctx.moveTo(x, y0 + 8)
    ctx.lineTo(x, y0 + h - 10)
    ctx.stroke()

    ctx.fillStyle = markerColor(marker.tone)
    ctx.beginPath()
    ctx.moveTo(x, y0 + 2)
    ctx.lineTo(x - 4, y0 + 10)
    ctx.lineTo(x + 4, y0 + 10)
    ctx.closePath()
    ctx.fill()
  }

  for (const crossover of crossovers.slice(0, 4)) {
    const x = toX(crossover.lap)
    if (x < x0 || x > x0 + w) continue
    const y = y0 + h * 0.22
    ctx.fillStyle = crossover.kind === 'undercut' ? '#8df2c0' : '#ffd58d'
    ctx.beginPath()
    ctx.arc(x, y, 4.2, 0, Math.PI * 2)
    ctx.fill()
    drawText(ctx, `${crossover.kind === 'undercut' ? 'UC' : 'OC'} #${crossover.rivalCarIndex}`, x + 7, y - 3, '#e3f3fb')
  }

  drawText(ctx, locale === 'ko' ? '랩' : 'Lap', x0 + w - 4, y0 + h + 18, '#7ea0b5', 'right')
  drawText(ctx, locale === 'ko' ? '마모율' : 'Wear', x0 + 2, y0 - 6, '#7ea0b5')
}

function GraphComponent(props: Props) {
  const { ref, size } = useContainerSize()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const signature = useMemo(
    () => `${props.highlightedIds.join(',')}|${props.fadedIds.length}|${Object.keys(props.predictions).length}|${props.windows.length}|${props.pitMarkers?.length ?? 0}|${props.crossovers?.length ?? 0}`,
    [props.highlightedIds, props.fadedIds.length, props.predictions, props.windows.length, props.pitMarkers, props.crossovers],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    canvas.width = Math.floor(size.width * dpr)
    canvas.height = Math.floor(size.height * dpr)
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${size.height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw(ctx, size.width, size.height, props)
  }, [size.width, size.height, signature])

  const candidateIds = props.highlightedIds.length > 0 ? props.highlightedIds : [props.playerCarIndex, ...props.fadedIds.slice(0, 3)]
  const noData = candidateIds.every((id) => (props.history[id] ?? []).length < 2)

  return (
    <div className="tyre-graph-root" ref={ref}>
      <canvas ref={canvasRef} className="tyre-graph-canvas" />
      {noData ? <div className="tyre-graph-fallback">{props.locale === 'ko' ? '데이터 축적 중: 최소 2개 샘플 필요' : 'Building history: at least 2 samples required'}</div> : null}
    </div>
  )
}

export const TyreGraph = memo(GraphComponent)
