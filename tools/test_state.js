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
// ---- the road, commissions, potions, curios
const give = (c, id, n) => { for (let i = 0; i < c.inv.length && n; i++) if (!c.inv[i]) { const k = Math.min(n, S.STACK); c.inv[i] = { id, n: k }; n -= k; } };
// every requirement exists, and every gate / job item is a real item
for (const g of D.GATES) for (const id of [...Object.keys(g.needs), ...g.reward.map(r => r[0])]) ok(D.ITEMS[id], "gate item exists: " + id);
for (const j of D.JOBS) ok(D.ITEMS[j.item] && D.ITEMS[j.reward[0]] && D.SKILLS[j.skill], "job well formed: " + j.id);
for (const id in D.ITEMS) if (D.ITEMS[id].kind === "potion") ok(D.EFFECTS[D.ITEMS[id].effect], "potion has an effect: " + id);
// a new character has three stage-0 commissions, all different
{
  const c = S.newCharacter("R", {}, t);
  ok(c.jobs.length === 3 && new Set(c.jobs).size === 3 && c.jobs.every(id => D.jobById(id).stage === 0), "three stage-0 jobs");
  ok(S.stage(c) === 0, "stage 0 at the start");
}
// repairs: in order, need everything, consume it, give the reward, advance the stage
{
  const c = S.newCharacter("R", {}, t);
  ok(S.act(c, { t: "repair", id: "bridge" }, { now: t })[0].why === "The road before it needs mending first", "gates in order");
  let e = S.act(c, { t: "repair", id: "trunk" }, { now: t });
  ok(e[0].t === "error" && /Still needs/.test(e[0].why) && /Hazel Rod/.test(e[0].why), "missing items listed");
  give(c, "hazel", 3); give(c, "granite", 2); give(c, "staff_hazel", 1);
  // a staff in your hand is never taken: the repair asks you to take it off first
  const slot = c.inv.findIndex(x => x && x.id === "staff_hazel");
  S.act(c, { t: "equip", slot }, { now: t });
  ok(c.equip.main === "staff_hazel" && S.owned(c, "staff_hazel") === 1, "equipped staff owned");
  const held = S.act(c, { t: "repair", id: "trunk" }, { now: t });
  ok(held[0].t === "error" && /take off the one you're using/.test(held[0].why) && c.equip.main === "staff_hazel", "equipped staff not taken");
  S.act(c, { t: "unequip", slot: "main" }, { now: t });
  ok(S.act(c, { t: "repair", id: "trunk" }, { now: t, player: { x: 0 }, lookupGate: () => ({ x: 50 }) })[0].why === "Too far away", "repair reach");
  ok(S.act(c, { t: "repair", id: "trunk" }, { now: t, startedAt: t - 500 })[0].why === "Not so fast", "repair takes time");
  e = S.act(c, { t: "repair", id: "trunk" }, { now: t, player: { x: 49 }, lookupGate: () => ({ x: 50 }), startedAt: t - 3000 });
  ok(e.some(x => x.t === "repaired" && x.id === "trunk"), "trunk mended");
  ok(S.count(c, "staff_hazel") === 0 && S.count(c, "hazel") === 0 && S.count(c, "granite") === 0, "needs consumed");
  ok(S.count(c, "draught_minor") === 4, "reward given");
  ok(S.stage(c) === 1, "stage 1");
  ok(S.act(c, { t: "repair", id: "trunk" }, { now: t })[0].why === "Already mended", "no double repair");
  // the save keeps it; a forged save can't skip ahead
  const r = S.load(JSON.stringify(c));
  ok(r.gates.trunk === true && S.stage(r) === 1, "gate state saved");
  const forged = JSON.parse(JSON.stringify(c)); forged.gates = { shrine: true, __proto__: { x: 1 }, nope: true };
  ok(S.stage(S.load(JSON.stringify(forged))) === 0, "stage counts only mended gates in order");
  forged.gates = { trunk: true, rockfall: true };
  ok(Object.keys(S.load(JSON.stringify(forged)).gates).join() === "trunk", "load keeps only gates mended in order");
}
// a full bag refuses the repair and changes nothing
{
  const c = S.newCharacter("F", {}, t);
  for (let i = 0; i < c.inv.length; i++) c.inv[i] = { id: "moss", n: S.STACK };
  c.inv[0] = { id: "hazel", n: 4 }; c.inv[1] = { id: "granite", n: 3 }; c.inv[2] = { id: "staff_hazel", n: 2 };
  const before = JSON.stringify(c);
  const e = S.act(c, { t: "repair", id: "trunk" }, { now: t });
  ok(e[0].why === "Your bag is full" && JSON.stringify(c) === before, "full bag: no repair, nothing lost");
}
// a region the road hasn't reached can't be gathered, even standing at its edge
{
  const c = S.newCharacter("G", {}, t);
  const world = { "b@1": { species: "Field_Poppy", region: "Beechwood Hollow", ri: 1, x: 0, d: 14 }, "h@1": { species: "Field_Poppy", region: "Hearthmeadow", ri: 0, x: 0, d: 14 } };
  const lookupNode = k => world[k] || null;
  ok(S.act(c, { t: "gather", key: "b@1" }, { now: t, lookupNode })[0].why === "The road there isn't open yet", "locked region refused");
  ok(S.act(c, { t: "gather", key: "h@1" }, { now: t, lookupNode }).some(x => x.t === "item"), "open region fine");
  c.gates.trunk = true;
  ok(S.act(c, { t: "gather", key: "b@1" }, { now: t, lookupNode }).some(x => x.t === "item"), "opens with the road");
}
// commissions
{
  const c = S.newCharacter("J", {}, t);
  c.jobs = ["j_poppy", "j_hazel", "j_granite"];
  ok(S.act(c, { t: "deliver", id: "j_poppy" }, { now: t })[0].why === "Needs 5 Poppy Petals", "deliver needs items");
  // a tool in use is never handed over
  const cq = S.newCharacter("K", {}, t); cq.jobs = ["j_pick", "j_hazel", "j_granite"]; cq.tools.stonecutting = "pick_stone";
  ok(S.act(cq, { t: "deliver", id: "j_pick" }, { now: t })[0].why === "Take off your Stone Pick first" && cq.tools.stonecutting === "pick_stone", "equipped tool not delivered");
  ok(S.act(c, { t: "deliver", id: "j_wheat" }, { now: t })[0].t === "error", "only open jobs");
  ok(S.act(c, { t: "deliver", id: "__proto__" }, { now: t })[0].t === "error", "junk job id refused");
  give(c, "poppy", 7);
  const e = S.act(c, { t: "deliver", id: "j_poppy" }, { now: t, rng: () => 0.5 });
  ok(e.some(x => x.t === "delivered") && S.count(c, "poppy") === 2, "delivered and taken");
  ok(c.skills.herbalism === 60, "job xp");
  ok(c.jobs.length === 3 && !c.jobs.includes("j_poppy") && new Set(c.jobs).size === 3, "a new job replaces it");
  ok(c.stats.jobs === 1, "jobs counted");
  const forged = JSON.parse(JSON.stringify(c)); forged.jobs = ["j_elixir", "j_poppy", "j_poppy", "zzz", 5];
  const r = S.load(JSON.stringify(forged));
  ok(!r.jobs.includes("j_elixir") && r.jobs.length === 3 && new Set(r.jobs).size === 3, "load drops jobs beyond the stage and duplicates");
}
// potions
{
  const c = S.newCharacter("P", {}, t);
  const slot = c.inv.findIndex(x => x && x.id === "draught_minor");
  const e = S.act(c, { t: "use", slot }, { now: t });
  ok(e[0].t === "used" && e[0].effect === "deft" && e[0].until === t + 120000, "draught gives deft hands");
  const node = D.NODES.Field_Poppy;
  ok(Math.abs(S.gatherTime(c, node, t + 1000) - node.time / 1.15) < 1e-9, "gathers 15% faster");
  ok(S.gatherTime(c, node, t + 121000) === node.time, "and wears off");
  ok(S.gatherTime(c, node) === node.time, "no time given: no potion");
  give(c, "poultice_cotton", 1);
  S.act(c, { t: "use", slot: c.inv.findIndex(x => x && x.id === "poultice_cotton") }, { now: t });
  S.act(c, { t: "gather", key: "pp", species: "Field_Poppy", region: "Hearthmeadow" }, { now: t + 10, rng: () => 0.99 });
  ok(c.skills.herbalism === 16, "double xp");
  give(c, "elixir_heather", 1);
  S.act(c, { t: "use", slot: c.inv.findIndex(x => x && x.id === "elixir_heather") }, { now: t });
  ok(Math.abs(S.agilityBonus(c, t + 5) - 1.2) < 1e-9 && S.agilityBonus(c, t + 400000) === 1, "light stride");
  const forged = JSON.parse(JSON.stringify(c)); forged.buffs = { deft: "x", bogus: 9e14, constructor: 5 };
  const r = S.load(JSON.stringify(forged));
  ok(Object.keys(r.buffs).join() === "deft" && r.buffs.deft === 0, "load keeps only real effects");
  // the fastest gather is still bounded with the best tool and the best potion
  const c2 = S.newCharacter("Q", {}, t);
  ok(S.act(c2, { t: "gather", key: "q1", species: "Field_Poppy", region: "Hearthmeadow" }, { now: t, startedAt: t, duration: 0 })[0].why === "Not so fast", "zero duration still refused");
  // without a potion the floor is the tool's alone (a claimed potion-speed gather is refused)
  const fast = D.NODES.Field_Poppy.time * 0.5 / (1.3 * 1.4);
  ok(S.act(c2, { t: "gather", key: "q2", species: "Field_Poppy", region: "Hearthmeadow" }, { now: t, startedAt: t - fast * 1000, duration: 0 })[0].why === "Not so fast", "no potion: no potion speed");
  // a potion that ran out during the gather still counts
  c2.buffs.hale = t - 10;
  ok(S.act(c2, { t: "gather", key: "q3", species: "Field_Poppy", region: "Hearthmeadow" }, { now: t, startedAt: t - 2000, duration: 0 }).some(x => x.t === "item"), "potion at the start counts");
  // a forged far-future potion does nothing
  const c3 = S.newCharacter("Z", {}, t); c3.buffs.hale = t + 1e12;
  ok(S.gatherTime(c3, D.NODES.Field_Poppy, t) === D.NODES.Field_Poppy.time, "forged potion end ignored");
}
// curios: found in the node's region, never twice, all of them findable
{
  const c = S.newCharacter("C", {}, t);
  let found = [];
  for (let i = 0; i < 40; i++) {
    const e = S.act(c, { t: "gather", key: "cu" + i, species: "Field_Poppy", region: "Hearthmeadow" }, { now: t, rng: () => 0.001 });
    found.push(...e.filter(x => x.t === "curio").map(x => x.id));
  }
  ok(found.length === 2 && new Set(found).size === 2 && found.every(id => D.CURIOS.find(x => x.id === id).region === "Hearthmeadow"), "two Hearthmeadow curios, once each");
  const none = S.act(c, { t: "gather", key: "cux", species: "Field_Poppy", region: "Hearthmeadow" }, { now: t, rng: () => 0.001 });
  ok(!none.some(x => x.t === "curio"), "none left there");
  const r = S.load(JSON.stringify({ ...JSON.parse(JSON.stringify(c)), curios: ["c_button", "c_button", "fake", 3] }));
  ok(r.curios.join() === "c_button", "load cleans curios");
}
console.log(fails ? `${fails} failed` : "all state checks passed");
process.exit(fails ? 1 : 0);
