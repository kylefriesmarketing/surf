// SURF — the breaks, and the tour that strings them together.
//
// PURE DATA + PURE FUNCTIONS. No THREE, no DOM, no Math.random. Everything here is
// checked by test-sim.mjs, because a break whose numbers do not work is a wave you
// cannot ride and a heat you cannot pass, and neither of those announces itself.
//
// A break is not just "bigger waves". Each one moves a different set of knobs so it
// plays differently:
//
//   peelSpeed   how fast the section runs away from you — the chase
//   faceSteep   how vertical the face is — steep is fast, unforgiving, barrelling
//   W           the wave's cross-shore width — narrow reads as a slab, wide as a swell
//   rideLength  how far the point runs before it closes out
//   boreSpeed   how hard the whitewater punishes you once it has you
//   ampShoulder how much wave there is out on the shoulder — low means no bail-out
//
// ⚠️ The load-bearing relationship, measured and re-measured: peel speed must rise
// WITH amplitude. A bigger wave has a more powerful shoulder, so past about A = 5
// with a slow peel, a greedy line stops being punished and the risk gradient — the
// entire game — collapses. Every wave below is checked by
// `breaks: every wave at every break is rideable`.

/** The knobs a break is allowed to move. Anything not listed keeps wave.js's default. */
export const BREAKS = [
  {
    id: 'home',
    name: 'HOME POINT',
    sub: 'the one you learned on',
    blurb: 'A long, patient sand-bottom point. It gives you time to think, and a '
         + 'shoulder to run to when you have thought wrong.',
    unlockAt: 0,
    profile: { rideLength: 1000, boreSpeed: 4.6, ampShoulder: 0.20, W: 9.4 },
    waves: [
      { name: 'FIRST LIGHT', A: 3.60, peelSpeed: 9.4,  faceSteep: 0.38 },
      { name: 'THE BANK',    A: 4.40, peelSpeed: 10.8, faceSteep: 0.34 },
      { name: 'SECOND REEF', A: 5.10, peelSpeed: 12.0, faceSteep: 0.31 },
      { name: 'THE LEDGE',   A: 5.80, peelSpeed: 13.2, faceSteep: 0.29 },
      { name: 'SUNDOWN',     A: 6.50, peelSpeed: 14.4, faceSteep: 0.27 },
    ],
  },
  {
    id: 'cove',
    name: 'THE COVE',
    sub: 'short, sharp, and over quickly',
    blurb: 'A beach break with a temper. The sections are quick and they close out '
         + 'early, so everything you want from a wave has to happen in the first '
         + 'few seconds of it.',
    unlockAt: 1,
    // Punchy: fast peel for the size, narrow, closes out early, mean whitewater.
    profile: { rideLength: 560, boreSpeed: 6.2, ampShoulder: 0.11, W: 7.6,
               rampAhead: 26, rampBehind: 20 },
    waves: [
      { name: 'SHOREBREAK',  A: 3.90, peelSpeed: 11.2, faceSteep: 0.32 },
      { name: 'THE WEDGE',   A: 4.60, peelSpeed: 12.6, faceSteep: 0.29 },
      { name: 'SIDE DOOR',   A: 5.30, peelSpeed: 14.0, faceSteep: 0.27 },
      { name: 'CLOSEOUT',    A: 6.00, peelSpeed: 15.4, faceSteep: 0.25 },
    ],
  },
  {
    id: 'shelf',
    name: 'THE SHELF',
    sub: 'a slab over dry rock',
    blurb: 'It jumps off a ledge and throws square. There is no shoulder worth the '
         + 'name — you are either in the tube or you are wearing it.',
    unlockAt: 2,
    // Slab: very steep, very narrow, almost no shoulder, brutal foam. Big scores.
    profile: { rideLength: 480, boreSpeed: 7.4, ampShoulder: 0.07, W: 6.8,
               troughDepth: 0.44, rampAhead: 22, rampBehind: 17, pocketPush: 3.0 },
    waves: [
      { name: 'FIRST LEDGE', A: 4.60, peelSpeed: 12.4, faceSteep: 0.26 },
      { name: 'THE STEP',    A: 5.40, peelSpeed: 13.8, faceSteep: 0.24 },
      { name: 'DRY ROCK',    A: 6.20, peelSpeed: 15.2, faceSteep: 0.22 },
    ],
  },
  {
    id: 'outer',
    name: 'OUTER BANK',
    sub: 'you have to paddle for this one',
    blurb: 'Deep-water swell standing up on an outside bank. Enormous, and slower '
         + 'than it looks — which is its own kind of frightening, because the drop '
         + 'lasts long enough for you to think about it.',
    unlockAt: 4,
    // Big-wave: huge, wide, long, but the peel is slower relative to the size so
    // the drop and the sheer scale are the challenge rather than the chase.
    profile: { rideLength: 1400, boreSpeed: 6.8, ampShoulder: 0.16, W: 13.5,
               rampAhead: 48, rampBehind: 36, setAmp: 0.62, setGap: 105 },
    waves: [
      { name: 'THE HORIZON', A: 7.20, peelSpeed: 14.0, faceSteep: 0.34 },
      { name: 'CLEAN-UP',    A: 8.60, peelSpeed: 15.6, faceSteep: 0.32 },
      // ⚠️ peelSpeed 16.2 is the CEILING for any wave in the game, and it is set by
      // the rider, not the wave. Sustained trim speed tops out around 16–17 m/s, so
      // a peel above that cannot be outrun by anyone and the wave is a cutscene:
      // at 17.2 the best line dies at 20 s having covered 313 m, and it does that
      // at every amplitude from 8.8 to 10.0 — size is not the variable, the chase
      // is. Raise TUNE.maxSpeed / lower drag before raising this.
      { name: 'THE BIG ONE', A: 10.0, peelSpeed: 16.2, faceSteep: 0.30 },
    ],
  },
];

