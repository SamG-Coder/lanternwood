// Lanternwood RPG interface: character creator, journal (character, bag, crafting), the action prompt
// over the node in reach, and XP / item / level notifications. Talks to the game only through
// window.Game (game.js) and renders from the character state; never changes it directly.
"use strict";
(function () {
const $ = id => document.getElementById(id);
const D = window.LWData, S = window.LWState, CH = window.LWCharacter;
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------------------------------------------------------- pixel icons (16 x 16, drawn in code)
const iconCache = {};
function icon(id) {
  if (iconCache[id]) return iconCache[id];
  const def = D.ITEMS[id];
  const [shape, c1, c2] = def ? def.icon : ["rock", "#888", "#555"];
  const c = document.createElement("canvas"); c.width = c.height = 16;
  const g = c.getContext("2d");
  const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
  const rect = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const line = (x0, y0, x1, y1, col, w = 1) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let i = 0; i <= n; i++) rect(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), w, w, col);
  };
  const disc = (cx, cy, r, col) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) px(cx + x, cy + y, col); };
  const dark = "#1a1612";
  switch (shape) {
    case "petals": disc(6, 6, 3, c1); disc(10, 8, 3, c1); disc(6, 10, 2, c1); px(8, 8, dark); line(8, 11, 8, 15, c2); break;
    case "flower": line(8, 8, 8, 15, c2); line(5, 12, 8, 14, c2); for (const [x, y] of [[8, 3], [11, 6], [8, 9], [5, 6]]) disc(x, y, 2, c1); disc(8, 6, 1, "#f0c040"); break;
    case "stalk": for (let k = 0; k < 3; k++) line(5 + k * 3, 15, 7 + k * 2, 2 + k, c2); for (let k = 0; k < 3; k++) line(7 + k * 2, 2 + k, 8 + k * 2, 6 + k, c1, 2); break;
    case "frond": line(4, 15, 11, 1, c2); for (let k = 2; k < 13; k += 2) { line(4 + k * 0.55, 15 - k, 1 + k * 0.4, 13 - k, c1); line(4 + k * 0.55, 15 - k, 9 + k * 0.5, 14 - k * 1.1, c1); } break;
    case "berries": line(3, 3, 9, 6, c2); for (const [x, y] of [[6, 9], [10, 8], [8, 12], [11, 12], [4, 12]]) { disc(x, y, 2, c1); px(x - 1, y - 1, "#8a9ad8"); } break;
    case "sprig": line(8, 15, 8, 3, c2); for (let y = 3; y < 12; y += 2) { px(7, y, c1); px(9, y + 1, c1); px(6, y + 1, c1); px(10, y, c1); } break;
    case "tuft": line(8, 15, 8, 8, c2); disc(8, 6, 4, c1); disc(6, 5, 2, "#ffffff"); break;
    case "sticks": line(2, 12, 14, 6, c1, 2); line(3, 6, 13, 13, c2, 2); line(5, 14, 12, 3, c1); break;
    case "log": rect(2, 6, 12, 6, c2); rect(2, 6, 12, 2, c1); disc(13, 9, 3, "#d8b88a"); disc(13, 9, 1, c2); px(5, 9, dark); px(9, 10, dark); break;
    case "rod": line(3, 13, 13, 2, c2, 2); line(3, 12, 12, 2, c1); break;
    case "rock": disc(8, 9, 5, c2); disc(7, 8, 4, c1); px(6, 6, "#d0d4d8"); px(10, 11, dark); break;
    case "flask": rect(7, 2, 2, 4, "#c8bea8"); rect(6, 1, 4, 1, "#7a5a3a"); disc(8, 10, 4, c2); disc(8, 11, 3, c1); px(6, 9, "#ffffff"); break;
    case "jar": rect(4, 5, 8, 9, c2); rect(5, 7, 6, 6, c1); rect(4, 3, 8, 2, "#7a5a3a"); break;
    case "cord": for (let k = 0; k < 4; k++) { disc(5 + k * 2, 5 + k * 2, 2, k % 2 ? c1 : c2); } line(12, 12, 14, 14, c1); break;
    case "staff": line(4, 15, 12, 1, c1, 2); disc(12, 2, 2, c2); break;
    case "bow": for (let k = 0; k <= 12; k++) { const t = k / 12; px(Math.round(4 + Math.sin(t * Math.PI) * 6), 2 + k, c1); px(Math.round(5 + Math.sin(t * Math.PI) * 6), 2 + k, c1); } line(4, 2, 4, 14, c2); break;
    case "shield": disc(8, 8, 6, c2); disc(8, 8, 5, c1); disc(8, 8, 1, c2); break;
    case "axe": line(4, 15, 11, 3, "#8a6a44", 2); rect(9, 2, 5, 5, c2); px(14, 3, "#e0e4e8"); break;
    case "pick": line(4, 15, 10, 4, "#8a6a44", 2); line(4, 3, 14, 6, c2, 2); break;
    case "hammer": line(4, 15, 10, 5, c1, 2); rect(7, 1, 7, 5, c2); break;
    case "rune": disc(8, 8, 6, c1); line(6, 4, 9, 12, c2); line(9, 4, 6, 8, c2); break;
    case "block": rect(3, 5, 10, 8, c2); rect(3, 5, 10, 2, c1); rect(4, 7, 8, 1, "#e0c090"); break;
    case "wheel": disc(8, 8, 6, c1); disc(8, 8, 2, c2); line(8, 2, 8, 14, c2); break;
    default: disc(8, 8, 5, c1);
  }
  return (iconCache[id] = c.toDataURL());
}
const iconImg = (id, n) => `<span class="ico"><img src="${icon(id)}" alt="">${n > 1 ? `<b>${n}</b>` : ""}</span>`;

