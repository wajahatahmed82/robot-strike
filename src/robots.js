import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG } from './config.js';

// Hostile robots: four chassis, one shared code path.
//
// Colour is baked into vertex attributes and each animated group is merged, so
// a robot costs six draw calls regardless of how many pieces it is built from.
// Geometry per chassis is built once and shared by every instance.
//
// The AI is a real state machine, not a beeline. Robots patrol until they can
// actually see the player, lose track when line of sight breaks, search the
// last known position, strafe rather than walking straight in, and the smarter
// chassis break off to cover when hurt.

export const STATE = {
  IDLE: 'idle', PATROL: 'patrol', ALERT: 'alert', CHASE: 'chase',
  ATTACK: 'attack', SEARCH: 'search', RETREAT: 'retreat', DEAD: 'dead',
};

const SHELL = [0.30, 0.33, 0.38];
const SHELL_DARK = [0.18, 0.20, 0.24];
const JOINT = [0.12, 0.13, 0.15];
const TRIM = [0.55, 0.58, 0.62];

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

const CACHE = {};

// Each chassis differs in proportion and silhouette, not just colour.
function buildChassis(type) {
  if (CACHE[type]) return CACHE[type];
  const spec = CFG.robots[type];
  const body = [], armL = [], armR = [], legL = [], legR = [], glow = [];

  const wide = type === 'heavy' ? 1.5 : type === 'scout' ? 0.72 : 1;
  const tall = type === 'elite' ? 1.12 : type === 'scout' ? 0.9 : 1;

  // --- torso ---
  body.push(at(B(0.30 * wide, 0.16, 0.22), SHELL_DARK, 0, 0.05, 0));                 // pelvis
  body.push(at(C(0.10, 0.09, 0.16, 8), JOINT, 0, 0.20, 0));                          // spine
  body.push(at(B(0.42 * wide, 0.34 * tall, 0.26), SHELL, 0, 0.46 * tall, 0));        // chest
  body.push(at(B(0.30 * wide, 0.10, 0.05), TRIM, 0, 0.56 * tall, 0.14));             // chest vent

  if (type === 'heavy') {
    body.push(at(B(0.60, 0.26, 0.30), SHELL, 0, 0.52, 0));                           // armour slab
    body.push(at(B(0.16, 0.30, 0.16), SHELL_DARK, -0.34, 0.50, 0));
    body.push(at(B(0.16, 0.30, 0.16), SHELL_DARK, 0.34, 0.50, 0));
  }
  if (type === 'elite') {
    body.push(at(B(0.06, 0.34, 0.08), TRIM, -0.24, 0.62, -0.06));                    // back fins
    body.push(at(B(0.06, 0.34, 0.08), TRIM, 0.24, 0.62, -0.06));
  }

  // --- head: a sensor housing with a single glowing eye ---
  const headY = 0.72 * tall;
  body.push(at(C(0.055, 0.055, 0.09, 6), JOINT, 0, headY - 0.10, 0));
  if (type === 'scout') {
    body.push(at(B(0.16, 0.12, 0.20), SHELL, 0, headY, 0.02));
    body.push(at(C(0.008, 0.008, 0.16, 4), TRIM, 0, headY + 0.13, -0.04));           // antenna
  } else if (type === 'heavy') {
    body.push(at(B(0.26, 0.18, 0.24), SHELL, 0, headY, 0));
    body.push(at(B(0.30, 0.06, 0.08), SHELL_DARK, 0, headY + 0.10, 0.06));
  } else {
    body.push(at(B(0.20, 0.17, 0.22), SHELL, 0, headY, 0));
    body.push(at(B(0.22, 0.05, 0.06), TRIM, 0, headY + 0.09, 0.06));
  }
  glow.push(at(B(type === 'heavy' ? 0.18 : 0.11, 0.035, 0.02), [1, 1, 1], 0, headY, 0.115));

  // --- arms: shoulder-pivoted, weapon on the right ---
  const armLen = type === 'heavy' ? 0.34 : 0.28;
  const mkArm = (isGun) => {
    const a = [];
    a.push(at(C(0.075 * wide, 0.06, 0.06, 8), JOINT, 0, 0, 0, Math.PI / 2, 0, 0));
    a.push(at(B(0.10 * wide, armLen, 0.11), SHELL, 0, -armLen / 2 - 0.02, 0));
    a.push(at(C(0.05, 0.05, 0.05, 6), JOINT, 0, -armLen - 0.04, 0, Math.PI / 2, 0, 0));
    if (isGun) {
      a.push(at(B(0.09, 0.10, 0.34), SHELL_DARK, 0, -armLen - 0.10, -0.10));
      a.push(at(C(0.022, 0.022, 0.20, 8), JOINT, 0, -armLen - 0.10, -0.30, Math.PI / 2, 0, 0));
      if (type === 'heavy') {
        a.push(at(C(0.045, 0.045, 0.26, 8), SHELL_DARK, 0, -armLen - 0.10, -0.28, Math.PI / 2, 0, 0));
      }
    } else {
      a.push(at(B(0.08, 0.22, 0.09), SHELL, 0, -armLen - 0.16, 0));
      a.push(at(B(0.09, 0.07, 0.12), SHELL_DARK, 0, -armLen - 0.30, 0.02));
    }
    return a;
  };
  armL.push(...mkArm(false));
  armR.push(...mkArm(true));

  // --- legs: digitigrade, so they never read as human ---
  const mkLeg = () => {
    const l = [];
    l.push(at(C(0.075, 0.065, 0.08, 8), JOINT, 0, 0, 0, Math.PI / 2, 0, 0));
    l.push(at(B(0.12 * wide, 0.34, 0.13), SHELL, 0, -0.19, 0));                       // thigh
    l.push(at(C(0.055, 0.055, 0.06, 6), JOINT, 0, -0.38, 0, Math.PI / 2, 0, 0));
    l.push(at(B(0.09 * wide, 0.32, 0.10), SHELL_DARK, 0, -0.55, -0.05, 0.22));        // shin, kicked back
    l.push(at(C(0.045, 0.045, 0.05, 6), JOINT, 0, -0.72, -0.09, Math.PI / 2, 0, 0));
    l.push(at(B(0.10, 0.06, 0.24), SHELL, 0, -0.78, 0.02));                           // foot
    return l;
  };
  legL.push(...mkLeg());
  legR.push(...mkLeg());

  const merge = (a) => mergeGeometries(a, false);
  CACHE[type] = {
    body: merge(body), armL: merge(armL), armR: merge(armR),
    legL: merge(legL), legR: merge(legR), glow: merge(glow),
    shell: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.62 }),
    eye: new THREE.MeshBasicMaterial({ color: spec.colour, fog: false }),
    hipY: 0.86 * tall * spec.scale,
    headY,
  };
  return CACHE[type];
}

