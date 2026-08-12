// SURF — the rider.
//
// PURE MODULE. No THREE, no DOM, no Math.random. Takes a wave sampler and an input
// struct, returns events. Testable headlessly: `node test-sim.mjs`.
//
// The model is an arcade/sim blend. Real forces underneath:
//   * gravity resolved onto the water's tangent plane — this is what makes dropping
//     down the face fast, and it is the whole reason a surfboard moves at all
//   * a RAIL force: a lateral, sideslip-proportional force with a grip limit, the
//     same shape as a tyre or a wing. Under the limit you carve; over it you slide,
//     and the excess is exactly the number the spray emitter wants
//   * quadratic form drag, higher when off-plane
//   * pumping as a timed impulse, only paid out when the board is actually loaded
// Forgiving on top: a speed cap, a mild velocity-alignment assist so the board does
// not just spin at low speed, and generous wipeout thresholds.
//
// The board is constrained to the surface (y is snapped to the wave) until it
// launches, at which point it is a plain ballistic body until it meets water again.

import * as W from './wave.js';

const G = 9.81;

export const TUNE = {
  railK: 2.35,        // lateral force per unit sideslip per unit speed
  gripMax: 15.5,      // lateral acceleration the rails can hold before they let go
  gripTuck: 1.35,     // grip multiplier while tucked (weight low, rail buried)
  slipDrag: 0.62,     // form drag from skidding sideways — this is what kills speed
  dragPlane: 0.0320,  // quadratic drag while planing
  dragSlow: 0.042,    // quadratic drag below planing speed
  planeSpeed: 4.5,    // above this the board is up and planing
  turnRate: 1.75,     // rad/s of heading authority at low speed
  turnFalloff: 0.42,  // how much of that is lost at top speed
  alignK: 3.2,        // arcade assist: velocity eases toward heading
  assistFade: 7.5,    // ...and is gone entirely above this speed, m/s
  maxSpeed: 25.0,
  pumpImpulse: 7.4,   // m/s of forward speed a perfectly timed pump is worth
  pumpCooldown: 0.30,
  popImpulse: 2.8,    // extra vertical kick when you pop off the lip
  launchEfficiency: 0.70, // fraction of surface-follow speed you carry off the lip
  launchMax: 8.5,     // hard ceiling on launch speed: ~3.7m of air, ~1.7s hang.
                      // Must stay below landHard or airs are unlandable by design.
  launchMin: 3.4,      // below this you never leave the water at all
  launchLambda: 0.9,  // surface support below this and you are off the water
  landHard: 15.0,     // impact speed above which a landing goes wrong. Must clear
                      // launchMax + popImpulse WITH headroom: you land in a trough
                      // that is itself dropping, so you fall further than you rose
                      // and impact runs ~1.5x the launch speed on the big waves.
  landAngle: 0.62,    // heading-vs-velocity mismatch that goes wrong on landing
  foamDrag: 3.1,      // how hard the whitewater scrubs you
  foamGrace: 1.05,    // seconds you can survive inside the foam
  gravityScale: 1.0,
};

export function createRider(t = 0) {
  return {
    p: { x: 0, y: 0, z: 4.5 },
    v: { x: 6.0, y: 0, z: 0 },
    heading: -0.45,      // radians; 0 = straight down the line (+X)
    lean: 0,            // -1..1, visual roll, eased from carve input
    crouch: 0,
    air: false,
    airTime: 0,
    spin: 0,            // accumulated rotation while airborne, for trick scoring
    // derived, refreshed every step so the view and HUD never recompute physics
    speed: 0, slip: 0, slide: 0, slopeRate: 0, surfaceY: 0,
    foam: 0, foamTime: 0, barrel: 0, pocket: 0,
    down: false,        // wiped out
    downReason: '',
    pumpT: 0, lastPumpGain: 0,
    t,
  };
}

const _n = { x: 0, y: 0, z: 0 };
const _w = { x: 0, z: 0 };
const _a = { x: 0, z: 0, lam: 0, hx: 0, hz: 0 };

/**
 * Advance the rider by dt. Returns an event bag the view layer reads for spray,
 * audio and scoring. Call at a fixed dt (the game substeps at 1/120).
 */
