// Lenis smooth scroll for a page: every client site scrolls with it, and a
// <scene-3d> scroll scene glides with the page (one smoothing, not two).
//
//   <link rel="stylesheet" href="/3d/scene-3d/vendor/lenis/lenis.css">
//   <script type="module" src="/3d/scene-3d/smooth-scroll.js"></script>
//
// It starts by itself (add ?manual to the src to call smoothScroll() yourself).
// With reduced motion the page keeps the browser's own scroll. Anchor links
// glide too; a scrolling box inside the page (a menu, a lightbox, a map) gets
// data-lenis-prevent so it scrolls on its own. The instance is window.lenis
// (stop() / start() it while a modal is open). When GSAP is on the page, Lenis
// runs on GSAP's clock so ScrollTrigger and Lenis move in the same frame.
const here = new URL('.', import.meta.url)

function script(url) {
  return new Promise((ok, fail) => {
    const tag = document.createElement('script')
    tag.src = url
    tag.onload = ok
    tag.onerror = () => fail(new Error(`smooth-scroll: could not load ${url}`))
    document.head.appendChild(tag)
  })
}

export async function smoothScroll(options = {}) {
  if (globalThis.lenis) return globalThis.lenis
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null
  if (!globalThis.Lenis) await script(new URL('vendor/lenis/lenis.min.js', here).href)
  const gsap = globalThis.gsap
  const lenis = new globalThis.Lenis({ anchors: true, autoRaf: !gsap, ...options })
  if (gsap) {
    gsap.ticker.add((time) => lenis.raf(time * 1000))
    gsap.ticker.lagSmoothing(0)
    if (globalThis.ScrollTrigger) {
      lenis.on('scroll', globalThis.ScrollTrigger.update)
      lenis.scene3dSynced = true
    }
  }
  globalThis.lenis = lenis
  return lenis
}

if (!new URL(import.meta.url).searchParams.has('manual')) {
  smoothScroll().catch((error) => console.error(error))
}
