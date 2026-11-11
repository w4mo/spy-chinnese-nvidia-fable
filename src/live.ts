// Per-frame state shared by the scene and the HUD. The Driver in Scene.tsx
// writes it once per frame; everything else only reads.
import { useSim } from './store'
import { channels, telemetry, type Channels } from './timeline'

/** What the parts actually do this frame: the film's channels, the inspector's, or a blend. */
export const liveCh: Channels = { ...channels(0) }

/** Inspector-driven channel values, eased toward the parts the user pulled out. */
export const manual: Channels = { ...channels(0) }

/** Free camera used while inspecting. `g*` are the goals the camera eases toward. */
export const userCam = {
  yaw: 30,
  pitch: 31,
  dist: 11.6,
  target: [0, 0.5, 0] as [number, number, number],
  gYaw: 30,
  gPitch: 31,
  gDist: 11.6,
  gTarget: [0, 0.5, 0] as [number, number, number],
}

export const HOME_VIEW = { yaw: 30, pitch: 31, dist: 11.6, target: [0, 0.5, 0] as [number, number, number] }

export function liveTelemetry(wall: number) {
  const s = useSim.getState()
  return telemetry(s.t, wall, s.mode === 'inspect' ? liveCh : undefined)
}
