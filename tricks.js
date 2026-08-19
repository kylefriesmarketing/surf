// SURF — manoeuvre detection.
//
// PURE MODULE (imports only wave.js). No THREE, no DOM, no Math.random — so the
// whole thing is testable headlessly alongside the rider.
//
// Nothing here is a button press. Every manoeuvre is RECOGNISED from what the board
// actually did: where it was on the face, how fast the heading swung, whether the
// rails were past their grip limit, whether it left the water. That means you cannot
// spam tricks — you have to actually do them — and it means a trick fires for the
// same reason a real one would count.

import * as W from './wave.js';

export const TRICKS = {
  bottom:   { name: 'BOTTOM TURN',  points: 55,  hold: 0.7 },
  snap:     { name: 'OFF THE LIP',  points: 240, hold: 1.4 },
  cutback:  { name: 'CUTBACK',      points: 180, hold: 1.4 },
  air:      { name: 'AIR',          points: 260, hold: 1.6 },
  grab:     { name: 'GRABBED AIR',  points: 200, hold: 1.6 },
  airRev:   { name: 'AIR REVERSE',  points: 620, hold: 2.0 },
  tube:     { name: 'TUBE RIDE',    points: 0,   hold: 2.2 },  // scored by duration
};

export function createTrickState() {
  return {
    cool: {},              // per-trick cooldown, so one manoeuvre fires once
    lowT: 0,               // time spent low on the face (bottom-turn setup)
    highT: 0,              // time spent high on the face (lip setup)
    headHist: [],          // recent heading samples, for reversal detection
    wasAir: false,
    grabFired: false,
    spinAtLaunch: 0,
    lastRelZ: 0,
  };
}

const COOLDOWN = 0.9;

/**
 * Advance detection by dt and return an array of manoeuvres that just completed.
 * @param ts    state from createTrickState()
 * @param r     the rider
 * @param ev    the event bag from stepRider
 * @param t     sim time
 */
export function updateTricks(ts, r, ev, t, dt) {
  const out = [];
  for (const k in ts.cool) if (ts.cool[k] > 0) ts.cool[k] -= dt;
  const fire = (key, extra) => {
    if ((ts.cool[key] || 0) > 0) return;
    ts.cool[key] = COOLDOWN;
    const T = TRICKS[key];
    out.push({ key, name: T.name, points: T.points, hold: T.hold, ...extra });
  };

  const relZ = r.p.z - W.crestZ(r.p.x, t);
  const lipY = W.lipHeight(r.p.x, t);
  const foam = r.foam;

  // Heading history over the last ~1.2 s, for reversal detection.
  ts.headHist.push({ t, h: r.heading });
  while (ts.headHist.length && t - ts.headHist[0].t > 1.2) ts.headHist.shift();

  // --- airs. The rider left the water; what it did up there decides the name.
  if (r.air && !ts.wasAir) ts.spinAtLaunch = r.spin;
  if (!r.air && ts.wasAir) {
    // Landed. ev.landed carries the impact; a wipeout is handled by the caller.
    if (!r.down) {
      const spun = r.spin;                         // reset by stepRider on landing…
      const rot = Math.max(spun, ts.lastSpin || 0); // …so use the value we cached
      if (rot > 1.1) fire('airRev', { rot });
      else fire('air', { rot });
    }
  }
  ts.lastSpin = r.air ? r.spin : ts.lastSpin;
  ts.wasAir = r.air;

  // --- grab: tuck held in the air. Fires mid-flight (stacking with the AIR
  // scored on landing), once per flight — grabT resets on the water, and the
  // flag re-arms with it.
  if (r.air && !ts.grabFired && (r.grabT || 0) > 0.30) {
    ts.grabFired = true;
    fire('grab', { held: r.grabT });
  }
  if (!r.air) ts.grabFired = false;

  if (r.air) { ts.lowT = 0; ts.highT = 0; return out; }

  // ⚠️ THE FLOATER WAS CUT, ON PURPOSE. Do not re-add it without reading this.
  //
  // Riding across the top of a section as it breaks under you is a real manoeuvre
  // and it was implemented three different ways. All three were UNREACHABLE:
  //   * gated on the feathering crest — a rider placed at the top of the face
  //     immediately slides back down it, which is correct physics, not a bug;
  //   * gated on deep whitewater — the foam drag ends the run before any hold
  //     duration completes, because the grace window is 1.05 s;
  //   * gated on foam + height — nine controller variants were swept and every
  //     one converged to lag 0 with foam 0. You cannot voluntarily park behind
  //     the break in this model; you are either spat out or eaten.
  // It scored zero forever and nobody would ever have found out. Fewer manoeuvres
  // that all fire beats a longer list with dead entries in it.
  // Reviving it needs a mechanic that lets a rider survive behind the break —
  // a pump-out, a longer grace, or a real speed reserve — not a looser threshold.

  // --- bottom turn: get low on the face, then swing the board back up hard.
  if (relZ < -6.5) ts.lowT += dt; else ts.lowT = Math.max(0, ts.lowT - dt * 2);
  const climbing = relZ > ts.lastRelZ;
  if (ts.lowT > 0.35 && climbing && ev.slide > 1.5 && r.speed > 7) {
    fire('bottom');
    ts.lowT = 0;
  }

  // --- off the lip: reach the top of the face with speed, then come back down
  // hard enough to break the rails loose. The snap, not the climb, is the trick.
  if (relZ > -4.2) ts.highT += dt; else ts.highT = Math.max(0, ts.highT - dt * 2);
  if (ts.highT > 0.18 && !climbing && ev.slide > 2.5 && r.speed > 7.5) {
    fire('snap');
    ts.highT = 0;
  }

  // --- cutback: out on the shoulder, swing the whole board back toward the pocket.
  // Gated on being AHEAD of the break, because the same rotation done in the pocket
  // is a snap, and scoring it twice would make the two indistinguishable.
  if ((r.lag ?? 0) < 0 && ts.headHist.length > 4) {
    const swing = r.heading - ts.headHist[0].h;
    if (Math.abs(swing) > 1.00 && ev.slide > 1.5 && r.speed > 6.5) {
      fire('cutback', { swing: Math.abs(swing) });
      ts.headHist.length = 0;
    }
  }

  ts.lastRelZ = relZ;
  return out;
}
