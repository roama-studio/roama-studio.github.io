// The three.js side of <scene-3d>: one model, the poster's light (or a soft
// studio light for an older manifest), the poster's view, and either a viewer
// (drag to turn) or a scroll scene (seek(progress) moves the camera and the
// named nodes along scene.json keys). Optional effects: a glow (a warm light
// that flickers, with a soft halo) and steam rising from a node. Realism: the
// poster's HDRI lights the model and shows in its reflections (the background
// stays the page's), the baked AO comes in the GLB (aoMap), a baked contact
// shadow lies under the model, and a film look: bloom on what glows, grain and
// a vignette on desktop (phones: bloom only).
//
//   const player = await createPlayer(lib, host, manifest, { mode, modelUrl, dracoPath, effects, resolve })
//   lib = { THREE, GLTFLoader, DRACOLoader, RoomEnvironment, OrbitControls, HDRLoader,
//           EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass }
//   effects: false = a still (no steam, no halo, the glow light does not flicker, the grain stands still)
//   contact: false = no contact shadow (the review compares the model with its poster)
//   resolve(path): a manifest path (models/...) -> its URL
import { autoCamera, ripple, sampleScroll, toThree, verticalFov } from './convert.js'

// The same HDRI turn as on the poster: Blender's equirectangular picture starts half a turn from three.js's.
const ENV_TURN = 180
// Bloom: how far the spill reaches (0..1). It is selective: only glowing parts (emissive materials, a glow's
// halo) are drawn into it, so the HDRI's and the lamps' glints on metal never bloom.
const BLOOM = { radius: 0.35, threshold: 0.05 }
// Water seen through an HDRI reflects the open sky even where the walls of its tub would hide it (an
// environment map knows no walls): its reflection is dimmed to what Cycles shows on the poster.
const WATER_SKY = 0.12
// The viewer's soft edge, % of its width / height.
const EDGE_FADE = 7

