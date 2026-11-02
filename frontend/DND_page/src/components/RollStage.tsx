import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { DICE, DiceWorld } from '../dice'
import type { Roll } from '../types'

export interface StageHandle {
  roll: (dieKey: string) => void
}

interface Shown {
  id: string
  die: string
  value: number
}

const LINGER_MS = 2200

/** Full-screen overlay: a die is thrown in the middle of the screen and the result is read from the face that lands up. */
export function RollStage({ ref, onResult }: { ref: Ref<StageHandle>; onResult: (r: Roll) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const world = useRef<DiceWorld | null>(null)
  const timers = useRef<number[]>([])
  const onResultRef = useRef(onResult)
  const [shown, setShown] = useState<Shown[]>([])
  const [live, setLive] = useState(0) // dice currently on the stage

  useEffect(() => {
    onResultRef.current = onResult
  })

  useEffect(() => {
    const w = new DiceWorld(host.current!, { halfX: 4.4, halfZ: 2.8, fill: 0.62, gravity: -45 })
    w.start()
    world.current = w
    return () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
      w.dispose()
      world.current = null
    }
  }, [])

  function finish(key: string, value: number, cleanup?: () => void) {
    onResultRef.current({ die: key, value })
    const id = crypto.randomUUID()
    setShown((s) => [...s, { id, die: key, value }])
    timers.current.push(
      window.setTimeout(() => {
        cleanup?.()
        setShown((s) => s.filter((x) => x.id !== id))
        setLive((n) => n - 1)
      }, LINGER_MS),
    )
  }

  function roll(key: string) {
    const w = world.current
    const i = DICE.findIndex((d) => d.key === key)
    if (!w || i < 0) return
    setLive((n) => n + 1)

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish(key, 1 + Math.floor(Math.random() * DICE[i].sides))
      return
    }
    const d = w.add(i, 0.8, [0, 3, 0])
    w.forceActive = true
    w.throw(d)
    d.onSettle = (value) =>
      finish(key, value, () => {
        w.remove(d)
        if (w.dice.length === 0) w.forceActive = false
      })
  }

  useImperativeHandle(ref, () => ({ roll }))

  return (
    <div className={`stage ${live > 0 ? 'on' : ''}`} aria-hidden={live === 0}>
      <div className="stage-canvas" ref={host} />
      <div className="stage-banner" role="status">
        {shown.map((s) => (
          <div key={s.id} className="stage-result">
            <span>{s.die}</span>
            <strong>{s.value}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}
