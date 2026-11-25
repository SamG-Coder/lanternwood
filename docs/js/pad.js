// Lanternwood controller support and console-style menus.
//
// Every menu (title, character creator, journal, settings) is navigated the way console games do
// it: one focused element at a time with a clear gold ring, moved by the D-pad or left stick (or
// the arrow keys) to the nearest element in that direction. A selects, B goes back, LB / RB switch
// tabs, LT / RT switch professions, the right stick scrolls, Start opens the menu. A legend bar at
// the bottom says what each button does in the current menu, and every prompt in the game shows
// the glyph of the device in use (Xbox letters, PlayStation shapes, or keyboard keys).
//
// In play: left stick moves (full tilt or RT runs), A jumps, X gathers, RB picks the next target,
// Y opens the journal, View the character page, Start the settings.
"use strict";
(function () {
const $ = id => document.getElementById(id);
const root = document.documentElement;
const UI = window.UI;

// ---------------------------------------------------------------- device + glyphs
let padKind = "xbox";
UI.device = UI.mobile ? "touch" : "kb";
const XB = { a: ["A", "#62b25a"], b: ["B", "#d9584f"], x: ["X", "#4d8fd8"], y: ["Y", "#e3b43c"], lb: ["LB"], rb: ["RB"], lt: ["LT"], rt: ["RT"],
             start: ["☰"], view: ["⧉"], ls: ["L"], rs: ["R"], dpad: ["✚"] };
const PS = { a: ["✕", "#86a9e6"], b: ["○", "#e6837b"], x: ["□", "#d895c9"], y: ["△", "#5fc6a4"], lb: ["L1"], rb: ["R1"], lt: ["L2"], rt: ["R2"],
             start: ["☰"], view: ["⧉"], ls: ["L"], rs: ["R"], dpad: ["✚"] };
UI.btn = b => {
  const g = (padKind === "ps" ? PS : XB)[b] || [b];
  return g[1] ? `<span class="gp face" style="--gc:${g[1]}">${g[0]}</span>` : `<span class="gp ${b === "ls" || b === "rs" ? "stick" : "bump"}">${g[0]}</span>`;
};
const KEYS = { interact: "E", next: "Tab", jump: "Space", journal: "I", menu: "H" };
const PADB = { interact: "x", next: "rb", jump: "a", journal: "y", menu: "start" };
UI.glyph = action => UI.device === "pad" ? UI.btn(PADB[action]) : `<kbd>${KEYS[action]}</kbd>`;

function setDevice(d) {
  if (UI.device === d) return;
  if (UI.device === "pad") Object.assign(UI.input, { ax: 0, ad: 0, jump: false, run: false });   // let go of what the pad held
  UI.device = d;
  syncDeviceClass();
  renderHints();
}
function syncDeviceClass() {
  for (const d of ["pad", "kb", "touch"]) root.classList.toggle("input-" + d, UI.device === d);
}
syncDeviceClass();

// ---------------------------------------------------------------- styles + legend bar
const css = `
:root { --lg: 0px; }
.legend-on { --lg: 46px; }
.gp { display: inline-grid; place-items: center; min-width: 21px; height: 21px; padding: 0 5px; border-radius: 999px; flex: none;
  font: 800 11px/1 var(--sans); letter-spacing: 0; color: #121318; background: var(--gc, #d8d2c4);
  box-shadow: inset 0 -2px 0 rgba(0,0,0,.28), 0 1px 2px rgba(0,0,0,.4); vertical-align: middle; }
.gp.bump { border-radius: 6px; background: rgba(241,234,216,.88); font-size: 10px; min-width: 26px; }
.gp.stick { background: rgba(241,234,216,.88); box-shadow: inset 0 0 0 2px rgba(0,0,0,.25); }
.nav-on .pad-focus { outline: 2px solid var(--gold) !important; outline-offset: 2px;
  box-shadow: 0 0 0 5px rgba(217,181,106,.2), 0 0 22px rgba(217,181,106,.35) !important; position: relative; z-index: 1; }
.nav-on .row.pad-focus { background: rgba(217,181,106,.1); border-radius: 8px; outline-offset: 3px; }
.nav-on .cell.pad-focus, .nav-on .slot.pad-focus { background: rgba(217,181,106,.16); }
.nav-on .pad-focus.pressed { transform: scale(.95); }
.nav-on *:focus:not(.pad-focus) { outline: none; }
#pad-legend { position: fixed; z-index: 40; left: 50%; bottom: calc(8px + var(--sa-b)); transform: translateX(-50%); display: none; gap: 18px;
  align-items: center; padding: 6px 16px; border-radius: 999px; background: rgba(10,11,15,.86); border: 1px solid var(--line);
  font: 600 12px var(--sans); color: var(--ink-2); white-space: nowrap; box-shadow: 0 4px 18px rgba(0,0,0,.4); }
.legend-on #pad-legend { display: flex; }
#pad-legend span { display: inline-flex; align-items: center; gap: 6px; }
#pad-legend span .gp + .gp { margin-left: -2px; }
.legend-on #sheet { bottom: calc(var(--pad) + var(--sa-b) + var(--lg)); }
.creating #hints, .journal-open #hints, .sheet-open #hints { opacity: 0 !important; }
/* a controller on a phone or tablet: the on-screen controls step aside */
.input-pad #touch-buttons, .input-pad .stick-ghost { display: none !important; }
.is-mobile.input-pad #hints { display: flex; }
.pad-group { display: none; } .input-pad .pad-group { display: block; } .input-pad .keys-group { display: none; }
`;
document.head.appendChild(Object.assign(document.createElement("style"), { textContent: css }));
const legend = document.createElement("div"); legend.id = "pad-legend"; legend.setAttribute("aria-hidden", "true");
document.body.appendChild(legend);

// the controller page in the settings, beside the keyboard one
const keysGroup = document.querySelector(".keys-group");
if (keysGroup) {
  const g = document.createElement("section"); g.className = "group pad-group";
  keysGroup.after(g);
}
function renderPadGroup() {
  const g = document.querySelector(".pad-group"); if (!g) return;
  const r = (b, t) => `<span>${b.map(UI.btn).join(" ")}</span><span>${t}</span>`;
  g.innerHTML = `<h3>Controller</h3><div class="keys-list">
    ${r(["ls"], "Move (full tilt runs)")}${r(["a"], "Jump")}${r(["rt"], "Run")}${r(["x"], "Gather")}${r(["rb"], "Next thing in reach")}
    ${r(["y"], "Journal: the road")}${r(["view"], "Character")}${r(["start"], "Settings")}
    ${r(["dpad"], "Move between options")}${r(["b"], "Back")}${r(["lb", "rb"], "Journal tabs")}${r(["rs"], "Scroll")}</div>`;
}

// the gameplay hints and the title line follow the device
let lastLegend = "";
const hintsEl = $("hints"), kbHints = hintsEl ? hintsEl.innerHTML : "";
const titleHint = document.querySelector(".t-hint .desk"), titleHintKb = titleHint ? titleHint.innerHTML : "";
function renderHints() {
  const pad = UI.device === "pad";
  if (hintsEl) hintsEl.innerHTML = pad
    ? [["ls", "Move"], ["a", "Jump"], ["rt", "Run"], ["x", "Gather"], ["y", "Journal"], ["start", "Menu"]].map(([b, t]) => `<div class="hint">${UI.btn(b)} ${t}</div>`).join("")
    : kbHints;
  if (titleHint) titleHint.innerHTML = pad ? `or press ${UI.btn("a")}` : titleHintKb;
  renderPadGroup();
  lastLegend = "";
}
renderHints();
// the title's "press" line shows for a controller on touch devices too
document.head.appendChild(Object.assign(document.createElement("style"), { textContent: ".is-mobile.input-pad .t-hint .desk { display: inline; } .is-mobile.input-pad .t-hint .mob { display: none; }" }));

// ---------------------------------------------------------------- menu layers
function layer() {
  if (root.classList.contains("is-mobile") && root.classList.contains("is-portrait")) return null;
  if (root.classList.contains("creating")) return { name: "creator", el: $("creator") };
  if (root.classList.contains("sheet-open")) return { name: "sheet", el: $("sheet") };
  if (root.classList.contains("journal-open")) return { name: "journal", el: $("journal") };
  if (!UI.started && root.classList.contains("is-loaded") && !root.classList.contains("has-error")) return { name: "title", el: $("title") };
  return null;
}
const SEL = "button, a[href], input:not([type=hidden]), .cell, .slot:not(.empty), [data-nav]";
function focusables(L) {
  return [...L.el.querySelectorAll(SEL)].filter(e => {
    const r = ringOf(e).getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(e);
    return cs.visibility !== "hidden" && cs.display !== "none";
  });
}
// what carries the ring: a slider or switch rings its whole row (label and all)
const ringOf = e => (e.type === "range" || e.type === "checkbox") && e.closest(".row") || e;
const ident = e => e.id ? "#" + e.id : e.tagName + JSON.stringify(e.dataset) + e.className.replace(/\b(pad-focus|pressed|sel|on)\b/g, "").trim();
function initial(L, list) {
  const pick = sel => list.find(e => e.matches(sel));
  if (L.name === "title") return pick("#begin") || list[0];
  if (L.name === "creator") return list.find(e => e.closest(".cr-rows")) || list[0];
  if (L.name === "journal" && window.RPGUI && RPGUI.journalTab() === "craft")
    return list.find(e => e.matches("[data-craft]:not([disabled])")) || list.find(e => e.matches("[data-craft]")) || list[0];
  if (L.name === "journal") return list.find(e => e.closest(".j-body") && e.matches(".cell.sel, .on")) || list.find(e => e.closest(".j-body")) || list[0];
  if (L.name === "sheet") return list.find(e => e.closest(".sheet-body")) || list[0];
  return list[0];
}

let cur = null, curId = "", curRect = null, lastLayer = "", navOn = false;
function setNav(on) {
  if (navOn === on) return;
  navOn = on;
  root.classList.toggle("nav-on", on);
  if (on && !cur) { const L = layer(); if (L) focus(initial(L, focusables(L))); }
}
function clearRings() { document.querySelectorAll(".pad-focus").forEach(n => n.classList.remove("pad-focus", "pressed")); }
function focus(e) {
  clearRings();
  cur = e || null;
  if (!cur) return;
  const ring = ringOf(cur);
  ring.classList.add("pad-focus");
  curId = ident(cur); curRect = ring.getBoundingClientRect();
  // real focus too (screen readers, Enter), but never on a text box: that would pop up a phone keyboard
  if (!(cur.tagName === "INPUT" && cur.type === "text")) {
    if (!cur.matches("button, a, input")) cur.tabIndex = -1;
    try { cur.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
  }
  // a text box (no real focus, so no phone keyboard) or a disabled button can't take focus: let go of
  // the old one, or the arrows would adopt it and pull the cursor back
  if (document.activeElement && document.activeElement !== cur && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
  ring.scrollIntoView({ block: "nearest", inline: "nearest" });
  // the bag shows whatever the cursor is on, like a console inventory
  // (an empty slot clears the details once; nothing re-renders when there is nothing to change)
  if (cur.matches(".cell") && !cur.classList.contains("sel") && (cur.firstChild || (cur.parentNode && cur.parentNode.querySelector(".cell.sel")))) cur.click();
}
// the nearest element in a direction, the way console menus move: edges first, staying in line
function move(dx, dy) {
  const L = layer(); if (!L) return;
  const list = focusables(L);
  if (!cur || !list.includes(cur)) { focus(initial(L, list)); return; }
  const a = ringOf(cur).getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  const PART = ".j-head, .j-body, .sheet-head, .sheet-body, .cr-prev, .cr-main";
  const part = cur.closest(PART);
  let best = null, bs = Infinity;
  for (const pass of dx && part ? [true, false] : [false]) {
  if (best) break;
  for (const e of list) {
    if (e === cur || ringOf(e) === ringOf(cur)) continue;
    if (pass && e.closest(PART) !== part) continue;
    const b = ringOf(e).getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
    let gap, centre, off, overlap;
    if (dx) {
      if ((bx - ax) * dx <= 1) continue;
      gap = dx > 0 ? b.left - a.right : a.left - b.right; centre = Math.abs(bx - ax);
      overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); off = Math.abs(by - ay);
      if (overlap <= 0) continue;   // left / right stay on the row, as console menus do
    } else {
      if ((by - ay) * dy <= 1) continue;
      gap = dy > 0 ? b.top - a.bottom : a.top - b.bottom; centre = Math.abs(by - ay);
      overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left); off = Math.abs(bx - ax);
    }
    const s = Math.max(gap, 0) + 0.15 * centre + (overlap > 0 ? 0.1 * off : 2.5 * off + 40);
    if (s < bs) { bs = s; best = e; }
  }
  }
  if (best) focus(best);
}
function adjust(e, dir) {          // a slider: left / right change it in twentieths
  const min = +e.min || 0, max = +e.max || 100, step = Math.max(+e.step || 1, Math.round((max - min) / 20));
  e.value = Math.max(min, Math.min(max, +e.value + dir * step));
  e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true }));
}
function adoptFocused(L) {
  const a = document.activeElement;
  if (cur && cur.tagName === "INPUT" && cur.type === "text" && a !== cur) return false;
  if (!a || a === cur || a === document.body || !L.el.contains(a) || !a.matches(SEL)) return false;
  if (a.tagName === "INPUT" && a.type === "text") return false;
  focus(a); setNav(true);
  return true;
}
function direction(dx, dy) {
  const L = layer();
  if (L) adoptFocused(L);
  // the first press only shows where the ring is
  if (!navOn || !cur) { setNav(true); if (!cur) { const L = layer(); if (L) focus(initial(L, focusables(L))); } return; }
  if (dx && cur.type === "range") { adjust(cur, dx); return; }
  const was = cur;
  move(dx, dy);
  if (cur !== was && UI.sfx) UI.sfx("nav");
}
function activate() {
  if (!cur) return;
  const ring = ringOf(cur);
  ring.classList.add("pressed"); setTimeout(() => ring.classList.remove("pressed"), 120);
  if (UI.sfx && !(cur.disabled)) UI.sfx("select");
  if (cur.type === "range") return;
  if (cur.tagName === "INPUT" && cur.type === "text") { cur.focus(); cur.select(); return; }
  if (cur.matches(".cell")) {        // an item: A goes to what you can do with it
    if (!cur.classList.contains("sel")) cur.click();
    const L = layer(), act = L && L.el.querySelector("[data-do]");
    if (act) focus(act);
    return;
  }
  cur.click();
}
function back(L) {
  if (UI.sfx && L.name !== "creator") UI.sfx("back");
  if (L.name === "sheet") UI.toggleSheet(false);
  else if (L.name === "journal" && cur && cur.matches("[data-do]") && L.el.querySelector(".cell.sel")) focus(L.el.querySelector(".cell.sel"));   // back to the bag
  else if (L.name === "journal" && window.RPGUI) RPGUI.closeJournal();
}
function cycleTabs(L, sel, d) {
  const tabs = [...L.el.querySelectorAll(sel)];
  if (tabs.length < 2) return;
  const i = Math.max(0, tabs.findIndex(t => t.classList.contains("on") || (t.classList.contains("btn") && !t.classList.contains("ghost"))));
  tabs[(i + d + tabs.length) % tabs.length].click();
  clearRings(); cur = null; pendingInit = sel;
}
let pendingInit = "";

