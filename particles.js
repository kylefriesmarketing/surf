// SURF — the particle engine.
//
// Every drop of water in the air is a real body: gravity, quadratic air drag, wind,
// and a collision test against the SAME wave surface the board rides. Nothing here
// is a canned sprite animation.
//
// VIEW LAYER. Math.random is allowed and used freely — none of this feeds back into
// wave.js or board.js, so spray can be as noisy as it likes without touching the
// determinism of the ride.
//
// One THREE.Points per pool, preallocated, no garbage in the hot loop. Live
// particles are packed at the front of the arrays and killed by swap-remove, so the
// draw range is always exactly the live count and dead particles cost nothing.

import * as THREE from 'three';

/** Soft radial sprite, drawn once into a canvas. `hard` gives a tighter droplet. */
function sprite(hard) {
  const S = 64, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  if (hard) {
    grad.addColorStop(0.00, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.92)');
    grad.addColorStop(0.75, 'rgba(255,255,255,0.28)');
    grad.addColorStop(1.00, 'rgba(255,255,255,0)');
  } else {
    grad.addColorStop(0.00, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.42)');
    grad.addColorStop(0.70, 'rgba(255,255,255,0.11)');
    grad.addColorStop(1.00, 'rgba(255,255,255,0)');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// aSize is in METRES of world diameter. uScale converts that to pixels and MUST be
// viewport_height / (2·tan(fov/2)) — see SprayFX.setViewport. Hardcoding a guess
// here is how the first build ended up drawing single mist puffs 6000px across.
const VERT = `
attribute float aSize;
attribute float aLife;
attribute vec3 aColor;
uniform float uScale;
varying float vLife;
varying vec3 vCol;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / max(0.35, -mv.z), 1.0, 420.0);
  gl_Position = projectionMatrix * mv;
  vLife = aLife;
  vCol = aColor;
}`;

const FRAG = `
uniform sampler2D uTex;
uniform float uOpacity;
varying float vLife;
varying vec3 vCol;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  // Fade in over the first sliver of life so nothing pops, then out over the last
  // third so spray dissolves instead of blinking off.
  float fin = smoothstep(1.0, 0.94, vLife);
  float fout = smoothstep(0.0, 0.34, vLife);
  float a = t.a * uOpacity * fin * fout;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol * t.rgb, a);
}`;

export class Pool {
  /**
   * @param {object} o
   *   max      particle capacity
   *   gravity  m/s² downward
   *   drag     air drag coefficient (per second, linear)
   *   size     base point size
   *   additive blend mode
   *   hard     droplet sprite instead of soft mist
   *   surface  'kill' | 'stick' | 'none' — what happens on hitting water
   *   stride   check water every Nth particle per frame (1 = every particle)
   */
  constructor(o) {
    this.max = o.max;
    this.g = o.gravity ?? 9.81;
    this.drag = o.drag ?? 0.6;
    this.surface = o.surface ?? 'kill';
    this.stride = o.stride ?? 3;
    this.count = 0;
    this.frame = 0;
    this.buoy = o.buoy ?? 0;

    const n = this.max;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.life = new Float32Array(n); this.max_ = new Float32Array(n);

    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.aSize = new Float32Array(n);
    this.aLife = new Float32Array(n);
    this.aColor = new Float32Array(n * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.aLife, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.aColor, 3));
    geo.setDrawRange(0, 0);
    // The pools move with the rider over hundreds of metres; a stale bounding
    // sphere frustum-culls the whole system away mid-ride.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: sprite(o.hard) },
        uScale: { value: 620 },
        uOpacity: { value: o.opacity ?? 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = o.order ?? 10;
    this.geo = geo;
  }

  emit(x, y, z, vx, vy, vz, life, size, r, g, b) {
    let i;
    if (this.count < this.max) {
      i = this.count++;
    } else {
      // Full: recycle the oldest-looking slot rather than dropping the event, so
      // a big splash still reads when the pool is saturated.
      i = (Math.random() * this.max) | 0;
    }
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.max_[i] = life;
    this.aSize[i] = size;
    const c = i * 3;
    this.aColor[c] = r; this.aColor[c + 1] = g; this.aColor[c + 2] = b;
  }

  kill(i) {
    const last = --this.count;
    if (i !== last) {
      this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
      this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
      this.life[i] = this.life[last]; this.max_[i] = this.max_[last];
      this.aSize[i] = this.aSize[last];
      const a = i * 3, b = last * 3;
      this.aColor[a] = this.aColor[b];
      this.aColor[a + 1] = this.aColor[b + 1];
      this.aColor[a + 2] = this.aColor[b + 2];
    }
  }

  /**
   * @param heightAt (x,z) => water surface height. The exact same function the
   *        board is riding, so spray lands on the wave it came off.
   */
  update(dt, heightAt, windX, windZ, onSplash) {
    this.frame++;
    const dragF = Math.max(0, 1 - this.drag * dt);
    const par = this.frame % this.stride;

    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); i--; continue; }

      this.vy[i] -= this.g * dt;
      this.vx[i] = (this.vx[i] + windX * dt) * dragF;
      this.vz[i] = (this.vz[i] + windZ * dt) * dragF;
      this.vy[i] *= dragF;

      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;

      if (this.surface !== 'none' && (i % this.stride) === par) {
        const h = heightAt(this.px[i], this.pz[i]);
        if (this.surface === 'stick') {
          // Surface foam: ride the water instead of falling through it.
          this.py[i] = h + this.buoy;
        } else if (this.py[i] < h) {
          if (onSplash && this.life[i] > 0.12 && Math.random() < 0.14) {
            onSplash(this.px[i], h, this.pz[i], this.vy[i]);
          }
          this.kill(i); i--; continue;
        }
      }

      const p = i * 3;
      this.pos[p] = this.px[i]; this.pos[p + 1] = this.py[i]; this.pos[p + 2] = this.pz[i];
      this.aLife[i] = this.life[i] / this.max_[i];
    }

    this.geo.setDrawRange(0, this.count);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

/**
 * All the water in the air, and the emitters that put it there. Every emitter is
 * driven by a physical quantity out of the sim — rail spray by how far past its
 * grip limit the board is, lip throw by the wave's own height and celerity — so
 * the spray is a readout of the physics rather than decoration on top of it.
 */
export class SprayFX {
  constructor(scene) {
    this.mist = new Pool({ max: 5200, gravity: 3.2, drag: 1.35, hard: false,
                           additive: true, opacity: 0.30, stride: 4, order: 12 });
    this.drops = new Pool({ max: 3600, gravity: 9.81, drag: 0.22, hard: true,
                            additive: false, opacity: 0.95, stride: 3, order: 11 });
    this.foam = new Pool({ max: 2600, gravity: 0, drag: 1.9, hard: false,
                           additive: false, opacity: 0.34, surface: 'stick',
                           buoy: 0.38, stride: 1, order: 9 });
    this.pools = [this.foam, this.mist, this.drops];
    for (const p of this.pools) scene.add(p.points);
    this.wakeT = 0;
    this.lipT = 0;
  }

  get liveCount() { return this.pools.reduce((n, p) => n + p.count, 0); }

  /**
   * Convert world metres to pixels for this camera. gl_PointSize is in pixels, so
   * a sprite of world diameter S at distance d covers S·H/(2·d·tan(fov/2)) of them.
   * The camera's FOV breathes with speed, so this has to be re-set every frame,
   * not once at startup.
   */
  setViewport(heightPx, fovDeg) {
    const s = heightPx / (2 * Math.tan((fovDeg * Math.PI / 180) / 2));
    for (const p of this.pools) p.mat.uniforms.uScale.value = s;
  }

  /**
   * Spray thrown off the rail. `slide` is the sim's grip overflow — how much
   * lateral force the rails could NOT hold — so the board only throws water when
   * it is genuinely breaking traction, and harder the more it is skidding.
   */
  rail(x, y, z, fx, fz, slide, speed, dt) {
    if (slide <= 0.01) return;
    const rate = Math.min(210, slide * 7 + speed * 3) * dt;
    const nx = -fz, nz = fx;               // out to the side, off the rail
    let n = rate | 0;
    if (Math.random() < rate - n) n++;
    for (let i = 0; i < n; i++) {
      const s = rnd(0.55, 1.5) * (1 + slide * 0.05);
      const up = rnd(1.6, 5.2) * (0.5 + speed * 0.05);
      const back = rnd(-0.35, 0.15) * speed;
      const side = Math.sign(slide || 1);
      this.mist.emit(
        x + nx * rnd(-0.3, 0.3), y + rnd(0.02, 0.3), z + nz * rnd(-0.3, 0.3),
        nx * s * 2.4 * side + fx * back + rnd(-1, 1),
        up,
        nz * s * 2.4 * side + fz * back + rnd(-1, 1),
        rnd(0.45, 1.15), rnd(0.16, 0.42), 0.86, 0.94, 1.0);
      if (i % 3 === 0) {
        this.drops.emit(
          x, y + 0.1, z,
          nx * s * 3.4 * side + fx * back * 1.3, up * 1.3, nz * s * 3.4 * side + fz * back * 1.3,
          rnd(0.5, 1.2), rnd(0.07, 0.17), 1, 1, 1);
      }
    }
  }

  /** The wake: foam left on the water behind the board. */
  wake(x, y, z, fx, fz, speed, dt) {
    this.wakeT += dt;
    const gap = 0.045;
    while (this.wakeT > gap) {
      this.wakeT -= gap;
      if (speed < 1.5) break;
      this.foam.emit(
        x - fx * 0.7 + rnd(-0.35, 0.35), y, z - fz * 0.7 + rnd(-0.35, 0.35),
        rnd(-0.5, 0.5), 0, rnd(-0.5, 0.5),
        rnd(1.4, 3.0), rnd(0.28, 0.60), 1, 1, 1);
    }
  }

  /**
   * The lip throwing out along the breaking line. This is the barrel: water
   * pitched forward off the crest, falling under gravity into the trough.
   * Emitted in world space along the break so it reads from any camera angle.
   */
  lip(breakX, crestZfn, lipYfn, camX, dt, intensity) {
    this.lipT += dt;
    const gap = 0.0028;
    while (this.lipT > gap) {
      this.lipT -= gap;
      // Bias the throw toward the section near the camera; the rest of the point
      // break is far away and would only cost fill rate.
      const x = camX + rnd(-26, 40);
      const lag = breakX - x;
      if (lag < -14 || lag > 34) continue;
      const z = crestZfn(x);
      const y = lipYfn(x);
      const power = Math.exp(-(((lag - 6) / 15) ** 2)) * intensity;
      if (power < 0.08) continue;

      // Thrown forward (shoreward, -z) and up, the way a lip actually pitches.
      this.mist.emit(
        x + rnd(-1.2, 1.2), y + rnd(-0.4, 0.5), z + rnd(-0.8, 0.8),
        rnd(-1.2, 1.2), rnd(0.4, 3.4) * power, -rnd(1.5, 5.5) * power,
        rnd(0.7, 1.7), rnd(0.22, 0.62), 0.9, 0.96, 1.0);
      if (Math.random() < 0.45) {
        this.drops.emit(
          x + rnd(-1.4, 1.4), y + rnd(0, 0.7), z + rnd(-0.6, 0.6),
          rnd(-1.6, 1.6), rnd(1.5, 5.0) * power, -rnd(3.0, 8.0) * power,
          rnd(0.9, 1.8), rnd(0.09, 0.21), 1, 1, 1);
      }
    }
  }

  /** Whitewater: churning foam sitting on the broken part of the wave. */
  whitewater(breakX, crestZfn, camX, dt, rate) {
    let n = rate * dt;
    let k = n | 0;
    if (Math.random() < n - k) k++;
    for (let i = 0; i < k; i++) {
      const x = camX + rnd(-70, 25);
      if (x > breakX - 1) continue;
      const z = crestZfn(x) + rnd(-13, 3);
      this.foam.emit(x, 0, z, rnd(-0.7, 0.7), 0, rnd(-2.4, -0.4),
                     rnd(2.5, 6.0), rnd(0.42, 0.95), 1, 1, 1);
      if (Math.random() < 0.30) {
        this.mist.emit(x, rnd(0.2, 1.6), z, rnd(-1, 1), rnd(0.5, 2.4), rnd(-2, 0),
                       rnd(1.0, 2.4), rnd(0.30, 0.70), 0.88, 0.93, 0.97);
      }
    }
  }

  /** A single impact — landing, a wipeout, or a drop rejoining the sea. */
  splash(x, y, z, power) {
    const n = Math.min(190, 14 + power * 11) | 0;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rnd(0.4, 1) * (2 + power * 0.55);
      this.drops.emit(x, y + 0.1, z,
        Math.cos(a) * s, rnd(2.5, 9) * (0.5 + power * 0.09), Math.sin(a) * s,
        rnd(0.5, 1.4), rnd(0.07, 0.20), 1, 1, 1);
      if (i % 2 === 0) {
        this.mist.emit(x, y + rnd(0, 0.5), z,
          Math.cos(a) * s * 0.7, rnd(1, 4), Math.sin(a) * s * 0.7,
          rnd(0.8, 1.9), rnd(0.48, 1.10), 0.9, 0.95, 1);
      }
      if (i % 4 === 0) {
        this.foam.emit(x + Math.cos(a) * rnd(0, 2), y, z + Math.sin(a) * rnd(0, 2),
          Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6, rnd(2, 4.5), rnd(0.38, 0.78), 1, 1, 1);
      }
    }
  }

  /** The barrel spitting — a blast of mist fired out of the tube. */
  spit(x, y, z, power) {
    for (let i = 0; i < 90; i++) {
      this.mist.emit(
        x + rnd(-1.5, 1.5), y + rnd(-0.5, 1.2), z + rnd(-1, 1),
        rnd(4, 15) * power, rnd(-0.5, 3), rnd(-3, 3),
        rnd(0.9, 2.2), rnd(0.75, 1.75), 0.92, 0.97, 1);
    }
  }

  update(dt, heightAt, windX, windZ) {
    const splash = (x, y, z, vy) => {
      if (Math.abs(vy) < 3) return;
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        this.mist.emit(x, y + 0.05, z, Math.cos(a) * 0.8, rnd(0.6, 2.0), Math.sin(a) * 0.8,
                       rnd(0.4, 0.9), rnd(0.20, 0.45), 0.9, 0.95, 1);
      }
    };
    this.drops.update(dt, heightAt, windX, windZ, splash);
    this.mist.update(dt, heightAt, windX * 1.8, windZ * 1.8, null);
    this.foam.update(dt, heightAt, 0, 0, null);
  }
}
