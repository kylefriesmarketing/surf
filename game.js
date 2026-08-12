// SURF — the loop: input, camera, scoring, and the wiring between sim and view.

import * as THREE from 'three';
import * as W from './wave.js';
import { WAVE } from './wave.js';
import { createRider, stepRider, takeoffSpot, TUNE } from './board.js';
import { createTrickState, updateTricks } from './tricks.js';
import { SprayFX } from './particles.js';
import { Ocean, Curl, createSky, createLights, SUN } from './render.js';
import * as SFX from './sfx.js';

const SUB = 1 / 120;          // the sim always steps at a fixed 120 Hz
const MAX_FRAME = 0.1;

const el = (id) => document.getElementById(id);

// ---------------------------------------------------------------- scene
const canvas = el('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
// Matched to the ocean shader's own distance fade (85→205 to PAL.horizon); the
// grid and the far plane have to reach the same colour at the same range or the
// boundary between them reads as a line drawn across the sea.
scene.fog = new THREE.Fog(0xe8b48a, 85, 205);
const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.1, 5000);

createSky(scene);
createLights(scene);
const ocean = new Ocean(scene);
const curl = new Curl(scene);
const fx = new SprayFX(scene);

let rig = null;
import('./render.js').then((m) => { rig = m.createRig(scene); });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- input
const keys = new Set();
const DOWN = { a: 1, d: 1, w: 1, s: 1, arrowleft: 1, arrowright: 1, arrowup: 1, arrowdown: 1, ' ': 1, shift: 1, r: 1, m: 1 };
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (DOWN[k]) e.preventDefault();
  if (k === 'r') restart();
  if (k === 'm') { muted = !muted; SFX.setMuted(muted); el('mute').textContent = muted ? '🔇' : '🔊'; }
  keys.add(k);
  begin();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// Touch: left/right half of the screen carves, a second finger pumps.
let touchCarve = 0, touchPump = false;
const touchState = new Map();
function readTouches(e) {
  touchState.clear();
  for (const t of e.touches) touchState.set(t.identifier, t.clientX);
  const xs = [...touchState.values()];
  touchCarve = xs.length ? (xs[0] < innerWidth / 2 ? -1 : 1) : 0;
  touchPump = xs.length > 1;
}
for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
  addEventListener(ev, (e) => { e.preventDefault(); readTouches(e); begin(); }, { passive: false });
}

let muted = false;
let started = false;
function begin() {
  if (started) return;
  started = true;
  SFX.init(); SFX.resume();
  el('intro').classList.add('gone');
}
canvas.addEventListener('pointerdown', begin);

function input() {
  let carve = touchCarve;
  if (keys.has('a') || keys.has('arrowleft')) carve -= 1;
  if (keys.has('d') || keys.has('arrowright')) carve += 1;
  return {
    carve: Math.max(-1, Math.min(1, carve)),
    pump: keys.has(' ') || keys.has('w') || keys.has('arrowup') || touchPump ? 1 : 0,
    tuck: keys.has('shift') || keys.has('s') || keys.has('arrowdown') ? 1 : 0,
  };
}

// ---------------------------------------------------------------- run state
let t, rider, run, trickState;
// A session is a SET of five waves. `run` is one wave; `session` carries the total.
let session = { wave: 0, total: 0, log: [], best: loadBest(), done: false };

function startWave(i) {
  const preset = W.setWave(i);
  session.wave = i;
  session.done = false;
  t = 4.0;
  rider = createRider(t);
  trickState = createTrickState();
  const s = takeoffSpot(t);
  rider.p.x = s.x; rider.p.z = s.z; rider.p.y = W.height(s.x, s.z, t);
  rider.v.x = 5; rider.v.z = -1;
  run = {
    waveName: preset.name, startX: rider.p.x, dist: 0, score: 0,
    barrelTime: 0, tubes: 0, airs: 0, tricks: 0,
    combo: 1, comboT: 0, topSpeed: 0, over: false, msg: '', msgT: 0,
    wasBarrel: false, wasAir: false, barrelSeg: 0,
  };
  el('over').classList.remove('show');
  el('wave-name').textContent = `WAVE ${i + 1}/${W.SET.length} · ${preset.name}`;
  flash(preset.name);
}

