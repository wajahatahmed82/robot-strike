// Input stress test.
//
// Dispatches genuine KeyboardEvent / MouseEvent objects at the real listeners
// rather than poking flags, so it exercises the same path a player does. Every
// case asserts that *all* requested actions are simultaneously live and that
// the player actually moved when movement was requested.
//
// Load in the console:  const t = await import('/tools/inputstress.js'); t.run(__rs)

const KEY = {
  W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD',
  Shift: 'ShiftLeft', Ctrl: 'ControlLeft', Space: 'Space', R: 'KeyR',
  One: 'Digit1', Two: 'Digit2', Three: 'Digit3', Four: 'Digit4',
};

function keyDown(code) {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
}
function keyUp(code) {
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
}
function mouseDown(canvas, button) {
  canvas.dispatchEvent(new MouseEvent('mousedown', { button, bubbles: true, cancelable: true }));
}
function mouseUp(button) {
  window.dispatchEvent(new MouseEvent('mouseup', { button, bubbles: true, cancelable: true }));
}

export function run(rs, opts = {}) {
  const { game, input, step, MODE, prog } = rs;
  // Unlock every weapon, otherwise the switch case is refused for being locked
  // and looks like an input failure.
  if (prog) { prog.data.level = Math.max(prog.data.level, 6); }
  const canvas = document.getElementById('view');
  const frames = opts.frames || 30;
  const results = [];

  game.start(MODE.SURVIVAL);
  game.player.state.health = 1e6;          // survive the whole sweep

  const press = (spec) => {
    for (const k of spec.keys || []) keyDown(KEY[k] || k);
    for (const b of spec.buttons || []) mouseDown(canvas, b);
  };
  const release = (spec) => {
    for (const k of spec.keys || []) keyUp(KEY[k] || k);
    for (const b of spec.buttons || []) mouseUp(b);
  };

  const cases = [
    { name: 'W',                         keys: ['W'],                       buttons: [],     expect: ['move'] },
    { name: 'W + Shift',                 keys: ['W', 'Shift'],              buttons: [],     expect: ['move', 'sprint'] },
    { name: 'W + Shift + LMB',           keys: ['W', 'Shift'],              buttons: [0],    expect: ['move', 'sprint', 'fire'] },
    { name: 'W + A + Shift + LMB',       keys: ['W', 'A', 'Shift'],         buttons: [0],    expect: ['move', 'sprint', 'fire'] },
    { name: 'W + D + Shift + LMB',       keys: ['W', 'D', 'Shift'],         buttons: [0],    expect: ['move', 'sprint', 'fire'] },
    { name: 'W + RMB + LMB',             keys: ['W'],                       buttons: [2, 0], expect: ['move', 'aim', 'fire'] },
    { name: 'W + Shift + RMB + LMB',     keys: ['W', 'Shift'],              buttons: [2, 0], expect: ['move', 'fire', 'aim'] },
    { name: 'W + A + Space + LMB',       keys: ['W', 'A', 'Space'],         buttons: [0],    expect: ['move', 'fire', 'jump'] },
    { name: 'Crouch + move + aim',       keys: ['W', 'Ctrl'],               buttons: [2],    expect: ['move', 'crouch', 'aim'] },
    { name: 'Crouch + move + aim + fire', keys: ['S', 'Ctrl'],              buttons: [2, 0], expect: ['move', 'crouch', 'aim', 'fire'] },
    { name: 'Reload + movement',         keys: ['W', 'R'],                  buttons: [],     expect: ['move', 'reload'] },
    { name: 'Weapon switch + movement',  keys: ['W', 'Two'],                buttons: [],     expect: ['move', 'switch'] },
    { name: 'All at once',               keys: ['W', 'D', 'Shift', 'Ctrl'], buttons: [2, 0], expect: ['move', 'fire', 'aim', 'crouch'] },
  ];

  for (const c of cases) {
    input.releaseAll();
    game.player.state.x = 0; game.player.state.z = 6;
    game.player.state.vx = 0; game.player.state.vz = 0;
    game.player.state.y = 0; game.player.state.crouch = 0;
    game.weapons.reserve[game.weapons.current] = 999;
    // Leave the magazine part-empty: a full magazine legitimately refuses to
    // reload, which would read as an input failure rather than correct rules.
    game.weapons.ammo[game.weapons.current] = Math.max(1, game.weapons.magSize - 5);
    game.weapons.reloading = 0; game.weapons.swapT = 0;
    step(1 / 60);

    const before = { x: game.player.state.x, z: game.player.state.z, weapon: game.weapons.current };
    press(c);

    // Observe across many frames: a bug that only bites after the first frame
    // (a latch that never clears) has to be caught too.
    const seen = { move: false, sprint: false, fire: false, aim: false,
                   crouch: false, jump: false, reload: false, switch: false };
    let shotsAtStart = game.weapons.shotsFired;
    let jumped = false;
    let reloadSeen = false;

    for (let i = 0; i < frames; i++) {
      const wasGrounded = game.player.state.grounded;
      step(1 / 60);
      const p = game.player.state;
      if (Math.hypot(p.vx, p.vz) > 0.4) seen.move = true;
      if (p.sprinting) seen.sprint = true;
      if (game.weapons.ads > 0.25) seen.aim = true;
      if (p.crouch > 0.4) seen.crouch = true;
      if (!p.grounded && wasGrounded) jumped = true;
      if (game.weapons.reloading > 0) reloadSeen = true;
    }
    seen.fire = game.weapons.shotsFired > shotsAtStart;
    seen.jump = jumped;
    seen.reload = reloadSeen;
    seen.switch = game.weapons.current !== before.weapon;

    const moved = Math.hypot(game.player.state.x - before.x, game.player.state.z - before.z);
    const missing = c.expect.filter((k) => !seen[k]);
    // Anything not asked for must not have latched on by itself.
    const stray = Object.keys(seen).filter((k) => seen[k] && !c.expect.includes(k)
      && !(k === 'sprint' && c.expect.includes('move')));

    results.push({
      case: c.name,
      pass: missing.length === 0,
      missing,
      stray,
      movedMetres: +moved.toFixed(2),
    });

    release(c);
    // After release everything must fall back to idle within a few frames.
    for (let i = 0; i < 10; i++) step(1 / 60);
    const stuck = Object.entries({
      fire: input.held.fire, aim: input.held.aim, crouch: input.held.crouch,
      sprint: input.held.sprint, forward: input.held.forward,
      left: input.held.left, right: input.held.right, back: input.held.back,
    }).filter(([, v]) => v).map(([k]) => k);
    if (stuck.length) results[results.length - 1].stuckAfterRelease = stuck;
  }

  input.releaseAll();
  const failed = results.filter((r) => !r.pass || r.stuckAfterRelease || (r.stray && r.stray.length));
  return { total: results.length, passed: results.length - failed.length, failed, results };
}
