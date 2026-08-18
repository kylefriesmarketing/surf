// SURF — the view.
//
// The ocean mesh is displaced ON THE CPU by wave.height(), the exact function the
// board rides. That costs ~15k height samples a frame, and it is worth every one:
// there is no second copy of the wave in GLSL that can silently drift out of sync
// with the physics. What you see is the surface you are riding, not a lookalike.
//
// The grid is built in WAVE-ALIGNED coordinates — each column's z samples are
// centred on crestZ(x) — so the sheet hugs the crest line all the way along the
// point instead of sliding off it. Spacing is non-uniform: dense across the face
// where you actually are, stretched out toward the horizon.

import * as THREE from 'three';
import * as W from './wave.js';
import { WAVE } from './wave.js';

// The sun sits SEAWARD (+z), i.e. offshore, BEHIND the wave — and the camera sits
// shoreward, in front of it. That is the arrangement every good surf photograph
// uses: the face is turned away from the sun, so it is not lit directly at all,
// it is lit THROUGH, and a couple of metres of backlit seawater glows.
//
// The two obvious alternatives were both tried and both are worse. Sun behind the
// camera: the face is in its own shadow and the wave is a black ridge. Sun on the
// same side as the face: it lights up, but flatly, and the translucency — the
// entire reason a wave looks like a wave — never happens. This only works because
// the ambient floor and the glow term below carry the face on their own.
export const SUN = new THREE.Vector3(-0.30, 0.34, 0.89).normalize();

const PAL = {
  deep:    new THREE.Color(0x062b3b),
  shallow: new THREE.Color(0x287f84),
  glow:    new THREE.Color(0x4fb99e),   // restrained spectral backscatter
  sky:     new THREE.Color(0x81969e),
  horizon: new THREE.Color(0x69787b),
  sunCol:  new THREE.Color(0xffedca),
  foam:    new THREE.Color(0xf0f8fa),
  zenith:  new THREE.Color(0x172630),
  low:     new THREE.Color(0x69787b),
};

// ---------------------------------------------------------------- ocean
const OCEAN_VERT = `
attribute float aFoam;
varying vec3 vW;
varying vec3 vN;
varying float vFoam;
varying float vH;
void main() {
  vW = position;          // the geometry is authored in world space already
  vN = normal;
  vFoam = aFoam;
  vH = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const OCEAN_FRAG = `
uniform vec3 uSun, uSunCol, uDeep, uShallow, uGlow, uSky, uHorizon, uFoam, uCam;
uniform float uTime;
varying vec3 vW;
varying vec3 vN;
varying float vFoam;
varying float vH;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  return 0.55 * vnoise(p) + 0.30 * vnoise(p * 2.3) + 0.15 * vnoise(p * 5.1);
}