/** R: next wave if one is waiting, otherwise start the set over. */
function restart() {
  if (run && run.over && !session.done) startWave(session.wave + 1);
  else { session = { wave: 0, total: 0, log: [], best: session.best, done: false }; startWave(0); }
}
function loadBest() {
  const v = parseFloat(localStorage.getItem('surf-best') || '0');
  return Number.isFinite(v) ? v : 0;
}
startWave(0);

function flash(text) { run.msg = text; run.msgT = 1.6; }

// ---------------------------------------------------------------- scoring
function score(dt, ev) {
  if (run.over) return;
  run.dist = rider.p.x - run.startX;
  run.topSpeed = Math.max(run.topSpeed, rider.speed);

  // Sitting in the pocket is worth more than racing the shoulder, and the tube is
  // worth a lot more than either. The multiplier is what makes a greedy line pay.
  const pocket = rider.pocket;
  run.score += dt * rider.speed * (0.55 + pocket * 1.9) * run.combo;

  if (rider.barrel > 0.5) {
    run.barrelTime += dt;
    run.score += dt * 130 * run.combo;
    run.comboT = 2.2;
    if (!run.wasBarrel) {
      run.tubes++; run.combo = Math.min(8, run.combo + 1);
      flash('IN THE TUBE'); SFX.hit('score');
    }
    run.wasBarrel = true;
  } else {
    if (run.wasBarrel) {
      flash(`TUBE  +${Math.round(run.barrelSeg * 260)}`);
      run.score += run.barrelSeg * 260;
      SFX.hit('spit');
      fx.spit(rider.p.x + 3, rider.p.y + 1.2, rider.p.z - 1, 1.1);
    }
    run.wasBarrel = false;
  }
  run.barrelSeg = rider.barrel > 0.5 ? (run.barrelSeg || 0) + dt : 0;

  if (ev.slide > 0.5) {
    run.score += dt * ev.slide * 1.4 * run.combo;
    run.comboT = 1.6;
  }
  if (ev.launched) run.airs++;

  // Named manoeuvres, recognised from what the board actually did.
  for (const m of updateTricks(trickState, rider, ev, t, dt)) {
    const pts = Math.round(m.points * run.combo);
    run.score += pts;
    run.tricks++;
    run.combo = Math.min(8, run.combo + (m.points >= 250 ? 0.7 : 0.4));
    run.comboT = m.hold;
    flash(`${m.name}  +${pts}`);
    SFX.hit('score');
  }

  run.comboT -= dt;
  if (run.comboT <= 0) { run.combo = Math.max(1, run.combo - dt * 1.1); }

  if (rider.p.x - run.startX > WAVE.rideLength) finish('THE WAVE RUNS OUT');
}

