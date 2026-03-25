// #22 — Track-specific pitlane geometry dataset
// #23 — Track-specific DRS activation/detection overlays from official data

export type PitLaneGeometry = {
  entry_ratio: number
  exit_ratio: number
  entry_angle_deg?: number
  pit_length_m?: number
}

export type DrsZone = {
  detection_ratio: number
  activation_ratio: number
  end_ratio: number
  label: string
}

export type SectorBoundary = {
  ratio: number
  label: string
}

export type TrackData = {
  name: string
  country: string
  length_m: number
  pit_lane: PitLaneGeometry
  drs_zones: DrsZone[]
  sectors: SectorBoundary[]
  lap_record_ms?: number
  corners: number
}

/**
 * Full track database — sorted by F1 2025 game track IDs.
 * Ratios are lap-distance fractions [0..1].
 */
export const TRACK_DATABASE: Record<string, TrackData> = {
  TRACK_0: {
    name: 'Melbourne',
    country: 'Australia',
    length_m: 5278,
    pit_lane: { entry_ratio: 0.91, exit_ratio: 0.03, pit_length_m: 340 },
    drs_zones: [
      { detection_ratio: 0.06, activation_ratio: 0.08, end_ratio: 0.18, label: 'DRS1' },
      { detection_ratio: 0.54, activation_ratio: 0.57, end_ratio: 0.66, label: 'DRS2' },
    ],
    sectors: [{ ratio: 0.30, label: 'S1' }, { ratio: 0.65, label: 'S2' }],
    corners: 14,
    lap_record_ms: 79813,
  },
  TRACK_1: {
    name: 'Paul Ricard',
    country: 'France',
    length_m: 5842,
    pit_lane: { entry_ratio: 0.92, exit_ratio: 0.04, pit_length_m: 396 },
    drs_zones: [
      { detection_ratio: 0.05, activation_ratio: 0.08, end_ratio: 0.22, label: 'DRS1' },
      { detection_ratio: 0.58, activation_ratio: 0.62, end_ratio: 0.74, label: 'DRS2' },
    ],
    sectors: [{ ratio: 0.33, label: 'S1' }, { ratio: 0.68, label: 'S2' }],
    corners: 15,
  },
  TRACK_2: {
    name: 'Shanghai',
    country: 'China',
    length_m: 5451,
    pit_lane: { entry_ratio: 0.93, exit_ratio: 0.02, pit_length_m: 360 },
    drs_zones: [
      { detection_ratio: 0.04, activation_ratio: 0.07, end_ratio: 0.20, label: 'DRS1' },
      { detection_ratio: 0.52, activation_ratio: 0.56, end_ratio: 0.68, label: 'DRS2' },
    ],
    sectors: [{ ratio: 0.35, label: 'S1' }, { ratio: 0.65, label: 'S2' }],
    corners: 16,
  },
  TRACK_3: {
    name: 'Bahrain',
    country: 'Bahrain',
    length_m: 5412,
    pit_lane: { entry_ratio: 0.94, exit_ratio: 0.03, pit_length_m: 398 },
    drs_zones: [
      { detection_ratio: 0.03, activation_ratio: 0.06, end_ratio: 0.16, label: 'DRS1' },
      { detection_ratio: 0.44, activation_ratio: 0.48, end_ratio: 0.56, label: 'DRS2' },
      { detection_ratio: 0.73, activation_ratio: 0.77, end_ratio: 0.86, label: 'DRS3' },
    ],
    sectors: [{ ratio: 0.31, label: 'S1' }, { ratio: 0.62, label: 'S2' }],
    corners: 15,
    lap_record_ms: 91566,
  },
  TRACK_4: {
    name: 'Catalunya',
    country: 'Spain',
    length_m: 4675,
    pit_lane: { entry_ratio: 0.93, exit_ratio: 0.03, pit_length_m: 366 },
    drs_zones: [
      { detection_ratio: 0.05, activation_ratio: 0.08, end_ratio: 0.22, label: 'DRS1' },
      { detection_ratio: 0.60, activation_ratio: 0.64, end_ratio: 0.75, label: 'DRS2' },
    ],
    sectors: [{ ratio: 0.33, label: 'S1' }, { ratio: 0.66, label: 'S2' }],
    corners: 16,
    lap_record_ms: 78149,
  },
  TRACK_5: {
    name: 'Monaco',
    country: 'Monaco',
    length_m: 3337,
    pit_lane: { entry_ratio: 0.88, exit_ratio: 0.06, pit_length_m: 280 },
    drs_zones: [
      { detection_ratio: 0.03, activation_ratio: 0.06, end_ratio: 0.18, label: 'DRS1' },
    ],
    sectors: [{ ratio: 0.34, label: 'S1' }, { ratio: 0.68, label: 'S2' }],
    corners: 19,
    lap_record_ms: 72909,
  },
  TRACK_6: {
    name: 'Montreal',
    country: 'Canada',
    length_m: 4361,
    pit_lane: { entry_ratio: 0.90, exit_ratio: 0.04, pit_length_m: 356 },
    drs_zones: [
      { detection_ratio: 0.05, activation_ratio: 0.08, end_ratio: 0.24, label: 'DRS1' },
      { detection_ratio: 0.63, activation_ratio: 0.67, end_ratio: 0.82, label: 'DRS2' },
    ],
    sectors: [{ ratio: 0.33, label: 'S1' }, { ratio: 0.66, label: 'S2' }],
    corners: 14,
    lap_record_ms: 73078,
  },
  TRACK_7: {
    name: 'Silverstone',
    country: 'UK',
    length_m: 5891,
    pit_lane: { entry_ratio: 0.89, exit_ratio: 0.02, pit_length_m: 410 },
    drs_zones: [
      { detection_ratio: 0.05, activation_ratio: 0.08, end_ratio: 0.18, label: 'DRS1' },
      { detection_ratio: 0.55, activation_ratio: 0.59, end_ratio: 0.70, label: 'DRS2' },
    ],
    sectors: [{ ratio: 0.33, label: 'S1' }, { ratio: 0.66, label: 'S2' }],
    corners: 18,
    lap_record_ms: 87097,
  },
  TRACK_10: {
    name: 'Suzuka',
    country: 'Japan',
    length_m: 5807,
    pit_lane: { entry_ratio: 0.93, exit_ratio: 0.02, pit_length_m: 395 },
    drs_zones: [
      { detection_ratio: 0.04, activation_ratio: 0.07, end_ratio: 0.17, label: 'DRS1' },
      { detection_ratio: 0.63, activation_ratio: 0.67, end_ratio: 0.78, label: 'DRS2' },
    ],
    sectors: [{ ratio: 0.37, label: 'S1' }, { ratio: 0.67, label: 'S2' }],
    corners: 18,
    lap_record_ms: 90064,
  },
  TRACK_13: {
    name: 'Hungaroring',
    country: 'Hungary',
    length_m: 4381,
    pit_lane: { entry_ratio: 0.92, exit_ratio: 0.03, pit_length_m: 370 },
    drs_zones: [
      { detection_ratio: 0.04, activation_ratio: 0.07, end_ratio: 0.22, label: 'DRS1' },
      { detection_ratio: 0.55, activation_ratio: 0.58, end_ratio: 0.68, label: 'DRS2' },
    ],
    sectors: [{ ratio: 0.31, label: 'S1' }, { ratio: 0.64, label: 'S2' }],
    corners: 14,
    lap_record_ms: 77411,
  },
  TRACK_14: {
    name: 'Spa-Francorchamps',
    country: 'Belgium',
    length_m: 7004,
    pit_lane: { entry_ratio: 0.95, exit_ratio: 0.02, pit_length_m: 420 },
    drs_zones: [
      { detection_ratio: 0.14, activation_ratio: 0.17, end_ratio: 0.29, label: 'DRS1' },
      { detection_ratio: 0.71, activation_ratio: 0.74, end_ratio: 0.85, label: 'DRS2' },
    ],
    sectors: [{ ratio: 0.33, label: 'S1' }, { ratio: 0.66, label: 'S2' }],
    corners: 19,
    lap_record_ms: 106286,
  },
  TRACK_15: {
    name: 'Monza',
    country: 'Italy',
    length_m: 5793,
    pit_lane: { entry_ratio: 0.93, exit_ratio: 0.03, pit_length_m: 380 },
    drs_zones: [
      { detection_ratio: 0.04, activation_ratio: 0.07, end_ratio: 0.22, label: 'DRS1' },
      { detection_ratio: 0.62, activation_ratio: 0.66, end_ratio: 0.80, label: 'DRS2' },
    ],
    sectors: [{ ratio: 0.33, label: 'S1' }, { ratio: 0.66, label: 'S2' }],
    corners: 11,
    lap_record_ms: 81046,
  },
  TRACK_16: {
    name: 'Singapore',
    country: 'Singapore',
    length_m: 4940,
    pit_lane: { entry_ratio: 0.91, exit_ratio: 0.04, pit_length_m: 350 },
    drs_zones: [
      { detection_ratio: 0.04, activation_ratio: 0.07, end_ratio: 0.16, label: 'DRS1' },
      { detection_ratio: 0.42, activation_ratio: 0.46, end_ratio: 0.55, label: 'DRS2' },
      { detection_ratio: 0.72, activation_ratio: 0.76, end_ratio: 0.85, label: 'DRS3' },
    ],
    sectors: [{ ratio: 0.33, label: 'S1' }, { ratio: 0.66, label: 'S2' }],
    corners: 23,
    lap_record_ms: 98829,
  },
  TRACK_17: {
    name: 'Abu Dhabi',
    country: 'UAE',
    length_m: 5281,
    pit_lane: { entry_ratio: 0.92, exit_ratio: 0.03, pit_length_m: 376 },
    drs_zones: [
      { detection_ratio: 0.05, activation_ratio: 0.08, end_ratio: 0.20, label: 'DRS1' },
      { detection_ratio: 0.55, activation_ratio: 0.59, end_ratio: 0.72, label: 'DRS2' },
    ],
    sectors: [{ ratio: 0.33, label: 'S1' }, { ratio: 0.66, label: 'S2' }],
    corners: 16,
    lap_record_ms: 86103,
  },
  TRACK_21: {
    name: 'Jeddah',
    country: 'Saudi Arabia',
    length_m: 6174,
    pit_lane: { entry_ratio: 0.94, exit_ratio: 0.02, pit_length_m: 400 },
    drs_zones: [
      { detection_ratio: 0.04, activation_ratio: 0.07, end_ratio: 0.18, label: 'DRS1' },
      { detection_ratio: 0.45, activation_ratio: 0.49, end_ratio: 0.58, label: 'DRS2' },
      { detection_ratio: 0.72, activation_ratio: 0.76, end_ratio: 0.86, label: 'DRS3' },
    ],
    sectors: [{ ratio: 0.33, label: 'S1' }, { ratio: 0.66, label: 'S2' }],
    corners: 27,
    lap_record_ms: 90734,
  },
  TRACK_22: {
    name: 'Miami',
    country: 'USA',
    length_m: 5412,
    pit_lane: { entry_ratio: 0.92, exit_ratio: 0.03, pit_length_m: 370 },
    drs_zones: [
      { detection_ratio: 0.05, activation_ratio: 0.08, end_ratio: 0.21, label: 'DRS1' },
      { detection_ratio: 0.52, activation_ratio: 0.56, end_ratio: 0.68, label: 'DRS2' },
      { detection_ratio: 0.80, activation_ratio: 0.83, end_ratio: 0.92, label: 'DRS3' },
    ],
    sectors: [{ ratio: 0.33, label: 'S1' }, { ratio: 0.66, label: 'S2' }],
    corners: 19,
    lap_record_ms: 89955,
  },
  TRACK_23: {
    name: 'Las Vegas',
    country: 'USA',
    length_m: 6201,
    pit_lane: { entry_ratio: 0.93, exit_ratio: 0.03, pit_length_m: 380 },
    drs_zones: [
      { detection_ratio: 0.06, activation_ratio: 0.09, end_ratio: 0.28, label: 'DRS1' },
      { detection_ratio: 0.65, activation_ratio: 0.69, end_ratio: 0.82, label: 'DRS2' },
    ],
    sectors: [{ ratio: 0.38, label: 'S1' }, { ratio: 0.72, label: 'S2' }],
    corners: 17,
  },
  TRACK_24: {
    name: 'Qatar',
    country: 'Qatar',
    length_m: 5380,
    pit_lane: { entry_ratio: 0.92, exit_ratio: 0.03, pit_length_m: 360 },
    drs_zones: [
      { detection_ratio: 0.05, activation_ratio: 0.08, end_ratio: 0.22, label: 'DRS1' },
      { detection_ratio: 0.60, activation_ratio: 0.64, end_ratio: 0.76, label: 'DRS2' },
    ],
    sectors: [{ ratio: 0.33, label: 'S1' }, { ratio: 0.66, label: 'S2' }],
    corners: 16,
  },
}

/** Look up track data by track ID string (e.g. 'TRACK_14'). */
export function getTrackData(trackId: string): TrackData | null {
  return TRACK_DATABASE[trackId] ?? null
}

/** Get pitlane geometry if available, else a sensible default. */
export function getPitLaneGeometry(trackId: string): PitLaneGeometry {
  const track = TRACK_DATABASE[trackId]
  if (track) return track.pit_lane
  return { entry_ratio: 0.92, exit_ratio: 0.03, pit_length_m: 370 }
}

/** Get DRS zones with detection/activation/end for a given track. */
export function getDrsZones(trackId: string): DrsZone[] {
  const track = TRACK_DATABASE[trackId]
  if (track) return track.drs_zones
  return [
    { detection_ratio: 0.10, activation_ratio: 0.12, end_ratio: 0.19, label: 'DRS1' },
    { detection_ratio: 0.58, activation_ratio: 0.60, end_ratio: 0.68, label: 'DRS2' },
  ]
}
