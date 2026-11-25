// Lanternwood — a side-scrolling pixel world lit by ray-traced light.
//
// Sprites are SmartImposter impostor bakes turned into per-pixel G-buffers (tools/bake_world.py).
// Every frame: G-buffer (ground + sprites + player) -> lighting (rays marched through each
// sprite's depth slab and through a world-space canopy volume) -> pixel-art stylize + sky ->
// depth of field + bloom -> screen.
"use strict";

const $ = id => document.getElementById(id);
// tolerate an interface script from an older deploy (cached): every hook the game calls exists
window.UI = window.UI || { input: { ax: 0, ad: 0, jump: false, run: false }, started: true, mobile: false, quality: "high" };
for (const k of ["setStage", "setProgress", "setRegion", "setClock", "ready", "bind"]) if (typeof UI[k] !== "function") UI[k] = () => {};
if (typeof UI.error !== "function") UI.error = m => { const e = $("load-err") || $("err"); if (e) e.textContent = m; };
if (!UI.input) UI.input = { ax: 0, ad: 0, jump: false, run: false };
// versioned URLs (tools/stamp.py): never mix a cached old file with this deploy
const LV = window.LW_V || {};
const vurl = (path, key) => LV[key || path] ? `${path}?v=${LV[key || path]}` : path;
function fail(e) { console.error(e); UI.error(String(e && e.message || e)); }

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ": " + res.status);
  const total = +res.headers.get("content-length") || 0;
  const reader = res.body.getReader();
  const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    if (total) onProgress(got / total);
  }
  const buf = new Uint8Array(got); let p = 0;
  for (const c of chunks) { buf.set(c, p); p += c.length; }
  return buf;
}

(async function main() {
try {
// the world ships as one RTPack file (docs/js/rtpack.js): layout, catalog and every sprite
UI.setStage("Fetching the world");
const packBuf = await fetchWithProgress(vurl("data/world.rtp"), f => { UI.setProgress(f * 0.6); UI.setStage(`Fetching the world · ${Math.round(f * 100)}%`); });
const pack = RTPack.openFile(packBuf);
const world = pack.meta.world, catalog = pack.meta.catalog;
UI.setStage("Preparing the light");
// sprites decode in a worker; if the worker cannot start or stalls, they decode here instead
const pending = new Map();
let reqId = 0, decoder = null, workerOk = true;
function workerFailed(why) {
  if (!workerOk) return;
  workerOk = false;
  console.warn("decode worker unavailable, decoding on the main thread:", why);
  const left = [...pending.values()]; pending.clear();
  left.forEach(job => job.retry());
}
try {
  if (/[?&]noworker/.test(location.search)) throw new Error("disabled by ?noworker");   // debug: test the fallback
  decoder = new Worker(vurl("js/decoder.js") + (LV["js/rtpack.js"] ? `&rt=${LV["js/rtpack.js"]}` : ""));
  decoder.onerror = e => { e.preventDefault && e.preventDefault(); workerFailed(e.message || "worker error"); };
  decoder.onmessageerror = () => workerFailed("message error");
  decoder.onmessage = e => { const job = pending.get(e.data.id); pending.delete(e.data.id); if (job) job.done(e.data); };
  decoder.postMessage({ init: packBuf.buffer.slice(0) });
} catch (e) { workerOk = false; }
const CAM = world.camera, VW = CAM.vw, VH = CAM.vh, F = CAM.f, HC = CAM.height, HOR = CAM.horizon;
const PATH = world.path, LEN = world.length;

// ---------------------------------------------------------------- GL
const canvas = $("c");
const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
if (!gl) throw new Error("WebGL2 is required");
if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("This device's graphics can't render to floating-point targets (EXT_color_buffer_float), which the lighting needs.");
gl.getExtension("OES_texture_float_linear");

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + "\n" + src.split("\n").map((l, i) => (i + 1) + ": " + l).join("\n"));
  return s;
}
const VS = `#version 300 es
uniform vec4 u_rect; uniform vec2 u_view;
const vec2 Q[6] = vec2[6](vec2(0,0), vec2(1,0), vec2(0,1), vec2(0,1), vec2(1,0), vec2(1,1));
void main() { vec2 p = mix(u_rect.xy, u_rect.zw, Q[gl_VertexID]); gl_Position = vec4(p / u_view * 2.0 - 1.0, 0, 1); }`;
function program(fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}
function texture(w, h, internal, format, type, data, filter) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data || null);
  const f = filter || gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function target(textures) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  textures.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
  gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  return fb;
}
gl.bindVertexArray(gl.createVertexArray());
canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); fail(new Error("The graphics device was reset. Reload the page to continue.")); });

