// SURF — the elements you can ride.
//
// PURE DATA + one pure application function. No THREE, no DOM, no Math.random.
//
// A medium is not a reskin. Each one moves REAL numbers in the physics, so it plays
// differently before it looks different:
//
//   celerity      how fast the wave itself travels — slow media feel heavy
//   dragPlane     how much the medium resists you — this sets your top speed
//   gripMax       how much the rails can hold before they let go. Low grip means a
//                 surface you slide on; high grip means one you can set a line in
//   foamGrace     how long the broken stuff takes to kill you. Lava is short
//   gravityScale  the whole force balance, including airs
//
// The palette is applied by writing the EXISTING shader uniforms (uDeep, uShallow,
// uGlow, uSky, uHorizon, uSunCol, uZenith, uLow). No shader is edited to add an
// element — if a new one needs a new uniform, it is probably not an element, it is
// a new renderer.
//
// ⚠️ Every element is checked by `elements: every medium is rideable` in
// test-sim.mjs. Low grip and low gravity in particular can make a medium
// unsurfable, and it is not obvious by eye.

export const ELEMENTS = {
  water: {
    id: 'water', name: 'WATER', spray: 'SPRAY',
    physics: {},                                   // the baseline everything else bends
    tune: {},
    pal: { deep: 0x062b3b, shallow: 0x287f84, glow: 0x4fb99e, sky: 0x94aab4,
           horizon: 0x8b9aa0, sunCol: 0xffedca, foam: 0xf0f8fa, zenith: 0x24394a, low: 0x8b9aa0 },
    fog: 0x9b9b91,
    tint: [0.90, 0.96, 1.00],
    sprayGravity: 9.81, sprayDrag: 1.35, sprayLife: 1.0,
    world: 'coast',
  },

  lava: {
    id: 'lava', name: 'LAVA', spray: 'EMBERS',
    // ⚠️ A VOLCANO FLANK, not a wave. Lava runs DOWNHILL — so this is a descent,
    // like sand and snow, not a swell that travels toward you. Molten rock is slow
    // and thick: committed heavy turns, a low top speed, and a chilled crust at the
    // bottom of the flank that will not let go once it has you.
    dune: true,
    physics: { dune: 1, duneTilt: 0, duneRun: 2.6, chopAmp: 0.05,
               orbitalK: 0, boreSpeed: 0, pocketPush: 0 },
    tune: { dragPlane: 0.050, dragSlow: 0.070, gripMax: 19.0, slipDrag: 0.80,
            foamGrace: 0.60, maxSpeed: 19 },
    ampScale: 2.6,
    pal: { deep: 0x1a0704, shallow: 0xc4400e, glow: 0xff9433, sky: 0x35180f,
           horizon: 0x6b2e15, sunCol: 0xffb066, foam: 0xffb35c, zenith: 0x0d0503, low: 0x4a1e0c },
    fog: 0x4a2416,
    tint: [1.00, 0.52, 0.16],
    sprayGravity: 11.5, sprayDrag: 0.85, sprayLife: 1.5,   // embers arc and linger
    world: 'volcano',
  },

  sand: {
    id: 'sand', name: 'SAND', spray: 'DUST',
    // ⚠️ SAND IS NOT A WAVE. It is a STANDING DUNE and you ride DOWN it. The
    // surface does not travel, nothing chases you, and gravity is the only engine
    // — see the dune branch in wave.js. The resource is ALTITUDE: point down the
    // fall line for speed and the runout arrives fast; traverse across the face to
    // stay high and the run lasts. The surface is loose, so the rails break away
    // early and everything is a drift.
    dune: true,
    physics: { dune: 1, duneTilt: 0, duneRun: 3.0, chopAmp: 0.05,
               orbitalK: 0, boreSpeed: 0, pocketPush: 0 },
    tune: { dragPlane: 0.030, gripMax: 10.5, slipDrag: 0.34, foamGrace: 1.45,
            maxSpeed: 21 },
    ampScale: 3.2,     // dunes are LANDFORMS — tens of metres, not chest high
    pal: { deep: 0x6b4a24, shallow: 0xd9ad63, glow: 0xf2d191, sky: 0xc2ab80,
           horizon: 0xd8c39a, sunCol: 0xfff0cc, foam: 0xeedbb2, zenith: 0x8f9c9e, low: 0xd8c39a },
    fog: 0xd8c39a,
    tint: [0.86, 0.72, 0.47],
    sprayGravity: 6.2, sprayDrag: 2.2, sprayLife: 2.2,     // dust hangs
    world: 'dunes',
  },

  snow: {
    id: 'snow', name: 'SNOW', spray: 'POWDER',
    // ⚠️ A MOUNTAIN FACE, not a wave. The longest and fastest descent in the game:
    // near-frictionless, edges that bite hard, and a big vertical to spend. This is
    // the medium where a clean line is worth the most.
    dune: true,
    physics: { dune: 1, duneTilt: 0, duneRun: 4.2, chopAmp: 0.07,
               orbitalK: 0, boreSpeed: 0, pocketPush: 0 },
    tune: { dragPlane: 0.018, dragSlow: 0.030, gripMax: 21.0, slipDrag: 0.44,
            foamGrace: 0.85, maxSpeed: 28 },
    ampScale: 4.0,
    pal: { deep: 0x46617e, shallow: 0xd6e6f4, glow: 0xc4e4ff, sky: 0x9fbcd4,
           horizon: 0xdfe8ee, sunCol: 0xfff8e8, foam: 0xffffff, zenith: 0x2c465e, low: 0xdfe8ee },
    fog: 0xdfe8ee,
    tint: [1.00, 1.00, 1.00],
    sprayGravity: 4.4, sprayDrag: 2.6, sprayLife: 2.0,     // powder billows
    world: 'peaks',
  },

  cosmic: {
    id: 'cosmic', name: 'COSMIC', spray: 'MOTES',
    // A standing wave in something that is not quite matter. Low gravity, almost no
    // drag: everything is slower to fall and further to fly, and an air lasts long
    // enough to think in.
    physics: { c: 12.6, orbitalK: 0.50, boreSpeed: 4.4, chopAmp: 0.09, setAmp: 0.7 },
    tune: { gravityScale: 0.42, dragPlane: 0.015, dragSlow: 0.028, gripMax: 12.5,
            slipDrag: 0.40, maxSpeed: 30, foamGrace: 1.6, launchMax: 7.0 },
    pal: { deep: 0x0a0622, shallow: 0x5b3fae, glow: 0xa877ff, sky: 0x2b2056,
           horizon: 0x3d2b68, sunCol: 0xffd9f4, foam: 0xcaa8ff, zenith: 0x050310, low: 0x2a1a48 },
    fog: 0x2b2056,
    tint: [0.76, 0.60, 1.00],
    sprayGravity: 2.0, sprayDrag: 1.0, sprayLife: 3.0,     // motes drift forever
    world: 'void',
  },
};

