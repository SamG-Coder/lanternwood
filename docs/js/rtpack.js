// RTPack: the distribution format of RayTraced2d worlds (.rtp). One codec for both directions:
// tools/pack.mjs encodes with it (Node), the game decodes with it (browser / worker). The coding
// walk is written once (codeSprite, codeBytes) and run with an encoder or a decoder, so the two
// sides cannot drift apart.
//
// File:   "RTPK" | u8 version | u8 0 | u16 0 | u32 header bytes | header | sprite blocks
// Header: u32 json length | codeBytes(JSON {world, catalog, sprites: {file: [offset, length, w, h, leaf]}})
// Block:  one sprite, range coded on its own (decodable alone, in any order).
//
// A sprite is a strip of 4 maps (w x h each): albedo+alpha | normal+spread | depths, ao, sky | coverage, leaf.
// Coded: the alpha mask (context-modelled bits), then for every pixel inside it these channels,
// predicted from the left / upper neighbours (median edge predictor) with only the error coded:
//   G, R-G, B-G (8 bit) | normal x, y (8; z is rebuilt) | spread (6) | front, back depth (7) |
//   ao, sky (6) | coverage (6) | leaf (1 bit, unless the sprite is all leaf or all solid)
(function (root) {
"use strict";

// ---------------------------------------------------------------- binary range coder (LZMA style)
const TOP = 16777216, BITS = 11, ONE = 1 << BITS, MOVE = 5;
class Encoder {
  constructor() { this.low = 0; this.range = 0xFFFFFFFF; this.cache = 0; this.cacheSize = 1; this.out = []; }
  shiftLow() {
    if (this.low < 0xFF000000 || this.low >= 4294967296) {
      const carry = this.low >= 4294967296 ? 1 : 0;
      let temp = this.cache;
      do { this.out.push((temp + carry) & 0xFF); temp = 0xFF; } while (--this.cacheSize !== 0);
      this.cache = Math.floor(this.low / TOP) & 0xFF;
    }
    this.cacheSize++;
    this.low = (this.low % TOP) * 256;
  }
  bit(probs, i, b) {
    const p = probs[i], bound = (this.range >>> BITS) * p;
    if (!b) { this.range = bound; probs[i] = p + ((ONE - p) >> MOVE); }
    else { this.low += bound; this.range -= bound; probs[i] = p - (p >> MOVE); }
    while (this.range < TOP) { this.range = (this.range * 256) >>> 0; this.shiftLow(); }
    return b;
  }
  finish() { for (let i = 0; i < 5; i++) this.shiftLow(); return Uint8Array.from(this.out); }
}
class Decoder {
  constructor(buf, pos) {
    this.buf = buf; this.pos = pos; this.range = 0xFFFFFFFF; this.code = 0;
    for (let i = 0; i < 5; i++) this.code = ((this.code * 256) + this.next()) >>> 0;
  }
  next() { return this.pos < this.buf.length ? this.buf[this.pos++] : 0; }
  bit(probs, i) {
    const p = probs[i], bound = (this.range >>> BITS) * p;
    let b;
    if (this.code < bound) { this.range = bound; probs[i] = p + ((ONE - p) >> MOVE); b = 0; }
    else { this.code -= bound; this.range -= bound; probs[i] = p - (p >> MOVE); b = 1; }
    while (this.range < TOP) { this.range = (this.range * 256) >>> 0; this.code = ((this.code * 256) + this.next()) >>> 0; }
    return b;
  }
}
const probs = n => new Uint16Array(n).fill(ONE >> 1);

// ---------------------------------------------------------------- bytes (order-1 context bit tree)
function codeBytes(io, data, n) {
  const p = probs(256 * 256);
  const out = data || new Uint8Array(n);
  let prev = 0;
  for (let k = 0; k < n; k++) {
    let node = 1;
    const v = data ? data[k] : 0;
    for (let i = 7; i >= 0; i--) node = node * 2 + io.bit(p, prev * 256 + node, (v >> i) & 1);
    out[k] = node - 256; prev = out[k];
  }
  return out;
}

// ---------------------------------------------------------------- integers (adaptive Elias-gamma)
// u >= 0: its bit length through a 4-level tree, then the bits under the top bit, each with its
// own adaptive probability per (context, length, position).
class IntModel {
  constructor(ctxs) { this.len = probs(ctxs * 16); this.man = probs(ctxs * 9 * 8); }
}
function codeInt(io, m, ctx, u) {
  let nb = 0;
  if (u !== null) { let t = u; while (t) { nb++; t >>= 1; } }
  let node = 1;
  for (let i = 3; i >= 0; i--) node = node * 2 + io.bit(m.len, ctx * 16 + node, (nb >> i) & 1);
  nb = node - 16;
  if (nb <= 1) return nb;
  let v = 1;
  for (let i = nb - 2; i >= 0; i--) v = v * 2 + io.bit(m.man, (ctx * 9 + nb) * 8 + i, u !== null ? (u >> i) & 1 : 0);
  return v;
}

// ---------------------------------------------------------------- sprite model
// channel: [map, rgba index, bits]; colour channels are coded as G, R-G, B-G
const CH = [
  [0, 1, 8], [0, 0, 8], [0, 2, 8],          // G, R-G, B-G
  [1, 0, 8], [1, 1, 8], [1, 3, 6],          // normal x, y, spread
  [2, 0, 7], [2, 1, 7], [2, 2, 6], [2, 3, 6], // front, back depth, ao, sky
  [3, 0, 6],                                // coverage
];
const NCH = CH.length, ACT = 6, PREV = 3, CTX = ACT * PREV;
const actBucket = g => g === 0 ? 0 : g < 3 ? 1 : g < 7 ? 2 : g < 15 ? 3 : g < 31 ? 4 : 5;
const prevBucket = u => u === 0 ? 0 : u < 4 ? 1 : 2;

// planes: NCH Int16Array(w*h) of quantized values (colour already as G, R-G mod 256, B-G mod 256)
// mask: Uint8Array(w*h); leaf: Uint8Array(w*h) (0/1); leafMode 0 all solid, 1 all leaf, 2 per pixel
function codeSprite(io, w, h, mask, planes, leaf, leafMode) {
  const enc = planes !== null;
  const N = w * h;
  if (!enc) { mask = new Uint8Array(N); leaf = new Uint8Array(N); planes = []; for (let c = 0; c < NCH; c++) planes.push(new Int16Array(N)); }
  // mask: context = left, up, up-left, up-right
  const pm = probs(16);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const l = x > 0 ? mask[i - 1] : 0, u = y > 0 ? mask[i - w] : 0;
    const ul = x > 0 && y > 0 ? mask[i - w - 1] : 0, ur = x < w - 1 && y > 0 ? mask[i - w + 1] : 0;
    mask[i] = io.bit(pm, l | (u << 1) | (ul << 2) | (ur << 3), enc ? mask[i] : 0);
  }
  const models = CH.map(() => new IntModel(CTX));
  const pl = probs(9);   // leaf context: (none | left 0 | left 1) + 3 * (none | up 0 | up 1)
  const last = new Int16Array(NCH);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!mask[i]) continue;
    const hasL = x > 0 && mask[i - 1], hasU = y > 0 && mask[i - w], hasUL = hasL && hasU && mask[i - w - 1];
    let prevU = 0;
    for (let c = 0; c < NCH; c++) {
      const bits = CH[c][2], size = 1 << bits, P = planes[c];
      const wrap = c === 1 || c === 2;   // colour differences live mod 256
      let pred, act;
      if (hasL && hasU) {
        const a = P[i - 1], b = P[i - w], cc = hasUL ? P[i - w - 1] : (a + b) >> 1;
        pred = cc >= Math.max(a, b) ? Math.min(a, b) : cc <= Math.min(a, b) ? Math.max(a, b) : a + b - cc;
        act = Math.abs(a - cc) + Math.abs(b - cc);
      } else if (hasL) { pred = P[i - 1]; act = 8; }
      else if (hasU) { pred = P[i - w]; act = 8; }
      else { pred = last[c]; act = 31; }
      if (wrap) act = Math.min(act, 255);
      const ctx = actBucket(act) * PREV + prevBucket(prevU);
      let zz = null;
      if (enc) {
        let r = (P[i] - pred) & (size - 1);
        if (r >= size / 2) r -= size;
        zz = r >= 0 ? 2 * r : -2 * r - 1;
      }
      zz = codeInt(io, models[c], ctx, zz);
      if (!enc) {
        const r = zz & 1 ? -((zz + 1) >> 1) : zz >> 1;
        P[i] = (pred + r) & (size - 1);
      }
      last[c] = P[i];
      prevU = zz;
    }
    if (leafMode === 2) {
      const lc = (hasL ? 1 + leaf[i - 1] : 0) + (hasU ? 3 * (1 + leaf[i - w]) : 0);
      leaf[i] = io.bit(pl, lc, enc ? leaf[i] : 0);
    } else leaf[i] = leafMode;
  }
  return { mask, planes, leaf };
}

