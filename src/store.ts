import { create } from 'zustand'
import { DURATION, type PartKey } from './timeline'

const ALL_IN: Record<PartKey, boolean> = {
  lid: false,
  fans: false,
  coolant: false,
  radiator: false,
  chip: false,
  cables: false,
}

interface SimState {
  /** 'film' follows the 24 s timeline; 'inspect' hands parts and camera to the user. */
  mode: 'film' | 'inspect'
  /** Position on the film timeline. */
  t: number
  playing: boolean
  /** Bumped at 10 Hz so the HUD re-renders without following every frame. */
  tick: number

  // ---- inspection
  out: Record<PartKey, boolean>
  exploded: boolean
  powered: boolean
  /** Part shown in the detail panel and framed by the camera. */
  focus: PartKey | null
  hover: PartKey | null
  /** Bumped to ask the camera to fly back to the home view. */
  viewReset: number

  toggle: () => void
  seek: (t: number) => void
  enterInspect: () => void
  pick: (k: PartKey) => void
  putBack: (k: PartKey) => void
  setFocus: (k: PartKey | null) => void
  setHover: (k: PartKey | null) => void
  toggleExplode: () => void
  togglePower: () => void
  reassemble: () => void
  resetView: () => void
}

// `?t=14.6` opens the page parked on that second of the film (handy for stills).
const startAt = Number(new URLSearchParams(window.location.search).get('t'))
const parked = window.location.search.includes('t=') && Number.isFinite(startAt)

export const useSim = create<SimState>((set, get) => {
  /** State to merge when an action takes over from the film. */
  const takeover = (): Partial<SimState> =>
    get().mode === 'film'
      ? { mode: 'inspect', playing: false, out: { ...ALL_IN }, exploded: false, powered: true, focus: null }
      : {}

  return {
    mode: 'film',
    t: parked ? Math.max(0, Math.min(DURATION, startAt)) : 0,
    playing: !parked,
    tick: 0,
    out: { ...ALL_IN },
    exploded: false,
    powered: true,
    focus: null,
    hover: null,
    viewReset: 0,

    toggle: () => {
      const { mode, playing, t } = get()
      if (mode === 'inspect') {
        set({ mode: 'film', playing: true, focus: null, hover: null, t: t >= DURATION - 0.01 ? 0 : t })
      } else if (!playing && t >= DURATION - 0.01) set({ t: 0, playing: true })
      else set({ playing: !playing })
    },
    seek: (t) => set({ mode: 'film', focus: null, t: Math.max(0, Math.min(DURATION, t)) }),

    enterInspect: () => set(takeover()),
    pick: (k) => {
      const base = takeover()
      const s = { ...get(), ...base }
      // first click pulls the part and focuses it; clicking the focused part puts it back
      if (s.out[k] && s.focus === k) set({ ...base, out: { ...s.out, [k]: false }, focus: null })
      else set({ ...base, out: { ...s.out, [k]: true }, focus: k })
    },
    putBack: (k) => set((s) => ({ out: { ...s.out, [k]: false }, focus: s.focus === k ? null : s.focus })),
    setFocus: (k) => set({ focus: k }),
    setHover: (k) => {
      if (get().hover !== k) set({ hover: k })
    },
    toggleExplode: () => {
      const base = takeover()
      const s = { ...get(), ...base }
      set({ ...base, exploded: !s.exploded, focus: null })
    },
    togglePower: () => {
      const base = takeover()
      const s = { ...get(), ...base }
      set({ ...base, powered: get().mode === 'film' ? false : !s.powered })
    },
    reassemble: () => set({ ...takeover(), out: { ...ALL_IN }, exploded: false, focus: null }),
    resetView: () => set((s) => ({ ...takeover(), viewReset: s.viewReset + 1 })),
  }
})
