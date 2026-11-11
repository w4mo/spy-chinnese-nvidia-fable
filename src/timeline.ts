// Single source of truth for the film: the 3D parts, the camera and every
// gauge in the HUD are pure functions of the timeline position `t` (seconds).

export const DURATION = 24

export type BeatId =
  | 'power'
  | 'lid'
  | 'fans'
  | 'coolant'
  | 'radiator'
  | 'chip'
  | 'cables'
  | 'exploded'
  | 'run'

export interface Beat {
  id: BeatId
  label: string
  start: number
  end: number
  /** Where playback parks when the beat is triggered from its button. */
  hold: number
}

export const BEATS: Beat[] = [
  { id: 'power', label: 'POWER ON', start: 0, end: 2.8, hold: 2.8 },
  { id: 'lid', label: 'LID', start: 2.8, end: 5.3, hold: 4.5 },
  { id: 'fans', label: 'FANS', start: 5.3, end: 7.8, hold: 6.9 },
  { id: 'coolant', label: 'COOLANT', start: 7.8, end: 10.4, hold: 9.8 },
  { id: 'radiator', label: 'RADIATOR', start: 10.4, end: 12.9, hold: 12.1 },
  { id: 'chip', label: 'CHIP', start: 12.9, end: 15.4, hold: 14.6 },
  { id: 'cables', label: 'CABLES', start: 15.4, end: 17.9, hold: 17.1 },
  { id: 'exploded', label: 'EXPLODED VIEW', start: 17.9, end: 20.5, hold: 19.7 },
  { id: 'run', label: 'POWER ON', start: 20.5, end: 24, hold: 24 },
]

export const SUBSYSTEMS: { id: BeatId; name: string; desc: string }[] = [
  { id: 'lid', name: 'LID', desc: 'LOGO PANEL LIFTS OFF' },
  { id: 'fans', name: 'FANS', desc: '2 FANS, 13 BLADES EACH' },
  { id: 'coolant', name: 'COOLANT', desc: 'GLASS RESERVOIR, 2 PUMPS' },
  { id: 'radiator', name: 'RADIATOR', desc: '21-FIN STACK' },
  { id: 'chip', name: 'CHIP', desc: 'GB10: 20 ARM CORES + BLACKWELL GPU' },
  { id: 'cables', name: 'CABLES', desc: '7 BRAIDED CABLES' },
  { id: 'power', name: 'POWER ON', desc: 'UP TO 1 PETAFLOP OF FP4 AI' },
]

export const ASSEMBLY_BUTTONS: { id: BeatId; label: string }[] = [
  { id: 'lid', label: 'LID' },
  { id: 'fans', label: 'FANS' },
  { id: 'coolant', label: 'COOLANT' },
  { id: 'radiator', label: 'RADIATOR' },
  { id: 'chip', label: 'CHIP' },
  { id: 'cables', label: 'CABLES' },
  { id: 'exploded', label: 'EXPLODED VIEW' },
  { id: 'power', label: 'POWER ON' },
]

// ---------------------------------------------------------------- helpers

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k
/** Smoothstep ramp 0→1 between a and b. */
export const ss = (a: number, b: number, x: number) => {
  const k = clamp((x - a) / (b - a))
  return k * k * (3 - 2 * k)
}
/** Rise over [a,b], hold, fall over [c,d]. */
export const env = (x: number, a: number, b: number, c: number, d: number) =>
  ss(a, b, x) * (1 - ss(c, d, x))

export function beatAt(t: number): Beat {
  for (let i = BEATS.length - 1; i >= 0; i--) if (t >= BEATS[i].start) return BEATS[i]
  return BEATS[0]
}

// ---------------------------------------------------------------- part channels

export interface Channels {
  /** Lime lighting / machine alive. */
  power: number
  lid: number
  fans: number
  /** Lid and fans lifted out of frame so the inside can be worked on. */
  clear: number
  coolant: number
  /** Pipe loom lifted out of the way while the reservoir comes out. */
  pipesAway: number
  radiator: number
  chip: number
  cables: number
  explode: number
}

let cacheT = -1
let cache: Channels | null = null

