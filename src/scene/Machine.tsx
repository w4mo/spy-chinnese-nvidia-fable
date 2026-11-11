import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import { useSim } from '../store'
import { type Channels, type PartKey } from '../timeline'
import { liveCh, liveTelemetry } from '../live'
import { M, applyPower } from './materials'

type V3 = [number, number, number]

// Case envelope: 4.4 long (x), 1.5 tall (y, floor at 0), 2.2 deep (z, window at +z).
const L = 4.4
const H = 1.5
const D = 2.2

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)
const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 24)
const UNIT_SPHERE = new THREE.SphereGeometry(1, 12, 10)

/** Shared between the fans and the halo pulse; advanced once per frame. */
const live = { fanAngle: 0, wall: 0 }

// ------------------------------------------------------------ primitives

function Box({ s, p, r, m }: { s: V3; p?: V3; r?: V3; m: THREE.Material }) {
  return <mesh geometry={UNIT_BOX} scale={s} position={p} rotation={r} material={m} />
}

function Cyl({
  r,
  h,
  p,
  rot,
  m,
  seg = 32,
}: {
  r: number
  h: number
  p?: V3
  rot?: V3
  m: THREE.Material
  seg?: number
}) {
  return (
    <mesh position={p} rotation={rot} material={m}>
      <cylinderGeometry args={[r, r, h, seg]} />
    </mesh>
  )
}

interface InstItem {
  p?: V3
  r?: V3
  s?: V3
  matrix?: THREE.Matrix4
}

function Inst({
  geo,
  mat,
  items,
}: {
  geo: THREE.BufferGeometry
  mat: THREE.Material
  items: InstItem[]
}) {
  const ref = useRef<THREE.InstancedMesh>(null!)
  useLayoutEffect(() => {
    const o = new THREE.Object3D()
    items.forEach((it, i) => {
      if (it.matrix) ref.current.setMatrixAt(i, it.matrix)
      else {
        o.position.set(...(it.p ?? [0, 0, 0]))
        o.rotation.set(...(it.r ?? [0, 0, 0]))
        o.scale.set(...(it.s ?? [1, 1, 1]))
        o.updateMatrix()
        ref.current.setMatrixAt(i, o.matrix)
      }
    })
    ref.current.instanceMatrix.needsUpdate = true
    ref.current.computeBoundingSphere()
  }, [items])
  return <instancedMesh ref={ref} args={[geo, mat, items.length]} />
}

/** Small screw heads; `axis` is the direction the head faces. */
function Screws({ at, axis = 'y', size = 0.024 }: { at: V3[]; axis?: 'x' | 'y' | 'z'; size?: number }) {
  const items = useMemo<InstItem[]>(
    () =>
      at.map((p) => ({
        p,
        r: axis === 'z' ? [Math.PI / 2, 0, 0] : axis === 'x' ? [0, 0, Math.PI / 2] : [0, 0, 0],
        s: [size, 0.02, size],
      })),
    [at, axis, size],
  )
  return <Inst geo={UNIT_CYL} mat={M.chrome} items={items} />
}

function mulberry(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ------------------------------------------------------------ part motion

type PartId =
  | 'lid'
  | 'fanL'
  | 'fanR'
  | 'coolant'
  | 'pipes'
  | 'radiator'
  | 'spreader'
  | 'cables'
  | 'sideL'
  | 'sideR'
  | 'glass'
  | 'base'
  | 'back'

/** Offset from the assembled pose: [x, y, z, rotX, rotY, rotZ]. */
const MOTION: Record<PartId, (c: Channels) => number[]> = {
  lid: (c) => [0, 0.95 * c.lid + 6 * c.clear + 1.5 * c.explode, -0.25 * c.lid, 0.3 * c.lid, 0, 0.08 * c.lid],
  fanL: (c) => [
    -0.35 * c.fans - 0.2 * c.explode,
    1.3 * c.fans + 6 * c.clear + 2.5 * c.explode,
    -0.3 * c.fans,
    0.55 * c.fans,
    0,
    0.25 * c.fans,
  ],
  fanR: (c) => [
    0.5 * c.fans + 0.2 * c.explode,
    0.9 * c.fans + 6 * c.clear + 2.5 * c.explode,
    0.35 * c.fans,
    0.62 * c.fans,
    0,
    -0.2 * c.fans,
  ],
  coolant: (c) => [-0.45 * c.explode, 1.25 * c.coolant + 0.4 * c.explode, 0, 0, 0, 0],
  pipes: (c) => [0, 5.5 * c.pipesAway + 0.95 * c.radiator + 0.75 * c.explode, 0.55 * c.explode, 0, 0, 0],
  radiator: (c) => [0.45 * c.explode, 0.95 * c.radiator + 0.3 * c.explode, 0, 0, 0, 0],
  spreader: (c) => [0, 0.9 * c.chip + 0.95 * c.explode, -0.65 * c.chip, 0.95 * c.chip, 0, 0.06 * c.chip],
  cables: (c) => [0, 1.15 * c.cables + 0.55 * c.explode, 0, 0, 0, 0.07 * c.cables],
  sideL: (c) => [-1.3 * c.explode, 0, 0, 0, 0, 0],
  sideR: (c) => [1.3 * c.explode, 0, 0, 0, 0, 0],
  glass: (c) => [0, 0, 1.5 * c.explode, 0, 0, 0],
  base: (c) => [0, -0.6 * c.explode, 0, 0, 0, 0],
  back: (c) => [0, 0, -0.9 * c.explode, 0, 0, 0],
}

/** Which inspectable assembly a moving part belongs to. */
const PICK: Partial<Record<PartId, PartKey>> = {
  lid: 'lid',
  fanL: 'fans',
  fanR: 'fans',
  coolant: 'coolant',
  pipes: 'radiator',
  radiator: 'radiator',
  spreader: 'chip',
  cables: 'cables',
}

/** Pointer handlers for a clickable assembly. A drag that ends on the part is not a click. */
function pickHandlers(key: PartKey) {
  // the lid and fans are parked out of sight while the inside is open: not pickable then
  const parked = () => (key === 'lid' || key === 'fans') && liveCh.clear > 0.5
  return {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (parked()) return
      e.stopPropagation()
      if (e.delta < 6) useSim.getState().pick(key)
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      if (parked()) return
      e.stopPropagation()
      useSim.getState().setHover(key)
    },
    onPointerOut: () => {
      if (useSim.getState().hover === key) useSim.getState().setHover(null)
    },
  }
}

