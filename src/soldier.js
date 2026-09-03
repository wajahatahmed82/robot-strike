import * as THREE from 'three';

// Procedural skinned soldier.
//
// The previous soldiers were rigid parts -- a cylinder for the thigh, another
// for the shin, a sphere wedged in between to hide the gap. That reads as a
// machine no matter how good the proportions are, because real limbs do not
// have a seam at the knee. Here the body is one continuous skinned mesh over a
// 19-bone skeleton, so joints stretch and fold instead of pivoting.
//
// Everything is still generated in code: no model files, no licence, nothing to
// download. Geometry is built once per loadout and shared; only the skeleton is
// per instance, because bones are scene-graph nodes.
//
// Skin weights are solved from the bind pose by distance to each bone segment,
// which gives soft shoulders and hips for free. Rigid kit (helmet, plates,
// pack) is pinned to a single bone instead, because a helmet should not bend.

// ---------------------------------------------------------------- skeleton

// Bind pose, feet on the ground at y=0. Order is the skin index order.
const BONES = [
  { name: 'hips',       parent: -1, pos: [0, 0.92, 0] },
  { name: 'spine',      parent: 0,  pos: [0, 1.06, 0] },
  { name: 'chest',      parent: 1,  pos: [0, 1.24, 0] },
  { name: 'neck',       parent: 2,  pos: [0, 1.46, 0] },
  { name: 'head',       parent: 3,  pos: [0, 1.56, 0] },

  { name: 'clavL',      parent: 2,  pos: [-0.06, 1.42, 0] },
  { name: 'upperArmL',  parent: 5,  pos: [-0.19, 1.42, 0] },
  { name: 'foreArmL',   parent: 6,  pos: [-0.19, 1.14, 0] },
  { name: 'handL',      parent: 7,  pos: [-0.19, 0.88, 0] },

  { name: 'clavR',      parent: 2,  pos: [0.06, 1.42, 0] },
  { name: 'upperArmR',  parent: 9,  pos: [0.19, 1.42, 0] },
  { name: 'foreArmR',   parent: 10, pos: [0.19, 1.14, 0] },
  { name: 'handR',      parent: 11, pos: [0.19, 0.88, 0] },

  { name: 'thighL',     parent: 0,  pos: [-0.115, 0.90, 0] },
  { name: 'shinL',      parent: 13, pos: [-0.112, 0.48, 0] },
  { name: 'footL',      parent: 14, pos: [-0.110, 0.08, 0] },

  { name: 'thighR',     parent: 0,  pos: [0.115, 0.90, 0] },
  { name: 'shinR',      parent: 16, pos: [0.112, 0.48, 0] },
  { name: 'footR',      parent: 17, pos: [0.110, 0.08, 0] },

  // The weapon is a bone rather than a child mesh. That folds the rifle into
  // the one skinned draw call instead of costing a second mesh per soldier in
  // both the colour and the shadow pass.
  { name: 'weapon',     parent: 2,  pos: [0.10, 1.21, 0.20] },
];

export const BONE = {};
BONES.forEach((b, i) => { BONE[b.name] = i; });

// Each bone's influence is a segment from itself to its first child, so the
// distance test is to a line rather than a point. Leaf bones get a stub.
const SKIN_BONES = BONES.length - 1;   // every bone except `weapon`
const SEGMENTS = BONES.map((b, i) => {
  const child = BONES.find((c) => c.parent === i);
  const a = b.pos;
  const bEnd = child ? child.pos : [a[0], a[1] - 0.10, a[2]];
  return { a, b: bEnd };
});

function distToSegment(px, py, pz, s) {
  const ax = s.a[0], ay = s.a[1], az = s.a[2];
  const bx = s.b[0], by = s.b[1], bz = s.b[2];
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz || 1e-6;
  let t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t, cy = ay + dy * t, cz = az + dz * t;
  return Math.hypot(px - cx, py - cy, pz - cz);
}

// ---------------------------------------------------------------- geometry