// keep the ring when a menu redraws itself (the journal re-renders on every change)
function keepFocus(L) {
  if (cur && cur.isConnected && L.el.contains(cur)) { curRect = ringOf(cur).getBoundingClientRect(); return; }
  const list = focusables(L);
  if (!list.length) { cur = null; return; }
  let e = null;
  if (pendingInit) { e = initial(L, list); pendingInit = ""; }
  if (!e && cur) e = list.find(x => ident(x) === curId);
  if (!e && curRect) {
    const cx = curRect.left + curRect.width / 2, cy = curRect.top + curRect.height / 2;
    let bd = Infinity;
    for (const x of list) { const r = ringOf(x).getBoundingClientRect(), d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy); if (d < bd) { bd = d; e = x; } }
  }
  cur = null;
  focus(e || initial(L, list));
}

// ---------------------------------------------------------------- legend
function renderLegend(L) {
  const show = !!L && UI.device === "pad";
  const tab = L && L.name === "journal" && window.RPGUI ? RPGUI.journalTab() : "";
  const key = show ? L.name + "|" + tab + "|" + padKind : "";
  if (key === lastLegend) return;
  lastLegend = key;
  root.classList.toggle("legend-on", show);
  if (!show) { legend.innerHTML = ""; return; }
  const parts = [];
  const add = (bs, t) => parts.push(`<span>${bs.map(UI.btn).join("")} ${t}</span>`);
  if (L.name === "title") add(["a"], "Begin");
  else {
    add(["a"], "Select");
    if (L.name === "creator") { add(["x"], "Surprise me"); add(["start"], "Begin journey"); }
    if (L.name === "journal") { add(["b"], "Close"); add(["lb", "rb"], "Tabs"); if (tab === "craft") add(["lt", "rt"], "Profession"); add(["rs"], "Scroll"); }
    if (L.name === "sheet") { add(["dpad"], "Adjust"); add(["b"], "Close"); add(["rs"], "Scroll"); }
  }
  legend.innerHTML = parts.join("");
}

