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
import { Ocean, Curl, createSky, createLights, createRig, SUN, PAL } from './render.js';
import * as SFX from './sfx.js';
import { World } from './world.js';
import * as E from './elements.js';

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

const sky = createSky(scene);
createLights(scene);
const ocean = new Ocean(scene);
// (The backdrop plane is a ShaderMaterial bound to the shared PAL instances now,
// so it follows every element retint by construction.)
const curl = new Curl(scene);
const fx = new SprayFX(scene);
const world = new World(scene);

const rig = createRig(scene);

// The rival's rig. In a contest the opponent is not a simulation you read about on
// the results card — they are ON the wave with you, a second rider stepped by the
// same board.js at the same fixed rate, driven by ai.js. Dark board so you can tell
// whose line is whose at a glance.
const rivalRig = createRig(scene);
rivalRig.board.material.color.setHex(0x23282e);
rivalRig.setAccent(0xc4452b);   // rust-red kit vs your slate panels
rivalRig.root.visible = false;

// The ghost: your best ride on this exact wave, replayed as a translucent rider.
// Materials are CLONED before fading — the rigs share material instances per
// part, and fading the originals would ghost the living riders too.
const ghostRig = createRig(scene);
ghostRig.root.traverse((o) => {
  if (o.material) {
    o.material = o.material.clone();
    o.material.transparent = true;
    o.material.opacity = 0.28;
    o.material.depthWrite = false;
  }
  o.castShadow = false;
});
ghostRig.root.visible = false;

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
let elementId = localStorage.getItem('surf-element') || 'water';
let session = newSession();
const career = loadCareer();
const ui = new U.UI();

function newSession() {
  return { wave: 0, total: 0, log: [], best: loadBest(), done: false,
           dist: 0, barrel: 0, tubes: 0, tricks: 0, airs: 0, topSpeed: 0,
           clean: 0, wipeouts: 0, waves: 0, waveScores: [], rivalScores: [] };
}

// The live rival: a full rider + brain + trick detector, stepped alongside yours.
let rivalR = null, rivalBrain = null, rivalTrickState = null, rivalRun = null;

// ---------------------------------------------------------------- the ghost
//
// Free surf only. Your best score on this EXACT wave — break, wave index, element
// and lineup size all in the key, because a ghost recorded on a bomb replayed on
// the inside wave would ride a surface that is not there. Replay needs no
// determinism trick: every wave starts at sim t = 4.0 and the wave field is a
// pure function of t, so a position recorded at sim time T is on the water at
// sim time T of any later attempt, by construction.
let ghost = null;      // { dt, t0, d: Float samples [x,y,z,heading,lean,crouch,air] }

const GHOST_STRIDE = 7;
const ghostKey = (i, offer) =>
  `surf-ghost:${breakId}:${i}:${elementId}:${offer ? offer.scale : 1}`;

function loadGhost(key) {
  try {
    const g = JSON.parse(localStorage.getItem(key) || 'null');
    if (g && g.d && g.d.length >= GHOST_STRIDE * 10) return g;
  } catch {}
  return null;
}

function saveGhost(key, score) {
  if (!run.rec || run.rec.data.length < GHOST_STRIDE * 10) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      score: Math.round(score), dt: run.rec.dt, t0: run.rec.t0, d: run.rec.data,
    }));
  } catch { /* storage full — the ride still counts, the ghost just isn't kept */ }
}

/** Sample the player at 30 Hz into the wave recording. */
function recordGhostSample() {
  const d = run.rec.data;
  d.push(+rider.p.x.toFixed(2), +rider.p.y.toFixed(2), +rider.p.z.toFixed(2),
         +rider.heading.toFixed(3), +rider.lean.toFixed(2), +rider.crouch.toFixed(2),
         rider.air ? 1 : 0);
}

// A reusable fake rider for posing the ghost through the same poseOnWave path.
const ghostR = { p: { x: 0, y: 0, z: 0 }, v: { x: 0, y: 0, z: 0 },
                 heading: 0, lean: 0, crouch: 0, air: false };

