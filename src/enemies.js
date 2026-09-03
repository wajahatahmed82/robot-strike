import * as THREE from 'three';
import { CFG } from './config.js';
import { createSoldier, poseSoldier, KIT, BONE } from './soldier.js';

// Hostile soldiers: five loadouts, one shared code path.
//
// The body is a skinned mesh over a 19-bone skeleton (see soldier.js), so
// elbows, knees and shoulders deform instead of pivoting as separate parts.
// Geometry and material are shared per loadout; only the skeleton is per
// instance. Animation is one blended pose function rather than a clip switch,
// so walking, aiming, recoil and a flinch can all be true at the same time.
//
// Hits throw dust and kit fragments, never blood. That keeps the age rating
// low and short-form platforms from suppressing clips, at no cost to feel.

export const STATE = {
  IDLE: 'idle', PATROL: 'patrol', ALERT: 'alert', CHASE: 'chase',
  ATTACK: 'attack', SEARCH: 'search', RETREAT: 'retreat', DEAD: 'dead',
};

export { KIT };

// The bind pose stands 1.74m to the crown; the wave scales were tuned against
// the older 1.98m parts model, so the whole rig is scaled to match rather than
// re-tuning every spec.
const MODEL_SCALE = 1.14;

const HITBOX = new THREE.MeshBasicMaterial({ visible: false });
let nextId = 1;

export class Enemy {
  constructor(type, x, z, tier) {
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

    // Character space has the feet at y=0, so the body group sits at the root.
    // MODEL_SCALE brings the bind pose to the ~1.98m the wave scales expect, so
    // spec.scale keeps meaning what it meant for the old parts-based soldier.
    this.body = new THREE.Group();
    this.body.scale.setScalar(MODEL_SCALE);   // build variation applied below
    this.root.add(this.body);

    const built = createSoldier(type);
    this.body.scale.setScalar(MODEL_SCALE * built.build);
    this.mesh = built.mesh;
    this.bones = built.bones;
    this.mount = built.mount;
    this.skeleton = built.skeleton;
    this.arms = built.arms;
    this.body.add(this.mesh);

    // Animation weights, all live at once rather than one exclusive state.
    this.aimW = 0;
    this.walkW = 0;
    this.fireT = 0;
    this.hitT = 0;
    this.hitSide = 1;
    this.breathe = Math.random() * Math.PI * 2;
    this.poseSkip = (this.id * 5) % 3;
    this.dist = 99;

    // Sight origin, roughly eye height. The AI traces from here.
    this.head = new THREE.Object3D();
    this.head.position.set(0, 1.60, 0.09);
    this.body.add(this.head);

    // Muzzle rides the weapon, so it points wherever the hands do.
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.012, built.gunLen * 1.05);
    this.mount.add(this.muzzle);

    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.17, 0.17),
      new THREE.MeshBasicMaterial({
        color: 0xffc06a, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
    this.flash.position.copy(this.muzzle.position);
    this.flash.visible = false;
    this.mount.add(this.flash);

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
    add(0.26, 0.28, 0.27, 1.60, 'head', CFG.weapons.rifle.headMul);
    add(0.44, 0.46, 0.30, 1.20, 'body', 1.0);
    add(0.60, 0.34, 0.26, 1.28, 'arms', 0.75);
    add(0.38, 0.86, 0.28, 0.52, 'legs', 0.65);
  }

  damage(amount, part) {
    if (this.dead) return { killed: false };
    this.hp -= amount;
    this.hitFlash = 1;
    this.hitT = 1;
    this.hitSide = Math.random() < 0.5 ? -1 : 1;
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
    this.dist = dist;
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
      // A marksman backs off rather than closing, so it stays a ranged threat.
      const keep = this.spec.keepDistance;
      if (keep && dist < keep) {
        wantX = -dx / dist; wantZ = -dz / dist;
        moving = true;
        this._shoot(dt, ctx, dist, canSee);
        this.walkingOverride = true;
      }
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
    this.fireT = 1;
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
    // Animation LOD. A soldier 30m away is a few pixels tall; posing 19 bones
    // for it every frame is most of the simulation cost at 40 enemies. Far
    // ones pose every third frame and stop casting shadows, which is the
    // single biggest render saving and is not visible in play.
    const far = this.dist > 26;
    if (far) {
      this.poseSkip = (this.poseSkip + 1) % 3;
      if (this.poseSkip !== 0) {
        this._flashDecay(dt);
        return;
      }
      dt *= 3;
    }
    if (this.mesh.castShadow !== (this.dist < 24)) this.mesh.castShadow = this.dist < 24;

    // Weights ease toward their targets so the soldier never snaps between
    // stances. Every weight is independent; walking while aiming while
    // recoiling is one pose, not three competing clips.
    const wantWalk = this.walking ? 1 : 0;
    this.walkW += (wantWalk - this.walkW) * Math.min(1, dt * 9);
    const wantAim = (this.state === STATE.ATTACK || this.state === STATE.CHASE) ? 1 : 0;
    this.aimW += (wantAim - this.aimW) * Math.min(1, dt * 5);
    this.fireT = Math.max(0, this.fireT - dt * 6);
    this.hitT = Math.max(0, this.hitT - dt * 4.5);
    this.breathe += dt * 1.6;

    this.skeleton.needsPose = true;
    poseSoldier(this.bones, {
      phase: this.phase,
      arms: this.arms,
      walk: this.walkW,
      aim: this.aimW,
      fire: this.fireT,
      hit: this.hitT,
      hitSide: this.hitSide,
      death: 0,
      breathe: this.breathe,
    });

    this._flashDecay(dt);
  }

  _flashDecay(dt) {
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
    const t = Math.min(1, this.deathT / 0.75);
    const e = t * t * (3 - 2 * t);
    this.skeleton.needsPose = true;
    poseSoldier(this.bones, {
      phase: this.phase,
      arms: this.arms,
      walk: 0,
      aim: 0,
      fire: 0,
      hit: 0,
      death: e,
      deathSpin: this.deathSpin,
      breathe: this.breathe,
    });
    // sink out of sight once the fall has finished, then the wave frees it
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
