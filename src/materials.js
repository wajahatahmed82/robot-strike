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

export function buildMaterials() {
  if (cache) return cache;

  // --- worn concrete floor with expansion joints ---
  const floorSet = makeSet(256,
    (u, v) => {
      const joint = (Math.abs(((u * 4) % 1) - 0.5) < 0.018 || Math.abs(((v * 4) % 1) - 0.5) < 0.018) ? 0.0 : 1.0;
      return fbm(u * 9, v * 9, 5) * 0.55 + fbm(u * 36, v * 36, 3) * 0.25 + joint * 0.20;
    },
    (h) => mix([76, 80, 86], [140, 146, 154], h),
    (h) => 0.90 - h * 0.10,
    { normalStrength: 2.6 });
  for (const t of Object.values(floorSet)) t.repeat.set(48, 48);

  // --- galvanised steel, faint brushed grain ---
  const steelSet = makeSet(128,
    (u, v) => Math.sin(v * Math.PI * 70) * 0.06 + fbm(u * 16, v * 16, 4) * 0.94,
    (h) => mix([96, 104, 114], [168, 176, 186], h),
    (h) => 0.34 + h * 0.30,
    { normalStrength: 1.1 });
  for (const t of Object.values(steelSet)) t.repeat.set(3, 3);

  // --- ribbed wall panel ---
  const panelSet = makeSet(160,
    (u, v) => {
      const rib = Math.abs(((u * 10) % 1) - 0.5) < 0.10 ? 1.0 : 0.35;
      return rib * 0.6 + fbm(u * 14, v * 14, 4) * 0.4;
    },
    (h) => mix([84, 92, 101], [150, 158, 168], h),
    (h) => 0.52 + h * 0.30,
    { normalStrength: 2.8 });
  for (const t of Object.values(panelSet)) t.repeat.set(6, 2);

  // --- rusted steel ---
  const rustSet = makeSet(160,
    (u, v) => fbm(u * 11, v * 11, 5) * 0.7 + fbm(u * 44, v * 44, 3) * 0.3,
    (h) => (h > 0.55
      ? mix([120, 66, 34], [168, 104, 58], (h - 0.55) / 0.45)
      : mix([62, 48, 42], [116, 68, 38], h / 0.55)),
    (h) => 0.78 + h * 0.18,
    { normalStrength: 2.2 });
  for (const t of Object.values(rustSet)) t.repeat.set(2, 2);

  // --- polymer crate ---
  const crateSet = makeSet(128,
    (u, v) => {
      const edge = (u < 0.06 || u > 0.94 || v < 0.06 || v > 0.94) ? 0.2 : 0.8;
      return edge * 0.55 + fbm(u * 20, v * 20, 3) * 0.45;
    },
    (h) => mix([84, 90, 68], [152, 160, 122], h),
    (h) => 0.70 + h * 0.20,
    { normalStrength: 1.5 });

  // --- weapon polymer ---
  const polySet = makeSet(128,
    (u, v) => fbm(u * 42, v * 42, 3) * 0.8 + fbm(u * 110, v * 110, 2) * 0.2,
    (h) => mix([50, 53, 47], [84, 88, 78], h),
    (h) => 0.62 + h * 0.2,
    { normalStrength: 1.1 });
  for (const t of Object.values(polySet)) t.repeat.set(3, 3);

  // --- gunmetal: near-black and neutral, or it reads as blue plastic ---
  const gunSet = makeSet(128,
    (u, v) => Math.sin(u * Math.PI * 90) * 0.08 + fbm(u * 30, v * 30, 3) * 0.92,
    (h) => mix([38, 39, 41], [78, 80, 83], h),
    (h) => 0.30 + h * 0.28,
    { normalStrength: 0.8 });
  for (const t of Object.values(gunSet)) t.repeat.set(2, 2);

  // --- glove knit ---
  const gloveSet = makeSet(128,
    (u, v) => ((Math.sin(u * Math.PI * 60) + Math.sin(v * Math.PI * 60)) * 0.25 + 0.5) * 0.4
      + fbm(u * 20, v * 20, 3) * 0.6,
    (h) => mix([30, 30, 33], [58, 57, 60], h),
    () => 0.93,
    { normalStrength: 1.6 });

  // --- uniform sleeve, three-tone, no real-world insignia ---
  const camoSet = makeSet(160,
    (u, v) => fbm(u * 8, v * 8, 4),
    (h) => (h < 0.42 ? [46, 50, 44] : h < 0.62 ? [66, 70, 58] : h < 0.80 ? [86, 84, 68] : [34, 36, 32]),
    () => 0.90,
    { normalStrength: 1.2 });

  const std = (set, extra) => new THREE.MeshStandardMaterial({ ...set, ...extra });

  cache = {
    concreteFloor: std(floorSet, { roughness: 1, metalness: 0.02,
      normalScale: new THREE.Vector2(0.7, 0.7) }),
    // Painted/galvanised steel is mostly dielectric. High metalness takes all
    // its colour from the environment map and renders as a black slab.
    steel: std(steelSet, { roughness: 0.55, metalness: 0.25 }),
    panel: std(panelSet, { roughness: 0.68, metalness: 0.18 }),
    rust: std(rustSet, { roughness: 0.94, metalness: 0.08 }),
    crate: std(crateSet, { roughness: 0.85, metalness: 0.03 }),
    gunPoly: std(polySet, { roughness: 0.72, metalness: 0.08 }),
    gunMetal: std(gunSet, { roughness: 0.36, metalness: 0.55 }),
    glove: std(gloveSet, { roughness: 0.95, metalness: 0 }),
    camo: std(camoSet, { roughness: 0.92, metalness: 0 }),
  };
  return cache;
}
