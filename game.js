// SURF — the loop: input, camera, scoring, and the wiring between sim and view.

import * as THREE from 'three';
import * as W from './wave.js';
import { WAVE } from './wave.js';
import { createRider, stepRider, takeoffSpot, TUNE } from './board.js';
import { createTrickState, updateTricks } from './tricks.js';
import * as B from './breaks.js';
import * as AI from './ai.js';
import * as U from './ui.js';
import { SprayFX } from './particles.js';
import { Ocean, Curl, createSky, createLights, createRig, SUN } from './render.js';
import * as SFX from './sfx.js';
import { World } from './world.js';

const SUB = 1 / 120;          // the sim always steps at a fixed 120 Hz
const MAX_FRAME = 0.1;

const el = (id) => document.getElementById(id);

// ---------------------------------------------------------------- scene
const canvas = el('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
// Matched to the ocean shader's own distance fade (85→205 to PAL.horizon); the
// grid and the far plane have to reach the same colour at the same range or the
// boundary between them reads as a line drawn across the sea.
scene.fog = new THREE.Fog(0x69787b, 105, 310);
const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.1, 5000);

createSky(scene);
createLights(scene);
const ocean = new Ocean(scene);
const curl = new Curl(scene);
const fx = new SprayFX(scene);
const world = new World(scene);

const rig = createRig(scene);

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
  if (k === 'escape' && started && !ui.isOpen()) { el('over').classList.remove('show'); screens.home(); }
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
  screens.home();
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

// Three ways to play, all built on the same session machinery:
//   tour     — a heat from the career, judged against objectives
//   free     — any unlocked break, all its waves, pure score attack
//   contest  — two waves each against a rival, only the two best count
// `run` is one wave; `session` is the whole outing.
let mode = 'free';
let heat = null, rival = null, breakId = 'home';
let session = newSession();
const career = loadCareer();
const ui = new U.UI();

function newSession() {
  return { wave: 0, total: 0, log: [], best: loadBest(), done: false,
           dist: 0, barrel: 0, tubes: 0, tricks: 0, airs: 0, topSpeed: 0,
           clean: 0, wipeouts: 0, waves: 0, waveScores: [] };
}

function startWave(i) {
  const bk = B.byId(breakId);
  const preset = bk.waves[Math.max(0, Math.min(bk.waves.length - 1, i))];
  W.applyWave(B.waveParams(breakId, i));
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
  world.setBreak(breakId);
  el('over').classList.remove('show');
  ui.hide();
  el('wave-name').textContent = `${bk.name} · WAVE ${i + 1}/${waveCount()} · ${preset.name}`;
  flash(preset.name);
}

/** How many waves this outing runs for — a heat says so, otherwise the whole break. */
function waveCount() {
  if (mode === 'tour' && heat) return heat.waves;
  if (mode === 'contest') return AI.COUNTING_WAVES;
  return B.byId(breakId).waves.length;
}

function beginSession(m, opts) {
  mode = m;
  heat = opts.heat || null;
  rival = opts.rival || null;
  breakId = opts.breakId;
  session = newSession();
  started = true;
  el('intro').classList.add('gone');
  SFX.init(); SFX.resume();
  startWave(0);
}

/** R: next wave if one is waiting, otherwise restart the outing. */
function restart() {
  if (ui.isOpen()) return;
  if (run && run.over && !session.done) startWave(session.wave + 1);
  else { const o = { heat, rival, breakId }; beginSession(mode, o); }
}
function loadBest() {
  const v = parseFloat(localStorage.getItem('surf-best') || '0');
  return Number.isFinite(v) ? v : 0;
}
function loadCareer() {
  try {
    const raw = JSON.parse(localStorage.getItem('surf-career') || 'null');
    if (raw && raw.lifetime && raw.heats) return { ...B.newCareer(), ...raw,
      lifetime: { ...B.newCareer().lifetime, ...raw.lifetime } };
  } catch { /* a corrupt save must not brick the game */ }
  return B.newCareer();
}
function saveCareer() {
  try { localStorage.setItem('surf-career', JSON.stringify(career)); } catch {}
}
startWave(0);

function flash(text) { run.msg = text; run.msgT = 1.6; }

