import * as THREE from 'three';

// Procedural PBR-ish textures. Flat colour is what makes untextured 3D read as
// "fake" far more than polygon count does, so every surface gets an albedo, a
// roughness map and a normal map derived from one shared height field.
//
// Everything is generated once at boot into small canvases. No image files, no
// download cost, nothing to license.

function hash2(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, oct = 4) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * valueNoise(x * freq, y * freq);
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

function makeSet(size, heightFn, colorFn, roughFn, opts = {}) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) h[y * size + x] = heightFn(x / size, y / size);

  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  const alb = mk(), rgh = mk(), nrm = mk();
  const ai = alb.getContext('2d').createImageData(size, size);
  const ri = rgh.getContext('2d').createImageData(size, size);
  const ni = nrm.getContext('2d').createImageData(size, size);

  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  const strength = opts.normalStrength ?? 2.2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const v = h[y * size + x];
      const c = colorFn(v, x / size, y / size);
      ai.data[i] = c[0]; ai.data[i + 1] = c[1]; ai.data[i + 2] = c[2]; ai.data[i + 3] = 255;
      const rv = Math.round(THREE.MathUtils.clamp(roughFn(v, x / size, y / size), 0, 1) * 255);
      ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = rv; ri.data[i + 3] = 255;
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      ni.data[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      ni.data[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      ni.data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      ni.data[i + 3] = 255;
    }
  }
  alb.getContext('2d').putImageData(ai, 0, 0);
  rgh.getContext('2d').putImageData(ri, 0, 0);
  nrm.getContext('2d').putImageData(ni, 0, 0);

  const tex = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: tex(alb, true), roughnessMap: tex(rgh, false), normalMap: tex(nrm, false) };
}

const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

let cache = null;

// Palette rule for this file: keep blue OUT of the albedo.
//
// The old surfaces were all blue-grey ([76,80,86] and friends, blue > red by
// 10-14 points before any lighting). Compounded by a blue sky used as the
// environment map and a blue hemisphere light, every measured wall pixel came
// out with blue exceeding red by 41-46. Real concrete, plaster and asphalt are
// warm-neutral or slightly warm; the blue has to leave at the source, not be
// colour-corrected downstream.
//
// Weathering is baked into the same height field that drives roughness and
// normals, so dirt is rougher and sits in the low spots, as it does in life.

// Dirty blotches: large, soft, and sparse enough to read as grime rather than
// camouflage. Returns 0 (clean) to 1 (filthy).
function grime(u, v, scale = 3.5) {
  const g = fbm(u * scale, v * scale, 4);
  return Math.max(0, (g - 0.48) / 0.52);
}

// Vertical water streaking, the single most recognisable weathering cue on
// exterior concrete. Narrow in u, stretched in v.
function streak(u, v, n = 26) {
  const band = fbm(u * n, v * 1.2, 3);
  return Math.max(0, (band - 0.62) / 0.38) * Math.max(0, 1 - v * 0.75);
}

function crack(u, v, scale = 7) {
  const c = Math.abs(fbm(u * scale, v * scale, 4) - 0.5);
  return c < 0.021 ? 1 - c / 0.021 : 0;
}

