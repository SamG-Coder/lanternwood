// Lanternwood interface: title card, HUD, settings sheet, keyboard + touch input, fullscreen and
// landscape handling. The renderer (game.js) reads UI.input and calls UI.setRegion / UI.setClock.
"use strict";
(function () {
const $ = id => document.getElementById(id);
const root = document.documentElement;
const mobile = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window || navigator.maxTouchPoints > 1;
root.classList.add(mobile ? "is-mobile" : "is-desktop");

const UI = window.UI = {
  mobile,
  started: false,
  input: { ax: 0, ad: 0, jump: false, run: false },
  quality: mobile ? "balanced" : "high",
  hooks: {},                 // set by the game: getTime, setTime, getFlow, setFlow, setQuality
  bind(h) { Object.assign(this.hooks, h); },
};

// ---------------------------------------------------------------- loading + title
UI.setStage = t => { if (!root.classList.contains("has-error")) $("load-text").textContent = t; };
// anything that goes wrong before or during play is shown, never a silent hang
addEventListener("error", e => { if (!root.classList.contains("is-loaded")) UI.error(e.message || String(e.error)); });
addEventListener("unhandledrejection", e => { if (!root.classList.contains("is-loaded")) UI.error(String(e.reason && e.reason.message || e.reason)); });
UI.setProgress = f => { $("load-bar").style.transform = `scaleX(${Math.max(0, Math.min(1, f))})`; };
UI.error = msg => {
  if (root.classList.contains("is-loaded")) {           // after loading: bring the loader back to show it
    root.classList.remove("is-loaded"); $("loader").style.display = "";
  } $("load-text").textContent = "Something went wrong"; $("load-err").textContent = msg; root.classList.add("has-error"); };
UI.ready = () => {
  root.classList.add("is-loaded");
  setTimeout(() => { if (root.classList.contains("is-loaded")) $("loader").style.display = "none"; }, 900);
  $("begin").focus({ preventScroll: true });
};
function begin() {
  if (UI.started) return;
  UI.started = true;
  root.classList.add("is-playing");
  if (mobile) goFullscreen();
  showHints();
  // greet with the region the walk starts in
  setTimeout(() => UI.setRegion($("region-name").textContent, $("region-sub").textContent), 700);
  $("c").focus({ preventScroll: true });
}
$("begin").addEventListener("click", begin);
UI.begin = begin;

// ---------------------------------------------------------------- HUD
let regionTimer = 0;
UI.setRegion = (name, sub) => {
  $("region-name").textContent = name;
  $("region-sub").textContent = sub;
  // a larger card fades in on entering a region, then settles into the corner chip
  const card = $("region-card");
  card.querySelector(".rc-name").textContent = name;
  card.querySelector(".rc-sub").textContent = sub;
  if (!UI.started) return;
  card.classList.add("show");
  clearTimeout(regionTimer);
  regionTimer = setTimeout(() => card.classList.remove("show"), 3200);
};
const sunIcon = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><g stroke-linecap="round"><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/></g></svg>';
const moonIcon = '<svg viewBox="0 0 24 24"><path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z"/></svg>';
let lastClock = "";
UI.setClock = (t, flow) => {
  const h = Math.floor(t), m = Math.floor((t - h) * 60);
  const night = t < 5.5 || t > 19.5;
  const part = t < 5 ? "Night" : t < 8 ? "Dawn" : t < 11.5 ? "Morning" : t < 14 ? "Midday" : t < 17.5 ? "Afternoon" : t < 20 ? "Dusk" : "Night";
  const s = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}|${part}|${night}|${flow}`;
  if (s === lastClock) return;
  lastClock = s;
  $("clock-time").textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  $("clock-part").textContent = part;
  $("clock-icon").innerHTML = night ? moonIcon : sunIcon;
  $("btn-time").classList.toggle("paused", !flow);
  $("btn-time").title = flow ? "Pause time (T)" : "Resume time (T)";
  if (!draggingTod) $("tod").value = Math.round(t * 60);
  $("tod-out").textContent = $("clock-time").textContent;
};

// ---------------------------------------------------------------- settings sheet
const sheet = $("sheet");
function toggleSheet(open) {
  const o = open === undefined ? !root.classList.contains("sheet-open") : open;
  root.classList.toggle("sheet-open", o);
  sheet.setAttribute("aria-hidden", String(!o));
}
UI.toggleSheet = toggleSheet;
$("btn-settings").addEventListener("click", () => toggleSheet());
$("sheet-close").addEventListener("click", () => toggleSheet(false));
$("scrim").addEventListener("click", () => toggleSheet(false));
let draggingTod = false;
$("tod").addEventListener("input", e => { draggingTod = true; UI.hooks.setTime && UI.hooks.setTime(+e.target.value / 60); });
$("tod").addEventListener("change", () => { draggingTod = false; });
$("btn-time").addEventListener("click", () => UI.hooks.setFlow && UI.hooks.setFlow(!UI.hooks.getFlow()));
// segmented controls write into the hidden inputs the renderer reads
document.querySelectorAll(".seg").forEach(seg => {
  const target = $(seg.dataset.for);
  const sync = () => seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === target.value));
  seg.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    target.value = b.dataset.v; sync();
    target.dispatchEvent(new Event("change"));
  });
  sync();
});
$("quality").value = UI.quality;
document.querySelectorAll('.seg[data-for="quality"] button').forEach(b => b.classList.toggle("on", b.dataset.v === UI.quality));
$("quality").addEventListener("change", e => { UI.quality = e.target.value; UI.hooks.setQuality && UI.hooks.setQuality(UI.quality); });
// slider fill
document.querySelectorAll('input[type=range]').forEach(r => {
  const paint = () => r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min) * 100) + "%");
  r.addEventListener("input", paint); paint();
  const obs = new MutationObserver(paint); obs.observe(r, { attributes: true, attributeFilter: ["value"] });
  r._paint = paint;
});
setInterval(() => $("tod")._paint && $("tod")._paint(), 500);

// ---------------------------------------------------------------- hints
let hintTimer = 0;
function showHints() {
  root.classList.add("hints");
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => root.classList.remove("hints"), mobile ? 6000 : 9000);
}
$("btn-help") && $("btn-help").addEventListener("click", showHints);
UI.showHints = showHints;

// ---------------------------------------------------------------- fullscreen + orientation
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
async function goFullscreen() {
  try {
    if (!fsEl()) {
      const req = root.requestFullscreen || root.webkitRequestFullscreen;
      if (req) await req.call(root, { navigationUI: "hide" });
    }
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock("landscape").catch(() => {});
  } catch (e) { /* iOS Safari: no element fullscreen; the rotate prompt covers it */ }
}
function toggleFullscreen() {
  if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else goFullscreen();
}
$("btn-fs").addEventListener("click", toggleFullscreen);
$("rotate-go").addEventListener("click", () => { goFullscreen(); begin(); });
const onFs = () => root.classList.toggle("is-fullscreen", !!fsEl());
document.addEventListener("fullscreenchange", onFs); document.addEventListener("webkitfullscreenchange", onFs);
const fsSupported = !!(root.requestFullscreen || root.webkitRequestFullscreen);
if (!fsSupported) root.classList.add("no-fullscreen");
function orient() { root.classList.toggle("is-portrait", innerHeight > innerWidth * 1.05); }
addEventListener("resize", orient); orient();

// ---------------------------------------------------------------- keyboard
const keys = new Set();
const K = (...k) => k.some(x => keys.has(x));
function keyInput() {
  if (!UI.started) return;
  if (touchActive) return;
  UI.input.ax = (K("d", "arrowright") ? 1 : 0) - (K("a", "arrowleft") ? 1 : 0);
  UI.input.ad = (K("w", "arrowup") ? 1 : 0) - (K("s", "arrowdown") ? 1 : 0);
  UI.input.jump = K(" ");
  UI.input.run = K("shift");
}
addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT" && e.target.type === "text") return;   // typing a name
  if (root.classList.contains("creating")) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;   // browser shortcuts (Ctrl+F, Ctrl+C...) stay the browser's
  const k = e.key.toLowerCase();
  if (e.target.tagName === "INPUT" && e.target.type === "range" && k.startsWith("arrow")) return;
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
  if (!UI.started && !e.repeat && !root.classList.contains("sheet-open") && root.classList.contains("is-loaded")) { begin(); return; }
  if (e.repeat && !["arrowup", "arrowdown", "arrowleft", "arrowright", "a", "d", "w", "s"].includes(k)) return;
  keys.add(k);
  if (k === "h" || k === "escape") toggleSheet(k === "escape" ? false : undefined);
  if (k === "t" && UI.hooks.setFlow) UI.hooks.setFlow(!UI.hooks.getFlow());
  if (k === "f") toggleFullscreen();
  if (k === "?" || k === "/") showHints();
  if (k === "[" && UI.hooks.setTime) UI.hooks.setTime((UI.hooks.getTime() + 23) % 24);
  if (k === "]" && UI.hooks.setTime) UI.hooks.setTime((UI.hooks.getTime() + 1) % 24);
  keyInput();
});
addEventListener("keyup", e => { keys.delete(e.key.toLowerCase()); keyInput(); });
addEventListener("blur", () => { keys.clear(); keyInput(); });

// ---------------------------------------------------------------- touch: floating stick + buttons
let touchActive = false;
const stick = { id: null, x0: 0, y0: 0 };
const zone = $("touch-zone"), base = $("stick"), knob = $("stick-knob");
const R = () => base.offsetWidth * 0.5;
zone.addEventListener("pointerdown", e => {
  if (e.pointerType === "mouse" || stick.id !== null) return;
  stick.id = e.pointerId; stick.x0 = e.clientX; stick.y0 = e.clientY;
  try { zone.setPointerCapture(e.pointerId); } catch (err) { /* some browsers refuse capture; the stick still works */ }
  base.style.left = e.clientX + "px"; base.style.top = e.clientY + "px";
  base.classList.add("on"); moveStick(e);
  touchActive = true;
  if (!UI.started) begin();
});
zone.addEventListener("pointermove", e => { if (e.pointerId === stick.id) moveStick(e); });
const endStick = e => {
  if (e.pointerId !== stick.id) return;
  stick.id = null; base.classList.remove("on");
  knob.style.transform = "translate(-50%, -50%)";
  UI.input.ax = 0; UI.input.ad = 0; UI.input.run = runLatched;
};
zone.addEventListener("pointerup", endStick); zone.addEventListener("pointercancel", endStick);
function moveStick(e) {
  const r = R();
  let dx = e.clientX - stick.x0, dy = e.clientY - stick.y0;
  const d = Math.hypot(dx, dy);
  if (d > r) { dx *= r / d; dy *= r / d; }
  knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  const nx = dx / r, ny = dy / r, dead = 0.22;
  UI.input.ax = Math.abs(nx) < dead ? 0 : Math.sign(nx) * Math.min(1, (Math.abs(nx) - dead) / (1 - dead) * 1.15);
  UI.input.ad = Math.abs(ny) < dead ? 0 : -Math.sign(ny) * Math.min(1, (Math.abs(ny) - dead) / (1 - dead) * 1.15);
  UI.input.run = runLatched || Math.hypot(nx, ny) > 0.96;
}
let runLatched = false;
const jumpBtn = $("t-jump"), runBtn = $("t-run");
jumpBtn.addEventListener("pointerdown", e => { e.preventDefault(); touchActive = true; UI.input.jump = true; jumpBtn.classList.add("down"); if (!UI.started) begin(); });
const jumpUp = () => { UI.input.jump = false; jumpBtn.classList.remove("down"); };
jumpBtn.addEventListener("pointerup", jumpUp); jumpBtn.addEventListener("pointercancel", jumpUp); jumpBtn.addEventListener("pointerleave", jumpUp);
runBtn.addEventListener("pointerdown", e => {
  e.preventDefault(); touchActive = true;
  runLatched = !runLatched; UI.input.run = runLatched; runBtn.classList.toggle("on", runLatched);
});
// a keyboard press hands control back to the keyboard
addEventListener("keydown", () => { touchActive = false; }, true);
// no browser gestures over the game
["gesturestart", "dblclick"].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
// no page scrolling or rubber-banding over the game; panels that scroll keep their own touch scrolling
document.addEventListener("touchmove", e => { if (!e.target.closest(".sheet-body, .j-body, .cr, [data-scroll]")) e.preventDefault(); }, { passive: false });
})();
