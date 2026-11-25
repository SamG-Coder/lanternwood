// Lanternwood paper-doll characters: a small skeleton posed per animation frame, dressed in layered
// shapes (body, clothes, hair, held tools), drawn to whole pixels. Every frame produces the same four
// maps as the plant sprites (albedo + alpha | normal + spread | depth front/back, ao, sky | coverage),
// so the traced light, shadows and outlines treat the hero like everything else in the world.
(function (root) {
"use strict";
const FW = 24, FH = 34;           // one frame, in pixels (12.5 px per metre: a 1.75 m figure is 22 px)
const CX = 12;                    // feet centre column; the ground is row 1 from the bottom

const PAL = {
  skin: ["#f1c9a5", "#e0ac85", "#c68c60", "#a86b45", "#7d4a2e", "#5a3420"],
  hair: ["#2a1d16", "#5a3a22", "#8a5a2e", "#b8834a", "#d9b46a", "#c9c3b8", "#7a2e1e", "#1f2630"],
  cloth: ["#7a3b2a", "#3d5a3a", "#2f4466", "#6b5a3a", "#8a7a5a", "#5a2f4a", "#2c2c30", "#9a6a2a"],
  boots: ["#3a2a1e", "#2a2622", "#5a4030"],
};
const HAIR_STYLES = ["Short", "Long", "Ponytail", "Bob", "Hooded", "Cropped"];
const BUILDS = ["Slender", "Sturdy"];
const DEFAULT_LOOK = { build: 0, skin: 1, hair: 0, hairColor: 2, tunic: 0, trousers: 6, cloak: 1, cloakOn: 1, boots: 0 };

// animations: name -> [first frame, count, frames per second]
const ANIMS = {};
const ORDER = [["idle", 4, 3], ["walk", 6, 10], ["run", 6, 14], ["jumpUp", 1, 1], ["jumpFall", 1, 1],
               ["gather", 4, 7], ["chop", 4, 7], ["mine", 4, 7], ["craft", 2, 4]];
let nf = 0;
for (const [name, n, fps] of ORDER) { ANIMS[name] = [nf, n, fps]; nf += n; }
const FRAMES = nf;

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const shade = (c, k) => c.map(v => Math.max(0, Math.min(255, Math.round(v * k))));
const rad = d => d * Math.PI / 180;
const dir = a => [Math.sin(a), -Math.cos(a)];          // 0 = straight down, + = forward (facing +x)

// ---------------------------------------------------------------- poses
function pose(anim, i) {
  const p = { hipY: 10, hipX: 0, lean: 0, tilt: 0, armF: [6, 8], armB: [-6, 8], legF: [3, 2], legB: [-3, 2],
              hold: null, holdA: 0, cloak: 0, back: true };
  const s = Math.sin, c = Math.cos;
  if (anim === "idle") {
    const f = [0, 1, 1, 0][i];
    p.hipY = 10 - f * 0.0; p.armF = [5 + f * 3, 8]; p.armB = [-5 - f * 3, 8]; p.tilt = f * 2; p.cloak = f;
  } else if (anim === "walk" || anim === "run") {
    const run = anim === "run", ph = i / 6 * Math.PI * 2;
    const L = run ? 42 : 26, A = run ? 38 : 22;
    p.legF = [L * s(ph), (run ? 55 : 28) * Math.max(0, -c(ph))];
    p.legB = [-L * s(ph), (run ? 55 : 28) * Math.max(0, c(ph))];
    p.armF = [-A * s(ph), run ? 75 : 16]; p.armB = [A * s(ph), run ? 75 : 16];
    p.hipY = 10 - (run ? 1.0 : 0.5) * Math.abs(s(ph)) - (run ? 0.6 : 0);
    p.lean = run ? 10 : 2; p.cloak = run ? 4 : 2;
  } else if (anim === "jumpUp") {
    p.legF = [55, 80]; p.legB = [10, 70]; p.armF = [150, 20]; p.armB = [120, 20]; p.hipY = 11; p.lean = 4; p.cloak = -2;
  } else if (anim === "jumpFall") {
    p.legF = [18, 12]; p.legB = [-12, 18]; p.armF = [100, 10]; p.armB = [80, 15]; p.hipY = 10; p.cloak = 5;
  } else if (anim === "gather") {
    const k = [0, 1, 2, 1][i];
    p.hipY = 6.8; p.lean = 34; p.legF = [70, 110]; p.legB = [-25, 95];
    p.armF = [55 + k * 8, 10 + k * 6]; p.armB = [20, 30]; p.tilt = 10; p.cloak = 1;
  } else if (anim === "chop" || anim === "mine") {
    const up = anim === "mine" ? [175, 110, 55, 140] : [160, 95, 40, 125];
    p.legF = [16, 6]; p.legB = [-14, 6]; p.lean = [-4, 6, 12, 2][i];
    p.armF = [up[i], [15, 5, 0, 10][i]]; p.armB = [up[i] - 15, [25, 10, 5, 20][i]];
    p.hold = anim === "mine" ? "pick" : "axe"; p.cloak = [0, 2, 3, 1][i];
  } else if (anim === "craft") {
    p.armF = [55 + i * 10, 70]; p.armB = [45 - i * 10, 75]; p.lean = 6; p.tilt = 8;
  }
  return p;
}

// ---------------------------------------------------------------- shape painter
// A frame is painted back to front; each shape writes colour, a normal and how far it stands out.
function makeFrame() {
  const n = FW * FH;
  return { col: new Uint8ClampedArray(n * 3), nrm: new Float32Array(n * 3), z: new Float32Array(n), a: new Uint8Array(n) };
}
function put(F, x, y, col, nx, ny, nz, zf) {
  if (x < 0 || y < 0 || x >= FW || y >= FH) return;
  const i = (FH - 1 - y) * FW + x;   // y up in pose space, row 0 = top in the strip
  F.col[i * 3] = col[0]; F.col[i * 3 + 1] = col[1]; F.col[i * 3 + 2] = col[2];
  F.nrm[i * 3] = nx; F.nrm[i * 3 + 1] = ny; F.nrm[i * 3 + 2] = nz; F.z[i] = zf; F.a[i] = 1;
}
// capsule from a to b, radius r0 -> r1; colour; optional darker tone on its lower edge
function capsule(F, a, b, r0, r1, col, opts = {}) {
  const minX = Math.floor(Math.min(a[0], b[0]) - Math.max(r0, r1) - 1) + CX, maxX = Math.ceil(Math.max(a[0], b[0]) + Math.max(r0, r1) + 1) + CX;
  const minY = Math.floor(Math.min(a[1], b[1]) - Math.max(r0, r1) - 1), maxY = Math.ceil(Math.max(a[1], b[1]) + Math.max(r0, r1) + 1);
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-6;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + 0.5 - CX, py = y + 0.5;
    const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2));
    const qx = px - (a[0] + dx * t), qy = py - (a[1] + dy * t);
    const r = r0 + (r1 - r0) * t, d = Math.hypot(qx, qy);
    if (d > r) continue;
    const nx = qx / Math.max(r, 0.5), ny = qy / Math.max(r, 0.5), nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
    const c = opts.under && ny < -0.35 ? shade(col, 0.82) : col;
    put(F, x, y, c, nx * 0.9, ny * 0.9, nz, (opts.z || 0) + nz * 0.06);
  }
}
function disc(F, c, r, col, opts = {}) { capsule(F, c, c, r, r, col, opts); }
function poly(F, pts, col, opts = {}) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) for (let x = Math.floor(minX + CX); x <= Math.ceil(maxX + CX); x++) {
    const px = x + 0.5 - CX, py = y + 0.5;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    if (!inside) continue;
    const n = opts.normal || [0, 0.15, 0.99];
    put(F, x, y, col, n[0], n[1], n[2], opts.z || 0);
  }
}
function pixel(F, p, col, z) { put(F, Math.floor(p[0] + CX), Math.floor(p[1]), col, 0, 0, 1, z || 0.1); }

