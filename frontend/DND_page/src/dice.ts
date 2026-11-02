import * as THREE from 'three'
import * as CANNON from 'cannon-es'

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const round4 = (n: number) => Math.round(n * 1e4) / 1e4 + 0 // "+ 0" turns -0 into 0

/* ------------------------------------------------------------------ */
/* Die shapes: every die is a list of outward-facing triangles         */
/* ------------------------------------------------------------------ */
type Tri = THREE.Vector3[]

function orient(tris: Tri[]): Tri[] {
  return tris.map(([a, b, c]) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
    const g = new THREE.Vector3().add(a).add(b).add(c)
    return n.dot(g) < 0 ? [a, c, b] : [a, b, c]
  })
}

function fromGeometry(g: THREE.BufferGeometry): Tri[] {
  const ng = g.index ? g.toNonIndexed() : g
  const p = ng.getAttribute('position')
  const tris: Tri[] = []
  for (let i = 0; i < p.count; i += 3) {
    tris.push([0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, i + k)))
  }
  g.dispose()
  return orient(tris)
}

// Pentagonal trapezohedron with exactly planar kite faces (apex +-1, ring radius 1, ring height +-0.1056)
function d10(): Tri[] {
  const k = 0.1056
  const ring = Array.from({ length: 10 }, (_, i) => {
    const a = (i * Math.PI) / 5
    return new THREE.Vector3(Math.cos(a), i % 2 === 0 ? k : -k, Math.sin(a))
  })
  const top = new THREE.Vector3(0, 1, 0)
  const bot = new THREE.Vector3(0, -1, 0)
  const tris: Tri[] = []
  for (let i = 0; i < 10; i++) {
    const apex = i % 2 === 0 ? top : bot
    const p = ring[i]
    const q = ring[(i + 1) % 10]
    const r = ring[(i + 2) % 10]
    tris.push([apex, p, q], [apex, q, r])
  }
  return orient(tris)
}

export interface DieSpec {
  key: string
  sides: number
  color: number
  tris: () => Tri[]
}

export const DICE: DieSpec[] = [
  { key: 'd4', sides: 4, color: 0xa3423f, tris: () => fromGeometry(new THREE.TetrahedronGeometry(1.3)) },
  { key: 'd6', sides: 6, color: 0x3f6fa3, tris: () => fromGeometry(new THREE.BoxGeometry(1.45, 1.45, 1.45)) },
  { key: 'd8', sides: 8, color: 0x4d9470, tris: () => fromGeometry(new THREE.OctahedronGeometry(1.25)) },
  { key: 'd10', sides: 10, color: 0x8c5fa3, tris: d10 },
  { key: 'd12', sides: 12, color: 0xb98532, tris: () => fromGeometry(new THREE.DodecahedronGeometry(1.2)) },
  { key: 'd20', sides: 20, color: 0x2f929e, tris: () => fromGeometry(new THREE.IcosahedronGeometry(1.3)) },
]

/* ------------------------------------------------------------------ */
/* Faces + numbers                                                     */
/* ------------------------------------------------------------------ */
interface Face {
  n: THREE.Vector3 // outward normal
  c: THREE.Vector3 // centre
  r: number // distance from centre to nearest corner (used to size the number)
  value: number
}

// Merge coplanar triangles into faces (a cube has 12 triangles but 6 faces)
function groupFaces(tris: Tri[]): Face[] {
  const gs: { n: THREE.Vector3; sum: THREE.Vector3; c: THREE.Vector3; k: number; pts: THREE.Vector3[] }[] = []
  for (const t of tris) {
    const n = new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0])).normalize()
    const c = new THREE.Vector3().add(t[0]).add(t[1]).add(t[2]).divideScalar(3)
    const g = gs.find((x) => x.n.dot(n) > 0.98)
    if (g) {
      g.sum.add(n)
      g.n.copy(g.sum).normalize()
      g.c.add(c)
      g.k++
      g.pts.push(...t)
    } else gs.push({ n: n.clone(), sum: n.clone(), c: c.clone(), k: 1, pts: [...t] })
  }
  return gs.map((g) => {
    const c = g.c.divideScalar(g.k)
    return { n: g.n, c, r: Math.min(...g.pts.map((p) => p.distanceTo(c))), value: 0 }
  })
}