// ---------------------------------------------------------------- front end
const screens = {
  home: () => U.homeScreen(ui, career, {
    tour: screens.tour, free: screens.free, contest: screens.contest, stats: screens.stats,
  }),
  tour: () => U.tourScreen(ui, B.TOUR, career, B, {
    play: (h) => beginSession('tour', { heat: h, breakId: h.breakId }),
    back: screens.home,
  }),
  free: () => U.breakScreen(ui, B.BREAKS, career, B, {
    play: (b) => beginSession('free', { breakId: b.id }),
    back: screens.home,
  }),
  contest: () => U.contestScreen(ui, AI.RIVALS, B.BREAKS, career, B, {
    play: (r, b) => beginSession('contest', { rival: r, breakId: b.id }),
    back: screens.home,
  }),
  stats: () => U.statsScreen(ui, career, B.TOUR, { back: screens.home }),
};

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
  session.waveScores.push(run.score);

  // Roll this wave into the session totals the objectives are judged against.
  const wiped = reason !== 'THE WAVE RUNS OUT';
  session.waves++;
  session.dist += run.dist;
  session.barrel += run.barrelTime;
  session.tubes += run.tubes;
  session.tricks += run.tricks;
  session.airs += run.airs;
  session.wipeouts += wiped ? 1 : 0;
  session.clean += wiped ? 0 : 1;
  session.topSpeed = Math.max(session.topSpeed, run.topSpeed);

  const last = session.wave >= waveCount() - 1;
  session.done = last;

  if (last) { endSession(); return; }

  {
    // Between waves: this wave's card, then paddle back out for the next one.
    el('ov-title').textContent = reason;
    el('ov-score').textContent = Math.round(run.score).toLocaleString();
    el('ov-lines').innerHTML =
      `<div><b>${run.dist.toFixed(0)}</b> m ridden · <b>${run.tricks}</b> manoeuvre${run.tricks === 1 ? '' : 's'}</div>` +
      `<div><b>${run.barrelTime.toFixed(1)}</b> s barrelled · ${run.tubes} tube${run.tubes === 1 ? '' : 's'}</div>` +
      `<div><b>${(run.topSpeed * 3.6).toFixed(0)}</b> km/h top speed</div>` +
      `<div class="best">SET TOTAL ${Math.round(session.total).toLocaleString()}</div>`;
    const nextName = B.byId(breakId).waves[session.wave + 1].name;
    el('ov-again').textContent = `PRESS R FOR WAVE ${session.wave + 2} — ${nextName}`;
  }
  el('over').classList.add('show');
}

/**
 * The outing is over. Where it goes next depends on how you were playing:
 * a heat gets judged against its objectives, a contest gets scored against the
 * rival's two best waves, and free surf just posts a set total.
 */
function endSession() {
  if (session.total > session.best) {
    session.best = session.total;
    localStorage.setItem('surf-best', String(Math.round(session.total)));
    session.newBest = true;
  }

  if (mode === 'tour' && heat) {
    const results = B.judge(heat, session);
    B.recordHeat(career, heat, results, session);
    saveCareer();
    U.resultsScreen(ui, heat, results, session, null, {
      retry: () => beginSession('tour', { heat, breakId: heat.breakId }),
      tour: () => screens.tour(),
    });
    return;
  }

  if (mode === 'contest' && rival) {
    // The rival surfs the SAME waves, headlessly and deterministically, so the heat
    // is a like-for-like comparison rather than a number pulled out of the air.
    const theirRaw = simulateRival(rival, breakId, AI.COUNTING_WAVES);
    const you = { waves: session.waveScores.map(AI.judgeWave),
                  total: 0 };
    const them = { waves: theirRaw.map(AI.judgeWave), total: 0 };
    you.total = AI.heatScore(you.waves);
    them.total = AI.heatScore(them.waves);
    career.lifetime.waves += 0;
    saveCareer();
    U.contestResults(ui, rival, you, them, {
      retry: () => beginSession('contest', { rival, breakId }),
      back: () => screens.home(),
    });
    return;
  }

  // Free surf.
  el('ov-title').textContent = 'THE SET IS OVER';
  el('ov-score').textContent = Math.round(session.total).toLocaleString();
  el('ov-lines').innerHTML =
    session.log.map((w, i) =>
      `<div><span class="wv">${i + 1}. ${w.name}</span> <b>${w.score.toLocaleString()}</b>` +
      `<span class="wr">${w.reason.toLowerCase()}</span></div>`).join('') +
    `<div class="best">${session.newBest ? '★ NEW BEST SET' : 'best set ' + Math.round(session.best).toLocaleString()}</div>`;
  el('ov-again').textContent = 'PRESS R TO PADDLE BACK OUT · ESC FOR THE MENU';
  B.recordHeat(career, { id: `free-${breakId}`, goals: [] }, [], session);
  saveCareer();
  el('over').classList.add('show');
}

