// <scene-3d>: drop a 3D Designer model into any site.
//
//   <script type="module" src="/3d/scene-3d/scene-3d.js"></script>
//   <scene-3d src="/3d/scene-3d.json" mode="viewer" label="Hot tub"></scene-3d>
//   <scene-3d src="/3d/scene-3d.json" mode="scroll" length="200"></scene-3d>
//
// Attributes
//   src         the manifest written by `scene-3d web` (default scene-3d.json)
//   mode        viewer (drag to turn, slow auto-turn) | scroll (the section is
//               pinned while the page scroll plays the camera keys)
//   length      scroll: how long it stays pinned, % of the screen height (default 200)
//   scrub       scroll: seconds the view catches up with the page (default 0.6; true = at once;
//               under Lenis smooth scroll the default is true: the page already glides)
//   mobile      screens up to this width (px) load the mobile model (default 768)
//   autorotate  off = no auto-turn in the viewer
//   effects     off = a still: no steam, no halo, a steady glow (e.g. to compare with the poster)
//   contact     off = no contact shadow under the model (the review's poster comparison)
//   label       accessible name
//
// Text inside the element with data-at (e.g. the hero heading) lies over the
// scene and, in a scroll scene, rises out of its own bottom line when the scroll
// reaches data-at (data-span: over how much of the scroll, 0.2). It is real text:
// without JavaScript, before the 3D loads only if it will not, with reduced
// motion, Save-Data or no WebGL it simply stands where the site's CSS puts it.
// Nothing loads until the element comes near the screen. The poster shows
// first and is hidden once the 3D has faded in; with reduced motion, Save-Data or no WebGL the poster stays (a scroll
// scene is then not pinned). GSAP is taken from the page when it is there.
//
// Smooth scroll (Lenis, every client site): the element sees it (window.lenis or
// <html class="lenis">), lets Lenis tell ScrollTrigger about each scroll and does not
// smooth a second time. scene-3d/smooth-scroll.js sets Lenis up for a page.
import { createPlayer } from './player.js'
import { boxAspect, reveal, scrubFor } from './convert.js'

const here = new URL('.', import.meta.url)
const vendor = (path) => new URL(`vendor/${path}`, here).href
const scripts = {}

function script(url) {
  scripts[url] ??= new Promise((ok, fail) => {
    const tag = document.createElement('script')
    tag.src = url
    tag.onload = ok
    tag.onerror = () => fail(new Error(`scene-3d: could not load ${url}`))
    document.head.appendChild(tag)
  })
  return scripts[url]
}

async function loadGsap() {
  if (!globalThis.gsap) await script(vendor('gsap/gsap.min.js'))
  if (!globalThis.ScrollTrigger) await script(vendor('gsap/ScrollTrigger.min.js'))
  globalThis.gsap.registerPlugin(globalThis.ScrollTrigger)
  return { gsap: globalThis.gsap, ScrollTrigger: globalThis.ScrollTrigger }
}

async function loadThree() {
  const [THREE, { GLTFLoader }, { DRACOLoader }, { RoomEnvironment }, { OrbitControls }, { HDRLoader },
    { EffectComposer }, { RenderPass }, { ShaderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
    import(vendor('three/three.module.js')),
    import(vendor('three/addons/loaders/GLTFLoader.js')),
    import(vendor('three/addons/loaders/DRACOLoader.js')),
    import(vendor('three/addons/environments/RoomEnvironment.js')),
    import(vendor('three/addons/controls/OrbitControls.js')),
    import(vendor('three/addons/loaders/HDRLoader.js')),
    import(vendor('three/addons/postprocessing/EffectComposer.js')),
    import(vendor('three/addons/postprocessing/RenderPass.js')),
    import(vendor('three/addons/postprocessing/ShaderPass.js')),
    import(vendor('three/addons/postprocessing/UnrealBloomPass.js')),
    import(vendor('three/addons/postprocessing/OutputPass.js')),
  ])
  return { THREE, GLTFLoader, DRACOLoader, RoomEnvironment, OrbitControls, HDRLoader,
    EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass }
}

