import * as THREE from 'three';

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.4, 'rgba(220,200,170,0.45)');
  grad.addColorStop(1, 'rgba(200,180,150,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class FX {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;

    // Tracers are pooled: a stretched cylinder from muzzle to impact point.
    this.tracerGeo = new THREE.CylinderGeometry(0.011, 0.011, 1, 5, 1, true);
    this.tracerGeo.translate(0, 0.5, 0);          // pivot at the base
    this.tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffd694, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false,
    });
    this.tracers = [];
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(this.tracerGeo, this.tracerMat.clone());
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
    this.tracerI = 0;

    // Impact puffs
    const tex = puffTexture();
    this.puffs = [];
    for (let i = 0; i < 18; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false, fog: true,
      }));
      s.visible = false;
      scene.add(s);
      this.puffs.push({ sprite: s, life: 0, max: 1, size: 1 });
    }
    this.puffI = 0;

    // Sparks for armour hits
    this.sparkGeo = new THREE.BoxGeometry(0.028, 0.028, 0.028);
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc86a, fog: false });
    this.sparks = [];
    // Particle budget, driven by the Effects graphics setting. Sparks are
    // individual meshes, so this is the one effect worth capping.
    this.budget = { sparkCap: 90, sparkMul: 1.0, puffs: true };

    this.shakeAmt = 0;
    this.shake = new THREE.Vector2();
  }

  tracer(from, to, colour) {
    const t = this.tracers[this.tracerI];
    this.tracerI = (this.tracerI + 1) % this.tracers.length;
    t.mesh.material.color.setHex(colour === undefined ? 0xffd694 : colour);
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.01) return;
    t.mesh.position.copy(from);
    t.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    t.mesh.scale.set(1, len, 1);
    t.mesh.visible = true;
    t.mesh.material.opacity = 0.85;
    t.life = 0.055;
  }

  puff(pos, size = 0.55, color = 0xd8c4a0) {
    const p = this.puffs[this.puffI];
    this.puffI = (this.puffI + 1) % this.puffs.length;
    p.sprite.position.copy(pos);
    p.sprite.material.color.setHex(color);
    p.sprite.material.opacity = 0.8;
    p.sprite.scale.setScalar(size * 0.5);
    p.size = size;
    p.life = p.max = 0.42;
    p.sprite.visible = true;
  }

  setBudget(level) {
    if (level === 'low') this.budget = { sparkCap: 24, sparkMul: 0.35, puffs: false };
    else if (level === 'high') this.budget = { sparkCap: 160, sparkMul: 1.4, puffs: true };
    else this.budget = { sparkCap: 90, sparkMul: 1.0, puffs: true };
  }

  sparkBurst(pos, normal, n = 8) {
    n = Math.max(1, Math.round(n * this.budget.sparkMul));
    for (let i = 0; i < n; i++) {
      if (this.sparks.length > this.budget.sparkCap) break;
      const m = new THREE.Mesh(this.sparkGeo, this.sparkMat);
      m.position.copy(pos);
      const v = normal.clone().multiplyScalar(1.4 + Math.random() * 2.2);
      v.x += (Math.random() - 0.5) * 3.4;
      v.y += Math.random() * 2.6;
      v.z += (Math.random() - 0.5) * 3.4;
      this.scene.add(m);
      this.sparks.push({ mesh: m, vel: v, life: 0.28 + Math.random() * 0.3 });
    }
  }

  // Robot death: a bright core flash, a ring of sparks, and a smoke puff.
  explode(pos, colour) {
    this.puff(pos, 1.5, colour);
    if (this.budget.puffs) this.puff(pos, 0.9, 0xffffff);
    for (let i = 0; i < (this.budget.puffs ? 3 : 1); i++) {
      const n = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize();
      this.sparkBurst(pos, n, 9);
    }
    this.addShake(0.012);
  }

  addShake(v) { this.shakeAmt = Math.min(0.06, this.shakeAmt + v); }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.055) * 0.85;
      if (t.life <= 0) t.mesh.visible = false;
    }

    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const k = 1 - p.life / p.max;
      p.sprite.scale.setScalar(p.size * (0.5 + k * 1.5));
      p.sprite.material.opacity = Math.max(0, (1 - k) * 0.8);
      if (p.life <= 0) p.sprite.visible = false;
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) { this.scene.remove(s.mesh); this.sparks.splice(i, 1); continue; }
      s.vel.y -= 14 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      const sc = Math.max(0.15, s.life * 3);
      s.mesh.scale.setScalar(sc);
    }

    this.shakeAmt *= Math.pow(0.0012, dt);
    if (this.shakeAmt < 0.0006) this.shakeAmt = 0;
    this.shake.set((Math.random() - 0.5) * this.shakeAmt, (Math.random() - 0.5) * this.shakeAmt);
  }

  clear() {
    for (const t of this.tracers) { t.life = 0; t.mesh.visible = false; }
    for (const p of this.puffs) { p.life = 0; p.sprite.visible = false; }
    for (const s of this.sparks) this.scene.remove(s.mesh);
    this.sparks.length = 0;
    this.shakeAmt = 0;
  }
}
