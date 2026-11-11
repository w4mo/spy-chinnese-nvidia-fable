import * as THREE from 'three'

export const LIME = '#76b900'
const LIME_HOT = new THREE.Color('#8fdc00')
const LIME_OFF = new THREE.Color('#5d6456')
const LIME_ON_BASE = new THREE.Color('#263400')

// ------------------------------------------------------------ canvas textures

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!] as const
}

/** Tileable flat-top honeycomb: one tile is 3R wide and sqrt(3)R tall. */
function honeycombTexture() {
  const R = 64
  const W = 3 * R
  const H = Math.round(Math.sqrt(3) * R)
  const [c, g] = canvas(W, H)
  g.fillStyle = '#3d4239'
  g.fillRect(0, 0, W, H)
  const hex = (cx: number, cy: number) => {
    g.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i
      const x = cx + Math.cos(a) * R * 0.86
      const y = cy + Math.sin(a) * R * 0.86
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.closePath()
    const grad = g.createLinearGradient(cx, cy - R, cx, cy + R)
    grad.addColorStop(0, '#0b0c0b')
    grad.addColorStop(1, '#1a1c19')
    g.fillStyle = grad
    g.fill()
  }
  for (const [x, y] of [
    [0, 0],
    [W, 0],
    [0, H],
    [W, H],
    [W / 2, H / 2],
  ])
    hex(x, y)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1 / 0.24, 1 / 0.1386)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** Stylised NVIDIA eye emblem inside a 100x100 box at (x, y). */
function drawEmblem(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  const [tmp, t] = canvas(200, 200)
  t.scale(2, 2)
  t.fillStyle = color
  t.strokeStyle = color
  // the square half of the mark
  t.fillRect(40, 12, 58, 76)
  // the eye, drawn in XOR so it cuts through the square and stays lime outside it
  t.globalCompositeOperation = 'xor'
  t.lineWidth = 7
  t.beginPath()
  t.moveTo(4, 50)
  t.quadraticCurveTo(38, 14, 80, 50)
  t.quadraticCurveTo(38, 86, 4, 50)
  t.closePath()
  t.stroke()
  t.beginPath()
  t.arc(42, 50, 13, -Math.PI * 0.15, Math.PI * 1.45)
  t.stroke()
  t.beginPath()
  t.arc(42, 50, 4, 0, Math.PI * 2)
  t.fill()
  g.drawImage(tmp, x, y, s, s)
}