/**
 * Run the rival's waves at full sim rate with no rendering. It is the same
 * board.js, the same wave, and the same trick detector the player uses — the only
 * difference is who is holding the controls.
 */
function simulateRival(r, bid, count) {
  const scores = [];
  const bk = B.byId(bid);
  for (let i = 0; i < count; i++) {
    W.applyWave(B.waveParams(bid, Math.min(i, bk.waves.length - 1)));
    let ts = 4.0;
    const rr = createRider(ts);
    const sp = takeoffSpot(ts);
    rr.p.x = sp.x; rr.p.z = sp.z; rr.p.y = W.height(sp.x, sp.z, ts);
    rr.v.x = 5; rr.v.z = -1;
    const brain = AI.createAI(r, 1000 + i * 97);
    const tk = createTrickState();
    let sc = 0, combo = 1, comboT = 0, seg = 0, wasB = false;
    const x0 = rr.p.x;
    for (let k = 0; k < 9000; k++) {
      const ev = stepRider(rr, ts, AI.aiInput(brain, rr, W, ts, SUB), SUB);
      sc += SUB * rr.speed * (0.55 + rr.pocket * 1.9) * combo;
      if (rr.barrel > 0.5) { sc += SUB * 130 * combo; comboT = 2.2; seg += SUB;
        if (!wasB) combo = Math.min(8, combo + 1); wasB = true; }
      else { if (wasB) sc += seg * 260; seg = 0; wasB = false; }
      for (const m of updateTricks(tk, rr, ev, ts, SUB)) {
        sc += m.points * combo;
        combo = Math.min(8, combo + (m.points >= 250 ? 0.7 : 0.4));
        comboT = m.hold;
      }
      comboT -= SUB;
      if (comboT <= 0) combo = Math.max(1, combo - SUB * 1.1);
      ts += SUB;
      if (rr.down) break;
      if (rr.p.x - x0 > WAVE.rideLength) break;
    }
    // Skill scales the result a little, so the ladder actually ramps.
    scores.push(sc * (0.72 + 0.42 * r.skill));
  }
  W.applyWave(B.waveParams(bid, session.wave));   // restore the player's wave
  return scores;
}

// ---------------------------------------------------------------- camera
const camPos = new THREE.Vector3(0, 6, 20);
const camLook = new THREE.Vector3();
let camRoll = 0, camFov = 66;

function updateCamera(dt) {
  const p = rider.p;
  // Sit behind and outside the rider, looking down the line toward the section
  // that has not broken yet — which is where the wave, and the decision, is.
  const back = 4.5 + rider.speed * 0.10;
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
  const tubeBack = 5.4;
  const want = inTube
    ? new THREE.Vector3(
        p.x - fh * tubeBack + rider.lean * 0.5,
        p.y + 1.45,
        p.z - fz * tubeBack - 4.3)
    : new THREE.Vector3(
        p.x - fh * back + rider.lean * 1.4,
        p.y + 1.55 + rider.speed * 0.032,
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
    ? new THREE.Vector3(p.x + fh * 13, p.y + 0.75, p.z + fz * 7 + 3.0)
    : new THREE.Vector3(p.x + fh * lookAhead, p.y + 0.8, p.z + fz * lookAhead * 0.5 + 4.0),
    Math.min(1, dt * (inTube ? 7 : 5)));

  camera.position.copy(camPos);
  camera.lookAt(camLook);
  camRoll += (-rider.lean * 0.13 - camRoll) * Math.min(1, dt * 4);
  camera.rotateZ(camRoll);

  const wantFov = 49 + Math.min(10, rider.speed * 0.38) + (inTube ? 4 : 0);
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
  world.update(dt, p.x, W.crestZ(p.x, t));
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
window.__surf = () => ({ t, rider, run, session, trickState, career, mode, heat, rival,
                         breakId, screens, ui, world, fx, ocean, curl,
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
