import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG, PAL } from './config.js';
import { buildMaterials } from './materials.js';

// "Reclamation Yard 7" -- an abandoned robotics facility.
//
// Layout is built for combat, not scale: a central warehouse with a catwalk you
// can climb, two side rooms, a corridor spine, and an open yard. Robots can
// reach the player from at least three directions from anywhere on the map.
//
// Two hard rules, both learned from bugs:
//   1. The spawn must have open ground in every direction. It is asserted below.
//   2. Only two real lights touch the world. Everything else that looks like a
//      light is emissive geometry, which costs nothing per pixel.

function gradientSky() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  grad.addColorStop(0.0, hex(PAL.skyTop));
  grad.addColorStop(0.55, hex(PAL.skyMid));
  grad.addColorStop(1.0, hex(PAL.skyLow));
  g.fillStyle = grad; g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OBJ = new THREE.Object3D();
function put(geo, x, y, z, ry = 0) {
  OBJ.position.set(x, y, z);
  OBJ.rotation.set(0, ry, 0);
  OBJ.scale.set(1, 1, 1);
  OBJ.updateMatrix();
  return geo.clone().applyMatrix4(OBJ.matrix);
}

export function buildScene(renderer) {
  const mats = buildMaterials();
  const scene = new THREE.Scene();

  const sky = gradientSky();
  scene.background = sky;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  scene.environment = pmrem.fromEquirectangular(sky).texture;
  pmrem.dispose();
  scene.environmentIntensity = 0.95;
  scene.fog = new THREE.FogExp2(PAL.fog, 0.0075);

  // ---------------- light ----------------
  // Hemisphere fill lands in indirect diffuse, which the Lambert BRDF divides
  // by PI. It has to be large or every surface facing away from the key light
  // crushes to black.
  scene.add(new THREE.HemisphereLight(PAL.ambientSky, PAL.ambientGround, 5.0));

  const sun = new THREE.DirectionalLight(PAL.sun, 3.0);
  sun.position.set(-34, 30, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  const S = 36;
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // ---------------- ground ----------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mats.concreteFloor);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const r = rng(90210);
  const colliders = [];
  const steel = [], panel = [], rust = [], crate = [], dark = [];
  const emissive = { warm: [], hazard: [], cold: [] };

  const solid = (w, d, x, z, ry, top, bottom) => {
    const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
    const e = { minX: x - (w * c + d * s) / 2, maxX: x + (w * c + d * s) / 2,
                minZ: z - (d * c + w * s) / 2, maxZ: z + (d * c + w * s) / 2, top };
    if (bottom !== undefined) e.bottom = bottom;
    colliders.push(e);
    return e;
  };
  const box = (arr, w, h, d, x, y, z, ry = 0, blocks = true) => {
    arr.push(put(new THREE.BoxGeometry(w, h, d), x, y, z, ry));
    if (blocks) solid(w, d, x, z, ry, y + h / 2, y - h / 2);
  };

  // ---------------- warehouse shell ----------------
  const WX = 0, WZ = -18, WW = 40, WD = 34, WH = 9;

  function wallRun(x1, z1, x2, z2, h, gaps, arr) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const ry = Math.atan2(dx, dz) + Math.PI / 2;
    const segs = [];
    let start = 0;
    const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
    for (const [a, b] of sorted) {
      if (a > start) segs.push([start, a]);
      start = Math.max(start, b);
    }
    if (start < 1) segs.push([start, 1]);
    for (const [a, b] of segs) {
      const segLen = (b - a) * len;
      if (segLen < 0.25) continue;
      const mid = (a + b) / 2;
      const cx = x1 + dx * mid, cz = z1 + dz * mid;
      arr.push(put(new THREE.BoxGeometry(segLen, h, 0.45), cx, h / 2, cz, ry));
      solid(segLen, 0.45, cx, cz, ry, h, 0);
    }
    // lintel over each opening
    for (const [a, b] of sorted) {
      const mid = (a + b) / 2;
      const gapLen = (b - a) * len;
      const cx = x1 + dx * mid, cz = z1 + dz * mid;
      const lintelH = h - 3.4;
      if (lintelH > 0.3) {
        arr.push(put(new THREE.BoxGeometry(gapLen, lintelH, 0.45), cx, h - lintelH / 2, cz, ry));
        solid(gapLen, 0.45, cx, cz, ry, h, 3.4);
      }
    }
  }

  const L = WX - WW / 2, R = WX + WW / 2, N = WZ - WD / 2, F = WZ + WD / 2;
  wallRun(L, F, R, F, WH, [[0.44, 0.56]], panel);                 // south wall, main door
  wallRun(L, N, R, N, WH, [[0.20, 0.30], [0.70, 0.80]], panel);   // north wall, two bays
  wallRun(L, N, L, F, WH, [[0.36, 0.48]], panel);                 // west wall
  wallRun(R, N, R, F, WH, [[0.52, 0.66]], panel);                 // east wall

  // roof trusses: silhouette and shadow without sealing the space
  for (let i = 0; i < 9; i++) {
    const z = N + 1.8 + i * ((WD - 3.6) / 8);
    steel.push(put(new THREE.BoxGeometry(WW, 0.34, 0.34), WX, WH - 0.3, z));
    steel.push(put(new THREE.BoxGeometry(WW * 0.98, 0.16, 0.16), WX, WH - 1.3, z));
    for (let k = -3; k <= 3; k++) {
      steel.push(put(new THREE.BoxGeometry(0.14, 1.0, 0.14), WX + k * (WW / 7), WH - 0.8, z));
    }
  }
  // support columns
  for (const cx of [L + 6, R - 6]) {
    for (let i = 0; i < 3; i++) {
      const z = N + 7 + i * 10;
      box(steel, 0.7, WH, 0.7, cx, WH / 2, z);
    }
  }

  // ---------------- catwalk with stairs ----------------
  const CW_Y = 3.6;
  // platform along the east wall
  box(steel, 3.2, 0.3, 22, R - 3.4, CW_Y, WZ - 2, 0);
  // railings, non-blocking so they never trap you
  for (let i = 0; i < 12; i++) {
    const z = WZ - 13 + i * 2;
    steel.push(put(new THREE.BoxGeometry(0.09, 1.05, 0.09), R - 5.0, CW_Y + 0.68, z));
  }
  steel.push(put(new THREE.BoxGeometry(0.08, 0.08, 22), R - 5.0, CW_Y + 1.15, WZ - 2));
  steel.push(put(new THREE.BoxGeometry(0.08, 0.08, 22), R - 5.0, CW_Y + 0.6, WZ - 2));

  // stairs up to it
  const STEPS = 14, RISE = CW_Y / STEPS, RUN = 0.42;
  for (let i = 0; i < STEPS; i++) {
    const y = RISE * (i + 1);
    const z = WZ + 9 - i * RUN;
    box(steel, 2.2, RISE, RUN + 0.04, R - 3.4, y - RISE / 2, z);
  }
  // upper landing over the corridor, walk-under clearance kept
  box(steel, 8, 0.3, 3.0, R - 7.5, CW_Y, WZ - 12, 0);

  // ---------------- two side rooms ----------------
  function room(cx, cz, w, d, doorSide) {
    const rl = cx - w / 2, rr = cx + w / 2, rn = cz - d / 2, rf = cz + d / 2;
    const g = [[0.42, 0.58]];
    wallRun(rl, rf, rr, rf, 3.6, doorSide === 'S' ? g : [], panel);
    wallRun(rl, rn, rr, rn, 3.6, doorSide === 'N' ? g : [], panel);
    wallRun(rl, rn, rl, rf, 3.6, doorSide === 'W' ? g : [], panel);
    wallRun(rr, rn, rr, rf, 3.6, doorSide === 'E' ? g : [], panel);
    // ceiling slab: makes the interior a genuinely dark pocket
    panel.push(put(new THREE.BoxGeometry(w, 0.3, d), cx, 3.7, cz));
    solid(w, d, cx, cz, 0, 4.0, 3.55);
  }
  room(L + 7, N + 7, 10, 9, 'S');
  room(R - 8, F - 7, 9, 8, 'W');

  // ---------------- machinery and cover ----------------
  const machine = (x, z, ry) => {
    box(rust, 2.6, 2.2, 1.6, x, 1.1, z, ry);
    steel.push(put(new THREE.BoxGeometry(1.1, 0.9, 1.1), x, 2.6, z, ry));
    steel.push(put(new THREE.CylinderGeometry(0.16, 0.16, 2.4, 8), x + 1.0, 2.2, z, ry));
    emissive.hazard.push(put(new THREE.BoxGeometry(0.5, 0.09, 0.09), x, 2.0, z + 0.82, ry));
  };
  machine(L + 9, WZ + 4, 0.2);
  machine(WX + 4, N + 5, -0.4);
  machine(R - 12, WZ + 8, 1.1);

  // shelving racks: tall cover with gaps to shoot through
  const rack = (x, z, ry) => {
    for (let lvl = 0; lvl < 3; lvl++) {
      steel.push(put(new THREE.BoxGeometry(5.4, 0.16, 1.2), x, 0.5 + lvl * 1.5, z, ry));
    }
    for (let k = -1; k <= 1; k++) {
      const ox = k * 2.6;
      steel.push(put(new THREE.BoxGeometry(0.16, 4.6, 1.2),
        x + Math.cos(ry) * ox, 2.3, z - Math.sin(ry) * ox, ry));
    }
    solid(5.4, 1.2, x, z, ry, 1.2, 0);
    crate.push(put(new THREE.BoxGeometry(1.0, 0.9, 0.9), x - 1.4, 2.45, z, ry));
    crate.push(put(new THREE.BoxGeometry(1.0, 0.9, 0.9), x + 1.2, 3.95, z, ry));
  };
  rack(WX - 8, WZ - 6, 0);
  rack(WX + 6, WZ - 2, Math.PI / 2);
  rack(WX - 4, WZ + 9, 0);

  // shipping containers, inside and out
  const container = (x, z, ry, tone) => {
    const arr = tone ? rust : steel;
    box(arr, 6.0, 2.6, 2.5, x, 1.3, z, ry);
    for (let i = 0; i < 11; i++) {
      const off = (i - 5) * 0.52;
      arr.push(put(new THREE.BoxGeometry(0.10, 2.4, 2.56),
        x + Math.cos(ry) * off, 1.3, z - Math.sin(ry) * off, ry));
    }
  };
  container(L + 5, F + 9, 0.1, true);
  container(R - 6, F + 12, -0.4, false);
  container(WX - 2, F + 16, 1.4, true);
  container(L - 9, WZ, 0.5, false);
  container(R + 9, WZ - 6, -0.2, true);
  // stacked pair, makes a climbable perch in the yard
  container(WX + 12, F + 8, 0, false);
  box(steel, 6.0, 2.6, 2.5, WX + 12, 3.9, F + 8, 0);

  // crates
  const crateGeo = new THREE.BoxGeometry(1.15, 1.15, 1.15);
  const spots = [[L + 12, WZ + 11], [L + 13.2, WZ + 11.6], [WX + 9, WZ + 6],
                 [WX - 12, N + 4], [R - 5, N + 3], [WX + 2, F + 5],
                 [L - 4, F + 6], [R + 3, F + 3], [WX - 15, WZ + 12]];
  spots.forEach(([x, z], i) => {
    const stack = i % 3 === 0 ? 2 : 1;
    for (let k = 0; k < stack; k++) crate.push(put(crateGeo, x, 0.6 + k * 1.16, z, r() * 0.7));
    solid(1.3, 1.3, x, z, 0, 0.6 + (stack - 1) * 1.16 + 0.58, 0);
  });

  // barrels
  const barrelGeo = new THREE.CylinderGeometry(0.38, 0.38, 1.05, 12);
  [[L + 3, WZ - 9], [R - 9, N + 8], [WX + 14, F + 3], [L - 6, F + 11], [WX - 6, WZ + 14]]
    .forEach(([x, z]) => {
      rust.push(put(barrelGeo, x, 0.53, z));
      solid(0.8, 0.8, x, z, 0, 1.05, 0);
    });

  // ---------------- outdoor yard boundary ----------------
  const fence = (x1, z1, x2, z2) => {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const ry = Math.atan2(dx, dz) + Math.PI / 2;
    const n = Math.round(len / 4);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const cx = x1 + dx * t, cz = z1 + dz * t;
      steel.push(put(new THREE.BoxGeometry(len / n - 0.2, 3.0, 0.12), cx, 1.5, cz, ry));
      solid(len / n, 0.2, cx, cz, ry, 3.0, 0);
    }
  };
  fence(-34, 26, 34, 26);
  fence(-34, -46, -34, 26);
  fence(34, -46, 34, 26);
  fence(-34, -46, 34, -46);

  // ---------------- emissive fittings ----------------
  // Strip lights, hazard beacons and console glow. All unlit geometry.
  for (let i = 0; i < 8; i++) {
    const z = N + 3 + i * ((WD - 6) / 7);
    emissive.warm.push(put(new THREE.BoxGeometry(3.0, 0.10, 0.30), WX - 9, WH - 1.6, z));
    emissive.warm.push(put(new THREE.BoxGeometry(3.0, 0.10, 0.30), WX + 9, WH - 1.6, z));
  }
  for (const [x, z] of [[L + 2, F - 2], [R - 2, N + 2], [WX, F - 1]]) {
    emissive.hazard.push(put(new THREE.BoxGeometry(0.35, 0.35, 0.12), x, 4.2, z));
  }
  for (let i = 0; i < 14; i++) {
    emissive.cold.push(put(new THREE.BoxGeometry(0.14, 0.05, 0.05),
      L + 4 + r() * (WW - 8), 0.9 + r() * 2.4, N + 3 + r() * (WD - 6)));
  }
  // floor guide strips
  for (let i = 0; i < 18; i++) {
    emissive.cold.push(put(new THREE.BoxGeometry(1.2, 0.02, 0.14), WX, 0.02, N + 2 + i * 1.8));
  }

  // ---------------- merge ----------------
  const statics = [];
  const addMerged = (geos, mat) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    statics.push(m);
  };
  addMerged(steel, mats.steel);
  addMerged(panel, mats.panel);
  addMerged(rust, mats.rust);
  addMerged(crate, mats.crate);
  addMerged(dark, mats.steel);

  const glowMat = (hex) => new THREE.MeshBasicMaterial({ color: hex, fog: true });
  const addGlow = (geos, hex) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos, false), glowMat(hex));
    scene.add(m);
  };
  addGlow(emissive.warm, PAL.workLight);
  addGlow(emissive.hazard, PAL.hazard);
  addGlow(emissive.cold, 0x63d8ff);

  // ---------------- debris scatter ----------------
  const debris = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mats.rust, 70);
  debris.castShadow = true; debris.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(),
        v = new THREE.Vector3(), sc = new THREE.Vector3();
  for (let i = 0; i < 70; i++) {
    v.set(-32 + r() * 64, 0.04 + r() * 0.12, -44 + r() * 68);
    q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
    const s2 = 0.14 + r() * 0.4;
    sc.set(s2, s2 * 0.5, s2);
    debris.setMatrixAt(i, m4.compose(v, q, sc));
  }
  debris.instanceMatrix.needsUpdate = true;
  scene.add(debris);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  // ---------------- spawn, asserted clear ----------------
  // Forward is (-sin(yaw), -cos(yaw)), so yaw 0 looks down -Z. Using PI here
  // spawned the player facing the empty yard with the whole map behind them.
  const spawn = { x: 0, z: F + 6, yaw: 0 };        // in the yard, facing the warehouse
  const pr = CFG.player.radius + 0.35;
  const conflicts = colliders.filter((c) =>
    spawn.x + pr > c.minX && spawn.x - pr < c.maxX &&
    spawn.z + pr > c.minZ && spawn.z - pr < c.maxZ && c.top > 0.5);
  if (conflicts.length) console.warn('ROBOT STRIKE: spawn is inside cover', conflicts);

  const blockers = statics.concat([ground]);
  return { scene, sun, blockers, colliders, mats, spawn, bounds: { L, R, N, F, WH } };
}