export function channels(t: number): Channels {
  if (cache && t === cacheT) return cache
  cacheT = t
  cache = {
    power: ss(0.3, 1.3, t),
    lid: env(t, 3.2, 4.0, 4.9, 5.5),
    fans: env(t, 5.6, 6.4, 7.3, 7.9),
    clear: env(t, 7.7, 8.5, 17.5, 18.2),
    coolant: env(t, 8.7, 9.4, 10.1, 10.7),
    pipesAway: env(t, 7.8, 8.5, 10.2, 10.9),
    radiator: env(t, 10.8, 11.5, 12.5, 13.1),
    chip: env(t, 13.2, 13.9, 15.0, 15.6),
    cables: env(t, 15.9, 16.6, 17.5, 18.1),
    explode: env(t, 18.0, 19.3, 20.0, 21.3),
  }
  return cache
}

// ---------------------------------------------------------------- camera

export interface CameraPose {
  /** Degrees around the Y axis, 0 = straight in front (+Z), positive toward +X. */
  yaw: number
  pitch: number
  dist: number
  target: [number, number, number]
}

interface CamKey extends CameraPose {
  t: number
  /** Travel linearly into this key (used for the continuous orbit). */
  linear?: boolean
}

// Every beat gets its own side and its own distance, aimed at its own part.
const CAM_KEYS: CamKey[] = [
  { t: 0, yaw: -38, pitch: 13, dist: 11, target: [0, 0.6, 0] },
  { t: 0.4, yaw: -38, pitch: 13, dist: 11, target: [0, 0.6, 0] },
  { t: 2.1, yaw: 28, pitch: 31, dist: 11.6, target: [0, 0.5, 0] },
  { t: 2.9, yaw: 31, pitch: 31, dist: 11.6, target: [0, 0.5, 0] },
  { t: 3.9, yaw: 9, pitch: 37, dist: 11.8, target: [0, 1.05, 0] },
  { t: 5.0, yaw: 13, pitch: 37, dist: 11.8, target: [0, 1.05, 0] },
  { t: 6.1, yaw: 30, pitch: 31, dist: 12.6, target: [0, 1.35, 0] },
  { t: 7.6, yaw: 36, pitch: 31, dist: 12.6, target: [0, 1.35, 0] },
  { t: 9.0, yaw: -50, pitch: 27, dist: 8.2, target: [-0.7, 1.3, 0] },
  { t: 10.2, yaw: -55, pitch: 27, dist: 8.2, target: [-0.7, 1.3, 0] },
  { t: 11.3, yaw: 50, pitch: 29, dist: 9.2, target: [0.4, 1.0, 0] },
  { t: 12.7, yaw: 57, pitch: 29, dist: 9.2, target: [0.4, 1.0, 0] },
  { t: 13.8, yaw: 5, pitch: 45, dist: 6.6, target: [-0.1, 0.75, -0.2] },
  { t: 15.2, yaw: 10, pitch: 45, dist: 6.6, target: [-0.1, 0.75, -0.2] },
  { t: 16.4, yaw: -42, pitch: 38, dist: 8.2, target: [0.5, 0.95, -0.2] },
  { t: 17.7, yaw: -37, pitch: 38, dist: 8.2, target: [0.5, 0.95, -0.2] },
  { t: 18.7, yaw: -4, pitch: 13, dist: 17, target: [0, 1.35, 0] },
  { t: 19.6, yaw: 52, pitch: 27, dist: 17.5, target: [0, 1.35, 0], linear: true },
  { t: 20.4, yaw: 100, pitch: 30, dist: 17, target: [0, 1.25, 0], linear: true },
  { t: 21.7, yaw: 40, pitch: 31, dist: 11.8, target: [0, 0.5, 0] },
  { t: 24, yaw: 28, pitch: 31, dist: 11.6, target: [0, 0.5, 0] },
]

export function cameraPose(t: number): CameraPose {
  let i = 0
  while (i < CAM_KEYS.length - 2 && t >= CAM_KEYS[i + 1].t) i++
  const a = CAM_KEYS[i]
  const b = CAM_KEYS[i + 1]
  const raw = clamp((t - a.t) / (b.t - a.t))
  const k = b.linear ? raw : raw * raw * (3 - 2 * raw)
  return {
    yaw: lerp(a.yaw, b.yaw, k),
    pitch: lerp(a.pitch, b.pitch, k),
    dist: lerp(a.dist, b.dist, k),
    target: [
      lerp(a.target[0], b.target[0], k),
      lerp(a.target[1], b.target[1], k),
      lerp(a.target[2], b.target[2], k),
    ],
  }
}