function updateGhost() {
  if (!ghost || run.over) { ghostRig.root.visible = false; return; }
  const S = GHOST_STRIDE;
  const n = (ghost.d.length / S) | 0;
  const ft = (t - ghost.t0) / ghost.dt;
  if (ft >= n - 1) { ghostRig.root.visible = false; return; }   // their wave ended
  const i = Math.max(0, ft | 0), f = Math.max(0, ft - i);
  const a = i * S, b = Math.min(n - 1, i + 1) * S;
  const L = (o) => ghost.d[a + o] + (ghost.d[b + o] - ghost.d[a + o]) * f;
  ghostR.p.x = L(0); ghostR.p.y = L(1); ghostR.p.z = L(2);
  ghostR.heading = L(3); ghostR.lean = L(4); ghostR.crouch = L(5);
  ghostR.air = ghost.d[a + 6] > 0.5;
  // Velocity by finite difference — the airborne pitch needs it.
  ghostR.v.x = (ghost.d[b] - ghost.d[a]) / ghost.dt;
  ghostR.v.y = (ghost.d[b + 1] - ghost.d[a + 1]) / ghost.dt;
  ghostR.v.z = (ghost.d[b + 2] - ghost.d[a + 2]) / ghost.dt;
  ghostRig.root.visible = true;
}

function startRival(i) {
  rivalR = createRider(t);
  const s2x = takeoffSpot(t).x + 14;          // ahead of you, down the line
  rivalR.p.x = s2x; rivalR.p.z = W.crestZ(s2x, t) - 3.5;
  rivalR.p.y = W.height(rivalR.p.x, rivalR.p.z, t);
  rivalR.v.x = 5; rivalR.v.z = -1;
  // Seeded per wave, so a rematch replays the same rival ride against a better you.
  rivalBrain = AI.createAI(rival, 1000 + i * 97);
  rivalTrickState = createTrickState();
  rivalRun = { score: 0, combo: 1, comboT: 0, seg: 0, wasB: false,
               announced: false, done: false, x0: rivalR.p.x, wipeT: 0 };
}

/**
 * One 120 Hz step of the rival: same physics, same scoring rules as yours, no HUD.
 * Their wave ends when they wipe, when the point runs out, or when your wave does.
 */
function stepRivalOne() {
  if (!rivalR || rivalRun.done) return;
  if (rivalR.down) { rivalRun.wipeT += SUB; return; }
  const ev = stepRider(rivalR, t, AI.aiInput(rivalBrain, rivalR, W, t, SUB), SUB);
  const rv = rivalRun;
  rv.score += SUB * rivalR.speed * (0.55 + rivalR.pocket * 1.9) * rv.combo;
  if (rivalR.barrel > 0.5) {
    rv.score += SUB * 130 * rv.combo; rv.comboT = 2.2; rv.seg += SUB;
    if (!rv.wasB) rv.combo = Math.min(8, rv.combo + 1);
    rv.wasB = true;
  } else {
    if (rv.wasB) rv.score += rv.seg * 260;
    rv.seg = 0; rv.wasB = false;
  }
  for (const m of updateTricks(rivalTrickState, rivalR, ev, t, SUB)) {
    rv.score += m.points * rv.combo;
    rv.combo = Math.min(8, rv.combo + (m.points >= 250 ? 0.7 : 0.4));
    rv.comboT = m.hold;
  }
  rv.comboT -= SUB;
  if (rv.comboT <= 0) rv.combo = Math.max(1, rv.combo - SUB * 1.1);
  if (ev.landed > 1) rivalR._absorb = Math.min(1, ev.landed / 9);
  if (rivalR.down && !rv.announced) { rv.announced = true; flash(`${rival.name} IS DOWN`); }
  if (rivalR.p.x - rv.x0 > WAVE.rideLength) rv.done = true;
}

/**
 * Retint the entire scene for a medium. This works by MUTATING the PAL colour
 * instances, because ocean, curl and sky all hold references to the same
 * THREE.Color objects in their uniforms — one setHex reaches all three materials.
 * No shaders are edited and no new uniforms exist per element; if a new element
 * seems to need one, it is a new renderer, not an element (see elements.js).
 */
