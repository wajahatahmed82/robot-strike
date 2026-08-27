import * as THREE from 'three';
import { Game, STATE, MODE } from './game.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Progression } from './progression.js';
import * as audio from './audio.js';
import * as settings from './settings.js';

const canvas = document.getElementById('view');

// preserveDrawingBuffer makes the driver keep a full copy of every frame. It is
// only needed for automated screenshots, so it is opt-in and never on for
// players.
const CAPTURE = new URLSearchParams(location.search).has('capture');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,          // resolution scaling is a better use of the budget
  powerPreference: 'high-performance',
  preserveDrawingBuffer: CAPTURE,
  stencil: false,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;   // ACES crushes darks to black
renderer.toneMappingExposure = 1.0;
// render() draws two passes, so stats must accumulate across both.
renderer.info.autoReset = false;

const prog = new Progression();
const input = new Input(canvas);
const game = new Game(renderer, input, prog);
const hud = new HUD(game, input, prog);

// ---------------------------------------------------------------- quality ----
// Phones and laptops vary enormously, so measure instead of guessing. On "auto"
// the render scale tracks real frame time and shadows switch off before the
// resolution drops far enough to look soft.
const DPR_CAP = Math.min(window.devicePixelRatio || 1, 2);
const PRESETS = {
  low:    { scale: 0.7, shadows: false, shadowSize: 512 },
  medium: { scale: 1.0, shadows: true,  shadowSize: 512 },
  high:   { scale: Math.min(DPR_CAP, 1.6), shadows: true, shadowSize: 1024 },
};

let renderScale = 1.0;
let shadowsOn = true;
let frameAvg = 16.7;

function setShadows(on, size) {
  shadowsOn = on;
  renderer.shadowMap.enabled = on;
  if (size && game.sun.shadow.mapSize.width !== size) {
    game.sun.shadow.mapSize.set(size, size);
    game.sun.shadow.map?.dispose();
    game.sun.shadow.map = null;
  }
  game.scene.traverse((o) => {
    if (o.isMesh && o.material) {
      const m = Array.isArray(o.material) ? o.material : [o.material];
      m.forEach((x) => { x.needsUpdate = true; });
    }
  });
}

function applySize() {
  const w = window.innerWidth || 800;
  const h = window.innerHeight || 600;
  renderer.setPixelRatio(renderScale);
  renderer.setSize(w, h, false);
  game.camera.aspect = w / h;
  game.camera.updateProjectionMatrix();
}

function applyQuality() {
  const q = settings.get('quality');
  if (q === 'auto') {
    renderScale = Math.min(DPR_CAP, 1.2);
    setShadows(true, 512);
  } else {
    const p = PRESETS[q] || PRESETS.medium;
    renderScale = p.scale;
    setShadows(p.shadows, p.shadowSize);
  }
  applySize();
}
applyQuality();
settings.onChange((k) => { if (k === 'quality' || k === null) applyQuality(); });

let tuneT = 0;
function autoTune(dt, frameMs) {
  if (settings.get('quality') !== 'auto') return;
  frameAvg += (frameMs - frameAvg) * 0.06;
  tuneT += dt;
  if (tuneT < 0.9) return;
  tuneT = 0;
  // 16.7ms is the 60fps budget. Give up shadows before resolution, because
  // soft edges are more noticeable than missing shadows on a small screen.
  if (frameAvg > 17.5) {
    if (shadowsOn) setShadows(false, 512);
    else if (renderScale > 0.6) { renderScale = Math.max(0.6, renderScale - 0.12); applySize(); }
  } else if (frameAvg < 12.5) {
    if (renderScale < Math.min(DPR_CAP, 1.4)) {
      renderScale = Math.min(Math.min(DPR_CAP, 1.4), renderScale + 0.08);
      applySize();
    } else if (!shadowsOn) setShadows(true, 512);
  }
}

window.addEventListener('resize', applySize);
window.addEventListener('orientationchange', () => setTimeout(applySize, 150));
if (window.ResizeObserver) new ResizeObserver(applySize).observe(document.body);

// Shadow maps re-render the whole scene. Almost nothing that casts one moves
// fast, so refreshing every other frame is free quality.
renderer.shadowMap.autoUpdate = false;
let shadowTick = 0;

// Compile every shader up front, otherwise the first frame showing a new
// material stalls for over 100ms mid-firefight.
renderer.compile(game.scene, game.camera);

const unlockOnce = () => { audio.unlock(); window.removeEventListener('pointerdown', unlockOnce); };
window.addEventListener('pointerdown', unlockOnce);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === STATE.PLAY) game.pause();
});
document.addEventListener('pointerlockchange', () => {
  // Losing the lock mid-game means the player hit Esc or tabbed away.
  if (!document.pointerLockElement && game.state === STATE.PLAY && input.pointerLockWanted) game.pause();
});

let last = performance.now();

function step(dt) {
  game.update(dt);
  hud.update(dt);
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;      // a stall must never tunnel a bullet

  renderer.info.reset();
  const t0 = performance.now();
  step(dt);

  shadowTick = (shadowTick + 1) % 2;
  renderer.shadowMap.needsUpdate = shadowsOn && shadowTick === 0;

  game.render();
  const cost = performance.now() - t0;
  autoTune(dt, cost);
  hud.setFps(1 / Math.max(dt, 0.0001), renderScale);
}
requestAnimationFrame(frame);

window.__rs = {
  game, hud, input, renderer, prog, settings, step, THREE, STATE, MODE,
  get renderScale() { return renderScale; },
  get shadowsOn() { return shadowsOn; },
  setQuality(q) { settings.set('quality', q); applyQuality(); },
};