// ---------------------------------------------------------------- strip <-> planes
// strip: Uint8Array RGBA of (4w x h), row 0 = top (as baked)
function stripToPlanes(strip, w, h) {
  const W4 = w * 4, N = w * h;
  const mask = new Uint8Array(N), leaf = new Uint8Array(N), planes = [];
  for (let c = 0; c < NCH; c++) planes.push(new Int16Array(N));
  let nLeaf = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const px = (m, k) => strip[(y * W4 + m * w + x) * 4 + k];
    if (px(0, 3) < 128) continue;
    mask[i] = 1; n++;
    for (let c = 0; c < NCH; c++) {
      const [m, k, bits] = CH[c];
      let v = px(m, k);
      if (c === 1 || c === 2) v = (v - px(0, 1)) & 255;
      planes[c][i] = v >> (8 - bits);
    }
    leaf[i] = px(3, 1) >= 128 ? 1 : 0; nLeaf += leaf[i];
  }
  const leafMode = nLeaf === 0 ? 0 : nLeaf === n ? 1 : 2;
  return { mask, planes, leaf, leafMode };
}
function planesToStrip(d, w, h) {
  const W4 = w * 4, out = new Uint8Array(W4 * h * 4);
  const deq = (v, bits) => bits === 8 ? v : (v << (8 - bits)) | (1 << (7 - bits));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!d.mask[i]) continue;
    const P = d.planes;
    const o = m => (y * W4 + m * w + x) * 4;
    const g = P[0][i];
    let k = o(0);
    out[k] = (P[1][i] + g) & 255; out[k + 1] = g; out[k + 2] = (P[2][i] + g) & 255; out[k + 3] = 255;
    k = o(1);
    const nx = P[3][i], ny = P[4][i];
    const fx = nx / 255 * 2 - 1, fy = ny / 255 * 2 - 1;
    const fz = Math.sqrt(Math.max(0, 1 - fx * fx - fy * fy));
    out[k] = nx; out[k + 1] = ny; out[k + 2] = Math.round((fz * 0.5 + 0.5) * 255); out[k + 3] = deq(P[5][i], 6);
    k = o(2);
    out[k] = deq(P[6][i], 7); out[k + 1] = deq(P[7][i], 7); out[k + 2] = deq(P[8][i], 6); out[k + 3] = deq(P[9][i], 6);
    k = o(3);
    out[k] = deq(P[10][i], 6); out[k + 1] = d.leaf[i] ? 255 : 0; out[k + 2] = 0; out[k + 3] = 255;
  }
  return out;
}

