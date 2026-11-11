import { useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer } from '@react-three/drei'
import { useSim } from '../store'
import { HOME_VIEW, liveCh, manual, userCam } from '../live'
import {
  DURATION,
  EXPLODED_VIEW,
  PART_INFO,
  cameraPose,
  channels,
  clamp,
  lerp,
  type CameraPose,
  type Channels,
  type PartKey,
} from '../timeline'
import { Machine } from './Machine'

const DEG = Math.PI / 180
const CH_KEYS = Object.keys(liveCh) as (keyof Channels)[]

/** Fly the free camera to a pose, turning the short way round. */
function flyTo(p: CameraPose) {
  const turn = ((((p.yaw - userCam.gYaw) % 360) + 540) % 360) - 180
  userCam.gYaw += turn
  userCam.gPitch = p.pitch
  userCam.gDist = p.dist
  userCam.gTarget = [...p.target]
}

/**
 * Runs first every frame: advances the film, eases the inspector's parts and
 * camera, and blends between the two so taking over (or pressing play) never jumps.
 */
function Driver() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const acc = useRef(0)
  const prevMode = useRef(useSim.getState().mode)
  const prevFocus = useRef<PartKey | null>(null)
  const prevExploded = useRef(false)
  const prevReset = useRef(0)
  /** 0 = film in control, 1 = inspector in control. */
  const mix = useRef(0)

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.05)
    const s = useSim.getState()

    // ---- film clock
    let t = s.t
    if (s.mode === 'film' && s.playing) {
      t = Math.min(DURATION, t + step)
      useSim.setState({ t, playing: t < DURATION })
    }
    acc.current += dt
    if (acc.current > 0.1) {
      acc.current = 0
      useSim.setState((st) => ({ tick: st.tick + 1 }))
    }
    const film = channels(t)
    const filmPose = cameraPose(t)

    // ---- hand-off: the inspector starts exactly where the film is
    if (s.mode === 'inspect' && prevMode.current === 'film') {
      for (const k of CH_KEYS) manual[k] = lerp(film[k], manual[k], mix.current)
      const from = mix.current
      userCam.yaw = userCam.gYaw = lerp(filmPose.yaw, userCam.yaw, from)
      userCam.pitch = userCam.gPitch = lerp(filmPose.pitch, userCam.pitch, from)
      userCam.dist = userCam.gDist = lerp(filmPose.dist, userCam.dist, from)
      userCam.target = filmPose.target.map((v, i) => lerp(v, userCam.target[i], from)) as [number, number, number]
      userCam.gTarget = [...userCam.target]
      mix.current = 1
      prevFocus.current = null
      prevExploded.current = false
    }
    if (s.mode === 'film' && prevMode.current === 'inspect') {
      // keep the yaw near the film's range so the blend back does not spin around
      userCam.yaw = ((((userCam.yaw % 360) + 540) % 360) - 180)
    }
    prevMode.current = s.mode

    if (s.mode === 'inspect') {
      // ---- parts follow what the user pulled out
      const inner = s.out.coolant || s.out.radiator || s.out.chip || s.out.cables
      const goal: Channels = {
        power: s.powered ? 1 : 0,
        lid: s.out.lid ? 1 : 0,
        fans: s.out.fans ? 1 : 0,
        // working inside the case needs the lid and fans out of the way
        clear: inner && !s.exploded ? 1 : 0,
        coolant: s.out.coolant ? 1 : 0,
        pipesAway: s.out.coolant && !s.out.radiator && !s.exploded ? 1 : 0,
        radiator: s.out.radiator ? 1 : 0,
        chip: s.out.chip ? 1 : 0,
        cables: s.out.cables ? 1 : 0,
        explode: s.exploded ? 1 : 0,
      }
      const k = 1 - Math.exp(-step * 4.5)
      for (const key of CH_KEYS) {
        manual[key] += (goal[key] - manual[key]) * k
        if (Math.abs(goal[key] - manual[key]) < 0.0005) manual[key] = goal[key]
      }

      // ---- camera flies to whatever was just picked
      if (s.focus !== prevFocus.current) {
        if (s.focus) flyTo(PART_INFO[s.focus].view)
        else if (!s.exploded) {
          userCam.gDist = Math.max(userCam.gDist, HOME_VIEW.dist)
          userCam.gTarget = [...HOME_VIEW.target]
        }
        prevFocus.current = s.focus
      }
      if (s.exploded !== prevExploded.current) {
        flyTo(s.exploded ? EXPLODED_VIEW : HOME_VIEW)
        prevExploded.current = s.exploded
      }
      if (s.viewReset !== prevReset.current) {
        flyTo(HOME_VIEW)
        prevReset.current = s.viewReset
      }
      const ck = 1 - Math.exp(-step * 5)
      userCam.yaw += (userCam.gYaw - userCam.yaw) * ck
      userCam.pitch += (userCam.gPitch - userCam.pitch) * ck
      userCam.dist += (userCam.gDist - userCam.dist) * ck
      for (let i = 0; i < 3; i++) userCam.target[i] += (userCam.gTarget[i] - userCam.target[i]) * ck
    } else {
      prevReset.current = s.viewReset
      mix.current = Math.max(0, mix.current - step / 0.8)
    }

    // ---- blend and publish
    const m = mix.current * mix.current * (3 - 2 * mix.current)
    for (const key of CH_KEYS) liveCh[key] = lerp(film[key], manual[key], m)

    const yaw = lerp(filmPose.yaw, userCam.yaw, m) * DEG
    const pitch = clamp(lerp(filmPose.pitch, userCam.pitch, m), 2, 88) * DEG
    // the film is framed for 16:9; pull back on narrower windows
    const aspect = size.width / size.height
    const dist = lerp(filmPose.dist, userCam.dist, m) * Math.max(1, 16 / 9 / aspect)
    const tx = lerp(filmPose.target[0], userCam.target[0], m)
    const ty = lerp(filmPose.target[1], userCam.target[1], m)
    const tz = lerp(filmPose.target[2], userCam.target[2], m)
    camera.position.set(
      tx + dist * Math.sin(yaw) * Math.cos(pitch),
      ty + dist * Math.sin(pitch),
      tz + dist * Math.cos(yaw) * Math.cos(pitch),
    )
    camera.lookAt(tx, ty, tz)
    // callouts project against this frame's camera, not last frame's
    camera.updateMatrixWorld()
  })
  return null
}