// Opposite faces add up to sides + 1, like a real die
function numberFaces(faces: Face[], sides: number) {
  const used = new Set<number>()
  let v = 1
  faces.forEach((f, i) => {
    if (used.has(i)) return
    let j = -1
    let best = 2
    faces.forEach((g, k) => {
      if (k !== i && !used.has(k)) {
        const d = f.n.dot(g.n)
        if (d < best) {
          best = d
          j = k
        }
      }
    })
    used.add(i)
    used.add(j)
    f.value = v
    faces[j].value = sides + 1 - v
    v++
  })
}

const labelCache = new Map<string, THREE.MeshBasicMaterial>()
function labelMaterial(value: number) {
  const text = value === 6 || value === 9 ? `${value}.` : String(value) // dot tells 6 from 9
  let m = labelCache.get(text)
  if (m) return m
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const x = c.getContext('2d')!
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  x.fillStyle = '#f7f0da'
  x.shadowColor = 'rgba(0,0,0,0.55)'
  x.shadowBlur = 6
  x.font = `700 ${text.length > 2 ? 62 : text.length > 1 ? 74 : 92}px Alegreya, Georgia, serif`
  x.fillText(text, 64, 68)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  labelCache.set(text, m)
  return m
}

/* ------------------------------------------------------------------ */
/* A die = three mesh + cannon body                                    */
/* ------------------------------------------------------------------ */
export interface Die {
  spec: DieSpec
  mesh: THREE.Mesh
  body: CANNON.Body
  faces: Face[]
  corners: { p: THREE.Vector3; value: number }[] | null // d4 is read from the corner pointing up
  rolling: boolean
  rest: number
  age: number
  phase: number
  onSettle?: (value: number) => void
}

export function createDie(spec: DieSpec, scale: number): Die {
  const tris = spec.tris().map((t) => t.map((v) => v.clone().multiplyScalar(scale)))

  // unique vertices + triangle indices (for physics)
  const verts: THREE.Vector3[] = []
  const lookup = new Map<string, number>()
  const idx = (v: THREE.Vector3) => {
    const k = `${round4(v.x)},${round4(v.y)},${round4(v.z)}`
    let i = lookup.get(k)
    if (i === undefined) {
      i = verts.length
      verts.push(v.clone())
      lookup.set(k, i)
    }
    return i
  }
  const faceIdx = tris.map((t) => t.map(idx))

  // visible mesh
  const pos: number[] = []
  tris.forEach((t) => t.forEach((v) => pos.push(v.x, v.y, v.z)))
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: spec.color, flatShading: true, roughness: 0.35, metalness: 0.1 }))
  mesh.castShadow = true
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 1), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 })))

  // numbers
  const faces = groupFaces(tris)
  let corners: Die['corners'] = null
  const z = new THREE.Vector3(0, 0, 1)
  const addLabel = (value: number, at: THREE.Vector3, n: THREE.Vector3, size: number) => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), labelMaterial(value))
    plane.position.copy(at)
    plane.quaternion.setFromUnitVectors(z, n)
    mesh.add(plane)
  }
  if (spec.sides === 4) {
    corners = verts.map((p, i) => ({ p, value: i + 1 }))
    for (const f of faces) {
      for (const c of corners) {
        if (Math.abs(c.p.clone().sub(f.c).dot(f.n)) < 1e-3) {
          addLabel(c.value, f.c.clone().lerp(c.p, 0.5).addScaledVector(f.n, 0.008), f.n, f.r * 0.55)
        }
      }
    }
  } else {
    numberFaces(faces, spec.sides)
    for (const f of faces) addLabel(f.value, f.c.clone().addScaledVector(f.n, 0.008), f.n, f.r * 0.9)
  }

  // physics body
  const shape = new CANNON.ConvexPolyhedron({
    vertices: verts.map((v) => new CANNON.Vec3(v.x, v.y, v.z)),
    faces: faceIdx,
  })
  const body = new CANNON.Body({ mass: 1, shape, allowSleep: false })

  return { spec, mesh, body, faces, corners, rolling: false, rest: 0, age: 0, phase: rand(0, 6.28) }
}

