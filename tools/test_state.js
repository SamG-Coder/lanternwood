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
console.log(fails ? `${fails} failed` : "all state checks passed");
process.exit(fails ? 1 : 0);