/** Lid plate: emblem + wordmark on transparent. */
function lidLogoTexture() {
  const [c, g] = canvas(1024, 320)
  drawEmblem(g, 40, 50, 220, LIME)
  g.fillStyle = '#111312'
  g.font = 'italic 900 190px "Arial Black", "Helvetica Neue", Arial, sans-serif'
  g.textBaseline = 'middle'
  g.fillText('NVIDIA', 290, 170)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** Heat spreader badge: lime emblem on a dark tile. */
function chipLogoTexture() {
  const [c, g] = canvas(512, 512)
  g.fillStyle = '#121412'
  g.fillRect(0, 0, 512, 512)
  g.strokeStyle = '#8fdc00'
  g.lineWidth = 26
  g.strokeRect(13, 13, 486, 486)
  drawEmblem(g, 106, 106, 300, '#8fdc00')
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

function haloTexture() {
  const [c, g] = canvas(256, 256)
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  grad.addColorStop(0, 'rgba(150,235,0,0.85)')
  grad.addColorStop(0.35, 'rgba(150,235,0,0.32)')
  grad.addColorStop(1, 'rgba(150,235,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 256)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// ------------------------------------------------------------ materials

export const M = {
  silver: new THREE.MeshPhysicalMaterial({
    color: '#c0c5c9',
    metalness: 0.92,
    roughness: 0.27,
    clearcoat: 0.5,
    clearcoatRoughness: 0.2,
  }),
  white: new THREE.MeshPhysicalMaterial({
    color: '#eeeeea',
    metalness: 0.15,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
  }),
  dark: new THREE.MeshStandardMaterial({ color: '#1c1e20', metalness: 0.4, roughness: 0.55 }),
  base: new THREE.MeshStandardMaterial({ color: '#2a2b29', metalness: 0.3, roughness: 0.6 }),
  black: new THREE.MeshPhysicalMaterial({
    color: '#101112',
    metalness: 0.1,
    roughness: 0.62,
    clearcoat: 0.08,
  }),
  pcb: new THREE.MeshStandardMaterial({ color: '#1d211c', metalness: 0.3, roughness: 0.6 }),
  substrate: new THREE.MeshStandardMaterial({ color: '#2b3324', metalness: 0.3, roughness: 0.5 }),
  smd: new THREE.MeshStandardMaterial({ color: '#34373a', metalness: 0.5, roughness: 0.45 }),
  amber: new THREE.MeshStandardMaterial({ color: '#e0a21a', metalness: 0.4, roughness: 0.4 }),
  chrome: new THREE.MeshPhysicalMaterial({ color: '#e3e7ea', metalness: 1, roughness: 0.12 }),
  /** Reflective glass tubing: the lime slugs inside stay visible. */
  pipe: new THREE.MeshPhysicalMaterial({
    color: '#f2f5f6',
    metalness: 0.85,
    roughness: 0.08,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  }),
  glass: new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    metalness: 0,
    roughness: 0.03,
    clearcoat: 1,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
  tank: new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    metalness: 0.1,
    roughness: 0.02,
    clearcoat: 1,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  }),
  /** Glowing trim: LED bars, hub rings, window contour, die cores, pipe slugs. */
  lime: new THREE.MeshStandardMaterial({
    color: LIME_OFF.clone(),
    emissive: LIME_HOT.clone(),
    emissiveIntensity: 0,
    metalness: 0.1,
    roughness: 0.4,
    toneMapped: false,
  }),
  coolant: new THREE.MeshStandardMaterial({
    color: '#c9d2c0',
    emissive: LIME_HOT.clone(),
    emissiveIntensity: 0,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    roughness: 0.2,
    toneMapped: false,
  }),
  bubble: new THREE.MeshBasicMaterial({ color: '#f4ffd2', toneMapped: false }),
  /** Braided sleeves: lime, but matte and unlit by the power state. */
  cable: new THREE.MeshStandardMaterial({ color: '#7fc400', metalness: 0, roughness: 0.75 }),
  honeycomb: new THREE.MeshStandardMaterial({
    map: honeycombTexture(),
    metalness: 0.4,
    roughness: 0.6,
  }),
  lidLogo: new THREE.MeshBasicMaterial({
    map: lidLogoTexture(),
    transparent: true,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  }),
  chipLogo: new THREE.MeshBasicMaterial({ map: chipLogoTexture(), toneMapped: false }),
  halo: new THREE.SpriteMaterial({
    map: haloTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  }),
  floorGlow: new THREE.MeshBasicMaterial({
    map: haloTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  }),
}

const tmp = new THREE.Color()
const HONEY_ON = new THREE.Color('#d9ff9a')
const WHITE = new THREE.Color('#ffffff')
const COOLANT_OFF = new THREE.Color('#c9d2c0')
const COOLANT_ON = new THREE.Color('#5a8a00')

/** Bring the lime lighting up with the power channel (0 = standby, 1 = running). */
export function applyPower(p: number) {
  M.lime.color.copy(tmp.copy(LIME_OFF).lerp(LIME_ON_BASE, p))
  M.lime.emissiveIntensity = p
  M.coolant.color.copy(tmp.copy(COOLANT_OFF).lerp(COOLANT_ON, p))
  M.coolant.emissiveIntensity = 0.85 * p
  M.coolant.opacity = 0.4 + 0.4 * p
  M.honeycomb.color.copy(tmp.copy(WHITE).lerp(HONEY_ON, p))
  M.halo.opacity = 0.34 * p
  M.floorGlow.opacity = 0.3 * p
  M.chipLogo.color.setScalar(0.45 + 0.55 * p)
}