const HITBOX = new THREE.MeshBasicMaterial({ visible: false });
let nextId = 1;

export class Robot {
  constructor(type, x, z, tier) {
    const P = buildChassis(type);
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
    // Line of sight is expensive, so each robot re-tests on its own cadence.
    this.losPhase = (nextId * 7) % 3;
    this.losCache = false;
    this.losAge = 99;
    // Stuck detection. Greedy avoidance can wedge a robot on geometry, and a
    // single wedged straggler stalls the whole wave.
    this.lastPos = new THREE.Vector3(x, 0, z);
    this.stuckT = 0;
    this.frustration = 0;

    this.root = new THREE.Group();
    this.root.position.set(x, 0, z);
    this.root.scale.setScalar(spec.scale);

    this.body = new THREE.Group();
    this.body.position.y = 0.86 * (type === 'elite' ? 1.12 : type === 'scout' ? 0.9 : 1);
    this.root.add(this.body);

    const mk = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m; };
    this.torso = mk(P.body, P.shell);
    this.body.add(this.torso);

    this.eye = new THREE.Mesh(P.glow, P.eye);
    this.body.add(this.eye);

    const shoulderY = 0.60 * (type === 'elite' ? 1.12 : type === 'scout' ? 0.9 : 1);
    const shoulderX = type === 'heavy' ? 0.36 : 0.25;
    this.armL = new THREE.Group(); this.armL.position.set(-shoulderX, shoulderY, 0);
    this.armR = new THREE.Group(); this.armR.position.set(shoulderX, shoulderY, 0);
    this.armL.add(mk(P.armL, P.shell));
    this.armR.add(mk(P.armR, P.shell));
    this.body.add(this.armL, this.armR);

