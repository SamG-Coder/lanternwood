// Lanternwood character state. Every change goes through act(character, command, ctx), which
// validates it the way a server would and returns events for the interface. No DOM, no rendering:
// the MMO gateway can run this same file as the authority and send the events to clients.
(function (root) {
"use strict";
const D = root.LWData || (typeof require !== "undefined" ? require("./data.js") : null);
const SAVE_VERSION = 1, INV_SLOTS = 28, STACK = 50;

function newCharacter(name, look, now) {
  const ch = {
    v: SAVE_VERSION, name: String(name || "Wanderer").slice(0, 18), look: look || {},
    created: now, skills: {}, inv: new Array(INV_SLOTS).fill(null),
    equip: { main: null, off: null, trinket: null },
    tools: { herbalism: null, forestry: null, stonecutting: null },   // crafted upgrades; worn tools are built in
    nodes: {},                                                        // node key -> { uses, readyAt }
    pos: { x: 6, d: 14 }, time: 8.5, stats: { gathered: 0, crafted: 0, metres: 0, jumps: 0 },
  };
  for (const k in D.SKILLS) ch.skills[k] = 0;
  for (const [id, n] of D.START.inv) addItem(ch, id, n);
  return ch;
}
function load(json) {
  const ch = typeof json === "string" ? JSON.parse(json) : json;
  if (!ch || ch.v !== SAVE_VERSION) return null;
  for (const k in D.SKILLS) if (typeof ch.skills[k] !== "number") ch.skills[k] = 0;
  while (ch.inv.length < INV_SLOTS) ch.inv.push(null);
  ch.tools = ch.tools || { herbalism: null, forestry: null, stonecutting: null };
  ch.stats = ch.stats || { gathered: 0, crafted: 0, metres: 0, jumps: 0 };
  return ch;
}

// ---------------------------------------------------------------- queries
const level = (ch, skill) => D.levelOf(ch.skills[skill] || 0);
const totalLevel = ch => Object.keys(D.SKILLS).reduce((s, k) => s + level(ch, k), 0);
const count = (ch, id) => ch.inv.reduce((s, it) => s + (it && it.id === id ? it.n : 0), 0);
function spaceFor(ch, id, n) {
  let room = 0;
  for (const it of ch.inv) room += !it ? STACK : it.id === id ? STACK - it.n : 0;
  return room >= n;
}
function addItem(ch, id, n) {
  let left = n;
  for (const it of ch.inv) if (left && it && it.id === id && it.n < STACK) { const k = Math.min(left, STACK - it.n); it.n += k; left -= k; }
  for (let i = 0; i < ch.inv.length && left; i++) if (!ch.inv[i]) { const k = Math.min(left, STACK); ch.inv[i] = { id, n: k }; left -= k; }
  return n - left;
}
function removeItem(ch, id, n) {
  let left = n;
  for (let i = ch.inv.length - 1; i >= 0 && left; i--) {
    const it = ch.inv[i];
    if (it && it.id === id) { const k = Math.min(left, it.n); it.n -= k; left -= k; if (!it.n) ch.inv[i] = null; }
  }
  return n - left;
}
function toolSpeed(ch, skill) { const t = ch.tools[skill]; return t && D.ITEMS[t] ? D.ITEMS[t].speed : 1.0; }
// seconds a gather takes: faster with level above the requirement and with a better tool
function gatherTime(ch, node) {
  const over = Math.max(0, level(ch, node.skill) - node.req);
  return node.time * Math.max(0.5, 1 - 0.014 * over) / toolSpeed(ch, node.skill);
}
function nodeState(ch, key, node, now) {
  const s = ch.nodes[key];
  if (!s) return { uses: node.uses, ready: true };
  if (s.readyAt && now >= s.readyAt) { delete ch.nodes[key]; return { uses: node.uses, ready: true }; }
  return { uses: s.uses, ready: !s.readyAt, readyAt: s.readyAt };
}
function agilityBonus(ch) {
  const t = ch.equip.trinket && D.ITEMS[ch.equip.trinket];
  return 1 + 0.006 * (level(ch, "agility") - 1) + (t && t.agility || 0);
}
function canCraft(ch, r) {
  if (level(ch, r.skill) < r.req) return { ok: false, why: `Needs ${D.SKILLS[r.skill].name} ${r.req}` };
  for (const id in r.in) if (count(ch, id) < r.in[id]) return { ok: false, why: `Needs ${r.in[id]} ${D.ITEMS[id].name}` };
  return { ok: true };
}

// ---------------------------------------------------------------- the one way to change a character
function gainXp(ch, skill, xp, ev) {
  const before = level(ch, skill);
  ch.skills[skill] = Math.min((ch.skills[skill] || 0) + xp, D.xpFor(D.MAX_LEVEL));
  const after = level(ch, skill);
  ev.push({ t: "xp", skill, xp, total: ch.skills[skill] });
  if (after > before) ev.push({ t: "level", skill, level: after, totalLevel: totalLevel(ch) });
}
function act(ch, cmd, ctx) {
  const ev = [], now = ctx.now, rnd = ctx.rng || Math.random;
  const fail = why => (ev.push({ t: "error", why }), ev);
  switch (cmd.t) {
    case "gather": {
      const node = D.nodeFor(cmd.species, cmd.region);
      if (!node) return fail("Nothing to gather here");
      if (level(ch, node.skill) < node.req) return fail(`Needs ${D.SKILLS[node.skill].name} ${node.req}`);
      const st = nodeState(ch, cmd.key, node, now);
      if (!st.ready) return fail("It needs time to grow back");
      const got = [];
      for (const [id, lo, hi] of node.yields) {
        const n = lo + Math.floor(rnd() * (hi - lo + 1));
        if (n > 0) got.push([id, n]);
      }
      if (!got.every(([id, n]) => spaceFor(ch, id, n))) return fail("Your bag is full");
      for (const [id, n] of got) { addItem(ch, id, n); ev.push({ t: "item", id, n }); }
      gainXp(ch, node.skill, node.xp, ev);
      const uses = st.uses - 1;
      ch.nodes[cmd.key] = uses > 0 ? { uses } : { uses: 0, readyAt: now + node.respawn * 1000 };
      if (uses <= 0) ev.push({ t: "spent", key: cmd.key, readyAt: ch.nodes[cmd.key].readyAt, hide: !!node.deplete });
      ch.stats.gathered++;
      return ev;
    }
    case "craft": {
      const r = D.RECIPES.find(x => x.id === cmd.id);
      if (!r) return fail("Unknown recipe");
      const c = canCraft(ch, r);
      if (!c.ok) return fail(c.why);
      for (const id in r.in) removeItem(ch, id, r.in[id]);
      if (!spaceFor(ch, r.id, 1)) { for (const id in r.in) addItem(ch, id, r.in[id]); return fail("Your bag is full"); }
      addItem(ch, r.id, 1);
      ev.push({ t: "item", id: r.id, n: 1, crafted: true });
      gainXp(ch, r.skill, r.xp, ev);
      ch.stats.crafted++;
      return ev;
    }
    case "equip": {
      const it = ch.inv[cmd.slot];
      if (!it) return fail("Nothing there");
      const def = D.ITEMS[it.id];
      if (def.kind === "tool") {
        const old = ch.tools[def.tool];
        removeItem(ch, it.id, 1); ch.tools[def.tool] = it.id;
        if (old) addItem(ch, old, 1);
        ev.push({ t: "equipped", id: it.id, slot: "tool:" + def.tool });
        return ev;
      }
      if (!def.slot) return fail("You can't equip that");
      const old = ch.equip[def.slot];
      removeItem(ch, it.id, 1); ch.equip[def.slot] = it.id;
      if (old) addItem(ch, old, 1);
      ev.push({ t: "equipped", id: it.id, slot: def.slot });
      return ev;
    }
    case "unequip": {
      const id = cmd.slot.startsWith("tool:") ? ch.tools[cmd.slot.slice(5)] : ch.equip[cmd.slot];
      if (!id) return fail("Nothing equipped");
      if (!spaceFor(ch, id, 1)) return fail("Your bag is full");
      if (cmd.slot.startsWith("tool:")) ch.tools[cmd.slot.slice(5)] = null; else ch.equip[cmd.slot] = null;
      addItem(ch, id, 1);
      ev.push({ t: "unequipped", id, slot: cmd.slot });
      return ev;
    }
    case "use": {
      const it = ch.inv[cmd.slot];
      if (!it) return fail("Nothing there");
      const def = D.ITEMS[it.id];
      if (def.kind !== "potion") return fail("You can't use that");
      removeItem(ch, it.id, 1);
      ev.push({ t: "used", id: it.id });
      return ev;
    }
    case "drop": {
      const it = ch.inv[cmd.slot];
      if (!it) return fail("Nothing there");
      ch.inv[cmd.slot] = null;
      ev.push({ t: "dropped", id: it.id, n: it.n });
      return ev;
    }
    case "move": {   // agility: distance walked and jumps (a server would derive these from movement)
      const m = Math.max(0, Math.min(cmd.metres || 0, 60)), j = Math.max(0, Math.min(cmd.jumps || 0, 6));
      ch.stats.metres += m; ch.stats.jumps += j;
      const xp = Math.floor(m / 8) + 2 * j;
      if (xp > 0) gainXp(ch, "agility", xp, ev);
      return ev;
    }
  }
  return fail("Unknown action");
}

const api = { SAVE_VERSION, INV_SLOTS, STACK, newCharacter, load, act, level, totalLevel, count, spaceFor, gatherTime, nodeState, toolSpeed, agilityBonus, canCraft };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.LWState = api;
})(typeof self !== "undefined" ? self : this);