// ---------------------------------------------------------------- telemetry

export interface Telemetry {
  rpm: number
  peak: number
  temp: number
  watts: number
  drawPct: number
  cores: number[]
}

/** Gauges ride the same timeline as the parts; `wall` only adds live jitter. */
export function telemetry(t: number, wall: number, inspect?: Channels): Telemetry {
  // While inspecting, the gauges follow the parts the user has out instead of the film clock.
  const c = inspect ?? channels(t)
  const boot = inspect ? 0 : env(t, 0.35, 0.7, 0.8, 2.0)
  const spin = inspect ? c.power : ss(0.4, 1.6, t)
  const ex = inspect ? c.explode : env(t, 18.0, 19.0, 21.0, 23.0)
  const surge = inspect ? 0 : env(t, 0.8, 1.6, 1.9, 2.9)
  const warm = inspect ? c.power : ss(0.4, 3.0, t)

  const rpmRaw = 1300 * spin + 900 * surge + 2100 * c.fans * spin + 500 * c.chip + 900 * ex
  const rpm = Math.round(rpmRaw / 10) * 10
  const peak = Math.round(
    Math.min(100, 68 * Math.min(1, rpmRaw / 1300) + 32 * clamp((rpmRaw - 1300) / 2100) * 1.6),
  )

  const temp = Math.round(26 + 16 * warm + 27 * c.chip + 10 * ex)

  const jitter = c.power * (2 * Math.sin(wall * 2.3) + 1.5 * Math.sin(wall * 5.1))
  const watts = Math.max(3, Math.round(3 + 50 * c.power + 100 * boot + 132 * c.chip + 26 * ex + jitter))

  const cores: number[] = []
  for (let i = 0; i < 10; i++) {
    const n = 0.5 + 0.5 * Math.sin(wall * (0.9 + 0.13 * i) + i * 1.7) * Math.sin(wall * 0.47 + i * 2.9)
    const v =
      c.power * (3 + 16 * n) +
      boot * (44 + 9 * Math.sin(i * 2.4)) +
      c.chip * (68 + 9 * Math.sin(i * 1.9 + wall * 1.4)) +
      ex * 11
    cores.push(Math.round(clamp(v, 0, 99)))
  }

  return { rpm, peak, temp, watts, drawPct: Math.round(clamp(watts / 240) * 100), cores }
}

// ---------------------------------------------------------------- HUD copy

export type Badge = 'STBY' | 'OPEN' | 'OK'

export interface HudState {
  beat: Beat
  /** Button highlighted in ASSEMBLIES. */
  activeButton: BeatId
  view: string
  mode: string
  modeSub: string
  status: string
  caption: string
  next: string
  coresBadge: 'IDLE' | 'ACTIVE' | 'DETACHED'
  badges: Badge[]
}

const OUT_LABEL: Partial<Record<BeatId, string>> = {
  lid: 'LID OFF',
  fans: 'FANS OUT',
  coolant: 'RESERVOIR OUT',
  radiator: 'RADIATOR UP',
  chip: 'SPREADER OFF',
  cables: 'CABLES OUT',
}

const CAPTION: Record<BeatId, string> = {
  power: '240 W POWER SUPPLY',
  lid: '2 FAN BAYS, 74-SLOT GRILLE',
  fans: 'LIME RING ON EVERY HUB',
  coolant: 'LIME COOLANT THROUGH THE PIPES',
  radiator: '3 PIPES IN, 1 RISER OUT',
  chip: 'ONE PACKAGE, 128 GB SHARED',
  cables: '2 BOXES LINKED RUN 405B PARAMS',
  exploded: 'MODELS UP TO 200B PARAMS',
  run: '240 W POWER SUPPLY',
}