export const byId = (id) => BREAKS.find((b) => b.id === id) || BREAKS[0];

/** Flattened parameters for wave `i` at a break: its profile plus that wave. */
export function waveParams(breakId, i) {
  const b = byId(breakId);
  const w = b.waves[Math.max(0, Math.min(b.waves.length - 1, i))];
  return { ...b.profile, ...w };
}

// ---------------------------------------------------------------- the tour
//
// Heats are the spine of the career. Each is a break, a number of waves, and
// objectives you either meet or you do not. Objectives are checked against the
// SESSION totals, not per wave, so a bad wave can be answered with a good one.
//
// `stars` is how many of the objectives you cleared. Progress through the tour is
// gated on total stars, so you are never hard-blocked by one heat you cannot beat
// — you can go back and surf an earlier one better.

export const OBJECTIVES = {
  score:    { label: (n) => `Score ${n.toLocaleString()}`,        get: (s) => s.total },
  distance: { label: (n) => `Ride ${n} m in total`,               get: (s) => s.dist },
  barrel:   { label: (n) => `${n} s of barrel time`,              get: (s) => s.barrel },
  tubes:    { label: (n) => `Make ${n} tube${n === 1 ? '' : 's'}`, get: (s) => s.tubes },
  tricks:   { label: (n) => `Land ${n} manoeuvres`,               get: (s) => s.tricks },
  airs:     { label: (n) => `Land ${n} air${n === 1 ? '' : 's'}`,  get: (s) => s.airs },
  speed:    { label: (n) => `Hit ${n} km/h`,                      get: (s) => s.topSpeed * 3.6 },
  clean:    { label: (n) => `Finish ${n} wave${n === 1 ? '' : 's'} without wiping out`,
              get: (s) => s.clean },
};

export const TOUR = [
  { id: 'h1', breakId: 'home',  waves: 3, name: 'MORNING SESSION',
    goals: [['score', 3000], ['distance', 300], ['clean', 1]] },
  { id: 'h2', breakId: 'home',  waves: 4, name: 'THE FULL SET',
    goals: [['score', 7000], ['tubes', 1], ['tricks', 3]] },
  { id: 'h3', breakId: 'cove',  waves: 3, name: 'FIRST TRIP',
    goals: [['score', 6000], ['tricks', 4], ['speed', 45]] },
  { id: 'h4', breakId: 'cove',  waves: 4, name: 'ONSHORE',
    goals: [['score', 11000], ['barrel', 4], ['clean', 2]] },
  { id: 'h5', breakId: 'shelf', waves: 3, name: 'LOW TIDE',
    goals: [['score', 9000], ['tubes', 2], ['barrel', 5]] },
  { id: 'h6', breakId: 'shelf', waves: 3, name: 'DRY ROCK',
    goals: [['score', 16000], ['barrel', 9], ['tricks', 5]] },
  { id: 'h7', breakId: 'outer', waves: 3, name: 'THE PADDLE OUT',
    goals: [['score', 14000], ['distance', 900], ['speed', 62]] },
  { id: 'h8', breakId: 'outer', waves: 3, name: 'THE BIG ONE',
    goals: [['score', 26000], ['distance', 1500], ['clean', 2]] },
];

/** Stars needed before a heat opens. Deliberately generous — you should never be
 *  hard-blocked, only encouraged to go back and surf something better. */
export function starsToUnlock(heatIndex) {
  return Math.max(0, heatIndex * 2 - 1);
}

/** Evaluate a finished session against a heat. Returns per-goal results. */
export function judge(heat, totals) {
  return heat.goals.map(([type, target]) => {
    const o = OBJECTIVES[type];
    const got = o.get(totals);
    return { type, target, got, met: got >= target, label: o.label(target) };
  });
}

/** Fresh career state. */
export function newCareer() {
  return { heats: {}, stars: 0, bestSet: 0, lifetime: {
    waves: 0, dist: 0, barrel: 0, tubes: 0, tricks: 0, airs: 0, wipeouts: 0, topSpeed: 0,
  } };
}

/** Fold a finished heat into career state. Idempotent on stars: a heat only ever
 *  contributes its BEST result, so replaying a heat badly cannot cost you progress. */
export function recordHeat(career, heat, results, totals) {
  const stars = results.filter((r) => r.met).length;
  const prev = career.heats[heat.id];
  if (!prev || stars > prev.stars || (stars === prev.stars && totals.total > prev.score)) {
    career.heats[heat.id] = { stars, score: Math.round(totals.total) };
  }
  career.stars = Object.values(career.heats).reduce((a, h) => a + h.stars, 0);
  career.bestSet = Math.max(career.bestSet, Math.round(totals.total));
  const L = career.lifetime;
  L.waves += totals.waves || 0;
  L.dist += Math.round(totals.dist || 0);
  L.barrel = +(L.barrel + (totals.barrel || 0)).toFixed(1);
  L.tubes += totals.tubes || 0;
  L.tricks += totals.tricks || 0;
  L.airs += totals.airs || 0;
  L.wipeouts += totals.wipeouts || 0;
  L.topSpeed = Math.max(L.topSpeed, totals.topSpeed || 0);
  return career.heats[heat.id];
}

export function heatUnlocked(career, i) {
  return career.stars >= starsToUnlock(i);
}

export function breakUnlocked(career, b) {
  return career.stars >= starsToUnlock(b.unlockAt);
}
