// ROAMA round 4b - the phone / portrait version of the cutaway-tower tour.
//
// The player keeps the horizontal angle of view on screens narrower than the poster, so on a portrait screen the
// desktop camera path showed two or three floors stacked small (QA, round 4b). The portrait version is its own
// camera path, scene-3d.phone.json: the same model and the same scroll stops (the same 'at' values, so
// tour-stops.json and the captions apply unchanged), with cameras that stay in front of the cut face and frame one
// room on its agent.
//   phones (up to 767 px): the element is replaced, BEFORE the 3D loads (no GLB, no WebGL), by the scroll-scrubbed
//     WebP frame sequence of that path: frames/frame_000.webp .. frame_041.webp, 720x1280.
//   portrait tablets (768-1024 px, portrait): the element is pointed at scene-3d.phone.json (live 3D, same path).
//   reduced motion / Save-Data: the poster as a still.
//
// Load it before the player, both as modules:
//   <script type="module" src="/3d/tour-phone.js"></script>
//   <script type="module" src="/3d/scene-3d/scene-3d.js"></script>
//   <scene-3d src="/3d/scene-3d.json" mode="scroll" length="700" label="..."
//             data-phone-src="/3d/scene-3d.phone.json" data-phone-frames="/3d/frames/" data-frame-count="42"
//             data-poster="/3d/models/poster.webp"></scene-3d>
// data-phone-mode="live" keeps the live 3D (phone path) on phones too.
const PHONE = '(max-width: 767px)'
const PORTRAIT = '(max-width: 1024px) and (orientation: portrait)'
const FRAME_W = 720
const FRAME_H = 1280

function frames(el) {
  const base = new URL(el.dataset.phoneFrames, document.baseURI)
  const count = Number(el.dataset.frameCount || 42)
  const length = Number(el.getAttribute('length') || 200)
  const poster = el.dataset.poster ? new URL(el.dataset.poster, document.baseURI).href : new URL('../models/poster.webp', base).href
  const label = el.getAttribute('label') || ''
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData === true

  const box = document.createElement('div')
  box.className = 'scene-3d-frames'
  box.setAttribute('role', 'img')
  box.setAttribute('aria-label', label)
  const stage = document.createElement('div')
  stage.className = 'scene-3d-frames__stage'
  const canvas = document.createElement('canvas')
  canvas.width = FRAME_W
  canvas.height = FRAME_H
  canvas.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain'
  const texts = [...el.children]
  for (const t of texts) stage.appendChild(t)

  if (still) {
    const img = document.createElement('img')
    img.src = poster
    img.alt = ''
    img.style.cssText = 'display:block;width:100%;height:auto'
    stage.style.cssText = 'position:relative'
    stage.prepend(img)
    box.appendChild(stage)
    el.replaceWith(box)
    return
  }

  // iOS (TASK-0455 r4b, the Owner's iPhone 15: jerky, jumping, flickering): sizes in svh so the address bar showing or
  // hiding does not change them; the scroll span is measured from the box itself, never from innerHeight.
  box.style.cssText = `position:relative;height:calc(100svh + ${length}svh)`
  stage.style.cssText = 'position:sticky;top:0;height:100svh;overflow:hidden'
  stage.prepend(canvas)
  box.appendChild(stage)
  el.replaceWith(box)

  const ctx = canvas.getContext('2d', { alpha: false })
  // Frames are fetched once as small compressed blobs; only a window of decoded ImageBitmaps around the current frame
  // is kept (iOS evicts decoded <img> data and re-decodes on every drawImage -> stalls and blank frames). The canvas is
  // never cleared: until the wanted frame is decoded, the last drawn one stays on screen.
  const WINDOW = 4
  const blobs = new Array(count)
  const bitmaps = new Map()
  const pending = new Set()
  let shown = -1
  let want = 0
  const src = (i) => new URL(`frame_${String(i).padStart(3, '0')}.webp`, base).href
  const decode = (i) => {
    if (i < 0 || i >= count || bitmaps.has(i) || pending.has(i) || !blobs[i]) return
    pending.add(i)
    createImageBitmap(blobs[i]).then((bmp) => {
      pending.delete(i)
      if (Math.abs(i - want) > WINDOW) { bmp.close?.(); return }
      bitmaps.set(i, bmp)
      queue()
    }).catch(() => pending.delete(i))
  }
  const prune = () => {
    for (const [i, bmp] of bitmaps) if (Math.abs(i - want) > WINDOW) { bmp.close?.(); bitmaps.delete(i) }
  }
  const draw = () => {
    for (let d = 0; d <= WINDOW; d++) decode(want + d), decode(want - d)
    prune()
    let best = -1
    for (const i of bitmaps.keys()) if (best < 0 || Math.abs(i - want) < Math.abs(best - want)) best = i
    if (best >= 0 && best !== shown) { ctx.drawImage(bitmaps.get(best), 0, 0, canvas.width, canvas.height); shown = best }
  }
  const at = texts.filter((t) => t.dataset.at !== undefined)
  for (const t of at) t.style.transition = 'opacity .5s ease-out, transform .5s ease-out'
  let queued = false
  let last = -1
  const update = () => {
    queued = false
    const r = box.getBoundingClientRect()
    const span = Math.max(1, box.offsetHeight - stage.offsetHeight)
    const p = Math.min(Math.max(-r.top / span, 0), 1)
    want = Math.round(p * (count - 1))
    draw()
    const step = Math.round(p * 1000)
    if (step === last) return
    last = step
    for (const t of at) {
      const on = p >= Number(t.dataset.at)
      t.style.opacity = on ? '1' : '0'
      t.style.transform = on ? 'none' : 'translateY(0.6em)'
    }
  }
  function queue() { if (!queued) { queued = true; requestAnimationFrame(update) } }
  // Fetch every frame (about 0.75 MB together) nearest-first from the current position.
  const order = [...Array(count).keys()].sort((a, b) => Math.abs(a - want) - Math.abs(b - want))
  let next = 0
  const pump = () => {
    if (next >= order.length) return
    const i = order[next++]
    fetch(src(i)).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) { blobs[i] = b; if (Math.abs(i - want) <= WINDOW) queue() } })
      .catch(() => {}).finally(pump)
  }
  for (let k = 0; k < 4; k++) pump()
  addEventListener('scroll', queue, { passive: true })
  let width = innerWidth
  addEventListener('resize', () => { if (innerWidth !== width) { width = innerWidth; queue() } }) // height-only = the iOS bar
  update()
}

const phone = matchMedia(PHONE).matches
if (phone || matchMedia(PORTRAIT).matches) {
  for (const el of document.querySelectorAll('scene-3d[mode="scroll"]')) {
    if (phone && el.dataset.phoneFrames && el.dataset.phoneMode !== 'live') frames(el)
    else if (el.dataset.phoneSrc) el.setAttribute('src', el.dataset.phoneSrc)
  }
}
