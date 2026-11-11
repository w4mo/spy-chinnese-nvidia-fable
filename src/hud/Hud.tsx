import { useEffect, useRef, type ReactNode } from 'react'
import { useSim } from '../store'
import { liveCh, liveTelemetry } from '../live'
import {
  ASSEMBLY_BUTTONS,
  BEATS,
  DURATION,
  PART_INFO,
  SUBSYSTEMS,
  hudState,
  inspectHud,
  type BeatId,
  type PartKey,
  type Telemetry,
} from '../timeline'

const pad = (n: number) => String(Math.floor(n)).padStart(2, '0')
const clock = (t: number) => `${pad(t / 60)}:${pad(t % 60)}`

function Segs({ n, filled, className = '' }: { n: number; filled: number; className?: string }) {
  return (
    <div className={`segs ${className}`}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < filled ? 'on' : ''} />
      ))}
    </div>
  )
}

function Card({ title, no, className = '', children }: { title: string; no: string; className?: string; children: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      <header className="card-head">
        <h2>{title}</h2>
        <span>{no}</span>
      </header>
      {children}
    </section>
  )
}

/** Scrolling 1.2 s trace of the fan signal; frequency and height follow the RPM. */
function FanTrace() {
  const path = useRef<SVGPathElement>(null)
  const dot = useRef<SVGCircleElement>(null)
  useEffect(() => {
    const N = 96
    const W = 186
    const buf = new Float32Array(N)
    let phase = 0
    let amp = 0
    let last = performance.now()
    let raf = 0
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const tm = liveTelemetry(now / 1000)
      const freq = tm.rpm > 20 ? 1.2 + tm.rpm * 0.002 : 0
      const target = Math.min(1, tm.rpm / 1300) * (0.45 + 0.55 * (tm.peak / 100))
      amp += (target - amp) * Math.min(1, dt * 6)
      // the window holds 1.2 s, so shift by however many samples this frame covers
      const shift = Math.max(1, Math.round((dt / 1.2) * N))
      buf.copyWithin(0, shift)
      for (let i = N - shift; i < N; i++) {
        phase += (Math.PI * 2 * freq * 1.2) / N
        buf[i] = Math.sin(phase) * amp
      }
      let d = ''
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * W
        const y = 35 - buf[i] * 27
        d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
      }
      path.current?.setAttribute('d', d)
      dot.current?.setAttribute('cy', (35 - buf[N - 1] * 27).toFixed(1))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className="trace">
      <svg viewBox="0 0 200 70" preserveAspectRatio="none">
        <line x1="0" y1="35" x2="186" y2="35" className="trace-mid" />
        <line x1="186" y1="2" x2="186" y2="68" className="trace-now" />
        <path ref={path} className="trace-wave" />
        <circle ref={dot} cx="186" cy="35" r="2.6" className="trace-dot" />
      </svg>
      <div className="trace-axis">
        <span>-1.2 S</span>
        <span>NOW</span>
      </div>
    </div>
  )
}