const SKIN_TONES = [
  [0.66, 0.49, 0.38], [0.55, 0.39, 0.29], [0.44, 0.30, 0.22],
  [0.72, 0.56, 0.45], [0.35, 0.24, 0.18],
];
const GLOVE = [0.12, 0.13, 0.12];
const BOOT = [0.09, 0.09, 0.10];
const GUN = [0.13, 0.14, 0.15];
const EYE = [0.06, 0.06, 0.07];

// A vertical lofted column: rings of (y, radiusX, radiusZ) around (cx, cz).
// Limbs need several rings along their length or a bent elbow creases instead
// of curving, which is the whole point of skinning them.
function column(cx, cz, rings, rgb, radial = 10) {
  const pos = [], col = [], idx = [];
  const rows = rings.length;
  for (let r = 0; r < rows; r++) {
    const ring = rings[r];
    for (let s = 0; s <= radial; s++) {
      const a = (s / radial) * Math.PI * 2;
      pos.push(cx + Math.cos(a) * ring.rx, ring.y, cz + Math.sin(a) * ring.rz);
      col.push(rgb[0], rgb[1], rgb[2]);
    }
  }
  const perRow = radial + 1;
  for (let r = 0; r < rows - 1; r++) {
    for (let s = 0; s < radial; s++) {
      const i0 = r * perRow + s, i1 = i0 + 1;
      const i2 = i0 + perRow, i3 = i2 + 1;
      idx.push(i0, i2, i1, i1, i2, i3);
    }
  }
  // caps, so a limb is a closed solid and never shows its hollow inside
  const capTop = pos.length / 3;
  pos.push(cx, rings[rows - 1].y, cz); col.push(rgb[0], rgb[1], rgb[2]);
  for (let s = 0; s < radial; s++) {
    idx.push(capTop, (rows - 1) * perRow + s, (rows - 1) * perRow + s + 1);
  }
  const capBot = pos.length / 3;
  pos.push(cx, rings[0].y, cz); col.push(rgb[0], rgb[1], rgb[2]);
  for (let s = 0; s < radial; s++) idx.push(capBot, s + 1, s);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const OBJ = new THREE.Object3D();
function boxAt(w, h, d, rgb, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  OBJ.position.set(x, y, z);
  OBJ.rotation.set(rx, ry, rz);
  OBJ.scale.set(1, 1, 1);
  OBJ.updateMatrix();
  g.applyMatrix4(OBJ.matrix);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function sphereAt(r, rgb, x, y, z, sy = 1, sz = 1) {
  const g = new THREE.SphereGeometry(r, 9, 7);
  g.scale(1, sy, sz);
  g.translate(x, y, z);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Solve skin weights for one piece. `pin` forces every vertex onto one bone,
// which is what rigid kit wants.
function skin(geo, pin) {
  const p = geo.attributes.position;
  const n = p.count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);

  for (let i = 0; i < n; i++) {
    if (pin !== undefined) {
      si[i * 4] = pin; sw[i * 4] = 1;
      continue;
    }
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let b0 = 0, d0 = Infinity, b1 = 0, d1 = Infinity;
    for (let b = 0; b < SKIN_BONES; b++) {
      const d = distToSegment(x, y, z, SEGMENTS[b]);
      if (d < d0) { d1 = d0; b1 = b0; d0 = d; b0 = b; }
      else if (d < d1) { d1 = d; b1 = b; }
    }
    // Cubic falloff keeps the blend tight: a thigh vertex should not be half
    // driven by the opposite thigh just because both are near the crotch.
    const w0 = 1 / Math.pow(d0 + 0.02, 3);
    const w1 = 1 / Math.pow(d1 + 0.02, 3);
    const t = w0 + w1;
    si[i * 4] = b0; sw[i * 4] = w0 / t;
    si[i * 4 + 1] = b1; sw[i * 4 + 1] = w1 / t;
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  return geo;
}

// Merge without the addon: every piece here carries the same attribute set.
function mergeAll(list) {
  let vTotal = 0, iTotal = 0;
  for (const g of list) { vTotal += g.attributes.position.count; iTotal += g.index.count; }
  const pos = new Float32Array(vTotal * 3);
  const nor = new Float32Array(vTotal * 3);
  const col = new Float32Array(vTotal * 3);
  const si = new Uint16Array(vTotal * 4);
  const sw = new Float32Array(vTotal * 4);
  const idx = new Uint32Array(iTotal);
  let vo = 0, io = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, c * 3), vo * 3);
    nor.set(g.attributes.normal.array.subarray(0, c * 3), vo * 3);
    col.set(g.attributes.color.array.subarray(0, c * 3), vo * 3);
    si.set(g.attributes.skinIndex.array.subarray(0, c * 4), vo * 4);
    sw.set(g.attributes.skinWeight.array.subarray(0, c * 4), vo * 4);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += c; io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  // A posed skeleton moves vertices outside the bind-pose bounds, so the sphere
  // is widened by hand rather than turning culling off. Disabling culling meant
  // every soldier behind the camera still drew, in both passes.
  out.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.35);
  out.computeBoundingBox();
  return out;
}

