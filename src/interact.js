import * as THREE from 'three';

// Interaction system.
//
// A registry of things the player can use, each with a world position, a reach,
// a prompt and an action. Only registered objects are interactable -- the spec
// is explicit that a prompt on every crate is noise.
//
// Selection is by distance AND view angle, so standing near two terminals and
// looking at one picks the one you are looking at.

export class Interactables {
  constructor() {
    this.items = [];
    this.current = null;
    this._v = new THREE.Vector3();
  }

  clear() { this.items.length = 0; this.current = null; }

  // opts: { id, pos, prompt, reach, once, needs, lockedPrompt, onUse, enabled }
  add(opts) {
    const it = {
      id: opts.id,
      pos: opts.pos.clone ? opts.pos.clone() : new THREE.Vector3(opts.pos[0], opts.pos[1], opts.pos[2]),
      prompt: opts.prompt || 'Interact',
      reach: opts.reach || 2.4,
      once: opts.once !== false,
      needs: opts.needs || null,          // keycard level required
      lockedPrompt: opts.lockedPrompt || null,
      onUse: opts.onUse || (() => {}),
      used: false,
      enabled: opts.enabled !== false,
      mesh: opts.mesh || null,
    };
    this.items.push(it);
    return it;
  }

  remove(id) {
    const i = this.items.findIndex((x) => x.id === id);
    if (i >= 0) this.items.splice(i, 1);
  }

  get(id) { return this.items.find((x) => x.id === id) || null; }

  // Nearest usable item the player is actually looking at.
  pick(camera, playerState) {
    const eye = this._v.set(playerState.x, playerState.y + 1.6, playerState.z);
    const fwd = new THREE.Vector3(-Math.sin(playerState.yaw), 0, -Math.cos(playerState.yaw));
    let best = null, bestScore = -Infinity;
    for (const it of this.items) {
      if (!it.enabled || (it.once && it.used)) continue;
      const d = eye.distanceTo(it.pos);
      if (d > it.reach) continue;
      const to = it.pos.clone().sub(eye);
      to.y = 0;
      const len = to.length();
      // Very close by, facing barely matters; further out it must be in front.
      const dot = len < 0.4 ? 1 : to.normalize().dot(fwd);
      if (dot < 0.35) continue;
      const score = dot * 2 - d * 0.4;
      if (score > bestScore) { bestScore = score; best = it; }
    }
    this.current = best;
    return best;
  }

  // Returns { ok, message } so the HUD can say why nothing happened.
  use(item, state) {
    if (!item || !item.enabled || (item.once && item.used)) return { ok: false };
    if (item.needs && (state.keycard || 0) < item.needs) {
      return { ok: false, message: item.lockedPrompt || ('REQUIRES LEVEL ' + item.needs + ' KEYCARD') };
    }
    item.used = true;
    const r = item.onUse(item) || {};
    return { ok: true, ...r };
  }
}
