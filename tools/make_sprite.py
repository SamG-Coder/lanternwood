"""Turn one SmartImposter impostor bake into a pixel-art sprite G-buffer.

    python tools/make_sprite.py <variant.bc> <out_dir> [--px 4] [--cell X,Y]

Reads the side view (default: the +X horizon frame) and the opposite view (for the back
surface), downsamples by an integer factor with coverage weighting, and writes:

  albedo.png   rgb = albedo (sRGB), a = 1-bit alpha
  normal.png   rgb = leaf normal * 0.5 + 0.5 (view space: x right, y up, z to viewer), a = spread
  hull.png     rgb = crown hull normal * 0.5 + 0.5 (smooth), a = leafiness
  data.png     r = front depth, g = back depth (both 0.5 + z / (2*D)), b = ao, a = sky
  sprite.json  sizes, depth scale (texels per unit), material info

All maps share one pixel grid, so lighting lands on exactly the pixels the art has.
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import bcread


def box(a, f, w=None):
    """Integer box downsample of (H, W, ...) by f, optionally weighted by w (H, W)."""
    H, W = a.shape[:2]
    H2, W2 = H // f * f, W // f * f
    a = a[:H2, :W2]
    if w is None:
        return a.reshape(H2 // f, f, W2 // f, f, *a.shape[2:]).mean((1, 3))
    w = w[:H2, :W2]
    ww = w.reshape(H2 // f, f, W2 // f, f)
    if a.ndim == 3:
        aw = (a * w[..., None]).reshape(H2 // f, f, W2 // f, f, a.shape[2]).sum((1, 3))
        return aw / np.maximum(ww.sum((1, 3)), 1e-6)[..., None]
    aw = (a * w).reshape(H2 // f, f, W2 // f, f).sum((1, 3))
    return aw / np.maximum(ww.sum((1, 3)), 1e-6)


def gauss_blur(a, sigma):
    if sigma <= 0:
        return a
    r = int(np.ceil(sigma * 3))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    out = a.astype(np.float64)
    for axis in (0, 1):
        pad = [(0, 0)] * out.ndim
        pad[axis] = (r, r)
        p = np.pad(out, pad, mode="edge")
        acc = np.zeros_like(out)
        for i, kv in enumerate(k):
            sl = [slice(None)] * out.ndim
            sl[axis] = slice(i, i + out.shape[axis])
            acc += kv * p[tuple(sl)]
        out = acc
    return out


def clean_alpha(m, iters=2):
    """Pixel-art silhouette cleanup: drop isolated pixels, fill 1-pixel holes."""
    m = m.copy()
    for _ in range(iters):
        p = np.pad(m, 1)
        n = sum(p[1 + dy:1 + dy + m.shape[0], 1 + dx:1 + dx + m.shape[1]] for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx)
        m = np.where(m & (n <= 1), False, m)  # lonely pixel
        m = np.where(~m & (n >= 6), True, m)  # pinhole
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("bc")
    ap.add_argument("out")
    ap.add_argument("--px", type=int, default=4, help="level-0 texels per sprite pixel")
    ap.add_argument("--cell", default=None, help="view cell X,Y (default: +X horizon)")
    ap.add_argument("--alpha", type=float, default=0.32, help="coverage threshold for the 1-bit alpha")
    ap.add_argument("--hull", type=float, default=0.06, help="hull blur, fraction of sprite height")
    a = ap.parse_args()

    hd = bcread.read_header(a.bc)
    g = hd["grid"]
    cell = tuple(int(x) for x in a.cell.split(",")) if a.cell else (g - 1, g - 1)
    opp = (g - 1 - cell[0], g - 1 - cell[1])  # the mirrored horizon frame (opposite direction)
    front = bcread.read_view(a.bc, cell, 0)
    back = bcread.read_view(a.bc, opp, 0)

    cov = front["coverage"]
    # back view: mirror horizontally into this view; its depth points the other way
    bcov = back["coverage"][:, ::-1]
    bdep = -back["depth"][:, ::-1]

    f = a.px
    c = box(cov, f)
    alb = box(front["albedo"], f, cov)
    # normals: average the *spread-scaled* unit normals, so the result's length is the spread
    # of everything under the sprite pixel (leaves inside a texel and texels inside a pixel)
    nw = front["normal"] * front["spread"][..., None]
    n = box(nw, f, cov)
    spread = np.clip(np.linalg.norm(n, axis=-1), 0.05, 1.0)
    n = n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    ao = box(front["ao"], f, cov)
    sky = box(front["sky"], f, cov)
    # front depth: the near-most surface in the pixel is what is seen; mean is steadier
    dfront = box(front["depth"], f, cov)
    dback = box(bdep, f, bcov)
    bc = box(bcov, f)
    dback = np.where(bc > 0.05, dback, -dfront)

    mask = clean_alpha(c >= a.alpha)

    # leafiness like the engine (impostor.rchit): bark is grey-brown, leaves have g/r > 1
    leaf = np.clip((alb[..., 1] / np.maximum(alb[..., 0], 1e-4) - 0.85) / 0.15, 0, 1)
    # ... and leaves are saturated (little blue): pale grey-green bark (beech) is not foliage
    chroma = (alb[..., 1] - alb[..., 2]) / np.maximum(alb[..., 1], 1e-4)
    leaf = leaf * np.clip((chroma - 0.35) / 0.2, 0, 1)

    # crown hull normal: gradient of the blurred front surface (depth + coverage). The real leaf
    # normals are noise at pixel scale; pixel art reads the crown as a few big lit volumes.
    H, W = mask.shape
    # depth scale: texels per bounding-radius unit, from the crown's half-width vs its depth
    xs = np.where(mask.any(0))[0]
    half_w = (xs.max() - xs.min() + 1) / 2 if len(xs) else W / 2
    dmax = max(float(np.percentile(dfront[mask], 99)), 1e-3)
    zscale = half_w / dmax  # sprite pixels per depth unit
    zf = np.where(mask, (dfront - dback) * 0.5 * zscale, 0.0)  # half-thickness as a height field
    sig = max(a.hull * H, 1.0)
    hz = gauss_blur(zf, sig)
    gy, gx = np.gradient(hz)
    hn = np.stack([-gx, gy, np.ones_like(gx) * 1.0], -1)  # image rows go down: +y up flips
    hn /= np.linalg.norm(hn, axis=-1, keepdims=True)

    os.makedirs(a.out, exist_ok=True)
    srgb = lambda x: np.clip(x, 0, 1) ** (1 / 2.2)
    u8 = lambda x: (np.clip(x, 0, 1) * 255 + 0.5).astype(np.uint8)
    A = mask.astype(np.float32)
    Image.fromarray(u8(np.dstack([srgb(alb), A]))).save(os.path.join(a.out, "albedo.png"))
    Image.fromarray(u8(np.dstack([n * 0.5 + 0.5, spread]))).save(os.path.join(a.out, "normal.png"))
    Image.fromarray(u8(np.dstack([hn * 0.5 + 0.5, leaf]))).save(os.path.join(a.out, "hull.png"))
    D = 1.2
    Image.fromarray(u8(np.dstack([0.5 + dfront / (2 * D), 0.5 + dback / (2 * D), ao, sky]))).save(os.path.join(a.out, "data.png"))
    meta = dict(
        source=os.path.basename(a.bc), cell=list(cell), px=f, width=int(W), height=int(H),
        depth_range=D, zscale=float(zscale),
        leaf_albedo=(alb[mask & (leaf > 0.5)].mean(0).tolist() if (mask & (leaf > 0.5)).any() else [0.1, 0.2, 0.05]),
        bark_albedo=(alb[mask & (leaf < 0.5)].mean(0).tolist() if (mask & (leaf < 0.5)).any() else [0.2, 0.15, 0.1]),
    )
    with open(os.path.join(a.out, "sprite.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    np.savez_compressed(os.path.join(a.out, "gbuf.npz"), albedo=alb, normal=n, spread=spread, hull=hn, leaf=leaf,
                        dfront=dfront, dback=dback, ao=ao, sky=sky, mask=mask, cov=c)
    print(f"{meta['source']}: {W}x{H} px sprite, zscale {zscale:.1f} px/unit -> {a.out}")


if __name__ == "__main__":
    main()
