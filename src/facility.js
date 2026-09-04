import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Meridian Ridge Research Station -- the campaign location.
//
// Built from rooms and corridors rather than one arena, so the player travels
// through a place instead of circling a box. Every wall, floor and prop is
// procedural: no model files, nothing licensed.
//
// Two levels. The ground floor sits at y=0 and the basement at y=-3.6, reached
// by a stair shaft. That needs one change to the player controller: `groundAt`
// used to default the floor to y=0 everywhere, which would hold the player up
// in mid-air over the basement. The building interior is registered as a
// `void` where only real slab colliders count, and the slabs are laid
// explicitly -- everywhere except the stair shaft.
//
// Geometry is bucketed by material and merged once, so the whole facility is a
// handful of draw calls.

const WALL_H = 4.2;
const BASE_Y = -3.6;
const CEIL_T = 0.25;

// Named areas the campaign uses for objectives, enemy placement and triggers.
// Kept as data so a second mission can reuse the building with new contents.
export const AREA = {};

export function buildFacility(scene, mats, PAL) {
  const colliders = [];
  const voids = [];
  const areas = {};
  const anchors = {};
  const buckets = { steel: [], panel: [], rust: [], crate: [], floor: [], ceil: [] };
  const glow = { warm: [], cold: [], hazard: [] };
  const lights = [];

  const OBJ = new THREE.Object3D();
  const put = (geo, x, y, z, ry = 0) => {
    OBJ.position.set(x, y, z);
    OBJ.rotation.set(0, ry, 0);
    OBJ.scale.set(1, 1, 1);
    OBJ.updateMatrix();
    return geo.clone().applyMatrix4(OBJ.matrix);
  };

  const solid = (w, d, x, z, top, bottom) => {
    colliders.push({ minX: x - w / 2, maxX: x + w / 2,
                     minZ: z - d / 2, maxZ: z + d / 2, top, bottom });
  };

  // A box of geometry, optionally collidable.
  const box = (bucket, w, h, d, x, y, z, blocks = true) => {
    buckets[bucket].push(put(new THREE.BoxGeometry(w, h, d), x, y, z));
    if (blocks) solid(w, d, x, z, y + h / 2, y - h / 2);
  };

  const lamp = (kind, w, h, d, x, y, z) => {
    glow[kind].push(put(new THREE.BoxGeometry(w, h, d), x, y, z));
  };

  // ---------------------------------------------------------------- shell

  // Footprint of the building interior. Inside it the floor comes only from
  // slab colliders, which is what makes a basement possible at all.
  const IN = { minX: -31, maxX: 31, minZ: -61, maxZ: -0.5 };
  voids.push(IN);

  // Ground slab, laid as strips so the stair shaft can be left open.
  const SHAFT = { minX: -6.5, maxX: -0.5, minZ: -59.5, maxZ: -51.5 };
  const slab = (x1, z1, x2, z2, y) => {
    const w = x2 - x1, d = z2 - z1;
    if (w <= 0 || d <= 0) return;
    buckets.floor.push(put(new THREE.BoxGeometry(w, 0.4, d), (x1 + x2) / 2, y - 0.2, (z1 + z2) / 2));
    solid(w, d, (x1 + x2) / 2, (z1 + z2) / 2, y, y - 0.4);
  };
  // four strips around the shaft
  slab(-31, -51.5, 31, -0.5, 0);
  slab(-31, -61, -6.5, -51.5, 0);
  slab(-0.5, -61, 31, -51.5, 0);
  slab(-6.5, -61, -0.5, -59.5, 0);

  // Basement slab and ceiling.
  slab(-28, -47, 26, -23, BASE_Y);
  // The stair flight descends south, so the basement has to open to the EAST of
  // it. Walking back north under the flight is impossible -- the treads are
  // solid overhead -- which is what stranded the player at the bottom.
  // Runs to the building's rear wall: with the shaft ending at -59.5 the flat
  // landing was 0.8m deep and the player is 0.8m wide, so they stood inside the
  // wall and could not move in any direction.
  slab(-6.5, -61, 6, -46.5, BASE_Y);

  // ---------------------------------------------------------------- walls

  // A wall run along one axis with doorway gaps cut out of it.
  // `gaps` are [centre, width] along the run.
  const wall = (x1, z1, x2, z2, h, gaps = [], y0 = 0, bucket = 'panel') => {
    const horiz = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    const a = horiz ? x1 : z1;
    const b = horiz ? x2 : z2;
    const fixed = horiz ? z1 : x1;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const segs = [];
    let cur = lo;
    for (const [c, w] of [...gaps].sort((p, q) => p[0] - q[0])) {
      const gs = c - w / 2, ge = c + w / 2;
      if (gs > cur) segs.push([cur, gs]);
      cur = Math.max(cur, ge);
    }
    if (cur < hi) segs.push([cur, hi]);
    for (const [s, e] of segs) {
      const len = e - s;
      if (len < 0.05) continue;
      const mid = (s + e) / 2;
      if (horiz) box(bucket, len, h, 0.3, mid, y0 + h / 2, fixed);
      else box(bucket, 0.3, h, len, fixed, y0 + h / 2, mid);
    }
    // header above each doorway, so a gap reads as a door not a missing wall
    for (const [c, w] of gaps) {
      const hh = h - 2.3;
      if (hh <= 0.05) continue;
      if (horiz) box(bucket, w, hh, 0.3, c, y0 + 2.3 + hh / 2, fixed, false);
      else box(bucket, 0.3, hh, w, fixed, y0 + 2.3 + hh / 2, c, false);
    }
  };

  const ceiling = (x1, z1, x2, z2, y) => {
    const w = x2 - x1, d = z2 - z1;
    // Concrete, not the ribbed panel: the panel's ribs smear into long streaks
    // when stretched over a span this size.
    buckets.ceil.push(put(new THREE.BoxGeometry(w, CEIL_T, d), (x1 + x2) / 2, y, (z1 + z2) / 2));
    solid(w, d, (x1 + x2) / 2, (z1 + z2) / 2, y + CEIL_T / 2, y - CEIL_T / 2);
  };

  const area = (name, x1, z1, x2, z2, y = 0) => {
    areas[name] = { name, minX: Math.min(x1, x2), maxX: Math.max(x1, x2),
                    minZ: Math.min(z1, z2), maxZ: Math.max(z1, z2), y,
                    cx: (x1 + x2) / 2, cz: (z1 + z2) / 2 };
    AREA[name] = areas[name];
    return areas[name];
  };

  // ---------------------------------------------------------------- exterior

  area('parking', -28, 14, 28, 40);
  area('gate', -8, 8, 8, 15);
  area('forecourt', -20, 0, 20, 8);

  // perimeter fence with the gate standing open
  for (const [x1, z1, x2, z2, gaps] of [
    [-34, 42, 34, 42, []],
    [-34, 42, -34, -2, []],
    [34, 42, 34, -2, []],
    [-34, 14.5, 34, 14.5, [[0, 9]]],
  ]) wall(x1, z1, x2, z2, 2.6, gaps, 0, 'steel');

  // gate posts and the swung-open leaves
  box('steel', 0.4, 3.2, 0.4, -4.6, 1.6, 14.5);
  box('steel', 0.4, 3.2, 0.4, 4.6, 1.6, 14.5);
  box('rust', 0.16, 2.4, 4.2, -4.9, 1.3, 12.3, false);
  box('rust', 0.16, 2.4, 4.2, 4.9, 1.3, 12.3, false);
  lamp('hazard', 0.5, 0.12, 0.12, -4.6, 3.3, 14.5);

  // guard hut at the gate
  wall(6, 12, 12, 12, 2.8, [], 0, 'panel');
  wall(6, 18, 12, 18, 2.8, [[9, 1.2]], 0, 'panel');
  wall(6, 12, 6, 18, 2.8, [[15, 1.2]], 0, 'panel');
  wall(12, 12, 12, 18, 2.8, [], 0, 'panel');
  ceiling(6, 12, 12, 18, 2.9);
  lamp('warm', 1.0, 0.08, 0.2, 9, 2.6, 15);

  // parked vehicles: a slab body, cab and wheels each
  const vehicle = (x, z, ry, len = 4.6) => {
    const c = Math.cos(ry), s = Math.sin(ry);
    const at = (dx, dz) => [x + dx * c - dz * s, z + dx * s + dz * c];
    const [bx, bz] = at(0, 0);
    box('rust', 2.1, 1.0, len, bx, 0.95, bz);
    const [cx2, cz2] = at(0, -len * 0.22);
    box('steel', 1.9, 0.85, len * 0.34, cx2, 1.85, cz2, false);
    for (const [dx, dz] of [[-0.95, len * 0.32], [0.95, len * 0.32], [-0.95, -len * 0.32], [0.95, -len * 0.32]]) {
      const [wx, wz] = at(dx, dz);
      box('steel', 0.34, 0.7, 0.7, wx, 0.35, wz, false);
    }
  };
  vehicle(-18, 24, 0.1); vehicle(-12, 24, 0.0); vehicle(12, 26, 0.05, 6.2);
  vehicle(20, 22, 1.55); vehicle(-22, 33, 0.0);
  anchors.crashedTruck = new THREE.Vector3(6, 0, 20);
  vehicle(6, 20, 0.6, 6.4);

  // light masts over the car park
  // Kept off the spawn sightline: a 7m mast on the centre line hides the whole
  // building on the approach, which is the first thing the player should see.
  for (const [x, z] of [[-25, 30], [25, 30], [-25, 19], [25, 19]]) {
    box('steel', 0.3, 7, 0.3, x, 3.5, z, true);
    lamp('warm', 1.6, 0.2, 0.5, x, 7.0, z);
  }

  // ---------------------------------------------------------------- ground floor

  const G = WALL_H;
  area('reception', -12, -14, 12, -0.5);
  area('checkpoint', 12, -12, 24, -0.5);
  area('security', 12, -26, 24, -12);
  area('offices', -30, -26, -12, -2);
  area('corridor', -30, -32, 24, -26);
  area('storage', -30, -48, -16, -32);
  area('medical', -14, -46, -2, -32);
  area('server', 0, -46, 12, -32);
  area('maintenance', 14, -48, 26, -32);
  area('stairwell', -6.5, -59.5, -0.5, -47);
  area('loading', 2, -61, 30, -50);

  // outer shell
  wall(-31, -0.5, 31, -0.5, G, [[0, 3.2]]);                 // front, main entrance
  wall(-31, -61, 31, -61, G, [[18, 7]]);                    // rear, loading door
  wall(-31, -0.5, -31, -61, G, []);
  wall(31, -0.5, 31, -61, G, []);
  ceiling(-31, -61, 31, -0.5, G);

  // reception / checkpoint / offices
  wall(12, -0.5, 12, -26, G, [[-6, 1.6], [-20, 1.6]]);      // reception|checkpoint
  wall(-12, -0.5, -12, -26, G, [[-8, 1.6], [-20, 1.6]]);    // reception|offices
  wall(-12, -14, 12, -14, G, [[0, 2.4]]);                   // reception rear
  wall(12, -12, 24, -12, G, [[18, 1.6]]);                   // checkpoint|security
  wall(-12, -26, 24, -26, G, [[-6, 1.8], [6, 1.8], [18, 1.8]]);   // corridor north wall
  wall(-30, -26, -12, -26, G, [[-20, 1.8]]);

  // corridor south wall, doors into each south room
  wall(-30, -32, 26, -32, G, [[-23, 1.8], [-8, 1.8], [6, 1.8], [20, 1.8]]);

  // south room partitions
  wall(-16, -48, -16, -32, G, []);
  wall(-2, -46, -2, -32, G, []);
  wall(0, -46, 0, -32, G, []);
  wall(12, -48, 12, -32, G, []);
  wall(-30, -48, -16, -48, G, [[-23, 1.8]]);
  wall(-14, -46, -2, -46, G, [[-8, 1.8]]);
  wall(0, -46, 12, -46, G, [[6, 1.8]]);
  wall(14, -48, 26, -48, G, [[20, 1.8]]);
  wall(12, -48, 14, -48, G, []);

  // rear corridor linking the south rooms to the stairwell and loading bay
  wall(-31, -50, 31, -50, G, [[-3.5, 2.2], [16, 6]]);
  area('rearCorridor', -31, -50, 31, -48);

  // Stair shaft. The west and south walls run full height because there is no
  // floor beyond them at basement level. The east side is only a ground-floor
  // railing, so the bottom of the stairs opens into the basement.
  wall(-6.5, -51.5, -6.5, -61, G, [], BASE_Y);
  wall(-6.5, -61, -0.5, -61, G, [], BASE_Y);
  box('steel', 0.16, 1.15, 8.0, -0.5, 0.575, -55.5);

  // the stairs themselves
  // Tread tops must land exactly on the descent line. Centring the box at
  // `y + h/2` puts the top a whole box-height too high, which turned the first
  // step down into a step up.
  // Tread tops must land exactly on the descent line. Centring the box at
  // `y + h/2` puts the top a whole box-height too high, which turned the first
  // step down into a step up.
  const STEPS = 16;
  const RISE = Math.abs(BASE_Y) / STEPS;
  for (let i = 0; i < STEPS; i++) {
    const top = -(i + 1) * RISE;
    const z = -52 - i * 0.42;
    box('steel', 5.6, 0.5, 0.54, -3.5, top - 0.25, z);
  }
  box('steel', 0.1, 1.1, 7.6, -0.75, BASE_Y + 2.2, -55.5, false);

  // ---------------------------------------------------------------- basement

  area('undergroundCorridor', -6, -47, 6, -24, BASE_Y);
  area('laboratory', -26, -46, -8, -26, BASE_Y);
  area('armory', 8, -44, 24, -28, BASE_Y);

  const BH = 3.2;
  wall(-6, -47, -6, -24, BH, [[-36, 1.8]], BASE_Y);
  wall(6, -47, 6, -24, BH, [[-34, 1.8]], BASE_Y);
  wall(-6, -24, 6, -24, BH, [], BASE_Y);
  wall(-6, -47, 6, -47, BH, [[0, 3.0]], BASE_Y);
  ceiling(-28, -47, 26, -23, BASE_Y + BH);

  wall(-26, -46, -26, -26, BH, [], BASE_Y);
  wall(-26, -26, -6, -26, BH, [], BASE_Y);
  wall(-26, -46, -6, -46, BH, [], BASE_Y);
  wall(8, -44, 8, -28, BH, [[-34, 1.8]], BASE_Y);
  wall(24, -44, 24, -28, BH, [], BASE_Y);
  wall(8, -28, 24, -28, BH, [], BASE_Y);
  wall(8, -44, 24, -44, BH, [], BASE_Y);

  // ---------------------------------------------------------------- props

  const desk = (x, z, ry = 0) => {
    const c = Math.cos(ry), s = Math.sin(ry);
    buckets.steel.push(put(new THREE.BoxGeometry(1.7, 0.08, 0.8), x, 0.74, z, ry));
    solid(1.7 * Math.abs(c) + 0.8 * Math.abs(s), 0.8 * Math.abs(c) + 1.7 * Math.abs(s), x, z, 0.78, 0);
    for (const dx of [-0.75, 0.75]) {
      buckets.steel.push(put(new THREE.BoxGeometry(0.08, 0.7, 0.7), x + dx * c, 0.35, z + dx * s, ry));
    }
  };
  const monitor = (x, y, z, ry = 0, on = true) => {
    buckets.steel.push(put(new THREE.BoxGeometry(0.06, 0.36, 0.56), x, y + 0.2, z, ry));
    buckets.steel.push(put(new THREE.BoxGeometry(0.16, 0.06, 0.2), x, y + 0.02, z, ry));
    if (on) glow.cold.push(put(new THREE.BoxGeometry(0.02, 0.28, 0.46), x + 0.04 * Math.cos(ry), y + 0.2, z + 0.04 * Math.sin(ry), ry));
  };
  const locker = (x, z, ry = 0, n = 3) => {
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 0.62;
      buckets.steel.push(put(new THREE.BoxGeometry(0.6, 1.9, 0.5), x + off * Math.cos(ry), 0.95, z + off * Math.sin(ry), ry));
    }
    solid(n * 0.62 * Math.abs(Math.cos(ry)) + 0.5 * Math.abs(Math.sin(ry)),
          0.5 * Math.abs(Math.cos(ry)) + n * 0.62 * Math.abs(Math.sin(ry)), x, z, 1.9, 0);
  };
  const shelf = (x, z, ry = 0, len = 3.4, y0 = 0) => {
    for (let i = 0; i < 3; i++) {
      buckets.rust.push(put(new THREE.BoxGeometry(len, 0.06, 0.75), x, y0 + 0.5 + i * 0.72, z, ry));
    }
    for (const dx of [-len / 2 + 0.1, len / 2 - 0.1]) {
      buckets.rust.push(put(new THREE.BoxGeometry(0.09, 2.2, 0.75), x + dx * Math.cos(ry), y0 + 1.1, z + dx * Math.sin(ry), ry));
    }
    solid(len * Math.abs(Math.cos(ry)) + 0.75 * Math.abs(Math.sin(ry)),
          0.75 * Math.abs(Math.cos(ry)) + len * Math.abs(Math.sin(ry)), x, z, y0 + 2.2, y0);
  };
  const crate = (x, y, z, s = 1) => {
    buckets.crate.push(put(new THREE.BoxGeometry(1.1 * s, 0.9 * s, 1.1 * s), x, y + 0.45 * s, z));
    solid(1.1 * s, 1.1 * s, x, z, y + 0.9 * s, y);
  };
  const rack = (x, z, ry = 0, y0 = 0) => {
    buckets.steel.push(put(new THREE.BoxGeometry(0.9, 2.1, 1.0), x, y0 + 1.05, z, ry));
    solid(0.9, 1.0, x, z, y0 + 2.1, y0);
    for (let i = 0; i < 7; i++) {
      glow.cold.push(put(new THREE.BoxGeometry(0.03, 0.03, 0.5),
        x + 0.46 * Math.cos(ry), y0 + 0.35 + i * 0.25, z + 0.46 * Math.sin(ry), ry));
    }
  };
  const pipe = (x1, z1, x2, z2, y, r = 0.11) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const ry = Math.atan2(x2 - x1, z2 - z1);
    const g = new THREE.CylinderGeometry(r, r, len, 7);
    g.rotateX(Math.PI / 2);
    buckets.rust.push(put(g, (x1 + x2) / 2, y, (z1 + z2) / 2, ry));
  };
  const sign = (x, y, z, ry, kind = 'cold') => {
    glow[kind].push(put(new THREE.BoxGeometry(1.1, 0.24, 0.05), x, y, z, ry));
  };
  const strip = (x, z, y = G - 0.35, len = 2.2, ry = 0) => {
    glow.warm.push(put(new THREE.BoxGeometry(len, 0.08, 0.16), x, y, z, ry));
  };

  // reception
  desk(0, -4.5); monitor(0, 0.78, -4.5, 0, false);
  desk(-4, -9, 0.4); desk(4.4, -9.5, -0.3);
  locker(-10.5, -12, 0);
  for (const z of [-3, -8, -12]) { strip(-6, z); strip(6, z); }
  sign(0, 2.6, -14.2, 0);
  crate(8.5, 0, -12); crate(9.6, 0, -12.6, 0.8);

  // checkpoint
  desk(18, -3, 0); monitor(18, 0.78, -3, 0);
  box('steel', 3.6, 1.1, 0.25, 18, 0.55, -6.5);
  locker(22.6, -9, Math.PI / 2, 2);
  strip(18, -4); strip(18, -10);

  // security room
  desk(18, -16, 0); monitor(17.2, 0.78, -16, 0); monitor(18.8, 0.78, -16, 0, false);
  for (let i = 0; i < 4; i++) monitor(14.4, 1.6 + i * 0.5, -18 - (i % 2) * 0.8, Math.PI / 2, i !== 2);
  locker(22.5, -22, Math.PI / 2, 3);
  strip(18, -20);
  anchors.securityTerminal = new THREE.Vector3(18, 1.0, -15.2);
  anchors.securityDoor = new THREE.Vector3(21.6, 0, -12);

  // offices: cubicle desks, some overturned
  for (let i = 0; i < 8; i++) {
    const x = -27 + (i % 4) * 4.4;
    const z = -6 - Math.floor(i / 4) * 7;
    desk(x, z, i % 3 === 0 ? 0.5 : 0);
    if (i % 3 !== 1) monitor(x, 0.78, z, 0, i % 4 === 0);
    if (i % 4 === 2) box('steel', 0.5, 0.9, 0.5, x + 1.4, 0.45, z + 0.9);
  }
  for (const z of [-6, -13, -20]) strip(-21, z, G - 0.35, 3.0);
  locker(-29.4, -23, Math.PI / 2, 3);
  anchors.officeDocument = new THREE.Vector3(-18.6, 0.85, -13);

  // main corridor: long, with flickering lights and a landmark stripe
  for (let i = 0; i < 9; i++) strip(-28 + i * 6.5, -29, G - 0.35, 3.0);
  sign(-6, 2.9, -26.1, 0); sign(6, 2.9, -26.1, 0); sign(18, 2.9, -26.1, 0);
  pipe(-30, -30.8, 24, -30.8, G - 0.6);
  pipe(-30, -31.2, 24, -31.2, G - 0.9, 0.07);

  // storage
  for (let i = 0; i < 4; i++) shelf(-27 + i * 0.0, -35 - i * 3.2, 0, 5.0);
  crate(-19, 0, -34); crate(-19, 0.9, -34); crate(-20.4, 0, -35.4, 1.2);
  crate(-24, 0, -46); crate(-22.4, 0, -45.6, 0.9);
  strip(-23, -36); strip(-23, -44);

  // medical
  for (const z of [-35, -39, -43]) {
    box('steel', 0.9, 0.6, 2.0, -11, 0.55, z);
    box('panel', 0.86, 0.12, 1.9, -11, 0.92, z, false);
  }
  locker(-3.4, -35, Math.PI / 2, 2);
  desk(-6, -44, 0); monitor(-6, 0.78, -44, 0);
  strip(-8, -38); strip(-8, -44);
  anchors.medicalLog = new THREE.Vector3(-6, 0.85, -43.4);

  // server room
  for (let i = 0; i < 5; i++) rack(2.5 + i * 1.6, -36, 0);
  for (let i = 0; i < 5; i++) rack(2.5 + i * 1.6, -42, Math.PI);
  strip(6, -39, G - 0.35, 3.2);
  pipe(1, -44.5, 11, -44.5, 3.4, 0.09);
  anchors.serverTerminal = new THREE.Vector3(6, 1.0, -39);

  // maintenance / generator
  box('rust', 3.2, 2.0, 1.8, 20, 1.0, -36);
  box('steel', 1.0, 1.2, 1.0, 22.4, 0.6, -36);
  pipe(16, -38, 25, -38, 2.6, 0.16);
  pipe(16, -38.6, 25, -38.6, 3.1, 0.12);
  shelf(24.6, -44, Math.PI / 2, 3.0);
  lamp('hazard', 0.4, 0.1, 0.1, 20, 2.2, -35);
  anchors.generator = new THREE.Vector3(20, 1.2, -34.6);

  // rear corridor + loading bay
  for (let i = 0; i < 8; i++) strip(-26 + i * 7, -49, G - 0.35, 2.6);
  crate(6, 0, -54); crate(6, 0.9, -54); crate(7.6, 0, -55.2, 1.1);
  crate(20, 0, -57, 1.3); crate(22.2, 0, -56, 1.0);
  shelf(28.6, -55, Math.PI / 2, 4.0);
  vehicle(14, -56, 0.02, 6.0);
  strip(16, -58, G - 0.35, 3.4);
  anchors.extraction = new THREE.Vector3(18, 0, -60);

  // basement corridor
  for (let i = 0; i < 7; i++) strip(0, -26 - i * 3.2, BASE_Y + BH - 0.3, 1.8);
  pipe(-5, -47, -5, -24, BASE_Y + BH - 0.5, 0.13);
  pipe(5, -47, 5, -24, BASE_Y + BH - 0.5, 0.13);
  sign(0, BASE_Y + 2.6, -24.2, 0, 'hazard');

  // laboratory: deliberately wrecked
  for (let i = 0; i < 6; i++) {
    const x = -23 + (i % 3) * 5.5, z = -31 - Math.floor(i / 3) * 6;
    box('steel', 2.6, 0.9, 1.0, x, 0.45 + BASE_Y, z);
    if (i % 2 === 0) monitor(x, BASE_Y + 0.95, z, 0.7, false);
  }
  shelf(-25.4, -40, Math.PI / 2, 4.0, BASE_Y);
  crate(-10, BASE_Y, -44, 0.9);
  strip(-16, -32, BASE_Y + BH - 0.3, 2.4); strip(-16, -42, BASE_Y + BH - 0.3, 2.4);
  anchors.labTerminal = new THREE.Vector3(-17.5, BASE_Y + 1.0, -30.5);
  anchors.labDoor = new THREE.Vector3(-6, BASE_Y, -36);

  // armory
  for (let i = 0; i < 4; i++) locker(10 + i * 1.3, -30, 0, 1);
  shelf(22.6, -36, Math.PI / 2, 4.0, BASE_Y);
  crate(16, BASE_Y, -42); crate(17.4, BASE_Y, -41.4, 0.85);
  strip(16, -36, BASE_Y + BH - 0.3, 2.6);
  anchors.armoryCache = new THREE.Vector3(12, BASE_Y + 0.9, -31);

  // scattered debris through the whole building
  const rnd = (() => { let s = 4242; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
  for (let i = 0; i < 90; i++) {
    const x = -30 + rnd() * 60, z = -60 + rnd() * 58;
    const y = (z > -47 && z < -23 && x > -28 && x < 26 && rnd() < 0.35) ? BASE_Y : 0;
    buckets.rust.push(put(new THREE.BoxGeometry(0.2 + rnd() * 0.4, 0.06 + rnd() * 0.1, 0.2 + rnd() * 0.4),
      x, y + 0.04, z, rnd() * 3));
  }

  // ---------------------------------------------------------------- merge

  const statics = [];
  const addMerged = (geos, mat) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m); statics.push(m);
  };
  addMerged(buckets.floor, mats.concreteFloor);
  addMerged(buckets.ceil, mats.concreteFloor);
  addMerged(buckets.panel, mats.panel);
  addMerged(buckets.steel, mats.steel);
  addMerged(buckets.rust, mats.rust);
  addMerged(buckets.crate, mats.crate);

  const glowMesh = {};
  const addGlow = (geos, hex, key) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos, false),
      new THREE.MeshBasicMaterial({ color: hex, fog: true }));
    scene.add(m); glowMesh[key] = m;
  };
  addGlow(glow.warm, PAL.workLight, 'warm');
  addGlow(glow.cold, 0x63d8ff, 'cold');
  addGlow(glow.hazard, PAL.hazard, 'hazard');

  const spawn = { x: 0, z: 34, yaw: 0 };     // in the car park, facing the building

  return { colliders, voids, areas, anchors, statics, lights, glowMesh, spawn,
           BASE_Y, WALL_H };
}
