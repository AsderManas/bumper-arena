// Tiny synthesized sound effects — no audio files needed.

let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('ba-muted') === '1'; } catch {}

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.6;
  try { localStorage.setItem('ba-muted', muted ? '1' : '0'); } catch {}
  return muted;
}

export const isMuted = () => muted;

function tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, vol, freq) {
  if (!ctx) return;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start();
}

export const sfx = {
  hit(strength, near) {
    const v = Math.min(1, strength / 22) * (near ? 1 : 0.35);
    noise(0.15, 0.6 * v, 700);
    tone(160, 0.14, 'square', 0.12 * v, 70);
  },
  dash() { tone(220, 0.2, 'sawtooth', 0.07, 880); },
  fall() { tone(500, 0.6, 'triangle', 0.06, 80); },
  ko() { tone(440, 0.8, 'sawtooth', 0.12, 50); },
  beep() { tone(660, 0.12, 'square', 0.09); },
  go() { tone(990, 0.35, 'square', 0.1); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, null, i * 0.11)); },
  end() { tone(392, 0.3, 'triangle', 0.1); tone(330, 0.4, 'triangle', 0.1, null, 0.15); },
  pickup() { [660, 880, 1175].forEach((f, i) => tone(f, 0.12, 'square', 0.07, null, i * 0.05)); },
  shock() { noise(0.5, 0.7, 180); tone(120, 0.5, 'sine', 0.3, 35); },
  bump() { tone(320, 0.18, 'sine', 0.15, 720); },
  join() { tone(880, 0.1, 'sine', 0.08); tone(1320, 0.12, 'sine', 0.08, null, 0.08); },
};