// ---------------------------------------------------------------- shaders
const COMMON = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
const float VW = ${VW}.0, VH = ${VH}.0, F = ${F.toFixed(3)}, HC = ${HC.toFixed(3)}, HOR = ${HOR.toFixed(3)};
const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
float lum(vec3 c) { return dot(c, LUM); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
uniform float u_camX;
// world (x along the trail, h up, d away from the camera) <-> virtual screen pixels (y up)
vec2 project(vec3 w) { return vec2(VW * 0.5 + (w.x - u_camX) * F / w.z, HOR + (w.y - HC) * F / w.z); }
`;
// G-buffer: G0 albedo + coverage | G1 normal + spread | G2 front dist, back dist, ao, sky
//           G3 transmission tint + kind (-1 ground, 0 bark/solid, 1 leaf, 2 player) | G4 plane dist, id, centre x, crown radius
const GB = `
layout(location=0) out vec4 g0; layout(location=1) out vec4 g1; layout(location=2) out vec4 g2;
layout(location=3) out vec4 g3; layout(location=4) out vec4 g4;`;

const FS_GROUND = COMMON + GB + `
uniform vec4 u_regions[8]; uniform int u_nReg;   // x0, x1, groundType, fireflies
uniform vec2 u_path;
vec3 groundAlbedo(int t, vec2 c, float n, float n2) {
  if (t == 0) return mix(vec3(0.06, 0.10, 0.025), vec3(0.10, 0.13, 0.03), n) * (n2 > 0.86 ? vec3(1.4, 1.1, 0.8) : vec3(1));   // meadow
  if (t == 1) return mix(vec3(0.055, 0.036, 0.019), vec3(0.036, 0.046, 0.017), 0.6 * step(0.66, n2 * 0.7 + n * 0.3)) * (0.75 + 0.5 * n);   // leaf litter, moss tufts
  if (t == 2) return mix(vec3(0.05, 0.10, 0.03), vec3(0.08, 0.12, 0.04), n) * (n2 > 0.8 ? 0.7 : 1.0);                        // glade
  if (t == 3) return mix(vec3(0.06, 0.038, 0.02), vec3(0.04, 0.05, 0.02), smoothstep(0.4, 0.7, n2)) * (0.8 + 0.4 * n);         // needles + moss
  if (t == 4) return mix(vec3(0.05, 0.048, 0.045), vec3(0.09, 0.08, 0.07), n) * (n2 > 0.8 ? vec3(0.6, 0.5, 0.4) : vec3(1));    // ash
  return mix(vec3(0.13, 0.11, 0.06), vec3(0.09, 0.09, 0.04), n2) * (0.8 + 0.35 * n);                                        // dry
}
int groundAt(float x, float r) {
  for (int i = 0; i < 8; i++) {
    if (i >= u_nReg) break;
    vec4 g = u_regions[i];
    float edge = 10.0 * (r - 0.5);  // ragged borders
    if (x + edge >= g.x && x + edge < g.y) return int(g.z);
  }
  return x < 0.0 ? int(u_regions[0].z) : int(u_regions[u_nReg - 1].z);
}
void main() {
  vec2 p = floor(gl_FragCoord.xy) + 0.5;
  if (p.y >= HOR - 0.5) discard;
  float d = F * HC / (HOR - p.y);
  float x = u_camX + (p.x - VW * 0.5) * d / F;
  // texture cells about a pixel wide at every distance, snapped to powers of two (no swimming)
  float cell = exp2(floor(log2(max(d / F * 1.6, 0.04))));
  vec2 c = floor(vec2(x, d) / cell);
  float n = hash(c), n2 = vnoise(vec2(x, d) * 0.7), big = vnoise(vec2(x, d) * 0.08);
  int t = groundAt(x, vnoise(vec2(x * 0.05, d * 0.2)));
  vec3 alb = groundAlbedo(t, c, n, n2) * (0.8 + 0.4 * big);
  // the trail: packed earth with stones, ragged edges
  float e0 = u_path.x + 0.6 * (vnoise(vec2(x * 0.4, 1.0)) - 0.5), e1 = u_path.y + 0.6 * (vnoise(vec2(x * 0.4, 7.0)) - 0.5);
  bool trail = d > e0 + 0.3 && d < e1 - 0.3;
  if (trail) {
    vec3 earth = t == 4 ? vec3(0.07, 0.065, 0.06) : t == 5 ? vec3(0.2, 0.16, 0.1) : vec3(0.13, 0.095, 0.06);
    alb = earth * (0.8 + 0.35 * n);
    if (hash(c + 7.7) > 0.93) alb = vec3(0.16, 0.15, 0.14) * (0.8 + 0.4 * n);  // pebbles
    if (abs(d - mix(e0, e1, 0.3)) < 0.18 || abs(d - mix(e0, e1, 0.7)) < 0.18) alb *= 0.82; // wheel ruts
  }
  vec3 nrm = normalize(vec3((n - 0.5) * 0.25, 1.0, (hash(c + 3.1) - 0.5) * 0.25));
  g0 = vec4(alb, 1.0);
  g1 = vec4(nrm, 1.0);
  g2 = vec4(d, d, 1.0, 1.0);
  g3 = vec4(0.0, 0.0, 0.0, -1.0);
  g4 = vec4(d, 0.0, x, 0.0);
}`;

const FS_SPRITE = COMMON + GB + `
uniform sampler2D t_spr;
uniform vec2 u_origin, u_size;       // screen pixel of the sprite's bottom-left, sprite W x H
uniform float u_base, u_flip, u_dobj, u_dmax, u_id, u_objX, u_crown, u_kind;
uniform float u_bend, u_flutter, u_time, u_phase;
uniform vec3 u_trans;
ivec2 texelOf(ivec2 lp) { if (u_flip > 0.5) lp.x = int(u_size.x) - 1 - lp.x; return ivec2(lp.x, int(u_size.y) - 1 - lp.y); }
bool inside(ivec2 lp) { return lp.x >= 0 && lp.y >= 0 && float(lp.x) < u_size.x && float(lp.y) < u_size.y; }
vec4 fetchMap(ivec2 tp, int k) { return texelFetch(t_spr, ivec2(tp.x + k * int(u_size.x), tp.y), 0); }
void main() {
  ivec2 lp = ivec2(floor(gl_FragCoord.xy - u_origin));
  // wind: horizontal moves only; clumps step one by one (ragged boundaries); bark follows the bend
  float hs = max(u_size.y - u_base, 1.0);
  float h = clamp((float(lp.y) - u_base) / hs, 0.0, 1.0);
  float bend = u_bend * h * h;
  ivec2 cell = ivec2(floor(vec2(lp) / 3.0));
  float jit = hash(vec2(cell) + u_phase) - 0.5;
  ivec2 srcPlain = ivec2(lp.x - int(floor(bend + 0.5)), lp.y);
  ivec2 src = ivec2(lp.x - int(floor(bend + 0.5 + jit * 0.9)), lp.y);
  vec2 q = vec2(cell) * 3.0;
  float fx = sin(q.x * 0.21 + 1.7 * sin(q.y * 0.15 + u_phase) + u_time * 3.1 + u_phase) * sin(q.y * 0.13 + q.x * 0.07 - u_time * 1.9);
  int fl = int(floor(fx * u_flutter * smoothstep(0.2, 0.7, h) + 0.5 + jit * 0.5));
  ivec2 tp; vec4 a = vec4(0); bool ok = false;
  ivec2 cand = src - ivec2(fl, 0);
  if (inside(cand)) { tp = texelOf(cand); a = fetchMap(tp, 0); ok = a.a > 0.5 && fetchMap(tp, 3).g > 0.5; }
  if (!ok) {
    if (!inside(srcPlain)) discard;
    tp = texelOf(srcPlain); a = fetchMap(tp, 0);
    if (a.a > 0.5 && fl != 0 && fetchMap(tp, 3).g > 0.5 && (!inside(cand) || fetchMap(texelOf(cand), 0).a < 0.5)) discard;
  }
  if (a.a < 0.5) discard;
  vec4 n = fetchMap(tp, 1), dd = fetchMap(tp, 2), m = fetchMap(tp, 3);
  vec3 nn = normalize(n.xyz * 2.0 - 1.0); if (u_flip > 0.5) nn.x = -nn.x;
  nn = normalize(nn + vec3(2.0 * u_bend * h / hs, 0, 0) * nn.y);
  float df = u_dobj - (dd.r - 0.5) * 2.0 * u_dmax;
  float db = u_dobj - (dd.g - 0.5) * 2.0 * u_dmax;
  g0 = vec4(pow(a.rgb, vec3(2.2)), max(m.r, 0.05));
  g1 = vec4(nn, n.a);
  g2 = vec4(df, max(db, df + 0.03), dd.b, dd.a);
  g3 = vec4(u_trans, u_kind > 0.5 ? 0.0 : m.g);
  g4 = vec4(u_dobj, u_id, u_objX, u_crown);
}`;

// ---- lighting: rays through each sprite's own slab (fine self-shadow) and through the world's
// canopy volume (shadows from every tree, also those above the top of the screen)
const QUALITY = { high: { grid: 110, g0: 0.32, gk: 0.012, self: 56 }, balanced: { grid: 52, g0: 0.62, gk: 0.03, self: 30 } };
const lightSource = q => FS_LIGHT.replace("__GRID_STEPS__", q.grid).replace("__G0__", q.g0.toFixed(3)).replace("__GK__", q.gk.toFixed(3)).replace("__SELF_STEPS__", q.self);
const FS_LIGHT = COMMON + `
uniform sampler2D g0t, g1t, g2t, g3t, g4t, gridT;
uniform vec4 u_grid;                  // x0, d0, cell size, unused
uniform vec2 u_gridN;
uniform vec3 u_sunDir, u_sunCol, u_sky, u_bounce;
uniform vec4 u_lamp; uniform vec3 u_lampCol;     // lantern: world pos + radius, colour
uniform vec4 u_ff[8]; uniform int u_nff; uniform vec3 u_ffCol;
uniform vec4 u_player;                 // x, h, d, height (capsule shadow)
uniform float u_time;
out vec4 o;

float gridTau(vec3 p, vec3 L, float maxT, vec4 self) {
  // march the canopy volume; skip the pixel's own crown (its self-shadow is traced in the sprite)
  float tau = 0.0, t = 0.15;
  for (int i = 0; i < __GRID_STEPS__; i++) {
    float step = __G0__ + float(i) * __GK__;
    t += step;
    if (t > maxT) break;
    vec3 q = p + L * t;
    if (q.y > 42.0 || q.y < -0.2) break;
    // the player's body (a capsule)
    vec2 pd = vec2(q.x - u_player.x, q.z - u_player.z);
    if (q.y > u_player.y && q.y < u_player.y + u_player.w && dot(pd, pd) < 0.05) tau += 2.5 * step;
    if (self.w > 0.0 && length(vec2(q.x - self.z, q.z - self.x)) < self.w * 0.85) continue;
    vec2 gc = (vec2(q.x, q.z) - u_grid.xy) / u_grid.z;
    if (gc.x < 0.0 || gc.y < 0.0 || gc.x >= u_gridN.x || gc.y >= u_gridN.y) continue;
    vec4 c = texelFetch(gridT, ivec2(gc), 0);  // crown bottom, top, density, trunk / solid
    if (q.y >= c.x && q.y <= c.y) tau += c.z * step;
    else if (q.y < c.x) tau += c.w * step;
    if (tau > 5.0) break;
  }
  return tau;
}

float selfTau(ivec2 ip, vec3 L, float d0, float id, float dObj) {
  // march in the sprite's own pixels toward the light, through its [front, back] depth slab
  float ppm = F / dObj;
  vec2 dir = L.xy; float lxy = length(dir);
  if (lxy < 1e-3) return 0.0;
  dir /= lxy;
  float stepM = 1.0 / (ppm * lxy);   // metres along L per screen pixel
  float tau = 0.0;
  vec2 sp = vec2(ip) + 0.5;
  float z = d0 + 0.02;
  for (int i = 1; i < __SELF_STEPS__; i++) {
    sp += dir; z -= L.z * stepM;       // L.z toward the camera lowers the distance
    ivec2 q = ivec2(floor(sp));
    if (q.x < 0 || q.y < 0 || q.x >= int(VW) || q.y >= int(VH)) break;
    vec4 g4 = texelFetch(g4t, q, 0);
    if (g4.y != id) continue;
    vec4 g2 = texelFetch(g2t, q, 0);
    if (z >= g2.x && z <= g2.y) {
      float cov = texelFetch(g0t, q, 0).a;
      float kind = texelFetch(g3t, q, 0).a;
      tau += cov * (kind > 0.5 ? (g4.w > 0.0 ? 2.6 : 0.7) : 40.0) * stepM;
    }
    if (tau > 5.0) break;
  }
  return tau;
}

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(g0t, ip, 0);
  if (a.a <= 0.0) { o = vec4(0); return; }
  vec4 n4 = texelFetch(g1t, ip, 0), z = texelFetch(g2t, ip, 0), m = texelFetch(g3t, ip, 0), g4 = texelFetch(g4t, ip, 0);
  bool ground = m.a < -0.5;
  float leaf = ground ? 0.0 : clamp(m.a, 0.0, 1.0);
  vec3 n = normalize(n4.xyz);
  vec3 nS = n * mix(1.0, n4.w, leaf);
  // world position: unproject on the sprite's plane, at the pixel's own depth
  vec2 sp = vec2(ip) + 0.5;
  float dObj = g4.x;
  vec3 P = vec3(u_camX + (sp.x - VW * 0.5) * dObj / F, HC + (sp.y - HOR) * dObj / F, z.x);
  if (ground) P.y = 0.02;
  vec4 self = ground ? vec4(0) : vec4(dObj, g4.y, g4.z, g4.w);
  vec3 E = vec3(0), T = vec3(0);
  // world-space light direction: view space has z toward the camera, world d away from it
  if (lum(u_sunCol) > 1e-4) {
    vec3 L = normalize(u_sunDir);
    vec3 Lw = vec3(L.x, L.y, -L.z);
    float tau = (ground ? 0.0 : selfTau(ip, L, z.x, g4.y, dObj)) + gridTau(P, Lw, 70.0, self);
    float s = exp(-tau);
    E += u_sunCol * max(dot(nS, L), 0.0) * s;
    T += u_sunCol * (0.12 + 0.55 * pow(max(-L.z, 0.0), 1.5)) * pow(s, 1.3);
  }
  if (u_lamp.w > 0.0) {
    vec3 v = u_lamp.xyz - P; float dist = length(v); vec3 Lw = v / dist;
    vec3 L = vec3(Lw.x, Lw.y, -Lw.z);
    float r = u_lamp.w;
    float att = 1.0 / (1.0 + (dist / r) * (dist / r)) * pow(clamp(1.0 - pow(dist / (r * 6.0), 2.0), 0.0, 1.0), 2.0);
    if (att > 1e-3) {
      float tau = (ground ? 0.0 : selfTau(ip, L, z.x, g4.y, dObj)) + gridTau(P, Lw, dist - 0.3, self);
      float s = exp(-tau);
      E += u_lampCol * max(dot(nS, L), 0.0) * s * att;
      T += u_lampCol * 0.25 * pow(s, 1.3) * att;
    }
  }
  for (int i = 0; i < 8; i++) {
    if (i >= u_nff) break;
    vec3 v = u_ff[i].xyz - P; float dist = length(v);
    vec3 L = vec3(v.x, v.y, -v.z) / dist;
    float att = u_ff[i].w / (1.0 + dist * dist * 6.0);
    E += u_ffCol * (max(dot(nS, L), 0.0) * 0.8 + 0.2) * att;
  }
  // sky light: occluded by the canopy above (a few samples straight up)
  vec2 gc = (vec2(P.x, P.z) - u_grid.xy) / u_grid.z;
  float canopy = 0.0;
  if (gc.x >= 0.0 && gc.y >= 0.0 && gc.x < u_gridN.x && gc.y < u_gridN.y) {
    vec4 c = texelFetch(gridT, ivec2(gc), 0);
    canopy = c.z * max(c.y - max(c.x, P.y), 0.0);
  }
  float skyOcc = 0.35 + 0.65 * exp(-canopy * 0.12);
  vec3 amb = (u_sky * z.w * skyOcc * (0.55 + 0.45 * clamp(n.y, 0.0, 1.0)) + u_bounce * clamp(-n.y + 0.3, 0.0, 1.0)) * z.z;
  vec3 lit = a.rgb * (E + amb) + a.rgb * m.rgb * 2.2 * T * leaf;
  o = vec4(lit, 1.0);
}`;

// ---- stylize: banded light, despeckle, outlines, haze, sky with mountains and clouds
const FS_STYLE = COMMON + `
uniform sampler2D g0t, g2t, g3t, g4t, lt;
uniform int u_bands, u_look; uniform bool u_clean, u_outline;
uniform float u_expo, u_haze, u_time, u_night;
uniform vec3 u_skyTop, u_skyHor, u_hazeCol, u_sunDir, u_sunCol, u_mtn;
uniform vec4 u_ff[8]; uniform int u_nff; uniform vec3 u_ffCol;
uniform vec4 u_lamp; uniform vec3 u_lampCol;
out vec4 o;
vec3 srgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }
vec3 tonemap(vec3 c) { c *= u_expo; return c / (1.0 + lum(c)) * 1.25; }
vec3 rawAt(ivec2 p) { return srgb(tonemap(texelFetch(lt, p, 0).rgb)); }
float spp() { return float(u_bands) * 0.5; }
int bandAt(ivec2 p) { return int(floor(log2(max(lum(rawAt(p)), 1e-3)) * spp() + 0.5)); }
float idAt(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= int(VW) || p.y >= int(VH)) return -2.0;
  if (texelFetch(g0t, p, 0).a <= 0.0) return -1.0;
  return texelFetch(g4t, p, 0).y;
}
float ridge(float x, float seed, float amp, int oct) {
  float h = 0.0, a = 1.0, f = 1.0;
  for (int i = 0; i < 5; i++) { if (i >= oct) break; h += a * (vnoise(vec2(x * 0.0035 * f, seed)) - 0.5); a *= 0.45; f *= 2.0; }
  return amp * (0.6 + h);
}
vec3 sky(vec2 p) {
  float y = clamp((p.y - HOR + 18.0) / (VH - HOR + 18.0), 0.0, 1.0);
  vec3 c = mix(u_skyHor, u_skyTop, floor(pow(y, 0.8) * 8.0) / 8.0);
  // the sun / moon disc where its direction pierces the far plane
  vec3 L = normalize(u_sunDir);
  if (L.z < -0.05) {
    vec2 sp = vec2(VW * 0.5 + L.x / -L.z * F, HOR + (L.y / -L.z) * F - HC * 0.0);
    float ds = length(p - sp);
    float halo = floor(clamp(1.0 - ds / 60.0, 0.0, 1.0) * 4.0) / 4.0;
    c = mix(c, srgb(u_sunCol * 0.6), halo * 0.3);
    if (ds < 6.0) c = u_night > 0.5 ? vec3(0.85, 0.88, 0.95) : srgb(u_sunCol * 0.7 + 0.35);
  }
  // stars
  if (u_night > 0.0) { float h = hash(floor(p)); if (h > 0.996) c = mix(c, vec3(0.9), u_night * 0.7 * (h - 0.996) * 250.0); }
  // banded clouds drifting
  float cl = vnoise(vec2((p.x + u_camX * F / 2500.0) * 0.012 + u_time * 0.004, p.y * 0.05)) * vnoise(vec2(p.x * 0.03 + u_time * 0.01, p.y * 0.11));
  if (y > 0.35 && cl > 0.42) c = mix(c, mix(u_skyHor, vec3(1.0), 0.35 + 0.3 * (1.0 - u_night)) * (u_night > 0.5 ? 0.35 : 1.0), cl > 0.5 ? 0.55 : 0.3);
  // three mountain ridges far away (parallax by their distance), banded by height below the crest
  float D[3] = float[3](3200.0, 1600.0, 800.0);
  float A[3] = float[3](360.0, 220.0, 110.0);
  for (int i = 0; i < 3; i++) {
    float x = u_camX + (p.x - VW * 0.5) * D[i] / F;
    float hgt = ridge(x, float(i) * 13.7, A[i], 3 + i);
    float top = HOR + (hgt - HC) * F / D[i];
    if (p.y < top) {
      float below = (top - p.y) / max(top - HOR + 8.0, 1.0);
      float lit = 0.85 - 0.45 * floor(clamp(below, 0.0, 1.0) * 3.0) / 3.0 + 0.1 * (vnoise(vec2(x * 0.02, p.y * 0.15)) - 0.5);
      vec3 mc = u_mtn * lit;
      c = mix(mc, u_hazeCol, 0.72 - 0.2 * float(i));
    }
  }
  return c;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 pc = vec2(p) + 0.5;
  float id = idAt(p);
  vec3 s; float dist = 1e4;
  if (id < -0.5) {
    s = sky(pc);
  } else {
    dist = texelFetch(g2t, p, 0).x;
    s = rawAt(p);
    if (u_look == 1) {
      int b = bandAt(p);
      if (u_clean) {
        ivec2 N4[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));
        bool same = false;
        for (int k = 0; k < 4; k++) { ivec2 q = p + N4[k]; if (idAt(q) == id && bandAt(q) == b) same = true; }
        if (!same) {
          int nb[8]; int total = 0;
          for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) continue;
            ivec2 q = p + ivec2(dx, dy);
            if (idAt(q) != id) continue;
            nb[total++] = bandAt(q);
          }
          if (total >= 3) {
            int best = b, bc = 0;
            for (int i = 0; i < 8; i++) { if (i >= total) break; int c = 0;
              for (int j = 0; j < 8; j++) { if (j >= total) break; if (nb[j] == nb[i]) c++; }
              if (c > bc) { bc = c; best = nb[i]; } }
            b = best;
          }
        }
      }
      float Y = max(lum(s), 1e-3);
      s = clamp(s * exp2(float(b) / spp()) / Y, 0.0, 1.0);
    }
    // outline where a sprite meets sky or something far behind it (unlit side darker)
    if (u_outline && id > 0.5) {
      bool edge = false;
      ivec2 N4[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));
      for (int k = 0; k < 4; k++) {
        ivec2 q = p + N4[k]; float qi = idAt(q);
        if (qi == -1.0 || (qi != id && qi != 0.0 && texelFetch(g2t, q, 0).x > dist * 1.25)) edge = true;
      }
      if (edge) { float k = lum(s) < 0.3 ? 0.9 : 0.3; s = mix(s, s * vec3(0.45, 0.48, 0.6), k); }
    }
    // aerial perspective
    float hz = (1.0 - exp(-max(dist - 12.0, 0.0) / 140.0)) * u_haze;
    s = mix(s, u_hazeCol, clamp(hz, 0.0, 0.85));
  }
  // fireflies and the lantern flame as emissive pixels
  for (int i = 0; i < 8; i++) {
    if (i >= u_nff) break;
    vec2 fp = project(u_ff[i].xyz);
    if (length(pc - fp) < 0.9 && u_ff[i].z < dist + 0.5) s = mix(s, srgb(u_ffCol * 2.0), u_ff[i].w);
  }
  if (u_lamp.w > 0.0) {
    vec2 lp = project(u_lamp.xyz);
    if (abs(pc.x - lp.x) < 1.0 && abs(pc.y - lp.y) < 1.5 && u_lamp.z < dist + 0.6) s = srgb(u_lampCol * 0.05 + vec3(1.0, 0.85, 0.5));
  }
  o = vec4(s, dist);
}`;

// ---- blur (separable, half resolution) for depth of field and bloom
const FS_BLUR = COMMON + `
uniform sampler2D src; uniform vec2 u_dir, u_texel; uniform float u_bright;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * u_texel;
  vec4 acc = vec4(0); float wsum = 0.0;
  for (int i = -4; i <= 4; i++) {
    float w = exp(-float(i * i) / 8.0);
    vec4 c = texture(src, uv + u_dir * float(i) * u_texel);
    if (u_bright > 0.0) { float l = lum(c.rgb); c.rgb *= smoothstep(u_bright, u_bright + 0.2, l); }
    acc += c * w; wsum += w;
  }
  o = acc / wsum;
}`;
// ---- composite: pixel-crisp in focus, soft out of focus, bloom, vignette, upscale
const FS_COMP = COMMON + `
uniform sampler2D cT, blurT, bloomT;
uniform float u_scale, u_focus, u_dof, u_bloom; uniform vec2 u_off;
out vec4 o;
void main() {
  vec2 f = (gl_FragCoord.xy - u_off) / u_scale;
  if (f.x < 0.0 || f.y < 0.0 || f.x >= VW || f.y >= VH) { o = vec4(0.027, 0.03, 0.045, 1); return; }
  vec4 c = texelFetch(cT, ivec2(f), 0);
  vec2 uv = f / vec2(VW, VH);
  vec3 b = texture(blurT, uv).rgb;
  float coc = clamp(abs(1.0 / max(c.a, 0.5) - 1.0 / u_focus) * 14.0 - 0.08, 0.0, 1.0) * u_dof;
  vec3 col = mix(c.rgb, b, coc);
  col += texture(bloomT, uv).rgb * u_bloom;
  vec2 v = uv - 0.5;
  col *= 1.0 - dot(v, v) * 0.55;
  o = vec4(col, 1);
}`;

const P = {
  ground: program(FS_GROUND), sprite: program(FS_SPRITE), light: program(lightSource(QUALITY[UI.quality] || QUALITY.high)),
  style: program(FS_STYLE), blur: program(FS_BLUR), comp: program(FS_COMP),
};

// ---------------------------------------------------------------- targets
const RGBA16F = [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT];
const G = [0, 1, 2, 3, 4].map(() => texture(VW, VH, ...RGBA16F));
const gFbo = target(G);
const LT = texture(VW, VH, ...RGBA16F), lFbo = target([LT]);
const CT = texture(VW, VH, ...RGBA16F, null, gl.LINEAR), cFbo = target([CT]);
const HW = VW / 2, HH = VH / 2;
const B = [0, 1, 2, 3].map(() => texture(HW, HH, ...RGBA16F, null, gl.LINEAR));
const bFbo = B.map(t => target([t]));

// ---------------------------------------------------------------- canopy volume
// A top-down grid of the world (0.5 m cells): crown bottom, crown top, leaf density (per metre),
// and trunk / rock density below the crown. Built once from the layout and the baked crown shapes.
const GX0 = -260, GD0 = 0, GC = 0.5;
const GNX = Math.ceil((LEN + 520) / GC), GND = Math.ceil(180 / GC);
const grid = new Float32Array(GNX * GND * 4);
for (let i = 0; i < GNX * GND; i++) { grid[i * 4] = 999; grid[i * 4 + 1] = -999; }
function h01(a, b) { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); }
for (const o of world.objects) {
  const v = catalog.variants[o.v];
  if (!v) continue;
  const solid = v.kind === "rock", tree = v.kind === "tree";
  if (!solid && !(tree && v.height > 1.8)) continue;
  const c = v.crown;
  const cx = o.x, cd = o.d, rad = Math.max(c.rad, 0.4);
  const ch = (c.hb + c.ht) / 2, ry = Math.max((c.ht - c.hb) / 2, 0.3);
  const i0 = Math.floor((cx - rad - GX0) / GC), i1 = Math.ceil((cx + rad - GX0) / GC);
  const j0 = Math.floor((cd - rad - GD0) / GC), j1 = Math.ceil((cd + rad - GD0) / GC);
  for (let j = Math.max(j0, 0); j <= Math.min(j1, GND - 1); j++) for (let i = Math.max(i0, 0); i <= Math.min(i1, GNX - 1); i++) {
    const x = GX0 + (i + 0.5) * GC, d = GD0 + (j + 0.5) * GC;
    const rho2 = ((x - cx) ** 2 + (d - cd) ** 2) / (rad * rad);
    if (rho2 > 1) continue;
    const k = (j * GNX + i) * 4;
    if (solid) {
      const hh = v.height * Math.sqrt(1 - rho2);
      grid[k] = Math.min(grid[k], 0); grid[k + 1] = Math.max(grid[k + 1], hh); grid[k + 2] = Math.max(grid[k + 2], 6.0); grid[k + 3] = Math.max(grid[k + 3], 6.0);
      continue;
    }
    const hh = ry * Math.sqrt(1 - rho2);
    // clumps and gaps: light comes through the gaps (dappled light on the forest floor)
    const n = h01(Math.floor(x / 1.2), Math.floor(d / 1.2)) * 0.55 + h01(i, j) * 0.45;
    const dens = (n < 0.5 ? 0.04 : 1.0) * (0.25 + 0.7 * c.dens);
    grid[k] = Math.min(grid[k], ch - hh); grid[k + 1] = Math.max(grid[k + 1], ch + hh); grid[k + 2] = Math.max(grid[k + 2], dens);
  }
  if (tree) {  // the trunk: an opaque column under the crown
    const ti = Math.floor((cx - GX0) / GC), tj = Math.floor((cd - GD0) / GC);
    if (ti >= 0 && tj >= 0 && ti < GNX && tj < GND) {
      const k = (tj * GNX + ti) * 4;
      grid[k + 3] = Math.max(grid[k + 3], Math.min(0.5 + v.height * 0.06, 2.5));
      if (grid[k] > 900) { grid[k] = c.hb; grid[k + 1] = c.hb; }
    }
  }
}
for (let i = 0; i < GNX * GND; i++) if (grid[i * 4] > 900) { grid[i * 4] = 0; grid[i * 4 + 1] = -1; }
const gridT = texture(GNX, GND, gl.RGBA32F, gl.RGBA, gl.FLOAT, grid);

// ---------------------------------------------------------------- sprites (lazy loaded)
const objects = world.objects.map((o, i) => ({ ...o, id: i + 1, phase: (o.x * 0.137 + o.d * 0.05) % 6.283 }));
const sprites = new Map();   // file -> {tex, meta, state}
function spriteFor(o) {
  const v = catalog.variants[o.v];
  const meta = v && v.scales[String(o.s)];
  if (!meta) return null;
  let s = sprites.get(meta.file);
  if (!s) { s = { meta, v, tex: null, state: 0 }; sprites.set(meta.file, s); }
  return s;
}
let inflight = 0;
const queue = [];
function request(s) {
  if (s.state !== 0) return;
  s.state = 1; queue.push(s); pump();
}
function finish(s, r) {
  inflight--;
  if (r.error) { console.warn(s.meta.file, r.error); s.state = 3; }
  else {
    try { s.tex = texture(r.w * 4, r.h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, r.strip); s.state = 2; }
    catch (e) { console.warn(s.meta.file, e); s.state = 3; }
  }
  decodedCount++;
  pump();
}
function decodeHere(s) {
  try { const d = pack.sprite(s.meta.file); return { w: d.w, h: d.h, strip: d.strip }; }
  catch (e) { return { error: String(e) }; }
}
let decodedCount = 0;
function pump() {
  while (inflight < 6 && queue.length) {
    const s = queue.shift(); inflight++;
    if (!workerOk) { finish(s, decodeHere(s)); continue; }
    const id = ++reqId;
    const job = {
      done: r => { clearTimeout(job.timer); finish(s, r); },
      retry: () => { clearTimeout(job.timer); finish(s, decodeHere(s)); },
    };
    // a stalled worker (no answer in 10 s) is treated as a failed one
    job.timer = setTimeout(() => { if (pending.has(id)) workerFailed("timeout"); }, 10000);
    pending.set(id, job);
    decoder.postMessage({ id, file: s.meta.file });
  }
}
// screen rectangle of an object for a camera x
function screenRect(o, s, camX) {
  const m = s.meta, ppm = F / o.d;
  const sx = VW / 2 + (o.x - camX) * ppm;
  const sy = HOR - HC * ppm;               // ground under the object
  const pad = 6;
  const x0 = Math.round(sx - m.w / 2), y0 = Math.round(sy) - m.base;
  return [x0 - pad, y0, x0 + m.w + pad, y0 + m.h + 2, x0];
}

// ---------------------------------------------------------------- the player (a hooded traveller)
// A small pixel figure, generated here: albedo, normals from its rounded silhouette, a thin slab.
const PLAYER_PPM = F / 14.0;
const PW = 14, PH = 24;
const FRAMES = 6;   // idle, walk x4, jump
function makePlayerTexture() {
  // rows top -> bottom; c cloak, h hood, s skin, b belt, l legs, k boots, p pack, x lantern handle
  const body = [
    "......hhh.....",
    ".....hhhhh....",
    "....hhhhhhh...",
    "....hhssshh...",
    "....hhsssh....",
    ".....hhhh.....",
    "....cccccc....",
    "...cccccccc...",
    "..pcccccccc...",
    "..pccccccccc..",
    "..pccccccccc..",
    "..pcccbbcccc..",
    "...ccccccccc..",
    "...ccccccccc..",
    "...cccccccc...",
    "...cccccccc...",
    "....cccccc....",
  ];
  const legs = [
    ["....ll..ll....", "....ll..ll....", "....ll..ll....", "....ll..ll....", "....ll..ll....", "...kkk..kkk...", "..............".slice(0)],
    ["....ll...ll...", "....ll...ll...", "...ll....ll...", "...ll.....ll..", "..kkk.....kkk.", "..............", ".............."],
    ["....ll..ll....", "....ll..ll....", ".....ll.ll....", ".....llll.....", "....kkkkk.....", "..............", ".............."],
    ["...ll...ll....", "...ll...ll....", "...ll....ll...", "..ll.....ll...", ".kkk.....kkk..", "..............", ".............."],
    ["....ll..ll....", "....ll..ll....", "....ll.ll.....", ".....llll.....", ".....kkkkk....", "..............", ".............."],
    ["....ll..ll....", "...ll....ll...", "..kkk....kkk..", "..............", "..............", "..............", ".............."],
  ];
  const col = { h: [0.18, 0.06, 0.05], c: [0.22, 0.075, 0.055], s: [0.55, 0.38, 0.28], b: [0.25, 0.17, 0.06], l: [0.08, 0.07, 0.07],
                k: [0.06, 0.04, 0.03], p: [0.2, 0.14, 0.07] };
  const W = PW * FRAMES, H = PH;
  const data = new Uint8Array(W * 4 * H * 4);  // 4 maps side by side
  for (let fi = 0; fi < FRAMES; fi++) {
    const rows = body.concat(legs[fi]);
    const pad = PH - rows.length;
    const mask = [];
    for (let y = 0; y < PH; y++) { mask.push([]); for (let x = 0; x < PW; x++) {
      const r = rows[y - pad]; const ch = r ? r[x] : ".";
      mask[y].push(ch && ch !== "." ? ch : null);
    } }
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      const ch = mask[y][x]; if (!ch) continue;
      // normal: from distance to the silhouette edge (a rounded body)
      let nx = 0, ny = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const q = mask[y + dy] && mask[y + dy][x + dx];
        if (!q) { nx -= dx; ny += dy; }
      }
      let nz = 3.0; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const c = col[ch];
      const px = fi * PW + x;
      const put = (map, v) => { const k = (y * W * 4 + map * W + px) * 4; for (let i = 0; i < 4; i++) data[k + i] = Math.round(Math.max(0, Math.min(1, v[i])) * 255); };
      const tex = ch === "c" || ch === "h" ? ((x * 7 + y * 3) % 5 === 0 ? 0.85 : 1.0) : 1.0;
      put(0, [Math.pow(c[0] * tex, 1 / 2.2), Math.pow(c[1] * tex, 1 / 2.2), Math.pow(c[2] * tex, 1 / 2.2), 1]);
      put(1, [nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5, 1]);
      put(2, [0.5 + 0.18, 0.5 - 0.18, 1, 0.9]);
      put(3, [1, 0, 0, 1]);
    }
  }
  return texture(W * 4, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, data);
}
// the texture holds FRAMES frames in each map; the sprite shader indexes maps by u_size.x, so the
// player is drawn as a W = PW*FRAMES sprite clipped to one frame (see drawPlayer)
const playerTex = makePlayerTexture();

// ---------------------------------------------------------------- state, input
const st = {
  x: 6, d: 14, h: 0, vx: 0, vh: 0, facing: 1, onGround: true, walkT: 0,
  camX: 6, time: 8.5, flow: true, region: -1, toastT: 0,
};
UI.bind({
  getTime: () => st.time, setTime: t => { st.time = ((t % 24) + 24) % 24; },
  getFlow: () => st.flow, setFlow: f => { st.flow = f; },
  setQuality: q => { try { P.light = program(lightSource(QUALITY[q] || QUALITY.high)); } catch (e) { console.error(e); } },
});
function update(dt) {
  const inp = UI.started ? UI.input : { ax: 0, ad: 0, jump: false, run: false };
  const run = inp.run ? 1.9 : 1.0;
  const ax = inp.ax, ad = inp.ad;
  st.vx += (ax * 3.4 * run - st.vx) * Math.min(1, dt * 10);
  st.x = Math.max(1, Math.min(LEN - 1, st.x + st.vx * dt));
  st.d = Math.max(PATH[0] + 0.2, Math.min(PATH[1] - 0.2, st.d + ad * 2.2 * run * dt));
  if (ax) st.facing = Math.sign(ax);
  if (st.onGround && inp.jump) { st.vh = 5.2; st.onGround = false; }
  st.vh -= 15 * dt; st.h += st.vh * dt;
  if (st.h <= 0) { st.h = 0; st.vh = 0; st.onGround = true; }
  st.walkT += Math.abs(st.vx) * dt * 2.2;
  // camera: leads the player a little in the walking direction
  const want = st.x + st.facing * 3.0;
  st.camX += (want - st.camX) * Math.min(1, dt * 2.5);
  if (st.flow) st.time = (st.time + dt * (+$("flow").value / 100) * 0.25) % 24;
  // region: the HUD chip, and a title card when walking into a new one
  const ri = world.regions.findIndex(r => st.x >= r.x0 && st.x < r.x1);
  if (ri !== st.region && ri >= 0) {
    st.region = ri;
    UI.setRegion(world.regions[ri].name, ["the old road", "under the beeches", "where the birches drink", "the high spruce", "the burnt ridge", "the sunlit terraces"][ri] || "");
  }
}

// ---------------------------------------------------------------- time of day
const mix3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function sunState(t) {
  // the sun rises on the left (6:00), is high at noon, sets on the right (18:00); morning and
  // evening it stands behind the scene (backlight), at noon a little in front
  const a = (t - 6) / 12 * Math.PI;           // 0 .. PI over the day
  const elev = Math.sin(a);
  const day = sstep(-0.12, 0.18, elev);
  const night = 1 - day;
  const warm = 1 - sstep(0.05, 0.6, elev);
  let dir, col;
  if (day > 0.01) {
    const zz = -0.55 + 0.75 * Math.max(elev, 0);  // toward the camera at noon
    dir = [-Math.cos(a), Math.max(elev, 0.05), zz];
    col = mix3([1.0, 0.95, 0.86], [1.0, 0.5, 0.2], warm).map(v => v * 2.8 * day);
  } else {
    const b = ((t + 12 - 6) % 24) / 12 * Math.PI;   // the moon on the opposite arc
    dir = [-Math.cos(b), Math.max(Math.sin(b), 0.1), -0.35];
    col = [0.16, 0.2, 0.32];
  }
  const skyTop = mix3(mix3([0.18, 0.4, 0.78], [0.28, 0.24, 0.5], warm), [0.015, 0.02, 0.05], night);
  const skyHor = mix3(mix3([0.66, 0.8, 0.94], [0.98, 0.6, 0.36], warm), [0.05, 0.06, 0.12], night);
  const skyAmb = mix3(mix3([0.22, 0.3, 0.45], [0.2, 0.17, 0.24], warm), [0.02, 0.03, 0.06], night);
  const bounce = mix3([0.1, 0.09, 0.06], [0.01, 0.01, 0.015], night);
  const hazeCol = skyHor.map(v => v * 0.95);
  const mtn = mix3(mix3([0.28, 0.33, 0.42], [0.4, 0.3, 0.33], warm), [0.04, 0.05, 0.09], night);
  return { dir, col, skyTop, skyHor, skyAmb, bounce, hazeCol, mtn, night, day, expo: 1.0 + 1.6 * night };
}

// ---------------------------------------------------------------- frame
function resize() {
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.floor(innerWidth * dpr); canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = innerWidth + "px"; canvas.style.height = innerHeight + "px";
  const fit = Math.min(canvas.width / VW, canvas.height / VH), whole = Math.floor(fit);
  const cover = Math.max(canvas.width / VW, canvas.height / VH);
  if (UI.mobile && fit / cover > 0.82) st.scale = cover;          // phones: fill the screen, trim a little sky / foreground
  else st.scale = whole >= 1 && whole / fit >= 0.86 ? whole : fit; // desktop: whole pixels when they fill the window well
  // tell the interface where the picture is, so the HUD sits inside it and not in the bars
  const dpr2 = devicePixelRatio || 1;
  document.documentElement.style.setProperty("--gx", Math.max(0, (canvas.width - VW * st.scale) / 2 / dpr2) + "px");
  document.documentElement.style.setProperty("--gy", Math.max(0, (canvas.height - VH * st.scale) / 2 / dpr2) + "px");
}
addEventListener("resize", resize); resize();

const FF_N = 8;
function fireflies(now, sun) {
  const out = [];
  const reg = world.regions[Math.max(st.region, 0)];
  const amount = (reg ? reg.fireflies : 0) * sun.night;
  if (amount < 0.05) return out;
  for (let i = 0; i < FF_N; i++) {
    const t = now * 0.0004 + i * 1.7;
    const x = st.camX + Math.sin(t * 0.7 + i) * 14 + (i - 3.5) * 3;
    const d = 11 + ((i * 3.7) % 9) + Math.sin(t * 1.3) * 1.5;
    const h = 0.6 + Math.abs(Math.sin(t * 0.9 + i * 0.5)) * 1.6;
    const blink = Math.max(0, Math.sin(now * 0.002 * (1 + i * 0.13) + i * 2.1));
    out.push([x, h, d, amount * blink * 0.8]);
  }
  return out;
}

function setRect(prog, x0, y0, x1, y1, vw, vh) { gl.uniform4f(prog.u.u_rect, x0, y0, x1, y1); gl.uniform2f(prog.u.u_view, vw, vh); }
function bindTex(prog, list) { list.forEach(([name, t], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(prog.u[name], i); }); }
const windAt = (x, t) => { const tt = t - x / 25; return 0.55 + 0.3 * Math.sin(tt * 0.45) + 0.2 * Math.sin(tt * 1.3 + 1.7) + 0.12 * Math.sin(tt * 3.1 + 0.4); };

let last = performance.now(), loadedOnce = false, loadStart = 0, fpsN = 0, fpsT = last, dead = false;
// one bad frame must not freeze the game silently: report it and stop
function frame(now) {
  if (dead) return;
  try { frameBody(now); }
  catch (e) { dead = true; fail(e); return; }
  if (!benching) requestAnimationFrame(frame);
}
function frameBody(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt);
  const t = now / 1000, camX = st.camX;
  const sun = sunState(st.time);
  const W = +$("wind").value / 10;

  // ---- G-buffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, gFbo);
  gl.viewport(0, 0, VW, VH);
  for (let i = 0; i < 5; i++) gl.clearBufferfv(gl.COLOR, i, i === 1 ? [0, 0, 1, 1] : [0, 0, 0, 0]);
  gl.useProgram(P.ground.p);
  setRect(P.ground, 0, 0, VW, HOR, VW, VH);
  gl.uniform1f(P.ground.u.u_camX, camX);
  const gtypes = { meadow: 0, forest: 1, glade: 2, needles: 3, ash: 4, dry: 5 };
  gl.uniform4fv(P.ground.u.u_regions, world.regions.flatMap(r => [r.x0 < 1 ? -1e4 : r.x0, r.x1, gtypes[r.ground] || 0, r.fireflies]));
  gl.uniform1i(P.ground.u.u_nReg, world.regions.length);
  gl.uniform2f(P.ground.u.u_path, PATH[0], PATH[1]);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.useProgram(P.sprite.p);
  const U = P.sprite.u;
  gl.uniform2f(U.u_view, VW, VH); gl.uniform1f(U.u_camX, camX); gl.uniform1f(U.u_time, t);
  gl.activeTexture(gl.TEXTURE0); gl.uniform1i(U.t_spr, 0);
  let drawn = 0, waiting = 0, playerDrawn = false;
  const drawPlayer = () => {
    playerDrawn = true;
    const ppm = F / st.d;
    const sx = VW / 2 + (st.x - camX) * ppm, sy = HOR + (st.h - HC) * ppm;
    const moving = Math.abs(st.vx) > 0.3;
    const fi = !st.onGround ? 5 : moving ? 1 + (Math.floor(st.walkT * 2) % 4) : 0;
    const x0 = Math.round(sx - PW / 2), y0 = Math.round(sy);
    // the whole strip is one sprite PW*FRAMES wide; shift it so frame fi lands on x0
    const ox = x0 - fi * PW;
    gl.uniform4f(U.u_rect, x0, y0, x0 + PW, y0 + PH);
    gl.uniform2f(U.u_origin, ox, y0); gl.uniform2f(U.u_size, PW * FRAMES, PH);
    gl.uniform1f(U.u_base, 0); gl.uniform1f(U.u_flip, 0); gl.uniform1f(U.u_dobj, st.d); gl.uniform1f(U.u_dmax, 0.25);
    gl.uniform1f(U.u_id, 99999); gl.uniform1f(U.u_objX, st.x); gl.uniform1f(U.u_crown, 0); gl.uniform1f(U.u_kind, 1);
    gl.uniform1f(U.u_bend, 0); gl.uniform1f(U.u_flutter, 0); gl.uniform1f(U.u_phase, 0);
    gl.uniform3f(U.u_trans, 0, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, playerTex);
    // facing left: mirror with the flip flag around this frame only (handled by drawing the strip mirrored)
    if (st.facing < 0) {
      gl.uniform1f(U.u_flip, 1);
      gl.uniform2f(U.u_origin, x0 - (FRAMES - 1 - fi) * PW, y0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
  for (const o of objects) {
    if (!playerDrawn && o.d < st.d) drawPlayer();
    const s = spriteFor(o);
    if (!s) continue;
    const r = screenRect(o, s, camX);
    // load what will be on screen soon (a margin to each side)
    const margin = 120;
    if (r[2] < -margin || r[0] > VW + margin || r[3] < 0 || r[1] > VH) continue;
    if (s.state === 0) request(s);
    if (r[2] < 0 || r[0] > VW) continue;
    if (s.state === 3) continue;              // failed: skip it, never hold up loading
    if (s.state !== 2) { waiting++; continue; }
    const m = s.meta;
    const hs = (m.h - m.base) / 100;
    const g = windAt(o.x, t);
    const flex = s.v.kind === "grass" ? 0.5 : s.v.kind === "rock" ? 0 : 1;
    const freq = 0.55 / Math.sqrt(Math.max(s.v.height / 8, 0.2));
    const sway = 0.65 * g + 0.35 * g * Math.sin(2 * Math.PI * freq * t + o.phase);
    gl.uniform4f(U.u_rect, r[0], r[1], r[2], r[3]);
    gl.uniform2f(U.u_origin, r[4], r[1]); gl.uniform2f(U.u_size, m.w, m.h);
    gl.uniform1f(U.u_base, m.base); gl.uniform1f(U.u_flip, o.f ? 1 : 0);
    gl.uniform1f(U.u_dobj, o.d); gl.uniform1f(U.u_dmax, m.dmax);
    gl.uniform1f(U.u_id, o.id); gl.uniform1f(U.u_objX, o.x);
    gl.uniform1f(U.u_crown, s.v.kind === "tree" || s.v.kind === "rock" ? s.v.crown.rad : 0);
    gl.uniform1f(U.u_kind, s.v.kind === "rock" ? 1 : 0);
    gl.uniform1f(U.u_bend, W * 2.4 * hs * flex * sway);
    gl.uniform1f(U.u_flutter, flex ? (0.6 + 0.8 * g) * Math.min(1, W + 0.2) : 0);
    gl.uniform1f(U.u_phase, o.phase);
    gl.uniform3fv(U.u_trans, s.v.trans);
    gl.bindTexture(gl.TEXTURE_2D, s.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    drawn++;
  }
  if (!playerDrawn) drawPlayer();

  // ---- lighting
  const lampOn = sun.night > 0.3 || sun.day < 0.5;
  const lampI = sstep(0.2, 0.9, sun.night) * 1.0 + 0.15;
  const lamp = lampOn ? [st.x + st.facing * 0.32, st.h + 0.9, st.d - 0.15, 3.2] : [0, 0, 0, 0];
  const flick = 0.9 + 0.08 * Math.sin(t * 13) + 0.04 * Math.sin(t * 31 + 1.3);
  const lampCol = [1.0, 0.55, 0.22].map(v => v * 1.6 * lampI * flick);
  const ff = fireflies(now, sun);
  const ffCol = [0.75, 1.0, 0.35];
  gl.bindFramebuffer(gl.FRAMEBUFFER, lFbo);
  gl.useProgram(P.light.p);
  setRect(P.light, 0, 0, VW, VH, VW, VH);
  bindTex(P.light, [["g0t", G[0]], ["g1t", G[1]], ["g2t", G[2]], ["g3t", G[3]], ["g4t", G[4]], ["gridT", gridT]]);
  const L = P.light.u;
  gl.uniform1f(L.u_camX, camX); gl.uniform1f(L.u_time, t);
  gl.uniform4f(L.u_grid, GX0, GD0, GC, 0); gl.uniform2f(L.u_gridN, GNX, GND);
  gl.uniform3fv(L.u_sunDir, sun.dir); gl.uniform3fv(L.u_sunCol, sun.col); gl.uniform3fv(L.u_sky, sun.skyAmb); gl.uniform3fv(L.u_bounce, sun.bounce);
  gl.uniform4fv(L.u_lamp, lamp); gl.uniform3fv(L.u_lampCol, lampCol);
  gl.uniform1i(L.u_nff, ff.length); if (ff.length) gl.uniform4fv(L.u_ff, ff.flat()); gl.uniform3fv(L.u_ffCol, ffCol);
  gl.uniform4f(L.u_player, st.x, st.h, st.d, 1.7);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // ---- stylize + sky
  gl.bindFramebuffer(gl.FRAMEBUFFER, cFbo);
  gl.useProgram(P.style.p);
  setRect(P.style, 0, 0, VW, VH, VW, VH);
  bindTex(P.style, [["g0t", G[0]], ["g2t", G[2]], ["g3t", G[3]], ["g4t", G[4]], ["lt", LT]]);
  const S = P.style.u;
  gl.uniform1f(S.u_camX, camX); gl.uniform1i(S.u_bands, +$("bands").value); gl.uniform1i(S.u_look, +$("look").value);
  gl.uniform1i(S.u_clean, $("clean").checked); gl.uniform1i(S.u_outline, $("outline").checked);
  gl.uniform1f(S.u_expo, sun.expo); gl.uniform1f(S.u_haze, +$("haze").value / 100); gl.uniform1f(S.u_time, t); gl.uniform1f(S.u_night, sun.night);
  const srgb = c => c.map(v => Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2));
  gl.uniform3fv(S.u_skyTop, srgb(sun.skyTop)); gl.uniform3fv(S.u_skyHor, srgb(sun.skyHor)); gl.uniform3fv(S.u_hazeCol, srgb(sun.hazeCol));
  gl.uniform3fv(S.u_sunDir, sun.dir); gl.uniform3fv(S.u_sunCol, sun.col.map(v => v / 2.8)); gl.uniform3fv(S.u_mtn, srgb(sun.mtn));
  gl.uniform1i(S.u_nff, ff.length); if (ff.length) gl.uniform4fv(S.u_ff, ff.flat()); gl.uniform3fv(S.u_ffCol, ffCol);
  gl.uniform4fv(S.u_lamp, lamp); gl.uniform3fv(S.u_lampCol, lampCol);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // ---- blur: B0 = colour half res (h), B1 = (v) -> DOF; B2/B3 bright pass -> bloom
  gl.useProgram(P.blur.p);
  const Bu = P.blur.u;
  gl.viewport(0, 0, HW, HH);
  const pass = (src, dst, dx, dy, bright, texel) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, bFbo[dst]);
    setRect(P.blur, 0, 0, HW, HH, HW, HH);
    bindTex(P.blur, [["src", src]]);
    gl.uniform2f(Bu.u_dir, dx, dy); gl.uniform2f(Bu.u_texel, texel[0], texel[1]); gl.uniform1f(Bu.u_bright, bright);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
  pass(CT, 0, 1, 0, 0, [1 / HW, 1 / HH]); pass(B[0], 1, 0, 1, 0, [1 / HW, 1 / HH]);
  pass(CT, 2, 1.5, 0, 0.55, [1 / HW, 1 / HH]); pass(B[2], 3, 0, 1.5, 0, [1 / HW, 1 / HH]);

  // ---- composite to the canvas
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(P.comp.p);
  setRect(P.comp, 0, 0, canvas.width, canvas.height, canvas.width, canvas.height);
  bindTex(P.comp, [["cT", CT], ["blurT", B[1]], ["bloomT", B[3]]]);
  gl.uniform1f(P.comp.u.u_scale, st.scale);
  gl.uniform2f(P.comp.u.u_off, Math.floor((canvas.width - VW * st.scale) / 2), Math.floor((canvas.height - VH * st.scale) / 2));
  gl.uniform1f(P.comp.u.u_focus, st.d); gl.uniform1f(P.comp.u.u_dof, +$("dof").value / 100); gl.uniform1f(P.comp.u.u_bloom, +$("bloom").value / 100);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  if (window.__grab) {   // debug capture (tools/devserver.py)
    const name = window.__grab; window.__grab = null;
    canvas.toBlob(b => fetch("/save?name=" + name, { method: "POST", body: b }), "image/png");
  }
  // HUD clock + loading screen
  UI.setClock(st.time, st.flow);
  if (!loadedOnce) {
    const total = drawn + waiting;
    UI.setProgress(0.6 + (total ? 0.4 * drawn / total : 0));
    UI.setStage(total ? `Growing the forest · ${drawn} / ${total}` : "Growing the forest");
    if (!loadStart) loadStart = now;
    if ((waiting === 0 && drawn > 0) || now - loadStart > 20000) { loadedOnce = true; UI.ready(); }
  }
  fpsN++;
  if (now - fpsT > 1000) { window.__fps = fpsN; window.__drawn = drawn; fpsN = 0; fpsT = now; }
}
// debug: time n frames rendered back to back (works while the tab is hidden)
let benching = false;
const px1 = new Uint8Array(4);
window.__bench = (n = 20) => {
  benching = true;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { frame(last + 16.7); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1); }
  const ms = (performance.now() - t0) / n;
  benching = false; requestAnimationFrame(frame);
  return ms;
};
window.__st = st;
requestAnimationFrame(frame);
} catch (e) { fail(e); }
})();
