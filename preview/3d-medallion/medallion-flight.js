/*! © ROAMA. All rights reserved. */
// TASK-0797: the medallion's flight from the hero to its slot.
//   <div data-medallion-anchor></div>   the box it sits in on the first screen (hero)
//   <div data-medallion-slot></div>     the box it docks into (intro section)
//   <roama-medallion data-medallion>    absolute in the document; this script moves it
// Its screen position goes from the anchor's place on the first screen to the middle of the screen, where the slot
// arrives at the end of the flight: so its document position ends exactly on the slot's live rect. It shrinks and turns
// a full turn plus the last 30 degrees to face-on, then sits in the slot and simply scrolls with the page (no
// hand-over, so no jump). Scrolling up plays it back. The cursor glow follows the flight into --boot on <html>
// (the CTA glow), with an amber flash on landing. Reduced motion / no WebGL: it sits in its slot from the start.
import { stillOnly } from './medallion.js'

const YAW_FROM = -30
const YAW_TO = 360
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const clamp = (v) => Math.min(1, Math.max(0, v))

function docRect(el) {
  const r = el.getBoundingClientRect()
  return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }
}

export function flight(el, anchor, slot) {
  const root = document.documentElement
  if (stillOnly()) {
    slot.append(el)
    el.classList.add('is-docked')
    el.set?.({ yaw: 0, tilt: 0, glow: 1 })
    root.style.setProperty('--boot', '1')
    return
  }
  let landed = false
  let flashT = 0
  const frame = () => {
    const a = docRect(anchor)
    const s = docRect(slot)
    // the flight ends when the slot's centre reaches the middle of the screen
    const end = Math.max(1, s.y + s.h / 2 - innerHeight / 2)
    const p = clamp(scrollY / end)
    const e = ease(p)
    const size = a.w + (s.w - a.w) * e
    // screen space: from the anchor at scroll 0 to the slot's screen place at the flight's end; + scrollY = document
    const sx = a.x + a.w / 2
    const sy = a.y + a.h / 2
    const ex = s.x + s.w / 2
    const ey = s.y + s.h / 2 - end
    const cx = sx + (ex - sx) * e
    const cy = sy + (ey - sy) * e + Math.min(scrollY, end)
    el.style.width = el.style.height = `${size}px`
    el.style.transform = `translate3d(${cx - size / 2}px, ${cy - size / 2}px, 0)`
    const yaw = YAW_FROM + (YAW_TO - YAW_FROM) * e
    const now = performance.now()
    if (p >= 0.995 && !landed) {
      landed = true
      flashT = now
      el.classList.add('is-docked')
    } else if (p < 0.98 && landed) {
      landed = false
      el.classList.remove('is-docked')
    }
    const flash = flashT ? Math.max(0, 1 - (now - flashT) / 700) : 0
    el.set?.({ yaw, tilt: 8 * (1 - e), glow: 0.35 + 0.65 * e, flash })
    root.style.setProperty('--boot', e.toFixed(3))
    if (flash > 0) requestAnimationFrame(frame)
  }
  let queued = false
  const ask = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      frame()
    })
  }
  addEventListener('scroll', ask, { passive: true })
  addEventListener('resize', ask)
  new ResizeObserver(ask).observe(document.body)
  el.addEventListener('medallion-ready', ask)
  frame()
}

export function start() {
  const el = document.querySelector('[data-medallion]')
  const anchor = document.querySelector('[data-medallion-anchor]')
  const slot = document.querySelector('[data-medallion-slot]')
  if (el && anchor && slot) flight(el, anchor, slot)
}