/** Opaque shell pieces swallow the pointer so parts behind a wall cannot be picked through it. */
const BLOCK = {
  onClick: (e: ThreeEvent<MouseEvent>) => e.stopPropagation(),
  onPointerOver: (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    useSim.getState().setHover(null)
  },
}

function Part({ id, pivot = [0, 0, 0], children }: { id: PartId; pivot?: V3; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null!)
  const nudge = useRef(0)
  const key = PICK[id]
  useFrame((_, dt) => {
    const c = liveCh
    const m = MOTION[id](c)
    // a hovered part lifts a touch to show it can be pulled
    const want = key && useSim.getState().hover === key ? 1 : 0
    nudge.current += (want - nudge.current) * Math.min(1, dt * 10)
    ref.current.position.set(pivot[0] + m[0], pivot[1] + m[1] + 0.045 * nudge.current, pivot[2] + m[2])
    ref.current.rotation.set(m[3], m[4], m[5])
    // parts parked far above the frame should not shade the open case
    if (id === 'lid' || id === 'fanL' || id === 'fanR') ref.current.visible = c.clear < 0.97
    if (id === 'pipes') ref.current.visible = c.pipesAway < 0.97
  })
  const handlers = key ? pickHandlers(key) : id === 'glass' ? {} : BLOCK
  // children are authored in case coordinates; the part tilts around its own pivot
  return (
    <group ref={ref} {...handlers}>
      <group position={[-pivot[0], -pivot[1], -pivot[2]]}>{children}</group>
    </group>
  )
}

// ------------------------------------------------------------ callouts

/**
 * A leader-line label pinned to a point on a part. The label itself is a plain
 * DOM node in the #callouts layer; each frame the anchor is projected to the screen.
 */
function Callout({
  at,
  side,
  title,
  sub,
  len = 6,
  show,
}: {
  at: V3
  side: 'left' | 'right'
  title: string
  sub: string
  /** Leader length in rem. */
  len?: number
  show: (c: Channels) => number
}) {
  const anchor = useRef<THREE.Group>(null!)
  const el = useRef<HTMLDivElement | null>(null)
  const v = useMemo(() => new THREE.Vector3(), [])

  useLayoutEffect(() => {
    const layer = document.getElementById('callouts')
    if (!layer) return
    const node = document.createElement('div')
    node.className = `callout ${side}`
    node.style.opacity = '0'
    node.style.visibility = 'hidden'
    const dot = document.createElement('span')
    dot.className = 'callout-dot'
    const line = document.createElement('span')
    line.className = 'callout-line'
    line.style.width = `${len}rem`
    const label = document.createElement('span')
    label.className = 'callout-label'
    const b = document.createElement('b')
    b.append(document.createElement('i'), title)
    const small = document.createElement('small')
    small.textContent = sub
    label.append(b, small)
    node.append(dot, line, label)
    layer.append(node)
    el.current = node
    return () => {
      node.remove()
      el.current = null
    }
  }, [side, title, sub, len])

  useFrame(({ camera, size }) => {
    const node = el.current
    if (!node) return
    const o = THREE.MathUtils.smoothstep(show(liveCh), 0.75, 0.98)
    if (o < 0.01) {
      node.style.visibility = 'hidden'
      return
    }
    anchor.current.updateWorldMatrix(true, false)
    v.setFromMatrixPosition(anchor.current.matrixWorld).project(camera)
    const x = (v.x * 0.5 + 0.5) * size.width
    const y = (-v.y * 0.5 + 0.5) * size.height
    node.style.visibility = v.z < 1 ? 'visible' : 'hidden'
    node.style.opacity = String(o)
    node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
  })
  return <group ref={anchor} position={at} />
}

// ------------------------------------------------------------ shapes