export function disposeDie(d: Die) {
  d.mesh.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.geometry) m.geometry.dispose()
  })
  ;(d.mesh.material as THREE.Material).dispose()
  d.mesh.children.forEach((c) => {
    if (c instanceof THREE.LineSegments) (c.material as THREE.Material).dispose()
  })
}

/** Which number is facing up right now */
export function readValue(d: Die): number {
  const q = new THREE.Quaternion(d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w)
  if (d.corners) {
    let best = d.corners[0]
    let top = -Infinity
    for (const c of d.corners) {
      const y = c.p.clone().applyQuaternion(q).y
      if (y > top) {
        top = y
        best = c
      }
    }
    return best.value
  }
  let best = d.faces[0]
  let top = -Infinity
  for (const f of d.faces) {
    const y = f.n.clone().applyQuaternion(q).y
    if (y > top) {
      top = y
      best = f
    }
  }
  return best.value
}

/* ------------------------------------------------------------------ */
/* A small physics world with a floor, four walls and a ceiling        */
/* ------------------------------------------------------------------ */
export interface WorldOpts {
  halfX: number
  halfZ: number
  fill: number // fraction of the viewport the floor should cover
  gravity: number
}

export class DiceWorld {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
  readonly renderer: THREE.WebGLRenderer
  readonly world = new CANNON.World()
  dice: Die[] = []
  /** the loop only simulates and renders while this is true or activeUntil is in the future */
  forceActive = false
  activeUntil = 0

  private raf = 0
  private last = 0
  private shakeStart = 0
  private shakeUntil = 0
  private lastHop = 0
  private ro: ResizeObserver
  private ray = new THREE.Raycaster()
  private shadowFloor: THREE.Mesh