// ---------------------------------------------------------------- styles
const css = `
#rpg-prompt { position: fixed; z-index: 4; transform: translate(-50%, -100%); pointer-events: none; text-align: center; white-space: nowrap; display: none; }
#rpg-prompt .pp { display: inline-flex; align-items: center; gap: 7px; padding: 5px 10px 5px 6px; border-radius: 999px; background: rgba(14,15,20,.78);
  border: 1px solid rgba(217,181,106,.55); font: 600 12px var(--sans); color: var(--ink); box-shadow: 0 3px 12px rgba(0,0,0,.35); }
#rpg-prompt.locked .pp { border-color: rgba(220,120,100,.6); color: #e8b0a0; }
#rpg-prompt kbd { min-width: 20px; height: 20px; font-size: 10px; }
#rpg-prompt kbd.tab { opacity: .7; }
.is-mobile #rpg-prompt { pointer-events: auto; }
#rpg-prompt .pbar { width: 100%; height: 3px; margin-top: 4px; background: rgba(241,234,216,.18); border-radius: 2px; overflow: hidden; }
#rpg-prompt .pbar i { display: block; height: 100%; background: var(--gold); width: 0; }
.is-mobile #rpg-prompt kbd { display: none; }
#rpg-feed { position: fixed; z-index: 5; right: calc(var(--pad) + max(var(--sa-r), var(--gx))); top: calc(var(--pad) + 52px + max(var(--sa-t), var(--gy)));
  display: flex; flex-direction: column; align-items: flex-end; gap: 5px; pointer-events: none; }
.feed { display: flex; align-items: center; gap: 6px; padding: 4px 10px 4px 5px; border-radius: 8px; background: rgba(14,15,20,.7); font: 600 12px var(--sans);
  animation: feedIn .25s ease-out, feedOut .6s ease-in 2.6s forwards; }
.feed.err { color: #e8b0a0; padding-left: 10px; }
.feed .xp { font-variant-numeric: tabular-nums; }
@keyframes feedIn { from { opacity: 0; transform: translateX(10px); } }
@keyframes feedOut { to { opacity: 0; transform: translateY(-6px); } }
#rpg-level { position: fixed; z-index: 5; left: 0; right: 0; top: 30%; text-align: center; pointer-events: none; opacity: 0; transition: opacity .6s; }
#rpg-level.show { opacity: 1; }
#rpg-level .ln { font: 600 clamp(20px, 3.4vw, 32px) var(--serif); letter-spacing: .06em; text-shadow: 0 2px 0 rgba(0,0,0,.6), 0 0 24px rgba(0,0,0,.6); }
#rpg-level .ls { font-size: 11px; letter-spacing: .3em; text-transform: uppercase; color: var(--gold); margin-top: 6px; text-shadow: 0 1px 0 #000; }
.ico { position: relative; width: 32px; height: 32px; display: inline-block; flex: none; }
.ico img { width: 32px; height: 32px; image-rendering: pixelated; display: block; }
.ico b { position: absolute; right: -2px; bottom: -3px; font: 700 10px var(--sans); color: var(--ink); text-shadow: 0 1px 0 #000, 0 0 3px #000; }
.feed .ico, .feed .ico img { width: 22px; height: 22px; }
/* journal */
#journal { position: fixed; z-index: 9; left: 50%; top: 50%; transform: translate(-50%, -48%) scale(.98); width: min(760px, calc(100vw - 2 * var(--pad)));
  height: min(520px, calc(100vh - 2 * var(--pad) - var(--sa-t) - var(--sa-b))); display: flex; flex-direction: column; background: var(--glass-2);
  opacity: 0; pointer-events: none; transition: opacity .25s, transform .25s; }
.journal-open #journal { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%); }
.journal-open #scrim { opacity: 1; pointer-events: auto; }
.j-head { display: flex; align-items: center; gap: 6px; padding: 10px 10px 0 14px; border-bottom: 1px solid var(--line); }
.j-tab { border: 0; background: transparent; color: var(--ink-3); padding: 10px 14px; cursor: pointer; font: 600 13px var(--serif); letter-spacing: .04em; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.j-tab.on { color: var(--ink); border-bottom-color: var(--gold); }
.j-head .sp { flex: 1; }
.j-body { flex: 1; overflow: auto; padding: 16px 18px; scrollbar-width: thin; scrollbar-color: rgba(241,234,216,.22) transparent; }
.j-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.is-mobile .j-cols { grid-template-columns: 1fr; }
.j-h { font-size: 10px; letter-spacing: .22em; text-transform: uppercase; color: var(--gold); margin: 0 0 10px; font-weight: 600; }
.who { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
.who .nm { font: 600 22px var(--serif); } .who .tl { color: var(--ink-3); font-size: 12px; letter-spacing: .1em; text-transform: uppercase; }
.skill { display: grid; grid-template-columns: 1fr auto; gap: 3px 10px; margin: 0 0 11px; }
.skill .sn { color: var(--ink-2); } .skill .sl { font: 600 14px var(--serif); font-variant-numeric: tabular-nums; }
.skill .sb { grid-column: 1 / -1; height: 4px; border-radius: 2px; background: rgba(241,234,216,.12); overflow: hidden; }
.skill .sb i { display: block; height: 100%; }
.skill .sx { grid-column: 1 / -1; font-size: 10px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.slots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.slot { display: flex; align-items: center; gap: 8px; padding: 6px; border-radius: 8px; border: 1px solid var(--line); background: rgba(241,234,216,.04); min-height: 48px; cursor: pointer; }
.slot .sk { font-size: 10px; color: var(--ink-3); letter-spacing: .1em; text-transform: uppercase; } .slot .sv { font-size: 12px; }
.slot.empty { cursor: default; opacity: .6; }
.bag { display: grid; grid-template-columns: repeat(7, minmax(0, 58px)); gap: 6px; justify-content: center; }
.cell { aspect-ratio: 1; border-radius: 8px; border: 1px solid var(--line); background: rgba(241,234,216,.04); display: grid; place-items: center; cursor: pointer; }
.cell.sel { border-color: var(--gold); background: rgba(217,181,106,.14); }
.cell:empty { cursor: default; }
.detail { margin-top: 14px; padding: 12px; border-radius: 10px; border: 1px solid var(--line); min-height: 92px; display: flex; gap: 12px; }
.detail .dn { font: 600 15px var(--serif); } .detail .dd { color: var(--ink-2); font-size: 12px; margin: 3px 0 9px; } .detail .dk { color: var(--ink-3); font-size: 10px; letter-spacing: .14em; text-transform: uppercase; }
.btn { border: 1px solid rgba(217,181,106,.55); background: rgba(217,181,106,.14); color: var(--ink); border-radius: 999px; padding: 6px 14px; cursor: pointer; font: 600 12px var(--sans); letter-spacing: .06em; margin-right: 6px; }
.btn:hover { background: rgba(217,181,106,.26); } .btn[disabled] { opacity: .4; cursor: default; } .btn.ghost { border-color: var(--line); background: transparent; }
.prof { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
.recipe { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; padding: 8px; border-radius: 10px; border: 1px solid var(--line); margin-bottom: 8px; }
.recipe.locked { opacity: .5; }
.recipe .rn { font: 600 14px var(--serif); } .recipe .rr { font-size: 11px; color: var(--ink-3); }
.recipe .ins { display: flex; gap: 10px; margin-top: 4px; flex-wrap: wrap; }
.recipe .in { display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--ink-2); } .recipe .in.miss { color: #e8a090; }
.recipe .in .ico, .recipe .in .ico img { width: 20px; height: 20px; }
.recipe .cbar { grid-column: 1 / -1; height: 3px; background: rgba(241,234,216,.12); border-radius: 2px; overflow: hidden; display: none; }
.recipe .cbar i { display: block; height: 100%; background: var(--gold); width: 0; }
.recipe.busy .cbar { display: block; }
#btn-journal .dot { position: absolute; right: 7px; top: 7px; width: 7px; height: 7px; border-radius: 50%; background: var(--gold); display: none; }
#btn-journal.new .dot { display: block; }
/* creator */
#creator { position: fixed; inset: 0; z-index: 25; display: none; place-items: center; padding: 16px; background: radial-gradient(ellipse at center, rgba(7,8,12,.55), rgba(7,8,12,.9)); }
.creating #creator { display: grid; }
.cr { display: grid; grid-template-columns: 260px 340px; gap: 24px; padding: 22px 24px; max-height: calc(100vh - 32px); overflow: auto; background: var(--glass-2); }
.is-mobile .cr { grid-template-columns: 170px 1fr; gap: 14px; padding: 14px; width: min(640px, calc(100vw - 24px)); }
.cr h2 { margin: 0 0 4px; font: 600 22px var(--serif); letter-spacing: .06em; } .cr .sub { color: var(--ink-3); font-size: 12px; margin-bottom: 14px; }
.cr-prev { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; border-radius: 12px;
  background: radial-gradient(ellipse at 50% 85%, rgba(217,181,106,.18), rgba(0,0,0,0) 60%), linear-gradient(180deg, rgba(60,80,60,.25), rgba(20,24,20,.5)); }
.cr-prev canvas { width: 100%; image-rendering: pixelated; }
.cr-anim { display: flex; gap: 4px; padding: 8px; }
.cr-anim button { border: 1px solid var(--line); background: transparent; color: var(--ink-3); border-radius: 999px; padding: 3px 9px; font-size: 11px; cursor: pointer; }
.cr-anim button.on { color: var(--ink); border-color: rgba(217,181,106,.6); }
.cr-name { width: 100%; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--line); background: rgba(241,234,216,.06); color: var(--ink); font: 600 16px var(--serif); margin-bottom: 12px; -webkit-user-select: text; user-select: text; }
.cr-row { display: grid; grid-template-columns: 92px 1fr; align-items: center; gap: 10px; margin: 7px 0; }
.cr-row > span { color: var(--ink-2); font-size: 12px; }
.pick { display: flex; align-items: center; gap: 6px; }
.pick button { width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--line); background: transparent; color: var(--ink); cursor: pointer; font-size: 14px; line-height: 1; }
.pick .pv { flex: 1; text-align: center; font-size: 12px; color: var(--ink); }
.sw { display: flex; gap: 4px; flex-wrap: wrap; }
.sw button { width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; }
.sw button.on { border-color: var(--ink); box-shadow: 0 0 0 2px rgba(217,181,106,.5); }
.sw .off { background: transparent; border: 1px dashed var(--ink-3); color: var(--ink-3); font-size: 10px; width: auto; border-radius: 11px; padding: 0 7px; }
.cr-go { display: flex; gap: 8px; margin-top: 16px; }
.cr-go .btn { padding: 10px 18px; }
/* mobile action button */
#t-act { right: 98px; bottom: 6px; width: 70px; height: 70px; display: none; font-size: 10px; }
.has-target #t-act { display: grid; }
`;
document.head.appendChild(el("style", null, css));

