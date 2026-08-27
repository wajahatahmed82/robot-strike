const KEY = 'deadeye.save.v1';

const DEFAULTS = {
  best: 0,
  bestWave: 0,
  headshots: 0,
  runs: 0,
  muted: false,
};

let data = load();

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
export function all() { return data; }
export function set(k, v) { data[k] = v; flush(); }
export function patch(obj) { Object.assign(data, obj); flush(); }

let pending = false;
function flush() {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* private mode or quota */ }
  }, 0);
}
