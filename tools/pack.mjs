// Pack a world bake into the distribution file: node tools/pack.mjs [bake_dir] [out.rtp]
// Reads bake/raw.bin + bake/raw.json (written by tools/bake_world.py: raw RGBA sprite strips) and
// bake/data/{world,catalog}.json, writes docs/data/world.rtp with docs/js/rtpack.js.
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RTPack = createRequire(import.meta.url)(path.join(root, "docs", "js", "rtpack.js"));
const bake = process.argv[2] || path.join(root, "bake");
const dst = process.argv[3] || path.join(root, "docs", "data", "world.rtp");
const t0 = Date.now();
const world = JSON.parse(fs.readFileSync(path.join(bake, "data", "world.json")));
const catalog = JSON.parse(fs.readFileSync(path.join(bake, "data", "catalog.json")));
const index = JSON.parse(fs.readFileSync(path.join(bake, "raw.json")));
const raw = fs.readFileSync(path.join(bake, "raw.bin"));
const sprites = Object.entries(index).map(([file, [off, w, h]]) => ({ file, w, h, strip: raw.subarray(off, off + w * 4 * h * 4) }));
const out = RTPack.encodeFile({ world, catalog }, sprites);
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, out);
// verify: every sprite decodes to exactly its quantized form
const f = RTPack.openFile(out);
let bad = 0;
for (const s of sprites) {
  const want = RTPack.planesToStrip(RTPack.stripToPlanes(s.strip, s.w, s.h), s.w, s.h);
  const got = f.sprite(s.file).strip;
  if (got.length !== want.length || got.some((v, i) => v !== want[i])) { bad++; console.error("MISMATCH", s.file); }
}
if (bad) process.exit(1);
console.log(`packed ${sprites.length} sprites: ${(raw.length / 1e6).toFixed(1)} MB raw -> ${(out.length / 1e6).toFixed(2)} MB ${dst} ` +
  `(round trip exact, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
