import { CFG } from './config.js';

const KEY = 'robotstrike.profile.v1';

// Six upgrade tracks, five ranks each. Every rank is a live multiplier read by
// the weapon system, so buying one changes the feel of the gun immediately.
export const UPGRADES = {
  damage:   { name: 'Damage',        desc: '+8% damage per rank',        step: 0.08, cost: 1 },
  magazine: { name: 'Magazine',      desc: '+15% magazine per rank',     step: 0.15, cost: 1 },
  reload:   { name: 'Reload Speed',  desc: '+12% reload speed per rank', step: 0.12, cost: 1 },
  recoil:   { name: 'Recoil Control',desc: '-10% recoil per rank',       step: 0.10, cost: 1 },
  fireRate: { name: 'Fire Rate',     desc: '+6% rate of fire per rank',  step: 0.06, cost: 1 },
  accuracy: { name: 'Accuracy',      desc: '-10% spread per rank',       step: 0.10, cost: 1 },
};
export const MAX_RANK = 5;

const DEFAULTS = {
  xp: 0,
  level: 1,
  points: 0,
  ranks: {},
  bestScore: 0,
  bestWave: 0,
  bestTimeAttack: 0,
  totalKills: 0,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, ranks: {} };
    const d = JSON.parse(raw);
    return { ...DEFAULTS, ...d, ranks: { ...(d.ranks || {}) } };
  } catch (e) {
    return { ...DEFAULTS, ranks: {} };
  }
}

export class Progression {
  constructor() {
    this.data = load();
    this.onLevelUp = () => {};
  }

  get level() { return this.data.level; }
  get xp() { return this.data.xp; }
  get points() { return this.data.points; }
  get bestScore() { return this.data.bestScore; }
  get bestWave() { return this.data.bestWave; }
  get bestTimeAttack() { return this.data.bestTimeAttack; }

  xpForLevel(n) { return n * CFG.xp.curve; }
  get xpIntoLevel() { return this.data.xp; }
  get xpNeeded() { return this.xpForLevel(this.data.level); }

  addXp(n) {
    this.data.xp += n;
    let levelled = 0;
    while (this.data.xp >= this.xpForLevel(this.data.level)) {
      this.data.xp -= this.xpForLevel(this.data.level);
      this.data.level++;
      this.data.points++;
      levelled++;
    }
    if (levelled) this.onLevelUp(this.data.level);
    this.save();
    return levelled;
  }

  rank(id) { return this.data.ranks[id] || 0; }

  // Recoil and accuracy get better as the number goes down, so they invert.
  upgradeMul(id) {
    const u = UPGRADES[id];
    if (!u) return 1;
    const r = this.rank(id);
    if (id === 'recoil' || id === 'accuracy') return 1 / (1 - u.step * r);
    return 1 + u.step * r;
  }

  canBuy(id) {
    return UPGRADES[id] && this.rank(id) < MAX_RANK && this.data.points >= UPGRADES[id].cost;
  }

  buy(id) {
    if (!this.canBuy(id)) return false;
    this.data.points -= UPGRADES[id].cost;
    this.data.ranks[id] = this.rank(id) + 1;
    this.save();
    return true;
  }

  unlockedWeapons() {
    return Object.entries(CFG.weapons)
      .filter(([, s]) => this.data.level >= s.unlockLevel)
      .map(([id]) => id);
  }

  nextUnlock() {
    const locked = Object.entries(CFG.weapons)
      .filter(([, s]) => this.data.level < s.unlockLevel)
      .sort((a, b) => a[1].unlockLevel - b[1].unlockLevel);
    return locked.length ? { id: locked[0][0], spec: locked[0][1] } : null;
  }

  recordRun({ score, wave, kills, mode }) {
    this.data.totalKills += kills;
    if (score > this.data.bestScore) this.data.bestScore = score;
    if (mode === 'survival' && wave > this.data.bestWave) this.data.bestWave = wave;
    if (mode === 'timeattack' && score > this.data.bestTimeAttack) this.data.bestTimeAttack = score;
    this.save();
  }

  resetProfile() {
    this.data = { ...DEFAULTS, ranks: {} };
    this.save();
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* private mode */ }
  }
}