function TensorCores({ tm, badge }: { tm: Telemetry; badge: string }) {
  return (
    <Card title="TENSOR CORES" no="03" className="cores">
      <div className="row between">
        <span className="dim">LOAD PER UNIT</span>
        <span className={`chip ${badge === 'IDLE' ? 'ghost' : badge === 'DETACHED' ? 'lime' : 'solid'}`}>{badge}</span>
      </div>
      <ul>
        {tm.cores.map((v, i) => (
          <li key={i}>
            <b>T{i + 1}</b>
            <span className="bar">
              <i className={v >= 60 ? 'hot' : ''} style={{ width: `${v}%` }} />
            </span>
            <em>{v}%</em>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Timeline({ t }: { t: number }) {
  const seek = useSim((s) => s.seek)
  const ref = useRef<HTMLDivElement>(null)
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    seek(((e.clientX - r.left) / r.width) * DURATION)
  }
  const pct = (t / DURATION) * 100
  return (
    <div
      ref={ref}
      className="track"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        at(e)
      }}
      onPointerMove={(e) => e.buttons === 1 && at(e)}
    >
      <div className="track-line" />
      <div className="track-fill" style={{ width: `${pct}%` }} />
      {BEATS.slice(0, 8).map((b) => (
        <i key={b.id} className={`track-tick ${t >= b.start ? 'done' : ''}`} style={{ left: `${(b.start / DURATION) * 100}%` }} />
      ))}
      <div className="track-knob" style={{ left: `${pct}%` }} />
    </div>
  )
}

export function Hud() {
  useSim((s) => s.tick)
  const playing = useSim((s) => s.playing)
  const toggle = useSim((s) => s.toggle)
  const sim = useSim.getState()
  const { t, mode, out, exploded, powered, focus } = sim
  const inspecting = mode === 'inspect'
  const h = inspecting ? inspectHud(liveCh, out, exploded, powered, focus) : hudState(t)
  const tm = liveTelemetry(performance.now() / 1000)
  const standby = !inspecting && t < 0.3

  /** ASSEMBLIES buttons and SUBSYSTEMS rows always act on the machine itself, not the film. */
  const press = (id: BeatId) => {
    sim.setHover(null)
    if (id === 'exploded') sim.toggleExplode()
    else if (id === 'power') sim.togglePower()
    else sim.pick(id as PartKey)
  }
  const isActive = (id: BeatId) => {
    if (!inspecting) return !standby && h.activeButton === id
    if (id === 'exploded') return exploded
    if (id === 'power') return powered
    return out[id as PartKey]
  }
  const info = inspecting && focus ? PART_INFO[focus] : null

  return (
    <div className="hud">
      {/* ------------------------------------------------ header */}
      <div className="brand">
        <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
          <path d="M16 3 28 9.5v13L16 29 4 22.5v-13L16 3Z" />
          <path d="M4 9.5 16 16l12-6.5M16 16v13" />
          <path d="M10 6.2 22 12.8M4 16l12 6.5L28 16" opacity=".55" />
        </svg>
        <span>AI-1</span>
      </div>
      <div className="title">
        <small>AI DESKTOP SUPERCOMPUTER · GB10</small>
        <h1>
          NVIDIA AI-1 <i>/</i>
        </h1>
        <p>LIQUID-COOLED TEARDOWN / BENCH SIMULATOR</p>
      </div>
      <div className="draw">
        <div className="row between">
          <span className="dim">POWER DRAW</span>
          <b>{tm.drawPct}%</b>
        </div>
        <Segs n={40} filled={Math.max(1, Math.round((tm.drawPct / 100) * 40))} />
        <div className="row between dim tiny">
          <span>IDLE</span>
          <span>NOMINAL</span>
          <span>PEAK</span>
        </div>
      </div>
      <dl className="meta">
        <div>
          <dt>SIM ID</dt>
          <dd>AI1-1109</dd>
        </div>
        <div>
          <dt>RUNTIME</dt>
          <dd>00:{clock(t)}</dd>
        </div>
        <div>
          <dt>STATUS</dt>
          <dd>
            <i className={`led ${h.status === 'ONLINE' ? '' : 'lime'}`} />
            {h.status}
          </dd>
        </div>
        <div>
          <dt>OPERATOR</dt>
          <dd>BENCH 2 · V.D.</dd>
        </div>
      </dl>
      <div className="plus-grid" aria-hidden>
        {Array.from({ length: 28 }, (_, i) => (
          <i key={i}>+</i>
        ))}
      </div>

      {/* ------------------------------------------------ left column */}
      <div className="col left">
        <Card title="FANS" no="01">
          <div className="row between end">
            <div className="big">
              {tm.rpm.toLocaleString('en-US')}
              <small>RPM</small>
            </div>
            <div className="readout">
              <b>{tm.peak}%</b>
              <span className="dim">PEAK</span>
            </div>
          </div>
          <div className="dim">FANS · LIVE</div>
          <FanTrace />
        </Card>
        <Card title="GPU" no="02">
          <div className="row between">
            <div className="big">
              {tm.temp}
              <small>°C</small>
            </div>
            <Segs n={10} filled={Math.round(((tm.temp - 20) / 70) * 10)} className="tall" />
          </div>
          <div className="dim">LIVE READING</div>
          <div className="meter">
            <i style={{ width: `${((tm.temp - 20) / 70) * 100}%` }} />
          </div>
          <div className="row between dim tiny">
            <span>0</span>
            <span>MAX</span>
          </div>
        </Card>
        <TensorCores tm={tm} badge={h.coresBadge} />
      </div>

      {/* ------------------------------------------------ right column */}
      <div className="col right-col">
        <Card title="POWER" no="04">
          <div className="row between">
            <div className="big">
              {tm.watts}
              <small>W</small>
            </div>
            <Segs n={10} filled={Math.round((tm.watts / 240) * 10)} className="tall" />
          </div>
          <div className="dim">LIVE READING</div>
          <div className="pair">
            <div>
              <span className="dim">MEMORY</span>
              <b>128 GB</b>
            </div>
            <div>
              <span className="dim">FP4</span>
              <b>1 PFLOP</b>
            </div>
          </div>
        </Card>
        <Card title="ASSEMBLIES" no="05">
          <div className="buttons">
            {ASSEMBLY_BUTTONS.map((b) => (
              <button
                key={b.id}
                className={`${isActive(b.id) ? 'active' : ''} ${inspecting && focus === b.id ? 'focus' : ''}`}
                onClick={() => press(b.id)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </Card>
        <Card title="SUBSYSTEMS" no="06" className="subs">
          <ol>
            {SUBSYSTEMS.map((s, i) => {
              const badge = h.badges[i]
              return (
                <li key={s.id} className={badge === 'OPEN' ? 'open' : ''} onClick={() => press(s.id)}>
                  <span className="dim">{pad(i + 1)}</span>
                  <div>
                    <b>{s.name}</b>
                    <small>{s.desc}</small>
                  </div>
                  <span className={`chip ${badge === 'OPEN' ? 'lime' : badge === 'OK' ? 'solid' : 'ghost'}`}>{badge}</span>
                </li>
              )
            })}
          </ol>
        </Card>
      </div>

      {/* ------------------------------------------------ stage labels */}
      <div className="stage-label tl">MODEL AI-1 · REV A</div>
      <div className="stage-label tr">VIEW · {h.view}</div>
      <div className="corner c1" />
      <div className="corner c2" />
      <div className="mode">
        <span className="dim">OPERATING MODE</span>
        <strong key={h.mode}>{h.mode}</strong>
        <span className="dim" key={h.modeSub.replace(/\d+/, '')}>
          {h.modeSub}
        </span>
      </div>

      {/* ------------------------------------------------ inspection */}
      {info && focus && (
        <section className="card detail" key={focus}>
          <header className="card-head">
            <h2>PART DETAIL</h2>
            <button className="x" onClick={() => sim.setFocus(null)} aria-label="Close">
              ×
            </button>
          </header>
          <h3>{info.title}</h3>
          <p>{info.desc}</p>
          <dl>
            {info.specs.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            {info.live(tm).map(([k, v]) => (
              <div key={k} className="live">
                <dt>
                  <i className="led lime" />
                  {k}
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <button className="wide" onClick={() => sim.putBack(focus)}>
            PUT BACK
          </button>
        </section>
      )}
      <div className="tools">
        <span className="dim">
          {inspecting ? 'DRAG · ORBIT    SCROLL · ZOOM    CLICK · PULL A PART' : 'DRAG OR CLICK A PART TO INSPECT'}
        </span>
        {inspecting && (
          <div>
            <button onClick={sim.resetView}>RESET VIEW</button>
            <button onClick={sim.reassemble}>REASSEMBLE</button>
            <button onClick={toggle}>▶ PLAY FILM</button>
          </div>
        )}
      </div>

      {/* ------------------------------------------------ operation log */}
      <Card title="OPERATION LOG" no="07" className="log">
        <button className="play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg viewBox="0 0 16 16">
              <rect x="4" y="3" width="3" height="10" />
              <rect x="9" y="3" width="3" height="10" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16">
              <path d="M5 3v10l8-5z" />
            </svg>
          )}
        </button>
        <div className="log-body">
          <div className="row between tiny">
            <span className="dim">{inspecting ? 'INSPECT' : 'POWER ON'}</span>
            <span className="caption" key={h.caption}>
              {h.caption}
            </span>
            <span className="dim">RUN</span>
          </div>
          <Timeline t={t} />
          <div className="row between tiny dim">
            <span>
              {clock(t)} / {clock(DURATION)}
            </span>
            <span>NEXT · {h.next}</span>
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------ footer */}
      <div className="foot fl">
        FIELD SIMULATOR&nbsp;&nbsp;·&nbsp;&nbsp;PROCEDURAL MODEL&nbsp;&nbsp;·&nbsp;&nbsp;2 FANS · 2 PUMPS · 1 GB10
      </div>
      <div className="foot fr">
        NVIDIA AI TEARDOWN LAB <i>/////</i>
      </div>
    </div>
  )
}
