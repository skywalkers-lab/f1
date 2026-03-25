/**
 * F1 2025 Circuit Definitions
 *
 * SVG paths are normalised to a 0-500 x 0-500 viewBox so they render
 * at any resolution without distortion.  Sector splits, DRS zones, and
 * pit-lane ratios are sourced from FIA regulations.
 *
 * The `svgPath` draws the track centre-line.  It is NOT derived from UDP —
 * it represents the actual physical circuit.
 */

import type { TrackDefinition } from './trackDefinition'

// ---------------------------------------------------------------------------
// Monaco — Circuit de Monaco  (3.337 km)
// ---------------------------------------------------------------------------
const MONACO: TrackDefinition = {
  id: 'MONACO',
  displayName: 'Circuit de Monaco',
  lengthMeters: 3337,
  sectors: [0.32, 0.69],
  drsZones: [
    { start_ratio: 0.43, end_ratio: 0.50, detection_ratio: 0.37, label: 'DRS1' },
  ],
  pitLane: { start_ratio: 0.84, end_ratio: 0.97 },
  transformHint: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0, flipX: false, flipY: false },
  svgPath:
    // S/F straight → Ste Dévote → Beau Rivage climb → Massenet → Casino Square
    'M 120,460 L 280,460 ' +
    'Q 310,460 320,440 ' +                // Ste Dévote hairpin
    'L 340,380 Q 345,360 360,340 ' +       // Beau Rivage uphill
    'Q 380,300 400,270 ' +                 // Massenet left
    'Q 420,240 410,210 ' +                 // Casino Square right
    'Q 395,180 370,170 ' +                 // Mirabeau Haute
    'Q 350,160 340,140 ' +                 // Mirabeau Basse
    // Loews hairpin (tight U-turn)
    'Q 330,110 310,100 Q 280,85 260,100 Q 240,115 235,140 ' +
    // Portier → Tunnel
    'Q 230,170 215,190 Q 195,215 170,220 ' +
    // Tunnel section
    'Q 130,230 100,250 Q 70,275 50,310 ' +
    // Nouvelle Chicane
    'Q 35,340 50,360 Q 65,375 80,370 Q 95,365 100,350 ' +
    // Tabac → Swimming Pool
    'Q 105,330 90,310 Q 75,280 60,300 ' +
    // Piscine chicane
    'Q 40,330 30,360 Q 25,390 40,410 ' +
    // La Rascasse
    'Q 55,435 75,450 Q 95,458 120,460 Z',
  features: {
    corners: [
      { name: 'Ste Dévote', ratio: 0.05, highlight: true },
      { name: 'Massenet', ratio: 0.18 },
      { name: 'Casino', ratio: 0.22 },
      { name: 'Mirabeau', ratio: 0.27 },
      { name: 'Loews', ratio: 0.32, highlight: true },
      { name: 'Portier', ratio: 0.38 },
      { name: 'Nouvelle Chicane', ratio: 0.58, highlight: true },
      { name: 'Tabac', ratio: 0.65 },
      { name: 'Piscine', ratio: 0.72 },
      { name: 'La Rascasse', ratio: 0.88, highlight: true },
    ],
    sections: [
      { name: 'Tunnel', start_ratio: 0.40, end_ratio: 0.52, style: 'tunnel' },
    ],
  },
}

// ---------------------------------------------------------------------------
// Monza — Autodromo Nazionale Monza (5.793 km)
// ---------------------------------------------------------------------------
const MONZA: TrackDefinition = {
  id: 'MONZA',
  displayName: 'Autodromo Nazionale Monza',
  lengthMeters: 5793,
  sectors: [0.37, 0.67],
  drsZones: [
    { start_ratio: 0.11, end_ratio: 0.17, detection_ratio: 0.05, label: 'DRS1' },
    { start_ratio: 0.62, end_ratio: 0.71, detection_ratio: 0.56, label: 'DRS2' },
  ],
  pitLane: { start_ratio: 0.90, end_ratio: 0.98 },
  transformHint: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0, flipX: false, flipY: false },
  svgPath:
    'M 250,480 L 430,480 ' +               // S/F straight
    'Q 460,478 475,460 Q 488,440 480,420 ' + // Prima variante chicane
    'Q 470,395 450,385 ' +                  // Curva Grande entry
    'Q 400,360 350,330 Q 280,290 260,260 ' + // Curva Grande
    'Q 245,235 235,210 ' +                  // approach Variante della Roggia
    'Q 220,180 200,170 Q 175,160 165,180 ' + // Roggia chicane
    'Q 155,200 160,220 ' +
    'L 155,270 Q 148,300 130,320 ' +        // Lesmo 1
    'Q 110,345 100,370 ' +                  // Lesmo 2
    'Q 92,400 80,420 Q 65,445 55,460 ' +    // approach Ascari
    'Q 42,478 55,490 Q 75,498 100,490 ' +   // Ascari chicane
    'Q 130,478 150,465 ' +
    'L 200,445 Q 220,440 240,445 ' +        // Parabolica (now Alboreto)
    'Q 248,448 250,460 L 250,480 Z',
  features: {
    corners: [
      { name: 'Prima Variante', ratio: 0.08, highlight: true },
      { name: 'Curva Grande', ratio: 0.20 },
      { name: 'Roggia', ratio: 0.37, highlight: true },
      { name: 'Lesmo 1', ratio: 0.47 },
      { name: 'Lesmo 2', ratio: 0.52 },
      { name: 'Ascari', ratio: 0.70, highlight: true },
      { name: 'Parabolica', ratio: 0.88, highlight: true },
    ],
  },
}