export function hudState(t: number): HudState {
  const beat = beatAt(t)
  const c = channels(t)
  const idx = BEATS.indexOf(beat)
  const powerDesc = 'UP TO 1 PETAFLOP OF FP4 AI'

  let mode = 'IDLE'
  let modeSub = ''
  let status = 'ONLINE'
  let view = beat.label
  let caption = CAPTION[beat.id]

  if (beat.id === 'power') {
    if (t < 0.3) {
      mode = 'STANDBY'
      modeSub = 'GB10 GRACE BLACKWELL SUPERCHIP'
      view = 'OVERVIEW'
    } else {
      mode = t < 1.2 ? 'POWERING ON' : 'FANS SPINNING UP'
      modeSub = powerDesc
    }
    if (t < 1.0) caption = '128 GB UNIFIED MEMORY'
  } else if (beat.id === 'exploded') {
    mode = t < 19.9 ? 'TEARDOWN' : 'REASSEMBLY'
    modeSub = `${Math.round(c.explode * 100)}% APART`
    status = 'TEARDOWN'
  } else if (beat.id === 'run') {
    if (c.explode > 0.02) {
      mode = 'REASSEMBLY'
      modeSub = `${Math.round(c.explode * 100)}% APART`
    } else {
      mode = t < 23 ? 'SETTLING TO A STEADY RUN' : 'STEADY RUN'
      modeSub = powerDesc
    }
  } else {
    const amount = c[beat.id as 'lid' | 'fans' | 'coolant' | 'radiator' | 'chip' | 'cables']
    const sub = SUBSYSTEMS.find((s) => s.id === beat.id)!
    modeSub = sub.desc
    if (amount > 0.3) {
      mode = OUT_LABEL[beat.id]!
      status = 'PART OUT'
    }
  }

  const badges: Badge[] = SUBSYSTEMS.map((s, i) => {
    if (beat.id === 'power') {
      if (t < 0.3) return 'STBY'
      return s.id === 'power' ? 'OPEN' : 'OK'
    }
    if (beat.id === 'run') return s.id === 'power' ? 'OPEN' : 'OK'
    if (beat.id === 'exploded') return 'OPEN'
    // beats 1..6 line up with subsystem rows 0..5
    const row = idx - 1
    if (i === row) return 'OPEN'
    return i < row ? 'OK' : 'STBY'
  })

  const nextBeat = BEATS[idx + 1]
  const next = beat.id === 'exploded' || beat.id === 'run' || !nextBeat ? '–' : nextBeat.label

  return {
    beat,
    activeButton: beat.id === 'run' ? 'power' : beat.id,
    view,
    mode,
    modeSub,
    status,
    caption,
    next,
    coresBadge: c.explode > 0.3 ? 'DETACHED' : c.power < 0.5 ? 'IDLE' : 'ACTIVE',
    badges,
  }
}

// ---------------------------------------------------------------- inspection

export type PartKey = 'lid' | 'fans' | 'coolant' | 'radiator' | 'chip' | 'cables'
export const PART_KEYS: PartKey[] = ['lid', 'fans', 'coolant', 'radiator', 'chip', 'cables']

export interface PartInfo {
  title: string
  outLabel: string
  desc: string
  specs: [string, string][]
  /** Readings that move with the simulation. */
  live: (tm: Telemetry) => [string, string][]
  /** Camera the inspector flies to when the part is pulled. */
  view: CameraPose
}