function finish(reason) {
  if (run.over) return;
  run.over = true; run.reason = reason;
  session.total += run.score;
  session.log.push({ name: run.waveName, score: Math.round(run.score), reason,
                     dist: run.dist, barrel: run.barrelTime });

  const last = session.wave >= W.SET.length - 1;
  session.done = last;

  if (!last) {
    // Between waves: this wave's card, then paddle back out for the next one.
    el('ov-title').textContent = reason;
    el('ov-score').textContent = Math.round(run.score).toLocaleString();
    el('ov-lines').innerHTML =
      `<div><b>${run.dist.toFixed(0)}</b> m ridden · <b>${run.tricks}</b> manoeuvre${run.tricks === 1 ? '' : 's'}</div>` +
      `<div><b>${run.barrelTime.toFixed(1)}</b> s barrelled · ${run.tubes} tube${run.tubes === 1 ? '' : 's'}</div>` +
      `<div><b>${(run.topSpeed * 3.6).toFixed(0)}</b> km/h top speed</div>` +
      `<div class="best">SET TOTAL ${Math.round(session.total).toLocaleString()}</div>`;
    el('ov-again').textContent = `PRESS R FOR WAVE ${session.wave + 2} — ${W.SET[session.wave + 1].name}`;
  } else {
    // End of the set: the score that actually counts.
    if (session.total > session.best) {
      session.best = session.total;
      localStorage.setItem('surf-best', String(Math.round(session.total)));
      session.newBest = true;
    }
    el('ov-title').textContent = 'THE SET IS OVER';
    el('ov-score').textContent = Math.round(session.total).toLocaleString();
    el('ov-lines').innerHTML =
      session.log.map((w, i) =>
        `<div><span class="wv">${i + 1}. ${w.name}</span> <b>${w.score.toLocaleString()}</b>` +
        `<span class="wr">${w.reason.toLowerCase()}</span></div>`).join('') +
      `<div class="best">${session.newBest ? '★ NEW BEST SET' : 'best set ' + Math.round(session.best).toLocaleString()}</div>`;
    el('ov-again').textContent = 'PRESS R TO PADDLE BACK OUT';
  }
  el('over').classList.add('show');
}

// ---------------------------------------------------------------- camera
const camPos = new THREE.Vector3(0, 6, 20);
const camLook = new THREE.Vector3();
let camRoll = 0, camFov = 66;

