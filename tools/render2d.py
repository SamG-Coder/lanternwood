"""Offline 2D lighting + pixel-art stylizing of a sprite G-buffer (the reference for the shader).

    python tools/render2d.py sprites/alder_a out/lit.png

Lighting model per sprite pixel (view space: x right, y up, z toward the viewer):
  * normal  = mix(crown hull normal, baked leaf normal, detail), Lambert on it shortened by the
              baked normal spread (SmartImposter's impostor model: the mean diffuse of the leaves)
  * shadow  = volumetric self-shadow: march toward the light through the crown slab
              [back depth, front depth] at every pixel, Beer-Lambert on the coverage
  * transmission = broad lobe 0.25 (1 - n.l) through the leaves (back light glows at thin edges)
  * ambient = sky visibility x AO x sky colour, plus a ground bounce
Stylize: irradiance -> a few bands (light ramp), colour from a hue-shifted per-material palette
ramp, optional selective outline.
"""
import argparse, json, os
import numpy as np
from PIL import Image
from make_sprite import gauss_blur

LUM = np.array([0.2126, 0.7152, 0.0722])
BAYER4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0 - 0.46875


def load(d):
    g = dict(np.load(os.path.join(d, "gbuf.npz")))
    g["meta"] = json.load(open(os.path.join(d, "sprite.json")))
    # empty pixels: neutral values so nothing divides by zero
    m = g["mask"]
    z = np.array([0.0, 0.0, 1.0])
    for k in ("normal", "hull"):
        bad = ~m[..., None] | ~np.isfinite(g[k]) | (np.linalg.norm(g[k], axis=-1, keepdims=True) < 1e-3)
        g[k] = np.where(bad, z, g[k])
    g["albedo"] = np.where(m[..., None], np.maximum(g["albedo"], 1e-3), 0.1)
    for k in ("ao", "sky", "spread", "leaf", "dfront", "dback", "cov"):
        g[k] = np.nan_to_num(g[k])
    g["clump"] = height_normal(np.where(m, g["dfront"] * g["meta"]["zscale"], g["dfront"][m].min() * g["meta"]["zscale"] - 3), 1.6)
    return g