function octShape(w: number, h: number, c: number) {
  const s = new THREE.Shape()
  const x = w / 2
  const y = h / 2
  s.moveTo(-x + c, -y)
  s.lineTo(x - c, -y)
  s.lineTo(x, -y + c)
  s.lineTo(x, y - c)
  s.lineTo(x - c, y)
  s.lineTo(-x + c, y)
  s.lineTo(-x, y - c)
  s.lineTo(-x, -y + c)
  s.closePath()
  return s
}

function octRing(w: number, h: number, c: number, t: number, depth: number) {
  const s = octShape(w, h, c)
  s.holes.push(new THREE.Path(octShape(w - 2 * t, h - 2 * t, Math.max(c - t * 0.6, 0.01)).getPoints()))
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false })
}

function tube(points: V3[], radius: number, segments = 48) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
    false,
    'catmullrom',
    0.35,
  )
  return { curve, geo: new THREE.TubeGeometry(curve, segments, radius, 12, false) }
}

// ------------------------------------------------------------ shell

function Frame() {
  const posts: V3[] = [
    [-2.14, 0.75, 1.04],
    [2.14, 0.75, 1.04],
    [-2.14, 0.75, -1.04],
    [2.14, 0.75, -1.04],
  ]
  const hexInset = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.1, 0.1, 0.03, 6)
    g.rotateX(Math.PI / 2)
    g.rotateZ(Math.PI / 6)
    return g
  }, [])
  const screws = useMemo<V3[]>(() => {
    const out: V3[] = []
    for (const x of [-1.9, -0.95, 0.95, 1.9]) out.push([x, 0.18, 1.105])
    for (const sx of [-1, 1]) for (const dx of [-0.52, 0.52]) out.push([sx * 1.42 + dx, 1.38, 1.115])
    for (const sx of [-1, 1]) for (const y of [0.25, 1.25]) out.push([sx * 2.14, y, 1.105])
    return out
  }, [])
  return (
    <group {...BLOCK}>
      <Box s={[L, 0.08, D]} p={[0, 0.04, 0]} m={M.silver} />
      <Box s={[4.1, 0.02, 2.0]} p={[0, 0.09, 0]} m={M.dark} />
      {posts.map((p, i) => (
        <Box key={i} s={[0.12, H, 0.12]} p={p} m={M.silver} />
      ))}
      {/* rails */}
      <Box s={[4.16, 0.2, 0.1]} p={[0, 0.18, 1.05]} m={M.silver} />
      <Box s={[4.16, 0.1, 0.1]} p={[0, 1.45, 1.05]} m={M.silver} />
      <Box s={[4.16, 0.1, 0.1]} p={[0, 1.45, -1.05]} m={M.silver} />
      <Box s={[0.1, 0.1, 2.0]} p={[-2.14, 1.45, 0]} m={M.silver} />
      <Box s={[0.1, 0.1, 2.0]} p={[2.14, 1.45, 0]} m={M.silver} />
      {/* stepped lower lip with a vent comb */}
      <Box s={[0.9, 0.05, 0.02]} p={[-0.2, 0.13, 1.105]} m={M.dark} />
      {/* white shoulders with the hex cut-outs */}
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * 1.42, 1.28, 0.98]}>
          <RoundedBox args={[1.28, 0.3, 0.26]} radius={0.04} smoothness={3} material={M.white} />
          <mesh geometry={hexInset} scale={[2.1, 1, 1]} position={[0, 0, 0.125]} material={M.dark} />
        </group>
      ))}
      <Screws at={screws} axis="z" />
    </group>
  )
}

function Base() {
  return (
    <group>
      <Box s={[4.1, 0.2, 2.1]} p={[0, -0.1, 0]} m={M.base} />
      {[-1.15, 1.15].map((x) => (
        <group key={x}>
          <Box s={[0.8, 0.06, 0.03]} p={[x, -0.1, 1.056]} m={M.lime} />
          <mesh position={[x, -0.195, 1.3]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.7, 0.8, 1]} material={M.floorGlow}>
            <planeGeometry />
          </mesh>
          <sprite position={[x, -0.1, 1.09]} scale={[1.1, 0.3, 1]} material={M.halo} />
        </group>
      ))}
    </group>
  )
}