// ---------------------------------------------------------------- one frame
function drawFrame(look, equip, anim, i) {
  const L = { ...DEFAULT_LOOK, ...look };
  const skin = hex(PAL.skin[L.skin % PAL.skin.length]), hair = hex(PAL.hair[L.hairColor % PAL.hair.length]);
  const tunic = hex(PAL.cloth[L.tunic % PAL.cloth.length]), trousers = hex(PAL.cloth[L.trousers % PAL.cloth.length]);
  const cloakC = hex(PAL.cloth[L.cloak % PAL.cloth.length]), boots = hex(PAL.boots[L.boots % PAL.boots.length]);
  const belt = [58, 40, 26], wood = [122, 92, 60], steel = [150, 156, 164];
  const sturdy = L.build === 1;
  const P = pose(anim, i), F = makeFrame();
  const rot = (v, a) => [v[0] * Math.cos(a) + v[1] * Math.sin(a), -v[0] * Math.sin(a) + v[1] * Math.cos(a)];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const lean = rad(P.lean);
  const hip = [P.hipX, P.hipY];
  const neck = add(hip, rot([0, 7.2], lean));
  const head = add(neck, rot([0.4, 3.3], lean + rad(P.tilt)));
  const shoulder = add(neck, rot([0, -0.9], lean));
  const limb = (base, ang, bend, l1, l2, sign) => {
    const a1 = rad(ang), j = add(base, dir(a1).map(v => v * l1));
    const a2 = a1 + sign * rad(bend), e = add(j, dir(a2).map(v => v * l2));
    return [j, e, a2];
  };
  const [kF, fF] = limb(add(hip, [0.6, 0]), P.legF[0], P.legF[1], 5, 5, -1);
  const [kB, fB] = limb(add(hip, [-0.6, 0]), P.legB[0], P.legB[1], 5, 5, -1);
  const [eF, hF, aF] = limb(add(shoulder, [0.5, 0]), P.armF[0], P.armF[1], 3.8, 3.8, 1);
  const [eB, hB, aB] = limb(add(shoulder, [-0.5, 0]), P.armB[0], P.armB[1], 3.8, 3.8, 1);
  const legR = sturdy ? 1.45 : 1.25, armR = sturdy ? 1.15 : 0.95;
  const torsoR0 = sturdy ? 2.7 : 2.3, torsoR1 = sturdy ? 3.0 : 2.6;
  const BACK = -0.08;

  // 1. weapon on the back (when not in use)
  const weapon = equip && equip.main;
  if (weapon && !P.hold) {
    const style = (root.LWData && root.LWData.ITEMS[weapon] || {}).style;
    const top = add(neck, rot([-3.5, 4.5], lean)), bot = add(hip, rot([2.5, -4], lean));
    if (style === "bow") {
      for (let k = 0; k <= 10; k++) { const t = k / 10, q = add([top[0] * (1 - t) + bot[0] * t, top[1] * (1 - t) + bot[1] * t], [-Math.sin(t * Math.PI) * 2.2, 0]); disc(F, q, 0.55, wood, { z: BACK }); }
    } else if (style === "maul") {
      capsule(F, bot, top, 0.55, 0.55, wood, { z: BACK }); disc(F, top, 1.6, steel, { z: BACK });
    } else {
      capsule(F, add(bot, [1, -3]), add(top, [-0.5, 2]), 0.6, 0.6, wood, { z: BACK });
    }
  }
  if (equip && equip.off) disc(F, add(neck, rot([-2.2, -3], lean)), 2.6, [216, 210, 196], { z: BACK - 0.02 });
  // 2. cloak (behind the body, swinging back with speed)
  if (L.cloakOn) {
    const sw = P.cloak;
    const sh = add(shoulder, rot([-1.4, 0.4], lean)), sh2 = add(shoulder, rot([1.2, 0.4], lean));
    poly(F, [sh2, sh, add(hip, [-3.2 - sw * 0.7, -5.2 + sw * 0.5]), add(hip, [-0.5 - sw * 0.5, -6.2 + sw * 0.4])], shade(cloakC, 0.85), { z: BACK, normal: [-0.25, 0.1, 0.96] });
  }
  // 3. far leg and arm
  capsule(F, add(hip, [-0.6, 0]), kB, legR, legR * 0.9, shade(trousers, 0.78), { z: -0.04 });
  capsule(F, kB, fB, legR * 0.9, legR * 0.8, shade(trousers, 0.78), { z: -0.04 });
  capsule(F, add(fB, dir(rad(P.legB[0] - P.legB[1])).map(v => v * -1.6)), fB, 1.15, 1.15, shade(boots, 0.8), { z: -0.03 });
  capsule(F, fB, add(fB, [1.6, 0.2]), 0.9, 0.8, shade(boots, 0.8), { z: -0.03 });
  capsule(F, add(shoulder, [-0.5, 0]), eB, armR, armR, shade(tunic, 0.75), { z: -0.05 });
  capsule(F, eB, hB, armR * 0.95, armR * 0.85, shade(skin, 0.85), { z: -0.05 });
  // 4. body: torso, belt, tunic skirt
  capsule(F, add(hip, rot([0, 0.6], lean)), add(neck, rot([0, -1.1], lean)), torsoR1 * 0.9, torsoR0, tunic, { under: true, z: 0.02 });
  const w0 = sturdy ? 3.0 : 2.6;
  poly(F, [add(hip, rot([-w0, 1.2], lean)), add(hip, rot([w0, 1.2], lean)), add(hip, rot([w0 + 0.9, -2.8], lean * 0.4)), add(hip, rot([-w0 - 0.6, -2.8], lean * 0.4))], tunic, { z: 0.03, normal: [0, -0.1, 0.99] });
  capsule(F, add(hip, rot([-w0 + 0.3, 1.0], lean)), add(hip, rot([w0 - 0.3, 1.0], lean)), 0.5, 0.5, belt, { z: 0.05 });
  // 5. near leg
  capsule(F, add(hip, [0.6, 0]), kF, legR, legR * 0.9, trousers, { z: 0.06 });
  capsule(F, kF, fF, legR * 0.9, legR * 0.8, trousers, { z: 0.06 });
  capsule(F, add(fF, dir(rad(P.legF[0] - P.legF[1])).map(v => v * -1.6)), fF, 1.2, 1.2, boots, { z: 0.07 });
  capsule(F, fF, add(fF, [1.8, 0.2]), 0.95, 0.85, boots, { z: 0.07 });
  // 6. head, hair, face
  capsule(F, neck, add(neck, rot([0, 1.2], lean)), 0.9, 0.9, skin, { z: 0.02 });
  const hs = L.hair % HAIR_STYLES.length, hr = 2.9;
  if (hs === 1) poly(F, [add(head, [-2.6, 1]), add(head, [0.2, 1]), add(head, [-0.6, -5]), add(head, [-3.2, -4.2])], shade(hair, 0.85), { z: -0.01 });
  if (hs === 2) capsule(F, add(head, [-2.4, 0.6]), add(head, [-4.2 - P.cloak * 0.3, -3.2]), 1.0, 0.7, shade(hair, 0.85), { z: -0.01 });
  if (hs === 4) poly(F, [add(head, [-3.6, 2.6]), add(head, [2.0, 3.4]), add(head, [3.2, 0.5]), add(head, [1.0, -3.4]), add(head, [-3.8, -3.8])], cloakC, { z: 0.0, normal: [-0.1, 0.2, 0.97] });
  disc(F, head, hr, skin, { z: 0.1 });
  if (hs === 0 || hs === 1 || hs === 2 || hs === 3) {
    capsule(F, add(head, [-1.4, 1.2]), add(head, [0.9, 1.6]), 1.9, 1.6, hair, { z: 0.14 });
    capsule(F, add(head, [-2.0, 0.6]), add(head, [-2.1, -0.8]), 1.3, 1.1, hair, { z: 0.13 });
    if (hs === 3) capsule(F, add(head, [-2.3, 0]), add(head, [-1.6, -2.4]), 1.4, 1.2, hair, { z: 0.13 });
  } else if (hs === 5) {
    capsule(F, add(head, [-1.6, 1.6]), add(head, [0.8, 2.1]), 1.3, 1.1, hair, { z: 0.14 });
  } else if (hs === 4) {
    poly(F, [add(head, [-3.2, 2.2]), add(head, [1.4, 3.3]), add(head, [3.0, 1.3]), add(head, [0.2, 0.9]), add(head, [-2.2, -2.4]), add(head, [-3.4, -1.0])], cloakC, { z: 0.15, normal: [-0.2, 0.4, 0.9] });
  }
  pixel(F, add(head, [1.7, 0.4]), [34, 26, 24], 0.16);   // eye
  // 7. near arm and held tool
  capsule(F, add(shoulder, [0.5, 0]), eF, armR, armR, shade(tunic, 0.95), { z: 0.08 });
  capsule(F, eF, hF, armR * 0.95, armR * 0.85, skin, { z: 0.09 });
  if (P.hold) {
    const d = dir(aF), handle = add(hF, d.map(v => v * 5.5));
    capsule(F, add(hF, d.map(v => v * -1)), handle, 0.55, 0.55, wood, { z: 0.11 });
    const perp = [-d[1], d[0]];
    if (P.hold === "axe") poly(F, [handle, add(handle, perp.map(v => v * 2.6)), add(add(handle, perp.map(v => v * 2.4)), d.map(v => v * -2.2)), add(handle, d.map(v => v * -1.4))], steel, { z: 0.12, normal: [0.3, 0.3, 0.9] });
    else { capsule(F, add(handle, perp.map(v => v * 2.6)), add(handle, perp.map(v => v * -2.6)), 0.6, 0.5, steel, { z: 0.12 }); }
  }
  disc(F, hF, 0.95, skin, { z: 0.1 });
  return F;
}

