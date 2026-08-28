import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG } from './config.js';

// Hostile soldiers: four loadouts, one shared code path.
//
// Built to real proportions -- 1.8m tall, 0.24m head, shoulders at 1.45m, and
// limbs made from tapered cylinders rather than boxes. That one change is most
// of the difference between reading as a person and reading as a machine.
//
// Colour is baked into vertex attributes and each animated group is merged, so
// a soldier costs six draw calls regardless of how many pieces it is made of.
// Geometry per loadout is built once and shared by every instance.
//
// Hits throw dust and kit fragments, never blood. That keeps the age rating
// low and short-form platforms from suppressing clips, at no cost to feel.

export const STATE = {
  IDLE: 'idle', PATROL: 'patrol', ALERT: 'alert', CHASE: 'chase',
  ATTACK: 'attack', SEARCH: 'search', RETREAT: 'retreat', DEAD: 'dead',
};

const SKIN = [0.60, 0.44, 0.34];
const GLOVE = [0.13, 0.14, 0.13];
const BOOT = [0.10, 0.10, 0.10];
const GUN = [0.13, 0.14, 0.15];

function tint(geo, rgb) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = rgb[0]; arr[i * 3 + 1] = rgb[1]; arr[i * 3 + 2] = rgb[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

const OBJ = new THREE.Object3D();
function at(geo, rgb, x, y, z, rx = 0, ry = 0, rz = 0) {
  OBJ.position.set(x, y, z);
  OBJ.rotation.set(rx, ry, rz);
  OBJ.scale.set(1, 1, 1);
  OBJ.updateMatrix();
  return tint(geo.clone().applyMatrix4(OBJ.matrix), rgb);
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const C = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
const S = (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);

// Each loadout differs in bulk, kit and headgear, not just colour.
const KIT = {
  scout:   { uniform: [0.40, 0.44, 0.34], vest: [0.22, 0.24, 0.19], bulk: 0.92,
             helmet: false, pack: false, name: 'RECON' },
  assault: { uniform: [0.34, 0.37, 0.30], vest: [0.17, 0.19, 0.16], bulk: 1.0,
             helmet: true,  pack: true,  name: 'RIFLEMAN' },
  heavy:   { uniform: [0.30, 0.30, 0.26], vest: [0.14, 0.15, 0.13], bulk: 1.22,
             helmet: true,  pack: true,  name: 'GUNNER' },
  elite:   { uniform: [0.19, 0.20, 0.22], vest: [0.11, 0.12, 0.14], bulk: 1.02,
             helmet: true,  pack: false, name: 'OPERATOR' },
};

const CACHE = {};

function buildSoldier(type) {
  if (CACHE[type]) return CACHE[type];
  const k = KIT[type] || KIT.assault;
  const U = k.uniform, V = k.vest, w = k.bulk;
  const body = [], armL = [], armR = [], legL = [], legR = [];

  // ---- torso: hips at y=0, head on top ----
  body.push(at(B(0.34 * w, 0.20, 0.22), U, 0, 0.06, 0));                    // hips
  body.push(at(C(0.175 * w, 0.155 * w, 0.30, 10), U, 0, 0.31, 0));          // abdomen
  body.push(at(B(0.40 * w, 0.30, 0.24), U, 0, 0.60, 0));                    // chest
  body.push(at(B(0.42 * w, 0.28, 0.28), V, 0, 0.61, 0.005));                // plate carrier
  body.push(at(B(0.13, 0.10, 0.07), V, -0.11 * w, 0.50, 0.15));             // mag pouches
  body.push(at(B(0.13, 0.10, 0.07), V, 0.03 * w, 0.50, 0.15));
  body.push(at(B(0.10, 0.09, 0.07), V, 0.16 * w, 0.50, 0.12));
  if (k.pack) body.push(at(B(0.30 * w, 0.34, 0.16), V, 0, 0.58, -0.19));    // back pack
  if (type === 'heavy') {
    body.push(at(B(0.46, 0.20, 0.14), V, 0, 0.78, -0.16));                  // ammo box
    body.push(at(B(0.16, 0.22, 0.16), V, -0.30, 0.60, 0));                  // shoulder plates
    body.push(at(B(0.16, 0.22, 0.16), V, 0.30, 0.60, 0));
  }

  // ---- head ----
  body.push(at(C(0.075, 0.075, 0.09, 8), SKIN, 0, 0.79, 0));                // neck
  body.push(at(S(0.115, 10, 8), SKIN, 0, 0.90, 0));                         // head
  if (type === 'elite') {
    body.push(at(B(0.20, 0.13, 0.06), [0.10, 0.10, 0.11], 0, 0.885, 0.085)); // balaclava
    body.push(at(B(0.21, 0.05, 0.04), [0.05, 0.06, 0.07], 0, 0.925, 0.10));  // goggles
  } else {
    body.push(at(B(0.19, 0.07, 0.05), U, 0, 0.885, 0.095));                 // face wrap
  }
  if (k.helmet) {
    body.push(at(S(0.135, 10, 6), V, 0, 0.925, 0));
    body.push(at(B(0.24, 0.035, 0.10), V, 0, 0.935, 0.085));
    body.push(at(B(0.055, 0.05, 0.06), V, 0.115, 0.925, 0.02));             // side rail
  } else {
    body.push(at(C(0.125, 0.125, 0.055, 10), U, 0, 0.955, 0));              // patrol cap
    body.push(at(B(0.20, 0.02, 0.10), U, 0, 0.945, 0.09));
  }
  body.push(at(C(0.10, 0.13, 0.14, 8), U, -0.225 * w, 0.665, 0));           // shoulders
  body.push(at(C(0.10, 0.13, 0.14, 8), U, 0.225 * w, 0.665, 0));

  // ---- arms: pivot at the shoulder ----
  const arm = () => [
    at(C(0.062 * w, 0.052 * w, 0.30, 8), U, 0, -0.15, 0),
    at(S(0.055, 8, 6), U, 0, -0.30, 0),                                     // elbow
    at(C(0.050, 0.045, 0.28, 8), U, 0, -0.44, 0),
    at(B(0.085, 0.10, 0.075), GLOVE, 0, -0.61, 0.01),                       // hand
    at(B(0.09, 0.06, 0.05), GLOVE, 0, -0.575, 0.055),
  ];
  armL.push(...arm());
  armR.push(...arm());

  // ---- legs: pivot at the hip ----
  const leg = () => [
    at(C(0.085 * w, 0.070 * w, 0.44, 8), U, 0, -0.22, 0),
    at(S(0.075, 8, 6), U, 0, -0.44, 0),                                     // knee
    at(C(0.068, 0.055, 0.42, 8), U, 0, -0.65, 0),
    at(B(0.115, 0.075, 0.135), BOOT, 0, -0.885, 0.005),
    at(B(0.125, 0.09, 0.26), BOOT, 0, -0.905, 0.055),                       // boot
  ];
  legL.push(...leg());
  legR.push(...leg());

  // ---- carried weapon, sized to the loadout ----
  const gunLen = type === 'heavy' ? 0.46 : type === 'scout' ? 0.26 : 0.34;
  const gun = [
    at(B(0.055, 0.06, gunLen), GUN, 0, 0, 0),
    at(C(0.011, 0.011, gunLen * 0.75, 6), GUN, 0, 0.012, -gunLen * 0.82, Math.PI / 2),
    at(B(0.035, 0.10, 0.07), GUN, 0, -0.075, 0.02),                         // magazine
    at(B(0.045, 0.05, 0.11), GUN, 0, -0.005, gunLen * 0.58),                // stock
    at(B(0.022, 0.03, 0.05), GUN, 0, 0.045, -0.02),                         // optic
  ];
  if (type === 'heavy') gun.push(at(B(0.09, 0.11, 0.16), GUN, 0, -0.085, -0.04));  // drum

  const merge = (a) => mergeGeometries(a, false);
  CACHE[type] = {
    body: merge(body), armL: merge(armL), armR: merge(armR),
    legL: merge(legL), legR: merge(legR), gun: merge(gun),
    mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.05 }),
    bulk: w,
  };
  return CACHE[type];
}

