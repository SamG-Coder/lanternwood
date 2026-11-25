// node tools/test_state.js — checks the character rules in docs/js/state.js (the future server authority)
const D = require("../docs/js/data.js");
const S = require("../docs/js/state.js");
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error("FAIL", m); } };
let t = 1e9, seq = 0;
const ctx = () => ({ now: t, rng: () => ((seq = (seq * 9301 + 49297) % 233280) / 233280) });

const ch = S.newCharacter("Tess", { hair: 1 }, t);
ok(S.count(ch, "draught_minor") === 2, "starting potions");
// level gate
let ev = S.act(ch, { t: "gather", key: "n1", species: "Plant_Bilberry", region: "Hearthmeadow" }, ctx());
ok(ev[0].t === "error" && /Herbalism 9/.test(ev[0].why), "bilberry needs level 9");
// gather a poppy: item, xp, spent, respawn
ev = S.act(ch, { t: "gather", key: "n2", species: "Field_Poppy", region: "Hearthmeadow" }, ctx());
ok(ev.some(e => e.t === "item" && e.id === "poppy"), "poppy gathered");
ok(ch.skills.herbalism === 8, "8 herbalism xp");
ok(ev.some(e => e.t === "spent" && e.hide), "poppy spent and hidden");
ev = S.act(ch, { t: "gather", key: "n2", species: "Field_Poppy", region: "Hearthmeadow" }, ctx());
ok(ev[0].t === "error", "spent node refuses");
t += 91 * 1000;
ev = S.act(ch, { t: "gather", key: "n2", species: "Field_Poppy", region: "Hearthmeadow" }, ctx());
ok(ev.some(e => e.t === "item"), "respawned after 90 s");
// trees take several chops
for (let i = 0; i < 3; i++) S.act(ch, { t: "gather", key: "tree", species: "Tree_Common_Hazel", region: "Hearthmeadow" }, ctx());
ev = S.act(ch, { t: "gather", key: "tree", species: "Tree_Common_Hazel", region: "Hearthmeadow" }, ctx());
ok(ev[0].t === "error", "hazel rests after 3 chops");
// regional node: sandstone in the south
ch.skills.stonecutting = D.xpFor(15);
ev = S.act(ch, { t: "gather", key: "b", species: "Prop_Boulders", region: "Sunterrace Pines" }, ctx());
ok(ev.some(e => e.t === "item" && e.id === "sandstone"), "southern boulders give sandstone");
// craft: needs inputs, consumes them, gives xp
const hz = S.count(ch, "hazel");
ev = S.act(ch, { t: "craft", id: "staff_hazel" }, ctx());
if (hz >= 3) {
  ok(ev.some(e => e.t === "item" && e.id === "staff_hazel"), "staff crafted");
  ok(S.count(ch, "hazel") === hz - 3, "3 hazel used");
  const slot = ch.inv.findIndex(x => x && x.id === "staff_hazel");
  S.act(ch, { t: "equip", slot }, ctx());
  ok(ch.equip.main === "staff_hazel" && S.count(ch, "staff_hazel") === 0, "staff equipped");
} else ok(ev[0].t === "error", "staff refused without 3 hazel");
// level up event
const ch2 = S.newCharacter("A", {}, t);
ev = [];
for (let i = 0; i < 3; i++) ev.push(...S.act(ch2, { t: "move", metres: 60, jumps: 6 }, ctx()));
ok(ev.some(e => e.t === "level" && e.skill === "agility"), "agility levels from moving");
// bag full
const ch3 = S.newCharacter("B", {}, t);
ch3.inv = ch3.inv.map(() => ({ id: "granite", n: 50 }));
ev = S.act(ch3, { t: "gather", key: "p", species: "Field_Poppy", region: "Hearthmeadow" }, ctx());
ok(ev[0].t === "error" && /full/.test(ev[0].why), "full bag refuses");
// save round trip
ok(JSON.stringify(S.load(JSON.stringify(ch))) === JSON.stringify(ch), "save round trip");
// every node yields and every recipe input are real items
for (const k in D.NODES) for (const [id] of D.NODES[k].yields) ok(D.ITEMS[id], "node item " + id);
for (const r of D.RECIPES) { ok(D.ITEMS[r.id], "recipe output " + r.id); for (const id in r.in) ok(D.ITEMS[id], "recipe input " + id); }