function BackWall() {
  const modules = useMemo(() => {
    const light: InstItem[] = []
    const dark: InstItem[] = []
    for (let i = 0; i < 12; i++) {
      const item: InstItem = { p: [-1.76 + i * 0.32, 0.93, -0.965], s: [0.2, 0.13, 0.13] }
      ;(i % 4 === 0 || i % 4 === 3 ? light : dark).push(item)
    }
    return { light, dark }
  }, [])
  const clips = useMemo<InstItem[]>(
    () => Array.from({ length: 11 }, (_, i) => ({ p: [-1.6 + i * 0.32, 1.12, -1.0] as V3, s: [0.05, 0.22, 0.03] as V3 })),
    [],
  )
  return (
    <group>
      <Box s={[4.16, 1.34, 0.06]} p={[0, 0.75, -1.07]} m={M.silver} />
      <Box s={[4.1, 1.3, 0.02]} p={[0, 0.75, -1.035]} m={M.dark} />
      <Box s={[3.95, 0.05, 0.12]} p={[0, 0.84, -0.965]} m={M.black} />
      <Box s={[3.95, 0.03, 0.05]} p={[0, 0.62, -0.99]} m={M.chrome} />
      <Inst geo={UNIT_BOX} mat={M.silver} items={modules.light} />
      <Inst geo={UNIT_BOX} mat={M.smd} items={modules.dark} />
      <Inst geo={UNIT_BOX} mat={M.black} items={clips} />
      {/* network port the cables land on */}
      <Box s={[0.62, 0.2, 0.1]} p={[1.1, 0.52, -0.98]} m={M.silver} />
      <Box s={[0.5, 0.1, 0.02]} p={[1.1, 0.52, -0.925]} m={M.dark} />
      <Callout
        at={[1.38, 0.55, -0.93]}
        side="right"
        title="NETWORK PORT"
        sub="2 BOXES RUN 405B PARAMS"
        len={5}
        show={(c) => c.cables}
      />
    </group>
  )
}

function SidePanel({ side }: { side: -1 | 1 }) {
  const geo = useMemo(
    () => ({
      plate: new THREE.ExtrudeGeometry(octShape(D, H, 0.28), { depth: 0.1, bevelEnabled: false }),
      bezel: octRing(2.02, 1.32, 0.27, 0.1, 0.035),
      grille: new THREE.ShapeGeometry(octShape(1.82, 1.12, 0.24)),
      trim: octRing(1.86, 1.16, 0.25, 0.034, 0.016),
    }),
    [],
  )
  const screws = useMemo<V3[]>(
    () => [
      [-0.98, 0.5, 0.14],
      [0.98, 0.5, 0.14],
      [-0.98, -0.5, 0.14],
      [0.98, -0.5, 0.14],
      [-0.6, 0.66, 0.14],
      [0.6, 0.66, 0.14],
      [-0.6, -0.66, 0.14],
      [0.6, -0.66, 0.14],
    ],
    [],
  )
  return (
    <group position={[side * 2.15, H / 2, 0]} rotation={[0, (side * Math.PI) / 2, 0]}>
      <mesh geometry={geo.plate} material={M.silver} />
      <mesh geometry={geo.bezel} position={[0, 0, 0.1]} material={M.white} />
      <mesh geometry={geo.grille} position={[0, 0, 0.104]} material={M.honeycomb} />
      <mesh geometry={geo.trim} position={[0, 0, 0.106]} material={M.lime} />
      <Screws at={screws} axis="z" />
    </group>
  )
}

// ------------------------------------------------------------ lid + fans

const FAN_X = 1.32
const FAN_Z = -0.05

function Lid() {
  const geo = useMemo(() => {
    const s = octShape(L, D, 0.18)
    for (const sx of [-1, 1]) {
      const hole = new THREE.Path()
      // shape y maps to world -z after the rotation below
      hole.absarc(sx * FAN_X, -FAN_Z, 0.77, 0, Math.PI * 2, true)
      s.holes.push(hole)
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false, curveSegments: 48 })
    g.rotateX(-Math.PI / 2)
    return g
  }, [])
  const slats = useMemo<InstItem[]>(
    () => Array.from({ length: 37 }, (_, i) => ({ p: [-1.26 + i * 0.07, 0.092, -0.96] as V3, s: [0.02, 0.012, 0.15] as V3 })),
    [],
  )
  const screws = useMemo<V3[]>(() => {
    const out: V3[] = []
    for (const x of [-2.05, -0.62, 0.62, 2.05]) for (const z of [-0.95, 0.95]) out.push([x, 0.085, z])
    for (const x of [-0.45, 0.45]) for (const z of [-0.42, 0.62]) out.push([x, 0.175, z])
    return out
  }, [])
  return (
    <group position={[0, H, 0]}>
      <mesh geometry={geo} material={M.silver} />
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * FAN_X, 0.08, FAN_Z]} rotation={[Math.PI / 2, 0, 0]} material={M.silver}>
          <torusGeometry args={[0.785, 0.016, 10, 64]} />
        </mesh>
      ))}
      {/* exhaust grille along the back edge */}
      <Box s={[2.66, 0.02, 0.18]} p={[0, 0.082, -0.96]} m={M.black} />
      <Inst geo={UNIT_BOX} mat={M.silver} items={slats} />
      {/* logo plate */}
      <RoundedBox args={[1.06, 0.09, 1.3]} radius={0.03} smoothness={3} position={[0, 0.125, 0.1]} material={M.white} />
      <Box s={[1.0, 0.03, 0.03]} p={[0, 0.093, 0.755]} m={M.lime} />
      <Box s={[0.03, 0.03, 0.5]} p={[-0.535, 0.093, 0.5]} m={M.lime} />
      <Box s={[0.03, 0.03, 0.5]} p={[0.535, 0.093, 0.5]} m={M.lime} />
      <mesh position={[0, 0.1715, 0.1]} rotation={[-Math.PI / 2, 0, 0]} material={M.lidLogo}>
        <planeGeometry args={[0.96, 0.3]} />
      </mesh>
      <Screws at={screws} />
      <Callout at={[-0.9, 0.1, -0.96]} side="left" title="EXHAUST GRILLE" sub="74 SLOTS" len={9} show={(c) => c.lid} />
      <Callout at={[0.5, 0.17, 0.3]} side="right" title="LOGO PANEL" sub="LIFTS OFF THE TOP" len={8} show={(c) => c.lid} />
    </group>
  )
}