// ---------------------------------------------------------------- loadouts

export const KIT = {
  scout:   { uniform: [0.40, 0.44, 0.34], vest: [0.22, 0.24, 0.19], bulk: 0.93,
             helmet: false, pack: false, name: 'RECON' },
  assault: { uniform: [0.34, 0.37, 0.30], vest: [0.17, 0.19, 0.16], bulk: 1.0,
             helmet: true,  pack: true,  name: 'RIFLEMAN' },
  heavy:   { uniform: [0.30, 0.30, 0.26], vest: [0.14, 0.15, 0.13], bulk: 1.20,
             helmet: true,  pack: true,  name: 'GUNNER' },
  sniper:  { uniform: [0.31, 0.34, 0.27], vest: [0.19, 0.21, 0.17], bulk: 0.95,
             helmet: false, pack: true,  name: 'MARKSMAN' },
  elite:   { uniform: [0.19, 0.20, 0.22], vest: [0.11, 0.12, 0.14], bulk: 1.03,
             helmet: true,  pack: false, name: 'OPERATOR' },
};

const GEO_CACHE = {};

function buildGeometry(type) {
  if (GEO_CACHE[type]) return GEO_CACHE[type];
  const k = KIT[type] || KIT.assault;
  const U = k.uniform, V = k.vest, w = k.bulk;
  const parts = [];

  // ---- torso: one continuous loft from hips to shoulders ----
  parts.push(skin(column(0, 0, [
    { y: 0.87, rx: 0.166 * w, rz: 0.126 * w },
    { y: 0.97, rx: 0.174 * w, rz: 0.130 * w },
    { y: 1.08, rx: 0.163 * w, rz: 0.120 * w },   // waist
    { y: 1.18, rx: 0.186 * w, rz: 0.132 * w },
    { y: 1.30, rx: 0.215 * w, rz: 0.146 * w },
    { y: 1.41, rx: 0.222 * w, rz: 0.148 * w },   // chest
    { y: 1.47, rx: 0.196 * w, rz: 0.132 * w },
  ], U, 10)));

  // shoulders: mass over the deltoid so the arm does not look socketed on
  parts.push(skin(sphereAt(0.104 * w, U, -0.180 * w, 1.412, 0, 0.92, 0.92)));
  parts.push(skin(sphereAt(0.104 * w, U, 0.180 * w, 1.412, 0, 0.92, 0.92)));

  // ---- neck and head ----
  parts.push(skin(column(0, 0, [
    { y: 1.43, rx: 0.064, rz: 0.060 },
    { y: 1.51, rx: 0.058, rz: 0.055 },
  ], SKIN_TONES[0], 8)));

  // skull: narrower at the jaw, widest at the cranium, flattened front to back
  parts.push(skin(column(0, 0, [
    { y: 1.497, rx: 0.066, rz: 0.066 },
    { y: 1.530, rx: 0.085, rz: 0.087 },   // jaw
    { y: 1.572, rx: 0.097, rz: 0.101 },   // cheekbones
    { y: 1.618, rx: 0.099, rz: 0.104 },   // cranium
    { y: 1.662, rx: 0.083, rz: 0.087 },
    { y: 1.692, rx: 0.044, rz: 0.046 },
  ], SKIN_TONES[0], 10), BONE.head));

  // face: brow, nose, ears. Small, but a blank sphere reads as a mannequin.
  parts.push(skin(boxAt(0.115, 0.022, 0.030, SKIN_TONES[0], 0, 1.606, 0.082), BONE.head));
  parts.push(skin(boxAt(0.026, 0.048, 0.036, SKIN_TONES[0], 0, 1.578, 0.086), BONE.head));
  parts.push(skin(sphereAt(0.016, EYE, -0.034, 1.594, 0.076, 0.8, 0.6), BONE.head));
  parts.push(skin(sphereAt(0.016, EYE, 0.034, 1.594, 0.076, 0.8, 0.6), BONE.head));
  parts.push(skin(sphereAt(0.020, SKIN_TONES[0], -0.089, 1.588, 0, 1.3, 0.5), BONE.head));
  parts.push(skin(sphereAt(0.020, SKIN_TONES[0], 0.089, 1.588, 0, 1.3, 0.5), BONE.head));

  // ---- arms: shoulder to wrist in one loft each ----
  for (const side of [-1, 1]) {
    const x = side * 0.19;
    parts.push(skin(column(x, 0, [
      { y: 0.90, rx: 0.048, rz: 0.048 },      // wrist
      { y: 1.02, rx: 0.056, rz: 0.056 },
      { y: 1.14, rx: 0.062, rz: 0.062 },      // elbow
      { y: 1.26, rx: 0.073 * w, rz: 0.073 * w },
      { y: 1.38, rx: 0.083 * w, rz: 0.083 * w },
      { y: 1.43, rx: 0.086 * w, rz: 0.086 * w },
    ], U, 7)));
    // hand
    parts.push(skin(boxAt(0.055, 0.10, 0.078, GLOVE, x, 0.845, 0.006),
      side < 0 ? BONE.handL : BONE.handR));
    parts.push(skin(boxAt(0.048, 0.055, 0.05, GLOVE, x, 0.80, 0.03),
      side < 0 ? BONE.handL : BONE.handR));
  }

  // ---- legs: hip to ankle in one loft each ----
  for (const side of [-1, 1]) {
    const x = side * 0.115;
    // Thigh radius has to stay under the half-stance or the two legs meet at
    // the crotch and the silhouette reads as a skirt instead of a pair of legs.
    parts.push(skin(column(x, 0, [
      { y: 0.06, rx: 0.056, rz: 0.060 },      // ankle
      { y: 0.22, rx: 0.066, rz: 0.071 },
      { y: 0.38, rx: 0.080, rz: 0.084 },      // calf
      { y: 0.50, rx: 0.074, rz: 0.077 },      // knee
      { y: 0.66, rx: 0.090 * w, rz: 0.094 * w },
      { y: 0.82, rx: 0.100 * w, rz: 0.104 * w },
      { y: 0.90, rx: 0.104 * w, rz: 0.106 * w },
    ], U, 7)));
    const foot = side < 0 ? BONE.footL : BONE.footR;
    parts.push(skin(boxAt(0.112, 0.080, 0.140, BOOT, x, 0.048, 0.012), foot));
    parts.push(skin(boxAt(0.120, 0.058, 0.265, BOOT, x, 0.030, 0.062), foot));
  }

  // ---- kit: pinned rigid, because a plate carrier does not flex ----
  parts.push(skin(boxAt(0.38 * w, 0.31, 0.235, V, 0, 1.30, 0.004), BONE.chest));
  parts.push(skin(boxAt(0.125, 0.095, 0.07, V, -0.10 * w, 1.175, 0.135), BONE.spine));
  parts.push(skin(boxAt(0.125, 0.095, 0.07, V, 0.045 * w, 1.175, 0.135), BONE.spine));
  parts.push(skin(boxAt(0.10, 0.085, 0.07, V, 0.16 * w, 1.16, 0.11), BONE.spine));
  parts.push(skin(boxAt(0.30, 0.10, 0.10, V, 0, 0.95, 0), BONE.hips));      // belt
  if (k.pack) parts.push(skin(boxAt(0.27 * w, 0.32, 0.135, V, 0, 1.29, -0.185), BONE.chest));
  if (type === 'heavy') {
    parts.push(skin(boxAt(0.44, 0.19, 0.14, V, 0, 1.50, -0.17), BONE.chest));
    parts.push(skin(sphereAt(0.085, V, -0.235, 1.415, 0), BONE.chest));
    parts.push(skin(sphereAt(0.085, V, 0.235, 1.415, 0), BONE.chest));
  }

  // ---- headgear ----
  if (type === 'elite') {
    parts.push(skin(boxAt(0.175, 0.115, 0.055, [0.10, 0.10, 0.11], 0, 1.575, 0.070), BONE.head));
    parts.push(skin(boxAt(0.195, 0.048, 0.045, [0.05, 0.06, 0.07], 0, 1.606, 0.078), BONE.head));
  }
  if (k.helmet) {
    parts.push(skin(sphereAt(0.127, V, 0, 1.626, 0, 0.92, 1.02), BONE.head));
    parts.push(skin(boxAt(0.215, 0.032, 0.09, V, 0, 1.632, 0.078), BONE.head));
    parts.push(skin(boxAt(0.05, 0.045, 0.055, V, 0.104, 1.622, 0.015), BONE.head));
  } else {
    parts.push(skin(column(0, 0, [
      { y: 1.660, rx: 0.093, rz: 0.098 },
      { y: 1.700, rx: 0.090, rz: 0.095 },
    ], U, 10), BONE.head));
    parts.push(skin(boxAt(0.175, 0.018, 0.085, U, 0, 1.668, 0.082), BONE.head));
  }

  parts.push(skin(buildGun(type), BONE.weapon));

  GEO_CACHE[type] = mergeAll(parts);
  return GEO_CACHE[type];
}

