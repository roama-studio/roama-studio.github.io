// ROAMA round 4b + TASK-0762 (8 floors, 33 beats) - the phone / portrait version of the cutaway-tower tour.
// TASK-0788: the round-4b iOS fix (ImageBitmap window, svh sizes, span from the box) is back - the 0762 package sync
// had put the package's plain version over it; master copy: tools/patches/tour-phone.js (sync-3d-building restores it).
//
// The player keeps the horizontal angle of view on screens narrower than the poster, so on a portrait screen the
// desktop camera path showed two or three floors stacked small (QA, round 4b). The portrait version is its own
// camera path, scene-3d.phone.json: the same model and the same scroll stops (the same 'at' values, so
// tour-stops.json and the captions apply unchanged), with cameras that stay in front of the cut face and frame one
// room on its agent.
//   phones (up to 767 px): the element is replaced, BEFORE the 3D loads (no GLB, no WebGL), by the scroll-scrubbed
//     WebP frame sequence of that path: frames/frame_000.webp .. frame_047.webp, 720x1280.
//   portrait tablets (768-1024 px, portrait): the element is pointed at scene-3d.phone.json (live 3D, same path).
//   reduced motion / Save-Data: the poster as a still.
//
// Load it before the player, both as modules:
//   <script type="module" src="/3d/tour-phone.js"></script>
//   <script type="module" src="/3d/scene-3d/scene-3d.js"></script>
//   <scene-3d src="/3d/scene-3d.json" mode="scroll" length="1100" label="..."
//             data-phone-src="/3d/scene-3d.phone.json" data-phone-frames="/3d/frames/" data-frame-count="48"
//             data-poster="/3d/models/poster.webp"></scene-3d>
// data-phone-mode="live" keeps the live 3D (phone path) on phones too.
//   weak computers (TASK-0794 round 4, the Owner's work PC): where scene-3d.js would give the tower only its poster
//     (no WebGL 2, WebGL drawn by the CPU, or the player gave up on this machine earlier in the visit), the tour gets
//     these frames instead - the stepped tower with its cards and floors panel, not the flat list of rooms. The frame
//     stands in the free band right of the card. The reason is stamped on the frame box (data-lite) for a check on that
//     PC; ?lite3d forces it (QA). Reduced motion and Save-Data keep the still as before. A GPU that only turns out too
//     slow on this visit (the player steps down its tiers and gives up: 'scene-slow') swaps to the frames there and
//     then, at the same scroll place (data-lite="slow-now"), instead of a still poster for the rest of the tour.
const PHONE = '(max-width: 767px)'
const PORTRAIT = '(max-width: 1024px) and (orientation: portrait)'
const FRAME_W = 720
const FRAME_H = 1280
// the frame strip's sides melt into the stage colour (weak computers; tower-loop.js lays the video over it the same way)
const SOFT = 'mask-image:linear-gradient(to right,transparent,#000 9%,#000 91%,transparent);-webkit-mask-image:linear-gradient(to right,transparent,#000 9%,#000 91%,transparent)'