const HITBOX = new THREE.MeshBasicMaterial({ visible: false });
let nextId = 1;

export class Enemy {
  constructor(type, x, z, tier) {
    const P = buildSoldier(type);
    const spec = CFG.robots[type];
    this.id = nextId++;
    this.type = type;
    this.spec = spec;
    this.tier = tier || 1;

    this.maxHp = spec.health * this.tier;
    this.hp = this.maxHp;
    this.speed = spec.speed * (0.9 + Math.random() * 0.2);
    this.state = STATE.IDLE;
    this.stateT = 0;
    this.dead = false;
    this.deathT = 0;
    this.phase = Math.random() * Math.PI * 2;
    this.attackCd = spec.attackCd * Math.random();
    this.burstLeft = 0;
    this.burstT = 0;
    this.lastSeen = new THREE.Vector3(x, 0, z);
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = 0;
    this.patrolTarget = null;
    this.hitFlash = 0;
    this.deathSpin = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6);
    this.losPhase = (nextId * 7) % 3;
    this.losCache = false;
    this.losAge = 99;
    this.lastPos = new THREE.Vector3(x, 0, z);
    this.stuckT = 0;
    this.frustration = 0;

    this.root = new THREE.Group();
    this.root.position.set(x, 0, z);
    this.root.scale.setScalar(spec.scale);

