# ROBOT STRIKE

**Play: https://wajahatahmed82.github.io/robot-strike/**

A single-player wave-defence FPS. You hold an abandoned robotics facility
against escalating waves of hostile soldiers. Original throughout -- no
characters, maps, assets, audio or names taken from any existing game.

Enemies are human but the game is bloodless by design: hits throw dust and kit
fragments. That keeps the age rating low and short-form platforms from
suppressing clips, at no cost to how the shooting feels.

## Controls

**Desktop** — WASD move · Shift sprint · Ctrl/C crouch · Space jump ·
mouse aim · LMB fire · RMB sights · R reload · 1-4 weapons · wheel swap ·
Esc pause

**Touch** — left thumb is a floating movement stick (push full forward to
sprint), right thumb aims, buttons bottom-right for fire / sights / reload /
jump / crouch / swap.

## Modes

- **Survival** — waves of 5, 8, 12, then +4 each. Stronger chassis unlock as
  waves progress. Clearing a wave resupplies you.
- **Time Attack** — five minutes, continuous pressure, maximise score.

## Enemies

| Loadout | Health | Speed | Behaviour |
|---|---|---|---|
| Recon | 55 | fast | Light kit, no helmet. Closes and strikes at short range |
| Rifleman | 130 | medium | Helmet, plate carrier, pack. Three-round bursts at 20m |
| Gunner | 420 | slow | Heavy plate, shoulder guards, drum-fed. Wave 4+ |
| Operator | 260 | fast | Balaclava and goggles. Four-round bursts, breaks to cover when hurt. Wave 6+ |

Built to real proportions: 1.73m to 1.95m tall, tapered cylindrical limbs rather
than boxes. Six draw calls each regardless of piece count.

AI is a real state machine — idle, patrol, alert, chase, attack, search,
retreat, dead. Robots need line of sight to engage, lose track when it breaks,
search the last known position, strafe rather than walking straight in, and the
Elite chassis retreats under fire.

## Weapons

VK-7 Rifle (auto, 30 rnd) · Hornet SMG (950 RPM, 40 rnd) ·
Breacher 12 (9 pellets) · Longview .50 (135 dmg, 4x scope).
Unlocked by level. Headshots multiply damage per weapon.

## Progression

XP from kills, headshots and wave clears. Each level grants an upgrade point.
Six upgrade tracks (damage, magazine, reload, recoil, fire rate, accuracy),
five ranks each. Every rank is a live multiplier the weapon system reads, so
buying one changes how the gun handles immediately.

## Run it

    npm install
    node tools/serve.js 5181
    # http://localhost:5181

The dev server sends `no-store`. The default python one caches, which produced
a scene lit by new intensities and old colours after an edit.

Flags: `?capture=1` enables `preserveDrawingBuffer` for screenshot tooling
(off by default, it costs real performance).

## Build

    npx esbuild src/main.js --bundle --format=iife --minify --outfile=dist/bundle.js
    node tools/build.js

Produces one self-contained file in `docs/` with no external requests.

## Performance

Measured with a GPU sync at 800x600, robots at the 14 cap and at 40:

    14 robots   sim 1.03ms   render 5.57ms   total 6.59ms   152 fps
    40 robots   sim 4.18ms   render 12.36ms  total 16.54ms   60 fps

Key decisions behind that:

- **AI line of sight tests collider boxes, not meshes.** Raycasting the merged
  map geometry walks every triangle; at a dozen robots it cost more than the
  entire render. Slab tests against ~145 boxes dropped AI cost from 35.6ms to
  4.2ms at 40 robots.
- **Sight checks are staggered** across three frames per robot and cached.
- **Everything static is merged per material**, and robots use vertex colours,
  so a full robot is six draw calls no matter how many pieces it has.
- **The weapon renders in a second pass on its own layer**, so its two lights
  shade only the weapon instead of every pixel in the world.
- **Only two lights touch the world.** Everything that looks like a lamp is
  emissive geometry, which costs nothing per pixel.
- Shadow map refreshes every other frame; `renderer.compile()` runs at boot to
  remove a 100ms+ first-draw stall; render scale auto-tunes to hold 60fps.

## Layout

    src/config.js       all tuning: weapons, robots, waves, scoring, palette
    src/main.js         renderer, quality ladder, frame loop
    src/game.js         modes, wave director, hit resolution, combo scoring
    src/player.js       movement, crouch, jump, collision with step-up
    src/weapons.js      four weapons, switching, recoil, reload, ADS
    src/viewmodel.js    parametric weapon builder driven by config shape
    src/enemies.js      four loadouts, AI state machine, stuck recovery
    src/scene.js        the facility, colliders, lighting
    src/materials.js    procedural albedo/roughness/normal generation
    src/hud.js          HUD, main menu, loadout, settings, pause, game over
    src/progression.js  XP, levels, upgrade tracks
    src/settings.js     persisted settings
    src/audio.js        procedural weapon audio, no sample files

## Not done

- No human playtesting. All balance figures come from a scripted bot.
- No armour pickups; the armour bar exists and is honoured by damage but
  nothing grants it yet.
- Environmental destruction is not implemented.
