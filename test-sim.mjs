// SURF — headless physics tests.  node test-sim.mjs
// wave.js and board.js are pure, so the whole ride can be simulated with no browser.
// Run this after EVERY change to either file.

import * as W from './wave.js';
import { WAVE } from './wave.js';
import { createRider, stepRider, TUNE, takeoffSpot } from './board.js';
import { createTrickState, updateTricks, TRICKS } from './tricks.js';
import * as B from './breaks.js';
import * as E from './elements.js';

let pass = 0, fail = 0;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
function ok(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; 

console.log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}
function group(n) { console.log(`\n${n}`); }

// ---------------------------------------------------------------- wave shape
group('wave: shape');
{
  const t = 3.0;
  const x = W.breakX(t) - 4;              // just ahead of the break, in the pocket
  const cz = W.crestZ(x, t);

  const hCrest = W.height(x, cz, t);
  const hBack = W.height(x, cz + WAVE.W * 4, t);
  const hFace = W.height(x, cz - WAVE.W * 0.8, t);
  const hTrough = W.height(x, cz - WAVE.W * WAVE.troughPos, t);
  const hFar = W.height(x, cz + 300, t);

  ok('crest is the high point', hCrest > hBack && hCrest > hFace,
     `crest=${hCrest.toFixed(2)} back=${hBack.toFixed(2)} face=${hFace.toFixed(2)}`);
  ok('crest is roughly wave height', hCrest > WAVE.A * 0.7 && hCrest < WAVE.A * 1.25,
     `${hCrest.toFixed(2)} vs A=${WAVE.A}`);
  ok('there is a real trough ahead of it', hTrough < -0.4, `${hTrough.toFixed(2)}`);
  ok('drop from crest to trough is rideable', hCrest - hTrough > WAVE.A,
     `drop=${(hCrest - hTrough).toFixed(2)}`);
  ok('flattens far out to sea', Math.abs(hFar) < 0.35, `${hFar.toFixed(3)}`);

  // The defining asymmetry: a shoaling wave pitches forward, so the face must be
  // steeper than the back. If this ever flips, the wave is unrideable.
  const dFace = (W.height(x, cz - 1, t) - W.height(x, cz - 3, t)) / 2;
  const dBack = (W.height(x, cz + 3, t) - W.height(x, cz + 1, t)) / 2;
  ok('face is steeper than the back', Math.abs(dFace) > Math.abs(dBack) * 1.4,
     `face=${Math.abs(dFace).toFixed(3)} back=${Math.abs(dBack).toFixed(3)}`);
}

group('wave: peel geometry');
{
  ok('break advances along the shore', W.breakX(5) > W.breakX(4));
  ok('peel speed is as configured', near(W.breakX(2) - W.breakX(1), WAVE.peelSpeed, 1e-9));
  // The crest itself must march shoreward at exactly the celerity, or the peel
  // geometry (peel = c / slope) is wrong.
  const x = 40;
  const rate = (W.crestZ(x, 2) - W.crestZ(x, 1)) / 1;
  ok('crest marches shoreward at c', near(rate, -WAVE.c, 1e-9), `${rate.toFixed(3)}`);
  ok('shoulder is ahead of the break', W.breakLag(W.breakX(3) + 20, 3) < 0);
  ok('foam is behind the break', W.breakLag(W.breakX(3) - 20, 3) > 0);
}

group('wave: amplitude envelope');
{
  const t = 6;
  const at = (dx) => { const x = W.breakX(t) - dx; return W.height(x, W.crestZ(x, t), t); };
  const shoulder = at(-60), pocket = at(2), foam = at(45);
  ok('pocket is the tallest part of the wave', pocket > shoulder && pocket > foam,
     `shoulder=${shoulder.toFixed(2)} pocket=${pocket.toFixed(2)} foam=${foam.toFixed(2)}`);
  ok('wave has collapsed in the whitewater', foam < pocket * 0.6, `${foam.toFixed(2)}`);
}

group('wave: normals');
{
  const t = 4, n = { x: 0, y: 0, z: 0 };
  for (const [x, z] of [[0, 0], [30, 6], [-25, -12], [W.breakX(t) - 3, W.crestZ(W.breakX(t) - 3, t) - 5]]) {
    W.normal(x, z, t, n);
    const len = Math.hypot(n.x, n.y, n.z);
    ok(`normal unit length @(${x.toFixed(0)},${z.toFixed(0)})`, near(len, 1, 1e-9), `${len}`);
    ok(`normal points up @(${x.toFixed(0)},${z.toFixed(0)})`, n.y > 0, `${n.y}`);
  }
  // On the face the normal must tilt SHOREWARD (-z), which is what pulls a surfer
  // down the drop. Get this sign wrong and gravity pushes you out the back.
  const t2 = 4, xf = W.breakX(t2) - 4, zf = W.crestZ(xf, t2) - 4;
  W.normal(xf, zf, t2, n);
  ok('face normal tilts shoreward', n.z < -0.15, `n.z=${n.z.toFixed(3)}`);
}

group('wave: water velocity');
{
  const t = 5, w = { x: 0, z: 0 };
  const x = W.breakX(t) - 3;
  W.water(x, W.crestZ(x, t), t, w);
  ok('water at the crest moves shoreward', w.z < -1, `${w.z.toFixed(2)}`);
  // A wave breaks when crest particle speed reaches the celerity. We must sit under
  // that, or the model is describing water that has already exploded.
  ok('crest particle speed is below celerity', Math.abs(w.z) < WAVE.c,
     `${Math.abs(w.z).toFixed(2)} vs c=${WAVE.c}`);
  W.water(W.breakX(t) - 6, W.crestZ(W.breakX(t) - 6, t) - 2, t, w);
  ok('the pocket shoves you down the line', w.x > 0.2, `${w.x.toFixed(2)}`);
  W.water(x, W.crestZ(x, t) + 220, t, w);
  ok('open ocean is nearly still', Math.hypot(w.x, w.z) < 0.6, `${Math.hypot(w.x, w.z).toFixed(3)}`);
}