    // hips sit at 0.92m so the soldier stands 1.8m tall
    this.body = new THREE.Group();
    this.body.position.y = 0.92;
    this.baseY = 0.92;
    this.root.add(this.body);

    const mk = (geo) => { const m = new THREE.Mesh(geo, P.mat); m.castShadow = true; return m; };
    this.torso = mk(P.body);
    this.body.add(this.torso);

    const sx = 0.225 * P.bulk;
    this.armL = new THREE.Group(); this.armL.position.set(-sx, 0.665, 0);
    this.armR = new THREE.Group(); this.armR.position.set(sx, 0.665, 0);
    this.armL.add(mk(P.armL));
    this.armR.add(mk(P.armR));
    this.body.add(this.armL, this.armR);

    this.legL = new THREE.Group(); this.legL.position.set(-0.105, 0, 0);
    this.legR = new THREE.Group(); this.legR.position.set(0.105, 0, 0);
    this.legL.add(mk(P.legL));
    this.legR.add(mk(P.legR));
    this.body.add(this.legL, this.legR);

    this.gun = mk(P.gun);
    this.gun.position.set(0.16, 0.44, 0.20);
    this.gun.rotation.set(-0.15, 0.16, 0);
    this.body.add(this.gun);

    // rifle held across the chest
    this.armL.rotation.set(-1.15, 0.30, 0.34);
    this.armR.rotation.set(-0.95, -0.18, -0.20);