    this.legL = new THREE.Group(); this.legL.position.set(-0.11, 0, 0);
    this.legR = new THREE.Group(); this.legR.position.set(0.11, 0, 0);
    this.legL.add(mk(P.legL, P.shell));
    this.legR.add(mk(P.legR, P.shell));
    this.body.add(this.legL, this.legR);

    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(shoulderX, shoulderY - 0.42, -0.34);
    this.body.add(this.muzzle);

    this.hitboxes = [];
    this._hitboxes(P);
  }

  _hitboxes(P) {
    const add = (w, h, d, y, part, mul) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), HITBOX);
      m.position.y = y;
      m.userData = { robot: this, part, mul };
      this.body.add(m);
      this.hitboxes.push(m);
    };
    const t = this.type;
    const wide = t === 'heavy' ? 1.5 : t === 'scout' ? 0.72 : 1;
    add(0.26 * (t === 'heavy' ? 1.2 : 1), 0.24, 0.26, P.headY, 'head', this.spec.headMul || CFG.weapons.rifle.headMul);
    add(0.46 * wide, 0.40, 0.30, 0.46, 'body', 1.0);
    add(0.70 * wide, 0.34, 0.24, 0.45, 'arms', 0.7);
    add(0.40 * wide, 0.70, 0.26, -0.30, 'legs', 0.6);
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

  // ctx: { player, canSee(from,to), blocked(x,z), onAttack(dmg,origin,dir) }
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

    if (canSee) {
      this.lastSeen.set(p.x, 0, p.z);
      this.sawAt = 0;
    } else {
      this.sawAt = (this.sawAt || 0) + dt;
    }

    this._think(dt, dist, canSee);
    this._act(dt, ctx, dist, canSee, dx, dz);
    this._unstick(dt, ctx, dist);
    this._animate(dt);
  }

  _eyeWorld() {
    const v = new THREE.Vector3();
    this.eye.getWorldPosition(v);
    return v;
  }

  _think(dt, dist, canSee) {
    const S = STATE;
    const smart = this.spec.smart;
    const hurtBadly = this.hp / this.maxHp < 0.3;

    switch (this.state) {
      case S.IDLE:
        if (canSee) this._set(S.ALERT);
        else if (this.stateT > 1.2) this._set(S.PATROL);
        break;
      case S.PATROL:
        if (canSee) this._set(S.ALERT);
        break;
      case S.ALERT:
        // brief spin-up so the player gets a moment to react
        if (this.stateT > 0.45) this._set(S.CHASE);
        break;
      case S.CHASE:
        if (canSee && dist <= this.spec.attackRange) this._set(S.ATTACK);
        else if (!canSee && this.sawAt > 1.6) this._set(S.SEARCH);
        else if (smart && hurtBadly) this._set(S.RETREAT);
        break;
      case S.ATTACK:
        if (!canSee || dist > this.spec.attackRange * 1.15) this._set(S.CHASE);
        else if (smart && hurtBadly && this.stateT > 1.2) this._set(S.RETREAT);
        break;
      case S.SEARCH:
        if (canSee) this._set(S.ALERT);
        else if (this.stateT > 6) this._set(S.PATROL);
        break;
      case S.RETREAT:
        if (this.stateT > 2.6 || this.hp / this.maxHp > 0.55) this._set(S.CHASE);
        break;
    }
  }

  _set(s) { this.state = s; this.stateT = 0; }

  _act(dt, ctx, dist, canSee, dx, dz) {
    const S = STATE;
    const pos = this.root.position;
    let wantX = 0, wantZ = 0, moving = false;

    const faceTowards = (tx, tz, rate) => {
      const want = Math.atan2(tx, tz);
      let d = want - this.root.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.root.rotation.y += THREE.MathUtils.clamp(d, -rate * dt, rate * dt);
    };

    if (this.state === S.PATROL || this.state === S.IDLE) {
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
      moving = this.state === S.PATROL;
      faceTowards(wantX, wantZ, 2.0);
    } else if (this.state === S.ALERT) {
      faceTowards(dx, dz, 5.0);
    } else if (this.state === S.CHASE) {
      wantX = dx; wantZ = dz;
      moving = true;
      faceTowards(dx, dz, 4.0);
    } else if (this.state === S.SEARCH) {
      wantX = this.lastSeen.x - pos.x;
      wantZ = this.lastSeen.z - pos.z;
      moving = Math.hypot(wantX, wantZ) > 1.5;
      if (moving) faceTowards(wantX, wantZ, 3.0);
    } else if (this.state === S.RETREAT) {
      wantX = -dx; wantZ = -dz;
      moving = true;
      faceTowards(dx, dz, 3.5);           // keep facing the player while backing off
    } else if (this.state === S.ATTACK) {
      faceTowards(dx, dz, 6.0);
      // strafe instead of standing still, and close the gap if too far out
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 0.8 + Math.random() * 1.4; this.strafeDir *= -1; }
      const perpX = -dz / (dist || 1), perpZ = dx / (dist || 1);
      wantX = perpX * this.strafeDir; wantZ = perpZ * this.strafeDir;
      if (dist > this.spec.attackRange * 0.75) { wantX += dx / dist * 0.8; wantZ += dz / dist * 0.8; }
      if (dist < this.spec.attackRange * 0.35) { wantX -= dx / dist * 0.9; wantZ -= dz / dist * 0.9; }
      moving = true;

      this._shoot(dt, ctx, dist, canSee, dx, dz);
    }

    if (this.state !== S.ATTACK) { this.burstLeft = 0; }

    if (moving) {
      const len = Math.hypot(wantX, wantZ) || 1;
      let nx = wantX / len, nz = wantZ / len;
      const speed = this.speed * (this.state === S.PATROL ? 0.80 : this.state === S.ATTACK ? 0.7 : 1);

      // obstacle avoidance: if the direct path is blocked, fan out and take the
      // best open heading rather than grinding into the wall
      const step = speed * dt;
      if (ctx.blocked(pos.x + nx * 0.9, pos.z + nz * 0.9)) {
        let found = false;
        for (const sign of [this.strafeDir, -this.strafeDir]) {
          for (const ang of [0.6, 1.1, 1.7, 2.3]) {
            const a = Math.atan2(nx, nz) + sign * ang;
            const tx = Math.sin(a), tz = Math.cos(a);
            if (!ctx.blocked(pos.x + tx * 0.9, pos.z + tz * 0.9)) {
              nx = tx; nz = tz; found = true; break;
            }
          }
          if (found) break;
        }
        if (!found) { nx = -nx; nz = -nz; }
      }
      const px = pos.x + nx * step, pz = pos.z + nz * step;
      if (!ctx.blocked(px, pos.z)) pos.x = px;
      if (!ctx.blocked(pos.x, pz)) pos.z = pz;
      this.phase += dt * this.speed * 3.0;
      this.walking = true;
    } else {
      this.walking = false;
    }
  }

  _shoot(dt, ctx, dist, canSee, dx, dz) {
    if (!canSee) return;
    this.attackCd -= dt;

    if (this.spec.ranged) {
      if (this.burstLeft > 0) {
        this.burstT -= dt;
        if (this.burstT <= 0) {
          this.burstT = 0.09;
          this.burstLeft--;
          this._fireOne(ctx, dist);
        }
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
    // accuracy falls off with range, so distant robots are survivable
    const miss = THREE.MathUtils.clamp(dist / this.spec.attackRange, 0, 1) * 0.055;
    dir.x += (Math.random() - 0.5) * miss;
    dir.y += (Math.random() - 0.5) * miss;
    dir.z += (Math.random() - 0.5) * miss;
    dir.normalize();
    ctx.onAttack(this.spec.damage, origin, dir, this);
  }

  // A robot that wants to move but has not actually moved is wedged. Give it a
  // new heading, and if that fails for long enough, escalate: pick a fresh
  // approach vector toward the player and push through.
  _unstick(dt, ctx, dist) {
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
      // Long-term wedge: step around the obstruction toward the player.
      if (this.frustration > 4) {
        const ang = Math.atan2(ctx.player.x - pos.x, ctx.player.z - pos.z)
          + (Math.random() - 0.5) * 1.6;
        const nx = pos.x + Math.sin(ang) * 2.2;
        const nz = pos.z + Math.cos(ang) * 2.2;
        if (!ctx.blocked(nx, nz)) { pos.x = nx; pos.z = nz; }
        this.frustration = 0;
        this.patrolTarget = null;
      }
    }
  }

  _animate(dt) {
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    if (this.walking) {
      this.legL.rotation.x = s * 0.62;
      this.legR.rotation.x = -s * 0.62;
      this.body.position.y = this.body.userData.baseY ?? (this.body.userData.baseY = this.body.position.y);
      this.body.position.y += 0; // keep hip height stable; bob comes from the torso tilt
      this.body.rotation.z = s * 0.03;
      this.armL.rotation.x = -0.25 + s * 0.22;
    } else {
      this.legL.rotation.x *= 0.85;
      this.legR.rotation.x *= 0.85;
      this.body.rotation.z *= 0.85;
      this.armL.rotation.x = THREE.MathUtils.damp(this.armL.rotation.x, -0.25, 6, dt);
    }
    // gun arm tracks forward whenever the robot is engaged
    const aiming = this.state === STATE.ATTACK || this.state === STATE.CHASE;
    this.armR.rotation.x = THREE.MathUtils.damp(this.armR.rotation.x, aiming ? -1.45 : -0.2, 8, dt);

    // eye pulses faster the more alert it is
    const alert = this.state === STATE.ATTACK ? 9 : this.state === STATE.CHASE ? 5 : 2;
    const pulse = 0.65 + 0.35 * Math.sin(performance.now() * 0.001 * alert + this.phase);
    this.eye.material.opacity = 1;
    this.eye.scale.setScalar(this.hitFlash > 0 ? 1.6 : pulse);
  }

  _death(dt) {
    this.deathT += dt;
    const t = Math.min(1, this.deathT / 0.55);
    const e = t * t * (3 - 2 * t);
    this.body.rotation.x = e * 1.5;
    this.body.rotation.z = e * 0.4 * this.deathSpin;
    this.body.position.y = (this.body.userData.baseY ?? this.body.position.y) - e * 0.6;
    this.legL.rotation.x = -e * 0.8;
    this.legR.rotation.x = -e * 0.5;
    this.armR.rotation.x = -1.45 + e * 1.2;
    this.eye.scale.setScalar(Math.max(0, 1 - t * 1.5));
    if (this.deathT > 1.9) this.root.position.y = -(this.deathT - 1.9) * 1.3;
  }

  get removable() { return this.dead && this.deathT > 2.7; }
}

// Which chassis are legal at a given wave, weighted so early waves stay light.
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