group('wave: foam + barrel fields');
{
  const t = 7;
  const xb = W.breakX(t);
  ok('foam saturates deep inside', W.foamAt(xb - 40, W.crestZ(xb - 40, t) - 2, t) > 0.85);
  ok('shoulder is clean water', W.foamAt(xb + 45, W.crestZ(xb + 45, t) - 2, t) < 0.25);
  const bx = xb - 4.5, bz = W.crestZ(bx, t) - WAVE.W * 0.72;
  ok('barrel exists under the lip', W.barrelAt(bx, 0.4, bz, t) > 0.3,
     `${W.barrelAt(bx, 0.4, bz, t).toFixed(2)}`);
  ok('no barrel out on the shoulder', W.barrelAt(xb + 60, 0.4, bz, t) < 0.05);
  ok('no barrel above the lip', W.barrelAt(bx, 8, bz, t) < 0.05);
}

// ---------------------------------------------------------------- rider
const DT = 1 / 120;
function ride(steps, inputFn, opts = {}) {
  let t = opts.t0 ?? 0;
  const r = createRider(t);
  const spot = takeoffSpot(t);
  r.p.x = opts.x ?? spot.x; r.p.z = opts.z ?? spot.z;
  r.p.y = W.height(r.p.x, r.p.z, t);
  if (opts.v) { r.v.x = opts.v.x; r.v.z = opts.v.z; }
  const log = { maxSpeed: 0, barrelTime: 0, slideTotal: 0, launches: 0, dist: 0, tubes: 0, _was: false };
  const x0 = r.p.x;
  for (let i = 0; i < steps; i++) {
    r._t = t;
    const inp = inputFn(i * DT, r);
    const ev = stepRider(r, t, inp, DT);
    t += DT;
    log.maxSpeed = Math.max(log.maxSpeed, r.speed);
    const inTube = r.barrel > 0.5;
    if (inTube) { log.barrelTime += DT; if (!log._was) log.tubes++; }
    log._was = inTube;
    log.slideTotal += ev.slide * DT;
    if (ev.launched) log.launches++;
    if (r.down) break;
  }
  log.dist = r.p.x - x0;
  return { r, t, log };
}
const HOLD = () => ({ carve: 0, pump: 0, tuck: 0 });

group('rider: stays on the water');
{
  const { r } = ride(1200, HOLD);
  const h = W.height(r.p.x, r.p.z, r.t ?? 10);
  ok('board is glued to the surface', r.air || Math.abs(r.p.y - W.height(r.p.x, r.p.z, 10)) < 2.5,
     `y=${r.p.y.toFixed(2)} h=${h.toFixed(2)}`);
  ok('nothing went NaN', Number.isFinite(r.p.x + r.p.y + r.p.z + r.v.x + r.v.z),
     JSON.stringify(r.p));
  ok('speed is bounded', r.speed <= TUNE.maxSpeed + 1e-6, `${r.speed.toFixed(2)}`);
}

// The controller a competent surfer runs, and the one every ride test below uses.
// It is a cascade: how far you are from the breaking point sets how high you want
// to sit on the face, and that sets your heading. Low on the face is steep and
// fast; high is flat and slow. That single coupling is the whole control problem
// of surfing, and the fact that this simple policy can fly the wave is the real
// evidence the physics is right.
function surferPolicy(wantLag) {
  return (t, r) => {
    const relZ = r.p.z - W.crestZ(r.p.x, r._t);
    const lag = r.lag ?? 0;
    const want = wantLag(t);
    const tgtZ = Math.max(-8, Math.min(-0.8, -4 + 0.42 * (lag - want)));
    const tgtH = Math.max(-0.6, Math.min(0.5, 0.14 * (tgtZ - relZ)));
    return {
      carve: Math.max(-1, Math.min(1, (tgtH - r.heading) * 3.5)),
      pump: lag > want - 2 && (t * 120 | 0) % 34 === 0 ? 1 : 0,
      tuck: 0,
    };
  };
}


// Same cascade as surferPolicy, but with its height targets scaled by the wave's
// own width. The barrel band is defined at u = -0.80 in units of WAVE.W, so a
// controller that targets a fixed number of METRES sails straight past the tube on
// a narrow break — THE SHELF barrelled 0.6s with the absolute version and 58s with
// this one, and it is the designated slab. Test-harness bug, not a wave bug.
function breakPolicy(wantLag) {
  return (t, r) => {
    const k = WAVE.W / 9;
    const relZ = r.p.z - W.crestZ(r.p.x, r._t);
    const lag = r.lag ?? 0;
    const want = wantLag(t);
    const tgtZ = Math.max(-9 * k, Math.min(-0.8 * k, (-4 + 0.42 * (lag - want)) * k));
    const tgtH = Math.max(-0.6, Math.min(0.5, 0.14 * (tgtZ - relZ) / k));
    return {
      carve: Math.max(-1, Math.min(1, (tgtH - r.heading) * 3.5)),
      pump: lag > want - 2 && (t * 120 | 0) % 34 === 0 ? 1 : 0,
      tuck: 0,
    };
  };
}

group('rider: gravity down the face is the engine');
{
  // Dropped onto the face pointing down the line, with no input at all. If the
  // constrained-surface term is wrong this either does nothing or explodes.
  const t0 = 3;
  const x = W.breakX(t0) + 8;
  const { r, log } = ride(300, HOLD, { t0, x, z: W.crestZ(x, t0) - 3.5, v: { x: 4, z: -1 } });
  ok('the wave accelerates a passive rider', log.maxSpeed > 9,
     `maxSpeed=${log.maxSpeed.toFixed(2)}`);
  ok('and does not launch it to the moon', log.maxSpeed < TUNE.maxSpeed + 0.5,
     `${log.maxSpeed.toFixed(2)}`);
  ok('nothing went NaN under load', Number.isFinite(r.p.x + r.p.y + r.p.z + r.speed));
}