// ---------------------------------------------------------------- DOM
const prompt = el("div", null, ""); prompt.id = "rpg-prompt"; document.body.appendChild(prompt);
const feed = el("div"); feed.id = "rpg-feed"; document.body.appendChild(feed);
const levelBanner = el("div", null, '<div class="ln"></div><div class="ls"></div>'); levelBanner.id = "rpg-level"; document.body.appendChild(levelBanner);
// journal button in the tool row, before settings
const jb = el("button", "icon-btn glass", '<svg viewBox="0 0 24 24"><path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/></svg><span class="dot"></span>');
jb.id = "btn-journal"; jb.title = "Journal (I / K / C)"; jb.setAttribute("aria-label", "Journal"); jb.style.position = "relative";
$("tools").insertBefore(jb, $("btn-settings"));
const journal = el("aside", "glass", `
  <div class="j-head"><button class="j-tab" data-tab="char">Character</button><button class="j-tab" data-tab="bag">Bag</button>
  <button class="j-tab" data-tab="craft">Crafting</button><span class="sp"></span>
  <button class="icon-btn" id="j-close" aria-label="Close journal" style="background:transparent;border:0"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
  <div class="j-body" id="j-body"></div>`);
journal.id = "journal"; document.body.appendChild(journal);
const act = el("button", "tbtn", "Gather"); act.id = "t-act"; act.setAttribute("aria-label", "Gather");
$("touch-buttons").appendChild(act);
const creator = el("div"); creator.id = "creator"; document.body.appendChild(creator);

