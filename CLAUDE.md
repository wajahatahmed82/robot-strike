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
- **Pointer lock has to be switched on, not just supported.** `wantPointerLock`
  was initialised to `false` and never set anywhere, so `requestPointerLock()`
  never ran, `pointerLocked` stayed false, and the `mousemove` look handler
  returned on its first line. Symptom players report as "cannot move while
  shooting": the view is frozen the whole time the mouse is held. `game.start`
  and `resume` set it; `pause`, `toMenu` and `gameOver` clear it. `main.js`
  also read the flag under the wrong name (`pointerLockWanted`).
- **Pointer lock must be requested from the gesture that starts the game.**
  Asking only on a canvas mousedown means the player has to click the world
  once before the mouse aims anything, which reads as "the character does not
  turn". `game.start` and `resume` run inside the menu button's click handler,
  which is a valid gesture, so `input.requestLock()` is called there.
- **Mouse look must not require a held button.** `enabled` is the only gate:
  false in menus and while paused, true in play. Gating on a held button
  instead means the view only turns while shooting.
- **The input stress test must assert look, not just held flags.** The frozen
  camera above passed 13/13 because no case ever moved the mouse. Cases now
  dispatch `mousemove` every frame and require yaw to change, and movement is
  scored against the plain-walk baseline rather than a bare velocity threshold.
- **`movementX`/`movementY` are read-only on a constructed `MouseEvent`.** They
  have to be `Object.defineProperty`-d onto the instance or a synthetic look
  test silently measures nothing.
- **Touch pads are `pointer-events:auto` over the canvas.** They are hidden
  under `(hover: hover) and (pointer: fine)` so they cannot swallow desktop
  clicks; `#btn-pause` deliberately stays.
- **Never set `frustumCulled = false` to fix a skinned mesh popping.** A posed
  skeleton moves vertices outside the bind-pose bounds, but turning culling off
  makes every soldier draw in both passes even when behind the camera. Widen
  `geometry.boundingSphere` instead (soldier.js uses centre 0,0.95,0 r=1.35).
- **Benchmark numbers taken over a long session are worthless once the machine
  throttles.** The old build measured 158fps at HIGH/40, then 16-56fps for the
  same code twenty minutes later. Always re-measure the baseline immediately
  before or after the candidate, in the same session, and throw the run away if
  the baseline moved. A preset that is *slower* than a heavier preset is the
  tell.
- **Hand placement on a weapon must be solved, not authored.** Typed-in joint
  angles have to be redone for every weapon length and still leave the hands
  beside the gun rather than on it. soldier.js runs a two-bone IK in chest
  space; because the weapon mount is parented to the chest too, one solve stays
  correct through every torso twist, lean and recoil.
- **A support arm at >90% of its reach reads as a plank.** Keep IK targets
  inside about 85% of `L_UPPER + L_FORE` or the elbow locks straight.
- **Thigh radius must stay under the half-stance width.** At ±0.10 with a
  0.119 radius the two legs meet at the crotch and the silhouette reads as a
  skirt.
- **A level that screenshots well can still be unwalkable.** `tools/walktest.js`
  drives the real player controller along the campaign route. It found three
  faults no still would show: a leftover `arenaRadius: 54` leash cutting across
  the stair shaft, stair treads centred so the first step down was a step up,
  and a basement sealed off because the staircase descends south while the only
  door was north -- the player would have had to walk back under the flight.
- **A reachability test must check height, not just X/Z.** Standing on the
  ground floor directly above the basement satisfied a 2D distance check, so a
  sealed staircase passed.
- **Enemy sight ranges were tuned for an open arena.** 70-110m indoors means
  being shot from across the building the moment you step into a corridor.
  Campaign values are 26-60m with a vision cone.
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

## Characters

`src/soldier.js` builds one skinned mesh per loadout over a 19-bone skeleton and
solves the arm poses with a two-bone IK. Geometry, gun geometry and the IK
solutions are cached per loadout; each instance gets its own bones, a tinted
material clone and a small build scale so a squad does not read as five copies
of one man.

`poseSoldier()` is a single blended pose function, not a clip switcher: walk,
aim, recoil, flinch and death are weights that all apply in the same frame.
Distant soldiers (>26m) pose every third frame and stop casting shadows.

## Campaign

`src/campaign.js` holds mission 1 as data: a list of objectives, each with an
`enter` that dresses the world and a `done` that tests completion. Soldiers are
placed by objective, never spawned by a wave director, and the level contains
none at all until objective 5. `src/interact.js` is the [E] system; `src/facility.js`
builds the location.

The basement only works because `Player.groundAt` takes a list of `voids`: the
building interior is a region where the outdoor ground plane does not exist and
the floor comes from real slab colliders. Without it the player stands on
invisible ground at y=0 above the basement.

    const c = await import('/tools/campaigntest.js'); c.run(__rs)   // 25 checks
    const w = await import('/tools/walktest.js');    w.run(__rs)    // route

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