group('rider: the moving surface is what does the work');
{
  // The distinguishing claim of this model. A rider trimming across a face holds
  // roughly constant height, so a STATIC ramp would do no net work on them and
  // they would coast to a stop — the wave carries you because the surface itself
  // is moving. Freeze the wave in time and the ride must die.
  const t0 = 3, x = W.breakX(t0) + 8, z = W.crestZ(x, t0) - 3.5;
  const live = ride(420, HOLD, { t0, x, z, v: { x: 4, z: -1 } });

  let frozen = 0;
  {
    const r = createRider(t0);
    r.p.x = x; r.p.z = z; r.p.y = W.height(x, z, t0); r.v.x = 4; r.v.z = -1;
    // Same geometry, but every step samples the SAME instant, so the surface
    // never moves under the board.
    for (let i = 0; i < 420; i++) { stepRider(r, t0, HOLD(), DT); frozen = Math.max(frozen, r.speed); }
  }
  ok('a live wave beats a frozen one', live.log.maxSpeed > frozen * 1.15,
     `live=${live.log.maxSpeed.toFixed(2)} frozen=${frozen.toFixed(2)}`);
}

group('rider: carving');
{
  const { r: straight } = ride(300, HOLD);
  const { r: carved, log } = ride(300, () => ({ carve: 1, pump: 0, tuck: 0 }));
  ok('carve input changes heading', Math.abs(carved.heading - straight.heading) > 0.5,
     `${carved.heading.toFixed(2)} vs ${straight.heading.toFixed(2)}`);
  ok('a hard carve breaks the rails loose', log.slideTotal > 0,
     `slide=${log.slideTotal.toFixed(2)}`);
}

group('rider: grip limit');
{
  // The rail force saturates: under the cap it holds, over it the board lets go.
  // Measured from a FIXED starting speed, because a spun-out board is slow and a
  // slow board cannot generate enough lateral demand to slide at all — comparing
  // two free rides at different speeds measures the wrong thing entirely, and
  // reported hard carves as grippier than gentle ones.
  const probe = (carve, tuck = 0) => {
    const t0 = 4, x = W.breakX(t0) + 6, z = W.crestZ(x, t0) - 4;
    const r = createRider(t0);
    r.p.x = x; r.p.z = z; r.p.y = W.height(x, z, t0);
    r.heading = -0.2; r.crouch = tuck;
    // Start already trimming: velocity aligned with the heading AND measured in
    // the water's frame. Seeding a raw ground-frame velocity instead leaves a
    // standing sideslip of several m/s on frame one, which pins the rails past
    // their grip limit no matter what the carve input is.
    const w = W.water(x, z, t0, { x: 0, z: 0 });
    r.v.x = w.x + Math.cos(r.heading) * 12;
    r.v.z = w.z + Math.sin(r.heading) * 12;
    let slide = 0;
    for (let i = 0; i < 60; i++) {
      slide += stepRider(r, t0 + i * DT, { carve, pump: 0, tuck }, DT).slide;
    }
    return slide;
  };
  const gentle = probe(0.12), hard = probe(1);
  ok('a gentle carve holds its rail', gentle < 1e-9, `${gentle.toFixed(4)}`);
  ok('a hard carve does not', hard > 1, `${hard.toFixed(2)}`);
  ok('tucking buys extra grip', probe(1, 1) < probe(1, 0),
     `tucked=${probe(1, 1).toFixed(2)} upright=${probe(1, 0).toFixed(2)}`);
}

group('rider: pumping');
{
  const pumpEvery = (t) => ({ carve: 0, pump: (t * 120 | 0) % 40 === 0 ? 1 : 0, tuck: 0 });
  const { r: quiet } = ride(600, HOLD);
  const { r: pumped } = ride(600, pumpEvery);
  ok('pumping is worth speed', pumped.speed > quiet.speed,
     `pumped=${pumped.speed.toFixed(2)} quiet=${quiet.speed.toFixed(2)}`);

  // ...but only when the board is loaded. On dead flat water it must pay nothing.
  const r = createRider(0);
  r.p.x = 0; r.p.z = 400; r.p.y = W.height(0, 400, 0);   // way out the back, flat
  r.v.x = 6; r.v.z = 0; r.heading = 0;
  stepRider(r, 0, { carve: 0, pump: 1, tuck: 0 }, DT);
  ok('a pump on the flats pays almost nothing', r.lastPumpGain < 1.0,
     `gain=${r.lastPumpGain.toFixed(3)}`);
}

group('rider: the foam gets you');
{
  // Parked well behind the break with no input — the whitewater runs him down.
  const t0 = 2;
  const x = W.breakX(t0) - 30;
  const { r } = ride(900, HOLD, { t0, x, z: W.crestZ(x, t0) - 3, v: { x: 0, z: 0 } });
  ok('sitting in the whitewater is a wipeout', r.down && r.downReason === 'foam',
     `down=${r.down} reason=${r.downReason}`);

  // The grace window is real: clipping the foam for one frame must not be fatal.
  const q = createRider(t0);
  q.p.x = x; q.p.z = W.crestZ(x, t0) - 3; q.p.y = W.height(q.p.x, q.p.z, t0);
  stepRider(q, t0, HOLD(), DT);
  ok('but not instantly — there is a grace window', !q.down);
}