// ---------------------------------------------------------------- journal
let tab = "char", selSlot = -1, craftSkill = "alchemy";
const root = document.documentElement;
function openJournal(t) {
  if (!window.Game || !Game.hasCharacter()) return;
  if (t) tab = t;
  root.classList.add("journal-open"); jb.classList.remove("new");
  render();
}
function closeJournal() { root.classList.remove("journal-open"); }
const journalOpen = () => root.classList.contains("journal-open");
jb.addEventListener("click", () => journalOpen() ? closeJournal() : openJournal());
$("j-close").addEventListener("click", closeJournal);
$("scrim").addEventListener("click", closeJournal);
journal.querySelector(".j-head").addEventListener("click", e => { const b = e.target.closest(".j-tab"); if (b) { tab = b.dataset.tab; render(); } });

function skillRow(id) {
  const ch = Game.character(), xp = ch.skills[id] || 0, lv = D.levelOf(xp);
  const a = D.xpFor(lv), b = D.xpFor(Math.min(lv + 1, D.MAX_LEVEL));
  const p = lv >= D.MAX_LEVEL ? 1 : (xp - a) / Math.max(1, b - a);
  return `<div class="skill"><span class="sn">${D.SKILLS[id].name}</span><span class="sl">${lv}</span>
    <span class="sb"><i style="width:${(p * 100).toFixed(1)}%;background:${D.SKILLS[id].color}"></i></span>
    <span class="sx">${lv >= D.MAX_LEVEL ? "Mastered" : `${xp.toLocaleString()} / ${b.toLocaleString()} xp`}</span></div>`;
}
function slotHtml(key, label, id) {
  return `<div class="slot ${id ? "" : "empty"}" data-unequip="${id ? key : ""}">${id ? iconImg(id) : '<span class="ico"></span>'}
    <div><div class="sk">${label}</div><div class="sv">${id ? esc(D.ITEMS[id].name) : "Empty"}</div></div></div>`;
}
function render() {
  if (!journalOpen()) return;
  journal.querySelectorAll(".j-tab").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  const ch = Game.character(), body = $("j-body");
  if (tab === "char") {
    const groups = { gathering: "Gathering", crafting: "Crafting", body: "Body" };
    body.innerHTML = `<div class="who"><span class="nm">${esc(ch.name)}</span><span class="tl">Total level ${S.totalLevel(ch)}</span></div>
      <div class="j-cols"><div>${Object.entries(groups).map(([k, g]) => `<div class="j-h">${g}</div>` +
        Object.keys(D.SKILLS).filter(id => D.SKILLS[id].kind === k).map(skillRow).join("")).join("")}</div>
      <div><div class="j-h">Equipped</div><div class="slots">
        ${slotHtml("main", "Main hand", ch.equip.main)}${slotHtml("off", "Off hand", ch.equip.off)}${slotHtml("trinket", "Trinket", ch.equip.trinket)}
        ${slotHtml("tool:forestry", "Hatchet", ch.tools.forestry)}${slotHtml("tool:stonecutting", "Pick", ch.tools.stonecutting)}${slotHtml("tool:herbalism", "Sickle", ch.tools.herbalism)}
      </div><div class="j-h" style="margin-top:16px">Journey</div>
      <div class="rr" style="color:var(--ink-2);font-size:12px;line-height:1.8">Gathered ${ch.stats.gathered} times · crafted ${ch.stats.crafted} things<br>
      Walked ${(ch.stats.metres / 1000).toFixed(2)} km · jumped ${ch.stats.jumps} times<br>Worn tools gather at normal speed; crafted ones are faster.</div></div></div>`;
    body.querySelectorAll("[data-unequip]").forEach(n => n.addEventListener("click", () => { if (n.dataset.unequip) Game.dispatch({ t: "unequip", slot: n.dataset.unequip }); }));
  } else if (tab === "bag") {
    const it = ch.inv[selSlot];
    body.innerHTML = `<div class="bag">${ch.inv.map((x, i) => `<div class="cell ${i === selSlot ? "sel" : ""}" data-i="${i}">${x ? iconImg(x.id, x.n) : ""}</div>`).join("")}</div>
      <div class="detail">${it ? `${iconImg(it.id)}<div><div class="dn">${esc(D.ITEMS[it.id].name)}${it.n > 1 ? ` × ${it.n}` : ""}</div>
        <div class="dk">${D.ITEMS[it.id].kind}</div><div class="dd">${esc(D.ITEMS[it.id].desc)}</div>
        ${D.ITEMS[it.id].kind === "potion" ? '<button class="btn" data-do="use">Use</button>' : ""}
        ${D.ITEMS[it.id].slot || D.ITEMS[it.id].tool ? '<button class="btn" data-do="equip">Equip</button>' : ""}
        <button class="btn ghost" data-do="drop">Drop</button></div>` : '<div class="dd" style="align-self:center">Select an item to see what it is.</div>'}</div>`;
    body.querySelectorAll(".cell").forEach(c => c.addEventListener("click", () => { selSlot = ch.inv[+c.dataset.i] ? +c.dataset.i : -1; render(); }));
    body.querySelectorAll("[data-do]").forEach(b => b.addEventListener("click", () => { Game.dispatch({ t: b.dataset.do, slot: selSlot }); if (!ch.inv[selSlot]) selSlot = -1; }));
  } else {
    const profs = ["alchemy", "woodworking", "masonry"];
    const busy = Game.action();
    body.innerHTML = `<div class="prof">${profs.map(p => `<button class="btn ${p === craftSkill ? "" : "ghost"}" data-p="${p}">${D.SKILLS[p].name} · ${S.level(ch, p)}</button>`).join("")}</div>` +
      D.RECIPES.filter(r => r.skill === craftSkill).map(r => {
        const can = S.canCraft(ch, r), locked = S.level(ch, r.skill) < r.req;
        return `<div class="recipe ${locked ? "locked" : ""} ${busy && busy.id === r.id ? "busy" : ""}" data-r="${r.id}">${iconImg(r.id)}
          <div><div class="rn">${esc(D.ITEMS[r.id].name)}</div><div class="rr">${D.SKILLS[r.skill].name} ${r.req} · ${r.xp} xp</div>
          <div class="ins">${Object.entries(r.in).map(([id, n]) => `<span class="in ${S.count(ch, id) < n ? "miss" : ""}">${iconImg(id)} ${S.count(ch, id)}/${n}</span>`).join("")}</div></div>
          <button class="btn" data-craft="${r.id}" ${can.ok && !busy ? "" : "disabled"} title="${esc(can.why || "")}">Craft</button>
          <div class="cbar"><i></i></div></div>`;
      }).join("");
    body.querySelectorAll("[data-p]").forEach(b => b.addEventListener("click", () => { craftSkill = b.dataset.p; render(); }));
    body.querySelectorAll("[data-craft]").forEach(b => b.addEventListener("click", () => { Game.craft(b.dataset.craft); render(); }));
  }
}

