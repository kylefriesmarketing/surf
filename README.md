# SURF

**▶ Play: https://kylefriesmarketing.github.io/surf/**

Ride a real breaking wave. Five waves to a set, each bigger than the last. Hold the
pocket, get barrelled, and try not to let the whitewater land on your head.

![riding the face](shots/surf-riding-the-face.png)

The water is a solved surface, not an animation: the ocean mesh is displaced every
frame by the same function the board is riding, and the spray is ~11,000 real
particles with gravity, drag and collision against that surface.

![inside the barrel](shots/surf-barrel-cam.png)

**This file is the milestone authority. Read it before the code.**

```bash
C:\Users\kylef\tools\node\node.exe surf/serve.mjs 8477     # then http://localhost:8477
```
```bash
C:\Users\kylef\tools\node\node.exe test-sim.mjs
```

## Deploy

This folder **is** the repo (`kylefriesmarketing/surf`), Pages serves `main` at root,
so there is no copy step and no hardcoded file list to forget:

```bash
git push origin main
```

`.nojekyll` is committed and is load-bearing — without it Pages runs the tree through
Jekyll and `lib/` is at risk. Everything is static ES modules over an importmap, so
Pages needs no build.

⚠️ `__surfShot` cannot reach the shot receiver from the deployed site: the page is
https and the receiver is plain http on :8399, so the browser blocks it as mixed
content. Capture from the local server, verify the live build by reading its DOM and
`__surf()` state.

---

## Status — M2 COMPLETE (2026-08-11)

84/84 headless tests green, 0 GL errors, 0 console errors, ~4.4 ms/frame at
1280×720 with ~1,000 live particles.

| System | State |
|---|---|
| Wave field (soliton, peeling point break) | done, 30 tests |
| Rider (constrained-surface dynamics, rails, pump, air) | done, 30 tests |
| Particles (mist / drops / surface foam, real solver) | done |
| Ocean + curl rendering, backlit face, sky | done |
| **The set — 5 escalating waves, session scoring** | **M2, 17 tests** |
| **Manoeuvre detection (5 named tricks)** | **M2, 6 tests** |
| **Barrel camera** | **M2** |
| Camera, HUD, scoring, wipeout, game over, restart | done |
| Audio (WebAudio synth, no files) | done, **not yet heard by a human** |
| Touch controls | written, **untested on a real device** |

**Not done / next:** paddling out / wave selection (waves are handed to you in
order), a real wipeout animation, tuning the audio by ear, mobile testing,
deployment to GitHub Pages.

### M2 — the set
Five waves, each bigger and faster-peeling than the last (`SET` in `wave.js`,
applied by `setWave()` which mutates `WAVE` in place). Score accumulates across the
whole set, so a wave you survive beats a wave you don't. `R` takes the next wave;
after the fifth you get a per-wave breakdown and the set total, which is what
persists as the best score.

⚠️ **Amplitude alone cannot escalate a wave.** A bigger wave has a more powerful
shoulder, so past about `A = 5` a greedy line stops being punished and the risk
gradient collapses — measured, two tests fail. Peel speed rises with amplitude in
every preset to keep the chase honest, and `set: every wave in the set is rideable`
is the test that says whether a new preset is a wave or a cutscene.

⚠️ FIRST LIGHT barrels barely at all and that is **deliberate** — it is the warm-up.
Steepening its face was swept across four values and moved tube time by 0.2 s; the
limit is the height a rider settles at on a small wave, not the face angle.

### M2 — manoeuvres
`tricks.js`, pure, tested headlessly. Nothing is a button press — every manoeuvre is
recognised from what the board actually did:

| | recognised from |
|---|---|
| **BOTTOM TURN** | time spent low on the face, then climbing with the rails loose |
| **OFF THE LIP** | up near the crest, then back down hard enough to break traction |
| **CUTBACK** | out ahead of the break, heading swung >1 rad inside 1.2 s, sliding |
| **AIR / AIR REVERSE** | λ collapsed and you left the water; rotation picks the name |
| **TUBE RIDE** | scored by duration, not as a one-shot |

There are two distinct scoring routes and they do not overlap: a deep tube line
scores barrel time and does almost no turns, a high aggressive line scores
manoeuvres and rarely gets barrelled. Verified both ways in-game.

---

## The one idea the whole game rests on

A surfer trimming across a wave face stays at roughly constant height, so **gravity
does no net work on them** — and yet they accelerate. The energy comes from the
water surface *moving underneath them*: a moving constraint does work through its
normal force.

Model the wave as a static ramp and you get a rider who slides into the trough once
and stalls forever. That is exactly what the first pass did (max speed 7 m/s, could
not stay with the wave). `wave.surfaceAccel()` solves the constrained-body problem
properly:

```
λ = (g + C) / (1 + hx² + hz²)
C = hxx·ẋ² + 2·hxz·ẋż + hzz·ż² + 2·hxt·ẋ + 2·hzt·ż + htt
ẍ = -λ·hx        z̈ = -λ·hz
```

