// SURF — the wave field.
//
// PURE MODULE. No THREE, no DOM, no Math.random. Everything here is a function of
// (x, z, t) and the WAVE constants. The renderer displaces its mesh by calling
// height() on every vertex, and the rider integrates against the same function —
// so the water you see and the water you ride are the SAME SURFACE, by construction.
// Do not add a GLSL copy of this; that is how those two drift apart.
//
// Frame of reference:
//   +X = along-shore. You ride in +X, chasing the peel. The foam is behind you (-X).
//   +Z = out to sea.  The wave marches shoreward, i.e. toward -Z.
//    Y = up. Still water is y = 0.
//
// The wave shape is a SOLITON: h = A·sech²(u/W). That is the exact solution to the
// KdV equation for a shallow-water solitary wave — sharp crest, long flat trough,
// which is what a real breaking wave looks like in cross-section. It is then SKEWED
// (face compressed, back stretched) because a shoaling wave pitches forward, and a
// trough is subtracted ahead of it so there is a real drop to take off down.

export const WAVE = {
  A: 4.40,          // crest height above still water, metres — a solid overhead wave.
                  // 5.2+ was tried: it makes the shoulder powerful enough that a greedy
                  // line stops being punished, which collapses the whole risk gradient.
  W: 9.0,           // cross-shore width scale of the wave body, metres
  c: 9.0,           // celerity — how fast the wave marches shoreward, m/s
  peelSpeed: 10.8,  // how fast the break travels along the shore, m/s (this is the chase)

  faceSteep: 0.34,  // face compression at full break (smaller = more vertical)
  faceMellow: 0.80, // face compression far out on the shoulder
  faceFoam: 1.60,   // face compression once it has collapsed into whitewater
  backK: 1.72,      // back-of-wave stretch (gentle)

  troughPos: 1.32,  // trough centre, in units of W shoreward of the crest
  troughW: 0.86,
  troughDepth: 0.36,

  ampShoulder: 0.16, // amplitude multiplier far ahead of the break
  ampFoam: 0.36,     // amplitude multiplier deep in the whitewater
  rampAhead: 35,     // metres over which the wave stands up ahead of the break
  rampBehind: 26,    // metres over which it collapses behind the break

  orbitalK: 0.56,    // peak water particle speed at the crest, as a fraction of c.
                     // A wave breaks when this reaches 1.0 — we sit just under it.
  boreSpeed: 5.2,    // shoreward push of the whitewater bore, m/s
  pocketPush: 2.4,   // along-shore shove you get for sitting in the pocket, m/s

  chopAmp: 0.115,    // ambient surface texture
  setAmp: 0.52,      // the next swell line, standing off behind (fraction of A)
  setGap: 78,        // how far out to sea that next line sits, metres

  rideLength: 900,   // the point runs out here — the wave closes out
};

// A session is a SET: five waves, each bigger and faster-peeling than the last.
// Amplitude alone cannot escalate — a bigger wave has a more powerful shoulder, so
// past about A = 5 a greedy line stops being punished and the whole risk gradient
// collapses (measured; two tests fail). Peel speed has to rise WITH amplitude so
// the chase stays ahead of what the extra power buys you. Every preset here is
// checked by `set: every wave in the set is rideable` in test-sim.mjs — add a wave
// and that test will tell you whether it is a wave or a cutscene.
// Snapshot of the defaults, taken once at module load. setWave() restores from this
// before applying a preset, so switching waves never accumulates the last one's
// overrides — a bug that only shows up on wave 3 of a set.
const BASE = { ...WAVE };
export const SET = [
  { name: 'FIRST LIGHT', A: 3.60, peelSpeed: 9.4,  faceSteep: 0.38 },
  { name: 'THE BANK',    A: 4.40, peelSpeed: 10.8, faceSteep: 0.34 },
  { name: 'SECOND REEF', A: 5.10, peelSpeed: 12.0, faceSteep: 0.31 },
  { name: 'THE LEDGE',   A: 5.80, peelSpeed: 13.2, faceSteep: 0.29 },
  { name: 'SUNDOWN',     A: 6.50, peelSpeed: 14.4, faceSteep: 0.27 },
];