// ---------------------------------------------------------------- whole file
function encodeSprite(strip, w, h) {
  const d = stripToPlanes(strip, w, h);
  const e = new Encoder();
  codeSprite(e, w, h, d.mask, d.planes, d.leaf, d.leafMode);
  return { bytes: e.finish(), leafMode: d.leafMode };
}
function decodeSprite(buf, offset, w, h, leafMode) {
  const dec = new Decoder(buf, offset);
  return planesToStrip(codeSprite(dec, w, h, null, null, null, leafMode), w, h);
}
function encodeFile(meta, sprites) {   // sprites: [{file, strip, w, h}]
  const blocks = [], table = {};
  let off = 0;
  for (const s of sprites) {
    const { bytes, leafMode } = encodeSprite(s.strip, s.w, s.h);
    table[s.file] = [off, bytes.length, s.w, s.h, leafMode];
    blocks.push(bytes); off += bytes.length;
  }
  const json = new TextEncoder().encode(JSON.stringify({ ...meta, sprites: table }));
  const e = new Encoder(); codeBytes(e, json, json.length);
  const hb = e.finish();
  const head = new Uint8Array(12 + 4 + hb.length);
  const dv = new DataView(head.buffer);
  head.set([82, 84, 80, 75, 1, 0, 0, 0]);        // "RTPK", version 1
  dv.setUint32(8, 4 + hb.length, true);
  dv.setUint32(12, json.length, true);
  head.set(hb, 16);
  const total = head.length + off, out = new Uint8Array(total);
  out.set(head, 0);
  let p = head.length;
  for (const b of blocks) { out.set(b, p); p += b.length; }
  return out;
}
function openFile(buf) {
  if (buf[0] !== 82 || buf[1] !== 84 || buf[2] !== 80 || buf[3] !== 75) throw new Error("not an RTPack file");
  if (buf[4] !== 1) throw new Error("unsupported RTPack version " + buf[4]);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const hlen = dv.getUint32(8, true), jlen = dv.getUint32(12, true);
  const json = codeBytes(new Decoder(buf, 16), null, jlen);
  const meta = JSON.parse(new TextDecoder().decode(json));
  const base = 12 + hlen;
  return {
    meta,
    sprite(file) {
      const t = meta.sprites[file];
      if (!t) return null;
      return { w: t[2], h: t[3], strip: decodeSprite(buf, base + t[0], t[2], t[3], t[4]) };
    },
  };
}

const api = { encodeFile, openFile, encodeSprite, decodeSprite, stripToPlanes, planesToStrip, Encoder, Decoder, codeBytes };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.RTPack = api;
})(typeof self !== "undefined" ? self : this);
