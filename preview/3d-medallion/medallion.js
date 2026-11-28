/*! © ROAMA. All rights reserved. */
// TASK-0797: <roama-medallion> - the ROAMA medallion (dark metal, cream R, amber cursor) as a small three.js
// player. It only draws: where it stands, how big it is and how it turns is set from outside
// (medallion-flight.js) through el.set({ yaw, tilt, glow, flash }).
//   yaw   degrees about the vertical axis (0 = the R faces the viewer; the R never tilts sideways)
//   tilt  degrees forward/back (small, for the hero pose)
//   glow  0..1 the cursor's amber light
//   flash 0..1 a short amber flash on landing
// Without WebGL, with reduced motion or Save-Data it never loads three: the poster <img> inside stays.
// three.js comes from the site's own copy (/3d/scene-3d/vendor), never a CDN; the player never touches /3d/.

const VENDOR = '/preview/3d/scene-3d/vendor/'
const MODEL = '/preview/3d-medallion/medallion.glb'
const AMBER = 0xffc83d

function hasWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

export function stillOnly() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const saveData = navigator.connection?.saveData === true
  return reduced || saveData || !hasWebGL()
}

class RoamaMedallion extends HTMLElement {
  constructor() {
    super()
    this.state = { yaw: -30, tilt: 8, glow: 0.35, flash: 0 }
    this.dirty = true
    this.ready = false
  }

  connectedCallback() {
    if (this.started) return
    this.started = true
    if (stillOnly()) {
      this.dataset.still = ''
      return
    }
    // load when the element comes near the screen
    const io = new IntersectionObserver((list) => {
      if (list.some((e) => e.isIntersecting)) {
        io.disconnect()
        this.load().catch((err) => {
          console.warn('[roama-medallion] stays a poster:', err?.message || err)
          this.dataset.still = ''
        })
      }
    }, { rootMargin: '200px' })
    io.observe(this)
  }

  disconnectedCallback() {
    this.ro?.disconnect()
    this.renderer?.setAnimationLoop(null)
  }

  set(next) {
    Object.assign(this.state, next)
    this.dirty = true
  }

  async load() {
    const [THREE, { GLTFLoader }, { DRACOLoader }, { RoomEnvironment }] = await Promise.all([
      import(VENDOR + 'three/three.module.js'),
      import(VENDOR + 'three/addons/loaders/GLTFLoader.js'),
      import(VENDOR + 'three/addons/loaders/DRACOLoader.js'),
      import(VENDOR + 'three/addons/environments/RoomEnvironment.js'),
    ])
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NeutralToneMapping // the brand colours stay exact (cream, amber)
    renderer.toneMappingExposure = 1.05
    renderer.setClearColor(0x000000, 0)
    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 1.25
    const key = new THREE.DirectionalLight(0xfff4e0, 2.2)
    key.position.set(-0.6, 1.0, 1.2)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xffe2b0, 1.4)
    rim.position.set(1.0, 0.4, -0.8)
    scene.add(rim)

    const draco = new DRACOLoader().setDecoderPath(VENDOR + 'draco/')
    const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(MODEL)
    const root = gltf.scene
    // centre the disc on the origin (it stands on its rim in the file)
    const box = new THREE.Box3().setFromObject(root)
    const centre = box.getCenter(new THREE.Vector3())
    root.position.sub(centre)
    const pivot = new THREE.Group()
    pivot.add(root)
    scene.add(pivot)
    const radius = Math.max(...box.getSize(new THREE.Vector3()).toArray()) / 2

    // the cursor's light: its emissive strength + a soft halo sprite in front of it
    const cursors = []
    root.traverse((o) => {
      if (o.isMesh && /cursor/i.test(o.name + (o.material?.name || ''))) cursors.push(o)
    })
    const halo = this.halo(THREE)
    const front = cursors.find((o) => /front/i.test(o.name)) || cursors[0]
    if (front) {
      const p = new THREE.Box3().setFromObject(front).getCenter(new THREE.Vector3())
      halo.position.copy(p) // the box is taken before root moves: it is already in root's own space
      halo.position.z += radius * 0.12
      root.add(halo)
    }
    halo.scale.setScalar(radius * 0.9)

    const camera = new THREE.PerspectiveCamera(24, 1, radius * 0.1, radius * 40)
    const fit = () => {
      const w = Math.max(1, this.clientWidth)
      const h = Math.max(1, this.clientHeight)
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      // the disc (2r plus its turn) fills ~86 % of the shorter side
      const fov = THREE.MathUtils.degToRad(camera.fov)
      const fill = radius * 1.16 / Math.min(1, camera.aspect)
      camera.position.set(0, 0, fill / Math.tan(fov / 2))
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
      this.dirty = true
    }
    this.ro = new ResizeObserver(fit)
    this.ro.observe(this)
    fit()

    const canvas = renderer.domElement
    canvas.className = 'medallion__gl'
    canvas.setAttribute('aria-hidden', 'true')
    this.append(canvas)
    this.renderer = renderer

    let shown = false
    renderer.setAnimationLoop(() => {
      if (!this.dirty) return
      this.dirty = false
      const s = this.state
      pivot.rotation.set(THREE.MathUtils.degToRad(s.tilt), THREE.MathUtils.degToRad(s.yaw), 0, 'YXZ')
      const g = Math.min(1, Math.max(0, s.glow + s.flash))
      for (const o of cursors) {
        o.material.emissive?.setHex(AMBER)
        o.material.emissiveIntensity = 0.6 + g * 3.4
      }
      halo.material.opacity = 0.15 + g * 0.75
      halo.scale.setScalar(radius * (0.7 + g * 0.6 + s.flash * 1.4))
      renderer.render(scene, camera)
      if (!shown) {
        shown = true
        this.dataset.live = '' // the CSS hides the poster under a live canvas
        this.dispatchEvent(new Event('medallion-ready'))
      }
    })
    this.ready = true
  }

  halo(THREE) {
    const size = 128
    const c = document.createElement('canvas')
    c.width = c.height = size
    const g = c.getContext('2d')
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, 'rgba(255,200,61,0.9)')
    grad.addColorStop(0.35, 'rgba(255,200,61,0.35)')
    grad.addColorStop(1, 'rgba(255,200,61,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.NormalBlending })
    return new THREE.Sprite(mat)
  }
}

if (!customElements.get('roama-medallion')) customElements.define('roama-medallion', RoamaMedallion)