function frames(el, lite = '') {
  const base = new URL(el.dataset.phoneFrames, document.baseURI)
  const count = Number(el.dataset.frameCount || 48)
  // TASK-0788: data-phone-length; a weak computer keeps the computer's scroll length (the wheel steps by it)
  const length = Number((lite ? el.getAttribute('length') : el.dataset.phoneLength) || el.getAttribute('length') || 200)
  const poster = el.dataset.poster ? new URL(el.dataset.poster, document.baseURI).href : new URL('../models/poster.webp', base).href
  const label = el.getAttribute('label') || ''
  // TASK-0794: data-frame-hold="5 8,..." - the frames of a living floor's beats show its first one (the home's camera
  // is held there, and the floor's loop video starts from that very picture)
  const hold = (el.dataset.frameHold || '').split(',').map((r) => r.trim().split(/\s+/).map(Number)).filter((r) => r.length === 2 && r.every(Number.isFinite))
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
  canvas.style.cssText = lite
    // a landscape screen: the portrait frame at full height, in the middle of the free band between the card and the
    // floors panel (the card ends at ~41 %, the panel starts at ~78 %), the stage colour round it
    ? `display:block;position:absolute;top:0;height:100%;width:auto;aspect-ratio:${FRAME_W}/${FRAME_H};left:59.5%;transform:translateX(-50%);${SOFT}`
    : 'display:block;width:100%;height:100%;object-fit:contain'
  if (lite) box.dataset.lite = lite
  // the texts over the scene; once scene-3d.js ran (a swap mid-visit) its own poster, canvas and parts stay behind
  const texts = [...el.children].filter((c) => !el.dataset.state || c.matches('[data-at]'))
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
  stage.style.cssText = `position:sticky;top:0;height:100svh;overflow:hidden${lite ? ';background:var(--roama-color-stage, #14110e)' : ''}`
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
    for (const [a, b] of hold) if (want >= a && want <= b) want = a
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
  // Fetch every frame (~2.1 MB together) nearest-first from the current position - TASK-0762 (qa-kit: the home weighed
  // 3.4 MB on a phone): only once the tower is about one and a half screens away, not with the page.
  let order = null
  let next = 0
  const pump = () => {
    if (next >= order.length) return
    const i = order[next++]
    fetch(src(i)).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) { blobs[i] = b; if (Math.abs(i - want) <= WINDOW) queue() } })
      .catch(() => {}).finally(pump)
  }
  const load = () => {
    order = [...Array(count).keys()].sort((a, b) => Math.abs(a - want) - Math.abs(b - want))
    for (let k = 0; k < 4; k++) pump()
  }
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      update()
      load()
    }, { rootMargin: '150% 0px' })
    io.observe(box)
  } else load()
  addEventListener('scroll', queue, { passive: true })
  let width = innerWidth
  addEventListener('resize', () => { if (innerWidth !== width) { width = innerWidth; queue() } }) // height-only = the iOS bar
  update()
}

// TASK-0794 round 4: why scene-3d.js would show a computer only the poster (its gates, the same tests), or ''
function weak() {
  if (/[?&]lite3d/.test(location.search)) return 'forced'
  if (/[?&](tier3d=|probe3d)/.test(location.search)) return ''
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData === true) return ''
  try { if (Number(sessionStorage.getItem('roama-3d-tier')) >= 4) return 'slow-before' } catch { /* storage off */ }
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return 'no-webgl2'
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    if (/swiftshader|llvmpipe|softpipe|basic render/i.test(name)) return 'software-gl'
  } catch { return 'no-webgl2' }
  return ''
}

const phone = matchMedia(PHONE).matches
if (phone || matchMedia(PORTRAIT).matches) {
  for (const el of document.querySelectorAll('scene-3d[mode="scroll"]')) {
    if (phone && el.dataset.phoneFrames && el.dataset.phoneMode !== 'live') frames(el)
    else if (el.dataset.phoneSrc) el.setAttribute('src', el.dataset.phoneSrc)
  }
} else {
  const towers = [...document.querySelectorAll('[data-tower] scene-3d[mode="scroll"][data-phone-frames]')]
  const why = towers.length ? weak() : ''
  if (why) for (const el of towers) frames(el, why)
  else {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData === true
    // the swap must not move the visitor: the 3D's pin is undone as it leaves (scene-3d.js), and the browser's scroll
    // anchoring can throw the page far down - the scroll place is put back once that has settled
    const swap = (el) => {
      if (!el.isConnected) return
      const y = scrollY
      frames(el, 'slow-now')
      const back = () => { if (Math.abs(scrollY - y) > 1) { if (window.lenis) window.lenis.scrollTo(y, { immediate: true, force: true }); else scrollTo(0, y) } }
      queueMicrotask(() => queueMicrotask(back))
      requestAnimationFrame(() => { back(); setTimeout(back, 120) })
    }
    if (!still) for (const el of towers) el.addEventListener('scene-slow', () => swap(el), { once: true })
  }
}
