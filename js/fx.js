// 効果音（WebAudio で合成。音源ファイル不要）・振動・画面スリープ防止・紙吹雪
let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('ekzm-muted') === '1'; } catch { /* noop */ }

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** iOS はユーザー操作中に一度鳴らさないと音が出ないため、最初のタップで解放する */
export function unlockAudio() {
  const c = ac();
  if (!c) return;
  const b = c.createBuffer(1, 1, 22050);
  const s = c.createBufferSource();
  s.buffer = b; s.connect(master); s.start(0);
}
['pointerdown', 'touchend', 'keydown'].forEach(ev => window.addEventListener(ev, unlockAudio, { passive: true }));

export function isMuted() { return muted; }
export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem('ekzm-muted', muted ? '1' : '0'); } catch { /* noop */ }
}

function tone(freq, dur = 0.12, { type = 'square', vol = 0.25, at = 0, slide = 0 } = {}) {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur = 0.3, { vol = 0.3, at = 0, from = 4000, to = 300, q = 0.8, type = 'bandpass' } = {}) {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime + at;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}

export const sfx = {
  tick: () => tone(880, 0.09, { type: 'square', vol: 0.18 }),
  go: () => { tone(523, 0.1, { vol: 0.2 }); tone(784, 0.1, { vol: 0.2, at: 0.08 }); tone(1046, 0.28, { vol: 0.24, at: 0.16 }); },
  stop: () => { tone(1200, 0.06, { type: 'triangle', vol: 0.3 }); tone(1800, 0.25, { type: 'sine', vol: 0.22, at: 0.05 }); },
  tap: () => tone(1400 + Math.random() * 300, 0.035, { type: 'square', vol: 0.08 }),
  choose: () => tone(660, 0.08, { type: 'triangle', vol: 0.25 }),
  correct: () => { tone(784, 0.12, { type: 'triangle', vol: 0.3 }); tone(1175, 0.3, { type: 'triangle', vol: 0.3, at: 0.1 }); },
  wrong: () => { tone(220, 0.35, { type: 'sawtooth', vol: 0.18, slide: 0.6 }); },
  kamae: () => { tone(98, 1.2, { type: 'sine', vol: 0.25 }); noise(1.0, { vol: 0.05, from: 300, to: 200, type: 'lowpass' }); },
  slash: () => { noise(0.28, { vol: 0.55, from: 9000, to: 600, q: 0.6 }); tone(70, 0.4, { type: 'sine', vol: 0.5, slide: 0.5, at: 0.02 }); },
  kire: () => { tone(1568, 0.08, { type: 'square', vol: 0.18 }); tone(2093, 0.18, { type: 'square', vol: 0.18, at: 0.06 }); },
  foul: () => { tone(160, 0.5, { type: 'sawtooth', vol: 0.25, slide: 0.5 }); },
  drum: (sec = 2) => { for (let i = 0; i < sec * 16; i++) noise(0.05, { vol: 0.08 + (i / (sec * 16)) * 0.12, at: i / 16, from: 900, to: 300, type: 'lowpass' }); },
  reveal: () => { tone(988, 0.1, { type: 'triangle', vol: 0.25 }); tone(1319, 0.22, { type: 'triangle', vol: 0.25, at: 0.08 }); },
  fanfare: () => {
    const n = [523, 659, 784, 1046, 784, 1046, 1318];
    n.forEach((f, i) => tone(f, i === n.length - 1 ? 0.6 : 0.14, { type: 'square', vol: 0.2, at: i * 0.13 }));
    noise(0.8, { vol: 0.15, at: 0.9, from: 6000, to: 2000 });
  },
};

export function vibrate(p) { try { navigator.vibrate?.(p); } catch { /* noop */ } }

// 画面スリープ防止（対応ブラウザのみ）
let wakeLock = null;
export async function keepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* noop */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && keepAwakeWanted) keepAwake(); });
let keepAwakeWanted = false;
export function wantAwake() { keepAwakeWanted = true; keepAwake(); }

export function flash(color = '#fff', ms = 260) {
  const el = document.createElement('div');
  el.className = 'fx-flash';
  el.style.background = color;
  el.style.animationDuration = ms + 'ms';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms + 50);
}

export function confetti(duration = 3500, colors = ['#ff4d6d', '#ffc531', '#2ee6a6', '#47a3ff', '#b97cff', '#ffffff']) {
  const cv = document.createElement('canvas');
  cv.className = 'fx-confetti';
  document.body.appendChild(cv);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = (cv.width = innerWidth * dpr), H = (cv.height = innerHeight * dpr);
  const g = cv.getContext('2d');
  const ps = Array.from({ length: 160 }, () => ({
    x: Math.random() * W, y: -Math.random() * H * 0.6, w: (6 + Math.random() * 8) * dpr, h: (8 + Math.random() * 10) * dpr,
    vx: (Math.random() - 0.5) * 3 * dpr, vy: (2 + Math.random() * 4) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  (function loop(t) {
    g.clearRect(0, 0, W, H);
    for (const p of ps) {
      p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vy += 0.03 * dpr;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
    }
    if (t - t0 < duration) requestAnimationFrame(loop); else cv.remove();
  })(t0);
}