void main() {
  vec3 N = normalize(vN);
  // Ripple detail, two scales, drifting shoreward with the wave.
  vec2 rp = vW.xz * 2.4 + vec2(0.0, -uTime * 2.2);
  float e = 0.35;
  vec3 dN = vec3(fbm(rp + vec2(e,0.0)) - fbm(rp - vec2(e,0.0)), 0.0,
                 fbm(rp + vec2(0.0,e)) - fbm(rp - vec2(0.0,e)));
  N = normalize(N + vec3(-dN.x, 0.0, -dN.z) * 0.55);
  vec3 V = normalize(uCam - vW);
  vec3 L = normalize(uSun);

  float lift = clamp(vH / 3.6 * 0.5 + 0.5, 0.0, 1.0);
  vec3 base = mix(uDeep, uShallow, lift);

  // The backlit face. Sun behind the wave + thin standing water + a steep face =
  // that translucent green glow, which is the single most recognisable thing
  // about a photographed wave. Without it the face reads as painted concrete.
  float thin = smoothstep(-0.8, 2.8, vH);
  float back = pow(max(0.0, dot(-V, L)), 2.2);
  float steep = smoothstep(0.03, 0.34, 1.0 - N.y);
  vec3 glow = uGlow * back * thin * steep * 1.25;

  float fres = pow(1.0 - max(0.0, dot(N, V)), 4.0);
  vec3 col = mix(base, uSky, fres * 0.52);

  // Sun + a sky-bounce ambient floor. Without the ambient term the shadowed side
  // of every swell goes to near black, because water this saturated has almost no
  // colour left to lose once diffuse falls off.
  float dif = max(0.0, dot(N, L));
  col = col * (0.54 + 0.48 * dif) + uSky * 0.08;
  col += glow;

  vec3 H = normalize(L + V);
  col += uSunCol * pow(max(0.0, dot(N, H)), 260.0) * 1.35;
  // Fine glitter, so the flat water is not a dead plastic sheet.
  float gl = fbm(vW.xz * 1.7 + uTime * 0.35);
  col += uSunCol * pow(max(0.0, dot(N, H)), 54.0) * gl * 0.18;

  float churn = fbm(vW.xz * 1.15 - uTime * vec2(0.9, 0.35));
  float fm = clamp(vFoam * 1.3 - 0.10, 0.0, 1.0);
  fm *= 0.12 + 0.88 * churn;
  fm = clamp(fm, 0.0, 1.0);
  col = mix(col, uFoam, fm);

  float d = length(uCam - vW);
  col = mix(col, uHorizon, smoothstep(85.0, 205.0, d));
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * Non-uniform sample positions from lo to hi, densest at `centre`.
 *
 * Monotonic by construction and it hits lo, centre and hi exactly. The first
 * version of this blended a uniform sweep with a concentrated one, which was
 * neither: it silently clipped the range to a third of what was asked for AND put
 * the fine sampling 13 m from where it was supposed to be — behind the crest
 * rather than on the face — so the whole wave rendered as a few huge facets.
 * If you touch this, print the resulting gaps across the face before believing it.
 */
function axis(n, lo, hi, centre, tight) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * 2 - 1;                              // -1..1
    const w = Math.sign(u) * Math.pow(Math.abs(u), tight);        // tight>1 ⇒ dense at 0
    out[i] = w < 0 ? centre + w * (centre - lo) : centre + w * (hi - centre);
  }
  return out;
}

export class Ocean {
  constructor(scene, cols = 148, rows = 128) {
    this.cols = cols; this.rows = rows;
    // Columns crowd just ahead of the rider (where you are looking); rows crowd on
    // the FACE, which sits about 5 m shoreward of the crest line.
    this.cx = axis(cols, -95, 185, 12, 1.7);
    this.rz = axis(rows, -34, 115, -5, 2.3);

    const n = cols * rows;
    this.pos = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.foam = new Float32Array(n);

    const idx = [];
    for (let i = 0; i < cols - 1; i++) {
      for (let j = 0; j < rows - 1; j++) {
        const a = i * rows + j, b = a + rows;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    geo.setAttribute('aFoam', new THREE.BufferAttribute(this.foam, 1));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uSun: { value: SUN }, uSunCol: { value: PAL.sunCol },
        uDeep: { value: PAL.deep }, uShallow: { value: PAL.shallow },
        uGlow: { value: PAL.glow }, uSky: { value: PAL.sky },
        uHorizon: { value: PAL.horizon }, uFoam: { value: PAL.foam },
        uCam: { value: new THREE.Vector3() },
        uTime: { value: 0 },
      },
      vertexShader: OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.geo = geo;

    // Everything past the playable band: flat, cheap, purely to fill the horizon.
    // It sits just BELOW the grid and shares the deep-water colour, with scene fog
    // on, so the diagonal edge of the sheared grid dissolves into it instead of
    // drawing a hard seam across the ocean.
    const far = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshBasicMaterial({ color: PAL.deep, fog: true, depthWrite: false }));
    far.rotation.x = -Math.PI / 2;
    far.position.y = -0.05;
    far.renderOrder = -5;
    scene.add(far);
    this.far = far;
  }