export const byId = (id) => ELEMENTS[id] || ELEMENTS.water;
export const LIST = Object.values(ELEMENTS);

// ---------------------------------------------------------------- application
import { applyWave } from './wave.js';
import { TUNE } from './board.js';

// Snapshot of the rider tuning at module load, BEFORE any element has touched it.
// applyElement always restores from this first, so switching lava → water cannot
// leave lava's drag behind — the same no-residue rule applyWave enforces for the
// wave, applied to the board. That class of bug only shows up on the third medium
// of a session and looks like the game slowly going mushy.
const TUNE_BASE = { ...TUNE };

/**
 * Put the game in a medium: element physics layered over a break's wave.
 * The break says WHERE you are surfing (peel, size, ride length); the element says
 * WHAT you are surfing (weight, grip, gravity). Order matters — the element's
 * physics win over the break's on the fields both touch, because "it is lava"
 * outranks "it is a slab".
 */
export function applyElement(el, breakParams = {}) {
  Object.assign(TUNE, TUNE_BASE, el.tune);
  const p = { ...breakParams, ...el.physics };
  // ⚠️ A heavy medium must slow the CHASE, not just the rider. Lava caps the board
  // at ~15 m/s, and the later waves peel at 13–16 — so without this, lava and sand
  // were unrideable on 6 of 8 probed break waves: the best possible line died in
  // 5–21 s, out-run by its own wave. The measured rule from the outer bank applies
  // per-medium: sustainable trim speed sets the peel ceiling, so a medium that
  // lowers one must lower the other.
  if (el.paceScale && p.peelSpeed) p.peelSpeed *= el.paceScale;
  // A dune is a landform, not a swell: it wants to be tens of metres tall, but the
  // break presets are sized for waves. Scale rather than override, so the
  // break-to-break variation (a small dune field vs a big one) survives.
  if (el.ampScale && p.A) p.A *= el.ampScale;
  applyWave(p);
  return el;
}

/** For tests: undo everything an element did to the rider. */
export function elementDefaults() { return { ...TUNE_BASE }; }