def height_normal(h, sigma):
    """Normal of a blurred height field (rows go down the image, +y is up)."""
    hb = gauss_blur(h, sigma)
    gy, gx = np.gradient(hb)
    n = np.stack([-gx, gy, np.ones_like(gx)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def self_shadow(g, L_at, sigma=0.22, steps=48):
    """Transmittance to the light from each pixel's front surface. L_at(x, y, z) -> unit dir."""
    m, cov = g["mask"], g["cov"]
    zs = g["meta"]["zscale"]
    zf, zb = g["dfront"] * zs, g["dback"] * zs
    H, W = m.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    # pixel centres; y up for the light maths
    px, py, pz = xx + 0.5, (H - yy) - 0.5, np.where(m, zf - 0.5, 0)
    L = L_at(px, py, pz)
    # step one pixel in the plane (or one unit in z when the light is face-on)
    lxy = np.maximum(np.hypot(L[..., 0], L[..., 1]), 1e-3)
    step = 1.0 / np.maximum(lxy, np.abs(L[..., 2]) * 0.7 + 1e-3)
    tau = np.zeros((H, W))
    x, y, z = px.copy(), py.copy(), pz.copy()
    for _ in range(steps):
        x += L[..., 0] * step
        y += L[..., 1] * step
        z += L[..., 2] * step
        ix = np.floor(x).astype(int)
        iy = np.floor(H - y).astype(int)
        inb = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H)
        ixc, iyc = np.clip(ix, 0, W - 1), np.clip(iy, 0, H - 1)
        inside = inb & m[iyc, ixc] & (z <= zf[iyc, ixc]) & (z >= zb[iyc, ixc])
        tau += np.where(inside, cov[iyc, ixc] * sigma * step, 0.0)
    return np.exp(-tau)


def shading_normal(g, detail=0.12, clump=0.4, bend=1.7):
    """The normal the 2D lighting uses: crown hull + clump-scale bumps + a little leaf detail,
    bent out toward the silhouette (leaves); bark keeps its baked normal."""
    leaf = g["leaf"][..., None]
    n_leaf, hull = g["normal"], g["hull"]
    nd = hull * (1 - detail - clump) + g["clump"] * clump + n_leaf * detail
    nd = nd / np.linalg.norm(nd, axis=-1, keepdims=True)
    nd = np.concatenate([nd[..., :2] * bend, nd[..., 2:]], -1)
    nd = nd / np.linalg.norm(nd, axis=-1, keepdims=True)
    nd = nd * leaf + n_leaf * (1 - leaf)
    return nd / np.linalg.norm(nd, axis=-1, keepdims=True)


def shade(g, lights, sky=np.array([0.22, 0.3, 0.45]), ground=np.array([0.12, 0.1, 0.07]), detail=0.12, clump=0.4, bend=1.7, trans_pow=1.3,
          trans_col=np.array([0.9, 1.0, 0.35])):
    """Linear irradiance-weighted colour components. Returns (diffuse irradiance E (H,W,3), lit rgb)."""
    m = g["mask"]
    H, W = m.shape
    leaf = g["leaf"][..., None]
    s = g["spread"][..., None]
    nd = shading_normal(g, detail, clump, bend)
    n_short = nd * (s * leaf + (1 - leaf))
    zs = g["meta"]["zscale"]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    P = np.stack([xx + 0.5, (H - yy) - 0.5, np.where(m, g["dfront"] * zs, 0)], -1)

    E = np.zeros((H, W, 3))
    T = np.zeros((H, W, 3))
    for lt in lights:
        col = np.array(lt["color"], np.float64) * lt.get("intensity", 1.0)
        if lt["type"] == "dir":
            d = np.array(lt["dir"], np.float64)
            d /= np.linalg.norm(d)
            L_at = lambda x, y, z, d=d: np.broadcast_to(d, x.shape + (3,))
            att = np.ones((H, W))
        else:
            lp = np.array(lt["pos"], np.float64)
            def L_at(x, y, z, lp=lp):
                v = np.stack([lp[0] - x, lp[1] - y, lp[2] - z], -1)
                return v / np.linalg.norm(v, axis=-1, keepdims=True)
            dist = np.linalg.norm(lp - P, axis=-1)
            r = lt.get("radius", 60.0)
            att = 1.0 / (1.0 + (dist / r) ** 2) * np.clip(1 - (dist / (r * 4)) ** 2, 0, 1) ** 2
        Ld = L_at(P[..., 0], P[..., 1], P[..., 2])
        sh = self_shadow(g, L_at, sigma=lt.get("sigma", 0.22))
        ndl = np.maximum((n_short * Ld).sum(-1), 0)
        ndl_dir = (nd * Ld).sum(-1)
        E += (ndl * sh * att)[..., None] * col
        # transmission: light that came through the leaves (softer extinction: scattered forward)
        # forward-scatter lobe through the traced crown path (same as viewer/index.html transLobe)
        tw = (0.12 + 0.55 * np.maximum(-Ld[..., 2], 0) ** 1.5) * sh ** trans_pow * att
        T += tw[..., None] * col
    amb = sky * g["sky"][..., None] * (0.55 + 0.45 * np.clip(nd[..., 1:2], 0, 1)) + ground * np.clip(-nd[..., 1:2] + 0.3, 0, 1)
    amb = amb * g["ao"][..., None]
    alb = g["albedo"]
    E_all = E + amb
    lit = alb * E_all + alb * trans_col * T * g["leaf"][..., None] * 2.0
    return E_all, lit


# --- stylize -------------------------------------------------------------------------------------

def ramp(base, n, lo=0.10, hi=1.0, shadow_tint=(0.78, 0.86, 1.30), light_tint=(1.08, 1.04, 0.86)):
    """n colours from dark to light for a material: value scaled, hue shifted cool -> warm."""
    base = np.asarray(base, np.float64)
    out = []
    for k in range(n):
        t = k / (n - 1)
        v = lo + (hi - lo) * t ** 1.15
        tint = np.array(shadow_tint) * (1 - t) + np.array(light_tint) * t
        c = base * tint
        c = c / max((c * LUM).sum(), 1e-6) * (base * LUM).sum()  # keep luminance
        # lift saturation in the mid tones a touch (pixel-art palettes are punchier than PBR)
        mean = c.mean()
        c = mean + (c - mean) * (1.0 + 0.2 * np.sin(np.pi * t) - 0.15 * t)
        out.append(np.clip(c * v, 0, None))
    return np.array(out)


def to_srgb8(c):
    return (np.clip(c, 0, 1) ** (1 / 2.2) * 255 + 0.5).astype(np.uint8)


def stylize(g, E, lit, bands=5, exposure=1.0, dither=False, outline=True, tex=0.5, dither_amp=0.3, clean=1, hi=1.6):
    """Band the light, colour from material ramps. Returns uint8 RGBA."""
    m = g["mask"]
    H, W = m.shape
    alb = g["albedo"]
    leaf = g["leaf"] > 0.5
    meta = g["meta"]
    # brightness of the pixel relative to its material's albedo (light + texture detail)
    Iv = (lit * LUM).sum(-1)
    base_leaf, base_bark = np.array(meta["leaf_albedo"]), np.array(meta["bark_albedo"])
    mat_l = np.where(leaf, (base_leaf * LUM).sum(), (base_bark * LUM).sum())
    rel = Iv / np.maximum(mat_l, 1e-6) * exposure
    # albedo texture (darker/lighter leaves) folded in at reduced strength
    alb_rel = (alb * LUM).sum(-1) / np.maximum(mat_l, 1e-6)
    rel = rel * alb_rel ** (tex - 1.0)
    t = np.clip(rel / 1.7, 0, 1) ** 0.8  # tone curve into ramp position
    q = t * (bands - 1)
    if dither:
        yy, xx = np.mgrid[0:H, 0:W]
        q = q + BAYER4[yy % 4, xx % 4] * dither_amp
    idx = np.clip(np.round(q), 0, bands - 1).astype(int)
    for _ in range(clean):
        idx = despeckle(idx, m, leaf)
    rl = ramp(base_leaf / (base_leaf * LUM).sum() * 0.25, bands, hi=hi)
    rb = ramp(base_bark / (base_bark * LUM).sum() * 0.22, bands, hi=hi * 0.8)
    col = np.where(leaf[..., None], rl[idx], rb[idx])
    # light colour: tint by the chroma of the irradiance (coloured lights read in the ramp)
    El = np.maximum((E * LUM).sum(-1, keepdims=True), 1e-6)
    chroma = E / El
    col = col * chroma ** 0.6
    # transmission glow adds warm-green highlights where light comes through
    rgba = np.dstack([to_srgb8(col), (m * 255).astype(np.uint8)])
    if outline:
        rgba = sel_out(rgba)
    return rgba


def despeckle(idx, m, leaf):
    """Pixel-art cluster cleanup: a pixel whose band no 4-neighbour shares takes the most common
    band of its 8 neighbours (same material, inside the sprite). Removes single-pixel noise."""
    H, W = idx.shape
    P = np.pad(idx, 1, constant_values=-1)
    Pm = np.pad(m & True, 1)
    Pl = np.pad(leaf, 1)
    nbr = [(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx]
    sl = lambda A, dy, dx: A[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
    same4 = np.zeros((H, W), bool)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        same4 |= (sl(P, dy, dx) == idx)
    counts = np.zeros((H, W, int(idx.max()) + 1))
    for dy, dx in nbr:
        v = sl(P, dy, dx)
        ok = sl(Pm, dy, dx) & (sl(Pl, dy, dx) == leaf) & (v >= 0)
        for b in range(counts.shape[2]):
            counts[..., b] += ok & (v == b)
    best = counts.argmax(-1)
    has = counts.sum(-1) >= 3
    return np.where(m & ~same4 & has, best, idx)


def sel_out(rgba):
    """Selective outline: exterior edge pixels darkened toward a deep shade of themselves."""
    a = rgba[..., 3] > 0
    p = np.pad(a, 1)
    H, W = a.shape
    nb = [p[1 + dy:1 + dy + H, 1 + dx:1 + dx + W] for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1))]
    edge = a & ~(nb[0] & nb[1] & nb[2] & nb[3])
    out = rgba.copy()
    c = out[..., :3].astype(np.float64)
    dark = c * np.array([0.45, 0.5, 0.62])
    # only darken edges that are not lit (keeps light rims readable)
    lum = (c * LUM).sum(-1)
    k = np.where(lum < 90, 1.0, 0.35)[..., None]
    out[..., :3] = np.where(edge[..., None], (c * (1 - k) + dark * k), c).astype(np.uint8)
    return out


PRESETS = {
    "sun_left": dict(lights=[dict(type="dir", dir=[-0.75, 0.55, 0.35], color=[1.0, 0.93, 0.8], intensity=2.6)]),
    "sun_high_right": dict(lights=[dict(type="dir", dir=[0.45, 0.85, 0.3], color=[1.0, 0.96, 0.88], intensity=2.6)]),
    "backlit": dict(lights=[dict(type="dir", dir=[0.35, 0.35, -0.87], color=[1.0, 0.78, 0.5], intensity=2.8)],
                    sky=np.array([0.2, 0.22, 0.32])),
    "torch_night": dict(lights=[dict(type="point", pos=[8, 30, 18], color=[1.0, 0.55, 0.22], intensity=9.0, radius=22)],
                        sky=np.array([0.025, 0.04, 0.1]), ground=np.array([0.01, 0.01, 0.02]), clump=0.5),
}


def render(g, preset, **kw):
    p = dict(PRESETS[preset])
    lights = p.pop("lights")
    E, lit = shade(g, lights, **p)
    return stylize(g, E, lit, **kw), lit


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sprite")
    ap.add_argument("out")
    ap.add_argument("--scale", type=int, default=4)
    ap.add_argument("--bands", type=int, default=5)
    ap.add_argument("--dither", action="store_true")
    ap.add_argument("--nooutline", action="store_true")
    a = ap.parse_args()
    g = load(a.sprite)
    H, W = g["mask"].shape
    names = list(PRESETS)
    bgs = {"sun_left": (120, 170, 200), "sun_high_right": (130, 180, 210), "backlit": (230, 170, 120), "torch_night": (14, 16, 30)}
    sheet = Image.new("RGB", (len(names) * (W + 8) * a.scale, (H + 8) * a.scale * 2))
    for i, nm in enumerate(names):
        st, lit = render(g, nm, bands=a.bands, dither=a.dither, outline=not a.nooutline)
        for row, img in enumerate([st, np.dstack([to_srgb8(lit / (1 + lit)), (g["mask"] * 255).astype(np.uint8)])]):
            bg = Image.new("RGB", (W + 8, H + 8), bgs[nm])
            bg.paste(Image.fromarray(img, "RGBA"), (4, 4), Image.fromarray(img, "RGBA"))
            sheet.paste(bg.resize(((W + 8) * a.scale, (H + 8) * a.scale), Image.NEAREST), (i * (W + 8) * a.scale, row * (H + 8) * a.scale))
    sheet.save(a.out)
    print("wrote", a.out)


if __name__ == "__main__":
    main()