  update(t, riderX, cam) {
    const { cols, rows, cx, rz, pos, foam } = this;
    for (let i = 0; i < cols; i++) {
      const x = riderX + cx[i];
      const cz = W.crestZ(x, t);
      const base = i * rows;
      for (let j = 0; j < rows; j++) {
        const z = cz + rz[j];
        const p = (base + j) * 3;
        pos[p] = x;
        pos[p + 1] = W.height(x, z, t);
        pos[p + 2] = z;
        foam[base + j] = W.foamAt(x, z, t);
      }
    }
    this.rebuildNormals();
    this.far.position.x = riderX;
    this.far.position.z = W.crestZ(riderX, t);
    this.mat.uniforms.uCam.value.copy(cam.position);
    this.mat.uniforms.uTime.value = t;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    this.geo.attributes.aFoam.needsUpdate = true;
  }

  /**
   * Normals from grid neighbours rather than four extra height() calls per vertex.
   * The grid is a sheared sheet (columns follow the tilted crest line), so both
   * tangents carry x and z components and the cross product has to be taken in
   * full 3D — treating the columns as axis-aligned lights the wave from the wrong
   * side entirely.
   */
  rebuildNormals() {
    const { cols, rows, pos, nrm } = this;
    for (let i = 0; i < cols; i++) {
      const im = Math.max(0, i - 1), ip = Math.min(cols - 1, i + 1);
      for (let j = 0; j < rows; j++) {
        const jm = Math.max(0, j - 1), jp = Math.min(rows - 1, j + 1);
        const a = (ip * rows + j) * 3, b = (im * rows + j) * 3;
        const c = (i * rows + jp) * 3, d = (i * rows + jm) * 3;
        const t1x = pos[a] - pos[b], t1y = pos[a + 1] - pos[b + 1], t1z = pos[a + 2] - pos[b + 2];
        const t2x = pos[c] - pos[d], t2y = pos[c + 1] - pos[d + 1], t2z = pos[c + 2] - pos[d + 2];
        let nx = t1y * t2z - t1z * t2y;
        let ny = t1z * t2x - t1x * t2z;
        let nz = t1x * t2y - t1y * t2x;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const len = Math.hypot(nx, ny, nz) || 1;
        const o = (i * rows + j) * 3;
        nrm[o] = nx / len; nrm[o + 1] = ny / len; nrm[o + 2] = nz / len;
      }
    }
  }
}

// ---------------------------------------------------------------- the curl
/**
 * The barrel. A heightfield literally cannot overhang, so the lip that pitches out
 * over the face is its own ribbon of geometry: for each station along the break, a
 * cross-section that leaves the crest and arcs forward and down. wave.barrelAt()
 * is the analytic twin of this shape and is what the sim scores against — if you
 * change the arc here, change that too or the tube you can see and the tube you can
 * score will be in different places.
 */
