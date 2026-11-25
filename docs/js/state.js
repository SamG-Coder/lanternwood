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
// lookupGate(id) -> {x} | null lets "repair" check the player stands at the obstacle. lookupNode may
// also give ri (the node's region index): a region the road hasn't opened yet can't be gathered.
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
// the fastest a gather can ever be (top level, best tool): a duration a caller supplies is never
// trusted below this, so a client can't claim a zero-second gather
const BEST_TOOL = Math.max(1, ...Object.values(D.ITEMS).filter(i => i.kind === "tool").map(i => i.speed || 1));
const minGatherTime = (node, potion) => node.time * 0.5 / (BEST_TOOL * potion);
const REPAIR_TIME = 3.0, GATE_REACH = 4.0, JOB_SLOTS = 3;
// a small seeded generator, for what a new character is offered before any command has an rng
const seeded = seed => { let s = Math.abs(Math.floor(seed)) % 233280; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); };

function newCharacter(name, look, now) {
  const ch = {
    v: SAVE_VERSION, name: cleanName(name), look: cleanLook(look),
    created: now, skills: {}, inv: new Array(INV_SLOTS).fill(null),
    equip: { main: null, off: null, trinket: null },
    tools: Object.fromEntries(TOOL_SKILLS.map(k => [k, null])),   // crafted upgrades; worn tools are built in
    nodes: nodeMap(),                                             // node key -> { uses, at, readyAt }
    world: "", pos: { x: 6, d: 14 }, time: 8.5,
    gates: {},                                                    // obstacle id -> true once mended
    jobs: [],                                                     // open commission ids
    buffs: {},                                                    // potion effect id -> active until (ms)
    curios: [],                                                   // curio ids found, in order
    stats: { gathered: 0, crafted: 0, metres: 0, jumps: 0, agiCarry: 0, jobs: 0, repairs: 0 },
  };
  for (const k in D.SKILLS) ch.skills[k] = 0;
  for (const [id, n] of D.START.inv) addItem(ch.inv, id, n);
  refillJobs(ch, seeded(now || 1));
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
               jumps: num(st.jumps, 0, 1e12, 0), agiCarry: num(st.agiCarry, 0, 8, 0), jobs: num(st.jobs, 0, 1e12, 0), repairs: num(st.repairs, 0, 1e12, 0) };
  ch.gates = {};
  if (raw.gates && typeof raw.gates === "object") for (const g of D.GATES) { if (!(hasOwn(raw.gates, g.id) && raw.gates[g.id] === true)) break; ch.gates[g.id] = true; }
  ch.buffs = {};
  if (raw.buffs && typeof raw.buffs === "object") for (const k in D.EFFECTS) if (hasOwn(raw.buffs, k)) ch.buffs[k] = num(raw.buffs[k], 0, 1e15, 0);
  ch.curios = [];
  if (Array.isArray(raw.curios)) for (const id of raw.curios) if (typeof id === "string" && D.CURIOS.some(c => c.id === id) && !ch.curios.includes(id)) ch.curios.push(id);
  ch.jobs = [];
  if (Array.isArray(raw.jobs)) for (const id of raw.jobs.slice(0, JOB_SLOTS)) {
    const j = typeof id === "string" ? D.jobById(id) : null;
    if (j && j.stage <= stage(ch) && !ch.jobs.includes(id)) ch.jobs.push(id);
  }
  refillJobs(ch, seeded(ch.created + ch.stats.jobs + 7));
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
// the strongest active potion effect of one kind (gather, xp, curio, move, jump); 1 when none
function buffOf(ch, now, key) {
  let m = 1;
  if (!ch.buffs) return m;
  for (const k in D.EFFECTS) {
    const e = D.EFFECTS[k];
    if (e[key] && hasOwn(ch.buffs, k) && ch.buffs[k] > now && ch.buffs[k] - now <= e.secs * 1000 + 1000) m = Math.max(m, e[key]);
  }
  return m;
}
// seconds a gather takes: faster with level above the requirement, a better tool and a potion
function gatherTime(ch, node, now) {
  const over = Math.max(0, level(ch, node.skill) - node.req);
  return node.time * Math.max(0.5, 1 - 0.014 * over) / (toolSpeed(ch, node.skill) * buffOf(ch, now, "gather"));
}
// the road: how many obstacles are mended, in order (the next one to mend is GATES[stage])
function stage(ch) { let i = 0; while (i < D.GATES.length && ch.gates && ch.gates[D.GATES[i].id]) i++; return i; }
// what you own of an item: in the bag, in your hands, or as your tool
const owned = (ch, id) => count(ch, id) + EQUIP_SLOTS.filter(s => ch.equip[s] === id).length + TOOL_SKILLS.filter(k => ch.tools[k] === id).length;
// [id, still needed in the bag] for each thing a repair needs. Only the bag counts: what you hold or
// use as a tool is never taken (take it off first if it's the one you want to give).
function missingFor(ch, gate) { return Object.keys(gate.needs).map(id => [id, gate.needs[id] - count(ch, id)]).filter(x => x[1] > 0); }
const inUse = (ch, id) => owned(ch, id) > count(ch, id);
// keep three commissions open, newer ones likelier
function refillJobs(ch, rnd) {
  const s = stage(ch);
  while (ch.jobs.length < JOB_SLOTS) {
    const pool = D.JOBS.filter(j => j.stage <= s && !ch.jobs.includes(j.id));
    if (!pool.length) break;
    const w = pool.map(j => j.stage === s ? 3 : j.stage === s - 1 ? 1.5 : 0.5);
    let r = rnd() * w.reduce((a, b) => a + b, 0), k = 0;
    while (k < pool.length - 1 && (r -= w[k]) > 0) k++;
    ch.jobs.push(pool[k].id);
  }
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
function agilityBonus(ch, now) {
  const t = itemDef(ch.equip.trinket);
  return (1 + 0.006 * (level(ch, "agility") - 1) + (t && t.agility || 0)) * buffOf(ch, now, "move");
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
        if (Number.isInteger(w.ri) && w.ri > stage(ch)) return fail("The road there isn't open yet");
      }
      const node = D.nodeFor(species, region);
      if (!node) return fail("Nothing to gather here");
      const xpMul = buffOf(ch, now, "xp");
      if (ctx.player && at && (Math.abs(ctx.player.x - at.x) > REACH_X || Math.abs(ctx.player.d - at.d) > REACH_D)) return fail("Too far away");
      if (level(ch, node.skill) < node.req) return fail(`Needs ${D.SKILLS[node.skill].name} ${node.req}`);
      // (a potion that was at work when the gather began still counts if it ran out since)
      const potion = Math.max(buffOf(ch, now, "gather"), ctx.startedAt != null ? buffOf(ch, num(ctx.startedAt, 0, 1e15, now), "gather") : 1);
      if (tooSoon(Math.max(minGatherTime(node, potion), num(ctx.duration, 0, 60, gatherTime(ch, node, now))))) return fail("Not so fast");
      const st = nodeState(ch, cmd.key, node, now);
      if (!st.ready) return fail("It needs time to grow back");
      const got = [];
      for (const [id, lo, hi] of node.yields) {
        const n = lo + Math.floor(rnd() * (hi - lo + 1));
        if (n > 0) got.push([id, n]);
      }
      if (!fitsAll(ch.inv, got)) return fail("Your bag is full");
      for (const [id, n] of got) { const k = addItem(ch.inv, id, n); if (k) ev.push({ t: "item", id, n: k }); }
      gainXp(ch, node.skill, Math.round(node.xp * xpMul), ev);
      // now and then, something lost on the road turns up
      const left = D.CURIOS.filter(c => c.region === region && !ch.curios.includes(c.id));
      if (left.length && rnd() < D.CURIO_CHANCE * buffOf(ch, now, "curio")) {
        const c = left[Math.min(left.length - 1, Math.floor(rnd() * left.length))];
        ch.curios.push(c.id);
        ev.push({ t: "curio", id: c.id, found: ch.curios.length, total: D.CURIOS.length });
      }
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
      gainXp(ch, r.skill, Math.round(r.xp * buffOf(ch, now, "xp")), ev);
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
      const eff = def.effect && hasOwn(D.EFFECTS, def.effect) ? D.EFFECTS[def.effect] : null;
      removeItem(ch.inv, id, 1, cmd.slot);
      if (eff) ch.buffs[def.effect] = now + eff.secs * 1000;    // drinking another refreshes it
      ev.push({ t: "used", id, effect: eff ? def.effect : null, until: eff ? ch.buffs[def.effect] : 0 });
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
      if (xp > 0) gainXp(ch, "agility", Math.round(xp * buffOf(ch, now, "xp")), ev);
      return ev;
    }
    case "repair": {   // mend the next obstacle on the road with what it needs
      const g = typeof cmd.id === "string" ? D.gateById(cmd.id) : null;
      if (!g) return fail("Nothing to mend here");
      if (ch.gates[g.id]) return fail("Already mended");
      if (D.GATES[stage(ch)] !== g) return fail("The road before it needs mending first");
      if (typeof ctx.lookupGate === "function") {
        const w = ctx.lookupGate(g.id);
        if (!w || !ctx.player || Math.abs(ctx.player.x - w.x) > GATE_REACH) return fail("Too far away");
      }
      const miss = missingFor(ch, g);
      if (miss.length) return fail("Still needs " + miss.map(([id, n]) => `${n} ${D.ITEMS[id].name}${inUse(ch, id) ? " (take off the one you're using)" : ""}`).join(", "));
      if (tooSoon(REPAIR_TIME)) return fail("Not so fast");
      const inv = copyInv(ch.inv);
      for (const id of Object.keys(g.needs)) removeItem(inv, id, g.needs[id]);
      for (const [id, n] of g.reward) if (addItem(inv, id, n) !== n) return fail("Your bag is full");
      ch.inv = inv;
      ch.gates[g.id] = true; ch.stats.repairs++;
      ev.push({ t: "repaired", id: g.id, end: !!g.end, stage: stage(ch) });
      for (const [id, n] of g.reward) ev.push({ t: "item", id, n, reward: true });
      refillJobs(ch, rnd);
      return ev;
    }
    case "deliver": {  // hand over what a commission asks for
      const id = cmd.id;
      if (typeof id !== "string" || !ch.jobs.includes(id)) return fail("No such request");
      const j = D.jobById(id);
      if (!j) return fail("No such request");
      if (count(ch, j.item) < j.n) return fail(owned(ch, j.item) >= j.n ? `Take off your ${D.ITEMS[j.item].name} first` : `Needs ${j.n} ${D.ITEMS[j.item].name}`);
      const inv = copyInv(ch.inv);
      removeItem(inv, j.item, j.n);
      const [rid, rn] = j.reward;
      if (addItem(inv, rid, rn) !== rn) return fail("Your bag is full");
      ch.inv = inv;
      ev.push({ t: "delivered", id, from: j.from });
      ev.push({ t: "item", id: rid, n: rn, reward: true });
      gainXp(ch, j.skill, Math.round(j.xp * buffOf(ch, now, "xp")), ev);
      ch.jobs = ch.jobs.filter(x => x !== id);
      refillJobs(ch, rnd);
      ch.stats.jobs++;
      return ev;
    }
  }
  return fail("Unknown action");
}

const api = { SAVE_VERSION, INV_SLOTS, STACK, REPAIR_TIME, GATE_REACH, newCharacter, load, act, level, totalLevel, count, spaceFor, roomForNode, nodeMap,
              gatherTime, nodeState, toolSpeed, agilityBonus, canCraft, buffOf, stage, owned, missingFor };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.LWState = api;
})(typeof self !== "undefined" ? self : this);