export function Scene() {
  const drag = useRef<{ x: number; y: number } | null>(null)
  const tip = useRef<HTMLDivElement>(null)
  const hover = useSim((s) => s.hover)
  const hint = useSim((s) => {
    if (!s.hover || s.mode === 'film' || !s.out[s.hover]) return 'CLICK TO PULL OUT'
    return s.focus === s.hover ? 'CLICK TO PUT BACK' : 'CLICK TO FOCUS'
  })

  const endDrag = () => {
    drag.current = null
  }

  return (
    <div
      className={`stage ${hover ? 'hovering' : ''}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        drag.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerMove={(e) => {
        if (tip.current) tip.current.style.transform = `translate3d(${e.clientX + 14}px, ${e.clientY + 16}px, 0)`
        if (!drag.current) return
        const dx = e.clientX - drag.current.x
        const dy = e.clientY - drag.current.y
        if (useSim.getState().mode === 'film') {
          // a real drag (not a click) takes the camera over from the film
          if (Math.hypot(dx, dy) < 4) return
          useSim.getState().enterInspect()
          drag.current = { x: e.clientX, y: e.clientY }
          return
        }
        userCam.gYaw -= dx * 0.3
        userCam.gPitch = clamp(userCam.gPitch + dy * 0.22, 3, 86)
        drag.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => {
        endDrag()
        useSim.getState().setHover(null)
      }}
      onWheel={(e) => {
        if (useSim.getState().mode === 'film') useSim.getState().enterInspect()
        userCam.gDist = clamp(userCam.gDist * Math.exp(e.deltaY * 0.0012), 3.2, 24)
      }}
      onDoubleClick={() => useSim.getState().resetView()}
    >
      <Canvas
        shadows="percentage"
        dpr={[1, 2]}
        camera={{ fov: 30, near: 0.1, far: 80, position: [0, 4, 10] }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        onPointerMissed={() => {
          const s = useSim.getState()
          if (s.mode === 'inspect' && s.focus) s.setFocus(null)
        }}
      >
        <Driver />
        <hemisphereLight args={['#ffffff', '#b9bdb4', 0.35]} />
        <directionalLight
          position={[4.5, 9, 6]}
          intensity={1.7}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.02}
        >
          <orthographicCamera attach="shadow-camera" args={[-5, 5, 5, -5, 0.5, 30]} />
        </directionalLight>
        <directionalLight position={[-6, 4, 3]} intensity={0.5} />
        {/* studio product lighting, built in code so nothing is fetched */}
        <Environment resolution={256} frames={1}>
          <color attach="background" args={['#93979b']} />
          <Lightformer form="rect" intensity={3.2} position={[0, 6, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 8, 1]} />
          <Lightformer form="rect" intensity={2.2} position={[0, 2, 8]} scale={[14, 3, 1]} />
          <Lightformer form="rect" intensity={1.6} position={[-8, 2, 0]} rotation={[0, Math.PI / 2, 0]} scale={[8, 4, 1]} />
          <Lightformer form="rect" intensity={1.6} position={[8, 2, 0]} rotation={[0, -Math.PI / 2, 0]} scale={[8, 4, 1]} />
          <Lightformer form="rect" intensity={0.25} color="#20242a" position={[0, -4, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[14, 14, 1]} />
        </Environment>
        <Machine />
        <ContactShadows position={[0, -0.21, 0]} scale={16} far={3.4} blur={2.0} opacity={0.72} resolution={512} color="#2c3126" />
      </Canvas>
      <div id="callouts" />
      <div ref={tip} className={`tip ${hover ? 'on' : ''}`}>
        <b>{hover ? PART_INFO[hover].title : ''}</b>
        <span>{hint}</span>
      </div>
    </div>
  )
}