function Fan({ side }: { side: -1 | 1 }) {
  const spin = useRef<THREE.Group>(null!)
  const blades = useMemo<InstItem[]>(() => {
    const out: InstItem[] = []
    const a = new THREE.Matrix4()
    const b = new THREE.Matrix4()
    for (let i = 0; i < 13; i++) {
      const m = new THREE.Matrix4().makeRotationY((i / 13) * Math.PI * 2)
      m.multiply(a.makeTranslation(0.44, 0, 0))
      m.multiply(a.makeRotationY(0.5)) // sweep
      m.multiply(b.makeRotationX(0.55)) // pitch
      m.multiply(a.makeScale(0.5, 0.014, 0.27))
      out.push({ matrix: m })
    }
    return out
  }, [])
  useFrame(() => {
    spin.current.rotation.y = -live.fanAngle * side
  })
  return (
    <group position={[side * FAN_X, 1.415, FAN_Z]}>
      {/* shroud */}
      <mesh material={M.black}>
        <cylinderGeometry args={[0.73, 0.73, 0.16, 64, 1, true]} />
      </mesh>
      <mesh position={[0, -0.075, 0]} rotation={[Math.PI / 2, 0, 0]} material={M.black}>
        <torusGeometry args={[0.715, 0.02, 8, 64]} />
      </mesh>
      <mesh material={M.black} scale={[-1, 1, 1]}>
        <cylinderGeometry args={[0.71, 0.71, 0.16, 64, 1, true]} />
      </mesh>
      <group ref={spin}>
        <Inst geo={UNIT_BOX} mat={M.black} items={blades} />
        <Cyl r={0.21} h={0.15} m={M.black} />
        <mesh position={[0, 0.076, 0]} rotation={[Math.PI / 2, 0, 0]} material={M.lime}>
          <torusGeometry args={[0.17, 0.022, 10, 48]} />
        </mesh>
        <Cyl r={0.1} h={0.02} p={[0, 0.078, 0]} m={M.dark} />
      </group>
      <sprite position={[0, 0.1, 0]} scale={[0.5, 0.5, 1]} material={M.halo} />
      {side === -1 ? (
        <Callout at={[-0.55, 0.05, 0.2]} side="left" title="FANS" sub="2, 13 BLADES EACH" len={5} show={(c) => c.fans} />
      ) : (
        <Callout at={[0.17, 0.08, 0]} side="right" title="HUB RING" sub="LIME, ON EACH FAN" len={6} show={(c) => c.fans} />
      )}
    </group>
  )
}

// ------------------------------------------------------------ cooling loop

const RES: V3 = [-1.72, 0.1, 0.55]