function applyElementView(elm) {
  for (const k of ['deep', 'shallow', 'glow', 'sky', 'horizon', 'sunCol', 'foam', 'zenith', 'low']) {
    if (PAL[k] && elm.pal[k] !== undefined) PAL[k].setHex(elm.pal[k]);
  }
  scene.fog.color.setHex(elm.pal.horizon);
  fx.setElement(elm);
  SFX.setElement(elm.id);
}

function startWave(i, offer) {
  const bk = B.byId(breakId);
  const preset = bk.waves[Math.max(0, Math.min(bk.waves.length - 1, i))];
  const params = B.waveParams(breakId, i);
  if (offer && offer.scale !== 1) params.A = params.A * offer.scale;
  E.applyElement(E.byId(elementId), params);
  applyElementView(E.byId(elementId));
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
    mult: (offer && offer.mult) || 1,
    // The paddle-in: ~1.3 s where the wave picks you up before you have control.
    paddleT: 1.3,
  };
  world.setBreak(elementId === 'water' ? breakId : E.byId(elementId).world);
  // Sand, snow and lava are landforms you descend, so the view has to reach down
  // the runout rather than crowd the face of a passing swell.
  ocean.setDune(!!E.byId(elementId).dune);

  run.offer = offer || null;
  run.rec = null;
  run.ghostKey = ghostKey(i, offer);
  ghost = mode === 'free' ? loadGhost(run.ghostKey) : null;
  ghostRig.root.visible = false;

  if (mode === 'contest' && rival) {
    startRival(i);
    rivalRig.root.visible = true;
  } else {
    rivalR = null;
    rivalRig.root.visible = false;
  }

  el('over').classList.remove('show');
  ui.hide();
  el('wave-name').textContent = `${bk.name} · WAVE ${i + 1}/${waveCount()} · ${preset.name}`
    + (mode === 'contest' && rival ? ` · VS ${rival.name}` : '')
    + (ghost ? ` · GHOST ${ghost.score.toLocaleString()}` : '');
  flash(preset.name);
}

function buildOffers() {
  return [
    { tag: 'THE INSIDE',   note: 'smaller and safer — take it now',      scale: 0.88, mult: 0.9 },
    { tag: 'THE SET WAVE', note: 'the proper one, as it comes',          scale: 1.00, mult: 1.0 },
    { tag: 'THE BOMB',     note: 'bigger and meaner — worth more, costs more', scale: 1.13, mult: 1.25 },
  ];
}

/** Show the lineup for wave i, then drop in on whatever gets picked. */
function showLineup(i) {
  U.lineupScreen(ui, buildOffers(), i + 1, waveCount(), {
    take: (o) => startWave(i, o),
    abandon: () => { el('over').classList.remove('show'); screens.home(); },
  });
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
  if (opts.element) { elementId = opts.element; localStorage.setItem('surf-element', elementId); }
  // The tour and contests are judged on WATER — objectives and rival scores were
  // tuned there, and a low-gravity cosmic heat would trivialise every air goal.
  if (m !== 'free') elementId = 'water';
  session = newSession();
  started = true;
  el('intro').classList.add('gone');
  SFX.init(); SFX.resume();
  showLineup(0);
}

