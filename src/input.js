// Input for both desktop and touch.
//
// Desktop: WASD, mouse look (pointer lock), left mouse fire, right mouse ADS,
// R reload, Space jump, Ctrl/C crouch, Shift sprint, 1-4 weapons, wheel swap,
// Esc pause.
//
// Touch: floating movement stick on the left, drag to look on the right, and
// on-screen buttons that capture their own pointer so they never fight the
// look drag.
//
// Look deltas are raw pixels consumed once per frame. No smoothing is applied
// anywhere -- smoothing is exactly what makes touch aiming feel like it lags
// behind your thumb.

const STICK_RADIUS = 62;
const STICK_DEAD = 5;

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.dx = 0; this.dy = 0;
    this.moveX = 0; this.moveY = 0;

    this.firing = false;
    this.ads = false;
    this.sprint = false;
    this.crouch = false;
    this.jumpQueued = false;
    this.reloadQueued = false;
    this.switchQueued = null;
    this.pauseQueued = false;

    this.lookId = null; this.lx = 0; this.ly = 0;
    this.stickId = null;
    this.stickOx = 0; this.stickOy = 0;
    this.stickX = 0; this.stickY = 0;
    this.stickActive = false;

    this.pointerLocked = false;
    this.invertY = false;
    this.keys = new Set();
    this.enabled = true;
    this._bind();
  }

  get halfWidth() { return (window.innerWidth || 800) * 0.42; }

  _bind() {
    const c = this.canvas;
    const opt = { passive: false };

    c.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      if (e.pointerType === 'mouse') {
        if (e.button === 0) this.firing = true;
        if (e.button === 2) this.ads = true;
        if (this.lookId === null) { this.lookId = e.pointerId; this.lx = e.clientX; this.ly = e.clientY; }
        c.setPointerCapture?.(e.pointerId);
        if (!this.pointerLocked && c.requestPointerLock) c.requestPointerLock();
        return;
      }
      if (e.clientX < this.halfWidth && this.stickId === null) {
        this.stickId = e.pointerId;
        this.stickOx = this.stickX = e.clientX;
        this.stickOy = this.stickY = e.clientY;
        this.stickActive = true;
      } else if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.lx = e.clientX; this.ly = e.clientY;
      }
      c.setPointerCapture?.(e.pointerId);
    }, opt);

    c.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      if (e.pointerId === this.stickId) {
        e.preventDefault();
        this.stickX = e.clientX; this.stickY = e.clientY;
        let ox = e.clientX - this.stickOx, oy = e.clientY - this.stickOy;
        const d = Math.hypot(ox, oy);
        // drag past the ring and the origin follows, so the stick never caps
        // out silently under the thumb
        if (d > STICK_RADIUS) {
          const pull = d - STICK_RADIUS;
          this.stickOx += (ox / d) * pull;
          this.stickOy += (oy / d) * pull;
          ox = (ox / d) * STICK_RADIUS; oy = (oy / d) * STICK_RADIUS;
        }
        this.moveX = Math.abs(ox) < STICK_DEAD ? 0 : ox / STICK_RADIUS;
        this.moveY = Math.abs(oy) < STICK_DEAD ? 0 : oy / STICK_RADIUS;
        this.sprint = Math.hypot(this.moveX, this.moveY) > 0.9;
        return;
      }
      if (e.pointerId !== this.lookId) return;
      if (this.pointerLocked && e.pointerType === 'mouse') return;
      e.preventDefault();
      this.dx += e.clientX - this.lx;
      this.dy += e.clientY - this.ly;
      this.lx = e.clientX; this.ly = e.clientY;
    }, opt);

    const up = (e) => {
      if (e.pointerId === this.stickId) {
        this.stickId = null; this.stickActive = false;
        this.moveX = 0; this.moveY = 0; this.sprint = false;
      }
      if (e.pointerId === this.lookId) {
        this.lookId = null;
        if (e.pointerType === 'mouse') {
          if (e.button === 0) this.firing = false;
          if (e.button === 2) this.ads = false;
        }
      }
    };
    c.addEventListener('pointerup', up, opt);
    c.addEventListener('pointercancel', up, opt);
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === c;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || !this.enabled) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    c.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.switchQueued = e.deltaY > 0 ? 'next' : 'prev';
    }, opt);

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Escape') { this.pauseQueued = true; return; }
      if (!this.enabled) return;
      if (e.code === 'Space') { e.preventDefault(); this.jumpQueued = true; }
      if (e.code === 'KeyR') this.reloadQueued = true;
      if (e.code === 'Digit1') this.switchQueued = 'rifle';
      if (e.code === 'Digit2') this.switchQueued = 'smg';
      if (e.code === 'Digit3') this.switchQueued = 'shotgun';
      if (e.code === 'Digit4') this.switchQueued = 'sniper';
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.firing = false; });
  }

  // Wire an on-screen button to a boolean this object exposes.
  bindHold(el, prop) {
    if (!el) return;
    const on = (e) => { e.preventDefault(); e.stopPropagation(); this[prop] = true; el.classList.add('down'); };
    const off = (e) => { e.preventDefault(); e.stopPropagation(); this[prop] = false; el.classList.remove('down'); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  }

  bindToggle(el, prop) {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this[prop] = !this[prop];
      el.classList.toggle('down', this[prop]);
    });
  }

  bindTap(el, fn) {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      el.classList.add('down');
      fn();
    });
    const off = () => el.classList.remove('down');
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
  }

  take() {
    const k = this.keys;
    let mx = this.moveX, my = this.moveY, sprint = this.sprint;
    const kx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const ky = (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0);
    if (kx || ky) {
      const m = Math.hypot(kx, ky) || 1;
      mx = kx / m; my = ky / m;
      sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    }
    const r = {
      dx: this.dx, dy: this.dy * (this.invertY ? -1 : 1),
      moveX: mx, moveY: my,
      firing: this.firing,
      ads: this.ads,
      sprint,
      crouch: this.crouch || k.has('ControlLeft') || k.has('KeyC'),
      jump: this.jumpQueued,
      reload: this.reloadQueued,
      switchTo: this.switchQueued,
      pause: this.pauseQueued,
    };
    this.dx = 0; this.dy = 0;
    this.jumpQueued = false;
    this.reloadQueued = false;
    this.switchQueued = null;
    this.pauseQueued = false;
    return r;
  }

  reset() {
    this.dx = this.dy = 0;
    this.moveX = this.moveY = 0;
    this.firing = false; this.sprint = false; this.crouch = false;
    this.jumpQueued = this.reloadQueued = this.pauseQueued = false;
    this.switchQueued = null;
    this.lookId = null; this.stickId = null; this.stickActive = false;
    this.keys.clear();
  }
}
