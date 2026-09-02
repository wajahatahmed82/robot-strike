# ROBOT STRIKE — working notes

Wave-defence FPS in the browser. Three.js, everything procedural (geometry,
textures, audio) — no asset files, nothing licensed.

Live: https://wajahatahmed82.github.io/robot-strike/

## Run and build

    node tools/serve.js 5181        # dev server, sends no-store
    # http://localhost:5181

    npx esbuild src/main.js --bundle --format=iife --minify --outfile=dist/bundle.js
    node tools/build.js             # writes the single-file build into docs/
    git add -A && git commit -m "..." && git push   # Pages redeploys from docs/

`?capture=1` enables `preserveDrawingBuffer` for screenshot tooling.
`?fps` is not needed — the FPS readout is a setting, on by default.

## Traps already hit — do not reintroduce

- **AI line of sight must test collider boxes, not raycast meshes.** Raycasting
  the merged map walks every triangle per robot per frame. Fixing this took AI
  cost from 35.6ms to 4.2ms at 40 robots. See `Game.canSee`.
- **The weapon renders in a second pass on its own layer, and
  `scene.background` must be nulled for that pass.** Three draws an
  equirectangular background as a full-screen mesh with depth testing off on
  *every* `render()` call, so leaving it set repaints the sky over the finished
  world. Symptom: world reports 47 draw calls but the screen shows only sky.
- **`preserveDrawingBuffer` must stay behind `?capture=1`.** It forces a full
  framebuffer copy every frame.
- **The dev server must send `no-store`.** python's `http.server` caches, which
  produced a scene lit by new intensities and old colours after an edit.
- **Hemisphere light has to be large (≈5).** It lands in indirect diffuse, which
  the Lambert BRDF divides by PI; at 1.75 a backlit wall measured rgb(14,17,24).
- **Painted steel wants low metalness.** High metalness takes all colour from the
  environment map and renders as a black slab.
- **Forward is `(-sin(yaw), -cos(yaw))`.** yaw 0 looks down -Z. Spawning with
  `yaw: Math.PI` points away from the map.
- **Initialise every timer in `reset()`.** An undefined `spawnTimer` made
  `spawnTimer -= dt` NaN and Time Attack spawned nothing.
- **Mouse button state must key off `button`, not `pointerId`.** Every mouse
  button shares one pointerId. Tracking held buttons by pointerId meant
  releasing the first button cleared the tracked id, so the second button's
  release matched nothing and its action stayed latched forever. Symptom:
  hold LMB+RMB, release both, and the player is stuck aiming.
- **Freeze the wave director when benchmarking.** A sweep that spawns `n`
  enemies and then steps frames keeps spawning during the timing loop, so
  "40 enemies" was really far more and reported 27fps where the controlled
  measurement gives 267fps. Set `waveActive=false; queued=0; breakT=1e9` and
  assert the actual count.
- **Only recompile materials when a shader permutation actually changes.**
  Setting `material.needsUpdate` on every mesh each time a quality knob moves
  stalls for hundreds of ms. `setShadows` only does it when the flag flipped.
- **String `.replace()` in the build must use a function.** `$&` in a replacement
  string means "insert the match", and minified JS contains `$&`.

## Verifying changes

Drive the sim headlessly from the console rather than by hand:

    __rs.game.start(__rs.MODE.SURVIVAL)
    for (let i=0;i<600;i++) __rs.step(1/60)

`window.__rs` exposes `game, hud, input, renderer, prog, settings, step`.
When aiming a test bot, target the real hitbox (`robot.hitboxes[0]` is the head)
via `getWorldPosition` — approximating the head offset aims over their heads and
makes the game look broken when it is not.

Measure render cost with `gl.finish()`, otherwise you are timing CPU submit only.
`renderer.info` resets per `render()` call and `render()` runs two passes, so set
`renderer.info.autoReset = false` before counting draw calls.

## Input

Every action is an independent latched boolean in `src/input.js`, built from
three OR'd sources (keyboard, mouse buttons, on-screen buttons). One-shot
actions go through an edge queue drained once per frame. Nothing in input ever
cancels an unrelated action.

`tools/inputstress.js` dispatches real KeyboardEvent/MouseEvent objects at the
listeners and asserts 13 simultaneous-input combinations. Run it after any input
change:

    const t = await import('/tools/inputstress.js'); t.run(__rs)

## Open

- No human playtesting. All balance is bot-derived — treat every tuning number
  as a hypothesis.
- Armour bar is wired into damage but nothing grants armour yet.
