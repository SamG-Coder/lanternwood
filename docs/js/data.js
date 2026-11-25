// Lanternwood game data: skills, gathering nodes, items and recipes. Plain data, no DOM: the same
// file runs in the browser and (later) on the MMO gateway, which will be the authority.
(function (root) {
"use strict";

// ---------------------------------------------------------------- skills (classless: everything levels by use)
const SKILLS = {
  herbalism:   { name: "Herbalism",   kind: "gathering", color: "#8fc46a", verb: "Gather" },
  forestry:    { name: "Forestry",    kind: "gathering", color: "#c49a5a", verb: "Chop" },
  stonecutting:{ name: "Stonecutting",kind: "gathering", color: "#a9b0b8", verb: "Quarry" },
  alchemy:     { name: "Alchemy",     kind: "crafting",  color: "#c784d6" },
  woodworking: { name: "Woodworking", kind: "crafting",  color: "#d6a86a" },
  masonry:     { name: "Masonry",     kind: "crafting",  color: "#9fb4c9" },
  agility:     { name: "Agility",     kind: "body",      color: "#e8d27a" },
};
const MAX_LEVEL = 50;
// xp needed to reach a level (level 2 = 40, 10 = 1,650, 25 = 12,800, 50 = 59,700)
function xpFor(level) { const n = Math.max(0, level - 1); return Math.round(32 * n + 11 * Math.pow(n, 2.1)); }
function levelOf(xp) { let l = 1; while (l < MAX_LEVEL && xp >= xpFor(l + 1)) l++; return l; }

// ---------------------------------------------------------------- items
// kind: resource | potion | weapon | tool | gear | material. icon: [shape, colour, colour2]
const ITEMS = {
  // herbs
  poppy:        { name: "Poppy Petals",      kind: "resource", icon: ["petals", "#d8463a", "#3c6a2a"], desc: "Bright and papery; sleepy when steeped." },
  dandelion:    { name: "Dandelion",         kind: "resource", icon: ["flower", "#f0c93a", "#4f7a2c"], desc: "Bitter leaves, golden head. Mends small hurts." },
  wheat:        { name: "Wild Wheat",        kind: "resource", icon: ["stalk", "#d9bf6a", "#a68a3a"], desc: "Thin stalks that twist into cord." },
  bracken:      { name: "Bracken Frond",     kind: "resource", icon: ["frond", "#5f8f3a", "#3f6a26"], desc: "Tough fern fronds from the wood floor." },
  bilberry:     { name: "Bilberries",        kind: "resource", icon: ["berries", "#3b4f9a", "#4a7a32"], desc: "Small and dark; they stain your fingers." },
  anemone:      { name: "Wood Anemone",      kind: "resource", icon: ["flower", "#f2f0ea", "#56803a"], desc: "A white star that grows where beeches shade." },
  heather:      { name: "Heather Sprig",     kind: "resource", icon: ["sprig", "#b66ab8", "#4c6a34"], desc: "Purple, wiry, smells of the high ground." },
  marram:       { name: "Marram Fibre",      kind: "resource", icon: ["stalk", "#b8b27a", "#7d7a4a"], desc: "Wind-dried grass, strong when spun." },
  cotton:       { name: "Cotton Tuft",       kind: "resource", icon: ["tuft", "#f4f2ec", "#6a7a4a"], desc: "Soft white heads from wet meadows." },
  reed:         { name: "Reed Stalk",        kind: "resource", icon: ["stalk", "#9aa25a", "#6a7040"], desc: "Hollow and straight." },
  leatherfern:  { name: "Leather Fern",      kind: "resource", icon: ["frond", "#3f7a3a", "#2a5428"], desc: "Glossy, waxy fronds. Rare on this road." },
  // wood
  brushwood:    { name: "Brushwood",         kind: "resource", icon: ["sticks", "#7a6048", "#5a4434"], desc: "Dry twigs and dead shrub." },
  weathered:    { name: "Weathered Wood",    kind: "resource", icon: ["log", "#8a7458", "#6a5a44"], desc: "Grey timber from a fallen trunk." },
  hazel:        { name: "Hazel Rod",         kind: "resource", icon: ["rod", "#9a7a52", "#6e5434"], desc: "Straight and springy coppice wood." },
  elder:        { name: "Elder Wood",        kind: "resource", icon: ["log", "#b39a72", "#7e6a4a"], desc: "Light with a soft pith." },
  spindle:      { name: "Spindle Wood",      kind: "resource", icon: ["rod", "#d8c69a", "#a8945e"], desc: "Pale, dense, made for fine work." },
  willow:       { name: "Willow Wood",       kind: "resource", icon: ["log", "#c2a874", "#8a7448"], desc: "Bends without breaking." },
  greasewood:   { name: "Greasewood",        kind: "resource", icon: ["sticks", "#9a8a5a", "#6a5e3c"], desc: "Oily scrub that burns hot." },
  alder:        { name: "Alder Wood",        kind: "resource", icon: ["log", "#b0644a", "#7a4430"], desc: "Turns orange when cut." },
  aspen:        { name: "Aspen Wood",        kind: "resource", icon: ["log", "#d6cfb8", "#9e9680"], desc: "Light and pale." },
  birch:        { name: "Birch Wood",        kind: "resource", icon: ["log", "#e8e2d4", "#3a3a3a"], desc: "White bark, close grain." },
  rowan:        { name: "Rowan Wood",        kind: "resource", icon: ["log", "#a87a5a", "#74523a"], desc: "Old folk say it wards off ill luck." },
  spruce:       { name: "Spruce Wood",       kind: "resource", icon: ["log", "#c6a070", "#8a6a44"], desc: "Resinous and resonant." },
  charred:      { name: "Charred Wood",      kind: "resource", icon: ["log", "#3e3632", "#1e1a18"], desc: "Burnt through and hard as horn." },
  poplar:       { name: "Poplar Wood",       kind: "resource", icon: ["log", "#cfc09a", "#968860"], desc: "Tall trees, plain timber." },
  beech:        { name: "Beech Wood",        kind: "resource", icon: ["log", "#c79a6a", "#8e6a46"], desc: "Hard and even. Good for bows." },
  pine:         { name: "Pine Wood",         kind: "resource", icon: ["log", "#d0a46a", "#946e40"], desc: "Knotty, sweet-smelling." },
  maple:        { name: "Maple Wood",        kind: "resource", icon: ["log", "#d8b48a", "#9a7a56"], desc: "Fine-figured hardwood." },
  oak:          { name: "Oak Wood",          kind: "resource", icon: ["log", "#9a7448", "#6a4e30"], desc: "The strongest wood on the road." },
  aleppo:       { name: "Aleppo Pine",       kind: "resource", icon: ["log", "#c48a5a", "#8a5e3a"], desc: "Sun-hardened, from the southern terraces." },
  // stone
  granite:      { name: "Granite Chunk",     kind: "resource", icon: ["rock", "#8a8f96", "#5e636a"], desc: "Grey stone, flecked and heavy." },
  moss:         { name: "Rock Moss",         kind: "resource", icon: ["tuft", "#6a8a3a", "#4a6a2a"], desc: "Peeled from old boulders." },
  sandstone:    { name: "Sandstone",         kind: "resource", icon: ["rock", "#c8a070", "#9a7a50"], desc: "Warm, soft, easy to carve." },
  // alchemy
  draught_minor:  { name: "Minor Healing Draught", kind: "potion", icon: ["flask", "#d0533f", "#e8dcc4"], desc: "Restores a little health." },
  tonic_poppy:    { name: "Poppy Tonic",           kind: "potion", icon: ["flask", "#c03a5a", "#e8dcc4"], desc: "A calm, deep sleep." },
  salve_fern:     { name: "Fernsalve",             kind: "potion", icon: ["jar", "#5f8f3a", "#d8c8a0"], desc: "Soothes cuts and stings." },
  elixir_heather: { name: "Heathermist Elixir",    kind: "potion", icon: ["flask", "#a65ab8", "#e8dcc4"], desc: "Clears the head; a stride lighter." },
  poultice_cotton:{ name: "Cotton Poultice",       kind: "potion", icon: ["jar", "#e8e4d8", "#9a8a6a"], desc: "Binds and heals." },
  draught_greater:{ name: "Greater Healing Draught", kind: "potion", icon: ["flask", "#e04a3a", "#f0d890"], desc: "Restores a great deal of health." },
  // woodworking
  kindling:     { name: "Bundle of Kindling",  kind: "material", icon: ["sticks", "#b0884a", "#e0a040"], desc: "For campfires and forges." },
  cord:         { name: "Twisted Cord",        kind: "material", icon: ["cord", "#d0b880", "#9a8450"], desc: "Wheat stalks twisted tight. A bowstring." },
  staff_hazel:  { name: "Hazel Walking Staff", kind: "weapon", slot: "main", style: "staff", power: 3, icon: ["staff", "#9a7a52", "#d8b86a"], desc: "A traveller's staff. Light and quick." },
  bow_willow:   { name: "Willow Shortbow",     kind: "weapon", slot: "main", style: "bow", power: 5, icon: ["bow", "#c2a874", "#e8dcc4"], desc: "A short, forgiving bow." },
  shield_birch: { name: "Birch Buckler",       kind: "weapon", slot: "off", style: "shield", power: 4, icon: ["shield", "#e8e2d4", "#6a5a44"], desc: "A round white buckler." },
  hatchet_birch:{ name: "Birch Hatchet",       kind: "tool", tool: "forestry", speed: 1.3, icon: ["axe", "#e8e2d4", "#8a8f96"], desc: "Chops faster than your worn hatchet." },
  bow_beech:    { name: "Beech Longbow",       kind: "weapon", slot: "main", style: "bow", power: 11, icon: ["bow", "#c79a6a", "#e8dcc4"], desc: "Tall and powerful." },
  staff_oak:    { name: "Oak Warden Staff",    kind: "weapon", slot: "main", style: "staff", power: 14, icon: ["staff", "#9a7448", "#8a8f96"], desc: "Iron-hard oak capped with granite." },
  // masonry
  whetstone:    { name: "Whetstone",           kind: "material", icon: ["rock", "#9aa0a8", "#c0c6cc"], desc: "Keeps an edge keen." },
  pick_stone:   { name: "Stone Pick",          kind: "tool", tool: "stonecutting", speed: 1.3, icon: ["pick", "#9a7a52", "#8a8f96"], desc: "Quarries faster than your worn pick." },
  hammer_stone: { name: "Stone Maul",          kind: "weapon", slot: "main", style: "maul", power: 8, icon: ["hammer", "#b0644a", "#8a8f96"], desc: "Heavy and slow." },
  waystone:     { name: "Carved Waystone",     kind: "gear", slot: "trinket", agility: 0.04, icon: ["rune", "#8a8f96", "#d9b56a"], desc: "A palm-sized waystone. You stride a little lighter." },
  sandblock:    { name: "Sandstone Block",     kind: "material", icon: ["block", "#c8a070", "#9a7a50"], desc: "Squared and smooth." },
  grindstone:   { name: "Grindstone",          kind: "material", icon: ["wheel", "#c8a070", "#9a7448"], desc: "Turns on an oak axle." },
};

// ---------------------------------------------------------------- gathering nodes, keyed by species
// req: skill level needed; xp per gather; time: seconds at the required level; yields [item, min, max];
// uses: gathers before the node is spent; respawn: seconds; deplete: hide the plant while spent
const NODES = {
  Field_Poppy:            { skill: "herbalism", req: 1,  xp: 8,  time: 2.2, yields: [["poppy", 1, 2]], uses: 1, respawn: 90, deplete: true },
  Leafy_Dandelions:       { skill: "herbalism", req: 1,  xp: 8,  time: 2.2, yields: [["dandelion", 1, 2]], uses: 1, respawn: 90, deplete: true },
  Wheat_Grass:            { skill: "herbalism", req: 4,  xp: 12, time: 2.4, yields: [["wheat", 2, 3]], uses: 1, respawn: 100, deplete: true },
  Plant_Bracken_Fern:     { skill: "herbalism", req: 6,  xp: 14, time: 2.6, yields: [["bracken", 1, 2]], uses: 1, respawn: 110, deplete: true },
  Plant_Bilberry:         { skill: "herbalism", req: 9,  xp: 18, time: 2.8, yields: [["bilberry", 1, 3]], uses: 1, respawn: 120, deplete: true },
  Plant_Wood_Anemone:     { skill: "herbalism", req: 13, xp: 24, time: 3.0, yields: [["anemone", 1, 2]], uses: 1, respawn: 140, deplete: true },
  Shrub_Heather:          { skill: "herbalism", req: 17, xp: 30, time: 3.2, yields: [["heather", 1, 2]], uses: 1, respawn: 150, deplete: true },
  Marram_Grass:           { skill: "herbalism", req: 19, xp: 32, time: 3.2, yields: [["marram", 1, 3]], uses: 1, respawn: 150, deplete: true },
  Cotton_Grass:           { skill: "herbalism", req: 22, xp: 38, time: 3.4, yields: [["cotton", 1, 2]], uses: 1, respawn: 170, deplete: true },
  Giant_Reed:             { skill: "herbalism", req: 26, xp: 44, time: 3.6, yields: [["reed", 1, 2]], uses: 1, respawn: 180, deplete: true },
  Plant_Leather_Fern:     { skill: "herbalism", req: 32, xp: 60, time: 4.0, yields: [["leatherfern", 1, 1]], uses: 1, respawn: 240, deplete: true },
  Shrub_Dead_Shrubs_A:    { skill: "forestry", req: 1,  xp: 7,  time: 2.4, yields: [["brushwood", 1, 2]], uses: 1, respawn: 100, deplete: true },
  Shrub_Dead_Shrubs_B:    { skill: "forestry", req: 1,  xp: 7,  time: 2.4, yields: [["brushwood", 1, 2]], uses: 1, respawn: 100, deplete: true },
  Prop_Logs:              { skill: "forestry", req: 1,  xp: 12, time: 3.0, yields: [["weathered", 2, 3]], uses: 2, respawn: 240, deplete: true },
  Tree_Common_Hazel:      { skill: "forestry", req: 1,  xp: 10, time: 2.8, yields: [["hazel", 1, 2]], uses: 3, respawn: 150 },
  Tree_Elder:             { skill: "forestry", req: 5,  xp: 14, time: 3.0, yields: [["elder", 1, 2]], uses: 3, respawn: 150 },
  Shrub_European_Spindle: { skill: "forestry", req: 8,  xp: 17, time: 3.0, yields: [["spindle", 1, 1]], uses: 2, respawn: 160 },
  Tree_Goat_Willow:       { skill: "forestry", req: 8,  xp: 18, time: 3.2, yields: [["willow", 1, 2]], uses: 4, respawn: 180 },
  Shrub_Greasewood:       { skill: "forestry", req: 12, xp: 22, time: 3.0, yields: [["greasewood", 1, 2]], uses: 2, respawn: 160 },
  Tree_Black_Alder:       { skill: "forestry", req: 10, xp: 22, time: 3.4, yields: [["alder", 1, 2]], uses: 4, respawn: 180 },
  Tree_European_Aspen:    { skill: "forestry", req: 12, xp: 25, time: 3.4, yields: [["aspen", 1, 2]], uses: 4, respawn: 180 },
  Tree_Silver_Birch:      { skill: "forestry", req: 14, xp: 28, time: 3.6, yields: [["birch", 1, 2]], uses: 4, respawn: 200 },
  Tree_Rowan:             { skill: "forestry", req: 16, xp: 31, time: 3.6, yields: [["rowan", 1, 2]], uses: 3, respawn: 200 },
  Tree_Norway_Spruce:     { skill: "forestry", req: 18, xp: 34, time: 3.8, yields: [["spruce", 1, 2]], uses: 5, respawn: 220 },
  Tree_Black_Poplar:      { skill: "forestry", req: 20, xp: 37, time: 3.8, yields: [["poplar", 1, 2]], uses: 5, respawn: 220 },
  Tree_Dead_Pine:         { skill: "forestry", req: 22, xp: 40, time: 3.8, yields: [["charred", 1, 2]], uses: 3, respawn: 240 },
  Prop_Snags:             { skill: "forestry", req: 22, xp: 40, time: 3.8, yields: [["charred", 1, 2]], uses: 2, respawn: 240 },
  Tree_European_Beech:    { skill: "forestry", req: 24, xp: 46, time: 4.0, yields: [["beech", 1, 2]], uses: 5, respawn: 240 },
  Tree_Baltic_Pine:       { skill: "forestry", req: 26, xp: 50, time: 4.0, yields: [["pine", 1, 2]], uses: 5, respawn: 240 },
  Tree_Norway_Maple:      { skill: "forestry", req: 28, xp: 55, time: 4.2, yields: [["maple", 1, 2]], uses: 5, respawn: 260 },
  Tree_English_Oak:       { skill: "forestry", req: 32, xp: 64, time: 4.4, yields: [["oak", 1, 2]], uses: 5, respawn: 280 },
  Tree_Aleppo_Pine:       { skill: "forestry", req: 36, xp: 72, time: 4.4, yields: [["aleppo", 1, 2]], uses: 5, respawn: 300 },
  Prop_Boulders:          { skill: "stonecutting", req: 1,  xp: 11, time: 3.0, yields: [["granite", 1, 2], ["moss", 0, 1]], uses: 3, respawn: 240, deplete: true },
};
// the same species can be a different node in another region (warm sandstone boulders in the south)
const REGION_NODES = {
  "Sunterrace Pines": {
    Prop_Boulders: { skill: "stonecutting", req: 15, xp: 30, time: 3.6, yields: [["sandstone", 1, 2]], uses: 3, respawn: 260, deplete: true },
  },
};
function nodeFor(species, region) { return (REGION_NODES[region] && REGION_NODES[region][species]) || NODES[species] || null; }

// ---------------------------------------------------------------- recipes
const RECIPES = [
  { id: "draught_minor",   skill: "alchemy", req: 1,  xp: 16,  time: 2.0, in: { dandelion: 2, bilberry: 1 } },
  { id: "tonic_poppy",     skill: "alchemy", req: 3,  xp: 20,  time: 2.0, in: { poppy: 3 } },
  { id: "salve_fern",      skill: "alchemy", req: 12, xp: 42,  time: 2.4, in: { bracken: 2, anemone: 1 } },
  { id: "elixir_heather",  skill: "alchemy", req: 17, xp: 56,  time: 2.6, in: { heather: 2, bilberry: 2 } },
  { id: "poultice_cotton", skill: "alchemy", req: 22, xp: 68,  time: 2.8, in: { cotton: 2, bracken: 1 } },
  { id: "draught_greater", skill: "alchemy", req: 32, xp: 100, time: 3.2, in: { leatherfern: 1, dandelion: 2, reed: 1 } },
  { id: "kindling",        skill: "woodworking", req: 1,  xp: 9,   time: 1.6, in: { brushwood: 3 } },
  { id: "staff_hazel",     skill: "woodworking", req: 1,  xp: 18,  time: 2.4, in: { hazel: 3 } },
  { id: "cord",            skill: "woodworking", req: 4,  xp: 12,  time: 1.8, in: { wheat: 3 } },
  { id: "bow_willow",      skill: "woodworking", req: 9,  xp: 46,  time: 3.0, in: { willow: 4, cord: 1 } },
  { id: "shield_birch",    skill: "woodworking", req: 15, xp: 62,  time: 3.2, in: { birch: 6 } },
  { id: "hatchet_birch",   skill: "woodworking", req: 16, xp: 66,  time: 3.2, in: { birch: 2, granite: 2, cord: 1 } },
  { id: "bow_beech",       skill: "woodworking", req: 25, xp: 112, time: 3.6, in: { beech: 6, cord: 2 } },
  { id: "staff_oak",       skill: "woodworking", req: 33, xp: 150, time: 4.0, in: { oak: 6, granite: 2 } },
  { id: "whetstone",       skill: "masonry", req: 1,  xp: 14,  time: 2.0, in: { granite: 2 } },
  { id: "pick_stone",      skill: "masonry", req: 4,  xp: 30,  time: 2.6, in: { granite: 3, hazel: 1 } },
  { id: "hammer_stone",    skill: "masonry", req: 10, xp: 52,  time: 3.0, in: { granite: 4, alder: 2 } },
  { id: "sandblock",       skill: "masonry", req: 15, xp: 58,  time: 3.0, in: { sandstone: 3 } },
  { id: "waystone",        skill: "masonry", req: 18, xp: 78,  time: 3.4, in: { granite: 5, moss: 2 } },
  { id: "grindstone",      skill: "masonry", req: 30, xp: 138, time: 4.0, in: { sandblock: 3, oak: 2 } },
];

// what everyone starts with: worn tools (gathering always works, upgrades go faster)
const START = { tools: { herbalism: 1.0, forestry: 1.0, stonecutting: 1.0 }, inv: [["draught_minor", 2]] };

const api = { SKILLS, MAX_LEVEL, xpFor, levelOf, ITEMS, NODES, REGION_NODES, nodeFor, RECIPES, START };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.LWData = api;
})(typeof self !== "undefined" ? self : this);
