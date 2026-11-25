// Lanternwood character state. Every change goes through act(character, command, ctx), which
// validates it the way a server would and returns events for the interface. No DOM, no rendering:
// the MMO gateway can run this same file as the authority and send the events to clients.
//
// Commands are untrusted input: every field is checked, and act() never throws (a bad command
// returns an error event). ctx carries what only the caller knows: { now (ms), rng, player:{x,d},
// at:{x,d} (the node's position), startedAt (ms, when the gather or craft began), duration (s, the
// action's length fixed when it began), lookupNode(key) -> {species, region, x, d} | null }. When
// these are given, gathering checks reach and duration too; with lookupNode the node's identity
// comes from the authority's own world data and the command's species / region are ignored.
(function (root) {
"use strict";
const D = root.LWData || (typeof require !== "undefined" ? require("./data.js") : null);
const SAVE_VERSION = 1, INV_SLOTS = 28, STACK = 50;
const hasOwn = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const itemDef = id => (typeof id === "string" && hasOwn(D.ITEMS, id) ? D.ITEMS[id] : null);
const EQUIP_SLOTS = ["main", "off", "trinket"];
const TOOL_SKILLS = Object.keys(D.SKILLS).filter(k => D.SKILLS[k].kind === "gathering");
const isSlot = s => Number.isInteger(s) && s >= 0 && s < INV_SLOTS;
const num = (v, lo, hi, dflt) => { const n = +v; return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; };
const REACH_X = 2.6, REACH_D = 5.0;   // generous: the client's own reach is smaller
const isKey = k => typeof k === "string" && /^[A-Za-z0-9_.,:@-]{1,64}$/.test(k) && k !== "__proto__" && k !== "constructor" && k !== "prototype";
const nodeMap = () => Object.create(null);

function newCharacter(name, look, now) {
  const ch = {
    v: SAVE_VERSION, name: cleanName(name), look: cleanLook(look),
    created: now, skills: {}, inv: new Array(INV_SLOTS).fill(null),
    equip: { main: null, off: null, trinket: null },
    tools: Object.fromEntries(TOOL_SKILLS.map(k => [k, null])),   // crafted upgrades; worn tools are built in
    nodes: nodeMap(),                                             // node key -> { uses, at, readyAt }
    world: "", pos: { x: 6, d: 14 }, time: 8.5,
    stats: { gathered: 0, crafted: 0, metres: 0, jumps: 0, agiCarry: 0 },
  };
  for (const k in D.SKILLS) ch.skills[k] = 0;
  for (const [id, n] of D.START.inv) addItem(ch.inv, id, n);
  return ch;
}
function cleanName(name) { const s = String(name == null ? "" : name).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 18); return s || "Wanderer"; }
function cleanLook(look) {
  const out = {};
  for (const [k, v] of Object.entries(look && typeof look === "object" ? look : {})) if (/^[a-zA-Z]{1,12}$/.test(k) && Number.isInteger(v) && v >= 0 && v < 64) out[k] = v;
  return out;
}

// Repair or reject a save (hand-edited, partial, or from an older build). Returns null if it is
// not a Lanternwood save of this version; otherwise a clean character with every field valid.
function load(json) {
  let raw;
  try { raw = typeof json === "string" ? JSON.parse(json) : json; } catch (e) { return null; }
  if (!raw || typeof raw !== "object" || raw.v !== SAVE_VERSION) return null;
  const ch = newCharacter(raw.name, raw.look, num(raw.created, 0, 1e15, 0));
  ch.inv = new Array(INV_SLOTS).fill(null);
  if (Array.isArray(raw.inv)) raw.inv.slice(0, INV_SLOTS).forEach((it, i) => {
    if (it && itemDef(it.id) && Number.isInteger(it.n) && it.n > 0) ch.inv[i] = { id: it.id, n: Math.min(it.n, STACK) };
  });
  for (const k in D.SKILLS) ch.skills[k] = num(raw.skills && raw.skills[k], 0, D.xpFor(D.MAX_LEVEL), 0);
  for (const s of EQUIP_SLOTS) { const id = raw.equip && raw.equip[s], d = itemDef(id); ch.equip[s] = d && d.slot === s ? id : null; }
  for (const k of TOOL_SKILLS) { const id = raw.tools && raw.tools[k], d = itemDef(id); ch.tools[k] = d && d.tool === k ? id : null; }
  if (raw.nodes && typeof raw.nodes === "object") for (const [key, s] of Object.entries(raw.nodes)) {
    if (!isKey(key) || !s || typeof s !== "object") continue;
    const e = { uses: Math.floor(num(s.uses, 0, 99, 0)) };
    if (s.at != null) e.at = num(s.at, 0, 1e15, 0);
    if (s.readyAt != null) e.readyAt = num(s.readyAt, 0, 1e15, 0);
    ch.nodes[key] = e;
  }
  ch.world = typeof raw.world === "string" ? raw.world.slice(0, 64) : "";
  ch.pos = { x: num(raw.pos && raw.pos.x, -1e4, 1e4, 6), d: num(raw.pos && raw.pos.d, 0, 1e3, 14) };
  ch.time = num(raw.time, 0, 24, 8.5);
  const st = raw.stats || {};
  ch.stats = { gathered: num(st.gathered, 0, 1e12, 0), crafted: num(st.crafted, 0, 1e12, 0), metres: num(st.metres, 0, 1e12, 0),
               jumps: num(st.jumps, 0, 1e12, 0), agiCarry: num(st.agiCarry, 0, 8, 0) };
  return ch;
}

// ---------------------------------------------------------------- inventory helpers (on any inv array)
function addItem(inv, id, n) {
  let left = n;
  for (const it of inv) if (left && it && it.id === id && it.n < STACK) { const k = Math.min(left, STACK - it.n); it.n += k; left -= k; }
  for (let i = 0; i < inv.length && left; i++) if (!inv[i]) { const k = Math.min(left, STACK); inv[i] = { id, n: k }; left -= k; }
  return n - left;
}
function removeItem(inv, id, n, fromSlot) {
  let left = n;
  if (isSlot(fromSlot) && inv[fromSlot] && inv[fromSlot].id === id) {   // the stack the player picked first
    const it = inv[fromSlot], k = Math.min(left, it.n); it.n -= k; left -= k; if (!it.n) inv[fromSlot] = null;
  }
  for (let i = inv.length - 1; i >= 0 && left; i--) {
    const it = inv[i];
    if (it && it.id === id) { const k = Math.min(left, it.n); it.n -= k; left -= k; if (!it.n) inv[i] = null; }
  }
  return n - left;
}
const copyInv = inv => inv.map(it => it && { id: it.id, n: it.n });
// would every [id, n] fit together?
function fitsAll(inv, list) { const c = copyInv(inv); return list.every(([id, n]) => addItem(c, id, n) === n); }

// ---------------------------------------------------------------- queries
const level = (ch, skill) => D.levelOf(ch.skills[skill] || 0);
const totalLevel = ch => Object.keys(D.SKILLS).reduce((s, k) => s + level(ch, k), 0);
const count = (ch, id) => ch.inv.reduce((s, it) => s + (it && it.id === id ? it.n : 0), 0);
const spaceFor = (ch, id, n) => fitsAll(ch.inv, [[id, n]]);
function toolSpeed(ch, skill) { const d = itemDef(ch.tools[skill]); return d && d.speed ? d.speed : 1.0; }
// seconds a gather takes: faster with level above the requirement and with a better tool
function gatherTime(ch, node) {
  const over = Math.max(0, level(ch, node.skill) - node.req);
  return node.time * Math.max(0.5, 1 - 0.014 * over) / toolSpeed(ch, node.skill);
}
// a node's state now: spent nodes regrow after `respawn`; partly used ones recover their uses too
function nodeState(ch, key, node, now) {
  const s = isKey(key) && hasOwn(ch.nodes, key) ? ch.nodes[key] : null;
  if (!s) return { uses: node.uses, ready: true };
  if (s.readyAt ? now >= s.readyAt : now - (s.at || 0) >= node.respawn * 1000) { delete ch.nodes[key]; return { uses: node.uses, ready: true }; }
  return { uses: s.uses, ready: !s.readyAt, readyAt: s.readyAt };
}
// room for the most a node can yield (checked before a gather starts)
function roomForNode(ch, node) { return fitsAll(ch.inv, node.yields.filter(y => y[2] > 0).map(([id, , hi]) => [id, hi])); }
function agilityBonus(ch) {
  const t = itemDef(ch.equip.trinket);
  return 1 + 0.006 * (level(ch, "agility") - 1) + (t && t.agility || 0);
}
function canCraft(ch, r) {
  if (level(ch, r.skill) < r.req) return { ok: false, why: `Needs ${D.SKILLS[r.skill].name} ${r.req}` };
  for (const id in r.in) if (count(ch, id) < r.in[id]) return { ok: false, why: `Needs ${r.in[id]} ${D.ITEMS[id].name}` };
  return { ok: true };
}

// ---------------------------------------------------------------- the one way to change a character
function gainXp(ch, skill, xp, ev) {
  const before = level(ch, skill), had = ch.skills[skill] || 0;
  ch.skills[skill] = Math.min(had + xp, D.xpFor(D.MAX_LEVEL));
  const added = ch.skills[skill] - had;
  if (added > 0) ev.push({ t: "xp", skill, xp: added, total: ch.skills[skill] });
  const after = level(ch, skill);
  if (after > before) ev.push({ t: "level", skill, level: after, totalLevel: totalLevel(ch) });
}
function act(ch, cmd, ctx) {
  try { return actUnsafe(ch, cmd || {}, ctx || {}); }
  catch (e) { return [{ t: "error", why: "That didn't work" }]; }
}
function actUnsafe(ch, cmd, ctx) {
  const ev = [], now = num(ctx.now, 0, 1e15, 0), rnd = typeof ctx.rng === "function" ? ctx.rng : Math.random;
  const fail = why => (ev.push({ t: "error", why }), ev);
  const tooSoon = (sec) => ctx.startedAt != null && now - ctx.startedAt < sec * 1000 * 0.9;
  switch (cmd.t) {
    case "gather": {
      if (!isKey(cmd.key)) return fail("Nothing to gather here");
      let species = cmd.species, region = cmd.region, at = ctx.at;
      if (typeof ctx.lookupNode === "function") {          // the authority knows what stands at that key
        const w = ctx.lookupNode(cmd.key);
        if (!w) return fail("Nothing to gather here");
        species = w.species; region = w.region; at = { x: w.x, d: w.d };
      }
      const node = D.nodeFor(species, region);
      if (!node) return fail("Nothing to gather here");
      if (ctx.player && at && (Math.abs(ctx.player.x - at.x) > REACH_X || Math.abs(ctx.player.d - at.d) > REACH_D)) return fail("Too far away");
      if (level(ch, node.skill) < node.req) return fail(`Needs ${D.SKILLS[node.skill].name} ${node.req}`);
      if (tooSoon(num(ctx.duration, 0, 60, gatherTime(ch, node)))) return fail("Not so fast");
      const st = nodeState(ch, cmd.key, node, now);
      if (!st.ready) return fail("It needs time to grow back");
      const got = [];
      for (const [id, lo, hi] of node.yields) {
        const n = lo + Math.floor(rnd() * (hi - lo + 1));
        if (n > 0) got.push([id, n]);
      }
      if (!fitsAll(ch.inv, got)) return fail("Your bag is full");
      for (const [id, n] of got) { const k = addItem(ch.inv, id, n); if (k) ev.push({ t: "item", id, n: k }); }
      gainXp(ch, node.skill, node.xp, ev);
      const uses = st.uses - 1;
      ch.nodes[cmd.key] = uses > 0 ? { uses, at: now } : { uses: 0, at: now, readyAt: now + node.respawn * 1000 };
      if (uses <= 0) ev.push({ t: "spent", key: cmd.key, readyAt: ch.nodes[cmd.key].readyAt, hide: !!node.deplete });
      ch.stats.gathered++;
      return ev;
    }
    case "craft": {
      const r = D.RECIPES.find(x => x.id === cmd.id);
      if (!r) return fail("Unknown recipe");
      const c = canCraft(ch, r);
      if (!c.ok) return fail(c.why);
      if (tooSoon(r.time)) return fail("Not so fast");
      const inv = copyInv(ch.inv);
      for (const id in r.in) removeItem(inv, id, r.in[id]);
      if (addItem(inv, r.id, 1) !== 1) return fail("Your bag is full");
      ch.inv = inv;
      ev.push({ t: "item", id: r.id, n: 1, crafted: true });
      gainXp(ch, r.skill, r.xp, ev);
      ch.stats.crafted++;
      return ev;
    }
    case "equip": {
      if (!isSlot(cmd.slot) || !ch.inv[cmd.slot]) return fail("Nothing there");
      const id = ch.inv[cmd.slot].id, def = itemDef(id);
      if (!def) return fail("Nothing there");
      const isTool = def.kind === "tool" && TOOL_SKILLS.includes(def.tool);
      if (!isTool && !EQUIP_SLOTS.includes(def.slot)) return fail("You can't equip that");
      // swap on a copy: the item comes out of the picked slot, the old one must fit back in
      const inv = copyInv(ch.inv);
      removeItem(inv, id, 1, cmd.slot);
      const old = isTool ? ch.tools[def.tool] : ch.equip[def.slot];
      if (old && addItem(inv, old, 1) !== 1) return fail("Your bag is full");
      ch.inv = inv;
      if (isTool) ch.tools[def.tool] = id; else ch.equip[def.slot] = id;
      ev.push({ t: "equipped", id, slot: isTool ? "tool:" + def.tool : def.slot });
      return ev;
    }
    case "unequip": {
      const s = cmd.slot;
      const tool = typeof s === "string" && s.startsWith("tool:") ? s.slice(5) : null;
      if (tool ? !TOOL_SKILLS.includes(tool) : !EQUIP_SLOTS.includes(s)) return fail("Nothing equipped");
      const id = tool ? ch.tools[tool] : ch.equip[s];
      if (!id) return fail("Nothing equipped");
      if (!spaceFor(ch, id, 1)) return fail("Your bag is full");
      if (tool) ch.tools[tool] = null; else ch.equip[s] = null;
      addItem(ch.inv, id, 1);
      ev.push({ t: "unequipped", id, slot: s });
      return ev;
    }
    case "use": {
      if (!isSlot(cmd.slot) || !ch.inv[cmd.slot]) return fail("Nothing there");
      const id = ch.inv[cmd.slot].id, def = itemDef(id);
      if (!def || def.kind !== "potion") return fail("You can't use that");
      removeItem(ch.inv, id, 1, cmd.slot);
      ev.push({ t: "used", id });
      return ev;
    }
    case "drop": {
      if (!isSlot(cmd.slot) || !ch.inv[cmd.slot]) return fail("Nothing there");
      const it = ch.inv[cmd.slot];
      ch.inv[cmd.slot] = null;
      ev.push({ t: "dropped", id: it.id, n: it.n });
      return ev;
    }
    case "move": {   // agility: real distance walked (stat) plus a bonus for running (xp only), and jumps
      const m = num(cmd.metres, 0, 60, 0), run = num(cmd.runMetres, 0, 60, 0), j = Math.floor(num(cmd.jumps, 0, 6, 0));
      ch.stats.metres += m; ch.stats.jumps += j;
      const units = ch.stats.agiCarry + m + 0.5 * run;
      const xp = Math.floor(units / 8) + 2 * j;
      ch.stats.agiCarry = units % 8;
      if (xp > 0) gainXp(ch, "agility", xp, ev);
      return ev;
    }
  }
  return fail("Unknown action");
}

const api = { SAVE_VERSION, INV_SLOTS, STACK, newCharacter, load, act, level, totalLevel, count, spaceFor, roomForNode,
              gatherTime, nodeState, toolSpeed, agilityBonus, canCraft };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.LWState = api;
})(typeof self !== "undefined" ? self : this);