export class Curl {
  constructor(scene, stations = 96, segs = 25) {
    this.S = stations; this.G = segs;
    const n = stations * segs;
    this.pos = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.aF = new Float32Array(n);
    const idx = [];
    for (let i = 0; i < stations - 1; i++) {
      for (let j = 0; j < segs - 1; j++) {
        const a = i * segs + j, b = a + segs;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    geo.setAttribute('aFoam', new THREE.BufferAttribute(this.aF, 1));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uSun: { value: SUN }, uSunCol: { value: PAL.sunCol },
        uDeep: { value: PAL.deep }, uShallow: { value: PAL.shallow },
        uGlow: { value: PAL.glow }, uSky: { value: PAL.sky },
        uHorizon: { value: PAL.horizon }, uFoam: { value: PAL.foam },
        uCam: { value: new THREE.Vector3() },
        uTime: { value: 0 },
      },
      vertexShader: OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.geo = geo;
  }

  update(t, riderX, cam) {
    const { S, G, pos, aF } = this;
    const bx = W.breakX(t);
    for (let i = 0; i < S; i++) {
      // Stations track the rider so the tube is always modelled where you are.
      const x = riderX - 34 + (i / (S - 1)) * 108;
      const lag = bx - x;
      const cz = W.crestZ(x, t);
      const lipY = W.lipHeight(x, t);
      // How far the lip has thrown. This MUST be a short section — a wave pitches
      // over across a few metres, not along the whole point. A generous ramp here
      // builds a continuous 46 m white curtain standing at the crest, which from
      // the rider's own camera fills the entire screen and hides the wave.
      // Centred on the barrel window in wave.barrelAt so the tube you can see and
      // the tube you can score are the same tube.
      const th = Math.exp(-(((lag - 5) / 8.5) ** 2)) > 0.05
        ? Math.exp(-(((lag - 5) / 8.5) ** 2)) : 0;
      const R = 1.55 * th + 0.10;
      const arc = 2.30 * th;
      for (let j = 0; j < G; j++) {
        const s = j / (G - 1);
        const a = s * arc;
        const p = (i * G + j) * 3;
        pos[p] = x + Math.sin(s * 9 + t * 3 + i) * 0.10 * th;
        pos[p + 1] = lipY - R * (1 - Math.cos(a)) - s * 0.10;
        pos[p + 2] = cz - R * Math.sin(a);
        aF[i * G + j] = Math.min(1, Math.pow(s, 8.0) * 0.62 + th * 0.012);
      }
    }
    this.rebuildNormals();
    this.mat.uniforms.uCam.value.copy(cam.position);
    this.mat.uniforms.uTime.value = t;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    this.geo.attributes.aFoam.needsUpdate = true;
  }

  rebuildNormals() {
    const { S, G, pos, nrm } = this;
    for (let i = 0; i < S; i++) {
      const im = Math.max(0, i - 1), ip = Math.min(S - 1, i + 1);
      for (let j = 0; j < G; j++) {
        const jm = Math.max(0, j - 1), jp = Math.min(G - 1, j + 1);
        const a = (ip * G + j) * 3, b = (im * G + j) * 3;
        const c = (i * G + jp) * 3, d = (i * G + jm) * 3;
        const t1x = pos[a] - pos[b], t1y = pos[a + 1] - pos[b + 1], t1z = pos[a + 2] - pos[b + 2];
        const t2x = pos[c] - pos[d], t2y = pos[c + 1] - pos[d + 1], t2z = pos[c + 2] - pos[d + 2];
        let nx = t1y * t2z - t1z * t2y;
        let ny = t1z * t2x - t1x * t2z;
        let nz = t1x * t2y - t1y * t2x;
        const len = Math.hypot(nx, ny, nz) || 1;
        const o = (i * G + j) * 3;
        nrm[o] = nx / len; nrm[o + 1] = ny / len; nrm[o + 2] = nz / len;
      }
    }
  }
}

// ---------------------------------------------------------------- sky
export function createSky(scene) {
  const geo = new THREE.SphereGeometry(2600, 48, 28);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      uZen: { value: PAL.zenith }, uLow: { value: PAL.low },
      uHor: { value: PAL.horizon }, uSun: { value: SUN },
      uSunCol: { value: PAL.sunCol },
    },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uZen, uLow, uHor, uSun, uSunCol;
      varying vec3 vD;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
      }
      float fbm(vec2 p){
        float n=0.0; n+=noise(p)*.52; p=p*2.03+17.2; n+=noise(p)*.27;
        p=p*2.11-9.4; n+=noise(p)*.14; p=p*2.07+4.8; n+=noise(p)*.07; return n;
      }
      void main(){
        vec3 D=normalize(vD);
        float h=clamp(D.y, -0.2, 1.0);
        vec3 col=mix(uHor,uZen,smoothstep(0.02,0.68,h));
        col=mix(uLow,col,smoothstep(-0.08,0.26,h));
        float az=atan(D.z,D.x);
        vec2 cp=vec2(az*1.45,D.y*5.2);
        float broad=fbm(cp*0.72+vec2(1.4,-.6));
        float detail=fbm(cp*2.05+vec2(-3.2,4.1));
        float cloud=smoothstep(.50,.78,broad*.72+detail*.28);
        cloud*=smoothstep(-.03,.16,h)*(1.0-smoothstep(.72,.98,h));
        vec3 cloudDark=vec3(.19,.235,.25), cloudLight=vec3(.54,.57,.56);
        float silver=pow(max(0.0,dot(D,normalize(uSun))),9.0);
        col=mix(col,mix(cloudDark,cloudLight,.25+silver*.75),cloud*.78);
        float haze=exp(-max(0.0,h)*12.0);
        col=mix(col,uHor,haze*.26);
        float s=max(0.0,dot(D,normalize(uSun)));
        col+=uSunCol*pow(s,2200.0)*1.35;
        col+=uSunCol*pow(s,85.0)*.18;
        col+=uSunCol*pow(s,9.0)*.035;
        float grain=(hash(gl_FragCoord.xy)-.5)/255.0;
        gl_FragColor=vec4(col+grain,1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  scene.add(sky);
  return sky;
}

// ---------------------------------------------------------------- the board
function boardGeometry() {
  const LEN = 40, RING = 12;
  const L = 2.30, WD = 0.285, TH = 0.058;
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i < LEN; i++) {
    const s = i / (LEN - 1);
    // Pointed nose, fuller mid, rounded-off tail.
    const shape = Math.pow(Math.sin(Math.PI * Math.min(1, 0.055 + 0.945 * s)), 0.62);
    const w = WD * shape * (0.72 + 0.28 * Math.min(1, s * 2.4));
    const th = TH * Math.pow(shape, 0.55);
    const zc = (s - 0.5) * L;
    // Rocker: both ends lift, the nose much more than the tail.
    const rock = 0.085 * Math.pow(Math.max(0, s - 0.52) / 0.48, 2) +
                 0.028 * Math.pow(Math.max(0, 0.42 - s) / 0.42, 2);
    for (let j = 0; j < RING; j++) {
      const a = (j / RING) * Math.PI * 2;
      const cx = Math.cos(a) * w;
      const cy = Math.sin(a) * th * (Math.sin(a) > 0 ? 1.0 : 0.55) + rock;
      pos.push(cx, cy, zc);
      nrm.push(Math.cos(a), Math.sin(a) * 0.55, 0);
    }
  }
  for (let i = 0; i < LEN - 1; i++) {
    for (let j = 0; j < RING; j++) {
      const j2 = (j + 1) % RING;
      const a = i * RING + j, b = i * RING + j2;
      const c = (i + 1) * RING + j, d = (i + 1) * RING + j2;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const material = (color, roughness = 0.62, metalness = 0.0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

const capsule = (radius, length, mat, x, y, z, rz = 0, rx = 0) => {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 8, 12), mat);
  mesh.position.set(x, y, z); mesh.rotation.z = rz; mesh.rotation.x = rx;
  mesh.castShadow = true; return mesh;
};

/** Procedural articulated surfer: smooth anatomical volumes, full wetsuit, hands and feet. */
export function createRig(scene) {
  const root = new THREE.Group();
  const boardMat = new THREE.MeshPhysicalMaterial({
    color: 0xe4e6e3, roughness: 0.18, metalness: 0.0, clearcoat: 0.85, clearcoatRoughness: 0.16,
  });
  const board = new THREE.Mesh(boardGeometry(), boardMat);
  board.castShadow = true; board.receiveShadow = true; root.add(board);

  const stringer = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.009, 2.07), material(0x746e64, .38));
  stringer.position.y = 0.057; root.add(stringer);
  const traction = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.016, 0.43), material(0x202528, .82));
  traction.position.set(0, .061, -.76); root.add(traction);

  for (const x of [-.11, .11]) {
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 12), material(0x1c272b, .38));
    fin.position.set(x, -0.10, -0.88); fin.rotation.x = Math.PI; root.add(fin);
  }

  const body = new THREE.Group(); body.position.y = 0.06;
  const suit = material(0x0b1114, .48), suitPanel = material(0x202c30, .42);
  const skin = material(0x9d6f58, .76), hair = material(0x161310, .9);

  const torso = capsule(.155, .27, suit, 0, .64, .01, 0, -.05); body.add(torso);
  const chest = capsule(.128, .11, suitPanel, 0, .68, .09, 0, Math.PI / 2); chest.scale.set(1.05,.7,.62); body.add(chest);
  const neck = capsule(.052, .055, skin, 0, .86, .02); body.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.105, 18, 14), skin);
  head.scale.set(.86, 1.08, .92); head.position.set(0,.98,.035); head.castShadow=true; body.add(head);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(.106, 18, 10, 0, Math.PI * 2, 0, Math.PI * .47), hair);
  hairCap.scale.copy(head.scale); hairCap.position.set(0,.996,.028); hairCap.castShadow=true; body.add(hairCap);

  const armL = capsule(.045, .30, suit, -.235, .67, .08, .72, -.12);
  const armR = capsule(.045, .31, suit, .245, .69, -.04, -.86, .10);
  const handL = new THREE.Mesh(new THREE.SphereGeometry(.052,12,9), skin); handL.position.set(-.39,.52,.10);
  const handR = new THREE.Mesh(new THREE.SphereGeometry(.052,12,9), skin); handR.position.set(.40,.49,-.03);
  body.add(armL,armR,handL,handR);

  const legF = capsule(.065, .34, suit, -.02, .29, .31, 0, .48);
  const legB = capsule(.065, .34, suit, .02, .28, -.28, 0, -.40);
  const footF = capsule(.047, .13, suit, -.02, .10, .55, 0, Math.PI / 2);
  const footB = capsule(.047, .13, suit, .02, .10, -.51, 0, Math.PI / 2);
  body.add(legF,legB,footF,footB);

  root.add(body); scene.add(root);
  return {
    root, body, board,
    pose(heading, lean, crouch, pitch, roll) {
      root.rotation.set(0,0,0); root.rotation.y = -heading + Math.PI / 2;
      root.rotateX(pitch); root.rotateZ(roll - lean * .30);
      body.rotation.z = -lean * .46; body.rotation.x = .08 + crouch * .30;
      body.scale.y = 1 - crouch * .20; body.position.y = .06 - crouch * .055;
      armL.rotation.z = .72 + lean * .18; armR.rotation.z = -.86 + lean * .18;
      armL.rotation.x = 0; armR.rotation.x = 0;
      legF.rotation.x = .48 + crouch * .26; legB.rotation.x = -.40 - crouch * .18;
    },
    /** Prone paddling: windmill the arms. Called AFTER pose() during the paddle-in
     *  (pose resets the joints each frame, so this composes on top). */
    paddle(ph) {
      const s = Math.sin(ph * 7);
      armL.rotation.x = s * 1.35; armL.rotation.z = .22;
      armR.rotation.x = -s * 1.35; armR.rotation.z = -.22;
      legF.rotation.x = .08; legB.rotation.x = -.08;
    },
    /** Kit colour, so the rival is tellable from you beyond the dark board. */
    setAccent(hex) { suitPanel.color.setHex(hex); },
  };
}

export function createLights(scene) {
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.5);
  sun.position.copy(SUN).multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 260;
  sun.shadow.camera.left = -32; sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 32; sun.shadow.camera.bottom = -32;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfe0ff, 0x123040, 1.15));
  const rim = new THREE.DirectionalLight(0x9fd4ff, 0.55);
  rim.position.set(40, 26, -90);
  scene.add(rim);
  return sun;
}

export { PAL };
