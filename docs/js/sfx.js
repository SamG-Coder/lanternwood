// Lanternwood sound: small synthesized effects (Web Audio, no files) for work, finds, level-ups,
// mended obstacles and menu moves. Starts on the first key, click or tap (browsers require one),
// and follows the Sound settings (saved on this device).
"use strict";
(function () {
const $ = id => document.getElementById(id);
const PREF = "lanternwood.sound";
let ac = null, master = null, noiseBuf = null;
let pref = { on: true, vol: 60 };
try { const p = JSON.parse(localStorage.getItem(PREF) || "null"); if (p && typeof p === "object") pref = { on: p.on !== false, vol: Math.max(0, Math.min(100, +p.vol || 0)) }; } catch (e) { /* defaults */ }

function start() {
  if (ac) { if (ac.state === "suspended") ac.resume().catch(() => {}); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try { ac = new AC(); } catch (e) { return; }
  master = ac.createGain(); master.connect(ac.destination); applyPref();
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 1.0, ac.sampleRate);   // long enough for any burst from any start
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
["pointerdown", "keydown", "touchend"].forEach(t => addEventListener(t, start, { capture: true, passive: true }));
UI.sfxStart = start;
function applyPref() { if (master) master.gain.value = pref.on ? Math.pow(pref.vol / 100, 1.6) * 0.8 : 0; }
const ready = () => ac && ac.state === "running" && pref.on && pref.vol > 0;

// ---- building blocks
function tone(freq, t0, dur, { type = "triangle", vol = 0.25, to = 0, attack = 0.005 } = {}) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
}
function noise(t0, dur, { freq = 1000, q = 1, type = "bandpass", vol = 0.3 } = {}) {
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t0, Math.random() * 0.3); s.stop(t0 + dur + 0.02);
}
const N = n => 440 * Math.pow(2, (n - 69) / 12);   // midi note -> Hz

const SOUNDS = {
  chop(t) { noise(t, 0.09, { freq: 700 + Math.random() * 200, q: 2, vol: 0.5 }); tone(120, t, 0.12, { type: "sine", vol: 0.35, to: 70 }); },
  mine(t) { tone(2300 + Math.random() * 300, t, 0.16, { type: "square", vol: 0.05 }); noise(t, 0.06, { freq: 3200, q: 3, vol: 0.35 }); tone(180, t, 0.1, { type: "sine", vol: 0.25, to: 90 }); },
  gather(t) { noise(t, 0.14, { freq: 4500, type: "highpass", vol: 0.12 }); },
  craft(t) { tone(N(76 + Math.floor(Math.random() * 3) * 2), t, 0.08, { type: "square", vol: 0.04 }); noise(t, 0.05, { freq: 2000, q: 4, vol: 0.12 }); },
  item(t) { tone(N(81), t, 0.09, { vol: 0.14 }); tone(N(88), t + 0.06, 0.14, { vol: 0.12 }); },
  level(t) { [72, 76, 79, 84].forEach((n, i) => tone(N(n), t + i * 0.09, 0.5, { vol: 0.16 })); tone(N(60), t, 0.9, { type: "sine", vol: 0.12 }); },
  curio(t) { [84, 88, 91, 96, 100].forEach((n, i) => tone(N(n), t + i * 0.07, 0.35, { type: "sine", vol: 0.1 })); },
  repaired(t) { noise(t, 0.35, { freq: 220, q: 0.7, vol: 0.6 }); tone(70, t, 0.4, { type: "sine", vol: 0.5, to: 40 });
    [[60, 64, 67], [65, 69, 72], [67, 71, 74, 79]].forEach((ch, i) => ch.forEach(n => tone(N(n), t + 0.3 + i * 0.32, 0.9, { vol: 0.07, attack: 0.04 }))); },
  end(t) { [[60, 64, 67, 72], [65, 69, 72, 77], [67, 71, 74, 79], [72, 76, 79, 84]].forEach((ch, i) => ch.forEach(n => tone(N(n), t + i * 0.55, 1.6, { vol: 0.06, attack: 0.08 }))); },
  delivered(t) { tone(N(88), t, 0.12, { type: "sine", vol: 0.14 }); tone(N(93), t + 0.08, 0.3, { type: "sine", vol: 0.14 }); },
  drink(t) { for (let i = 0; i < 4; i++) tone(300 + Math.random() * 200, t + i * 0.07, 0.07, { type: "sine", vol: 0.12, to: 700 }); },
  error(t) { tone(150, t, 0.12, { type: "square", vol: 0.05 }); },
  nav(t) { tone(1500, t, 0.025, { type: "sine", vol: 0.05 }); },
  select(t) { tone(900, t, 0.05, { type: "triangle", vol: 0.1 }); tone(1350, t + 0.03, 0.06, { type: "triangle", vol: 0.08 }); },
  back(t) { tone(700, t, 0.06, { type: "triangle", vol: 0.08, to: 450 }); },
  jump(t) { tone(260, t, 0.1, { type: "sine", vol: 0.05, to: 420 }); },
};
let lastPlay = {};
UI.sfx = name => {
  if (!ready() || !SOUNDS[name]) return;
  const now = ac.currentTime;
  if (lastPlay[name] && now - lastPlay[name] < 0.03) return;   // one at a time when many arrive together
  lastPlay[name] = now;
  try { SOUNDS[name](now + 0.005); } catch (e) { /* never break the game for a sound */ }
};

// ---- what the game does -> what you hear
function hook() {
  if (!window.Game) return setTimeout(hook, 200);
  Game.on(evs => {
    let item = false;
    for (const e of evs) {
      if (e.t === "hit") UI.sfx(e.kind === "chop" ? "chop" : e.kind === "mine" ? "mine" : e.kind === "craft" ? "craft" : "gather");
      else if (e.t === "item") item = true;
      else if (e.t === "level") UI.sfx("level");
      else if (e.t === "curio") UI.sfx("curio");
      else if (e.t === "repaired") UI.sfx(e.end ? "end" : "repaired");
      else if (e.t === "delivered") UI.sfx("delivered");
      else if (e.t === "used") UI.sfx("drink");
      else if (e.t === "error") UI.sfx("error");
    }
    if (item && !evs.some(e => e.t === "level" || e.t === "curio" || e.t === "repaired")) UI.sfx("item");
  });
}
hook();

// ---- settings
const on = $("sfx"), vol = $("vol");
if (on) { on.checked = pref.on; on.addEventListener("change", () => { pref.on = on.checked; save(); }); }
if (vol) { vol.value = pref.vol; if (vol._paint) vol._paint(); vol.addEventListener("input", () => { pref.vol = +vol.value; save(); }); vol.addEventListener("change", () => UI.sfx("select")); }
function save() { applyPref(); try { localStorage.setItem(PREF, JSON.stringify(pref)); } catch (e) { /* private mode */ } }
})();