function updateCamera(dt) {
  const p = rider.p;
  // Sit behind and outside the rider, looking down the line toward the section
  // that has not broken yet — which is where the wave, and the decision, is.
  const back = 8.6 + rider.speed * 0.30;
  const fh = Math.cos(rider.heading), fz = Math.sin(rider.heading);
  const inTube = rider.barrel > 0.5;

  // Sit SHOREWARD of the rider (-z) and low, so the wave face fills frame and the
  // curl throws over toward camera. Sitting seaward instead puts the camera behind
  // the crest, where all you can see is the smooth back of the wave and the sea
  // beyond it — technically a chase cam, but it frames the one part of a wave that
  // has nothing happening on it.
  //
  // In the tube the camera tucks in tight and drops almost to the water, deep under
  // the lip, so the curl wraps overhead and the exit is a bright hole down the line.
  // That framing only exists for a second or two a run, which is the point of it.
  const tubeBack = 4.6;
  const want = inTube
    ? new THREE.Vector3(
        p.x - fh * tubeBack + rider.lean * 0.5,
        p.y + 1.15,
        p.z - fz * tubeBack + 0.9)
    : new THREE.Vector3(
        p.x - fh * back + rider.lean * 1.4,
        p.y + 2.4 + rider.speed * 0.055,
        p.z - fz * back - 4.2);

  // Never let the camera end up under the water; nothing reads worse.
  const floor = W.height(want.x, want.z, t) + 1.1;
  if (want.y < floor) want.y = floor;

  const k = Math.min(1, dt * (rider.down ? 1.6 : 5.2));
  camPos.lerp(want, k);

  // Aim down the line, INTO the wave, and ABOVE the rider. Looking level puts the
  // horizon through the middle of frame and hands half the screen to empty water;
  // aiming high pushes the horizon down and lets the face fill the shot.
  const lookAhead = 6 + rider.speed * 0.55;
  camLook.lerp(inTube
    // Down the throat of the tube, not up at the ceiling.
    ? new THREE.Vector3(p.x + fh * 16, p.y + 1.9, p.z + fz * 8 + 1.5)
    : new THREE.Vector3(p.x + fh * lookAhead, p.y + 3.4, p.z + fz * lookAhead * 0.5 + 4.5),
    Math.min(1, dt * (inTube ? 7 : 5)));

  camera.position.copy(camPos);
  camera.lookAt(camLook);
  camRoll += (-rider.lean * 0.13 - camRoll) * Math.min(1, dt * 4);
  camera.rotateZ(camRoll);

  const wantFov = 64 + Math.min(20, rider.speed * 0.85) + (inTube ? 6 : 0);
  camFov += (wantFov - camFov) * Math.min(1, dt * 3);
  camera.fov = camFov;
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- HUD
let hudT = 0;
function updateHUD(dt) {
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.06;
  el('spd').textContent = (rider.speed * 3.6).toFixed(0);
  el('dist').textContent = run.dist.toFixed(0);
  el('score').textContent = Math.round(run.score).toLocaleString();
  el('combo').textContent = '×' + run.combo.toFixed(1);
  el('combo').style.opacity = run.combo > 1.15 ? 1 : 0.25;

  // The one gauge that matters: where you are relative to the breaking point.
  const lag = rider.lag ?? 0;
  const pos = Math.max(0, Math.min(1, (lag + 30) / 45));
  el('pip').style.left = (pos * 100) + '%';
  const zone = lag > 8 ? 'foam' : lag > 1 ? 'tube' : lag > -12 ? 'pocket' : 'shoulder';
  el('zone').textContent = zone.toUpperCase();
  el('zone').className = zone;

  el('msg').textContent = run.msgT > 0 ? run.msg : '';
  el('msg').style.opacity = run.msgT > 0 ? Math.min(1, run.msgT * 2) : 0;
  el('parts').textContent = fx.liveCount.toLocaleString();
}

// ---------------------------------------------------------------- loop
const heightAt = (x, z) => W.height(x, z, t);
let last = performance.now();
let acc = 0;
let fpsT = 0, fpsN = 0;

/**
 * One whole frame: sim, emitters, view, render. Split out of the rAF loop on
 * purpose — the Browser pane suspends requestAnimationFrame and never composites
 * this canvas, so verification and any offscreen capture have to drive frames by
 * hand through __surfStep. Anything that must appear in a captured frame belongs
 * in HERE, not in loop().
 */
function frame(dt, override) {
  // --- sim, fixed step
  acc += dt;
  let guard = 24;
  const inp = override || input();
  let agg = { slide: 0, launched: false, pumped: 0, splash: 0, wiped: null };
  while (acc >= SUB && guard-- > 0) {
    acc -= SUB;
    if (!run.over) {
      const ev = stepRider(rider, t, inp, SUB);
      agg.slide = Math.max(agg.slide, ev.slide);
      agg.launched = agg.launched || ev.launched;
      agg.pumped = Math.max(agg.pumped, ev.pumped);
      agg.splash = Math.max(agg.splash, ev.splash);
      if (ev.wiped) agg.wiped = ev.wiped;
      score(SUB, ev);
    }
    t += SUB;
  }

  if (agg.pumped > 0.3) SFX.hit('pump', Math.min(1, agg.pumped / 6));
  if (agg.splash > 1) { fx.splash(rider.p.x, rider.p.y, rider.p.z, agg.splash); SFX.hit('land', agg.splash); }
  if (agg.wiped) {
    fx.splash(rider.p.x, rider.p.y, rider.p.z, 14);
    SFX.hit('splash', 12);
    finish(agg.wiped === 'foam' ? 'CAUGHT INSIDE'
         : agg.wiped === 'pearl' ? 'PEARLED' : 'BLEW THE LANDING');
  }

  run.msgT -= dt;

  // --- emitters, all driven by sim quantities
  const p = rider.p;
  const fhx = Math.cos(rider.heading), fhz = Math.sin(rider.heading);
  if (!rider.air && !run.over) {
    fx.rail(p.x, p.y, p.z, fhx, fhz, agg.slide, rider.speed, dt);
    fx.wake(p.x, p.y, p.z, fhx, fhz, rider.speed, dt);
  }
  fx.lip(W.breakX(t), (x) => W.crestZ(x, t), (x) => W.lipHeight(x, t), p.x, dt, 1);
  fx.whitewater(W.breakX(t), (x) => W.crestZ(x, t), p.x, dt, 260);
  fx.update(dt, heightAt, -1.5, 0.6);

  // --- view
  ocean.update(t, p.x, camera);
  curl.update(t, p.x, camera);
  updateCamera(dt);
  // After the camera, because the FOV breathes with speed and point size depends
  // on it. Uses the drawing buffer height, not innerHeight — offscreen captures
  // resize the renderer without touching the window.
  fx.setViewport(renderer.domElement.height, camera.fov);

  if (rig) {
    rig.root.visible = !run.over || run.overT < 0.4;
    rig.root.position.set(p.x, p.y + 0.07, p.z);
    // Pitch the board along the slope it is actually sitting on, so it noses down
    // the drop and levels out in the trough.
    const hf = W.height(p.x + fhx * 0.9, p.z + fhz * 0.9, t);
    const hb = W.height(p.x - fhx * 0.9, p.z - fhz * 0.9, t);
    const pitch = Math.atan2(hf - hb, 1.8);
    rig.pose(rider.heading, rider.lean, rider.crouch, -pitch, 0);
  }

  SFX.frame({ foam: rider.foam, slide: agg.slide, speed: rider.speed,
              barrel: rider.barrel, down: run.over });

  updateHUD(dt);
  renderer.render(scene, camera);

  fpsN++; fpsT += dt;
  if (fpsT > 0.5) { el('fps').textContent = (fpsN / fpsT).toFixed(0); fpsT = 0; fpsN = 0; }
}

function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(MAX_FRAME, (now - last) / 1000);
  last = now;
  if (!started) dt = Math.min(dt, 1 / 60);
  frame(dt);
}
requestAnimationFrame(loop);