// ---------------------------------------------------------------- keyboard in menus (arrows, Enter)
addEventListener("keydown", e => {
  setDevice("kb");
  const L = layer();
  if (!L || L.name === "title" || e.ctrlKey || e.metaKey || e.altKey) return;
  const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const typing = e.target.tagName === "INPUT" && e.target.type === "text";
  if (e.key === "Tab") { clearRings(); cur = null; setNav(false); return; }
  if (dirs[e.key]) {
    if (typing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;   // moving the text cursor
    e.preventDefault(); e.stopPropagation();
    if (typing) e.target.blur();
    direction(...dirs[e.key]);
  } else if (e.key === "Enter" && navOn && cur && !typing && !cur.matches("button, a")) {
    e.preventDefault(); activate();   // buttons and links answer Enter themselves
  }
}, true);
addEventListener("pointerdown", e => { setNav(false); setDevice(e.pointerType === "touch" ? "touch" : UI.mobile ? "touch" : "kb"); }, true);

// ---------------------------------------------------------------- the controller
const prev = new Array(17).fill(false), eaten = new Set();
let navDir = "", navNext = 0, runLatch = false, lastT = performance.now();
const dz = v => Math.abs(v) < 0.18 ? 0 : Math.sign(v) * Math.min(1, (Math.abs(v) - 0.18) / 0.82);
function pads() { try { return [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean); } catch (e) { return []; } }
function loop(now) { requestAnimationFrame(loop); try { tick(now); } catch (e) { console.error(e); } }
function tick(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  const L = layer();
  // menus open and close: the ring starts on the menu's first item
  const lname = L ? L.name : "";
  if (lname !== lastLayer) {
    lastLayer = lname;
    clearRings();
    cur = null; curRect = null;
    if (L && navOn) focus(initial(L, focusables(L)));
    if (!L && UI.started) { const c = $("c"); if (c) c.focus({ preventScroll: true }); }
  } else if (L && navOn) keepFocus(L);
  renderLegend(L);

  const gp = pads()[0];
  if (!gp) {
    if (UI.device === "pad") { Object.assign(UI.input, { ax: 0, ad: 0, jump: false, run: false }); prev.fill(false); runLatch = false; }
    return;
  }
  const kind = !/xbox|xinput|045e/i.test(gp.id) && /054c|dualsense|dualshock|playstation/i.test(gp.id) ? "ps" : "xbox";
  if (kind !== padKind) { padKind = kind; renderHints(); }
  const B = i => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
  const val = i => gp.buttons[i] ? gp.buttons[i].value : 0;
  const ax = i => gp.axes[i] || 0;
  const down = [], held = [];
  for (let i = 0; i < 17; i++) { const b = B(i); held[i] = b; down[i] = b && !prev[i]; prev[i] = b; if (!b) eaten.delete(i); }
  const lx = dz(ax(0)), ly = dz(ax(1)), ry = dz(ax(3));
  const any = held.some(Boolean) || Math.abs(lx) > 0.3 || Math.abs(ly) > 0.3 || Math.abs(ry) > 0.3;
  if (any) setDevice("pad");
  if (down.some(Boolean) && UI.sfxStart) UI.sfxStart();   // sound for players who only ever use the controller
  if (UI.device !== "pad") return;

  if (L) {
    // ---- menus
    const wasNav = navOn;
    if (any && !wasNav) adoptFocused(L);
    if (any) setNav(true);
    const eat = i => eaten.add(i);
    if (L.name === "title") {
      if ([0, 1, 2, 3, 9].some(i => down[i])) { [0, 1, 2, 3, 9].forEach(eat); UI.begin(); }
      return;
    }
    let dir = "";
    if (held[12]) dir = "u"; else if (held[13]) dir = "d"; else if (held[14]) dir = "l"; else if (held[15]) dir = "r";
    else if (Math.max(Math.abs(lx), Math.abs(ly)) > 0.55) dir = Math.abs(lx) > Math.abs(ly) ? (lx > 0 ? "r" : "l") : (ly > 0 ? "d" : "u");
    if (dir && !wasNav) { navDir = dir; navNext = now + 340; }
    else if (dir && (dir !== navDir || now >= navNext)) {
      navNext = now + (dir !== navDir ? 340 : 110);
      direction(dir === "l" ? -1 : dir === "r" ? 1 : 0, dir === "u" ? -1 : dir === "d" ? 1 : 0);
    }
    navDir = dir;
    if (down[0]) { eat(0); activate(); }
    if (down[1]) { eat(1); back(L); }
    if (L.name === "creator") {
      if (down[2]) { eat(2); const r = $("cr-rand"); if (r) r.click(); }
      if (down[9]) { eat(9); const s = $("cr-start"); if (s) s.click(); }
    }
    if (L.name === "journal") {
      if (down[4] || down[5]) cycleTabs(L, ".j-tab", down[5] ? 1 : -1);
      if ((down[6] || down[7]) && RPGUI.journalTab() === "craft") cycleTabs(L, "[data-p]", down[7] ? 1 : -1);
      if (down[3] || down[8]) { eat(3); eat(8); RPGUI.closeJournal(); }
      if (down[9]) { eat(9); RPGUI.closeJournal(); UI.toggleSheet(true); }
    }
    if (L.name === "sheet" && down[9]) { eat(9); UI.toggleSheet(false); }
    // right stick scrolls the panel under the ring
    if (ry) {
      const box = (cur && cur.closest(".j-body, .sheet-body, .cr-rows, .cr")) || L.el.querySelector(".j-body, .sheet-body, .cr-rows, .cr");
      if (box) box.scrollTop += ry * dt * 700;
    }
    return;
  }

  // ---- play
  navDir = "";
  if (!UI.started || !window.Game || !Game.hasCharacter()) return;
  const dx = held[14] ? -1 : held[15] ? 1 : lx, dy = held[12] ? -1 : held[13] ? 1 : ly;
  if (down[10]) runLatch = !runLatch;
  if (!dx && !dy) runLatch = false;
  UI.input.ax = dx;
  UI.input.ad = -dy;
  UI.input.jump = held[0] && !eaten.has(0);
  UI.input.run = runLatch || val(7) > 0.3 || val(6) > 0.3 || Math.hypot(lx, ly) > 0.94;
  if (down[2]) Game.interact();
  if (down[5]) Game.nextTarget();
  if (down[3] && window.RPGUI) { eaten.add(3); setNav(true); RPGUI.openJournal("road"); }
  if (down[8] && window.RPGUI) { eaten.add(8); setNav(true); RPGUI.openJournal("char"); }
  if (down[9]) { eaten.add(9); setNav(true); UI.toggleSheet(true); }
}
requestAnimationFrame(loop);
addEventListener("gamepaddisconnected", () => { if (UI.device === "pad") Object.assign(UI.input, { ax: 0, ad: 0, jump: false, run: false }); });
addEventListener("gamepadconnected", e => {
  if (window.RPGUI && UI.started) RPGUI.toast(`<span>${e.gamepad.id.replace(/\(.*\)/, "").trim().slice(0, 40) || "Controller"} connected</span>`);
});
UI.nav = { layer, focused: () => cur, move: direction, activate, tick: () => tick(performance.now()), set: e => { setNav(true); focus(e); } };   // for tests
})();
