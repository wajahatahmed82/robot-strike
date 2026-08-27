const KEY = 'robotstrike.settings.v1';

export const DEFAULTS = {
  masterVol: 0.8,
  musicVol: 0.5,
  sfxVol: 0.9,
  sensitivity: 1.0,       // multiplier on look speed
  fov: 74,
  quality: 'auto',        // auto | low | medium | high
  vsync: true,            // when off, the frame limiter is removed
  crosshairSize: 1.0,
  crosshairColour: '#7fe9c4',
  showFps: true,
  invertY: false,
};

let data = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

export function get(k) { return data[k]; }
export function all() { return { ...data }; }

export function set(k, v) {
  data[k] = v;
  flush();
  listeners.forEach((fn) => fn(k, v));
}

export function reset() {
  data = { ...DEFAULTS };
  flush();
  listeners.forEach((fn) => fn(null, null));
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let pending = false;
function flush() {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* private mode */ }
  }, 0);
}