export function stepRider(r, t, input, dt) {
  const ev = {
    slide: 0, carve: 0, launched: false, landed: 0, pumped: 0,
    splash: 0, wiped: null, barrelEnter: false, barrelExit: false,
  };
  if (r.down) return ev;

  const p = r.p, v = r.v;
  const wasBarrel = r.barrel > 0.5;

  // --- orientation ------------------------------------------------------------
  const sp2 = Math.hypot(v.x, v.z);
  const turn = TUNE.turnRate * (1 - TUNE.turnFalloff * Math.min(1, sp2 / TUNE.maxSpeed));
  r.heading += input.carve * turn * dt * (r.air ? 0.65 : 1);
  r.lean += (input.carve - r.lean) * Math.min(1, 9 * dt);
  r.crouch += ((input.tuck ? 1 : 0) - r.crouch) * Math.min(1, 8 * dt);
  if (r.air) r.spin += Math.abs(input.carve * turn * 0.65 * dt);

  const fx = Math.cos(r.heading), fz = Math.sin(r.heading);
  const rx = -fz, rz = fx;   // rail axis, +90° from forward in the xz plane

  const hHere = W.height(p.x, p.z, t);
  r.surfaceY = hHere;

  // --- airborne ---------------------------------------------------------------
  if (r.air) {
    v.y -= G * TUNE.gravityScale * dt;
    const ad = 1 - 0.16 * dt;
    v.x *= ad; v.z *= ad;
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    r.airTime += dt;

    const hLand = W.height(p.x, p.z, t);
    if (p.y <= hLand) {
      p.y = hLand;
      const impact = Math.abs(v.y);
      W.normal(p.x, p.z, t, _n);
      // Landing badly means landing across your own direction of travel, or flat
      // out of a big one.
      const vh = Math.hypot(v.x, v.z);
      const mis = vh > 1 ? Math.acos(Math.max(-1, Math.min(1, (v.x * fx + v.z * fz) / vh))) : 0;
      ev.landed = impact;
      ev.splash = impact;
      if (impact > TUNE.landHard || mis > TUNE.landAngle + 0.5) {
        r.down = true; r.downReason = 'landing';
        ev.wiped = 'landing';
      } else {
        // Scrub some speed for the impact, more if you landed sideways.
        const keep = Math.max(0.42, 1 - impact * 0.035 - mis * 0.30);
        v.x *= keep; v.z *= keep;
      }
      v.y = 0;
      r.air = false; r.airTime = 0; r.spin = 0;
    }
    refreshDerived(r, t);
    return ev;
  }

  // --- on the water -----------------------------------------------------------
  W.normal(p.x, p.z, t, _n);
  W.water(p.x, p.z, t, _w);

  // Velocity relative to the moving water. Every force below uses this, not the
  // ground-frame velocity — that distinction IS the wave carrying you.
  const vrx = v.x - _w.x, vrz = v.z - _w.z;
  const speed = Math.hypot(vrx, vrz);

  const fwd = vrx * fx + vrz * fz;
  const slip = vrx * rx + vrz * rz;

  // Rail: lateral force opposing sideslip, capped by grip. The overflow is a slide.
  const grip = TUNE.gripMax * (1 + (TUNE.gripTuck - 1) * r.crouch);
  let lat = -TUNE.railK * slip * Math.min(speed, 18);
  let slide = 0;
  if (Math.abs(lat) > grip) { slide = Math.abs(lat) - grip; lat = Math.sign(lat) * grip; }

  // The wave itself. Gravity down the face AND the shove from the surface moving
  // under the board, both out of the constrained-body solution.
  W.surfaceAccel(p.x, p.z, v.x, v.z, t, _a);
  const gTanX = _a.x * TUNE.gravityScale;
  const gTanZ = _a.z * TUNE.gravityScale;

  // Drag: quadratic along the board, and a heavy penalty for skidding.
  const cd = speed > TUNE.planeSpeed ? TUNE.dragPlane : TUNE.dragSlow;
  const dragF = -cd * fwd * Math.abs(fwd);
  const dragS = -TUNE.slipDrag * slip * Math.abs(slip);

  let ax = gTanX + lat * rx + dragF * fx + dragS * rx;
  let az = gTanZ + lat * rz + dragF * fz + dragS * rz;

  // Whitewater: it shoves you shoreward and scrubs everything.
  const foam = W.foamAt(p.x, p.z, t);
  if (foam > 0.25) {
    const f = (foam - 0.25) / 0.75;
    ax -= v.x * TUNE.foamDrag * f * 0.55;
    az -= v.z * TUNE.foamDrag * f * 0.55;
    r.foamTime += dt * f;
    if (r.foamTime > TUNE.foamGrace) {
      r.down = true; r.downReason = 'foam'; ev.wiped = 'foam';
    }
  } else {
    r.foamTime = Math.max(0, r.foamTime - dt * 1.6);
  }

  // Pump. It only pays when the board is loaded: on a slope, moving, and not
  // already at speed. Mistime it on the flats and you get nothing.
  r.pumpT -= dt;
  if (input.pump && r.pumpT <= 0) {
    r.pumpT = TUNE.pumpCooldown;
    const slopeMag = Math.hypot(_n.x, _n.z);           // 0 flat, ~0.7 on a steep face
    const headroom = Math.max(0, 1 - speed / TUNE.maxSpeed);
    const gain = TUNE.pumpImpulse * Math.min(1, slopeMag / 0.45) * headroom;
    r.lastPumpGain = gain;
    ev.pumped = gain;
    v.x += fx * gain; v.z += fz * gain;
  }

  v.x += ax * dt; v.z += az * dt;

  // Arcade assist: below planing speed the rail force is too weak to steer with,
  // because it scales with speed. Fade the assist out entirely once the board is
  // up and going — above that the rails do the work and the assist would otherwise
  // cancel the very drop down the face that generates speed.
  const sp = Math.hypot(v.x, v.z);
  if (sp > 0.05) {
    const authority = 1 - Math.min(1, sp / TUNE.assistFade);
    if (authority > 0) {
      const k = Math.min(1, TUNE.alignK * authority * dt);
      v.x += (fx * sp - v.x) * k;
      v.z += (fz * sp - v.z) * k;
    }
  }
  if (sp > TUNE.maxSpeed) { const s = TUNE.maxSpeed / sp; v.x *= s; v.z *= s; }

  // Integrate horizontally, then snap to the surface. The vertical motion is not
  // integrated — it is whatever the water does under you, which is also how we
  // detect a launch.
  p.x += v.x * dt;
  p.z += v.z * dt;
  const hNext = W.height(p.x, p.z, t + dt);
  const surfaceRate = (hNext - hHere) / dt;
  p.y = hNext;
  v.y = surfaceRate;

  // Launch, straight out of the physics: λ is how hard the water is pressing back
  // to keep you on the surface, and water cannot pull. Once λ falls to nothing the
  // surface has dropped away and you are in the air. Hitting the lip with speed is
  // what drives λ negative — no threshold hack needed. The small positive bias is
  // the one concession to feel, so you do not flutter in and out at the crest.
  if (_a.lam < TUNE.launchLambda && surfaceRate > 0.5) {
    // ⚠️ HOW FAST YOU LEAVE needs damping and a ceiling, and here is why.
    //
    // Kinematically `surfaceRate` is right: while you are stuck to the surface your
    // true velocity is (vx, surfaceRate, vz), so that is what you carry off the lip.
    // But surfaceRate = ∂h/∂t + v·∇h, and on a near-vertical face this model's
    // ∂h/∂t is enormous — the whole wave is translating shoreward at the celerity
    // through a slope approaching 1. Taken raw it launched riders at up to 31 m/s:
    // 50 m of air, 6 s of hang, landing at an impact of 32 against a threshold of
    // 11, so EVERY air was a guaranteed wipeout. Reported from play, then measured
    // across all four breaks before anything was changed.
    //
    // A real surfer does not carry all of that: they separate from the face before
    // it goes vertical, and the water at the lip is moving away from them as they
    // go. `launchEfficiency` is that loss, and `launchMax` is the ceiling that keeps
    // the biggest waves landable.
    //
    // ⚠️ Do NOT "fix" this by using v·∇h (the ramp you climbed) instead. That was
    // tried: launch fires at the CREST, where the gradient is zero by definition, so
    // the climb term vanishes exactly when it is needed and every air collapses to
    // 0.1 m. Measured, 15 cases, all four breaks.
    let vy = surfaceRate * TUNE.launchEfficiency;
    if (input.pump) vy += TUNE.popImpulse;                 // pop off the lip

    // ⚠️ A launch has to CLEAR launchMin or it does not happen at all. Without this
    // floor the board micro-hops off every ripple — measured at 16–20 launches a
    // minute on the point and 169 a minute on the outer bank, none of them more
    // than a few centimetres. That is not an air, it is a rattle, and it buries the
    // real ones in noise. Below the threshold you simply stay on the water.
    if (vy >= TUNE.launchMin) {
      r.air = true;
      v.y = Math.min(TUNE.launchMax, vy);
      r.airTime = 0; r.spin = 0;
      ev.launched = true;
    }
  }

  r.lam = _a.lam;
  r.slopeRate = surfaceRate;
  r.slip = slip;
  r.slide = slide;      // published so the view, HUD and trick detector can read it
  ev.slide = slide;
  ev.carve = Math.abs(slip);
  refreshDerived(r, t);

  const nowBarrel = r.barrel > 0.5;
  if (nowBarrel && !wasBarrel) ev.barrelEnter = true;
  if (!nowBarrel && wasBarrel) ev.barrelExit = true;

  // Pearled: nose buried in the trough with the board pointed straight at the beach.
  if (!r.air && r.slopeRate < -9.5 && Math.abs(Math.sin(r.heading)) > 0.86 && speed > 9) {
    r.down = true; r.downReason = 'pearl'; ev.wiped = 'pearl';
  }
  return ev;
}

const WAVE_LIP_BAND = 4.2;

function refreshDerived(r, t) {
  const p = r.p, v = r.v;
  r.speed = Math.hypot(v.x, v.z);
  r.foam = W.foamAt(p.x, p.z, t);
  r.barrel = W.barrelAt(p.x, p.y, p.z, t);
  const b = W.breakLag(p.x, t);
  // The pocket: the steep few metres just ahead of the foam. Everything good
  // happens here, which is why the score rewards sitting in it.
  r.pocket = Math.exp(-(((b - 3.5) / 8.0) ** 2));
  r.lag = b;
}

/**
 * Where the rider is dropped in. Just ahead of the break and just OVER the crest
 * onto the face — put him on the back of the wave instead and gravity slides him
 * out to sea while the wave leaves without him.
 */
export function takeoffSpot(t) {
  const x = W.breakX(t) + 11;
  return { x, z: W.crestZ(x, t) - 3.5 };
}
