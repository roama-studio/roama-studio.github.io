// Pure maths of the <scene-3d> player, without three.js (tested in Node).
//
// scene.json speaks Blender: metres, Z up, the front faces -Y, rotations as
// XYZ Euler degrees, fov = horizontal degrees. three.js (and the GLB) is Y up.
// The turn between them, (x, y, z) -> (x, z, -y), is a proper rotation, so
// points, scales and quaternion axes all follow the same rule.

export const toThree = ([x, y, z]) => [x, z, -y]
export const scaleToThree = ([x, y, z]) => [x, z, y]

const quatMul = ([ax, ay, az, aw], [bx, by, bz, bw]) => [
  aw * bx + ax * bw + ay * bz - az * by,
  aw * by - ax * bz + ay * bw + az * bx,
  aw * bz + ax * by - ay * bx + az * bw,
  aw * bw - ax * bx - ay * by - az * bz,
]

const axisAngle = (axis, degrees) => {
  const half = (degrees * Math.PI) / 360
  const s = Math.sin(half)
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)]
}

// Blender's XYZ Euler (X first, then Y, then Z, about fixed axes) as a
// three.js quaternion [x, y, z, w].
export function quatFromBlenderEuler([rx, ry, rz]) {
  const q = quatMul(axisAngle([0, 0, 1], rz), quatMul(axisAngle([0, 1, 0], ry), axisAngle([1, 0, 0], rx)))
  return [...toThree(q.slice(0, 3)), q[3]]
}

export function rotate(q, v) {
  const [x, y, z, w] = quatMul(quatMul(q, [...v, 0]), [-q[0], -q[1], -q[2], q[3]])
  return [x, y, z].map((n) => Math.round(n * 1e12) / 1e12)
}

function slerp(a, b, t) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  const to = dot < 0 ? b.map((n) => -n) : b
  dot = Math.abs(dot)
  if (dot > 0.9995) {
    const q = a.map((n, i) => n + (to[i] - n) * t)
    const len = Math.hypot(...q)
    return q.map((n) => n / len)
  }
  const angle = Math.acos(dot)
  const sa = Math.sin(angle)
  const wa = Math.sin((1 - t) * angle) / sa
  const wb = Math.sin(t * angle) / sa
  return a.map((n, i) => n * wa + to[i] * wb)
}

const lerp = (a, b, t) => a.map((n, i) => n + (b[i] - n) * t)
const ease = (t) => t * t * (3 - 2 * t) // slow in and out

// The vertical field of view for a screen. A screen narrower than the poster
// keeps the poster's horizontal angle; a wider one keeps its vertical angle,
// so the model is never cut. frame (the manifest's): how far the model reaches
// from the poster's middle, as a share of its half width and half height; a
// narrower screen then closes in on the model (FRAME_FILL of the screen), never
// further out than the poster's horizontal angle.
const FRAME_FILL = 0.8
export function verticalFov(fovH, aspect, posterAspect = 1.6, frame = null) {
  const tanH = Math.tan((fovH * Math.PI) / 360)
  let tanV = tanH / Math.min(aspect, posterAspect)
  if (frame && aspect < posterAspect) {
    const fit = Math.max((frame.width * tanH) / aspect, (frame.height * tanH) / posterAspect) / FRAME_FILL
    tanV = Math.min(tanV, fit)
  }
  return (Math.atan(tanV) * 360) / Math.PI
}

// The viewer's box: the poster's shape, or on a narrow screen (a phone) the
// model's own shape (manifest phone_aspect), so a tall model is not a strip.
export const NARROW = 600
export function boxAspect(manifest, width) {
  return width < NARROW && manifest.phone_aspect ? manifest.phone_aspect : (manifest.aspect ?? 1.6)
}

// The poster's automatic view (scene_steps._fit_distance): three-quarter from
// the front right, a little above, the model's box filling 80% of the frame.
// box = {min, max} in three.js coordinates.
export function autoCamera(box, fovH = 35, aspect = 1.6, fill = 0.8) {
  const center = box.min.map((n, i) => (n + box.max[i]) / 2)
  const d = toThree([0.55, -1.0, 0.45])
  const len = Math.hypot(...d)
  const direction = d.map((n) => n / len)
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const norm = (v) => { const l = Math.hypot(...v); return v.map((n) => n / l) }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const forward = direction.map((n) => -n)
  const right = norm(cross(forward, [0, 1, 0]))
  const up = norm(cross(right, forward))
  const tanH = Math.tan((fovH * Math.PI) / 360) * fill
  const tanV = tanH / aspect
  let need = 0
  for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) {
    const p = [x - center[0], y - center[1], z - center[2]]
    const depth = dot(p, direction)
    need = Math.max(need, depth + Math.abs(dot(p, right)) / tanH, depth + Math.abs(dot(p, up)) / tanV)
  }
  return { position: center.map((n, i) => n + direction[i] * need), target: center, fov: fovH }
}