/** R: next wave if one is waiting, otherwise restart the outing. */
function restart() {
  if (ui.isOpen()) return;
  if (run && run.over && !session.done) { el('over').classList.remove('show'); showLineup(session.wave + 1); return; }
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
      lifetime: { ...B.newCareer().lifetime, ...raw.lifetime },
      elements: { ...(raw.elements || {}) } };
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
  free: () => U.breakScreen(ui, B.BREAKS, career, B, E, elementId, {
    play: (b, el) => beginSession('free', { breakId: b.id, element: el }),
    pick: (el) => { elementId = el; localStorage.setItem('surf-element', el); screens.free(); },
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
  run.score += dt * rider.speed * (0.55 + pocket * 1.9) * run.combo * run.mult;

  if (rider.barrel > 0.5) {
    run.barrelTime += dt;
    run.score += dt * 130 * run.combo * run.mult;
    run.comboT = 2.2;
    if (!run.wasBarrel) {
      run.tubes++; run.combo = Math.min(8, run.combo + 1);
      flash('IN THE TUBE'); SFX.hit('score');
    }
    run.wasBarrel = true;
  } else {
    if (run.wasBarrel) {
      flash(`TUBE  +${Math.round(run.barrelSeg * 260)}`);
      run.score += run.barrelSeg * 260 * run.mult;
      SFX.hit('spit');
      fx.spit(rider.p.x + 3, rider.p.y + 1.2, rider.p.z - 1, 1.1);
    }
    run.wasBarrel = false;
  }
  run.barrelSeg = rider.barrel > 0.5 ? (run.barrelSeg || 0) + dt : 0;

  if (ev.slide > 0.5) {
    run.score += dt * ev.slide * 1.4 * run.combo * run.mult;
    run.comboT = 1.6;
  }
  if (ev.launched) run.airs++;

  // Named manoeuvres, recognised from what the board actually did.
  for (const m of updateTricks(trickState, rider, ev, t, dt)) {
    const pts = Math.round(m.points * run.combo * run.mult);
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

  // The rival's wave ends when yours does; their score is whatever they banked.
  // Skill scales the raw number so the ladder ramps — the same factor the offline
  // simulation used, now applied to a ride you actually watched.
  if (mode === 'contest' && rivalR) {
    session.rivalScores.push(rivalRun.score * (0.72 + 0.42 * rival.skill));
  }

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

  if (mode === 'free' && run.rec && (!ghost || run.score > ghost.score)) {
    saveGhost(run.ghostKey, run.score);
  }

  session.done = session.wave >= waveCount() - 1;

  // A wipeout plays out before the card: the rig tumbles, the camera hangs back,
  // and THEN you get told what it cost. An instant card on top of a crash reads
  // like the game snatching the screen away from its own best moment.
  run.wipeT = 0;
  run.wipeSpin = wiped ? { x: 2.5 + Math.random() * 4, z: 3 + Math.random() * 5 } : null;
  run.cardT = wiped ? 1.5 : 0.5;
}

/** The deferred half of finish(): show the between-wave card, or end the outing. */
function presentCard() {
  if (session.done) { endSession(); return; }

  {
    // Between waves: this wave's card, then paddle back out for the next one.
    el('ov-title').textContent = run.reason;
    el('ov-score').textContent = Math.round(run.score).toLocaleString();
    const rivalLine = (mode === 'contest' && session.rivalScores.length)
      ? `<div><b>${AI.judgeWave(session.rivalScores[session.rivalScores.length - 1]).toFixed(1)}</b>` +
        ` — ${rival.name}'s wave (yours ${AI.judgeWave(run.score).toFixed(1)})</div>`
      : '';
    el('ov-lines').innerHTML =
      `<div><b>${run.dist.toFixed(0)}</b> m ridden · <b>${run.tricks}</b> manoeuvre${run.tricks === 1 ? '' : 's'}</div>` +
      `<div><b>${run.barrelTime.toFixed(1)}</b> s barrelled · ${run.tubes} tube${run.tubes === 1 ? '' : 's'}</div>` +
      `<div><b>${(run.topSpeed * 3.6).toFixed(0)}</b> km/h top speed</div>` + rivalLine +
      `<div class="best">SET TOTAL ${Math.round(session.total).toLocaleString()}</div>`;
    const nextName = B.byId(breakId).waves[Math.min(session.wave + 1, B.byId(breakId).waves.length - 1)].name;
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
    B.recordHeat(career, heat, results, session, elementId);
    saveCareer();
    U.resultsScreen(ui, heat, results, session, null, {
      retry: () => beginSession('tour', { heat, breakId: heat.breakId }),
      tour: () => screens.tour(),
    });
    return;
  }

  if (mode === 'contest' && rival) {
    // Judged on the waves the rival actually rode next to you — the live rider
    // replaced the old offline simulation, so the number on this card is a ride
    // you watched happen (or watched fail).
    const you = { waves: session.waveScores.map(AI.judgeWave),
                  total: 0 };
    const them = { waves: session.rivalScores.map(AI.judgeWave), total: 0 };
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
  B.recordHeat(career, { id: `free-${breakId}`, goals: [] }, [], session, elementId);
  saveCareer();
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
  // A wave has a pocket and a tube; a dune has neither. On the three DESCENTS the
  // same gauge reads ALTITUDE instead of lag (board.js derives lag from height on a
  // dune), so the bands still mean something — they just need the landform's own
  // words. Order matches the cascade above: shoulder, pocket, tube, foam.
  const ZONE_WORDS = {
    water:  ['SHOULDER', 'POCKET', 'TUBE', 'FOAM'],
    cosmic: ['SHOULDER', 'POCKET', 'TUBE', 'COLLAPSE'],
    sand:   ['CREST', 'FACE', 'STEEPS', 'RUNOUT'],
    snow:   ['RIDGE', 'FALL LINE', 'STEEPS', 'FLATS'],
    lava:   ['RIM', 'FLANK', 'STEEPS', 'CRUST'],
  };
  const words = ZONE_WORDS[elementId] || ZONE_WORDS.water;
  el('zone').textContent = words[['shoulder', 'pocket', 'tube', 'foam'].indexOf(zone)];
  // The CSS class stays the wave's name — it only carries the danger colour, and
  // "foam" is red wherever you are.
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
      if (run.paddleT > 0) {
        // The paddle-in. You do not spawn standing on a moving wave — you glide in
        // from out the back, prone, as the section stands up under you, and get
        // control at the pop-up. Scripted, not simulated: the targets track
        // takeoffSpot(t) LIVE, because the wave moves ~15 m during the paddle and
        // a start point captured at wave-start would hand you over into the foam.
        run.paddleT -= SUB;
        const f = 1 - Math.max(0, run.paddleT) / 1.3;
        const e = f * f * (3 - 2 * f);
        const sp = takeoffSpot(t);
        rider.p.x = sp.x - 6 * (1 - e);
        rider.p.z = sp.z + 7 * (1 - e);
        rider.p.y = W.height(rider.p.x, rider.p.z, t);
        rider.heading = -0.45;
        if (rivalR) {
          const rx = sp.x + 14 - 5 * (1 - e);
          rivalR.p.x = rx;
          rivalR.p.z = W.crestZ(rx, t) - 3.5 + 6 * (1 - e);
          rivalR.p.y = W.height(rivalR.p.x, rivalR.p.z, t);
        }
        if (run.paddleT <= 0) {
          rider.v.x = 5; rider.v.z = -1;
          if (rivalR) { rivalR.v.x = 5; rivalR.v.z = -1; rivalRun.x0 = rivalR.p.x; }
          run.startX = rider.p.x;          // distance counts from the pop-up
          if (mode === 'free') {
            run.rec = { dt: 4 / 120, t0: t, data: [] };
            run.recTick = 0;
            recordGhostSample();
          }
          flash('TO YOUR FEET');
        }
      } else {
        const ev = stepRider(rider, t, inp, SUB);
        agg.slide = Math.max(agg.slide, ev.slide);
        agg.launched = agg.launched || ev.launched;
        agg.pumped = Math.max(agg.pumped, ev.pumped);
        agg.splash = Math.max(agg.splash, ev.splash);
        if (ev.wiped) agg.wiped = ev.wiped;
        score(SUB, ev);
        if (run.rec && (++run.recTick & 3) === 0) recordGhostSample();
        // The rival rides the same wave in the same fixed steps, and pauses with
        // you — a card on screen freezes both surfers, not just yours.
        if (mode === 'contest') stepRivalOne();
      }
    }
    t += SUB;
  }

  // The deferred end-of-wave card (finish() sets the delay; a wipeout gets time
  // to actually play out on screen before the score interrupts it).
  if (run.over && run.cardT !== undefined) {
    run.cardT -= dt;
    if (run.cardT <= 0) { run.cardT = undefined; presentCard(); }
  }

  if (agg.pumped > 0.3) SFX.hit('pump', Math.min(1, agg.pumped / 6));
  if (agg.splash > 1) {
    fx.splash(rider.p.x, rider.p.y, rider.p.z, agg.splash);
    SFX.hit('land', agg.splash);
    rider._absorb = Math.min(1, agg.splash / 9);
  }
  if (agg.wiped) {
    fx.splash(rider.p.x, rider.p.y, rider.p.z, 14);
    SFX.hit('splash', 12);
    // Nothing "catches you inside" on a dune — you simply run out of hill. Same
    // rule firing, honest name for it.
    const DEAD_END = { sand: 'BOGGED DOWN', snow: 'RAN OUT OF MOUNTAIN', lava: 'STUCK IN THE CRUST' };
    finish(agg.wiped === 'foam' ? (DEAD_END[elementId] || 'CAUGHT INSIDE')
         : agg.wiped === 'pearl' ? 'PEARLED' : 'BLEW THE LANDING');
  }

  run.msgT -= dt;
  for (const rr of [rider, rivalR]) {
    if (!rr) continue;
    if (rr.air) rr._absorb = 0;   // a phantom absorb must not squash the air pose
    else if (rr._absorb) rr._absorb = Math.max(0, rr._absorb - dt * 3.4);
    if (!rr.air && rr._airK) rr._airK = Math.max(0, rr._airK - dt * 7);
  }

  // --- emitters, all driven by sim quantities
  const p = rider.p;
  const fhx = Math.cos(rider.heading), fhz = Math.sin(rider.heading);
  if (!rider.air && !run.over) {
    fx.rail(p.x, p.y, p.z, fhx, fhz, agg.slide, rider.speed, dt);
    fx.wake(p.x, p.y, p.z, fhx, fhz, rider.speed, dt);
  }
  // The rival's carves throw spray too — rail() has no shared timer, so a second
  // caller is safe (wake() is NOT: its accumulator is shared, so the rival skips it).
  if (rivalR && !rivalR.down && !rivalR.air) {
    fx.rail(rivalR.p.x, rivalR.p.y, rivalR.p.z,
            Math.cos(rivalR.heading), Math.sin(rivalR.heading),
            rivalR.slide || 0, rivalR.speed, dt);
  }
  fx.lip(W.breakX(t), (x) => W.crestZ(x, t), (x) => W.lipHeight(x, t), p.x, dt, 1);
  fx.whitewater(W.breakX(t), (x) => W.crestZ(x, t), p.x, dt, 260);
  fx.update(dt, heightAt, -1.5, 0.6);

  // --- view
  world.update(dt, p.x, W.crestZ(p.x, t));
  sky.position.set(camera.position.x, 0, camera.position.z);
  sky.material.uniforms.uTime.value = t;
  ocean.update(t, p.x, camera);
  curl.update(t, p.x, camera);
  updateCamera(dt);
  // After the camera, because the FOV breathes with speed and point size depends
  // on it. Uses the drawing buffer height, not innerHeight — offscreen captures
  // resize the renderer without touching the window.
  fx.setViewport(renderer.domElement.height, camera.fov);

  // One pose routine for every rider on the wave: pitch the board along the slope
  // it is actually sitting on, so it noses down the drop and levels in the trough.
  const poseOnWave = (rg, r) => {
    const fx2 = Math.cos(r.heading), fz2 = Math.sin(r.heading);
    rg.root.position.set(r.p.x, r.p.y + 0.07, r.p.z);
    // On the water the board pitches to the slope under it. In the AIR that is
    // nonsense — it made the flying board track the water it was not touching —
    // so airborne pitch comes from the trajectory instead: nose up on the way
    // out, nose down into the landing.
    let pitch;
    if (r.air) {
      pitch = Math.atan2(r.v.y, Math.max(5, Math.hypot(r.v.x, r.v.z))) * 0.6;
    } else {
      const hf = W.height(r.p.x + fx2 * 0.9, r.p.z + fz2 * 0.9, t);
      const hb = W.height(r.p.x - fx2 * 0.9, r.p.z - fz2 * 0.9, t);
      pitch = -Math.atan2(hf - hb, 1.8);
    }
    // A hard landing flashes a deep absorb through the legs, then releases.
    const crouch = Math.min(1, r.crouch + (r._absorb || 0));
    rg.pose(r.heading, r.lean, crouch, pitch, 0);
    // The blend needs an EXIT ramp as much as an entry: handing the compressed
    // air pose straight back to the standing pose popped the pelvis 16 cm in a
    // single frame at touchdown (measured, not eyeballed). _airK keeps decaying
    // for ~0.15 s after landing so the body arrives instead of teleporting.
    if (rg.setAir) {
      if (r.air) {
        r._airK = Math.min(1, r.airTime / 0.18);
        r._airExt = r.v.y < 0 ? Math.min(1, -r.v.y / 5.5) : 0;
        rg.setAir(r._airK, r._airExt, r.spin, Math.min(1, (r.grabT || 0) * 4));
      } else if (r._airK > 0) {
        rg.setAir(r._airK, 1, 0);
      }
    }
  };

  // Prone paddle pose: flatten the body onto the deck. pose() has already reset
  // every joint this frame, so this override composes cleanly on top; the new
  // rig's paddle() animates the arms and the old box rig simply ignores it.
  const proneOverride = (rg, ph) => {
    // The jointed rig lies down through its own hierarchy. Do NOT touch rg.body
    // here — pose() does not reset the body group, so a body-level rotation
    // sticks after the paddle and leaves the figure surfing lying down (shipped
    // exactly that way for about twenty minutes).
    if (rg.setProne) { rg.setProne(ph); return; }
    rg.body.rotation.x = 1.42;
    rg.body.position.y = -0.02;
    if (rg.paddle) rg.paddle(ph);
  };

  if (rig) {
    if (rider.down && run.wipeSpin) {
      // The wipeout: the rig tumbles with the blow, churns the surface, and sinks
      // into the foam. pose() resets root rotation every call, so the tumble owns
      // the rig for this stretch and pose is not called at all.
      run.wipeT += dt;
      const w = run.wipeT;
      rig.root.visible = w < 1.6;
      rig.root.position.set(p.x, Math.max(rider.surfaceY - w * 0.55, p.y - 1.2), p.z);
      rig.root.rotation.x += run.wipeSpin.x * dt * Math.max(0.15, 1 - w * 0.55);
      rig.root.rotation.z += run.wipeSpin.z * dt * Math.max(0.15, 1 - w * 0.55);
      if (w < 1.0 && Math.random() < dt * 9) {
        fx.splash(p.x + (Math.random() - 0.5) * 1.5, rider.surfaceY,
                  p.z + (Math.random() - 0.5) * 1.5, 3.5);
      }
    } else {
      rig.root.visible = true;
      poseOnWave(rig, rider);
      if (run.paddleT > 0) proneOverride(rig, t);
    }
  }

  if (rivalR && rivalRig.root.visible) {
    if (rivalR.down) {
      // The rival's crash is simpler: topple and sink where they fell.
      rivalRig.root.visible = rivalRun.wipeT < 1.6;
      rivalRig.root.position.set(rivalR.p.x,
        Math.max(rivalR.surfaceY - rivalRun.wipeT * 0.55, rivalR.p.y - 1.2), rivalR.p.z);
      rivalRig.root.rotation.z += 3.2 * dt * Math.max(0.15, 1 - rivalRun.wipeT * 0.55);
    } else {
      poseOnWave(rivalRig, rivalR);
      if (run.paddleT > 0) proneOverride(rivalRig, t + 0.7);
    }
  }

  updateGhost();
  if (ghostRig.root.visible) poseOnWave(ghostRig, ghostR);

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
window.__surf = () => ({ t, rider, run, session, trickState, career, mode, heat, rival, elementId,
                         rivalR, rivalRun, rivalRig, ghost, ghostRig,
                         breakId, screens, ui, world, fx, ocean, curl,
                         renderer, scene, camera, THREE });
window.__surfRestart = restart;

/**
 * Start a free-surf session directly, skipping the menus. The element only takes
 * effect in free mode (beginSession forces water for tour and contest), so this is
 * the only way to reach lava, sand, snow or cosmic from a test.
 * ⚠️ beginSession only opens the LINEUP — it does not drop you in, so calling it
 * alone leaves the previous run's dead rider on screen and looks like the element
 * failed to load. Taking an offer is what actually starts a wave.
 */
window.__surfPlay = (breakId_ = 'home', element = 'water', offer = 0) => {
  beginSession('free', { breakId: breakId_, element });
  ui.hide();
  startWave(0, buildOffers()[offer]);
  return { element: elementId, world: world.current, wave: W.SET[0] && W.SET[0].name };
};

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