// ---------------------------------------------------------------------------
// Spa-Francorchamps (7.004 km)
// ---------------------------------------------------------------------------
const SPA: TrackDefinition = {
  id: 'SPA',
  displayName: 'Circuit de Spa-Francorchamps',
  lengthMeters: 7004,
  sectors: [0.33, 0.66],
  drsZones: [
    { start_ratio: 0.05, end_ratio: 0.14, detection_ratio: 0.97, label: 'DRS1' },
    { start_ratio: 0.58, end_ratio: 0.67, detection_ratio: 0.53, label: 'DRS2' },
  ],
  pitLane: { start_ratio: 0.86, end_ratio: 0.96 },
  transformHint: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0, flipX: false, flipY: false },
  svgPath:
    'M 80,400 L 200,400 ' +                // S/F straight + La Source approach
    'Q 230,400 245,380 Q 260,355 245,335 Q 225,320 200,325 ' + // La Source hairpin
    'L 160,340 Q 140,345 130,360 ' +
    'Q 115,385 100,390 ' +
    'L 60,370 Q 30,360 20,335 ' +           // Eau Rouge entry
    'Q 10,305 20,275 Q 35,240 60,220 ' +    // Eau Rouge → Raidillon climb
    'Q 90,195 130,180 L 200,155 ' +         // Kemmel straight
    'Q 240,145 265,130 Q 290,110 300,90 ' + // Les Combes
    'Q 308,70 295,55 Q 278,42 260,50 ' +
    'Q 240,58 230,75 ' +                    // Malmedy
    'Q 218,100 210,120 Q 200,145 180,155 ' +
    'L 160,160 Q 130,168 120,185 ' +        // Rivage
    'Q 112,205 120,225 ' +
    'Q 135,255 160,270 Q 195,290 230,310 ' + // Pouhon double-left
    'Q 260,325 290,340 ' +
    'Q 330,360 360,370 Q 400,378 430,375 ' + // Fagnes → Stavelot
    'Q 465,370 480,355 Q 490,335 480,315 ' +
    'Q 465,295 440,290 ' +
    'Q 400,282 370,295 Q 345,315 320,340 ' + // Paul Frère → Blanchimont
    'Q 290,365 260,378 ' +
    'Q 220,395 180,398 ' +
    'L 80,400 Z',                            // Bus Stop chicane → S/F
  features: {
    corners: [
      { name: 'La Source', ratio: 0.04, highlight: true },
      { name: 'Eau Rouge', ratio: 0.10, highlight: true },
      { name: 'Raidillon', ratio: 0.12, highlight: true },
      { name: 'Les Combes', ratio: 0.25 },
      { name: 'Rivage', ratio: 0.36 },
      { name: 'Pouhon', ratio: 0.50, highlight: true },
      { name: 'Stavelot', ratio: 0.62 },
      { name: 'Blanchimont', ratio: 0.80, highlight: true },
      { name: 'Bus Stop', ratio: 0.94, highlight: true },
    ],
  },
}