// ---------------------------------------------------------------- debug handles
window.__surf = () => ({ t, rider, run, session, trickState, fx, ocean, curl,
                         renderer, scene, camera, THREE });
window.__surfRestart = restart;

/**
 * The autopilot: the same cascade controller test-sim.mjs flies. Lag error picks a
 * target height on the face; that picks a heading. Low on the face is steep and
 * fast, high is flat and slow. Pass a wantLag: ~5 rides the tube and risks the
 * foam, ~0 sits in the pocket, negative plays it safe out on the shoulder.
 */
window.__surfAuto = (wantLag = 3) => {
  const relZ = rider.p.z - W.crestZ(rider.p.x, t);
  const lag = rider.lag ?? 0;
  const tgtZ = Math.max(-8, Math.min(-0.8, -4 + 0.42 * (lag - wantLag)));
  const tgtH = Math.max(-0.6, Math.min(0.5, 0.14 * (tgtZ - relZ)));
  return {
    carve: Math.max(-1, Math.min(1, (tgtH - rider.heading) * 3.5)),
    pump: lag > wantLag - 2 && (t * 120 | 0) % 34 === 0 ? 1 : 0,
    tuck: 0,
  };
};

/** Jump straight to a given wave of the set, for testing and capture. */
window.__surfWave = (i) => { session.total = 0; session.log = []; startWave(i); return W.SET[i].name; };

/** Drive n frames by hand at a fixed dt, with an optional scripted input. */
window.__surfStep = (n = 1, dt = 1 / 60, inp = null) => {
  started = true;
  for (let i = 0; i < n; i++) frame(dt, inp);
  return { t, x: rider.p.x, speed: rider.speed, lag: rider.lag,
           particles: fx.liveCount, down: rider.down, score: run.score };
};

/**
 * Photograph the page from inside itself. The Browser pane never composites this
 * canvas (it stays 0×0), so screenshots from outside come back blank — but a WebGL
 * drawing buffer is only cleared on composite, so render() and toDataURL() in the
 * SAME synchronous task return real pixels. Posts to the shot receiver at :8399;
 * never return the base64 through a tool result.
 */
window.__surfShot = (name, w = 1280, h = 720, camFn = null) => {
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (camFn) camFn(camera, rider, t);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  return fetch('http://localhost:8399/shot?name=' + encodeURIComponent(name),
               { method: 'POST', body: url }).then((r) => r.text());
};