export const PART_INFO: Record<PartKey, PartInfo> = {
  lid: {
    title: 'LID',
    outLabel: 'LID OFF',
    desc: 'Top panel with the logo plate. Lifts straight off to open both fan bays.',
    specs: [
      ['FAN BAYS', '2'],
      ['EXHAUST GRILLE', '74 SLOTS'],
      ['LOGO PLATE', 'LIME UNDERGLOW'],
    ],
    live: (tm) => [['POWER DRAW', `${tm.drawPct}%`]],
    view: { yaw: 10, pitch: 37, dist: 11.8, target: [0, 1.05, 0] },
  },
  fans: {
    title: 'FANS',
    outLabel: 'FANS OUT',
    desc: 'Two intake fans under the lid. They keep spinning out of the case and hit peak speed.',
    specs: [
      ['COUNT', '2'],
      ['BLADES', '13 EACH'],
      ['HUB', 'LIME RING'],
    ],
    live: (tm) => [
      ['SPEED', `${tm.rpm.toLocaleString('en-US')} RPM`],
      ['OF PEAK', `${tm.peak}%`],
    ],
    view: { yaw: 32, pitch: 31, dist: 12.6, target: [0, 1.35, 0] },
  },
  coolant: {
    title: 'COOLANT',
    outLabel: 'RESERVOIR OUT',
    desc: 'Glass reservoir and pumps that push lime coolant through the pipe loop.',
    specs: [
      ['RESERVOIR', 'GLASS'],
      ['PUMPS', '2 IN THE LOOP'],
      ['COOLANT', 'LIME'],
    ],
    live: (tm) => [['GPU TEMP', `${tm.temp} °C`]],
    view: { yaw: -52, pitch: 27, dist: 8.2, target: [-0.7, 1.3, 0] },
  },
  radiator: {
    title: 'RADIATOR',
    outLabel: 'RADIATOR UP',
    desc: 'Fin stack that sheds the loop heat. Comes up together with its pipe loom.',
    specs: [
      ['FINS', '21-FIN STACK'],
      ['PIPES IN', '3'],
      ['RISER OUT', '1'],
    ],
    live: (tm) => [
      ['GPU TEMP', `${tm.temp} °C`],
      ['FAN SPEED', `${tm.rpm.toLocaleString('en-US')} RPM`],
    ],
    view: { yaw: 54, pitch: 29, dist: 9.2, target: [0.4, 1.0, 0] },
  },
  chip: {
    title: 'CHIP',
    outLabel: 'SPREADER OFF',
    desc: 'GB10 superchip. Lifting the heat spreader exposes the die and loads the tensor cores.',
    specs: [
      ['PACKAGE', 'GB10'],
      ['CPU', '20 ARM CORES'],
      ['GPU', 'BLACKWELL'],
      ['MEMORY', '128 GB SHARED'],
      ['FP4', '1 PFLOP'],
    ],
    live: (tm) => [
      ['CORE LOAD', `${Math.round(tm.cores.reduce((a, b) => a + b, 0) / tm.cores.length)}%`],
      ['TEMP', `${tm.temp} °C`],
      ['POWER', `${tm.watts} W`],
    ],
    view: { yaw: 8, pitch: 45, dist: 6.6, target: [-0.1, 0.75, -0.2] },
  },
  cables: {
    title: 'CABLES',
    outLabel: 'CABLES OUT',
    desc: 'Braided loom from the chip to the network port that links two boxes together.',
    specs: [
      ['CABLES', '7 BRAIDED'],
      ['SLEEVES', 'LIME'],
      ['LINKED', '2 BOXES, 405B PARAMS'],
    ],
    live: (tm) => [['POWER', `${tm.watts} W`]],
    view: { yaw: -40, pitch: 38, dist: 8.2, target: [0.5, 0.95, -0.2] },
  },
}

export const EXPLODED_VIEW: CameraPose = { yaw: 48, pitch: 26, dist: 17.5, target: [0, 1.3, 0] }

/** HUD copy while the user is inspecting freely instead of watching the film. */
export function inspectHud(
  c: Channels,
  out: Record<PartKey, boolean>,
  exploded: boolean,
  powered: boolean,
  focus: PartKey | null,
): HudState {
  const anyOut = PART_KEYS.some((k) => out[k])
  const info = focus ? PART_INFO[focus] : null
  let mode = powered ? 'INSPECT' : 'STANDBY'
  let modeSub = 'CLICK A PART TO PULL IT OUT'
  if (info && focus) {
    mode = c[focus] > 0.3 ? info.outLabel : 'IDLE'
    modeSub = SUBSYSTEMS.find((s) => s.id === focus)!.desc
  } else if (exploded || c.explode > 0.02) {
    mode = exploded ? 'TEARDOWN' : 'REASSEMBLY'
    modeSub = `${Math.round(c.explode * 100)}% APART`
  }
  return {
    beat: BEATS[BEATS.length - 1],
    activeButton: 'run',
    view: info ? info.title : exploded ? 'EXPLODED VIEW' : 'FREE CAMERA',
    mode,
    modeSub,
    status: exploded ? 'TEARDOWN' : anyOut ? 'PART OUT' : 'ONLINE',
    caption: focus ? CAPTION[focus] : exploded ? CAPTION.exploded : 'FREE INSPECTION',
    next: '–',
    coresBadge: c.explode > 0.3 ? 'DETACHED' : c.power < 0.5 ? 'IDLE' : 'ACTIVE',
    badges: SUBSYSTEMS.map((s) => {
      if (s.id === 'power') return powered ? 'OPEN' : 'STBY'
      if (exploded) return 'OPEN'
      return out[s.id as PartKey] ? 'OPEN' : powered ? 'OK' : 'STBY'
    }),
  }
}
