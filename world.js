// SURF — the world beyond the wave: headlands, islands, boats, birds, clouds.
//
// VIEW ONLY. Nothing here is sim state, nothing here collides, and none of it is
// read by wave.js or board.js. Math.random is used freely, but only through a
// SEEDED generator so a given break always looks like itself — you should recognise
// where you are before you read the name.
//
// Everything is deliberately cheap: low-poly silhouettes, instanced or merged, sat
// far enough out that they cost almost nothing and read as scale rather than detail.
// Scale is the entire point of them. A wave with nothing behind it has no size; put
// a fishing boat on the horizon and the same wave suddenly reads as overhead.

import * as THREE from 'three';

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------------------------------------------------------------- headlands
/**
 * The land the point runs off. A ridge of low silhouettes far down the line, which
 * is what tells you a point break is a POINT — the wave is peeling away from
 * something.
 */
function makeHeadland(rand, opts) {
  const g = new THREE.Group();
  const n = opts.count;
  for (let i = 0; i < n; i++) {
    const w = opts.wMin + rand() * (opts.wMax - opts.wMin);
    const h = opts.hMin + rand() * (opts.hMax - opts.hMin);
    // A squashed, irregular cone reads as a headland at distance and costs 16 tris.
    const geo = new THREE.ConeGeometry(w, h, 6 + ((rand() * 3) | 0), 1);
    const pos = geo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      pos.setX(v, pos.getX(v) * (0.7 + rand() * 0.7));
      pos.setZ(v, pos.getZ(v) * (0.7 + rand() * 0.7));
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, opts.mat);
    m.position.set((rand() - 0.5) * opts.spread, h / 2 - opts.sink, (rand() - 0.5) * opts.depth);
    m.rotation.y = rand() * Math.PI;
    g.add(m);
  }
  return g;
}

// ---------------------------------------------------------------- boats
/**
 * A hull, a cabin and a mast, in about 60 triangles. It only ever appears at
 * distance, where the silhouette is the whole story.
 */
function makeBoat(rand, tint) {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.75 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.6 });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.52, 3.4), hullMat);
  // Taper the bow so it does not read as a floating brick.
  const hp = hull.geometry.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    if (hp.getZ(i) > 0) hp.setX(i, hp.getX(i) * 0.32);
    if (hp.getY(i) < 0) hp.setX(i, hp.getX(i) * 0.72);
  }
  hull.geometry.computeVertexNormals();
  g.add(hull);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 1.0), trimMat);
  cabin.position.set(0, 0.48, -0.35);
  g.add(cabin);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 2.6, 5), trimMat);
  mast.position.set(0, 1.5, -0.2);
  g.add(mast);
  return g;
}

// ---------------------------------------------------------------- birds
/**
 * A shallow V of gulls. Two triangles each, wings hinged on a shared phase so the
 * flock beats together but not in lockstep.
 */
function makeBird(mat) {
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), mat);
    wing.position.x = side * 0.45;
    wing.rotation.order = 'ZYX';
    g.add(wing);
    g.userData[side < 0 ? 'l' : 'r'] = wing;
  }
  return g;
}

// ---------------------------------------------------------------- clouds
/**
 * Billboarded soft cloud sprites, drawn once into a canvas. Volumetric sky is the
 * renderer's job; these are the near layer that gives the sky parallax and tells
 * you the wind direction.
 */
function cloudTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  // A handful of overlapping soft blobs, denser at the base, so it reads as a cloud
  // rather than a fuzzy ball.
  const r = rng(7);
  for (let i = 0; i < 26; i++) {
    const x = S * (0.15 + r() * 0.7);
    const y = S * (0.42 + r() * 0.34);
    const rad = S * (0.06 + r() * 0.16);
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const a = 0.10 + r() * 0.16;
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- the world
//
// Per-break dressing. These are LOOKS, not gameplay: what is on the horizon at each
// break is how you know which break you are at without reading the HUD.
const DRESSING = {
  home:  { land: { count: 9,  wMin: 26, wMax: 60, hMin: 14, hMax: 34, spread: 620, depth: 260, sink: 6 },
           boats: 3, birds: 3, clouds: 16, landColor: 0x38443f, far: -430 },
  cove:  { land: { count: 14, wMin: 18, wMax: 44, hMin: 10, hMax: 26, spread: 520, depth: 200, sink: 4 },
           boats: 2, birds: 4, clouds: 20, landColor: 0x3d4238, far: -330 },
  shelf: { land: { count: 6,  wMin: 34, wMax: 82, hMin: 26, hMax: 62, spread: 480, depth: 220, sink: 8 },
           boats: 1, birds: 2, clouds: 12, landColor: 0x2f3538, far: -300 },
  outer: { land: { count: 4,  wMin: 40, wMax: 90, hMin: 12, hMax: 30, spread: 900, depth: 300, sink: 14 },
           boats: 4, birds: 2, clouds: 24, landColor: 0x333c40, far: -760 },
};

export class World {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);

    this.cloudTex = cloudTexture();
    this.birdMat = new THREE.MeshBasicMaterial({ color: 0x2a2f33, side: THREE.DoubleSide,
                                                 transparent: true, opacity: 0.75 });
    this.land = [];
    this.boats = [];
    this.birds = [];
    this.clouds = [];
    this.current = null;
    this.t = 0;
  }

  /** Build (or rebuild) the dressing for a break. Cheap enough to do per wave. */
  setBreak(id) {
    if (this.current === id) return;
    this.current = id;
    // Dispose the old world properly — this runs on every break change, and a
    // renderer that leaks a headland per wave will die in a long session.
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material !== this.birdMat) o.material.dispose();
    });
    this.root.clear();
    this.boats.length = 0; this.birds.length = 0; this.clouds.length = 0; this.land.length = 0;

    const d = DRESSING[id] || DRESSING.home;
    // Seeded from the break id, so a break always looks like itself.
    const seed = [...id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7);
    const rand = rng(seed);

    const landMat = new THREE.MeshStandardMaterial({ color: d.landColor, roughness: 0.95,
                                                     flatShading: true });
    // The point runs off DOWN THE LINE (+x), which is what makes it a point break.
    // ⚠️ Land must be given rider-relative offsets and moved in update() like
    // everything else. Placing it once at an absolute position looks fine for two
    // seconds and then drifts, because the rider travels a kilometre down the line
    // while the crest itself marches shoreward — the coastline ended up wherever
    // the arithmetic left it.
    const head = makeHeadland(rand, { ...d.land, mat: landMat });
    head.userData = { x: d.land.spread * 0.55, z: d.far };
    this.root.add(head);
    this.land = [head];

    // A second mass out to sea for depth.
    const isle = makeHeadland(rand, { ...d.land, count: Math.max(2, d.land.count - 5),
                                      mat: landMat });
    isle.userData = { x: -d.land.spread * 0.5, z: d.far * 1.5 };
    isle.scale.setScalar(0.75);
    this.root.add(isle);
    this.land.push(isle);

    const tints = [0xb8452f, 0x2c5f7a, 0xd8d2c4, 0x3f6b4a];
    for (let i = 0; i < d.boats; i++) {
      const b = makeBoat(rand, tints[(rand() * tints.length) | 0]);
      const s = 2.2 + rand() * 2.0;
      b.scale.setScalar(s);
      b.userData = {
        // Boats sit well out to sea, past the wave, drifting slowly along the shore.
        x: (rand() - 0.5) * 420, z: 55 + rand() * 95,
        drift: (rand() - 0.5) * 1.6, bob: rand() * 6.283, s,
      };
      this.root.add(b);
      this.boats.push(b);
    }

    for (let i = 0; i < d.birds; i++) {
      const bird = makeBird(this.birdMat);
      bird.userData = {
        x: (rand() - 0.5) * 300, y: 14 + rand() * 26, z: -40 + rand() * 200,
        vx: 3 + rand() * 5, phase: rand() * 6.283, wob: 0.4 + rand() * 0.8,
      };
      this.root.add(bird);
      this.birds.push(bird);
    }

    for (let i = 0; i < d.clouds; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.cloudTex, transparent: true,
        opacity: 0.30 + rand() * 0.35, depthWrite: false, fog: false });
      const sp = new THREE.Sprite(mat);
      const sc = 120 + rand() * 340;
      sp.scale.set(sc, sc * (0.30 + rand() * 0.18), 1);
      sp.userData = { x: (rand() - 0.5) * 2400, y: 90 + rand() * 190,
                      z: -300 - rand() * 1400, drift: 1.5 + rand() * 3.5 };
      sp.renderOrder = -50;
      this.root.add(sp);
      this.clouds.push(sp);
    }
  }

  /**
   * @param riderX  the world follows the rider down the line, so the horizon never
   *                runs out however far the ride goes.
   */
  update(dt, riderX, crestZ) {
    this.t += dt;
    const T = this.t;

    for (const l of this.land) {
      l.position.set(riderX + l.userData.x, l.position.y, crestZ + l.userData.z);
    }

    for (const b of this.boats) {
      const u = b.userData;
      u.x += u.drift * dt;
      b.position.set(riderX + u.x, Math.sin(T * 0.9 + u.bob) * 0.22 * u.s, crestZ + u.z);
      // Boats roll and pitch on the swell — a static boat reads as a prop.
      b.rotation.z = Math.sin(T * 0.8 + u.bob) * 0.10;
      b.rotation.x = Math.sin(T * 1.15 + u.bob * 1.7) * 0.05;
      b.rotation.y = u.drift > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
    }

    for (const bird of this.birds) {
      const u = bird.userData;
      u.x += u.vx * dt;
      if (u.x > 360) u.x = -360;
      const flap = Math.sin(T * 6.5 + u.phase);
      bird.position.set(riderX + u.x, u.y + Math.sin(T * u.wob + u.phase) * 1.4, crestZ + u.z);
      bird.rotation.y = -Math.PI / 2;
      if (bird.userData.l) { /* built by makeBird */ }
      const l = bird.children[0], r = bird.children[1];
      if (l && r) { l.rotation.z = 0.5 + flap * 0.55; r.rotation.z = -0.5 - flap * 0.55; }
    }

    for (const c of this.clouds) {
      const u = c.userData;
      u.x += u.drift * dt;
      if (u.x > 1400) u.x = -1400;
      c.position.set(riderX + u.x, u.y, crestZ + u.z);
    }
  }
}