// The carried weapon stays a rigid mesh parented to the right hand bone.
const GUN_CACHE = {};
export function gunLength(type) {
  return type === 'heavy' ? 0.46 : type === 'sniper' ? 0.54 : type === 'scout' ? 0.26 : 0.34;
}
function buildGun(type) {
  if (GUN_CACHE[type]) return GUN_CACHE[type];
  const len = gunLength(type);
  const GX = 0.10, GY = 1.21, GZ = 0.20;   // the weapon bone, in character space
  const g = [
    boxAt(0.052, 0.058, len, GUN, GX, GY, GZ),
    boxAt(0.020, 0.020, len * 0.72, GUN, GX, GY + 0.012, GZ + len * 0.80),
    boxAt(0.034, 0.10, 0.07, GUN, GX, GY - 0.075, GZ - 0.02),
    boxAt(0.044, 0.05, 0.11, GUN, GX, GY - 0.005, GZ - len * 0.56),
    boxAt(0.022, 0.03, 0.05, GUN, GX, GY + 0.045, GZ + 0.02),
  ];
  if (type === 'heavy') g.push(boxAt(0.09, 0.11, 0.16, GUN, GX, GY - 0.085, GZ + 0.04));
  if (type === 'sniper') {
    g.push(boxAt(0.05, 0.05, 0.20, GUN, GX, GY + 0.058, GZ + 0.04));
    g.push(boxAt(0.02, 0.10, 0.02, GUN, GX, GY - 0.06, GZ + 0.34));
  }
  let v = 0, i = 0;
  for (const x of g) { v += x.attributes.position.count; i += x.index.count; }
  const pos = new Float32Array(v * 3), nor = new Float32Array(v * 3), col = new Float32Array(v * 3);
  const idx = new Uint32Array(i);
  let vo = 0, io = 0;
  for (const x of g) {
    const c = x.attributes.position.count;
    pos.set(x.attributes.position.array.subarray(0, c * 3), vo * 3);
    nor.set(x.attributes.normal.array.subarray(0, c * 3), vo * 3);
    col.set(x.attributes.color.array.subarray(0, c * 3), vo * 3);
    const gi = x.index.array;
    for (let n = 0; n < gi.length; n++) idx[io + n] = gi[n] + vo;
    vo += c; io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeVertexNormals();
  GUN_CACHE[type] = out;
  return out;
}


// ------------------------------------------------------------ arm placement
//
// Hand position is solved, not authored. Hand-tuned joint angles have to be
// redone for every weapon length and still leave the hands floating beside the
// gun; a two-bone solve puts the wrist exactly on the grip and the handguard
// whatever the rifle measures.
//
// The solve runs in chest-bone space. The weapon mount is parented to the chest
// too, so the answer stays correct however the torso twists, leans or recoils,
// and only has to be computed once per loadout.

const L_UPPER = 0.28;
const L_FORE = 0.26;
const SHOULDER = { L: new THREE.Vector3(-0.19, 0.18, 0), R: new THREE.Vector3(0.19, 0.18, 0) };
const BIND_DOWN = new THREE.Vector3(0, -1, 0);

// Where the weapon sits on the chest, low ready and shouldered.
export const MOUNT_LOW = new THREE.Vector3(0.10, -0.03, 0.20);
export const MOUNT_AIM = new THREE.Vector3(0.035, 0.15, 0.22);
// same two positions, as the weapon bone's local offset from the chest
const WEAPON_LOW = MOUNT_LOW.clone();
const WEAPON_AIM = MOUNT_AIM.clone();

function solveArm(shoulder, target, pole) {
  const d = new THREE.Vector3().subVectors(target, shoulder);
  let dist = d.length();
  const max = (L_UPPER + L_FORE) * 0.995;
  if (dist > max) { d.multiplyScalar(max / dist); dist = max; }
  if (dist < 0.05) { d.set(0, -0.05, 0); dist = 0.05; }
  const u = d.clone().normalize();

  const cosA = THREE.MathUtils.clamp(
    (L_UPPER * L_UPPER + dist * dist - L_FORE * L_FORE) / (2 * L_UPPER * dist), -1, 1);
  const A = Math.acos(cosA);

  // elbow sits off the shoulder-to-hand line, pushed toward the pole
  const perp = pole.clone().addScaledVector(u, -pole.dot(u));
  if (perp.lengthSq() < 1e-6) perp.set(0, 0, -1);
  perp.normalize();
  const elbow = shoulder.clone()
    .addScaledVector(u, Math.cos(A) * L_UPPER)
    .addScaledVector(perp, Math.sin(A) * L_UPPER);

  const qUpper = new THREE.Quaternion().setFromUnitVectors(
    BIND_DOWN, new THREE.Vector3().subVectors(elbow, shoulder).normalize());
  const qForeWorld = new THREE.Quaternion().setFromUnitVectors(
    BIND_DOWN, new THREE.Vector3().subVectors(target, elbow).normalize());
  const qFore = qUpper.clone().invert().multiply(qForeWorld);
  return { qUpper, qFore };
}

const ARM_CACHE = {};
function armPoses(type) {
  if (ARM_CACHE[type]) return ARM_CACHE[type];
  const len = gunLength(type);
  const poleL = new THREE.Vector3(-0.55, -0.55, -0.63).normalize();
  const poleR = new THREE.Vector3(0.62, -0.50, -0.60).normalize();
  const build = (mount) => {
    // right hand on the grip, left hand forward on the handguard
    const grip = mount.clone().add(new THREE.Vector3(0, -0.05, -0.02));
    // The support hand reaches forward but must stay off the end of its reach;
    // at 95% the elbow locks and the arm reads as a straight plank.
    const guard = mount.clone().add(
      new THREE.Vector3(-0.015, 0.005, Math.min(len * 0.42, 0.17)));
    return {
      R: solveArm(SHOULDER.R, grip, poleR),
      L: solveArm(SHOULDER.L, guard, poleL),
    };
  };
  ARM_CACHE[type] = { low: build(MOUNT_LOW), aim: build(MOUNT_AIM) };
  return ARM_CACHE[type];
}

const BASE_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.86, metalness: 0.04,
});