    // Sight origin: roughly eye height. The AI traces from here.
    this.head = new THREE.Object3D();
    this.head.position.set(0, 0.90, 0.10);
    this.body.add(this.head);

    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0.16, 0.46, -0.28);
    this.body.add(this.muzzle);

    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.17, 0.17),
      new THREE.MeshBasicMaterial({
        color: 0xffc06a, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
    this.flash.position.copy(this.muzzle.position);
    this.flash.visible = false;
    this.body.add(this.flash);

    this.hitboxes = [];
    this._hitboxes();
  }

  _hitboxes() {
    // Coarse boxes rather than the render meshes: cheaper to trace, and sized
    // for fairness rather than anatomy.
    const add = (w, h, d, y, part, mul) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), HITBOX);
      m.position.y = y;
      m.userData = { robot: this, part, mul };
      this.body.add(m);
      this.hitboxes.push(m);
    };
    add(0.28, 0.30, 0.28, 0.91, 'head', CFG.weapons.rifle.headMul);
    add(0.46, 0.52, 0.30, 0.50, 'body', 1.0);
    add(0.62, 0.40, 0.26, 0.55, 'arms', 0.75);
    add(0.40, 0.80, 0.26, -0.40, 'legs', 0.65);
  }

  damage(amount, part) {
    if (this.dead) return { killed: false };
    this.hp -= amount;
    this.hitFlash = 1;
    // Being shot always reveals the player, even from behind cover.
    if (this.state === STATE.IDLE || this.state === STATE.PATROL) {
      this.state = STATE.ALERT;
      this.stateT = 0;
    }
    if (this.hp <= 0) {
      this.dead = true;
      this.state = STATE.DEAD;
      this.deathT = 0;
      this.hitboxes.forEach((h) => { h.userData.robot = null; });
      return { killed: true, headshot: part === 'head' };
    }
    return { killed: false };
  }

  update(dt, ctx) {
    if (this.dead) return this._death(dt);

    const p = ctx.player;
    const pos = this.root.position;
    const dx = p.x - pos.x, dz = p.z - pos.z;
    const dist = Math.hypot(dx, dz);
    this.stateT += dt;
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 4);

    let canSee;
    this.losAge += dt;
    if (dist > this.spec.sightRange) {
      canSee = false;
      this.losCache = false;
    } else if ((ctx.frame + this.losPhase) % 3 === 0 || this.losAge > 0.2) {
      canSee = ctx.canSee(this._eyeWorld(), p);
      this.losCache = canSee;
      this.losAge = 0;
    } else {
      canSee = this.losCache;
    }

    if (canSee) { this.lastSeen.set(p.x, 0, p.z); this.sawAt = 0; }
    else this.sawAt = (this.sawAt || 0) + dt;

    this._think(dt, dist, canSee);
    this._act(dt, ctx, dist, canSee, dx, dz);
    this._unstick(dt, ctx, dist);
    this._animate(dt);
  }

  _eyeWorld() {
    const v = new THREE.Vector3();
    this.head.getWorldPosition(v);
    return v;
  }

  _think(dt, dist, canSee) {
    const S2 = STATE;
    const smart = this.spec.smart;
    const hurtBadly = this.hp / this.maxHp < 0.3;

    switch (this.state) {
      case S2.IDLE:
        if (canSee) this._set(S2.ALERT);
        else if (this.stateT > 1.2) this._set(S2.PATROL);
        break;
      case S2.PATROL:
        if (canSee) this._set(S2.ALERT);
        break;
      case S2.ALERT:
        if (this.stateT > 0.45) this._set(S2.CHASE);
        break;
      case S2.CHASE:
        if (canSee && dist <= this.spec.attackRange) this._set(S2.ATTACK);
        else if (!canSee && this.sawAt > 1.6) this._set(S2.SEARCH);
        else if (smart && hurtBadly) this._set(S2.RETREAT);
        break;
      case S2.ATTACK:
        if (!canSee || dist > this.spec.attackRange * 1.15) this._set(S2.CHASE);
        else if (smart && hurtBadly && this.stateT > 1.2) this._set(S2.RETREAT);
        break;
      case S2.SEARCH:
        if (canSee) this._set(S2.ALERT);
        else if (this.stateT > 6) this._set(S2.PATROL);
        break;
      case S2.RETREAT:
        if (this.stateT > 2.6 || this.hp / this.maxHp > 0.55) this._set(S2.CHASE);
        break;
    }
  }

  _set(s) { this.state = s; this.stateT = 0; }

  _act(dt, ctx, dist, canSee, dx, dz) {
    const S2 = STATE;
    const pos = this.root.position;
    let wantX = 0, wantZ = 0, moving = false;

    const face = (tx, tz, rate) => {
      const want = Math.atan2(tx, tz);
      let d = want - this.root.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.root.rotation.y += THREE.MathUtils.clamp(d, -rate * dt, rate * dt);
    };

    if (this.state === S2.PATROL || this.state === S2.IDLE) {
      // These are attackers with an objective, so patrol converges on the
      // player's area with a wander offset rather than milling about.
      const stale = !this.patrolTarget || this.patrolTarget.distanceToSquared(pos) < 9;
      const drifted = this.patrolTarget &&
        Math.hypot(this.patrolTarget.x - ctx.player.x, this.patrolTarget.z - ctx.player.z) > 22;
      if (stale || drifted) {
        const a = Math.random() * Math.PI * 2;
        const r = 5 + Math.random() * 9;
        this.patrolTarget = new THREE.Vector3(
          ctx.player.x + Math.sin(a) * r, 0, ctx.player.z + Math.cos(a) * r);
      }
      wantX = this.patrolTarget.x - pos.x;
      wantZ = this.patrolTarget.z - pos.z;
      moving = this.state === S2.PATROL;
      face(wantX, wantZ, 2.0);
    } else if (this.state === S2.ALERT) {
      face(dx, dz, 5.0);
    } else if (this.state === S2.CHASE) {
      wantX = dx; wantZ = dz; moving = true;
      face(dx, dz, 4.0);
    } else if (this.state === S2.SEARCH) {
      wantX = this.lastSeen.x - pos.x;
      wantZ = this.lastSeen.z - pos.z;
      moving = Math.hypot(wantX, wantZ) > 1.5;
      if (moving) face(wantX, wantZ, 3.0);
    } else if (this.state === S2.RETREAT) {
      wantX = -dx; wantZ = -dz; moving = true;
      face(dx, dz, 3.5);
    } else if (this.state === S2.ATTACK) {
      face(dx, dz, 6.0);
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 0.8 + Math.random() * 1.4; this.strafeDir *= -1; }
      const perpX = -dz / (dist || 1), perpZ = dx / (dist || 1);
      wantX = perpX * this.strafeDir; wantZ = perpZ * this.strafeDir;
      if (dist > this.spec.attackRange * 0.75) { wantX += dx / dist * 0.8; wantZ += dz / dist * 0.8; }
      if (dist < this.spec.attackRange * 0.35) { wantX -= dx / dist * 0.9; wantZ -= dz / dist * 0.9; }
      moving = true;
      this._shoot(dt, ctx, dist, canSee);
    }

    if (this.state !== S2.ATTACK) this.burstLeft = 0;

    if (moving) {
      const len = Math.hypot(wantX, wantZ) || 1;
      let nx = wantX / len, nz = wantZ / len;
      const speed = this.speed * (this.state === S2.PATROL ? 0.80 : this.state === S2.ATTACK ? 0.7 : 1);
      const step = speed * dt;

      // Fan out around obstructions rather than grinding into them.
      if (ctx.blocked(pos.x + nx * 0.9, pos.z + nz * 0.9)) {
        let found = false;
        for (const sign of [this.strafeDir, -this.strafeDir]) {
          for (const ang of [0.6, 1.1, 1.7, 2.3]) {
            const a = Math.atan2(nx, nz) + sign * ang;
            const tx = Math.sin(a), tz = Math.cos(a);
            if (!ctx.blocked(pos.x + tx * 0.9, pos.z + tz * 0.9)) { nx = tx; nz = tz; found = true; break; }
          }
          if (found) break;
        }
        if (!found) { nx = -nx; nz = -nz; }
      }
      const px = pos.x + nx * step, pz = pos.z + nz * step;
      if (!ctx.blocked(px, pos.z)) pos.x = px;
      if (!ctx.blocked(pos.x, pz)) pos.z = pz;
      this.phase += dt * this.speed * 3.1;
      this.walking = true;
    } else this.walking = false;
  }

  _shoot(dt, ctx, dist, canSee) {
    if (!canSee) return;
    this.attackCd -= dt;
    if (this.spec.ranged) {
      if (this.burstLeft > 0) {
        this.burstT -= dt;
        if (this.burstT <= 0) { this.burstT = 0.09; this.burstLeft--; this._fireOne(ctx, dist); }
        return;
      }
      if (this.attackCd <= 0) {
        this.attackCd = this.spec.attackCd;
        this.burstLeft = this.spec.burst || 1;
        this.burstT = 0;
      }
    } else if (this.attackCd <= 0 && dist <= this.spec.attackRange) {
      this.attackCd = this.spec.attackCd;
      ctx.onAttack(this.spec.damage, null, null, this);
    }
  }

  _fireOne(ctx, dist) {
    const origin = new THREE.Vector3();
    this.muzzle.getWorldPosition(origin);
    const target = new THREE.Vector3(ctx.player.x, ctx.player.y + 1.2, ctx.player.z);
    const dir = target.clone().sub(origin).normalize();
    // accuracy falls off with range, so distant contacts are survivable
    const miss = THREE.MathUtils.clamp(dist / this.spec.attackRange, 0, 1) * 0.055;
    dir.x += (Math.random() - 0.5) * miss;
    dir.y += (Math.random() - 0.5) * miss;
    dir.z += (Math.random() - 0.5) * miss;
    dir.normalize();
    this.flash.visible = true;
    this.flash.material.opacity = 0.9;
    this.flash.rotation.z = Math.random() * 3;
    ctx.onAttack(this.spec.damage, origin, dir, this);
  }

  _unstick(dt, ctx) {
    const pos = this.root.position;
    const moved = Math.hypot(pos.x - this.lastPos.x, pos.z - this.lastPos.z);
    this.lastPos.set(pos.x, 0, pos.z);
    if (!this.walking) { this.stuckT = 0; return; }
    if (moved > this.speed * dt * 0.35) { this.stuckT = 0; this.frustration = 0; return; }
    this.stuckT += dt;
    if (this.stuckT > 0.7) {
      this.stuckT = 0;
      this.strafeDir *= -1;
      this.frustration++;
      if (this.frustration > 4) {
        const ang = Math.atan2(ctx.player.x - pos.x, ctx.player.z - pos.z) + (Math.random() - 0.5) * 1.6;
        const nx = pos.x + Math.sin(ang) * 2.2, nz = pos.z + Math.cos(ang) * 2.2;
        if (!ctx.blocked(nx, nz)) { pos.x = nx; pos.z = nz; }
        this.frustration = 0;
        this.patrolTarget = null;
      }
    }
  }

  _animate(dt) {
    const s = Math.sin(this.phase);
    if (this.walking) {
      // hips swing, torso counter-rotates, arms brace the weapon
      this.legL.rotation.x = s * 0.65;
      this.legR.rotation.x = -s * 0.65;
      this.body.position.y = this.baseY + Math.abs(s) * 0.03;
      this.body.rotation.z = s * 0.035;
      this.armL.rotation.x = -1.15 + s * 0.14;
      this.armR.rotation.x = -0.95 - s * 0.12;
    } else {
      this.legL.rotation.x *= 0.85;
      this.legR.rotation.x *= 0.85;
      this.body.rotation.z *= 0.85;
      this.body.position.y = THREE.MathUtils.damp(this.body.position.y, this.baseY, 6, dt);
      this.armL.rotation.x = THREE.MathUtils.damp(this.armL.rotation.x, -1.15, 6, dt);
      this.armR.rotation.x = THREE.MathUtils.damp(this.armR.rotation.x, -0.95, 6, dt);
    }

    if (this.flash.visible) {
      this.flash.material.opacity -= dt * 14;
      if (this.flash.material.opacity <= 0) {
        this.flash.visible = false;
        this.flash.material.opacity = 0;
      }
    }
  }

  _death(dt) {
    this.deathT += dt;
    const t = Math.min(1, this.deathT / 0.6);
    const e = t * t * (3 - 2 * t);
    // fold forward, drop, twist on the way down
    this.body.rotation.x = e * 1.45;
    this.body.rotation.z = e * 0.35 * this.deathSpin;
    this.body.position.y = this.baseY - e * 0.66;
    this.legL.rotation.x = -e * 0.7;
    this.legR.rotation.x = -e * 0.4;
    this.armL.rotation.x = -1.15 + e * 0.9;
    this.armR.rotation.x = -0.95 + e * 0.7;
    if (this.deathT > 1.8) this.root.position.y = -(this.deathT - 1.8) * 1.1;
  }

  get removable() { return this.dead && this.deathT > 2.7; }
}

// Kept as `Robot` too so existing imports keep working.
export { Enemy as Robot };

// Which loadout is legal at a given wave, weighted so early waves stay light.
export function pickType(wave) {
  const pool = [];
  for (const [id, s] of Object.entries(CFG.robots)) {
    if (wave < s.wave) continue;
    let weight = 3;
    if (id === 'scout') weight = Math.max(1, 5 - Math.floor(wave / 3));
    if (id === 'assault') weight = 4;
    if (id === 'heavy') weight = 1 + Math.floor(wave / 5);
    if (id === 'elite') weight = 1 + Math.floor(wave / 6);
    for (let i = 0; i < weight; i++) pool.push(id);
  }
  return pool.length ? pool[(Math.random() * pool.length) | 0] : 'scout';
}
