// ROAMA hero add-on for <scene-3d> (TASK-0455 round 4). It changes no engine file:
// `scene-3d web` may rebuild web/scene-3d/ at any time and this keeps working.
//
//   <script type="module" src="/3d/roama-hero.js"></script>   <!-- BEFORE scene-3d.js -->
//   <script type="module" src="/3d/scene-3d/scene-3d.js"></script>
//   <scene-3d src="/3d/scene-3d.json" mode="scroll" length="250" label="Atlas"
//             data-hero="/3d/roama-hero.json"></scene-3d>
//
// What it does (settings in roama-hero.json, each one may be overridden by an attribute):
// 1. still: with reduced motion, Save-Data or no WebGL the element shows the scroll-1 still
//    (models/poster-still.webp, the full robot) instead of the loading poster (the scroll-0 close-up),
//    and the box is never taller than the screen, so the portrait still stands whole and centred.
// 2. look: on a desktop with a mouse the cursor turns the head node (atlas_head) by at most
//    +-yaw degrees left/right and +-pitch degrees up/down, eased; it rides on top of the scroll pose.
//    Off with reduced motion, on touch screens and below min_width.
const DEFAULTS = {
  look: { node: 'atlas_head', yaw: 8, pitch: 4, min_width: 769, pointer: 'fine', ease: 0.08 },
  still: { poster: 'models/poster-still.webp', aspect: 0.6667 },
}

// three.js announces each new Scene to __THREE_DEVTOOLS__ (an EventTarget); the browser's three.js
// devtools set the same object, so join it when it is there.
const devtools = globalThis.__THREE_DEVTOOLS__ ?? (globalThis.__THREE_DEVTOOLS__ = new EventTarget())
const scenes = []
const claimed = new WeakSet()
devtools.addEventListener('observe', (e) => { if (e.detail?.isScene) scenes.push(e.detail) })

const configs = new Map()
function config(el) {
  const url = el.getAttribute('data-hero')
  if (!configs.has(url)) {
    configs.set(url, url
      ? fetch(new URL(url, document.baseURI)).then((r) => r.json()).catch(() => ({}))
      : Promise.resolve({}))
  }
  return configs.get(url).then((c) => {
    const look = { ...DEFAULTS.look, ...(c.look ?? {}) }
    const still = { ...DEFAULTS.still, ...(c.still ?? {}) }
    const num = (name, fallback) => (el.hasAttribute(name) ? Number(el.getAttribute(name)) : fallback)
    look.node = el.getAttribute('data-look-node') ?? look.node
    look.yaw = num('data-look-yaw', look.yaw)
    look.pitch = num('data-look-pitch', look.pitch)
    still.poster = el.getAttribute('data-still') ?? still.poster
    // a relative still is taken from the folder of the manifest, like the engine's own poster
    const base = el.manifestUrl ?? new URL(el.getAttribute('src') ?? 'scene-3d.json', document.baseURI)
    still.url = new URL(still.poster, base).href
    return { look, still }
  })
}

// 1. the reduced-motion / Save-Data / no-WebGL still
document.addEventListener('scene-poster', async (e) => {
  const el = e.target
  // only the hero (data-hero): the other scenes of the page (office tour, round 3) keep their own posters
  if (el.localName !== 'scene-3d' || !el.hasAttribute('data-hero')) return
  const { still } = await config(el)
  const img = el.poster ?? el.querySelector(':scope > img')
  if (img && still.url) img.src = still.url
  if (el.getAttribute('mode') === 'scroll') {
    const fit = () => { el.style.aspectRatio = String(Math.max(still.aspect, innerWidth / Math.max(innerHeight, 1))) }
    fit()
    addEventListener('resize', fit)
  }
}, true) // capture: the element's events do not bubble

// 2. the cursor turns the head
document.addEventListener('scene-ready', async (e) => {
  const el = e.target
  const player = e.detail
  if (el.localName !== 'scene-3d' || !player || !el.hasAttribute('data-hero')) return
  const { look } = await config(el)
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const forced = el.hasAttribute('data-look-at') // the QA hook below needs no mouse
  if (!forced && look.pointer && !matchMedia(`(pointer: ${look.pointer})`).matches) return
  if (!forced && innerWidth < look.min_width) return
  // each player has its own scene: take the first one with the node that no other element took
  const scene = scenes.find((s) => !claimed.has(s) && s.getObjectByName(look.node))
  if (scene) claimed.add(scene)
  const head = scene?.getObjectByName(look.node)
  if (!head) { console.info(`roama-hero: no node ${look.node}, the cursor look is off`); return }

  const Q = head.quaternion.constructor
  const E = head.rotation.constructor
  const rest = head.quaternion.clone() // the pose the scroll gave it
  const offset = new Q()
  const euler = new E()
  const D = Math.PI / 180
  const want = { yaw: 0, pitch: 0 }
  const now = { yaw: 0, pitch: 0 }
  let frame = 0

  const apply = () => {
    // glTF is Y up: yaw about Y (cursor right = the robot looks to the viewer's right), pitch about X
    euler.set(now.pitch * D, now.yaw * D, 0, 'YXZ')
    offset.setFromEuler(euler)
    head.quaternion.copy(rest).multiply(offset)
  }
  // the scroll writes the head's pose first, the cursor rides on top of it
  const seek = player.seek
  player.seek = (p) => {
    head.quaternion.copy(rest)
    seek(p)
    rest.copy(head.quaternion)
    apply()
    player.render()
  }
  const step = () => {
    now.yaw += (want.yaw - now.yaw) * look.ease
    now.pitch += (want.pitch - now.pitch) * look.ease
    apply()
    player.render()
    const done = Math.abs(want.yaw - now.yaw) < 0.01 && Math.abs(want.pitch - now.pitch) < 0.01
    frame = done ? 0 : requestAnimationFrame(step)
  }
  const go = () => { if (!frame) frame = requestAnimationFrame(step) }
  const clamp = (v) => Math.max(-1, Math.min(1, v))
  addEventListener('pointermove', (ev) => {
    if (ev.pointerType && ev.pointerType !== 'mouse') return
    const box = el.getBoundingClientRect()
    if (box.bottom < 0 || box.top > innerHeight) return // off screen: nothing to turn
    want.yaw = clamp((ev.clientX / innerWidth) * 2 - 1) * look.yaw
    want.pitch = clamp((ev.clientY / innerHeight) * 2 - 1) * look.pitch
    go()
  }, { passive: true })
  document.documentElement.addEventListener('pointerleave', () => { want.yaw = 0; want.pitch = 0; go() })
  // QA hook: data-look-at="1,0" holds the cursor at the right edge (x, y in -1..1), no mouse needed
  const at = el.getAttribute('data-look-at')
  if (at) {
    const [x, y] = at.split(',').map(Number)
    now.yaw = want.yaw = clamp(x || 0) * look.yaw
    now.pitch = want.pitch = clamp(y || 0) * look.pitch
    apply()
    player.render()
  }
  el.dataset.look = `${look.node} ${now.yaw.toFixed(1)} ${now.pitch.toFixed(1)}`
}, true)