// ---------------------------------------------------------------- notifications
function toast(html, cls) {
  const f = el("div", "feed " + (cls || ""), html);
  feed.appendChild(f);
  while (feed.children.length > 6) feed.firstChild.remove();
  setTimeout(() => f.remove(), 3300);
}
let levelTimer = 0;
function onEvents(evs) {
  for (const e of evs) {
    if (e.t === "item") toast(`${iconImg(e.id)}<span>+${e.n} ${esc(D.ITEMS[e.id].name)}</span>`);
    else if (e.t === "xp") toast(`<span class="xp" style="color:${D.SKILLS[e.skill].color}">+${e.xp} ${D.SKILLS[e.skill].name}</span>`);
    else if (e.t === "error") toast(esc(e.why), "err");
    else if (e.t === "level") {
      levelBanner.querySelector(".ln").textContent = `${D.SKILLS[e.skill].name} ${e.level}`;
      levelBanner.querySelector(".ls").textContent = `Level up · total level ${e.totalLevel}`;
      levelBanner.classList.add("show"); clearTimeout(levelTimer);
      levelTimer = setTimeout(() => levelBanner.classList.remove("show"), 2600);
    } else if (e.t === "used") toast(`${iconImg(e.id)}<span>You drink the ${esc(D.ITEMS[e.id].name)}.</span>`);
    else if (e.t === "equipped") toast(`${iconImg(e.id)}<span>Equipped ${esc(D.ITEMS[e.id].name)}</span>`);
    if (e.t === "item" && !journalOpen()) jb.classList.add("new");
  }
  render();
}