The `htt` and `h_t` terms are the wave shoving you. On a still surface C vanishes and
it reduces exactly to gravity on the tangent plane — a good check if you refactor it.

**λ is also the launch test, for free.** It is how hard the water presses back to
keep you on the surface, and water cannot pull. λ ≤ 0 means the surface dropped away
and you are airborne. That is what going over the lip is. No threshold hack.

There is a test for this (`rider: the moving surface is what does the work`) which
freezes the wave in time and asserts the ride dies. If someone "simplifies"
surfaceAccel back to a tangent-plane projection, that test is what catches it.

---

## Architecture

| File | What | Pure? |
|---|---|---|
| `wave.js` | the wave field: height, normal, surfaceAccel, water velocity, foam, barrel | **yes** — no THREE, no DOM, no Math.random |
| `board.js` | the rider: rails, drag, pump, air, wipeouts | **yes** |
| `particles.js` | pooled particle solver + the emitters | view (Math.random fine) |
| `render.js` | ocean grid, curl ribbon, sky, board+rider rig, lights | view |
| `game.js` | loop, input, camera, scoring, HUD, debug handles | view |
| `sfx.js` | all audio, WebAudio synthesis, no files | view |
| `test-sim.mjs` | 60 headless tests over wave.js + board.js | — |

`wave.js` and `board.js` import nothing from THREE, which is why the entire ride can
be simulated in node. **Run `node test-sim.mjs` after every change to either.**

### Frame of reference (get this wrong and nothing makes sense)
- **+X** = along-shore. You ride +X, chasing the peel. Foam is behind you (−X).
- **+Z** = out to sea. The wave marches shoreward, toward −Z. The face points −Z.
- **Y** = up, still water at 0.
- `lag = breakX(t) − x`: **negative = out on the shoulder, ~0..8 = the pocket and the
  tube, large positive = the whitewater has you.** Nearly every tuning decision in the
  game is expressed in lag.

### The wave is drawn by the same function it is ridden on
`render.js` displaces ~19k vertices per frame by calling `wave.height()` — the exact
function `board.js` integrates against. That costs a couple of ms and it buys the
guarantee that **there is no second copy of the wave in GLSL that can drift out of
sync with the physics.** Do not "optimise" this into a vertex shader.

The grid is built in wave-aligned coordinates (each column's z samples are centred on
`crestZ(x)`) so the sheet hugs the tilted crest line all the way along the point.

---

## ⚠️ Traps — every one of these cost real time

1. **`-x ** 2` is a syntax error in JS.** It bit twice, in two different files, and
   the second time the browser console still showed the *first* error. Write
   `-(x ** 2)`.

2. **The console buffer retains errors across navigations.** A stale
   "Unary operator…" error survived three reloads after the fix and sent me hunting a
   ghost. Verify with a live `window.onerror` hook installed in the same eval, never
   from the buffer.

3. **The Browser pane never composites this page.** `canvas.width` reports 0, rAF is
   suspended, and screenshot tools return blank. Two consequences:
   - Drive frames by hand with **`__surfStep(n, dt, input)`**. Anything that must
     appear in a captured frame belongs inside `frame()`, not inside `loop()`.
   - Photograph the page from inside itself with **`__surfShot(name, w, h, camFn)`**:
     a WebGL drawing buffer is only cleared on composite, so `render()` then
     `toDataURL()` *in the same synchronous task* returns real pixels. It POSTs to
     `tools-shot-receiver.mjs` on :8399 (repo root). Never pipe base64 through a tool
     result.

4. **`gl_PointSize` is in PIXELS.** `aSize` is world metres and `uScale` must be
   `viewportHeight / (2·tan(fov/2))` — see `SprayFX.setViewport`, called every frame
   because the FOV breathes with speed. The first build hardcoded a guess and drew
   single mist puffs ~6000 px across, which read as a blown-out sun.

5. **Surface-locked foam sprites get clipped in half by the depth test.** A 1.6 m
   sprite floating 0.09 m above the water has its lower half underwater, so the field
   renders as repeated hard half-discs. Float them clear (`buoy 0.38`) and keep them
   faint.

6. **The grid-density function must be measured, not trusted.** The first `axis()`
   blended a uniform sweep with a concentrated one and was neither: it clipped the
   range to a third of what was asked for and put the fine sampling 13 m from the
   target — behind the crest instead of on the face — so the wave rendered as a few
   huge facets. Print the resulting gaps across the face before believing any change.

7. **The barrel must sit in FRONT of the whitewater ramp.** An early `foamAt` started
   the foam at `lag = −1.5`, which put the barrel window inside the foam and made
   getting tubed identical to being eaten. The tube is the last few metres of clean
   water before the wave collapses.

8. **The barrel volume must be centred where a rider actually is.** The first
   `barrelAt` required `y > −0.9`, but the face bottoms out around −0.9, so the tube
   was literally unreachable and scored 0.0 s forever. Verify against a traced ride,
   not against intuition about height.