// Geometry is shared per loadout, so per-soldier variety has to come from the
// material. A small tint on top of the baked vertex colours is enough to stop a
// squad reading as five copies of one man; anything stronger and the loadout
// colours stop being recognisable.
function variantMaterial(rng) {
  const m = BASE_MAT.clone();
  m.color.setRGB(
    1 + (rng() - 0.5) * 0.13,
    1 + (rng() - 0.5) * 0.10,
    1 + (rng() - 0.5) * 0.11);
  m.roughness = 0.80 + rng() * 0.12;
  return m;
}

// ---------------------------------------------------------------- instance

// Builds the skeleton and the SkinnedMesh. Geometry and material are shared;
// only the 19 bones are per soldier.
export function createSoldier(type, rng) {
  const rand = rng || Math.random;
  const geo = buildGeometry(type);
  const mat = variantMaterial(rand);
  const bones = BONES.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    return bone;
  });
  BONES.forEach((b, i) => {
    if (b.parent < 0) {
      bones[i].position.set(b.pos[0], b.pos[1], b.pos[2]);
    } else {
      const p = BONES[b.parent].pos;
      bones[i].position.set(b.pos[0] - p[0], b.pos[1] - p[1], b.pos[2] - p[2]);
      bones[b.parent].add(bones[i]);
    }
  });

  const skeleton = new THREE.Skeleton(bones);
  // Three re-uploads the bone texture for every skinned mesh every frame. A
  // soldier whose pose did not change this frame does not need that, and at 40
  // enemies the uploads are a measurable slice of the frame.
  const realUpdate = skeleton.update.bind(skeleton);
  skeleton.needsPose = true;
  skeleton.update = function () {
    if (!this.needsPose) return;
    this.needsPose = false;
    realUpdate();
  };
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.castShadow = true;
  mesh.frustumCulled = true;    // the geometry carries a widened bounding sphere
  mesh.add(bones[0]);
  mesh.bind(skeleton);

  // The weapon rides its own bone off the chest, so arm tweaks never re-aim the
  // muzzle and the rifle costs no extra draw call.
  const mount = bones[BONE.weapon];

  // build variation: no two soldiers exactly the same height
  const build = 0.96 + rand() * 0.09;
  return { mesh, bones, skeleton, mount, build,
           arms: armPoses(type), gunLen: gunLength(type) };
}