// ---------------------------------------------------------------- the action prompt (called every frame)
let lastPrompt = "";
function frame(p) {
  if (UI.started && window.Game && !Game.hasCharacter() && !root.classList.contains("creating")) openCreator();
  const busy = window.Game && Game.action();
  if (busy && busy.kind === "craft" && journalOpen() && tab === "craft") {
    const bar = journal.querySelector(".recipe.busy .cbar i"); if (bar) bar.style.width = (busy.progress * 100) + "%";
    else render();
  } else if (!busy && journal.querySelector(".recipe.busy")) render();
  root.classList.toggle("has-target", !!(p && UI.started));
  if (!p || !UI.started || journalOpen()) { if (lastPrompt) { prompt.style.display = "none"; lastPrompt = ""; } return; }
  const locked = p.level < p.req;
  const label = locked ? `${D.SKILLS[p.skill].name} ${p.req} needed` : p.resting ? "Needs time to regrow" : `${p.verb} · ${p.name}`;
  const key = label + "|" + locked + "|" + (p.progress >= 0) + "|" + p.more;
  if (key !== lastPrompt) {
    prompt.className = locked || p.resting ? "locked" : "";
    prompt.innerHTML = `<div class="pp">${locked || p.resting ? "" : "<kbd>E</kbd>"}<span>${esc(label)}</span>${p.more ? '<kbd class="tab">Tab</kbd>' : ""}</div>${p.progress >= 0 ? '<div class="pbar"><i></i></div>' : ""}`;
    act.textContent = locked || p.resting ? "—" : p.verb;
    lastPrompt = key;
  }
  prompt.style.display = "block";
  prompt.style.left = p.x + "px"; prompt.style.top = p.y + "px";
  if (p.progress >= 0) { const i = prompt.querySelector(".pbar i"); if (i) i.style.width = (p.progress * 100) + "%"; }
}