// ---------------------------------------------------------------- the strip: every frame, four maps
function build(look, equip) {
  const W = FW * FRAMES, out = new Uint8Array(W * 4 * FH * 4);
  let f = 0;
  for (const [name, n] of ORDER) for (let i = 0; i < n; i++, f++) {
    const F = drawFrame(look, equip, name, i);
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const s = y * FW + x;
      if (!F.a[s]) continue;
      const px = f * FW + x;
      const at = (map, k) => (y * W * 4 + map * W + px) * 4 + k;
      // map 0: albedo (sRGB) + alpha
      out[at(0, 0)] = F.col[s * 3]; out[at(0, 1)] = F.col[s * 3 + 1]; out[at(0, 2)] = F.col[s * 3 + 2]; out[at(0, 3)] = 255;
      // map 1: normal + spread (a solid surface)
      const nx = F.nrm[s * 3], ny = F.nrm[s * 3 + 1], nz = F.nrm[s * 3 + 2], l = Math.hypot(nx, ny, nz) || 1;
      out[at(1, 0)] = Math.round((nx / l * 0.5 + 0.5) * 255); out[at(1, 1)] = Math.round((ny / l * 0.5 + 0.5) * 255);
      out[at(1, 2)] = Math.round((nz / l * 0.5 + 0.5) * 255); out[at(1, 3)] = 255;
      // map 2: front / back depth (+-0.25 m range), ao, sky
      const front = 0.1 + F.z[s], back = -0.14;
      out[at(2, 0)] = Math.round((0.5 + front / 0.5) * 255); out[at(2, 1)] = Math.round((0.5 + back / 0.5) * 255);
      out[at(2, 2)] = F.z[s] < 0 ? 200 : 245; out[at(2, 3)] = 230;
      // map 3: coverage, not foliage
      out[at(3, 0)] = 255; out[at(3, 1)] = 0; out[at(3, 2)] = 0; out[at(3, 3)] = 255;
    }
  }
  return { data: out, frameW: FW, frameH: FH, frames: FRAMES, width: W * 4, height: FH, base: 1 };
}