group('rider: air');
{
  // Fire the board up the face fast enough and the surface support λ collapses,
  // which is what throws you out of the water. Then gravity has it.
  const t0 = 4;
  const x = W.breakX(t0) - 2;
  const r = createRider(t0);
  r.p.x = x; r.p.z = W.crestZ(x, t0) - 7; r.p.y = W.height(r.p.x, r.p.z, t0);
  r.v.x = 4; r.v.z = 16; r.heading = Math.PI / 2 - 0.2;   // straight at the lip
  let t = t0, launched = false, peak = -99, cameDown = false;
  for (let i = 0; i < 400; i++) {
    const ev = stepRider(r, t, { carve: 0, pump: 0, tuck: 0 }, DT);
    if (ev.launched) launched = true;
    if (r.air) peak = Math.max(peak, r.p.y);
    if (launched && !r.air) cameDown = true;
    t += DT;
    if (r.down) break;
  }
  ok('hitting the lip with speed launches the board', launched);
  ok('and it gets real air', peak > WAVE.A * 0.8, `peak=${peak.toFixed(2)}`);
  ok('gravity brings it back down', cameDown || r.down, `air=${r.air}`);
}

group('rider: determinism');
{
  const script = (t) => ({
    carve: Math.sin(t * 2.1) * 0.8,
    pump: (t * 120 | 0) % 37 === 0 ? 1 : 0,
    tuck: t > 2 && t < 3 ? 1 : 0,
  });
  const a = ride(900, script), b = ride(900, script);
  const fp = (x) => `${x.r.p.x.toFixed(9)}|${x.r.p.z.toFixed(9)}|${x.r.speed.toFixed(9)}`;
  ok('same input, same ride', fp(a) === fp(b), `${fp(a)} vs ${fp(b)}`);
  const c = ride(900, (t) => ({ ...script(t), carve: script(t).carve * 0.99 }));
  ok('different input, different ride', fp(a) !== fp(c));
}

group('rider: a real ride is possible');
{
  // The whole point. If this fails the game is unwinnable and the tuning is wrong.
  const { r, log } = ride(7200, surferPolicy(() => 0));      // 60 seconds
  ok('a competent rider survives a full minute', !r.down, `reason=${r.downReason}`);
  ok('and covers real ground', log.dist > 400, `dist=${log.dist.toFixed(0)}m`);
  ok('at surfing speed', log.maxSpeed > 10, `max=${log.maxSpeed.toFixed(1)}m/s`);
}

group('rider: the barrel is reachable, and it costs something');
{
  // The risk gradient the whole game hangs on. Sitting deeper in the pocket buys
  // tube time and eventually kills you; sitting out on the shoulder is a long dull
  // ride. If these ever collapse into each other there is no game left.
  const deep = ride(7200, surferPolicy(() => 5.5));
  const safe = ride(7200, surferPolicy(() => -14));
  const greedy = ride(7200, surferPolicy(() => 7.5));

  ok('riding deep gets you barrelled', deep.log.barrelTime > 3,
     `${deep.log.barrelTime.toFixed(1)}s`);
  ok('riding safe never does', safe.log.barrelTime < 0.5,
     `${safe.log.barrelTime.toFixed(1)}s`);
  ok('the safe line is the longer ride', safe.log.dist > deep.log.dist,
     `safe=${safe.log.dist.toFixed(0)}m deep=${deep.log.dist.toFixed(0)}m`);
  ok('and greed is punished', greedy.r.down && greedy.log.dist < safe.log.dist * 0.6,
     `greedy=${greedy.log.dist.toFixed(0)}m down=${greedy.r.downReason}`);

  // Getting in and back out again — what a good ride actually looks like.
  const inout = ride(7200, surferPolicy((t) => (Math.sin(t * 0.42) > 0 ? 6 : -9)));
  ok('you can drop in, get tubed, and pull back out', !inout.r.down && inout.log.tubes >= 2,
     `tubes=${inout.log.tubes} barrel=${inout.log.barrelTime.toFixed(1)}s down=${inout.r.downReason}`);
}

group('set: every wave in the set is rideable');
{
  // A five-wave set only escalates if each wave stays a WAVE: survivable on a good
  // line, punishing on a greedy one. Amplitude alone cannot do that — a bigger wave
  // has a more powerful shoulder, so past about A = 5 greed stops being punished and
  // the risk gradient collapses (measured). Peel speed rises with amplitude in the
  // presets to keep the chase honest, and this is the test that says whether it worked.
  const before = { ...WAVE };
  for (let i = 0; i < W.SET.length; i++) {
    const p = W.setWave(i);
    const good = ride(7200, surferPolicy(() => -14));
    const greedy = ride(7200, surferPolicy(() => 8.5));
    ok(`${p.name}: a good line survives the wave`, !good.r.down, `down=${good.r.downReason}`);
    ok(`${p.name}: and covers real ground`, good.log.dist > 400, `${good.log.dist.toFixed(0)}m`);
    ok(`${p.name}: greed is still punished`, greedy.r.down, `survived=${greedy.log.dist.toFixed(0)}m`);
  }

  W.setWave(0);
  const first = ride(7200, surferPolicy(() => -14));
  W.setWave(W.SET.length - 1);
  const last = ride(7200, surferPolicy(() => -14));
  // Measured by GROUND COVERED, not top speed. Top speed is drag-limited and barely
  // moves across the set (15.0 → 16.4 m/s), so asserting on it reads as "the set
  // does not escalate" when what actually escalates is how much wave you have to
  // outrun: the peel is faster, so the same 60 seconds takes you half as far again.
  ok('the set escalates', last.log.dist > first.log.dist * 1.25,
     `first=${first.log.dist.toFixed(0)}m last=${last.log.dist.toFixed(0)}m`);
  ok('and the later waves are faster', last.log.maxSpeed > first.log.maxSpeed,
     `first=${first.log.maxSpeed.toFixed(1)} last=${last.log.maxSpeed.toFixed(1)}`);

  // The tube is the reward for the later waves. Wave 1 is a warm-up and barrels
  // barely at all — that is DELIBERATE, not a bug to be tuned out. Steepening its
  // face was tried across four values and moved tube time by 0.2s; the limit is the
  // height the rider settles at on a small wave, not the face angle.
  W.setWave(1);
  const bank = ride(7200, surferPolicy(() => 5.5));
  ok('the tube opens up from wave 2 on', bank.log.barrelTime > 3,
     `${bank.log.barrelTime.toFixed(1)}s`);

  Object.assign(WAVE, before);
  ok('setWave leaves no residue between waves',
     WAVE.A === before.A && WAVE.peelSpeed === before.peelSpeed && WAVE.faceSteep === before.faceSteep);
}