// ---- cases from the independent review (517505e..e47ac06)
const full = (keepFree) => { const c = S.newCharacter("F", {}, t); c.inv = c.inv.map((_, i) => i < keepFree ? null : { id: "weathered", n: 50 }); return c; };
// S1: a two-yield node with one free slot must not lose an item, and events must match the bag
{
  const c = full(1);
  const ev2 = S.act(c, { t: "gather", key: "b1", species: "Prop_Boulders", region: "Hearthmeadow" }, { now: t, rng: () => 0.99 });
  ok(ev2[0].t === "error" && /full/.test(ev2[0].why), "S1: two yields into one slot refused");
  ok(S.count(c, "granite") === 0 && S.count(c, "moss") === 0, "S1: nothing half-added");
  const c2 = full(2);
  const ev3 = S.act(c2, { t: "gather", key: "b2", species: "Prop_Boulders", region: "Hearthmeadow" }, { now: t, rng: () => 0.99 });
  ok(ev3.some(e => e.t === "item"), "S1: two free slots take both yields");
  for (const e of ev3.filter(e => e.t === "item")) ok(S.count(c2, e.id) === e.n, "S1: item events equal what the bag holds: " + e.id);
}
// S2: equipping from a stack into a full bag must never destroy the equipped item
{
  const c = full(0); c.inv[0] = { id: "bow_willow", n: 2 }; c.equip.main = "staff_hazel";
  const ev2 = S.act(c, { t: "equip", slot: 0 }, { now: t });
  ok(ev2[0].t === "error", "S2: swap refused when the old weapon can't fit");
  ok(c.equip.main === "staff_hazel" && S.count(c, "bow_willow") === 2, "S2: nothing lost");
  const c3 = full(0); c3.inv[0] = { id: "bow_willow", n: 1 }; c3.equip.main = "staff_hazel";
  S.act(c3, { t: "equip", slot: 0 }, { now: t });
  ok(c3.equip.main === "bow_willow" && S.count(c3, "staff_hazel") === 1, "S2: single item swaps in place");
  const c4 = S.newCharacter("T", {}, t); c4.inv[3] = { id: "pick_stone", n: 1 }; c4.tools.stonecutting = "pick_stone";
  c4.inv[5] = { id: "pick_stone", n: 1 };
  S.act(c4, { t: "equip", slot: 5 }, { now: t });
  ok(c4.inv[5] === null && c4.inv[3].n === 2 && c4.tools.stonecutting === "pick_stone", "S2/U6: tool swap returns the old tool, takes the picked slot");
  const c5 = full(0); c5.equip.main = "staff_hazel";
  ok(S.act(c5, { t: "unequip", slot: "main" }, { now: t })[0].t === "error" && c5.equip.main === "staff_hazel", "unequip into a full bag refused");
}
// craft: consuming frees a slot -> succeeds; otherwise inputs restored exactly
{
  const c = full(0); c.inv[0] = { id: "hazel", n: 3 };
  S.act(c, { t: "craft", id: "staff_hazel" }, { now: t });
  ok(S.count(c, "staff_hazel") === 1 && S.count(c, "hazel") === 0, "craft into a slot freed by its inputs");
  const c2 = full(0); c2.inv[0] = { id: "hazel", n: 5 };
  ok(S.act(c2, { t: "craft", id: "staff_hazel" }, { now: t })[0].t === "error" && S.count(c2, "hazel") === 5, "craft refused, inputs untouched");
}
// S3/S4: hostile or malformed commands never corrupt or throw
{
  const c = S.newCharacter("H", {}, t);
  S.act(c, { t: "move", metres: "abc", jumps: NaN }, { now: t });
  S.act(c, { t: "move", metres: -50, jumps: -3 }, { now: t });
  S.act(c, { t: "move", metres: 1e9, jumps: 1e9 }, { now: t });
  ok(Number.isFinite(c.stats.metres) && c.stats.metres <= 60 && c.stats.jumps <= 6, "S3: move clamps junk");
  for (const slot of [-1, 28, "length", 1.5, null, "__proto__"]) {
    for (const tt of ["drop", "use", "equip"]) { const e = S.act(c, { t: tt, slot }, { now: t }); ok(e[0].t === "error", `S4: ${tt} slot ${String(slot)} refused`); }
    ok(c.inv.length === S.INV_SLOTS && Array.isArray(c.inv), "S4: bag intact after slot " + String(slot));
  }
  for (const sp of ["constructor", "__proto__", "toString", 42, null]) ok(S.act(c, { t: "gather", key: "k", species: sp }, { now: t })[0].t === "error", "S4: species " + String(sp) + " refused");
  ok(S.act(c, { t: "unequip" }, { now: t })[0].t === "error", "S4: unequip without slot refused");
  ok(S.act(c, { t: "unequip", slot: "tool:constructor" }, { now: t })[0].t === "error", "S4: bad tool slot refused");
  ok(S.act(c, null, { now: t })[0].t === "error", "S4: null command refused");
}
// S5: load repairs partial saves and rejects junk
{
  const c = S.newCharacter("L", {}, t);
  const partial = JSON.parse(JSON.stringify(c)); delete partial.nodes; delete partial.equip; delete partial.pos; partial.inv[0] = { id: "nope", n: 3 }; partial.skills.alchemy = "x";
  const r = S.load(JSON.stringify(partial));
  ok(r && r.nodes && r.equip && r.pos && r.inv[0] === null && r.skills.alchemy === 0, "S5: partial save repaired");
  ok(S.load("{not json") === null && S.load('{"v":99}') === null && S.load("null") === null, "S5: junk rejected");
  ok(r && S.agilityBonus(r) >= 1, "S5: repaired save is usable");
}
// S6: reach and duration checks when the caller supplies them
{
  const c = S.newCharacter("R", {}, t);
  const far = S.act(c, { t: "gather", key: "r1", species: "Field_Poppy", region: "Hearthmeadow" }, { now: t, player: { x: 0, d: 14 }, at: { x: 10, d: 14 } });
  ok(far[0].t === "error" && /far/.test(far[0].why), "S6: too far refused");
  const fast = S.act(c, { t: "gather", key: "r1", species: "Field_Poppy", region: "Hearthmeadow" }, { now: t, startedAt: t - 100 });
  ok(fast[0].t === "error", "S6: instant gather refused");
  const fine = S.act(c, { t: "gather", key: "r1", species: "Field_Poppy", region: "Hearthmeadow" }, { now: t, startedAt: t - 3000, player: { x: 0, d: 14 }, at: { x: 0.5, d: 15 } });
  ok(fine.some(e => e.t === "item"), "S6: honest gather accepted");
}
// S7: uses 3 -> 3 gathers -> refused -> respawn restores; partly used trees recover
{
  const c = S.newCharacter("U", {}, t); let tt = t;
  for (let i = 0; i < 3; i++) ok(S.act(c, { t: "gather", key: "hz", species: "Tree_Common_Hazel", region: "Hearthmeadow" }, { now: tt }).some(e => e.t === "item"), "S7: chop " + (i + 1));
  ok(S.act(c, { t: "gather", key: "hz", species: "Tree_Common_Hazel", region: "Hearthmeadow" }, { now: tt })[0].t === "error", "S7: 4th chop refused");
  tt += 151 * 1000;
  ok(S.act(c, { t: "gather", key: "hz", species: "Tree_Common_Hazel", region: "Hearthmeadow" }, { now: tt }).some(e => e.t === "item"), "S7: regrown after respawn");
  tt += 151 * 1000;
  ok(S.nodeState(c, "hz", D.NODES.Tree_Common_Hazel, tt).uses === 3, "S7: a partly used tree recovers its uses");
}
// S8/S9: agility remainder carried; level-up exactly at xpFor; capped xp reported as added
{
  const c = S.newCharacter("A", {}, t);
  for (let i = 0; i < 4; i++) S.act(c, { t: "move", metres: 3 }, { now: t });
  ok(c.skills.agility === 1 && Math.abs(c.stats.agiCarry - 4) < 1e-9, "S8: 12 m -> 1 xp, 4 m carried");
  const c2 = S.newCharacter("X", {}, t); c2.skills.herbalism = D.xpFor(2) - 8;
  const e2 = S.act(c2, { t: "gather", key: "x", species: "Field_Poppy", region: "Hearthmeadow" }, { now: t });
  ok(e2.some(e => e.t === "level" && e.level === 2), "level up exactly at xpFor(2)");
  const c3 = S.newCharacter("M", {}, t); c3.skills.herbalism = D.xpFor(D.MAX_LEVEL) - 3;
  const e3 = S.act(c3, { t: "gather", key: "m", species: "Field_Poppy", region: "Hearthmeadow" }, { now: t });
  const xe = e3.find(e => e.t === "xp");
  ok(xe && xe.xp === 3 && c3.skills.herbalism === D.xpFor(D.MAX_LEVEL), "S9: capped xp reports what was added");
}
// roomForNode: pre-check before starting a gather
ok(!S.roomForNode(full(0), D.NODES.Field_Poppy) && S.roomForNode(full(1), D.NODES.Field_Poppy), "roomForNode");