// ---------------------------------------------------------------- character creator
const look = { ...CH.DEFAULT_LOOK };
let animName = "walk", t0 = performance.now(), crRaf = 0;
const NAMES = ["Tamsin", "Bram", "Isolde", "Wren", "Corin", "Elowen", "Hale", "Maren", "Oren", "Sable", "Teague", "Linnet"];
function openCreator() {
  root.classList.add("creating");
  const n = (k, N) => (look[k] % N + N) % N;
  const swatches = (key, pal, off) => `<div class="sw">${off ? `<button class="off ${look.cloakOn ? "" : "on"}" data-off="1">None</button>` : ""}${pal.map((c, i) => `<button style="background:${c}" class="${(!off || look.cloakOn) && n(key, pal.length) === i ? "on" : ""}" data-k="${key}" data-v="${i}" aria-label="colour ${i + 1}"></button>`).join("")}</div>`;
  const picker = (key, list) => `<div class="pick"><button data-step="${key}" data-d="-1" aria-label="previous">‹</button><span class="pv">${list[n(key, list.length)]}</span><button data-step="${key}" data-d="1" aria-label="next">›</button></div>`;
  creator.innerHTML = `<div class="cr glass">
    <div class="cr-prev"><canvas id="cr-canvas" width="240" height="340"></canvas>
      <div class="cr-anim">${["idle", "walk", "run", "chop", "gather"].map(a => `<button data-anim="${a}" class="${a === animName ? "on" : ""}">${a[0].toUpperCase() + a.slice(1)}</button>`).join("")}</div></div>
    <div><h2>Who walks the road?</h2><div class="sub">No class to choose: you become what you practise.</div>
      <input class="cr-name" id="cr-name" maxlength="18" placeholder="Name" value="${esc(creator.dataset.name || NAMES[Math.floor(Math.random() * NAMES.length)])}">
      <div class="cr-row"><span>Build</span>${picker("build", CH.BUILDS)}</div>
      <div class="cr-row"><span>Skin</span>${swatches("skin", CH.PAL.skin)}</div>
      <div class="cr-row"><span>Hair</span>${picker("hair", CH.HAIR_STYLES)}</div>
      <div class="cr-row"><span>Hair colour</span>${swatches("hairColor", CH.PAL.hair)}</div>
      <div class="cr-row"><span>Tunic</span>${swatches("tunic", CH.PAL.cloth)}</div>
      <div class="cr-row"><span>Trousers</span>${swatches("trousers", CH.PAL.cloth)}</div>
      <div class="cr-row"><span>Cloak</span>${swatches("cloak", CH.PAL.cloth, true)}</div>
      <div class="cr-row"><span>Boots</span>${swatches("boots", CH.PAL.boots)}</div>
      <div class="cr-go"><button class="btn" id="cr-start">Begin your journey</button><button class="btn ghost" id="cr-rand">Surprise me</button></div>
    </div></div>`;
  creator.querySelector("#cr-name").addEventListener("input", e => { creator.dataset.name = e.target.value; });
  creator.onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.anim) { animName = b.dataset.anim; }
    else if (b.dataset.step) look[b.dataset.step] += +b.dataset.d;
    else if (b.dataset.off) look.cloakOn = 0;
    else if (b.dataset.k) { look[b.dataset.k] = +b.dataset.v; if (b.dataset.k === "cloak") look.cloakOn = 1; }
    else if (b.id === "cr-rand") {
      const r = N => Math.floor(Math.random() * N);
      Object.assign(look, { build: r(2), skin: r(CH.PAL.skin.length), hair: r(CH.HAIR_STYLES.length), hairColor: r(CH.PAL.hair.length),
        tunic: r(8), trousers: r(8), cloak: r(8), cloakOn: r(4) ? 1 : 0, boots: r(3) });
      creator.dataset.name = NAMES[r(NAMES.length)];
    } else if (b.id === "cr-start") {
      const name = ($("cr-name").value || "").trim() || "Wanderer";
      for (const k of ["build", "skin", "hair", "hairColor", "tunic", "trousers", "cloak", "boots"]) {
        const N = { build: 2, skin: CH.PAL.skin.length, hair: CH.HAIR_STYLES.length, hairColor: CH.PAL.hair.length, tunic: 8, trousers: 8, cloak: 8, boots: 3 }[k];
        look[k] = (look[k] % N + N) % N;
      }
      root.classList.remove("creating"); cancelAnimationFrame(crRaf);
      Game.create(name, { ...look });
      setTimeout(() => toast("<span>Press <b>E</b> by a plant, log or rock to gather · <b>I</b> opens your journal</span>"), 900);
      return;
    } else return;
    openCreator();
  };
  cancelAnimationFrame(crRaf);
  const tick = () => {
    const c = $("cr-canvas"); if (!c) return;
    CH.preview(c, look, {}, animName, (performance.now() - t0) / 1000);
    crRaf = requestAnimationFrame(tick);
  };
  tick();
}