function Bubbles() {
  const ref = useRef<THREE.InstancedMesh>(null!)
  const seeds = useMemo(() => {
    const r = mulberry(7)
    return Array.from({ length: 16 }, () => ({ a: r() * Math.PI * 2, rad: r() * 0.14, ph: r(), sp: 0.25 + r() * 0.3, size: 0.011 + r() * 0.014 }))
  }, [])
  const o = useMemo(() => new THREE.Object3D(), [])
  useFrame(() => {
    const p = liveCh.power
    seeds.forEach((s, i) => {
      const k = (s.ph + live.wall * s.sp) % 1
      o.position.set(Math.cos(s.a + k * 2) * s.rad, 0.14 + k * 0.52, Math.sin(s.a + k * 2) * s.rad)
      o.scale.setScalar(s.size * p * (0.5 + 0.5 * Math.sin(k * Math.PI)))
      o.updateMatrix()
      ref.current.setMatrixAt(i, o.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
  })
  return <instancedMesh ref={ref} args={[UNIT_SPHERE, M.bubble, seeds.length]} frustumCulled={false} />
}

function Coolant() {
  const pump = (p: V3, r: number, h: number) => (
    <group position={p}>
      <Cyl r={r} h={h} p={[0, h / 2, 0]} m={M.chrome} />
      <Cyl r={r + 0.012} h={0.07} p={[0, h * 0.55, 0]} m={M.black} />
      <Cyl r={r * 0.82} h={0.05} p={[0, h + 0.025, 0]} m={M.silver} />
    </group>
  )
  return (
    <group>
      {/* reservoir */}
      <group position={RES}>
        <Cyl r={0.26} h={0.1} p={[0, 0.07, 0]} m={M.silver} />
        <Cyl r={0.24} h={0.04} p={[0, 0.13, 0]} m={M.black} />
        <mesh position={[0, 0.42, 0]} material={M.coolant} renderOrder={1}>
          <cylinderGeometry args={[0.185, 0.185, 0.56, 32]} />
        </mesh>
        <Bubbles />
        <mesh position={[0, 0.46, 0]} material={M.tank} renderOrder={2}>
          <cylinderGeometry args={[0.22, 0.22, 0.66, 40, 1, true]} />
        </mesh>
        <Cyl r={0.25} h={0.06} p={[0, 0.8, 0]} m={M.black} />
        <Cyl r={0.265} h={0.1} p={[0, 0.86, 0]} m={M.silver} seg={40} />
        <Cyl r={0.12} h={0.04} p={[0, 0.93, 0]} m={M.silver} />
        <sprite position={[0, 0.45, 0]} scale={[0.8, 1.0, 1]} material={M.halo} />
        <Callout at={[0.22, 0.5, 0]} side="right" title="RESERVOIR" sub="GLASS, LIME COOLANT" len={10} show={(c) => c.coolant} />
      </group>
      {/* pumps */}
      {pump([-1.76, 0.1, -0.22], 0.13, 0.56)}
      <Callout at={[-1.89, 0.45, -0.22]} side="left" title="PUMP" sub="2 IN THE LOOP" len={4} show={(c) => c.coolant} />
      {pump([-1.44, 0.1, -0.58], 0.13, 0.6)}
      {pump([-1.42, 0.1, -0.12], 0.085, 0.46)}
      {/* pump head next to the tank */}
      <group position={[-1.3, 0.1, 0.55]}>
        <Box s={[0.3, 0.24, 0.26]} p={[0, 0.12, 0]} m={M.dark} />
        <Cyl r={0.05} h={0.12} p={[-0.2, 0.12, 0]} rot={[0, 0, Math.PI / 2]} m={M.chrome} />
        <Cyl r={0.06} h={0.06} p={[0.17, 0.14, 0]} rot={[0, 0, Math.PI / 2]} m={M.silver} />

      </group>
    </group>
  )
}

function Pipes() {
  const data = useMemo(() => {
    const runs = [0, 1, 2].map((i) => {
      const z = 0.64 - 0.15 * i
      return tube(
        [
          [-1.14, 0.24, 0.55],
          [-0.86, 0.32, z],
          [0.35, 0.32, z],
          [0.85, 0.38 + 0.07 * i, z - 0.03],
          [1.24, 0.46 + 0.13 * i, 0.45],
        ],
        0.046,
        64,
      )
    })
    const riser = tube(
      [
        [1.74, 0.92, 0.45],
        [1.74, 1.2, 0.45],
        [1.7, 1.32, 0.36],
        [1.55, 1.36, 0.22],
      ],
      0.046,
      32,
    )
    return [...runs, riser]
  }, [])
  const slugGeo = useMemo(() => new THREE.CapsuleGeometry(0.03, 0.13, 4, 10), [])
  const slugs = useRef<(THREE.Mesh | null)[]>([])
  const N = 4
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const tan = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const p = liveCh.power
    data.forEach((d, pi) => {
      const count = pi === 3 ? 2 : N
      for (let i = 0; i < count; i++) {
        const mesh = slugs.current[pi * N + i]
        if (!mesh) continue
        const u = (i / count + live.wall * (0.16 + pi * 0.02)) % 1
        d.curve.getPointAt(u, mesh.position)
        d.curve.getTangentAt(u, tan)
        mesh.quaternion.setFromUnitVectors(up, tan)
        // fade in and out at the ends so slugs do not pop
        mesh.scale.setScalar(p * Math.min(1, Math.sin(u * Math.PI) * 4))
      }
    })
  })
  return (
    <group>
      {data.map((d, pi) => (
        <group key={pi}>
          <mesh geometry={d.geo} material={M.pipe} />
          {Array.from({ length: pi === 3 ? 2 : N }, (_, i) => (
            <mesh
              key={i}
              ref={(m) => {
                slugs.current[pi * N + i] = m
              }}
              geometry={slugGeo}
              material={M.lime}
            />
          ))}
        </group>
      ))}
      {/* clamps holding the three runs */}
      {[-0.5, 0.05].map((x) => (
        <group key={x} position={[x, 0.32, 0.49]}>
          <Box s={[0.1, 0.15, 0.44]} m={M.silver} />
          <Box s={[0.06, 0.03, 0.46]} p={[0, 0.09, 0]} m={M.white} />
        </group>
      ))}
      {/* fittings */}
      <Cyl r={0.065} h={0.1} p={[-1.12, 0.245, 0.55]} rot={[0, 0, Math.PI / 2]} m={M.silver} />
      <Cyl r={0.065} h={0.08} p={[1.74, 0.94, 0.45]} m={M.silver} />
      <Cyl r={0.06} h={0.07} p={[1.74, 1.14, 0.45]} m={M.black} />
    </group>
  )
}

function Radiator() {
  const fins = useMemo<InstItem[]>(
    () => Array.from({ length: 21 }, (_, i) => ({ p: [-0.33 + i * 0.033, 0.36, 0] as V3, s: [0.011, 0.62, 0.46] as V3 })),
    [],
  )
  return (
    <group position={[1.58, 0.2, 0.45]}>
      <Inst geo={UNIT_BOX} mat={M.silver} items={fins} />
      <Box s={[0.78, 0.06, 0.5]} p={[0, 0.7, 0]} m={M.silver} />
      <Box s={[0.78, 0.06, 0.5]} p={[0, 0.02, 0]} m={M.silver} />
      <Box s={[0.03, 0.72, 0.5]} p={[-0.375, 0.36, 0]} m={M.silver} />
      <Box s={[0.03, 0.72, 0.5]} p={[0.375, 0.36, 0]} m={M.silver} />
      <Box s={[0.7, 0.6, 0.02]} p={[0, 0.36, -0.1]} m={M.dark} />
      <Screws
        at={[
          [-0.33, 0.7, 0.252],
          [0.33, 0.7, 0.252],
          [-0.33, 0.02, 0.252],
          [0.33, 0.02, 0.252],
        ]}
        axis="z"
        size={0.024}
      />
      <Callout at={[0.38, 0.5, 0.1]} side="right" title="RADIATOR" sub="21-FIN STACK" len={4} show={(c) => c.radiator} />
    </group>
  )
}

// ------------------------------------------------------------ board, chip, cables

const CHIP: V3 = [-0.15, 0.15, -0.1]

function Board() {
  const parts = useMemo(() => {
    const r = mulberry(21)
    const smd: InstItem[] = []
    const amber: InstItem[] = []
    const caps: InstItem[] = []
    const inChip = (x: number, z: number) => Math.abs(x - CHIP[0]) < 0.52 && Math.abs(z - CHIP[2]) < 0.52
    const place = (list: InstItem[], n: number, make: (x: number, z: number) => InstItem) => {
      let guard = 0
      while (list.length < n && guard++ < 2000) {
        const x = -1.18 + r() * 2.1
        const z = -0.86 + r() * 1.5
        if (inChip(x, z)) continue
        list.push(make(x, z))
      }
    }
    place(smd, 70, (x, z) => {
      const w = 0.05 + r() * 0.14
      const d = 0.04 + r() * 0.1
      const h = 0.02 + r() * 0.05
      return { p: [x, 0.15 + h / 2, z], s: r() > 0.5 ? [w, h, d] : [d, h, w] }
    })
    place(amber, 34, (x, z) => ({ p: [x, 0.158, z], s: r() > 0.5 ? [0.07, 0.016, 0.025] : [0.025, 0.016, 0.07] }))
    for (let i = 0; i < 14; i++) {
      const rad = 0.022 + r() * 0.02
      caps.push({ p: [-1.1 + r() * 0.34, 0.19, -0.5 + r() * 0.75], s: [rad, 0.08, rad] })
    }
    return { smd, amber, caps }
  }, [])
  const cores = useMemo<InstItem[]>(() => {
    const out: InstItem[] = []
    for (const cx of [-0.13, 0.13])
      for (const dx of [-0.047, 0.047])
        for (let row = 0; row < 5; row++)
          out.push({ p: [CHIP[0] + cx + dx, 0.238, CHIP[2] - 0.19 + row * 0.095], s: [0.072, 0.014, 0.056] })
    return out
  }, [])
  const standoffs: V3[] = [
    [-1.14, 0.2, 0.62],
    [0.9, 0.2, 0.62],
    [-1.14, 0.2, -0.78],
    [0.9, 0.2, -0.78],
  ]
  // the bare package is clickable too, so the spreader can be dropped back on from the die
  const onChip = (e: ThreeEvent<MouseEvent | PointerEvent>) =>
    Math.abs(e.point.x - CHIP[0]) < 0.45 && Math.abs(e.point.z - CHIP[2]) < 0.45 && e.point.y < 0.4
  return (
    <group
      onClick={(e) => {
        e.stopPropagation()
        if (e.delta < 6 && onChip(e)) useSim.getState().pick('chip')
      }}
      onPointerMove={(e) => {
        e.stopPropagation()
        useSim.getState().setHover(onChip(e) ? 'chip' : null)
      }}
      onPointerOut={() => useSim.getState().setHover(null)}
    >
      <Box s={[2.3, 0.04, 1.66]} p={[-0.1, 0.13, -0.08]} m={M.pcb} />
      <Inst geo={UNIT_BOX} mat={M.smd} items={parts.smd} />
      <Inst geo={UNIT_BOX} mat={M.amber} items={parts.amber} />
      <Inst geo={UNIT_CYL} mat={M.smd} items={parts.caps} />
      {standoffs.map((p, i) => (
        <group key={i} position={p}>
          <Cyl r={0.045} h={0.1} m={M.silver} />
          <Cyl r={0.022} h={0.02} p={[0, 0.055, 0]} m={M.dark} />
        </group>
      ))}
      {/* VRM heat sinks */}
      <Box s={[0.62, 0.1, 0.14]} p={[-0.15, 0.2, -0.78]} m={M.silver} />
      <Box s={[0.14, 0.1, 0.5]} p={[-0.82, 0.2, -0.1]} m={M.silver} />
      {/* GB10 package */}
      <Box s={[0.84, 0.03, 0.84]} p={[CHIP[0], 0.165, CHIP[2]]} m={M.substrate} />
      <Box s={[0.62, 0.05, 0.62]} p={[CHIP[0], 0.205, CHIP[2]]} m={M.black} />
      <Inst geo={UNIT_BOX} mat={M.lime} items={cores} />
      <Callout
        at={[CHIP[0] + 0.3, 0.24, CHIP[2] + 0.2]}
        side="right"
        title="GB10"
        sub="20 ARM CORES + BLACKWELL GPU"
        len={6}
        show={(c) => c.chip}
      />
      <Callout
        at={[CHIP[0], 0.3, CHIP[2]]}
        side="right"
        title="GB10 SUPERCHIP"
        sub="UP TO 1 PETAFLOP FP4"
        len={11}
        show={(c) => c.explode}
      />
    </group>
  )
}

function Spreader() {
  const corners: V3[] = [
    [-0.32, 0.052, -0.32],
    [0.32, 0.052, -0.32],
    [-0.32, 0.052, 0.32],
    [0.32, 0.052, 0.32],
  ]
  return (
    <group position={[CHIP[0], 0.285, CHIP[2]]}>
      <RoundedBox args={[0.78, 0.1, 0.78]} radius={0.025} smoothness={3} material={M.silver} />
      <mesh position={[0, 0.0515, 0]} rotation={[-Math.PI / 2, 0, 0]} material={M.chipLogo}>
        <planeGeometry args={[0.54, 0.54]} />
      </mesh>
      <Screws at={corners} size={0.03} />
      <sprite position={[0, 0.1, 0]} scale={[0.7, 0.7, 1]} material={M.halo} />
      <Callout at={[0.39, 0, 0]} side="right" title="HEAT SPREADER" sub="LIFTED OFF THE DIE" len={7} show={(c) => c.chip} />
    </group>
  )
}

function Cables() {
  const runs = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const z = CHIP[2] - 0.24 + i * 0.075
        const x = 0.74 + i * 0.062
        return {
          ...tube(
            [
              [0.3, 0.24, z],
              [x - 0.16, 0.24, z],
              [x, 0.27, z - 0.2],
              [x, 0.36, -0.62],
              [x, 0.52, -0.9],
            ],
            0.027,
            40,
          ),
          start: [0.3, 0.24, z] as V3,
          end: [x, 0.52, -0.9] as V3,
        }
      }),
    [],
  )
  return (
    <group>
      {runs.map((r, i) => (
        <group key={i}>
          <mesh geometry={r.geo} material={M.cable} />
          <Box s={[0.07, 0.06, 0.06]} p={r.start} m={M.black} />
          <Box s={[0.06, 0.07, 0.07]} p={r.end} m={M.black} />
        </group>
      ))}
      <Callout at={[0.62, 0.26, 0.1]} side="left" title="BRAIDED CABLES" sub="7 LIME SLEEVES" len={9} show={(c) => c.cables} />
    </group>
  )
}