// ---- cases from the second review (366d970)
// S4: "__proto__" and other non-keys never become node state
{
  const c = S.newCharacter("P", {}, t);
  for (const key of ["__proto__", "constructor", "prototype", "", "x".repeat(65), "a b", 7, null]) {
    const e = S.act(c, { t: "gather", key, species: "Field_Poppy", region: "Hearthmeadow" }, { now: t });
    ok(e[0].t === "error", "S4b: key " + JSON.stringify(key) + " refused");
  }
  ok(Object.getPrototypeOf(c.nodes) === null && Object.keys(c.nodes).length === 0, "S4b: node map untouched, no prototype");
  const evil = JSON.parse(JSON.stringify(c)); evil.nodes = JSON.parse('{"__proto__": {"uses": 0}, "ok.key": {"uses": 1, "at": 5}}');
  const r = S.load(JSON.stringify(evil));
  ok(r && Object.getPrototypeOf(r.nodes) === null && !Object.keys(r.nodes).includes("__proto__") && r.nodes["ok.key"], "S4b: load drops __proto__ node keys");
}
// S6: with lookupNode the authority decides what a key is; forged keys and species do nothing
{
  const world = { "poppy@1": { species: "Field_Poppy", region: "Hearthmeadow", x: 0, d: 14 } };
  const lookupNode = k => world[k] || null;
  const c = S.newCharacter("W", {}, t);
  ok(S.act(c, { t: "gather", key: "made-up-1", species: "Field_Poppy" }, { now: t, lookupNode })[0].t === "error", "S6b: unknown key refused");
  ok(S.act(c, { t: "gather", key: "poppy@1", species: "Tree_English_Oak", region: "x" }, { now: t, lookupNode, player: { x: 0, d: 14 } }).some(e => e.t === "item" && e.id === "poppy"),
     "S6b: the world's species wins over the command's");
  ok(S.act(c, { t: "gather", key: "poppy@1" }, { now: t, lookupNode, player: { x: 50, d: 14 } })[0].t === "error", "S6b: reach measured from the world's position");
}
// the duration fixed at the start of an action is what's checked (a tool swap mid-gather can't waste it)
{
  const c = S.newCharacter("D", {}, t);
  const e = S.act(c, { t: "gather", key: "dd", species: "Field_Poppy", region: "Hearthmeadow" }, { now: t, startedAt: t - 1600, duration: 1.7 });
  ok(e.some(x => x.t === "item"), "duration from the start of the action is honoured");
}

// third review: a caller-supplied duration can't go below the fastest possible gather
{
  const c = S.newCharacter("Z", {}, t);
  ok(S.act(c, { t: "gather", key: "z1", species: "Field_Poppy", region: "Hearthmeadow" }, { now: t, startedAt: t, duration: 0 })[0].t === "error", "duration 0 refused");
  const fastest = D.NODES.Field_Poppy.time * 0.5 / 1.3;
  ok(S.act(c, { t: "gather", key: "z2", species: "Field_Poppy", region: "Hearthmeadow" }, { now: t, startedAt: t - fastest * 1000, duration: 0 }).some(e => e.t === "item"), "the fastest real gather still passes");
  ok(Object.getPrototypeOf(S.nodeMap()) === null, "nodeMap has no prototype");
}
console.log(fails ? `${fails} failed` : "all state checks passed");
process.exit(fails ? 1 : 0);
