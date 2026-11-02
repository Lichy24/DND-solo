import { useEffect, useRef } from 'react'
import { DICE, DiceWorld } from '../dice'

interface Props {
  id: string
  open: boolean
  results: Record<string, number>
  onRoll: (dieKey: string) => void
}

/**
 * The tray holds physical dice that slosh around when the box opens or closes.
 * Actual rolls are thrown on the centre-of-screen stage (RollStage), so this just requests them.
 */
export function DiceTray({ id, open, results, onRoll }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const world = useRef<DiceWorld | null>(null)
  const prevOpen = useRef(open)
  const onRollRef = useRef(onRoll)

  useEffect(() => {
    onRollRef.current = onRoll
  })

  useEffect(() => {
    const w = new DiceWorld(host.current!, { halfX: 3.3, halfZ: 3.5, fill: 0.96, gravity: -32 })
    DICE.forEach((_, i) => w.add(i, 0.55, [((i % 3) - 1) * 2.1, 1.5 + i * 0.3, (i < 3 ? -1 : 1) * 1.7]))
    w.start()
    world.current = w
    const el = w.renderer.domElement
    const down = (e: PointerEvent) => {
      const d = w.pick(e.clientX, e.clientY)
      if (d) {
        w.jolt(d)
        onRollRef.current(d.spec.key)
      }
    }
    el.addEventListener('pointerdown', down)
    return () => {
      el.removeEventListener('pointerdown', down)
      w.dispose()
      world.current = null
    }
  }, [])

  // open/close: keep rendering through the slide animation and toss the dice about
  useEffect(() => {
    const w = world.current
    if (!w) return
    w.forceActive = open
    w.activeUntil = performance.now() + 1200
    if (prevOpen.current !== open) {
      prevOpen.current = open
      w.shake(900)
    }
  }, [open])

  function rollFromButton(key: string) {
    const d = world.current?.dice.find((x) => x.spec.key === key)
    if (d) world.current?.jolt(d)
    onRoll(key)
  }

  return (
    <section className="tray" id={id} aria-label="Dice tray" inert={!open}>
      <div className="tray-felt" ref={host} />
      <div className="tray-readout">
        {DICE.map((d) => (
          <button key={d.key} className="die-btn" onClick={() => rollFromButton(d.key)} aria-label={`Roll ${d.key}`}>
            <span>{d.key}</span>
            <strong>{results[d.key] ?? '–'}</strong>
          </button>
        ))}
      </div>
    </section>
  )
}