// The base frame plus the bloom of the glowing parts, before tone mapping.
const MIX = {
  uniforms: { tDiffuse: { value: null }, bloomTexture: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D bloomTexture; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 b = texture2D(bloomTexture, vUv).rgb;
      gl_FragColor = vec4(c.rgb + b, max(c.a, min(max(b.r, max(b.g, b.b)), 1.0)));
    }`,
}

// A small seeded random: the same steam on every load (and in every review frame).
function random(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A soft round puff (steam) or a halo (glow), drawn once on a canvas: no image files.
function softTexture(THREE, kind) {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')
  const blob = (x, y, r, alpha) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, `rgba(255,255,255,${alpha})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  if (kind === 'halo') blob(64, 64, 64, 0.9)
  else {
    const rand = random(7)
    for (let i = 0; i < 9; i++) blob(34 + rand() * 60, 34 + rand() * 60, 18 + rand() * 22, 0.35)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// The film look after tone mapping: a vignette and grain. The canvas is premultiplied:
// both touch only what is drawn, never the page under the transparent background.
const FILM = {
  uniforms: { tDiffuse: { value: null }, grain: { value: 0 }, vignette: { value: 0 }, seed: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float grain; uniform float vignette; uniform float seed; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float v = 1.0 - vignette * smoothstep(0.35, 0.85, distance(vUv, vec2(0.5)));
      c.rgb = c.rgb * v + (hash(gl_FragCoord.xy) - 0.5) * grain * c.a;
      gl_FragColor = c;
    }`,
}

// How a living flame breathes: three slow waves, 0..1.
const flame = (t, phase) => 0.5 + 0.5 * (0.5 * Math.sin(t * 7.3 + phase) + 0.3 * Math.sin(t * 13.1 + phase * 2) + 0.2 * Math.sin(t * 2.3))

export async function createPlayer(lib, host, manifest, options) {
  const { THREE, GLTFLoader, DRACOLoader, RoomEnvironment, OrbitControls, HDRLoader } = lib
  const mode = options.mode ?? 'viewer'
  const small = options.small ?? false
  const effectsOn = options.effects !== false
  const light = manifest.lighting ?? null

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  // The poster's view transform: AgX, or Khronos PBR Neutral when the colour is the brand's (color_fidelity).
  renderer.toneMapping = light?.tone === 'neutral' ? THREE.NeutralToneMapping : THREE.AgXToneMapping
  renderer.toneMappingExposure = light?.exposure ?? 1
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap // PCFSoftShadowMap is gone in three 0.186 (a console warning)
  const canvas = renderer.domElement
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
  if (mode === 'viewer') {
    // A turned model's glow, steam or bloom can reach the box's edge: it fades out there instead of
    // ending in a hard line (a scroll scene is full width: its edge is the screen's own).
    const fade = 'linear-gradient(to right, transparent, #000 EDGE%, #000 calc(100% - EDGE%), transparent)'
    const mask = `${fade.replaceAll('EDGE', EDGE_FADE)}, ${fade.replace('to right', 'to bottom').replaceAll('EDGE', EDGE_FADE)}`
    canvas.style.maskImage = canvas.style.webkitMaskImage = mask
    canvas.style.maskComposite = 'intersect'
    canvas.style.webkitMaskComposite = 'source-in'
  }

  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const sky = light?.environment
  let environment = 'room'
  if (sky && HDRLoader && options.resolve) {
    // The poster's HDRI: its light and its reflections, at the poster's strength and turn.
    const texture = await new HDRLoader().loadAsync(options.resolve(sky.file))
    texture.mapping = THREE.EquirectangularReflectionMapping
    scene.environment = pmrem.fromEquirectangular(texture).texture
    scene.environmentIntensity = sky.intensity
    // Blender turns the world round Z; three.js reads the same picture half a turn round Y.
    scene.environmentRotation.set(0, THREE.MathUtils.degToRad((sky.rotation ?? 0) + ENV_TURN), 0)
    texture.dispose()
    environment = 'hdri'
  } else {
    const room = new RoomEnvironment()
    scene.environment = pmrem.fromScene(room, 0.04).texture
    // The poster's ambient light: a dark preset leaves the model in the dark, like Cycles.
    if (light) scene.environmentIntensity = light.ambient
    room.dispose?.()
  }
  pmrem.dispose()

  const draco = new DRACOLoader().setDecoderPath(options.dracoPath)
  const loader = new GLTFLoader().setDRACOLoader(draco)
  const gltf = await loader.loadAsync(options.modelUrl)
  draco.dispose()
  const model = gltf.scene
  const aoMaps = new Set()
  model.traverse((o) => {
    if (!o.isMesh) return
    o.castShadow = true
    o.receiveShadow = true
    for (const m of [o.material].flat()) if (m?.aoMap) aoMaps.add(m) // the baked AO (second UV)
  })
  const aoMaterials = aoMaps.size
  scene.add(model)

  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const reach = Math.max(size.x, size.y, size.z)

  // A soft shadow under the model, like the poster's shadow catcher.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(reach * 8, reach * 8), new THREE.ShadowMaterial({ opacity: 0.16 }))
  ground.rotation.x = -Math.PI / 2
  ground.position.set(center.x, box.min.y, center.z)
  ground.receiveShadow = true
  scene.add(ground)
  // The baked contact shadow: the soft darkness where the model meets the ground.
  let contact = null
  if (manifest.contact && options.resolve && options.contact !== false) {
    const map = await new THREE.TextureLoader().loadAsync(options.resolve(manifest.contact.file))
    map.colorSpace = THREE.NoColorSpace
    contact = new THREE.Mesh(new THREE.PlaneGeometry(manifest.contact.size, manifest.contact.size),
      new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }))
    contact.rotation.x = -Math.PI / 2
    contact.position.set(...toThree(manifest.contact.center))
    contact.position.y = box.min.y + reach * 0.001
    contact.renderOrder = -1
    scene.add(contact)
  }
  const shadowed = (lamp) => {
    lamp.castShadow = true
    lamp.shadow.mapSize.set(small ? 512 : 1024, small ? 512 : 1024)
    lamp.shadow.radius = 6
    // A light low over a flat surface (water, a lid) draws it in stripes of its own shadow
    // ("shadow acne"): push the shadow test off the surface, more for a bigger model.
    lamp.shadow.bias = -0.0005
    lamp.shadow.normalBias = reach * 0.02
    Object.assign(lamp.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 0.01, far: reach * 12 })
  }
  const aim = manifest.camera ? new THREE.Vector3(...toThree(manifest.camera.target)) : center
  const lamps = []
  if (light) {
    // The poster's lights, where Cycles had them (Blender coordinates -> Y up).
    for (const item of light.lights) {
      const lamp = new THREE.DirectionalLight(new THREE.Color(item.color), item.intensity)
      lamp.position.set(...toThree(item.position))
      lamp.target.position.copy(aim)
      if (item.shadow) shadowed(lamp)
      scene.add(lamp, lamp.target)
      lamps.push(lamp)
    }
  } else {
    const sun = new THREE.DirectionalLight(0xffffff, 1.2)
    sun.position.set(center.x + reach * 1.2, center.y + reach * 2.5, center.z + reach * 1.6)
    sun.target.position.copy(center)
    shadowed(sun)
    scene.add(sun, sun.target)
    lamps.push(sun)
  }

  // Effects at named nodes: a glow (a warm light, a halo) and steam.
  const nodeBox = (name) => {
    const node = model.getObjectByName(name)
    if (!node) { console.warn(`scene-3d: no node ${name} in the model`); return null }
    return new THREE.Box3().setFromObject(node)
  }
  const glows = []
  for (const item of manifest.glow ?? []) {
    const where = nodeBox(item.node)
    if (!where) continue
    const color = new THREE.Color(item.color)
    const lamp = new THREE.PointLight(color, item.intensity, 0, 2)
    lamp.position.copy(where.getCenter(new THREE.Vector3()))
    scene.add(lamp)
    let halo = null
    if (effectsOn) {
      halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softTexture(THREE, 'halo'), color, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }))
      const span = where.getSize(new THREE.Vector3())
      halo.scale.setScalar(Math.max(span.x, span.y, span.z) * 2.2)
      halo.position.copy(lamp.position)
      scene.add(halo)
    }
    glows.push({ lamp, halo, base: item.intensity, flicker: effectsOn ? item.flicker : 0, phase: glows.length * 1.7 })
  }
  const puffs = []
  if (effectsOn) {
    const texture = (manifest.steam ?? []).length ? softTexture(THREE, 'puff') : null
    for (const item of manifest.steam ?? []) {
      const where = nodeBox(item.node)
      if (!where) continue
      const span = where.getSize(new THREE.Vector3())
      const radius = Math.min(span.x, span.z) * 0.4
      const height = item.height ?? Math.max(span.x, span.z) * 0.5
      const count = Math.round((small ? 10 : 26) * item.amount / 0.6)
      const rand = random(11 + puffs.length)
      for (let i = 0; i < count; i++) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: texture, color: new THREE.Color(item.color), transparent: true, opacity: 0, depthWrite: false,
        }))
        const angle = rand() * Math.PI * 2
        const r = Math.sqrt(rand()) * radius
        scene.add(sprite)
        puffs.push({
          sprite, life: 4 + rand() * 3, phase: rand() * 7, drift: (rand() - 0.5) * radius * 0.6,
          x: where.getCenter(new THREE.Vector3()).x + Math.cos(angle) * r, z: where.getCenter(new THREE.Vector3()).z + Math.sin(angle) * r,
          top: where.max.y, height, size: radius * 0.45, peak: 0.16 + 0.22 * item.amount,
        })
      }
    }
  }
  // Water: its ripple normal map drifts slowly (the poster has the same ripples, still).
  const waters = []
  if (effectsOn) {
    const names = new Set(manifest.water ?? [])
    model.traverse((o) => {
      for (const m of [o.material].flat()) {
        if (m && names.has(m.name) && m.normalMap && !waters.includes(m.normalMap)) waters.push(m.normalMap)
      }
    })
  }
  // Rings on the water when the scroll passes a moment (driven by the scroll, so they also run backwards).
  const rings = []
  if (effectsOn && mode === 'scroll') {
    for (const item of manifest.ripple ?? []) {
      const where = nodeBox(item.node)
      if (!where) continue
      const span = where.getSize(new THREE.Vector3())
      const middle = where.getCenter(new THREE.Vector3())
      for (let i = 0; i < item.rings; i++) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 96), new THREE.MeshBasicMaterial({
          color: new THREE.Color(item.color), transparent: true, opacity: 0, depthWrite: false,
        }))
        ring.rotation.x = -Math.PI / 2
        // A few millimetres over the surface: closer, the water and the ring fight for the same pixels.
        ring.position.set(middle.x, where.max.y + reach * 0.002, middle.z)
        ring.visible = false
        scene.add(ring)
        rings.push({ ring, at: item.at, index: i, size: Math.min(span.x, span.z) * 0.48 })
      }
    }
  }
  const animated = glows.some((g) => g.flicker > 0) || puffs.length > 0 || waters.length > 0
  let clock = 0
  function tick(seconds) {
    clock = seconds
    for (const g of glows) {
      const wave = g.flicker ? 1 - g.flicker * 0.6 + g.flicker * 0.6 * flame(seconds, g.phase) : 1
      g.lamp.intensity = g.base * wave
      if (g.halo) g.halo.material.opacity = 0.55 * wave
    }
    for (const [i, map] of waters.entries()) map.offset.set(seconds * 0.012 * (i % 2 ? -1 : 1), seconds * 0.008)
    for (const p of puffs) {
      const u = ((seconds + p.phase) % p.life) / p.life
      p.sprite.position.set(p.x + Math.sin(u * Math.PI) * p.drift, p.top + p.height * u, p.z + Math.cos(u * 2) * p.drift * 0.5)
      p.sprite.scale.setScalar(p.size * (0.6 + 1.6 * u))
      p.sprite.material.opacity = p.peak * Math.sin(Math.PI * u) ** 1.5
    }
  }
  tick(2.5) // the first frame already shows the steam on its way up

  const box3 = { min: box.min.toArray(), max: box.max.toArray() }
  const start = manifest.camera
    ? { position: toThree(manifest.camera.position), target: toThree(manifest.camera.target), fov: manifest.camera.fov ?? 35 }
    : autoCamera(box3, 35, manifest.aspect ?? 1.6)
  const camera = new THREE.PerspectiveCamera(30, 1, Math.max(reach / 1000, 0.001), reach * 100)
  let fovH = start.fov
  // A viewer on a narrow screen closes in on the model (the poster's empty sides are left out).
  const frame = mode === 'viewer' ? manifest.frame ?? null : null
  const target = new THREE.Vector3(...start.target)
  camera.position.set(...start.position)
  camera.lookAt(target)

  const keys = manifest.scroll?.keys ?? []
  const nodes = {}
  const base = { camera: start, nodes: {} }
  for (const name of new Set(keys.flatMap((k) => Object.keys(k.nodes ?? {})))) {
    const node = model.getObjectByName(name)
    if (!node) { console.warn(`scene-3d: no node ${name} in the model`); continue }
    nodes[name] = node
    base.nodes[name] = { position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray() }
  }

  let controls = null
  let visible = false
  let progress = 0
  // The film look: the scene renders into a multisampled float target, then bloom, tone mapping, grain.
  const post = manifest.post && lib.EffectComposer ? manifest.post : null
  const passes = []
  let composer = null
  let film = null
  let bloomComposer = null
  // What glows: meshes with an emissive material, and the glows' halos.
  const glowing = new Set()
  const waterNames = new Set(manifest.water ?? [])
  model.traverse((o) => {
    if (!o.isMesh) return
    const m = [o.material].flat()[0]
    if (m && waterNames.has(m.name) && environment === 'hdri') {
      // A material's own envMap is needed: three.js applies envMapIntensity only to it, not to scene.environment.
      m.envMap = scene.environment
      m.envMapRotation.copy(scene.environmentRotation)
      m.envMapIntensity = WATER_SKY * scene.environmentIntensity
    }
    if (m?.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) * (m.emissiveIntensity ?? 1) > 0.05) glowing.add(o)
  })
  for (const g of glows) if (g.halo) glowing.add(g.halo)
  const wantBloom = post && post.bloom > 0 && glowing.size > 0
  if (post && (wantBloom || (!small && (post.grain > 0 || post.vignette > 0)))) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
    composer = new lib.EffectComposer(renderer, target)
    composer.addPass(new lib.RenderPass(scene, camera))
    if (wantBloom) {
      bloomComposer = new lib.EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }))
      bloomComposer.renderToScreen = false
      bloomComposer.addPass(new lib.RenderPass(scene, camera))
      bloomComposer.addPass(new lib.UnrealBloomPass(new THREE.Vector2(256, 256), post.bloom, BLOOM.radius, BLOOM.threshold))
      const mix = new lib.ShaderPass(MIX)
      mix.uniforms.bloomTexture.value = bloomComposer.renderTarget2.texture
      composer.addPass(mix)
      passes.push('bloom')
    }
    composer.addPass(new lib.OutputPass())
    if (!small && (post.grain > 0 || post.vignette > 0)) {
      film = new lib.ShaderPass(FILM)
      film.uniforms.grain.value = post.grain
      film.uniforms.vignette.value = post.vignette
      composer.addPass(film)
      if (post.grain > 0) passes.push('grain')
      if (post.vignette > 0) passes.push('vignette')
    }
  }
  // The bloom frame: everything but the glowing parts drawn black (sprites hidden), then put back.
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 })
  function renderBloom() {
    const materials = new Map()
    const hidden = []
    scene.traverse((o) => {
      if (glowing.has(o)) return
      if (o.isMesh) { materials.set(o, o.material); o.material = black } else if (o.isSprite && o.visible) { hidden.push(o); o.visible = false }
    })
    const shadows = renderer.shadowMap.autoUpdate
    renderer.shadowMap.autoUpdate = false
    bloomComposer.render()
    renderer.shadowMap.autoUpdate = shadows
    for (const [o, m] of materials) o.material = m
    for (const o of hidden) o.visible = true
  }
  const render = () => {
    if (!composer) return renderer.render(scene, camera)
    if (bloomComposer) renderBloom()
    composer.render()
  }

  function resize() {
    const width = Math.max(host.clientWidth, 1)
    const height = Math.max(host.clientHeight, 1)
    renderer.setSize(width, height, false)
    for (const c of [composer, bloomComposer]) {
      if (!c) continue
      c.setPixelRatio(renderer.getPixelRatio())
      c.setSize(width, height)
    }
    camera.aspect = width / height
    camera.fov = verticalFov(fovH, camera.aspect, manifest.aspect ?? 1.6, frame)
    camera.updateProjectionMatrix()
    render()
  }

  function seek(p) {
    progress = Math.min(Math.max(p, 0), 1)
    const state = sampleScroll(keys, progress, base, manifest.scroll?.path)
    if (state.camera) {
      if (state.camera.position) camera.position.set(...state.camera.position)
      if (state.camera.target) target.set(...state.camera.target)
      if (state.camera.fov !== undefined && state.camera.fov !== fovH) {
        fovH = state.camera.fov
        camera.fov = verticalFov(fovH, camera.aspect, manifest.aspect ?? 1.6, frame)
        camera.updateProjectionMatrix()
      }
      camera.lookAt(target)
    }
    for (const [name, pose] of Object.entries(state.nodes)) {
      const node = nodes[name]
      if (!node) continue
      if (pose.position) node.position.set(...pose.position)
      if (pose.quaternion) node.quaternion.set(...pose.quaternion)
      if (pose.scale) node.scale.set(...pose.scale)
    }
    for (const r of rings) {
      const state = ripple(progress, r.at, r.index)
      r.ring.visible = state.opacity > 0
      r.ring.scale.setScalar(Math.max(state.radius * r.size, 1e-4))
      r.ring.material.opacity = state.opacity
    }
    render()
  }

  if (mode === 'viewer') {
    controls = new OrbitControls(camera, canvas)
    controls.target.copy(target)
    Object.assign(controls, {
      enableZoom: false, // the wheel keeps scrolling the page
      enablePan: false,
      enableDamping: true,
      autoRotate: options.autorotate !== false,
      autoRotateSpeed: 0.8,
      maxPolarAngle: Math.PI / 2 - 0.05, // never under the floor
    })
    controls.addEventListener('start', () => { controls.autoRotate = false })
    controls.update()
    // A vertical swipe on a phone still scrolls the page; a sideways drag turns the model.
    canvas.style.touchAction = 'pan-y'
  }

  // While on screen: the viewer turns, the glow breathes and the steam rises (a still renders on demand).
  function setVisible(on) {
    if (on === visible || (!controls && !animated)) return
    visible = on
    const started = performance.now() / 1000 - clock
    renderer.setAnimationLoop(on ? () => {
      if (animated) tick(performance.now() / 1000 - started)
      if (film && effectsOn) film.uniforms.seed.value = (film.uniforms.seed.value + 0.618) % 100 // living grain
      controls?.update()
      render()
    } : null)
  }

  host.appendChild(canvas)
  const watcher = new ResizeObserver(resize)
  watcher.observe(host)
  resize()
  if (mode === 'scroll') seek(0)

  return {
    mode,
    modelUrl: options.modelUrl,
    canvas,
    get progress() { return progress },
    // What the scene has: lights, glows, steam puffs, and whether it moves on its own.
    effects: {
      lights: lamps.length, glow: glows.length, steam: puffs.length, water: waters.length, ripple: rings.length, animated,
      environment, contact: !!contact, post: passes, ao: aoMaterials,
    },
    seek,
    render,
    resize,
    setVisible,
    // What one frame costs (shadow pass included): draw calls, triangles, GPU objects.
    info() {
      // What the model costs (shadow pass included), without the film look's own passes.
      renderer.render(scene, camera)
      const { render: frame, memory } = renderer.info
      const out = { calls: frame.calls, triangles: frame.triangles, geometries: memory.geometries, textures: memory.textures }
      render()
      return out
    },
    dispose() {
      setVisible(false)
      watcher.disconnect()
      controls?.dispose()
      composer?.dispose()
      bloomComposer?.dispose()
      black.dispose()
      renderer.dispose()
      canvas.remove()
    },
  }
}