// Text over the scene (a hero heading with data-at): hidden under its own bottom
// line until the scroll reaches `at`, then it rises out of it and comes into focus
// over `span` of the scroll. rise = how much of its height is still under the line.
export function reveal(progress, at, span = 0.2) {
  const t = ease(Math.min(Math.max((progress - at) / span, 0), 1))
  return { opacity: t, rise: 1 - t, blur: (1 - t) * 10 }
}

// Ring `index` of a ripple that starts at `at`: rings follow each other by a
// quarter of their life; radius 0..1 of the node's width, fading as it spreads.
export function ripple(progress, at, index, span = 0.3) {
  const local = (progress - at) / span - index * 0.25
  if (local <= 0 || local >= 1) return { radius: 0, opacity: 0 }
  return { radius: local, opacity: (1 - local) * 0.6 }
}

// The camera round its target, Blender coordinates: angle 0 = in front (-Y),
// 90 = to the viewer's right (+X), in degrees; height = metres above the target.
const fromThree = ([x, y, z]) => [x, -z, y]
const orbitOffset = ({ angle, radius, height = 0 }) => {
  const a = (angle * Math.PI) / 180
  return [radius * Math.sin(a), -radius * Math.cos(a), height]
}
const orbitOf = (position, target) => {
  const [dx, dy, dz] = position.map((n, i) => n - target[i])
  return { angle: (Math.atan2(dx, -dy) * 180) / Math.PI, radius: Math.hypot(dx, dy), height: dz }
}
const cameraPosition = (camera) =>
  camera.orbit ? orbitOffset(camera.orbit).map((n, i) => n + camera.target[i]) : camera.position

// How the scroll walks the path. "keys" (the first player): every segment eases
// on its own, so the view rests at every key. "smooth": one ease over the whole
// path (slow in at the first key, out at the last) and a curve through the keys.
function timeline(keys, mode) {
  if (mode !== 'smooth' || keys.length === 0) return { warp: (p) => p, mode: 'keys' }
  const first = keys[0].at
  const last = keys[keys.length - 1].at
  const warp = (p) => (last > first ? first + (last - first) * ease(Math.min(Math.max((p - first) / (last - first), 0), 1)) : p)
  return { warp, mode, first, last }
}

// Tangents of a curve through numbers at times t (Steffen 1990): smooth (C1),
// never past a key's value. A curve's own ends are flat, unless they are the
// ends of the whole path (the one ease slows there already).
function tangents(t, v, line) {
  const n = v.length
  const d = []
  for (let i = 0; i < n - 1; i++) d.push((v[i + 1] - v[i]) / (t[i + 1] - t[i] || 1))
  const m = new Array(n).fill(0)
  for (let i = 1; i < n - 1; i++) {
    const h0 = t[i] - t[i - 1]
    const h1 = t[i + 1] - t[i]
    const p = (d[i - 1] * h1 + d[i] * h0) / (h0 + h1)
    m[i] = (Math.sign(d[i - 1]) + Math.sign(d[i])) * Math.min(Math.abs(d[i - 1]), Math.abs(d[i]), 0.5 * Math.abs(p))
  }
  if (n > 1) {
    if (t[0] <= line.first) m[0] = d[0]
    if (t[n - 1] >= line.last) m[n - 1] = d[n - 2]
  }
  return m
}