group('tricks: every manoeuvre is reachable');
{
  // Dead content is the failure mode here. A manoeuvre nobody can trigger scores
  // zero forever and nobody finds out, so each one gets an input designed to
  // produce it and has to actually fire. The first pass shipped four unreachable
  // tricks — snap wanted the rider above relZ −2.6 and cutback wanted lag < −4,
  // neither of which a rider holding the pocket ever visits.
  const DTT = 1 / 120;

  /** Ride with a scripted input, return which manoeuvres fired. */
  function trickRun(steps, inputFn, opts = {}) {
    let t = opts.t0 ?? 4;
    const r = createRider(t);
    const sp = takeoffSpot(t);
    r.p.x = opts.x ?? sp.x; r.p.z = opts.z ?? sp.z;
    r.p.y = W.height(r.p.x, r.p.z, t);
    r.v.x = opts.vx ?? 5; r.v.z = opts.vz ?? -1;
    if (opts.heading !== undefined) r.heading = opts.heading;
    const ts = createTrickState();
    const fired = {};
    for (let i = 0; i < steps; i++) {
      r._t = t;
      const ev = stepRider(r, t, inputFn(i * DTT, r), DTT);
      for (const m of updateTricks(ts, r, ev, t, DTT)) fired[m.key] = (fired[m.key] || 0) + 1;
      t += DTT;
      if (r.down) break;
    }
    return { fired, r };
  }

  // Hold the pocket, then throw a sharp carve on a rhythm. This is what an
  // aggressive rider does, and it should produce turns off the bottom.
  const carver = (period, dur) => (tt, r) => {
    const relZ = r.p.z - W.crestZ(r.p.x, r._t);
    const lag = r.lag ?? 0;
    const tgtZ = Math.max(-8, Math.min(-0.8, -4 + 0.42 * (lag - 1.5)));
    const auto = Math.max(-1, Math.min(1, (Math.max(-0.6, Math.min(0.5, 0.14 * (tgtZ - relZ))) - r.heading) * 3.5));
    const phase = tt % period;
    const hard = phase < dur ? (Math.floor(tt / period) % 2 ? 1 : -1) : 0;
    return { carve: hard || auto, pump: (tt * 120 | 0) % 34 === 0 ? 1 : 0, tuck: 0 };
  };

  const agg = trickRun(4800, carver(2.2, 0.25));
  ok('a bottom turn fires', (agg.fired.bottom || 0) > 0, JSON.stringify(agg.fired));

  // Ride HIGH on the face and snap back down off the top.
  const high = trickRun(4800, (tt, r) => {
    const relZ = r.p.z - W.crestZ(r.p.x, r._t);
    const auto = Math.max(-1, Math.min(1, (Math.max(-0.6, Math.min(0.5, 0.14 * (-2.0 - relZ))) - r.heading) * 3.5));
    const phase = tt % 1.9;
    return { carve: phase < 0.3 ? -1 : auto, pump: (tt * 120 | 0) % 30 === 0 ? 1 : 0, tuck: 0 };
  });
  ok('an off-the-lip fires', (high.fired.snap || 0) > 0, JSON.stringify(high.fired));

  // Race out onto the shoulder, then swing the board all the way back.
  const cut = trickRun(4800, (tt, r) => {
    const relZ = r.p.z - W.crestZ(r.p.x, r._t);
    const auto = Math.max(-1, Math.min(1, (Math.max(-0.6, Math.min(0.5, 0.14 * (-5.0 - relZ))) - r.heading) * 3.5));
    const phase = tt % 3.0;
    return { carve: phase < 0.75 ? 1 : phase < 1.4 ? -1 : auto, pump: (tt * 120 | 0) % 34 === 0 ? 1 : 0, tuck: 0 };
  });
  ok('a cutback fires', (cut.fired.cutback || 0) > 0, JSON.stringify(cut.fired));

  // Straight at the lip with speed: the surface support collapses and the board flies.
  const t0 = 4, xa = W.breakX(t0) - 2;
  const air = trickRun(900, () => ({ carve: 0, pump: 0, tuck: 0 }),
    { t0, x: xa, z: W.crestZ(xa, t0) - 7, vx: 4, vz: 16, heading: Math.PI / 2 - 0.2 });
  ok('an air fires on a clean landing',
     (air.fired.air || 0) + (air.fired.airRev || 0) > 0 || air.r.down,
     JSON.stringify(air.fired) + ' down=' + air.r.downReason);

  // And the rails must be able to hold: a smooth trim scores nothing at all, or
  // manoeuvre points would just be a tax on existing.
  const smooth = trickRun(4800, surferPolicy(() => -14));
  const total = Object.values(smooth.fired).reduce((a, b) => a + b, 0);
  ok('a smooth trim triggers nothing', total === 0, JSON.stringify(smooth.fired));
}