// ---------------------------------------------------------------------------
// Silverstone (5.891 km)
// ---------------------------------------------------------------------------
const SILVERSTONE: TrackDefinition = {
  id: 'SILVERSTONE',
  displayName: 'Silverstone Circuit',
  lengthMeters: 5891,
  sectors: [0.33, 0.66],
  drsZones: [
    { start_ratio: 0.01, end_ratio: 0.08, detection_ratio: 0.94, label: 'DRS1' },
    { start_ratio: 0.52, end_ratio: 0.60, detection_ratio: 0.47, label: 'DRS2' },
  ],
  pitLane: { start_ratio: 0.88, end_ratio: 0.98 },
  transformHint: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0, flipX: false, flipY: false },
  svgPath:
    'M 250,460 L 400,460 ' +
    'Q 440,458 460,440 Q 478,418 470,395 ' + // Abbey
    'Q 458,370 435,360 L 380,345 ' +         // Farm straight
    'Q 350,338 330,320 ' +                    // Village
    'Q 310,298 300,275 Q 292,250 305,228 ' +  // The Loop
    'Q 320,210 345,200 L 400,185 ' +          // Wellington straight
    'Q 435,178 455,160 Q 475,135 475,110 ' +  // Brooklands
    'Q 475,85 455,70 Q 430,52 400,50 ' +      // Luffield
    'L 320,50 Q 285,50 260,65 ' +             // Woodcote approach
    'Q 235,80 220,100 ' +
    'Q 200,130 175,145 ' +                    // Copse
    'Q 140,165 110,190 ' +
    'Q 75,225 55,260 Q 38,295 40,330 ' +      // Maggots + Becketts
    'Q 42,365 60,390 Q 85,420 120,440 ' +     // Chapel
    'Q 160,455 200,460 L 250,460 Z',
  features: {
    corners: [
      { name: 'Abbey', ratio: 0.05, highlight: true },
      { name: 'Village', ratio: 0.18 },
      { name: 'The Loop', ratio: 0.24 },
      { name: 'Brooklands', ratio: 0.42 },
      { name: 'Luffield', ratio: 0.48 },
      { name: 'Copse', ratio: 0.60, highlight: true },
      { name: 'Maggots', ratio: 0.72, highlight: true },
      { name: 'Becketts', ratio: 0.76, highlight: true },
      { name: 'Chapel', ratio: 0.82 },
    ],
  },
}

// ---------------------------------------------------------------------------
// Suzuka (5.807 km) — figure-8 layout
// ---------------------------------------------------------------------------
const SUZUKA: TrackDefinition = {
  id: 'SUZUKA',
  displayName: 'Suzuka International Racing Course',
  lengthMeters: 5807,
  sectors: [0.34, 0.68],
  drsZones: [
    { start_ratio: 0.00, end_ratio: 0.07, detection_ratio: 0.94, label: 'DRS1' },
    { start_ratio: 0.58, end_ratio: 0.66, detection_ratio: 0.53, label: 'DRS2' },
  ],
  pitLane: { start_ratio: 0.90, end_ratio: 0.98 },
  transformHint: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0, flipX: false, flipY: false },
  svgPath:
    'M 100,350 L 200,350 ' +                  // S/F straight
    'Q 240,348 270,330 ' +                     // Turn 1-2
    'Q 305,308 330,280 Q 360,245 380,215 ' +   // S-curves
    'Q 395,190 400,165 Q 402,140 390,120 ' +
    'Q 375,100 355,95 Q 330,88 310,100 ' +     // Dunlop
    'Q 288,115 275,135 ' +
    'Q 260,160 250,185 ' +                     // Degner 1+2
    'Q 238,215 220,235 ' +
    // Figure-8 crossover (bridge section)
    'Q 195,260 170,270 Q 140,282 120,300 ' +
    // Spoon
    'Q 95,325 80,350 Q 68,380 65,410 ' +
    'Q 62,445 80,465 Q 100,480 130,478 ' +
    // 130R → Casio Triangle
    'Q 170,475 210,460 Q 260,440 310,415 ' +
    'Q 360,390 390,370 Q 420,348 430,320 ' +   // 130R
    'Q 438,295 425,275 Q 408,260 385,265 ' +   // Casio chicane
    'Q 362,272 350,290 Q 340,310 320,328 ' +
    // Chicane → back to S/F
    'Q 290,348 250,355 Q 200,358 150,355 ' +
    'L 100,350 Z',
  features: {
    corners: [
      { name: 'Turn 1-2', ratio: 0.05, highlight: true },
      { name: 'S-Curves', ratio: 0.12, highlight: true },
      { name: 'Dunlop', ratio: 0.22 },
      { name: 'Degner 1', ratio: 0.30 },
      { name: 'Degner 2', ratio: 0.34 },
      { name: 'Spoon', ratio: 0.52, highlight: true },
      { name: '130R', ratio: 0.75, highlight: true },
      { name: 'Casio Triangle', ratio: 0.86, highlight: true },
    ],
  },
}