function hermite(t, v, m, s) {
  let i = 0
  while (i < t.length - 2 && s > t[i + 1]) i++
  const h = t[i + 1] - t[i]
  if (h <= 0) return v[i + 1]
  const u = (s - t[i]) / h
  const u2 = u * u
  const u3 = u2 * u
  return (2 * u3 - 3 * u2 + 1) * v[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * v[i + 1] + (u3 - u2) * h * m[i + 1]
}

const lerpAny = (a, b, t) => (Array.isArray(a) ? lerp(a, b, t) : a + (b - a) * t)

// One property along the scroll: points [{at, value}] sorted by `at`; value is a
// number or a list of numbers (a curve on the smooth path) or, with `mix`,
// anything mixed by it (quaternions: slerp).
function sample(points, p, mix, line) {
  if (points.length === 0) return undefined
  const s = line.warp(p)
  if (s <= points[0].at) return points[0].value
  const end = points[points.length - 1]
  if (s >= end.at) return end.value
  if (line.mode === 'smooth' && !mix) {
    const t = points.map((q) => q.at)
    const curve = (values) => hermite(t, values, tangents(t, values, line), s)
    const v0 = points[0].value
    return Array.isArray(v0) ? v0.map((_, k) => curve(points.map((q) => q.value[k]))) : curve(points.map((q) => q.value))
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (s <= b.at) {
      if (b.at === a.at) return b.value
      const local = (s - a.at) / (b.at - a.at)
      return (mix ?? lerpAny)(a.value, b.value, line.mode === 'smooth' ? local : ease(local))
    }
  }
  return end.value
}

// The camera on the smooth path: its target on a curve and the camera round it
// (angle, radius, height) on another, so it orbits on an arc, not a chord. An
// angle from a position key takes the short way from the key before; an orbit
// key's angle is taken as written (270 turns three quarters).
function smoothCamera(points, p, line) {
  let previous = null
  const orbits = points.map(({ at, value }) => {
    const target = value.target
    const o = value.orbit ? { ...value.orbit, height: value.orbit.height ?? 0 } : orbitOf(value.position, target)
    if (!value.orbit && previous !== null) {
      o.angle = o.radius < 1e-9 ? previous : previous + ((((o.angle - previous) % 360) + 540) % 360) - 180
    }
    previous = o.angle
    return { at, value: [...target, o.angle, o.radius, o.height] }
  })
  const [tx, ty, tz, angle, radius, height] = sample(orbits, p, null, line)
  const target = [tx, ty, tz]
  return { position: orbitOffset({ angle, radius, height }).map((n, i) => n + target[i]), target }
}

// Each property follows only the keys that set it. With `base` (the model's
// own pose and the starting camera, three.js coordinates) a property whose
// first key comes after 0 starts from that pose at 0; without it, it is held.
// path: "keys" (default) or "smooth" (see timeline).
export function sampleScroll(keys, progress, base = {}, path = 'keys') {
  const sorted = [...keys].sort((a, b) => a.at - b.at)
  const line = timeline(sorted, path)
  const track = (pick, convertValue, start) => {
    const points = sorted.filter((k) => pick(k) !== undefined).map((k) => ({ at: k.at, value: convertValue(pick(k)) }))
    if (start !== undefined && (points.length === 0 || points[0].at > 0)) points.unshift({ at: 0, value: start })
    return points
  }
  const same = (v) => v
  const camera = {}
  const placed = (k) => (k.camera?.position || k.camera?.orbit ? k.camera : undefined)
  if (line.mode === 'smooth') {
    const start = base.camera?.position && base.camera?.target
      ? { position: fromThree(base.camera.position), target: fromThree(base.camera.target) } : undefined
    const points = track(placed, same, start)
    if (points.length) {
      const { position, target } = smoothCamera(points, progress, line)
      camera.position = toThree(position)
      camera.target = toThree(target)
    }
  } else {
    const position = sample(track((k) => placed(k) && cameraPosition(k.camera), toThree, base.camera?.position),
      progress, null, line)
    if (position !== undefined) camera.position = position
    const target = sample(track((k) => k.camera?.target, toThree, base.camera?.target), progress, null, line)
    if (target !== undefined) camera.target = target
  }
  const fov = sample(track((k) => k.camera?.fov, same, base.camera?.fov), progress, null, line)
  if (fov !== undefined) camera.fov = fov
  const nodes = {}
  const names = new Set(sorted.flatMap((k) => Object.keys(k.nodes ?? {})))
  for (const name of names) {
    const own = base.nodes?.[name] ?? {}
    const pose = {}
    for (const [prop, from, convertValue, mix] of [
      ['position', 'position', toThree, null],
      ['quaternion', 'rotation', quatFromBlenderEuler, slerp],
      ['scale', 'scale', scaleToThree, null],
    ]) {
      const value = sample(track((k) => k.nodes?.[name]?.[from], convertValue, own[prop]), progress, mix, line)
      if (value !== undefined) pose[prop] = value
    }
    nodes[name] = pose
  }
  return { camera: Object.keys(camera).length ? camera : null, nodes }
}

// The scroll scene sampled from start to end (for the review): steps + 1 states.
export function samplePath(scroll, steps = 200, base = {}) {
  const out = []
  for (let i = 0; i <= steps; i++) {
    const p = i / steps
    out.push({ p, ...sampleScroll(scroll?.keys ?? [], p, base, scroll?.path) })
  }
  return out
}

// ScrollTrigger's scrub: the site's own attribute wins; under a smooth scroll
// (Lenis) the page already glides, so the view follows it at once (a second
// lag would trail behind the page).
export function scrubFor(attribute, smoothScroll) {
  if (attribute === 'true') return true
  if (attribute !== null && attribute !== undefined && attribute !== '') return Number(attribute)
  return smoothScroll ? true : 0.6
}
