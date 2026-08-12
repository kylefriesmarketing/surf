// SURF — audio. All WebAudio synthesis, no files.
//
// The ocean is filtered noise shaped by the sim: the roar gets louder and brighter
// the closer the whitewater is, the rail hiss is driven by the same grip-overflow
// number that spawns the spray, and going inside the tube slams a lowpass across
// everything, because that is what a barrel sounds like from the inside.

let ac = null, master = null;
let nodes = {};
let ready = false;

function noiseBuffer(seconds = 3) {
  const n = ac.sampleRate * seconds;
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    // Brown-ish noise: integrated white, which sits much lower than raw white
    // and reads as water rather than as static.
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.2;
  }
  return buf;
}

function loopNoise(gain, filterType, freq, q = 0.7) {
  const src = ac.createBufferSource();
  src.buffer = nodes.noise;
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = filterType; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(nodes.bus);
  src.start();
  return { src, f, g };
}

export function init() {
  if (ac) return true;
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
  } catch { return false; }
  master = ac.createGain();
  master.gain.value = 0.85;

  // One lowpass that everything passes through — this is the "inside the tube"
  // and "underwater after a wipeout" effect, and it costs one node.
  nodes.tube = ac.createBiquadFilter();
  nodes.tube.type = 'lowpass';
  nodes.tube.frequency.value = 20000;
  nodes.tube.Q.value = 0.9;

  nodes.bus = ac.createGain();
  nodes.bus.gain.value = 1;
  nodes.bus.connect(nodes.tube);
  nodes.tube.connect(master);
  master.connect(ac.destination);

  nodes.noise = noiseBuffer(4);
  nodes.swell = loopNoise(0.10, 'lowpass', 340, 0.6);   // the ocean, always there
  nodes.roar = loopNoise(0.0, 'bandpass', 700, 0.55);   // the breaking section
  nodes.hiss = loopNoise(0.0, 'highpass', 2100, 0.7);   // rail spray
  nodes.wind = loopNoise(0.0, 'bandpass', 1250, 1.1);   // speed
  ready = true;
  return true;
}

export function resume() { if (ac && ac.state === 'suspended') ac.resume(); }
export function isReady() { return ready; }
export function setMuted(m) { if (master) master.gain.value = m ? 0 : 0.85; }

const at = (p, v, tc = 0.08) => { if (p) p.setTargetAtTime(v, ac.currentTime, tc); };

/**
 * Continuous state, driven straight off the rider each frame.
 * @param s {foam, slide, speed, barrel, down}
 */
export function frame(s) {
  if (!ready) return;
  at(nodes.roar.g.gain, 0.02 + s.foam * 0.42, 0.10);
  at(nodes.roar.f.frequency, 420 + s.foam * 900, 0.15);
  at(nodes.hiss.g.gain, Math.min(0.16, s.slide * 0.010), 0.05);
  at(nodes.wind.g.gain, Math.min(0.075, Math.max(0, s.speed - 5) * 0.0075), 0.12);
  at(nodes.wind.f.frequency, 700 + s.speed * 90, 0.15);
  // Inside the tube the world goes muffled and close.
  const cut = s.down ? 500 : s.barrel > 0.5 ? 700 : 20000;
  at(nodes.tube.frequency, cut, 0.12);
  at(nodes.swell.g.gain, s.barrel > 0.5 ? 0.30 : 0.10, 0.2);
}

/** One-shots. */
export function hit(kind, power = 1) {
  if (!ready) return;
  const t = ac.currentTime;
  if (kind === 'splash' || kind === 'land') {
    const src = ac.createBufferSource();
    src.buffer = nodes.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const f = ac.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 900 + power * 260; f.Q.value = 0.6;
    const g = ac.createGain();
    g.gain.setValueAtTime(Math.min(0.55, 0.12 + power * 0.07), t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.55);
    src.connect(f); f.connect(g); g.connect(nodes.bus);
    src.start(t, Math.random() * 2); src.stop(t + 0.6);
  } else if (kind === 'pump') {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(72, t + 0.16);
    g.gain.setValueAtTime(0.10 * power, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.20);
    o.connect(g); g.connect(nodes.bus); o.start(t); o.stop(t + 0.22);
  } else if (kind === 'spit') {
    const src = ac.createBufferSource();
    src.buffer = nodes.noise; src.playbackRate.value = 1.5;
    const f = ac.createBiquadFilter();
    f.type = 'highpass'; f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.5);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.34, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.7);
    src.connect(f); f.connect(g); g.connect(nodes.bus);
    src.start(t, Math.random() * 2); src.stop(t + 0.75);
  } else if (kind === 'score') {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(520, t);
    o.frequency.setValueAtTime(780, t + 0.09);
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.30);
    o.connect(g); g.connect(nodes.bus); o.start(t); o.stop(t + 0.32);
  }
}
