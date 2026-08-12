// SURF — the AI surfer.
//
// PURE MODULE. No THREE, no DOM. It DOES take an rng so opponents feel human rather
// than robotic, but the rng is passed in and seeded, so a heat is reproducible.
//
// The opponent is not scripted and it is not faked: it runs the same cascade
// controller that flies the wave in test-sim.mjs, against the same board.js, on the
// same wave. Its whole personality is three numbers — how deep it likes to sit, how
// often it commits to a turn, and how much it wobbles — so a rival that beats you
// beat you by surfing, and one that eats it made a real mistake.
//
// The cascade: how far you are from the breaking point sets how high you want to sit
// on the face; that sets your heading. Low is steep and fast, high is flat and slow.

export const RIVALS = [
  { id: 'jo',    name: 'JO KEANE',      tag: 'patient, never falls',
    wantLag: -6.0, aggression: 0.25, wobble: 0.05, skill: 0.94 },
  { id: 'reyes', name: 'D. REYES',      tag: 'lives in the pocket',
    wantLag: 2.0,  aggression: 0.55, wobble: 0.11, skill: 0.88 },
  { id: 'mak',   name: 'MAKA HALE',     tag: 'tube hunter',
    wantLag: 5.0,  aggression: 0.35, wobble: 0.09, skill: 0.90 },
  { id: 'kit',   name: 'KIT ANDERSEN',  tag: 'all turns, no patience',
    wantLag: -1.0, aggression: 0.95, wobble: 0.16, skill: 0.82 },
  { id: 'vasq',  name: 'R. VASQUEZ',    tag: 'the one to beat',
    wantLag: 4.0,  aggression: 0.70, wobble: 0.06, skill: 0.97 },
];

export const byId = (id) => RIVALS.find((r) => r.id === id) || RIVALS[0];

/** A tiny seeded LCG, so a heat replays identically. */
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createAI(rival, seed) {
  return {
    rival,
    rng: makeRng(seed),
    carveT: 0,        // time left in the current committed turn
    carveDir: 0,
    driftT: 0,
    drift: 0,         // slow wander in preferred line, so it is not a metronome
  };
}

/**
 * One control decision. `wave` is the wave module, `t` sim time.
 * Returns the same {carve, pump, tuck} the player produces.
 */
export function aiInput(ai, r, wave, t, dt) {
  const R = ai.rival;

  // Wander the preferred depth a little, on its own slow clock.
  ai.driftT -= dt;
  if (ai.driftT <= 0) {
    ai.driftT = 1.6 + ai.rng() * 2.8;
    ai.drift = (ai.rng() * 2 - 1) * 3.2 * (1.05 - R.skill);
  }

  // The cascade, width-aware: the wave's own W scales where "high" and "low" are,
  // so a narrow slab and a broad outer-bank swell get the same relative line.
  const k = wave.WAVE.W / 9;
  const relZ = r.p.z - wave.crestZ(r.p.x, t);
  const lag = r.lag ?? 0;
  const want = R.wantLag + ai.drift;
  const tgtZ = Math.max(-9 * k, Math.min(-0.8 * k, (-4 + 0.42 * (lag - want)) * k));
  let carve = Math.max(-1, Math.min(1, (Math.max(-0.6, Math.min(0.5, 0.14 * (tgtZ - relZ) / k)) - r.heading) * 3.5));

  // Commit to a real turn now and then. This is what earns manoeuvre points, and
  // it is also what gets an aggressive rival eaten — the same trade the player makes.
  ai.carveT -= dt;
  if (ai.carveT <= -0.001) {
    const gap = 1.5 + (1 - R.aggression) * 3.4 + ai.rng() * 1.2;
    if (ai.carveT < -gap) {
      ai.carveT = 0.18 + R.aggression * 0.22;
      ai.carveDir = relZ < -4 * k ? 1 : -1;      // off the bottom, or off the top
    }
  } else if (ai.carveT > 0) {
    carve = ai.carveDir;
  }

  // Hands are not perfectly steady.
  carve += (ai.rng() * 2 - 1) * R.wobble;

  return {
    carve: Math.max(-1, Math.min(1, carve)),
    pump: lag > want - 2 && (t * 120 | 0) % 34 === 0 ? 1 : 0,
    tuck: 0,
  };
}

/**
 * Contest judging, which is NOT the arcade score.
 *
 * Real heats are judged on your two best waves, which is why a surfer with one
 * enormous ride and three wipeouts can still win, and why chasing a fifth wave when
 * you already have two good ones is usually a mistake. Keeping that rule makes the
 * heat play differently from the score-attack tour rather than being the same thing
 * with a rival drawn next to it.
 */
export const COUNTING_WAVES = 2;

export function heatScore(waveScores) {
  return [...waveScores].sort((a, b) => b - a).slice(0, COUNTING_WAVES)
    .reduce((a, b) => a + b, 0);
}

/** Convert a raw arcade score for one wave into a 0–10 judged score. */
export function judgeWave(raw) {
  // Compresses hard at the top so a 10 is genuinely rare.
  return Math.min(10, Math.round((10 * (1 - Math.exp(-raw / 4200))) * 10) / 10);
}