  constructor(private host: HTMLElement, readonly opts: WorldOpts) {
    const { halfX, halfZ } = opts
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    host.appendChild(this.renderer.domElement)

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8))
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2)
    sun.position.set(halfX * 0.6, 12, halfZ * 0.5)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    const s = Math.max(halfX, halfZ) * 1.5
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 30 })
    this.scene.add(sun)

    this.shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(halfX * 6, halfZ * 6), new THREE.ShadowMaterial({ opacity: 0.35 }))
    this.shadowFloor.rotation.x = -Math.PI / 2
    this.shadowFloor.receiveShadow = true
    this.scene.add(this.shadowFloor)

    this.world.gravity.set(0, opts.gravity, 0)
    ;(this.world.solver as CANNON.GSSolver).iterations = 12
    this.world.defaultContactMaterial.friction = 0.35
    this.world.defaultContactMaterial.restitution = 0.3
    this.plane([-Math.PI / 2, 0, 0], [0, 0, 0]) // floor
    this.plane([Math.PI / 2, 0, 0], [0, 7, 0]) // ceiling
    this.plane([0, Math.PI / 2, 0], [-halfX, 0, 0])
    this.plane([0, -Math.PI / 2, 0], [halfX, 0, 0])
    this.plane([0, 0, 0], [0, 0, -halfZ])
    this.plane([0, Math.PI, 0], [0, 0, halfZ])

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.resize()
  }

  private plane(euler: [number, number, number], at: [number, number, number]) {
    const b = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() })
    b.quaternion.setFromEuler(euler[0], euler[1], euler[2])
    b.position.set(at[0], at[1], at[2])
    this.world.addBody(b)
  }

  resize() {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    const t = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    const { halfX, halfZ, fill } = this.opts
    const dist = Math.max((2 * halfZ) / fill / t, (2 * halfX) / fill / (t * this.camera.aspect))
    this.camera.position.set(0, dist, dist * 0.18)
    this.camera.lookAt(0, 0, 0)
    this.camera.updateProjectionMatrix()
  }

  add(index: number, scale: number, at: [number, number, number]): Die {
    const d = createDie(DICE[index], scale)
    d.body.position.set(at[0], at[1], at[2])
    d.body.quaternion.setFromEuler(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28))
    this.world.addBody(d.body)
    this.scene.add(d.mesh)
    this.sync(d)
    this.dice.push(d)
    return d
  }

  remove(d: Die) {
    this.world.removeBody(d.body)
    this.scene.remove(d.mesh)
    disposeDie(d)
    this.dice = this.dice.filter((x) => x !== d)
  }

  /** Throw from the near edge towards the far wall */
  throw(d: Die) {
    const { halfX, halfZ } = this.opts
    d.body.position.set(rand(-halfX * 0.5, halfX * 0.5), 3, halfZ * 0.8)
    d.body.velocity.set(rand(-3, 3), rand(1, 3), -rand(9, 14) * (halfZ / 3.5))
    d.body.angularVelocity.set(rand(-18, 18), rand(-18, 18), rand(-18, 18))
    d.rolling = true
    d.rest = 0
    d.age = 0
  }

  /** Small hop, used as click feedback */
  jolt(d: Die) {
    d.body.velocity.set(rand(-1, 1), rand(5, 7), rand(-1, 1))
    d.body.angularVelocity.set(rand(-8, 8), rand(-8, 8), rand(-8, 8))
  }

  /** Slosh everything around, like the tray is being dragged open or shut */
  shake(ms: number) {
    const now = performance.now()
    this.shakeStart = now
    this.shakeUntil = now + ms
    this.lastHop = 0
    this.activeUntil = Math.max(this.activeUntil, this.shakeUntil + 1500)
  }

  pick(clientX: number, clientY: number): Die | null {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera)
    const hit = this.ray.intersectObjects(this.dice.map((d) => d.mesh), true)[0]
    if (!hit) return null
    return this.dice.find((d) => d.mesh === hit.object || d.mesh === hit.object.parent) ?? null
  }

  private sync(d: Die) {
    d.mesh.position.set(d.body.position.x, d.body.position.y, d.body.position.z)
    d.mesh.quaternion.set(d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w)
  }

  private step(dt: number, now: number) {
    if (now < this.shakeUntil) {
      const t = (now - this.shakeStart) / (this.shakeUntil - this.shakeStart)
      const amp = 55 * (1 - t)
      const w = ((now - this.shakeStart) / 1000) * 14
      const hop = now - this.lastHop > 160
      if (hop) this.lastHop = now
      for (const d of this.dice) {
        d.body.applyForce(new CANNON.Vec3(Math.sin(w + d.phase) * amp, 0, Math.cos(w * 1.3 + d.phase) * amp * 0.8))
        if (hop && t < 0.7) {
          d.body.velocity.y = rand(3, 6)
          d.body.angularVelocity.set(rand(-9, 9), rand(-9, 9), rand(-9, 9))
        }
      }
    }
    this.world.step(1 / 60, dt, 3)
    for (const d of this.dice) {
      this.sync(d)
      if (!d.rolling) continue
      d.age += dt
      const calm = d.body.velocity.lengthSquared() < 0.05 && d.body.angularVelocity.lengthSquared() < 0.1
      d.rest = calm ? d.rest + dt : 0
      if (d.rest > 0.45 || d.age > 7) {
        d.rolling = false
        d.onSettle?.(readValue(d))
      }
    }
  }

  start() {
    this.last = performance.now()
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick)
      const dt = Math.min((now - this.last) / 1000, 0.05)
      this.last = now
      if (!this.forceActive && now > this.activeUntil) return
      this.step(dt, now)
      this.renderer.render(this.scene, this.camera)
    }
    this.raf = requestAnimationFrame(tick)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    ;[...this.dice].forEach((d) => this.remove(d))
    this.shadowFloor.geometry.dispose()
    ;(this.shadowFloor.material as THREE.Material).dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