// ---------------------------------------------------------------- animation

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3(1, 0, 0);

// Additive pitch on a bone already driven by a quaternion.
function addPitch(bone, radians) {
  if (!radians) return;
  _q.setFromAxisAngle(_axis, radians);
  bone.quaternion.multiply(_q);
}

// Blend a quaternion-driven bone toward an euler target.
function slerpTo(bone, x, y, z, w) {
  _e.set(x * w, y * w, z * w);
  _q.setFromEuler(_e);
  bone.quaternion.slerp(_q, w);
}

// Blend helper: move a bone toward a target euler by weight.
function setB(bone, x, y, z, w) {
  if (w >= 1) { bone.rotation.set(x, y, z); return; }
  bone.rotation.x += (x - bone.rotation.x) * w;
  bone.rotation.y += (y - bone.rotation.y) * w;
  bone.rotation.z += (z - bone.rotation.z) * w;
}

// One pose function, blended from weights, instead of switching between
// separate clips. Weights sum however they like; later terms layer on top.
//
// p = { phase, walk, run, aim, fire, hit, death, breathe }
export function poseSoldier(bones, p) {
  const B = bones;
  const s = Math.sin(p.phase);
  const c = Math.cos(p.phase);
  const walk = p.walk;                 // 0..1 stride amount
  const dead = p.death;                // 0..1

  // ---- base stance: weight settled, slight forward lean ----
  const breathe = Math.sin(p.breathe) * 0.012;
  setB(B[BONE.hips], -0.02 + Math.abs(s) * 0.03 * walk, 0, s * 0.05 * walk, 1);
  B[BONE.hips].position.y = 0.92 - Math.abs(s) * 0.028 * walk;
  setB(B[BONE.spine], 0.05 + breathe, s * 0.06 * walk, 0, 1);
  setB(B[BONE.chest], 0.04 - breathe, -s * 0.10 * walk, 0, 1);
  setB(B[BONE.neck], -0.06, 0, 0, 1);
  setB(B[BONE.head], -0.03 + Math.abs(s) * 0.02 * walk, 0, 0, 1);

  // ---- legs: thigh swings, shin trails, foot rolls ----
  const swing = 0.62 * walk;
  const lift = 0.85 * walk;
  const lS = s, rS = -s;
  setB(B[BONE.thighL], lS * swing - 0.04, 0, 0.03, 1);
  setB(B[BONE.thighR], rS * swing - 0.04, 0, -0.03, 1);
  // A shin only ever bends one way. Clamping at 0 is what stops the knee
  // inverting, which is the single most machine-like thing a leg can do.
  setB(B[BONE.shinL], Math.max(0, -lS + 0.25) * lift, 0, 0, 1);
  setB(B[BONE.shinR], Math.max(0, -rS + 0.25) * lift, 0, 0, 1);
  setB(B[BONE.footL], (-lS * 0.30 + 0.10) * walk, 0, 0, 1);
  setB(B[BONE.footR], (-rS * 0.30 + 0.10) * walk, 0, 0, 1);

  // ---- arms: weapon carry, tightening as the soldier aims ----
  const aim = p.aim;
  // low ready -> shouldered
  // The weapon bone rises toward the eye line as the soldier commits.
  B[BONE.weapon].position.lerpVectors(WEAPON_LOW, WEAPON_AIM, aim);

  // Solved arms: slerp between the low-ready and shouldered solutions. The
  // clavicles stay put because the IK already assumes a fixed shoulder.
  const A = p.arms;
  setB(B[BONE.clavL], 0, 0, 0.05, 1);
  setB(B[BONE.clavR], 0, 0, -0.05, 1);
  B[BONE.upperArmL].quaternion.copy(A.low.L.qUpper).slerp(A.aim.L.qUpper, aim);
  B[BONE.foreArmL].quaternion.copy(A.low.L.qFore).slerp(A.aim.L.qFore, aim);
  B[BONE.upperArmR].quaternion.copy(A.low.R.qUpper).slerp(A.aim.R.qUpper, aim);
  B[BONE.foreArmR].quaternion.copy(A.low.R.qFore).slerp(A.aim.R.qFore, aim);
  setB(B[BONE.handL], 0.1, 0, 0, 1);
  setB(B[BONE.handR], 0.05, 0, 0, 1);
  // arms counter-swing a little even while carrying
  addPitch(B[BONE.upperArmL], -s * 0.09 * walk);
  addPitch(B[BONE.upperArmR], s * 0.09 * walk);

  // ---- recoil: additive kick that decays, not a separate clip ----
  if (p.fire > 0) {
    const f = p.fire;
    addPitch(B[BONE.upperArmR], 0.16 * f);
    addPitch(B[BONE.foreArmR], -0.10 * f);
    addPitch(B[BONE.upperArmL], 0.10 * f);
    B[BONE.chest].rotation.x -= 0.06 * f;
    B[BONE.head].rotation.x -= 0.05 * f;
  }

  // ---- flinch on damage ----
  if (p.hit > 0) {
    const h = p.hit;
    B[BONE.chest].rotation.x += 0.22 * h;
    B[BONE.head].rotation.x += 0.18 * h;
    B[BONE.spine].rotation.z += 0.10 * h * (p.hitSide || 1);
  }

  // ---- death: fold and collapse, driven through the same bones ----
  if (dead > 0) {
    const d = dead;
    const spin = p.deathSpin || 1;
    setB(B[BONE.hips], -0.02, 0, 0.30 * d * spin, d);
    B[BONE.hips].position.y = THREE.MathUtils.lerp(B[BONE.hips].position.y, 0.30, d);
    setB(B[BONE.spine], 0.75 * d, 0, 0.20 * d * spin, d);
    setB(B[BONE.chest], 0.55 * d, 0, 0.15 * d * spin, d);
    setB(B[BONE.neck], 0.45 * d, 0, 0, d);
    setB(B[BONE.head], 0.35 * d, 0.2 * d * spin, 0, d);
    setB(B[BONE.thighL], -1.05 * d, 0, 0.15 * d, d);
    setB(B[BONE.thighR], -0.80 * d, 0, -0.10 * d, d);
    setB(B[BONE.shinL], 1.25 * d, 0, 0, d);
    setB(B[BONE.shinR], 1.55 * d, 0, 0, d);
    slerpTo(B[BONE.upperArmL], -0.35, -0.2, 0.9, d);
    slerpTo(B[BONE.foreArmL], -0.45, 0, 0, d);
    slerpTo(B[BONE.upperArmR], -0.25, 0.2, -0.8, d);
    slerpTo(B[BONE.foreArmR], -0.35, 0, 0, d);
  }
}

export { _e };