// ---------------------------------------------------------------- keys and touch
addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT" && e.target.type === "text") return;
  if (!UI.started || !window.Game || !Game.hasCharacter() || root.classList.contains("creating")) return;
  const k = e.key.toLowerCase();
  if (k === "e" && !e.repeat && !journalOpen()) Game.interact();
  if (k === "tab" && !journalOpen()) { e.preventDefault(); Game.nextTarget(); }
  if (k === "i") journalOpen() && tab === "bag" ? closeJournal() : openJournal("bag");
  if (k === "k") journalOpen() && tab === "char" ? closeJournal() : openJournal("char");
  if (k === "c") journalOpen() && tab === "craft" ? closeJournal() : openJournal("craft");
  if (k === "escape") closeJournal();
});
prompt.addEventListener("pointerdown", e => { e.preventDefault(); if (window.Game) Game.nextTarget(); });
act.addEventListener("pointerdown", e => { e.preventDefault(); act.classList.add("down"); if (window.Game) Game.interact(); });
["pointerup", "pointercancel", "pointerleave"].forEach(t => act.addEventListener(t, () => act.classList.remove("down")));

function hook() {
  if (!window.Game) return setTimeout(hook, 200);
  Game.on(onEvents);
}
hook();
window.RPGUI = { frame, openJournal, openCreator, toast };
})();
