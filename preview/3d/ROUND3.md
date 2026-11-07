# Atlas round 3 — what is in web/

Copy `web/` to the site as `/3d/` (as in round 2). All three scenes share the same GLBs
(`models/desktop.glb`, `models/mobile.glb`), the same poster (`models/poster.webp`, 1000x1500,
#121212) and the same node names as round 2 — the hero markup does not change.

| Section | Config | Embed |
|---|---|---|
| Hero (round 2 keys, visor fixed) | `scene-3d.json` | `<scene-3d src="/3d/scene-3d.json" mode="scroll" length="200" label="Атлас, робот ROAMA"></scene-3d>` |
| «Як працює ШІ-команда» (5 steps) | `scene-3d-process.json` | `<scene-3d src="/3d/scene-3d-process.json" mode="scroll" length="500" label="Атлас показує, як працює ШІ-команда"></scene-3d>` |
| Contact (wave) | `scene-3d-contact.json` | `<scene-3d src="/3d/scene-3d-contact.json" mode="scroll" length="120" label="Атлас махає рукою"></scene-3d>` |

Process steps = scroll progress (children with `data-at` rise at the step's start):
заявка 0–0.2 (`data-at="0.02"`), бриф і ТЗ 0.2–0.4 (`0.2`), дизайн 0.4–0.6 (`0.4`),
розробка 0.6–0.8 (`0.6`), перевірка QA і запуск 0.8–1 (`0.8`). Atlas holds each pose at the
middle of its part (0.1 / 0.3 / 0.5 / 0.7 / 0.9); the chest light fills 20→40→60→80→100 %; the
greeting smile turns on with the launch step.

Reduced motion / Save-Data / no WebGL: every scene shows the static poster (the player's rule).

QA fix (round 3): the reduced-motion block of a scroll scene was full width at the portrait
poster's aspect (1280 wide = 1920 tall), so a 1280x800 screen showed only the head. The player in
`scene-3d/scene-3d.js` (the reduced branch, ~line 110) caps that block at `max-height: 100svh`
with `width: 100%`, centres the poster image at its own shape and fades its left/right 15 % into
#121212 (no hard edge on the floor shadow). The whole Atlas is visible at 1280x800 and 360x780.

The patched player is kept in the job as `extras/player/scene-3d.js` and copied back into
`web/scene-3d/` after every `scene-3d web`/`run` (the engine packs its original player). For the
engine maintainers: the same ~10 lines (the block under `if (mode === 'scroll')` in the reduced
branch of `connectedCallback`) belong in `scene_3d`'s own `scene-3d.js`; the 3D designer cannot
edit the engine from a job run.

Service stills (`stills/`, #121212 background, amber #FFC83D as the only accent):
`<name>.png` 1200x900 and `<name>-600.webp` 600x450 —
landing (лендинг), multipage (сайт на кілька сторінок), wordpress (WordPress), shop (інтернет-магазин),
webapp (вебзастосунок), object3d (3D-обʼєкт), logo-animation (анімація логотипа),
site-edits (правки сайту), copywriting (тексти сайту).