group('breaks: every wave at every break is rideable');
{
  // Four breaks that play differently is only worth having if all of them are
  // actually surfable. A break whose numbers do not work is a wave you cannot ride
  // and a heat you cannot pass, and neither announces itself in play.
  const before = W.waveDefaults();
  let broken = [];
  for (const b of B.BREAKS) {
    for (let i = 0; i < b.waves.length; i++) {
      W.applyWave(B.waveParams(b.id, i));
      const label = `${b.name} / ${b.waves[i].name}`;
      const safe = ride(7200, breakPolicy(() => -14));
      const greedy = ride(7200, breakPolicy(() => 9));
      const good = !safe.r.down && safe.log.dist > 200 && greedy.r.down;
      if (!good) broken.push(`${label}: safe=${safe.log.dist.toFixed(0)}m/${safe.r.downReason || 'alive'} greedy=${greedy.r.downReason || 'ALIVE'}`);
    }
  }
  ok('all 15 waves survive a good line and punish a greedy one', broken.length === 0,
     broken.join(' | '));

  // Each break has to actually feel different, or they are reskins.
  const character = {};
  for (const b of B.BREAKS) {
    W.applyWave(B.waveParams(b.id, b.waves.length - 1));
    const r = ride(7200, breakPolicy(() => -14));
    character[b.id] = { dist: r.log.dist, speed: r.log.maxSpeed };
  }
  ok('the outer bank is the fastest wave in the game',
     character.outer.speed > character.home.speed,
     `outer=${character.outer.speed.toFixed(1)} home=${character.home.speed.toFixed(1)}`);
  // Distinguish the breaks by the things they were DESIGNED to differ on, not by
  // top speed — the cove's last wave peels at 15.4 and the shelf's at 15.2, so
  // "the slab is faster" was an invented claim that the numbers never made.
  const len = (id) => B.byId(id).profile.rideLength;
  ok('the slab is the shortest ride', len('shelf') === Math.min(...B.BREAKS.map((b) => b.profile.rideLength)),
     `shelf=${len('shelf')} cove=${len('cove')} home=${len('home')}`);
  ok('the outer bank runs longest', len('outer') === Math.max(...B.BREAKS.map((b) => b.profile.rideLength)),
     `${len('outer')}`);
  ok('every break has a distinct profile',
     new Set(B.BREAKS.map((b) => JSON.stringify(b.profile))).size === B.BREAKS.length);

  // The shelf is the BARREL break — that is its whole identity. If it stops
  // barrelling it has no reason to exist.
  W.applyWave(B.waveParams('shelf', 2));
  const slab = ride(7200, breakPolicy(() => 5.5));
  ok('the slab barrels', slab.log.barrelTime > 5, `${slab.log.barrelTime.toFixed(1)}s`);

  W.applyWave(before);
  ok('applyWave leaves no residue', WAVE.A === before.A && WAVE.W === before.W
     && WAVE.rideLength === before.rideLength);
}

group('tour: the career holds together');
{
  // Every goal has to be reachable, or a heat is unpassable and nobody finds out
  // until they are stuck on it.
  let unreachable = [];
  for (const h of B.TOUR) {
    const br = B.byId(h.breakId);
    if (h.waves > br.waves.length) unreachable.push(`${h.id}: wants ${h.waves} waves, ${br.name} has ${br.waves.length}`);
    for (const [type] of h.goals) {
      if (!B.OBJECTIVES[type]) unreachable.push(`${h.id}: unknown goal type "${type}"`);
    }
    for (const [type, target] of h.goals) {
      if (type === 'clean' && target > h.waves) unreachable.push(`${h.id}: needs ${target} clean of ${h.waves} waves`);
    }
  }
  ok('every heat is internally consistent', unreachable.length === 0, unreachable.join(' | '));

  // Progression must not deadlock: the stars available before a heat must always
  // cover what that heat demands.
  let gated = [];
  let available = 0;
  for (let i = 0; i < B.TOUR.length; i++) {
    if (B.starsToUnlock(i) > available) gated.push(`${B.TOUR[i].id} needs ${B.starsToUnlock(i)}, only ${available} earnable before it`);
    available += B.TOUR[i].goals.length;
  }
  ok('the tour cannot deadlock', gated.length === 0, gated.join(' | '));

  // Judging.
  const heat = B.TOUR[0];
  const totals = { total: 5000, dist: 400, barrel: 2, tubes: 1, tricks: 2, airs: 0,
                   topSpeed: 12, clean: 2, waves: 3, wipeouts: 1 };
  const res = B.judge(heat, totals);
  ok('judging returns one result per goal', res.length === heat.goals.length);
  ok('a met goal reads as met', res.every((r) => typeof r.met === 'boolean'));
  ok('goals with headroom pass', B.judge(heat, totals).filter((r) => r.met).length >= 2,
     JSON.stringify(B.judge(heat, totals).map((r) => `${r.type}:${r.got}/${r.target}`)));
  const weak = B.judge(heat, { total: 0, dist: 0, barrel: 0, tubes: 0, tricks: 0, airs: 0, topSpeed: 0, clean: 0 });
  ok('an empty session clears nothing', weak.every((r) => !r.met));

  // Career state.
  const c = B.newCareer();
  B.recordHeat(c, heat, res, totals);
  const firstStars = c.stars;
  ok('finishing a heat earns stars', firstStars > 0, `${firstStars}`);
  ok('lifetime stats accumulate', c.lifetime.waves === 3 && c.lifetime.tubes === 1);

  // Replaying a heat BADLY must never cost you progress.
  B.recordHeat(c, heat, weak, { total: 10, dist: 1, barrel: 0, tubes: 0, tricks: 0,
                                airs: 0, topSpeed: 1, clean: 0, waves: 3, wipeouts: 3 });
  ok('a bad replay cannot take stars away', c.stars === firstStars, `${c.stars} vs ${firstStars}`);
  ok('but lifetime stats still count it', c.lifetime.waves === 6);
  ok('best set score is kept', c.bestSet === 5000, `${c.bestSet}`);

  ok('the first heat is open from the start', B.heatUnlocked(B.newCareer(), 0));
  ok('later heats are not', !B.heatUnlocked(B.newCareer(), B.TOUR.length - 1));
  ok('the home break is open from the start', B.breakUnlocked(B.newCareer(), B.BREAKS[0]));
}


