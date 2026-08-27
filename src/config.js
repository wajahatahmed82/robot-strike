// ROBOT STRIKE - all tuning in one place.

export const CFG = {
  camera: {
    fovBase: 74,
    fovSprint: 82,
    adsTime: 0.14,
    standHeight: 1.68,
    crouchHeight: 1.02,
    crouchTime: 0.14,
    pitchMin: -1.30,
    pitchMax: 1.30,
    lookSens: 0.0040,      // radians per screen pixel, scaled by settings
    adsSensMul: 0.52,
  },

  player: {
    maxHealth: 100,
    maxArmor: 100,
    regenDelay: 5.5,
    regenRate: 10,

    walkSpeed: 4.2,
    sprintSpeed: 6.6,
    crouchSpeed: 2.0,
    adsSpeed: 2.4,
    accel: 16,
    decel: 20,
    airAccel: 3,
    jumpSpeed: 5.0,
    gravity: 18,
    radius: 0.40,
    arenaRadius: 54,
    eyeToTop: 0.18,        // headroom above the eye for ceiling checks
  },

  // Four weapons. Every value here is live -- damage, spread, recoil and the
  // viewmodel proportions all read from this table, so balancing is one edit.
  weapons: {
    rifle: {
      name: 'VK-7 RIFLE', slot: 1, auto: true,
      rpm: 640, magSize: 30, reserve: 240, damage: 26, headMul: 2.6,
      reloadTime: 2.0, reloadEmpty: 2.5, range: 220, pellets: 1,
      spreadHip: 0.048, spreadAds: 0.0026, spreadPerShot: 0.010,
      spreadMax: 0.095, spreadRecover: 0.17, moveSpreadMul: 1.6,
      recoilPitch: 0.0115, recoilYaw: 0.0048, recoilRecover: 8.0, kickBack: 0.026,
      fovAds: 46, adsZoom: 1, unlockLevel: 1,
      shape: { barrel: 0.30, stock: true, mag: 'long', optic: 'dot', bulk: 1.0 },
    },
    smg: {
      name: 'HORNET SMG', slot: 2, auto: true,
      rpm: 950, magSize: 40, reserve: 320, damage: 17, headMul: 2.2,
      reloadTime: 1.7, reloadEmpty: 2.1, range: 120, pellets: 1,
      spreadHip: 0.062, spreadAds: 0.0060, spreadPerShot: 0.009,
      spreadMax: 0.120, spreadRecover: 0.22, moveSpreadMul: 1.15,
      recoilPitch: 0.0080, recoilYaw: 0.0055, recoilRecover: 10.0, kickBack: 0.020,
      fovAds: 54, adsZoom: 1, unlockLevel: 2,
      shape: { barrel: 0.16, stock: false, mag: 'long', optic: 'dot', bulk: 0.82 },
    },
    shotgun: {
      name: 'BREACHER 12', slot: 3, auto: false,
      rpm: 85, magSize: 6, reserve: 48, damage: 17, headMul: 1.6,
      reloadTime: 2.6, reloadEmpty: 3.0, range: 45, pellets: 9,
      spreadHip: 0.085, spreadAds: 0.048, spreadPerShot: 0.0,
      spreadMax: 0.085, spreadRecover: 0.3, moveSpreadMul: 1.1,
      recoilPitch: 0.045, recoilYaw: 0.010, recoilRecover: 6.0, kickBack: 0.075,
      fovAds: 62, adsZoom: 1, unlockLevel: 3,
      shape: { barrel: 0.34, stock: true, mag: 'tube', optic: 'iron', bulk: 1.12 },
    },
    sniper: {
      name: 'LONGVIEW .50', slot: 4, auto: false,
      rpm: 48, magSize: 5, reserve: 35, damage: 135, headMul: 2.4,
      reloadTime: 2.9, reloadEmpty: 3.4, range: 400, pellets: 1,
      spreadHip: 0.115, spreadAds: 0.0002, spreadPerShot: 0.0,
      spreadMax: 0.115, spreadRecover: 0.3, moveSpreadMul: 2.2,
      recoilPitch: 0.055, recoilYaw: 0.012, recoilRecover: 5.0, kickBack: 0.090,
      fovAds: 16, adsZoom: 4, unlockLevel: 4,
      shape: { barrel: 0.52, stock: true, mag: 'short', optic: 'scope', bulk: 1.2 },
    },
  },

  // Four robot chassis. Distinct silhouette, speed and behaviour each.
  robots: {
    scout: {
      // Was 5.0 m/s and 7 damage: faster than the player can walk, which killed
      // a new player inside wave 1. Wave 1 has to be winnable.
      name: 'SCOUT', health: 55, speed: 3.9, damage: 5, attackRange: 3.0,
      attackCd: 0.95, score: 100, xp: 10, colour: 0x4fd6ff, scale: 0.82,
      ranged: false, sightRange: 70, wave: 1,
    },
    assault: {
      name: 'ASSAULT', health: 130, speed: 3.0, damage: 7, attackRange: 20,
      attackCd: 1.8, score: 150, xp: 18, colour: 0xffb03a, scale: 1.0,
      ranged: true, burst: 3, sightRange: 80, wave: 2,
    },
    heavy: {
      name: 'HEAVY', health: 420, speed: 1.7, damage: 20, attackRange: 14,
      attackCd: 2.3, score: 300, xp: 45, colour: 0xff4d3d, scale: 1.35,
      ranged: true, burst: 2, sightRange: 70, wave: 4,
    },
    elite: {
      name: 'ELITE', health: 260, speed: 4.2, damage: 14, attackRange: 22,
      attackCd: 1.15, score: 500, xp: 70, colour: 0xc45cff, scale: 1.05,
      ranged: true, burst: 4, sightRange: 95, wave: 6, smart: true,
    },
  },

  wave: {
    counts: [5, 8, 12],        // explicit for the first three, then formula
    growth: 4,
    breakTime: 5.0,
    maxAlive: 14,              // hard cap; the rest queue up
    spawnMin: 22,
    spawnMax: 44,
  },

  timeAttack: { duration: 300 },   // 5 minutes

  score: {
    kill: 100, headshotBonus: 100, waveClear: 500,
    comboWindow: 3.0,
    // kills within the window -> multiplier
    comboTiers: [[3, 2], [5, 3], [10, 5]],
  },

  xp: {
    perKill: 10, headshot: 8, waveClear: 120,
    // XP needed for level N is level * curve
    curve: 260,
  },
};

// Cold industrial facility: blue-grey steel, sodium work lights, red hazard.
export const PAL = {
  skyTop: 0x1c2a38,
  skyMid: 0x44586a,
  skyLow: 0x76889a,
  sun: 0xdce9f5,
  ambientSky: 0x9cb8d0,
  ambientGround: 0x4e4740,
  fog: 0x46545f,
  workLight: 0xffb257,
  hazard: 0xff3b30,
};