// ------------------------------------------------------------ assembly

export function Machine() {
  const root = useRef<THREE.Group>(null!)

  useLayoutEffect(() => {
    root.current.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const mat = mesh.material as THREE.Material
      if (mat.transparent) return
      mesh.castShadow = true
      mesh.receiveShadow = true
    })
  }, [])

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.05)
    live.wall += step
    // blade speed follows the same RPM figure the FANS card prints
    live.fanAngle += (liveTelemetry(live.wall).rpm / 1300) * 9 * step
    applyPower(liveCh.power)
  })

  return (
    <group ref={root}>
      <Frame />
      <Board />
      <Part id="base">
        <Base />
      </Part>
      <Part id="back">
        <BackWall />
      </Part>
      <Part id="sideL">
        <SidePanel side={-1} />
      </Part>
      <Part id="sideR">
        <SidePanel side={1} />
      </Part>
      <Part id="coolant">
        <Coolant />
      </Part>
      <Part id="pipes">
        <Pipes />
      </Part>
      <Part id="radiator">
        <Radiator />
      </Part>
      <Part id="spreader" pivot={[CHIP[0], 0.285, CHIP[2]]}>
        <Spreader />
      </Part>
      <Part id="cables" pivot={[0.7, 0.3, -0.3]}>
        <Cables />
      </Part>
      <Part id="fanL" pivot={[-FAN_X, 1.415, FAN_Z]}>
        <Fan side={-1} />
      </Part>
      <Part id="fanR" pivot={[FAN_X, 1.415, FAN_Z]}>
        <Fan side={1} />
      </Part>
      <Part id="lid" pivot={[0, H, 0]}>
        <Lid />
      </Part>
      <Part id="glass">
        <mesh position={[0, 0.82, 1.09]} material={M.glass} renderOrder={3}>
          <planeGeometry args={[4.16, 1.16]} />
        </mesh>
        {/* lime contour around the window */}
        <Box s={[4.02, 0.028, 0.028]} p={[0, 0.3, 1.08]} m={M.lime} />
        <Box s={[0.028, 0.82, 0.028]} p={[-2.04, 0.71, 1.08]} m={M.lime} />
        <Box s={[0.028, 0.82, 0.028]} p={[2.04, 0.71, 1.08]} m={M.lime} />
        <Box s={[1.5, 0.028, 0.028]} p={[0, 1.385, 1.08]} m={M.lime} />
      </Part>
    </group>
  )
}