// ---------------------------------------------------------------------------
// Jeddah — Jeddah Corniche Circuit (6.174 km)
// ---------------------------------------------------------------------------
const JEDDAH: TrackDefinition = {
  id: 'JEDDAH',
  displayName: 'Jeddah Corniche Circuit',
  lengthMeters: 6174,
  sectors: [0.33, 0.66],
  drsZones: [
    { start_ratio: 0.01, end_ratio: 0.08, detection_ratio: 0.94, label: 'DRS1' },
    { start_ratio: 0.48, end_ratio: 0.56, detection_ratio: 0.42, label: 'DRS2' },
    { start_ratio: 0.72, end_ratio: 0.80, detection_ratio: 0.66, label: 'DRS3' },
  ],
  pitLane: { start_ratio: 0.88, end_ratio: 0.97 },
  transformHint: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0, flipX: false, flipY: false },
  svgPath:
    'M 60,480 L 60,300 ' +
    'Q 60,260 80,230 Q 105,195 140,175 ' +
    'Q 180,155 220,150 L 300,150 ' +
    'Q 350,150 380,130 Q 410,105 430,75 ' +
    'Q 445,50 460,40 Q 478,32 490,50 ' +
    'Q 498,72 490,100 Q 478,130 455,155 ' +
    'Q 430,182 400,195 ' +
    'L 350,215 Q 320,228 300,250 ' +
    'Q 282,275 280,305 L 280,380 ' +
    'Q 280,420 300,445 Q 325,468 360,475 ' +
    'L 440,480 Q 470,480 485,465 Q 498,445 490,420 ' +
    'Q 478,395 455,390 L 380,385 ' +
    'Q 340,385 310,400 Q 280,418 260,440 ' +
    'Q 235,465 200,478 Q 160,488 120,485 ' +
    'L 60,480 Z',
  features: {
    corners: [
      { name: 'Turn 1', ratio: 0.04 },
      { name: 'Turn 4', ratio: 0.15 },
      { name: 'Turn 13', ratio: 0.48 },
      { name: 'Turn 22', ratio: 0.78 },
      { name: 'Turn 27', ratio: 0.93, highlight: true },
    ],
  },
}

// ---------------------------------------------------------------------------
// Bahrain — Bahrain International Circuit (5.412 km)
// ---------------------------------------------------------------------------
const BAHRAIN: TrackDefinition = {
  id: 'BAHRAIN',
  displayName: 'Bahrain International Circuit',
  lengthMeters: 5412,
  sectors: [0.33, 0.66],
  drsZones: [
    { start_ratio: 0.00, end_ratio: 0.07, detection_ratio: 0.93, label: 'DRS1' },
    { start_ratio: 0.33, end_ratio: 0.42, detection_ratio: 0.27, label: 'DRS2' },
    { start_ratio: 0.65, end_ratio: 0.73, detection_ratio: 0.59, label: 'DRS3' },
  ],
  pitLane: { start_ratio: 0.88, end_ratio: 0.97 },
  transformHint: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0, flipX: false, flipY: false },
  svgPath:
    'M 200,470 L 400,470 ' +
    'Q 440,468 460,445 Q 478,418 470,390 ' +
    'L 460,350 Q 458,320 440,300 Q 418,278 395,270 ' +
    'L 350,260 Q 320,255 300,240 Q 278,222 270,200 ' +
    'Q 262,175 270,150 L 285,110 ' +
    'Q 295,80 280,58 Q 262,40 235,42 Q 210,48 200,70 ' +
    'L 190,120 Q 182,150 165,170 ' +
    'Q 145,195 120,215 Q 90,240 70,270 ' +
    'Q 50,305 45,340 ' +
    'Q 40,380 55,415 Q 75,448 110,462 ' +
    'L 200,470 Z',
  features: {
    corners: [
      { name: 'Turn 1', ratio: 0.06, highlight: true },
      { name: 'Turn 4', ratio: 0.18, highlight: true },
      { name: 'Turn 8', ratio: 0.35 },
      { name: 'Turn 10', ratio: 0.48, highlight: true },
      { name: 'Turn 11', ratio: 0.56 },
      { name: 'Turn 14', ratio: 0.80 },
    ],
  },
}

// ---------------------------------------------------------------------------
// Registry — maps track ID strings to definitions
// ---------------------------------------------------------------------------
const DEFINITIONS: Record<string, TrackDefinition> = {
  MONACO,
  MONZA,
  SPA,
  SILVERSTONE,
  SUZUKA,
  JEDDAH,
  BAHRAIN,
}

/**
 * Look up a track definition by the track ID string from the backend.
 * The search is case-insensitive and supports partial matching
 * (e.g. "TRACK_MONACO" → MONACO).
 */
export function getTrackDefinition(trackId: string | undefined): TrackDefinition | null {
  if (!trackId) return null
  const key = trackId.toUpperCase()
  for (const [id, def] of Object.entries(DEFINITIONS)) {
    if (key === id || key.includes(id)) return def
  }
  return null
}

/** Get all available track definition IDs. */
export function getAvailableTrackIds(): string[] {
  return Object.keys(DEFINITIONS)
}

export { DEFINITIONS as TRACK_DEFINITIONS }
