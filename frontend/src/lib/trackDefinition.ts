/**
 * Track Definition Layer — fixed, accurate circuit geometry.
 *
 * Each circuit is defined by an SVG path that faithfully represents the real
 * FIA layout.  DRS zones, sectors, and pit-lane positions use *arc-length
 * ratios* (0-1 around the circuit) taken from official FIA data.
 *
 * The svgPath is designed for a normalised viewBox so it renders at any size
 * without distortion.  A `transformHint` can rotate / mirror the path to
 * align with the world-coordinate frame coming from the UDP feed.
 */

export type DRSZoneDef = {
  start_ratio: number
  end_ratio: number
  detection_ratio: number
  label: string
}

export type TrackDefinition = {
  id: string
  displayName: string
  /** SVG <path d="…"> that draws the circuit centre-line. */
  svgPath: string
  /** Nominal lap length in metres (FIA data). */
  lengthMeters: number
  /**
   * Sector split ratios – e.g. [0.32, 0.69] means
   *   S1 = 0 → 0.32, S2 = 0.32 → 0.69, S3 = 0.69 → 1.0
   */
  sectors: [number, number]
  drsZones: DRSZoneDef[]
  pitLane: { start_ratio: number; end_ratio: number }
  /** Hints to align the definition path with the UDP world frame. */
  transformHint: {
    rotation: number    // degrees clockwise
    scale: number
    offsetX: number
    offsetY: number
    flipX: boolean
    flipY: boolean
  }
  /** Circuit-specific rendering hints. */
  features?: {
    /** Named corners with ratio and curvature info. */
    corners?: Array<{ name: string; ratio: number; highlight?: boolean }>
    /** Special visual sections (tunnel, coastal, etc.) */
    sections?: Array<{ name: string; start_ratio: number; end_ratio: number; style: string }>
  }
}

/**
 * Point sampled along the SVG definition path at even arc-length intervals.
 * Used for KD-tree lookups and ratio-based queries.
 */
export type TrackSplinePoint = {
  x: number
  y: number
  ratio: number   // 0..1 arc-length parameterisation
  dist: number    // cumulative distance from start
}

/**
 * Pre-computed lookup structure for snap-to-track queries.
 */
export type TrackLookup = {
  definition: TrackDefinition
  /** Evenly-sampled spline points (500-2000). */
  spline: TrackSplinePoint[]
  totalLength: number
  /** viewBox-space bounds of the spline. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
}