group('rider: airs are landable');
{
  // ⚠️ REGRESSION GUARD. This shipped broken and was caught in play: coming off the
  // top launched you at up to 31 m/s for FIFTY METRES of air and a 6 s hang, landing
  // at an impact of 32 against a wipeout threshold of 11 — so every single air was a
  // guaranteed wipeout. The cause was using the raw surface-follow rate as launch
  // velocity; that number is ∂h/∂t + v·∇h, and on a near-vertical face the first
  // term is the whole wave translating shoreward through a slope approaching 1.
  const before = W.waveDefaults();
  const flights = [];
  for (const [bid, wi] of [['home', 1], ['home', 4], ['cove', 2], ['shelf', 2], ['outer', 2]]) {
    W.applyWave(B.waveParams(bid, wi));
    for (const vz of [12, 18, 24]) {
      const t0 = 4, x = W.breakX(t0) - 2;
      const r = createRider(t0);
      r.p.x = x; r.p.z = W.crestZ(x, t0) - 7; r.p.y = W.height(r.p.x, r.p.z, t0);
      r.v.x = 6; r.v.z = vz; r.heading = Math.PI / 2 - 0.25;
      let t = t0, cur = null;
      for (let i = 0; i < 1400; i++) {
        const ev = stepRider(r, t, HOLD(), DT);
        if (ev.launched) cur = { vy: r.v.y, base: r.p.y, peak: r.p.y };
        if (r.air && cur) cur.peak = Math.max(cur.peak, r.p.y);
        if (ev.landed && cur) { cur.impact = ev.landed; flights.push(cur); cur = null; }
        t += DT;
        if (r.down) { flights.push({ ...(cur || {}), wiped: r.downReason }); break; }
      }
    }
  }

  const airs = flights.filter((f) => f.base !== undefined);
  const heights = airs.map((f) => f.peak - f.base);
  const impacts = airs.map((f) => f.impact).filter((v) => v !== undefined);
  const launches = airs.map((f) => f.vy);

  ok('airs actually happen', airs.length > 4, `${airs.length} flights`);
  ok('no air exceeds the launch ceiling', Math.max(...launches) <= TUNE.launchMax + 1e-6,
     `max launch ${Math.max(...launches).toFixed(1)} vs cap ${TUNE.launchMax}`);
  ok('no air goes higher than a surfer could', Math.max(...heights) < 6,
     `biggest ${Math.max(...heights).toFixed(1)}m`);
  ok('landing impact stays under the wipeout threshold',
     impacts.length === 0 || Math.max(...impacts) <= TUNE.landHard,
     `worst impact ${Math.max(...impacts).toFixed(1)} vs landHard ${TUNE.landHard}`);
  ok('the launch ceiling is below the landing threshold — airs must be landable',
     TUNE.launchMax + TUNE.popImpulse <= TUNE.landHard,
     `${TUNE.launchMax} + ${TUNE.popImpulse} vs ${TUNE.landHard}`);

  const wipes = flights.filter((f) => f.wiped === 'landing').length;
  ok('straight airs off the lip are mostly survivable', wipes <= 2,
     `${wipes} landing wipeouts across ${flights.length} flights`);

  W.applyWave(before);
}


group('elements: every medium is rideable');
{
  // An element moves real physics (grip, drag, gravity, pace), and any of those can
  // quietly make a medium unsurfable — lava and sand shipped their first draft
  // unrideable on 6 of 8 probed break waves, because a heavy medium caps the rider
  // below the break's peel speed. paceScale is the fix, and this is its guard.
  const tuneBefore = E.elementDefaults();
  const waveBefore = W.waveDefaults();
  let broken = [];
  for (const el of E.LIST) {
    for (const [bid, wi] of [['home', 1], ['home', 4], ['shelf', 2], ['outer', 2]]) {
      E.applyElement(el, B.waveParams(bid, wi));
      const safe = ride(7200, breakPolicy(() => -14));
      const greedy = ride(7200, breakPolicy(() => 9));
      if (safe.r.down || safe.log.dist < 200 || !greedy.r.down) {
        broken.push(`${el.id}@${bid}${wi}: safe=${safe.log.dist.toFixed(0)}m/${safe.r.downReason || 'ok'} greedy=${greedy.r.downReason || 'ALIVE'}`);
      }
    }
  }
  ok('all five media are rideable on all probed breaks', broken.length === 0, broken.join(' | '));

  // Identity: the media must PLAY differently, or they are palette swaps that cost
  // five physics profiles of maintenance. Measure each on the same break wave.
  const probe = {};
  for (const el of E.LIST) {
    E.applyElement(el, B.waveParams('home', 3));
    const r = ride(7200, breakPolicy(() => -12));
    let airT = 0;
    // A second run that hunts airs: hold high, pop at the lip.
    E.applyElement(el, B.waveParams('home', 3));
    {
      const t0 = 4, x = W.breakX(t0) - 2;
      const rr = createRider(t0);
      rr.p.x = x; rr.p.z = W.crestZ(x, t0) - 7; rr.p.y = W.height(rr.p.x, rr.p.z, t0);
      rr.v.x = 6; rr.v.z = 16; rr.heading = Math.PI / 2 - 0.25;
      let t = t0;
      for (let i = 0; i < 1400; i++) {
        stepRider(rr, t, { carve: 0, pump: 1, tuck: 0 }, DT);
        if (rr.air) airT += DT;
        t += DT;
        if (rr.down) break;
      }
    }
    probe[el.id] = { speed: r.log.maxSpeed, dist: r.log.dist, airT };
  }
  ok('snow is faster than water', probe.snow.speed > probe.water.speed,
     `snow=${probe.snow.speed.toFixed(1)} water=${probe.water.speed.toFixed(1)}`);
  ok('lava is the slowest medium', probe.lava.speed === Math.min(...E.LIST.map((e) => probe[e.id].speed)),
     JSON.stringify(Object.fromEntries(E.LIST.map((e) => [e.id, +probe[e.id].speed.toFixed(1)]))));
  ok('cosmic hangs in the air longest — that is its whole identity',
     probe.cosmic.airT === Math.max(...E.LIST.map((e) => probe[e.id].airT)),
     JSON.stringify(Object.fromEntries(E.LIST.map((e) => [e.id, +probe[e.id].airT.toFixed(2)]))));

  // No residue: leaving an element must restore both the board and the wave.
  E.applyElement(E.byId('water'), {});
  ok('water restores the rider tuning exactly',
     JSON.stringify(TUNE) === JSON.stringify(tuneBefore),
     'TUNE drifted after an element round-trip');
  W.applyWave(waveBefore);
  ok('and the wave is back to defaults', WAVE.A === waveBefore.A && WAVE.c === waveBefore.c);
}