// a lit preview of one frame on a 2D canvas (character creator)
function preview(canvas, look, equip, anim, t) {
  const [f0, n, fps] = ANIMS[anim] || ANIMS.idle;
  const i = Math.floor(t * fps) % n;
  const F = drawFrame(look, equip, anim, i);
  const ctx = canvas.getContext("2d");
  const s = Math.floor(Math.min(canvas.width / FW, canvas.height / FH));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const img = ctx.createImageData(FW, FH);
  const Lx = -0.45, Ly = 0.6, Lz = 0.66;
  for (let k = 0; k < FW * FH; k++) {
    if (!F.a[k]) continue;
    const d = Math.max(0, F.nrm[k * 3] * Lx + F.nrm[k * 3 + 1] * Ly + F.nrm[k * 3 + 2] * Lz);
    const light = 0.42 + 0.85 * d;
    for (let c = 0; c < 3; c++) {
      const lin = Math.pow(F.col[k * 3 + c] / 255, 2.2) * light;
      img.data[k * 4 + c] = Math.round(255 * Math.pow(Math.min(1, lin), 1 / 2.2));
    }
    img.data[k * 4 + 3] = 255;
  }
  const tmp = preview._c || (preview._c = document.createElement("canvas"));
  tmp.width = FW; tmp.height = FH; tmp.getContext("2d").putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, Math.floor((canvas.width - FW * s) / 2), Math.floor(canvas.height - FH * s), FW * s, FH * s);
}

const api = { FW, FH, FRAMES, ANIMS, PAL, HAIR_STYLES, BUILDS, DEFAULT_LOOK, build, preview, drawFrame };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.LWCharacter = api;
})(typeof self !== "undefined" ? self : this);
