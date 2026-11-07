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

  box.style.cssText = `position:relative;height:calc(100vh + ${length}vh)`
  stage.style.cssText = 'position:sticky;top:0;height:100vh;overflow:hidden'
  stage.prepend(canvas)
  box.appendChild(stage)
  el.replaceWith(box)

  const ctx = canvas.getContext('2d')
  const imgs = []
  let shown = -1
  const draw = (i) => {
    for (let d = 0; d < count; d++) {
      for (const j of [i - d, i + d]) {
        const f = imgs[j]
        if (f && f.complete && f.naturalWidth) {
          if (j !== shown) { ctx.drawImage(f, 0, 0, canvas.width, canvas.height); shown = j }
          return
        }
      }
    }
  }
  const at = texts.filter((t) => t.dataset.at !== undefined)
  for (const t of at) t.style.transition = 'opacity .5s ease-out, transform .5s ease-out, filter .5s ease-out'
  let queued = false
  const update = () => {
    queued = false
    const r = box.getBoundingClientRect()
    const span = Math.max(1, r.height - innerHeight)
    const p = Math.min(Math.max(-r.top / span, 0), 1)
    draw(Math.round(p * (count - 1)))
    for (const t of at) {
      const on = p >= Number(t.dataset.at)
      t.style.opacity = on ? '1' : '0'
      t.style.transform = on ? 'none' : 'translateY(0.6em)'
      t.style.filter = on ? 'none' : 'blur(6px)'
    }
  }
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update) } }
  for (let i = 0; i < count; i++) {
    const img = new Image()
    img.decoding = 'async'
    img.onload = queue
    img.src = new URL(`frame_${String(i).padStart(3, '0')}.webp`, base).href
    imgs.push(img)
  }
  addEventListener('scroll', queue, { passive: true })
  addEventListener('resize', queue)
  update()
}

const phone = matchMedia(PHONE).matches
if (phone || matchMedia(PORTRAIT).matches) {
  for (const el of document.querySelectorAll('scene-3d[mode="scroll"]')) {
    if (phone && el.dataset.phoneFrames && el.dataset.phoneMode !== 'live') frames(el)
    else if (el.dataset.phoneSrc) el.setAttribute('src', el.dataset.phoneSrc)
  }
}