9. **The curl ribbon has to be a SHORT section.** A generous throw ramp built a
   continuous 46 m white curtain standing at the crest which, from the rider's own
   camera, fills the entire screen and hides the wave. It is now a gaussian centred
   on the same window as `wave.barrelAt`, so the tube you see and the tube you score
   are the same tube.

10. **Sun seaward, camera shoreward.** The face points shoreward, so this is the only
    arrangement that gives the translucent backlit glow — the single most recognisable
    thing about a photographed wave. Sun behind the camera renders the wave as a black
    ridge (tried). Sun on the same side as the face lights it flatly (tried).

11. **A grip-limit test must hold speed constant.** Comparing a hard carve to a gentle
    one across two free rides measures the wrong thing: the hard carve spins out, goes
    slow, and a slow board cannot generate enough lateral demand to slide at all — so
    it reported hard carves as grippier than gentle ones. Seed the probe with velocity
    aligned to heading **and in the water's frame**, or a standing sideslip pins the
    rails past their limit on frame one.

12. **Wave amplitude is load-bearing on the risk gradient.** `A = 5.2` was tried: the
    shoulder gets powerful enough that a greedy line stops being punished, two tests
    fail, and the whole risk/reward structure collapses. 4.40 is the ceiling.

13. **Other chats hold the dev-server slots and the ports.** 8466 was already another
    project. `preview_start` capped out at 5 servers owned by other sessions; running
    `serve.mjs` in a background shell and pointing `preview_start {url}` at it works.

14. **⚠️ THE FLOATER WAS CUT, AND SHOULD STAY CUT** unless the mechanic changes. It
    was implemented three ways and all three were *unreachable*: gating on the
    feathering crest fails because a rider placed at the top of the face immediately
    slides back down it (correct physics — verified by placing one there); gating on
    deep whitewater fails because the drag ends the run before any hold duration
    completes; gating on foam + height fails because nine swept controller variants
    all converged to lag 0 with foam 0. **You cannot voluntarily park behind the
    break in this model — you are spat out or eaten.** It would have scored zero
    forever and nobody would have found out. Reviving it needs a way to survive
    behind the break (a pump-out, a longer grace, a speed reserve), not a looser
    threshold. The reasoning is repeated at the cut site in `tricks.js`.

15. **A trick that fires headlessly can still look broken in game, because of the
    LINE, not the wiring.** Zero manoeuvres fired during a tube-focused run and it
    looked like a bug; replaying the exact controller from the passing test fired
    three. Deep tube lines genuinely do not do turns. Check parity with the test's
    own input before hunting for a wiring fault.

16. **`bash` heredocs and `${...}` mangle patch scripts** (the workspace bible warns
    about this and it still cost two rounds — once corrupting `test-sim.mjs` so badly
    that the `ok()` helper swallowed a whole test group and the suite reported
    60/60 while silently skipping it). Write patch content with the Write tool. If a
    script must locate an insertion point, use `lastIndexOf`, not `indexOf` — the
    first `console.log(` in the test file lives *inside* the assertion helper.

---

## Debug handles

```js
__surf()                       // { t, rider, run, session, trickState, fx, ocean, curl, renderer, … }
__surfStep(n, dt, input)       // drive n frames by hand; input null = read the keyboard
__surfAuto(wantLag)            // the cascade autopilot the tests fly (see below)
__surfWave(i)                  // jump straight to wave i of the set
__surfShot(name, w, h, camFn)  // photograph the page → :8399 → a PNG you can Read
__surfRestart()                // next wave if one is waiting, else a fresh set
```

**The autopilot is the real proof the physics works.** `__surfAuto(wantLag)` is a
two-stage cascade: lag error picks a target height on the face, which picks a heading.
Low on the face is steep and fast; high is flat and slow. That single coupling is the
entire control problem of surfing, and a ~6-line controller can fly the wave with it.

Measured risk gradient (60 s, `test-sim.mjs`):

| line | outcome |
|---|---|
| `wantLag 7.5` — greedy | eaten by the foam at ~17 s, 165 m |
| `wantLag 5.5` — the tube line | survives on a ~2 m ridge, 36 s barrelled |
| `wantLag 0` — the pocket | 60 s, 420 m, no tube |
| `wantLag −14` — safe | 60 s, 437 m, never barrelled, dull |

If those four ever collapse into each other, there is no game left.

---

## Scoring

Speed × pocket-proximity, continuously. The tube is worth ~130/s plus a lump on exit,
and it builds the combo multiplier (cap ×8). Slides score while the rails are actually
broken loose. Airs score on landing, scaled by rotation. Run ends on wipeout — foam,
pearl, or a blown landing — or when the point runs out at 900 m. Best score persists in
`localStorage['surf-best']`.

---

## Controls

`A`/`D` carve · `SPACE` pump (time it on the drop; it pays nothing on the flats) ·
`SHIFT` tuck for extra rail grip · `R` paddle back out · `M` mute.
Touch: left/right half carves, second finger pumps — **written, never tested on a device.**