group('lineup: the bomb is still a wave');
{
  // The lineup offers a bigger wave for a score multiplier. A × 1.13 pushes every
  // wave past its designed size, and oversized amplitude is exactly how the risk
  // gradient collapses (the M2 finding) — so the WORST case, each break's biggest
  // wave scaled up, has to stay survivable on a good line and lethal on a greedy
  // one, or the bomb is either a cutscene or a free multiplier.
  const before = W.waveDefaults();
  let broken = [];
  for (const b of B.BREAKS) {
    const wi = b.waves.length - 1;
    const params = B.waveParams(b.id, wi);
    params.A *= 1.13;
    E.applyElement(E.byId('water'), params);
    const safe = ride(7200, breakPolicy(() => -14));
    const greedy = ride(7200, breakPolicy(() => 9));
    if (safe.r.down || safe.log.dist < 200 || !greedy.r.down) {
      broken.push(`${b.id}: safe=${safe.log.dist.toFixed(0)}m/${safe.r.downReason || 'ok'} greedy=${greedy.r.downReason || 'ALIVE'}`);
    }
  }
  ok('every break\'s biggest wave survives a ×1.13 bomb scale', broken.length === 0,
     broken.join(' | '));
  W.applyWave(before);
}

group('records: per-element buckets');
{
  const c = B.newCareer();
  const totals = { total: 4200, dist: 300, barrel: 3, tubes: 1, tricks: 2, airs: 1,
                   topSpeed: 12, clean: 1, waves: 3, wipeouts: 2 };
  B.recordHeat(c, { id: 'x1', goals: [] }, [], totals, 'lava');
  B.recordHeat(c, { id: 'x2', goals: [] }, [], { ...totals, total: 900 }, 'lava');
  B.recordHeat(c, { id: 'x3', goals: [] }, [], { ...totals, total: 7000 }, 'snow');
  B.recordHeat(c, { id: 'x4', goals: [] }, [], totals);          // defaults to water

  ok('media accumulate separately', c.elements.lava.waves === 6 && c.elements.snow.waves === 3,
     JSON.stringify(Object.keys(c.elements)));
  ok('best set per medium keeps the max, not the last',
     c.elements.lava.best === 4200 && c.elements.snow.best === 7000,
     `lava=${c.elements.lava.best} snow=${c.elements.snow.best}`);
  ok('the elementId default is water', c.elements.water && c.elements.water.waves === 3);
  ok('lifetime still counts everything', c.lifetime.waves === 12, `${c.lifetime.waves}`);

  // A pre-M4 save has no `elements` key at all; recordHeat must not explode on it.
  const old = B.newCareer();
  delete old.elements;
  B.recordHeat(old, { id: 'x5', goals: [] }, [], totals, 'cosmic');
  ok('a pre-elements save is healed in place', old.elements.cosmic.waves === 3);
}


group('tricks: the grab');
{
  // A grab is a HELD tuck in the air — long enough to be deliberate, fired once
  // per flight, stacking with the AIR scored on landing.
  const flight = (inputFn) => {
    const t0 = 4, x = W.breakX(t0) - 2;
    const r = createRider(t0);
    r.p.x = x; r.p.z = W.crestZ(x, t0) - 7; r.p.y = W.height(r.p.x, r.p.z, t0);
    r.v.x = 5; r.v.z = 16; r.heading = Math.PI / 2 - 0.25;
    const ts = createTrickState();
    const fired = {};
    let t = t0;
    for (let i = 0; i < 900; i++) {
      const ev = stepRider(r, t, inputFn(i * DT, r), DT);
      for (const m of updateTricks(ts, r, ev, t, DT)) fired[m.key] = (fired[m.key] || 0) + 1;
      t += DT;
      if (r.down) break;
    }
    return fired;
  };
  const held = flight((tt, r) => ({ carve: 0, pump: 1, tuck: r.air ? 1 : 0 }));
  ok('a held tuck in the air is a grab', (held.grab || 0) === 1, JSON.stringify(held));
  const tap = flight((tt, r) => ({ carve: 0, pump: 1, tuck: r.air && r.airTime < 0.15 ? 1 : 0 }));
  ok('a tap is not', (tap.grab || 0) === 0, JSON.stringify(tap));
  const none = flight(() => ({ carve: 0, pump: 1, tuck: 0 }));
  ok('no tuck, no grab', (none.grab || 0) === 0, JSON.stringify(none));
  ok('the grab does not replace the landed air', (held.air || 0) + (held.airRev || 0) >= 1,
     JSON.stringify(held));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);