export function buildMaterials() {
  if (cache) return cache;

  // ---- interior concrete floor: warm grey, expansion joints, traffic wear ----
  const floorSet = makeSet(256,
    (u, v) => {
      const joint = (Math.abs(((u * 4) % 1) - 0.5) < 0.016 || Math.abs(((v * 4) % 1) - 0.5) < 0.016) ? 0.0 : 1.0;
      return fbm(u * 9, v * 9, 5) * 0.52 + fbm(u * 36, v * 36, 3) * 0.24 + joint * 0.24 - crack(u, v, 9) * 0.3;
    },
    (h, u, v) => {
      const base = mix([118, 114, 107], [171, 166, 157], h);
      return mix(base, [88, 84, 78], grime(u, v, 3.0) * 0.55);
    },
    (h, u, v) => 0.88 - h * 0.10 + grime(u, v, 3.0) * 0.08,
    { normalStrength: 2.4 });
  for (const t of Object.values(floorSet)) t.repeat.set(1, 1);

  // ---- exterior asphalt: aggregate, patches, oil ----
  const asphaltSet = makeSet(256,
    (u, v) => fbm(u * 90, v * 90, 3) * 0.62 + fbm(u * 18, v * 18, 3) * 0.38 - crack(u, v, 6) * 0.30,
    (h, u, v) => {
      const patch = fbm(u * 2.2 + 11, v * 2.2 + 7, 3);
      const base = mix([62, 62, 61], [104, 104, 102], h);
      const repaired = mix(base, [76, 76, 75], patch > 0.58 ? 0.6 : 0);
      // oil stains, dark and glossy
      const oil = Math.max(0, (fbm(u * 3.5 + 31, v * 3.5 + 19, 3) - 0.70) / 0.30);
      return mix(repaired, [38, 37, 36], oil * 0.85);
    },
    (h, u, v) => {
      const oil = Math.max(0, (fbm(u * 3.5 + 31, v * 3.5 + 19, 3) - 0.66) / 0.34);
      return 0.94 - h * 0.10 - oil * 0.45;
    },
    { normalStrength: 0.55 });
  for (const t of Object.values(asphaltSet)) t.repeat.set(1, 1);

  // ---- painted concrete, exterior: off-white industrial, dirt at the base ----
  const paintedSet = makeSet(256,
    (u, v) => fbm(u * 10, v * 10, 4) * 0.5 + fbm(u * 40, v * 40, 3) * 0.2
      + 0.3 - crack(u, v, 8) * 0.14,
    (h, u, v) => {
      const paint = mix([168, 164, 154], [214, 210, 199], h);
      const dirty = mix(paint, [126, 121, 111], grime(u, v, 3.2) * 0.6);
      const wet = mix(dirty, [96, 93, 86], streak(u, v, 30) * 0.5);
      // exposed patch where the paint has failed
      const bare = Math.max(0, (fbm(u * 4 + 53, v * 4 + 23, 3) - 0.70) / 0.30);
      return mix(wet, [132, 126, 116], bare * 0.8);
    },
    (h, u, v) => 0.72 + h * 0.16 + grime(u, v, 3.2) * 0.10,
    { normalStrength: 2.0 });

  // ---- brick: running bond, per-brick colour, mortar, weathering ----
  const COURSES = 12, PER_ROW = 4;
  const brickSet = makeSet(256,
    (u, v) => {
      const row = Math.floor(v * COURSES);
      const off = (row % 2) * 0.5;
      const bu = (u * PER_ROW + off) % 1;
      const bv = (v * COURSES) % 1;
      const mortar = (bu < 0.035 || bu > 0.965 || bv < 0.075 || bv > 0.925);
      const face = fbm(u * 50, v * 50, 3) * 0.35 + 0.55;
      return mortar ? 0.12 + fbm(u * 30, v * 30, 2) * 0.1 : face;
    },
    (h, u, v) => {
      const row = Math.floor(v * COURSES);
      const off = (row % 2) * 0.5;
      const col = Math.floor(u * PER_ROW + off);
      const bu = (u * PER_ROW + off) % 1;
      const bv = (v * COURSES) % 1;
      const mortar = (bu < 0.035 || bu > 0.965 || bv < 0.075 || bv > 0.925);
      if (mortar) return mix([150, 146, 138], [182, 178, 170], h * 3);
      // every brick a slightly different fired colour
      const j = hash2(col * 31 + 7, row * 17 + 3);
      const warm = mix([124, 84, 70], [156, 116, 98], j);
      const dark = mix(warm, [92, 64, 56], j > 0.80 ? 0.8 : 0);
      const pale = mix(warm, [162, 140, 124], j < 0.14 ? 0.7 : 0);
      const shaded = mix(j < 0.14 ? pale : dark, [176, 150, 132], h * 0.20);
      return mix(shaded, [96, 90, 84], grime(u, v, 2.4) * 0.55);
    },
    (h, u, v) => 0.82 + (1 - h) * 0.12 + grime(u, v, 2.6) * 0.06,
    { normalStrength: 3.4 });

  // ---- interior plaster: off-white, scuffed near the floor line ----
  const plasterSet = makeSet(256,
    (u, v) => fbm(u * 7, v * 7, 4) * 0.35 + fbm(u * 28, v * 28, 3) * 0.12 + 0.5,
    (h, u, v) => {
      const paint = mix([196, 192, 183], [226, 223, 214], h);
      const scuff = Math.max(0, (fbm(u * 5 + 13, v * 5 + 29, 3) - 0.62) / 0.38);
      const dirty = mix(paint, [150, 145, 136], scuff * 0.55);
      return mix(dirty, [120, 114, 104], grime(u, v, 2.2) * 0.30);
    },
    (h) => 0.86 - h * 0.10,
    { normalStrength: 1.1 });

  // ---- ceiling tile: fine grid, stained ----
  const ceilSet = makeSet(256,
    (u, v) => {
      const grid = (Math.abs(((u * 3) % 1) - 0.5) > 0.47 || Math.abs(((v * 3) % 1) - 0.5) > 0.47) ? 0.1 : 0.75;
      return grid + fbm(u * 26, v * 26, 3) * 0.22;
    },
    (h, u, v) => {
      const base = mix([168, 165, 158], [212, 209, 201], h);
      return mix(base, [138, 126, 104], grime(u, v, 2.4) * 0.5);
    },
    (h) => 0.92 - h * 0.06,
    { normalStrength: 1.3 });

  // ---- galvanised steel, neutral not blue ----
  const steelSet = makeSet(128,
    (u, v) => Math.sin(v * Math.PI * 70) * 0.06 + fbm(u * 16, v * 16, 4) * 0.94,
    (h, u, v) => mix(mix([104, 103, 101], [176, 175, 172], h), [92, 80, 66], grime(u, v, 3.0) * 0.35),
    (h) => 0.38 + h * 0.30,
    { normalStrength: 1.1 });
  for (const t of Object.values(steelSet)) t.repeat.set(3, 3);

  // ---- ribbed industrial panel, warm grey ----
  const panelSet = makeSet(160,
    (u, v) => {
      const rib = Math.abs(((u * 10) % 1) - 0.5) < 0.10 ? 1.0 : 0.35;
      return rib * 0.6 + fbm(u * 14, v * 14, 4) * 0.4;
    },
    (h, u, v) => mix(mix([120, 117, 111], [178, 174, 166], h), [96, 88, 76], grime(u, v, 2.8) * 0.45),
    (h) => 0.58 + h * 0.28,
    { normalStrength: 2.8 });

  // ---- faded painted metal: industrial green, chipped ----
  const paintMetalSet = makeSet(160,
    (u, v) => fbm(u * 18, v * 18, 4) * 0.6 + 0.4 - crack(u, v, 12) * 0.25,
    (h, u, v) => {
      const paint = mix([72, 88, 70], [110, 126, 100], h);
      const chip = Math.max(0, (fbm(u * 9 + 41, v * 9 + 17, 3) - 0.70) / 0.30);
      return mix(mix(paint, [126, 104, 74], chip * 0.85), [70, 64, 56], grime(u, v, 3.4) * 0.4);
    },
    (h, u, v) => 0.60 + h * 0.18 + grime(u, v, 3.4) * 0.15,
    { normalStrength: 1.6 });

  // ---- rust ----
  const rustSet = makeSet(160,
    (u, v) => fbm(u * 11, v * 11, 5) * 0.7 + fbm(u * 44, v * 44, 3) * 0.3,
    (h) => (h > 0.55
      ? mix([126, 72, 38], [176, 112, 62], (h - 0.55) / 0.45)
      : mix([66, 52, 44], [122, 74, 40], h / 0.55)),
    (h) => 0.80 + h * 0.18,
    { normalStrength: 2.2 });
  for (const t of Object.values(rustSet)) t.repeat.set(2, 2);

  // ---- polymer crate ----
  const crateSet = makeSet(128,
    (u, v) => {
      const edge = (u < 0.06 || u > 0.94 || v < 0.06 || v > 0.94) ? 0.2 : 0.8;
      return edge * 0.55 + fbm(u * 20, v * 20, 3) * 0.45;
    },
    (h, u, v) => mix(mix([92, 94, 72], [158, 160, 124], h), [84, 76, 60], grime(u, v, 3.0) * 0.4),
    (h) => 0.70 + h * 0.20,
    { normalStrength: 1.5 });

  // ---- glass: dark, dirty, reflective ----
  const glassSet = makeSet(128,
    (u, v) => fbm(u * 6, v * 6, 3) * 0.4 + 0.5,
    (h, u, v) => mix([40, 44, 46], [78, 84, 86], h * 0.6 + streak(u, v, 18) * 0.5),
    (h, u, v) => 0.10 + streak(u, v, 18) * 0.35 + grime(u, v, 2.0) * 0.2,
    { normalStrength: 0.5 });

  // ---- weapon polymer ----
  const polySet = makeSet(128,
    (u, v) => fbm(u * 42, v * 42, 3) * 0.8 + fbm(u * 110, v * 110, 2) * 0.2,
    (h) => mix([52, 53, 48], [86, 88, 79], h),
    (h) => 0.62 + h * 0.2,
    { normalStrength: 1.1 });
  for (const t of Object.values(polySet)) t.repeat.set(3, 3);

  // ---- gunmetal: near-black and neutral, or it reads as blue plastic ----
  const gunSet = makeSet(128,
    (u, v) => Math.sin(u * Math.PI * 90) * 0.08 + fbm(u * 30, v * 30, 3) * 0.92,
    (h) => mix([40, 39, 38], [80, 79, 77], h),
    (h) => 0.30 + h * 0.28,
    { normalStrength: 0.8 });
  for (const t of Object.values(gunSet)) t.repeat.set(2, 2);

  // ---- glove knit ----
  const gloveSet = makeSet(128,
    (u, v) => ((Math.sin(u * Math.PI * 60) + Math.sin(v * Math.PI * 60)) * 0.25 + 0.5) * 0.4
      + fbm(u * 20, v * 20, 3) * 0.6,
    (h) => mix([31, 30, 29], [59, 57, 54], h),
    () => 0.93,
    { normalStrength: 1.6 });

  // ---- uniform, three-tone, no real-world insignia ----
  const camoSet = makeSet(160,
    (u, v) => fbm(u * 8, v * 8, 4),
    (h) => (h < 0.42 ? [48, 50, 42] : h < 0.62 ? [68, 70, 56] : h < 0.80 ? [88, 84, 66] : [36, 36, 30]),
    () => 0.90,
    { normalStrength: 1.2 });

  const std = (set, extra) => new THREE.MeshStandardMaterial({ ...set, ...extra });

  cache = {
    // Painted/galvanised steel is mostly dielectric. High metalness takes all
    // its colour from the environment map and renders as a black slab.
    concreteFloor: std(floorSet, { roughness: 1, metalness: 0.02,
      normalScale: new THREE.Vector2(0.7, 0.7) }),
    asphalt: std(asphaltSet, { roughness: 1, metalness: 0.0 }),
    painted: std(paintedSet, { roughness: 0.82, metalness: 0.02 }),
    brick: std(brickSet, { roughness: 0.92, metalness: 0.0 }),
    plaster: std(plasterSet, { roughness: 0.90, metalness: 0.0 }),
    ceilingTile: std(ceilSet, { roughness: 0.94, metalness: 0.0 }),
    steel: std(steelSet, { roughness: 0.55, metalness: 0.25 }),
    panel: std(panelSet, { roughness: 0.68, metalness: 0.16 }),
    paintMetal: std(paintMetalSet, { roughness: 0.70, metalness: 0.10 }),
    rust: std(rustSet, { roughness: 0.94, metalness: 0.08 }),
    crate: std(crateSet, { roughness: 0.85, metalness: 0.03 }),
    glass: std(glassSet, { roughness: 0.18, metalness: 0.35 }),
    gunPoly: std(polySet, { roughness: 0.72, metalness: 0.08 }),
    gunMetal: std(gunSet, { roughness: 0.36, metalness: 0.55 }),
    glove: std(gloveSet, { roughness: 0.95, metalness: 0 }),
    camo: std(camoSet, { roughness: 0.92, metalness: 0 }),
  };
  return cache;
}