function hasWebGL() {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

class Scene3DElement extends HTMLElement {
  async connectedCallback() {
    if (this.started) return
    this.started = true
    this.dataset.state = 'loading'
    this.setAttribute('role', 'img')
    if (this.getAttribute('label')) this.setAttribute('aria-label', this.getAttribute('label'))
    const mode = this.mode
    Object.assign(this.style, { display: 'block', position: 'relative', overflow: 'hidden' })
    if (mode === 'scroll' && !this.style.height) this.style.height = '100svh'
    try {
      this.manifestUrl = new URL(this.getAttribute('src') ?? 'scene-3d.json', document.baseURI)
      this.manifest = await (await fetch(this.manifestUrl)).json()
    } catch (error) {
      this.fail(error)
      return
    }
    const m = this.manifest
    if (m.background && !this.style.background) this.style.background = m.background
    if (mode === 'viewer' && !this.style.height && !this.style.aspectRatio) this.style.aspectRatio = String(boxAspect(m, this.clientWidth))
    this.showPoster()
    const saveData = navigator.connection?.saveData === true
    if (this.reduced || saveData || !hasWebGL()) {
      if (mode === 'scroll') { // a still in the flow, not a pinned screen
        this.style.height = ''
        this.style.aspectRatio = String(m.aspect ?? 1.6)
        // A portrait poster in a wide block: never taller than the screen, the poster
        // (object-fit: contain) then shows the whole model (TASK-0455 QA, round 3).
        if (!this.style.width) this.style.width = '100%' // full width; only the height is clamped
        if (!this.style.maxHeight) this.style.maxHeight = '100svh'
        if (this.poster) { // the image at its own shape in the middle, its sides melting into the background
          const fade = 'linear-gradient(to right, transparent, #000 15%, #000 85%, transparent)'
          Object.assign(this.poster.style, { width: 'auto', maxWidth: '100%', left: '50%', right: 'auto', transform: 'translateX(-50%)', maskImage: fade, webkitMaskImage: fade })
        }
      }
      this.dataset.state = 'poster'
      this.dispatchEvent(new CustomEvent('scene-poster'))
      return
    }
    this.overlay() // the text waits under its water line for its moment
    const near = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        near.disconnect()
        this.load().catch((error) => this.fail(error))
      }
    }, { rootMargin: '200px' })
    near.observe(this)
  }

  disconnectedCallback() {
    // Pinning moves the element into GSAP's pin-spacer (out and straight back in):
    // clean up only when it has really left the page.
    queueMicrotask(() => {
      if (this.isConnected) return
      this.watch?.disconnect()
      this.trigger?.kill(true)
      this.player?.dispose()
      this.spacer?.remove()
      this.spacer = null
      this.started = false
    })
  }

  get mode() {
    return this.getAttribute('mode') === 'scroll' ? 'scroll' : 'viewer'
  }

  get reduced() {
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  showPoster() {
    if (!this.manifest.poster || this.poster) return
    this.poster = document.createElement('img')
    const m = this.manifest
    const url = (path) => new URL(path, this.manifestUrl).href
    // Its own size (no layout shift, QA bug #1 round 3) and a phone size: 1000 px file only on wide screens.
    const [w, h] = m.poster_size ?? [1000, 1500]
    this.poster.width = w
    this.poster.height = h
    if (m.poster_small) {
      this.poster.srcset = `${url(m.poster_small)} ${Math.round(w * 0.6)}w, ${url(m.poster)} ${w}w`
      this.poster.sizes = '(max-width: 768px) 100vw, 1000px'
    }
    this.poster.src = url(m.poster)
    this.poster.alt = ''
    this.poster.decoding = 'async'
    this.poster.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block'
    this.appendChild(this.poster)
  }

  fail(error) {
    this.dataset.state = 'error' // the poster (if any) stays
    for (const text of this.texts ?? []) Object.assign(text.style, { transform: '', clipPath: '', filter: '', opacity: '' })
    console.error(error)
  }

  // Text over a scroll scene: above the canvas, hidden until its moment.
  overlay() {
    this.texts = this.mode === 'scroll' ? [...this.querySelectorAll(':scope > [data-at]')] : []
    for (const text of this.texts) {
      if (getComputedStyle(text).position === 'static') text.style.position = 'relative'
      if (!text.style.zIndex) text.style.zIndex = '2'
    }
    this.showText(0)
  }

  showText(progress) {
    for (const text of this.texts ?? []) {
      const state = reveal(progress, Number(text.dataset.at), Number(text.dataset.span ?? 0.2))
      const under = state.rise * text.offsetHeight
      text.style.transform = under ? `translateY(${under}px)` : ''
      text.style.clipPath = under ? `inset(0 0 ${under}px 0)` : ''
      text.style.filter = state.blur ? `blur(${state.blur}px)` : ''
      text.style.opacity = String(state.opacity)
    }
  }

  async load() {
    const m = this.manifest
    const small = innerWidth <= Number(this.getAttribute('mobile') ?? 768)
    this.small = small
    const modelUrl = new URL(small ? m.models.mobile : m.models.desktop, this.manifestUrl).href
    const [lib, motion] = await Promise.all([loadThree(), this.mode === 'scroll' ? loadGsap() : null])
    this.player = await createPlayer(lib, this, m, {
      mode: this.mode,
      modelUrl,
      small,
      dracoPath: vendor('draco/'),
      autorotate: this.getAttribute('autorotate') !== 'off',
      effects: this.getAttribute('effects') !== 'off',
      contact: this.getAttribute('contact') !== 'off',
      resolve: (path) => new URL(path, this.manifestUrl).href,
    })
    const canvas = this.player.canvas
    canvas.style.opacity = '0'
    canvas.style.transition = 'opacity 400ms ease'
    requestAnimationFrame(() => { canvas.style.opacity = '1' })
    // The canvas is transparent: once it has faded in, the poster must not show behind a turned model.
    setTimeout(() => { if (this.poster) this.poster.style.visibility = 'hidden' }, 450)
    if (this.mode === 'scroll') this.pin(motion)
    // On screen the viewer turns and the effects play; off screen nothing renders.
    this.watch = new IntersectionObserver((entries) => this.player.setVisible(entries.some((e) => e.isIntersecting)))
    this.watch.observe(this)
    this.dataset.state = 'ready'
    this.dispatchEvent(new CustomEvent('scene-ready', { detail: this.player }))
  }

  pin({ gsap, ScrollTrigger }) {
    const lenis = globalThis.lenis
    const smooth = !!lenis || document.documentElement.classList.contains('lenis')
    if (lenis?.on && !lenis.scene3dSynced) { // one listener for all the scenes on the page
      lenis.on('scroll', ScrollTrigger.update)
      lenis.scene3dSynced = true
    }
    const state = { progress: 0 }
    const length = Number(this.getAttribute('length') ?? 200)
    // The scene holds with CSS sticky over a spacer of the pin's length, not with GSAP's
    // position:fixed pin. Switching to fixed mid-scroll counted as a layout shift (CLS 0.16-0.23 on the
    // phone home pages, QA bug #1 round 3); sticky moves with the scroll and is no shift.
    // pin="gsap" keeps the old fixed pin (for a parent that clips with overflow:hidden).
    const sticky = this.getAttribute('pin') !== 'gsap'
    let spacer
    if (sticky) {
      spacer = document.createElement('div')
      spacer.className = 'scene-3d-spacer'
      spacer.setAttribute('aria-hidden', 'true')
      spacer.style.height = `${length}vh`
      Object.assign(this.style, { position: 'sticky', top: '0' })
      this.after(spacer)
      this.spacer = spacer
    }
    const tween = gsap.to(state, {
      progress: 1,
      ease: 'none',
      onUpdate: () => { this.player.seek(state.progress); this.showText(state.progress) },
      scrollTrigger: {
        // A stuck element moves with the screen; the spacer right after it does not, so it is measured.
        trigger: sticky ? spacer : this,
        start: sticky ? () => `top ${this.offsetHeight}px` : 'top top',
        end: sticky ? () => `+=${spacer.offsetHeight}` : `+=${length}%`,
        pin: !sticky,
        scrub: scrubFor(this.getAttribute('scrub'), smooth),
      },
    })
    this.trigger = tween.scrollTrigger
    ScrollTrigger.refresh()
  }
}

if (!customElements.get('scene-3d')) customElements.define('scene-3d', Scene3DElement)