/** Apply a wave from the set. Mutates WAVE in place — every module holds the same
 *  object reference, so this reaches the sim and the renderer at once. */
export function setWave(i) {
  const p = SET[Math.max(0, Math.min(SET.length - 1, i))];
  Object.assign(WAVE, BASE, p);
  return p;
}

const EXP = Math.exp;

// sech²(x), overflow-guarded. sech²(6) ≈ 2.4e-5, so anything past that is zero.
function sech2(x) {
  const a = x < 0 ? -x : x;
  if (a > 8) return 0;
  const e = EXP(a);
  const s = 2 / (e + 1 / e);
  return s * s;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smooth(t) { return t * t * (3 - 2 * t); }

/** Along-shore position of the breaking point at time t. The thing chasing you. */
export function breakX(t) { return WAVE.peelSpeed * t; }

/** Cross-shore slope of the crest line. Geometry: peel = celerity / crestSlope. */
export function crestSlope() { return WAVE.c / WAVE.peelSpeed; }

/**
 * Where the crest sits, cross-shore, at along-shore position x and time t.
 * The crest line is straight and tilted; the tilt is why the wave peels instead of
 * closing out all at once.
 */
export function crestZ(x, t) {
  return crestSlope() * (x - breakX(t));
}

/**
 * How far BEHIND the breaking point you are, in metres.
 *   b < 0  → out on the green shoulder, wave not yet broken here. Safe, but slow.
 *   b ≈ 0  → the pocket. Steepest, fastest, where the barrel is.
 *   b > 0  → the whitewater has you.
 */
export function breakLag(x, t) { return breakX(t) - x; }

/** Amplitude envelope along the shore: small ahead, full at the break, collapsing behind. */
function ampAlong(b) {
  if (b < 0) {
    const f = smooth(clamp01(1 + b / WAVE.rampAhead));
    return WAVE.ampShoulder + (1 - WAVE.ampShoulder) * f;
  }
  const f = smooth(clamp01(b / WAVE.rampBehind));
  return 1 + (WAVE.ampFoam - 1) * f;
}

/** Face steepness along the shore: mellow shoulder → vertical pocket → broad foam mound. */
function faceAlong(b) {
  if (b < 0) {
    const f = smooth(clamp01(1 + b / 30));
    return WAVE.faceMellow + (WAVE.faceSteep - WAVE.faceMellow) * f;
  }
  const f = smooth(clamp01(b / 22));
  return WAVE.faceSteep + (WAVE.faceFoam - WAVE.faceSteep) * f;
}

/** 0 → clean green water, 1 → fully broken whitewater. Drives foam everywhere. */
export function foamAt(x, z, t) {
  const b = breakLag(x, t);
  const u = (z - crestZ(x, t)) / WAVE.W;
  // Broken along-shore. NOTE the onset is deliberately several metres BEHIND the
  // breaking point, not at it: the tube is the last stretch of clean water before
  // the wave collapses, so the barrel window (b ≈ 2–9) has to sit in front of this
  // ramp. An earlier version started the foam at b = -1.5, which put the barrel
  // inside the whitewater and made getting tubed identical to being eaten.
  const along = smooth(clamp01((b - 2) / 11));
  // ...and only on/inside the crest, not out the back.
  const across = u > 0.55 ? smooth(clamp01((1.5 - u) / 0.95)) : 1;
  // A thin feather of white right on the crest, just ahead of where it breaks.
  // Keep this NARROW. At 0.55 wide and reaching 20 m up the shoulder it painted
  // the entire crest line white for the whole length of the point, which buries
  // the green face — the one surface the game is actually about.
  const lip = smooth(clamp01((b + 7) / 9)) * smooth(clamp01(1 - Math.abs(u + 0.05) / 0.20));
  return clamp01(Math.max(along * across, lip * 0.62));
}

/** Ambient chop. Cheap, sines only — this is texture, not swell. */
function chop(x, z, t) {
  return WAVE.chopAmp * (
    0.55 * Math.sin(x * 0.145 + z * 0.088 - t * 1.7) +
    0.30 * Math.sin(x * 0.052 - z * 0.201 + t * 2.3) +
    0.15 * Math.sin(x * 0.310 + z * 0.260 + t * 3.1)
  );
}

/**
 * Water surface height at (x, z) and time t. THE function. Everything samples this.
 */
export function height(x, z, t) {
  const cz = crestZ(x, t);
  const b = breakX(t) - x;
  const amp = ampAlong(b);
  const u = (z - cz) / WAVE.W;

  // Skewed soliton: steep face shoreward of the crest, long gentle back seaward.
  const k = u >= 0 ? WAVE.backK : faceAlong(b);
  let h = sech2(u / k);

  // The trough ahead of it — the drop.
  const ut = (u + WAVE.troughPos) / WAVE.troughW;
  h -= WAVE.troughDepth * EXP(-ut * ut);

  h *= WAVE.A * amp;

  // The next line of swell, standing off behind. Unbroken, gentle, pure scenery
  // that you can still ride over.
  const u2 = (z - cz - WAVE.setGap) / (WAVE.W * 2.3);
  h += WAVE.A * WAVE.setAmp * sech2(u2);

  return h + chop(x, z, t);
}

const EPS = 0.32;
/**
 * Surface normal by central differences on height(). Deliberately NOT analytic:
 * finite differences cannot disagree with the surface, and an analytic gradient
 * through ampAlong/faceAlong would be a maintenance trap.
 * Writes into `out` = {x,y,z} to keep this allocation-free in the hot loop.
 */
export function normal(x, z, t, out) {
  const hx = (height(x + EPS, z, t) - height(x - EPS, z, t)) / (2 * EPS);
  const hz = (height(x, z + EPS, t) - height(x, z - EPS, t)) / (2 * EPS);
  const inv = 1 / Math.sqrt(hx * hx + hz * hz + 1);
  out.x = -hx * inv; out.y = inv; out.z = -hz * inv;
  return out;
}

const G0 = 9.81;
const SE = 0.35;   // spatial stencil, metres
const ST = 0.02;   // temporal stencil, seconds

/**
 * The horizontal acceleration of a body CONSTRAINED TO THE MOVING WATER SURFACE.
 *
 * This is the heart of the whole game, so it is worth being exact about. A surfer
 * trimming across a face holds roughly constant height in the ground frame, so
 * gravity does no net work on them — yet they accelerate. The energy comes from the
 * surface itself MOVING underneath them: a moving constraint does work through its
 * normal force. Model the wave as a static ramp and you get a rider who slides into
 * the trough once and then stalls forever, which is exactly what the first pass did.
 *
 * Constraint  y = h(x,z,t).  Normal force N = λ·(-hx, 1, -hz). Differentiating the
 * constraint twice and substituting the equations of motion gives
 *
 *     λ = (g + C) / (1 + hx² + hz²)
 *     C = hxx·ẋ² + 2·hxz·ẋż + hzz·ż² + 2·hxt·ẋ + 2·hzt·ż + htt
 *     ẍ = -λ·hx        z̈ = -λ·hz
 *
 * The htt and h_t terms in C are the wave shoving you along; drop them and you are
 * back to a ramp. On a still surface C vanishes and this reduces exactly to gravity
 * resolved onto the tangent plane, which is a good check.
 *
 * λ is also the launch test, for free: it is the force the water exerts to hold you
 * down. Water cannot pull, so λ ≤ 0 means the surface has dropped out from under
 * you and you are airborne. That is what going over the lip is.
 *
 * All derivatives are finite differences on height(), 19 samples. Cheap for one body.
 */
export function surfaceAccel(x, z, vx, vz, t, out) {
  const h0 = height(x, z, t);
  const hpx = height(x + SE, z, t), hmx = height(x - SE, z, t);
  const hpz = height(x, z + SE, t), hmz = height(x, z - SE, t);

  const hx = (hpx - hmx) / (2 * SE);
  const hz = (hpz - hmz) / (2 * SE);
  const hxx = (hpx - 2 * h0 + hmx) / (SE * SE);
  const hzz = (hpz - 2 * h0 + hmz) / (SE * SE);
  const hxz = (height(x + SE, z + SE, t) - height(x + SE, z - SE, t)
             - height(x - SE, z + SE, t) + height(x - SE, z - SE, t)) / (4 * SE * SE);

  const hT = height(x, z, t + ST), hB = height(x, z, t - ST);
  const htt = (hT - 2 * h0 + hB) / (ST * ST);
  const hxt = ((height(x + SE, z, t + ST) - height(x - SE, z, t + ST))
             - (height(x + SE, z, t - ST) - height(x - SE, z, t - ST))) / (4 * SE * ST);
  const hzt = ((height(x, z + SE, t + ST) - height(x, z - SE, t + ST))
             - (height(x, z + SE, t - ST) - height(x, z - SE, t - ST))) / (4 * SE * ST);

  const C = hxx * vx * vx + 2 * hxz * vx * vz + hzz * vz * vz
          + 2 * hxt * vx + 2 * hzt * vz + htt;
  const lam = (G0 + C) / (1 + hx * hx + hz * hz);

  out.x = -lam * hx;
  out.z = -lam * hz;
  out.lam = lam;     // ≤ 0 ⇒ the water is falling away faster than you are: launch
  out.hx = hx; out.hz = hz;
  return out;
}

/**
 * Velocity of the water itself at (x, z, t). This is what "the wave pushing you"
 * actually is — orbital transport near the crest, a shoreward bore in the foam,
 * and a small along-shore shove for sitting in the pocket.
 */
export function water(x, z, t, out) {
  const b = breakX(t) - x;
  const u = (z - crestZ(x, t)) / WAVE.W;
  const amp = ampAlong(b);

  // Orbital transport peaks just shoreward of the crest.
  const o = EXP(-(((u - 0.05) / 1.15) ** 2));
  let wz = -WAVE.c * WAVE.orbitalK * o * amp;
  let wx = 0;

  // The bore: broken water marching at the beach, and dragging along the peel.
  if (b > -2) {
    const f = smooth(clamp01((b + 2) / 12)) * smooth(clamp01((2.2 - u) / 2.0));
    wz -= WAVE.boreSpeed * f;
    wx += WAVE.pocketPush * 0.55 * f;
  }
  // The pocket shove — strongest right at the break, which is why you stay there.
  const pocket = EXP(-(((b - 3.0) / 7.5) ** 2)) * EXP(-(((u + 0.45) / 1.25) ** 2));
  wx += WAVE.pocketPush * pocket;

  out.x = wx; out.z = wz;
  return out;
}

/**
 * The barrel. The lip pitches out from the crest and lands ahead of the face,
 * enclosing a volume. A heightfield cannot represent an overhang, so the curl is
 * rendered as its own ribbon of geometry and tested for analytically here.
 * Returns 0..1: how deep inside the tube the point is.
 */
export function barrelAt(x, y, z, t) {
  const b = breakX(t) - x;
  // The tube only exists in a window right at the break — a few metres of wave.
  const along = EXP(-(((b - 5.5) / 4.2) ** 2));
  if (along < 0.05) return 0;

  const cz = crestZ(x, t);
  const u = (z - cz) / WAVE.W;
  // Deep on the face, under the throwing lip. NOTE this band is centred where a
  // rider actually sits when trimming (u ≈ -0.8, which is BELOW still water — the
  // face bottoms out around y = -0.9). An earlier version required y > -0.9 and
  // was therefore unreachable: the barrel could never be scored. If you retune
  // this, verify against a real traced ride, not against intuition about height.
  const depth = EXP(-(((u + 0.80) / 0.30) ** 2));
  const lipY = WAVE.A * ampAlong(b) * 0.86;
  const under = clamp01((lipY - y) / 2.0);
  return clamp01(along * depth * under * 1.25);
}

/** Height of the throwing lip above still water at along-shore x. Used to aim spray. */
export function lipHeight(x, t) {
  return WAVE.A * ampAlong(breakX(t) - x) * 0.94;
}
