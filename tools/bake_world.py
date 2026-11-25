"""Offline bake of the RPG world: SmartImposter impostor bakes -> lit-ready pixel sprites for the
web game in docs/ (GitHub Pages).

    python tools/bake_world.py [--si D:/SmartImposter] [--out docs] [--only-world]

1. Lays out the world (tools/world_gen.py) -> docs/data/world.json
2. For every (variant, scale) the world uses, reads the variant's side view + opposite view from
   the SmartImposter cache and writes one PNG: four maps side by side, each W x H:
     [albedo sRGB + alpha] [shading normal + spread] [front depth, back depth, ao, sky] [coverage, leaf, -, -]
   Depths are metres from the plant's centre plane toward the camera / away: 0.5 + m / (2 * dmax).
3. docs/data/catalog.json: per variant its kind, real size (from the .mtree bounds), crown shape
   (for the runtime canopy shadow volume), transmission colour, and per scale the sprite's size,
   ground row and depth range.

Every asset is resampled to an exact pixels-per-metre scale, so plants keep true relative sizes.
"""
import argparse, glob, json, math, os, sys, time
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import bcread, mtree
from make_sprite import gauss_blur, clean_alpha
import world_gen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ------------------------------------------------------------------ resampling
def area_matrix(n_in, n_out, scale):
    """(n_out, n_in) area-averaging matrix: output pixel i covers input [i/scale, (i+1)/scale)."""
    M = np.zeros((n_out, n_in), np.float32)
    inv = 1.0 / scale
    for i in range(n_out):
        a, b = i * inv, (i + 1) * inv
        j0, j1 = int(math.floor(a)), int(math.ceil(b))
        for j in range(max(j0, 0), min(j1, n_in)):
            w = min(b, j + 1) - max(a, j)
            if w > 0:
                M[i, j] = w
    s = M.sum(1, keepdims=True)
    return M / np.maximum(s, 1e-8)


def resample(img, My, Mx, w=None):
    """Area resample (H, W[, C]) with optional weight map: sum(img * w) / sum(w)."""
    two = img.ndim == 2
    x = (img[..., None] if two else img).astype(np.float32)
    def sep(v):  # (H, W, C) -> (Ho, Wo, C) with two BLAS matrix products
        H, W, C = v.shape
        t = (My @ v.reshape(H, W * C)).reshape(-1, W, C)          # rows
        t = np.ascontiguousarray(t.transpose(0, 2, 1))            # (Ho, C, W)
        return (t @ Mx.T).transpose(0, 2, 1)                      # (Ho, Wo, C)
    if w is None:
        out = sep(x)
    else:
        w = w.astype(np.float32)
        num = sep(x * w[..., None])
        den = My @ w @ Mx.T
        out = num / np.maximum(den, 1e-6)[..., None]
    return out[..., 0] if two else out


def height_normal(h, sigma):
    hb = gauss_blur(h, sigma)
    gy, gx = np.gradient(hb)
    n = np.stack([-gx, gy, np.ones_like(gx)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


# ------------------------------------------------------------------ per variant
class Variant:
    def __init__(self, path, name, info, spjson):
        self.path, self.name, self.info, self.sp = path, name, info, spjson
        hd = bcread.read_header(path)
        g = hd["grid"]
        self.front = bcread.read_view(path, (g - 1, g - 1), 0)
        self.back = bcread.read_view(path, (0, 0), 0)
        cov = self.front["coverage"]
        rows = np.where((cov > 0.02).any(1))[0]
        self.top, self.bottom = int(rows.min()), int(rows.max())
        self.texel_m = info["height"] / max(self.bottom - self.top + 1, 1)
        lo, hi = np.array(info["bmin"]), np.array(info["bmax"])
        self.r_m = float(np.linalg.norm(hi - lo) * 0.5)
        self.kind = spjson.get("kind", "tree") if spjson else "tree"
        self.solid = self.kind == "rock"
        self.foliage_only = self.kind in ("grass", "plant") or (self.kind == "shrub")

    def sprite(self, ppm):
        """The sprite G-buffer at `ppm` pixels per metre."""
        f, b = self.front, self.back
        scale = self.texel_m * ppm  # output pixels per texel
        H0, W0 = f["coverage"].shape
        Ho, Wo = max(int(math.ceil(H0 * scale)), 3), max(int(math.ceil(W0 * scale)), 3)
        My, Mx = area_matrix(H0, Ho, scale), area_matrix(W0, Wo, scale)
        cov = f["coverage"]
        c = resample(cov, My, Mx)
        alb = resample(f["albedo"], My, Mx, cov)
        n = resample(f["normal"] * f["spread"][..., None], My, Mx, cov)
        spread = np.clip(np.linalg.norm(n, axis=-1), 0.05, 1.0)
        n = n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
        ao = resample(f["ao"], My, Mx, cov)
        sky = resample(f["sky"], My, Mx, cov)
        dfront = resample(f["depth"], My, Mx, cov) * self.r_m
        bcov = b["coverage"][:, ::-1]
        dback = -resample(b["depth"][:, ::-1], My, Mx, bcov) * self.r_m
        bc = resample(bcov, My, Mx)
        dback = np.where(bc > 0.05, dback, -dfront)
        dback = np.minimum(dback, dfront - 0.5 / ppm)

        # alpha: a lower threshold for tiny sprites keeps thin things (grass blades, far trees)
        thr = 0.32 if Ho > 24 else 0.22
        mask = c >= thr
        if Ho > 12:
            mask = clean_alpha(mask, 1)

        g_r = alb[..., 1] / np.maximum(alb[..., 0], 1e-4)
        chroma = (alb[..., 1] - alb[..., 2]) / np.maximum(alb[..., 1], 1e-4)
        leaf = np.clip((g_r - 0.85) / 0.15, 0, 1) * np.clip((chroma - 0.35) / 0.2, 0, 1)
        if self.solid:
            leaf[:] = 0
        elif self.foliage_only:
            leaf[:] = 1

        # shading normal: crown hull + clump bumps + a little leaf detail, bent out (leaves)
        zpx = np.where(mask, (dfront - dback) * 0.5 * ppm, 0.0)
        hull = height_normal(zpx, max(0.06 * Ho, 1.0))
        clump = height_normal(np.where(mask, dfront * ppm, dfront[mask].min() * ppm - 3 if mask.any() else 0), 1.6)
        nd = hull * 0.48 + clump * 0.4 + n * 0.12
        nd /= np.linalg.norm(nd, axis=-1, keepdims=True)
        nd = np.concatenate([nd[..., :2] * 1.7, nd[..., 2:]], -1)
        nd /= np.linalg.norm(nd, axis=-1, keepdims=True)
        lf = leaf[..., None]
        nd = nd * lf + n * (1 - lf)
        nd /= np.maximum(np.linalg.norm(nd, axis=-1, keepdims=True), 1e-6)
        nd = np.where(mask[..., None], nd, np.array([0, 0, 1.0]))

        # ground row (sprite row of the plant's base, from the bottom) and depth range
        sb = int(round((H0 - 1 - self.bottom) * scale))
        dmax = float(max(np.abs(dfront[mask]).max() if mask.any() else 0.1, np.abs(dback[mask]).max() if mask.any() else 0.1, 0.05)) * 1.02
        srgb = lambda x: np.clip(x, 0, 1) ** (1 / 2.2)
        A = mask.astype(np.float32)
        maps = [
            np.dstack([srgb(alb), A]),
            np.dstack([nd * 0.5 + 0.5, spread]),
            np.dstack([0.5 + dfront / (2 * dmax), 0.5 + dback / (2 * dmax), ao, sky]),
            np.dstack([c, leaf, np.zeros_like(c), np.ones_like(c)]),
        ]
        img = np.concatenate(maps, 1)
        img = (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)
        # leaf / bark mean colours (linear) and crown extent for the canopy volume
        lm = mask & (leaf > 0.5)
        bm = mask & (leaf <= 0.5)
        meta = dict(w=Wo, h=Ho, base=sb, dmax=dmax,
                    leaf=(alb[lm].mean(0).tolist() if lm.any() else [0.08, 0.11, 0.03]),
                    bark=(alb[bm].mean(0).tolist() if bm.any() else [0.12, 0.1, 0.08]))
        return img, meta, mask, leaf

    def crown(self):
        """Crown shape in metres for the canopy shadow volume: bottom, top height, radius."""
        f = self.front
        cov = f["coverage"] > 0.3
        alb = f["albedo"]
        g_r = alb[..., 1] / np.maximum(alb[..., 0], 1e-4)
        leafy = cov & (g_r > 1.0) if not self.solid else cov
        H0 = cov.shape[0]
        widths = leafy.sum(1)
        if widths.max() == 0:
            leafy, widths = cov, cov.sum(1)
        rows = np.where(widths > 0.15 * widths.max())[0]
        hb = (self.bottom - rows.max()) * self.texel_m
        ht = (self.bottom - rows.min()) * self.texel_m
        cols = np.where(leafy.any(0))[0]
        rad = (cols.max() - cols.min() + 1) * 0.5 * self.texel_m if len(cols) else 0.5
        # leaf density: how much of the crown silhouette is covered
        sil = leafy[rows.min():rows.max() + 1]
        dens = float(f["coverage"][rows.min():rows.max() + 1][sil].mean()) if sil.any() else 0.5
        return dict(hb=float(max(hb, 0)), ht=float(ht), rad=float(rad), dens=dens)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--si", default="D:/SmartImposter")
    ap.add_argument("--out", default=os.path.join(ROOT, "bake"), help="private bake output (not published)")
    ap.add_argument("--pack", default=os.path.join(ROOT, "docs", "data", "world.rtp"), help="the distribution file")
    ap.add_argument("--only-world", action="store_true")
    a = ap.parse_args()
    t0 = time.time()

    plants = mtree.all_plants(os.path.join(a.si, "assets", "species"))
    cache = {}
    for p in glob.glob(os.path.join(a.si, "assets", "cache", "impostors", "*.bc")):
        name = os.path.basename(p).rsplit("-", 1)[0]
        if name in plants:
            cache[name] = p
    species = {}
    for sp in {v["species"] for v in plants.values()}:
        jp = os.path.join(a.si, "assets", "species", sp + ".json")
        species[sp] = json.load(open(jp)) if os.path.exists(jp) else {}
    avail = {n: dict(species=plants[n]["species"], height=plants[n]["height"],
                     width=plants[n]["bmax"][0] - plants[n]["bmin"][0], kind=species[plants[n]["species"]].get("kind", "tree"))
             for n in cache}
    print(f"{len(cache)} baked variants available of {len(plants)}")

    world = world_gen.generate(avail)
    os.makedirs(os.path.join(a.out, "data"), exist_ok=True)
    os.makedirs(os.path.join(a.out, "sprites"), exist_ok=True)
    with open(os.path.join(a.out, "data", "world.json"), "w") as fh:
        json.dump(world, fh, separators=(",", ":"))
    print(f"world: {len(world['objects'])} objects, {len(world['regions'])} regions")
    if a.only_world:
        return

    need = {}
    for o in world["objects"]:
        need.setdefault(o["v"], set()).add(o["s"])
    catalog = {}
    for i, (name, scales) in enumerate(sorted(need.items())):
        sp = plants[name]["species"]
        v = Variant(cache[name], name, plants[name], species[sp])
        trans = species[sp].get("translucency_tint", [0.45, 0.5, 0.2])
        entry = dict(species=sp, kind=v.kind, height=plants[name]["height"], r=v.r_m,
                     crown=v.crown(), trans=trans, scales={})
        for s in sorted(scales):
            ppm = world_gen.SCALES[s]
            img, meta, _, _ = v.sprite(ppm)
            fn = f"{name}@{s}.png"
            Image.fromarray(img).save(os.path.join(a.out, "sprites", fn), optimize=True)
            meta["file"] = fn
            entry["scales"][str(s)] = meta
        catalog[name] = entry
        print(f"[{i + 1}/{len(need)}] {name}: scales {sorted(scales)} ({time.time() - t0:.0f}s)")
    with open(os.path.join(a.out, "data", "catalog.json"), "w") as fh:
        json.dump(dict(scales=world_gen.SCALES, variants=catalog), fh, separators=(",", ":"))
    # drop sprites no longer used
    keep = {m["file"] for e in catalog.values() for m in e["scales"].values()}
    for p in glob.glob(os.path.join(a.out, "sprites", "*.png")):
        if os.path.basename(p) not in keep:
            os.remove(p)
    total = sum(os.path.getsize(os.path.join(a.out, "sprites", f)) for f in keep)
    print(f"baked {len(keep)} sprites ({total / 1e6:.1f} MB of PNG, private) in {time.time() - t0:.0f}s")
    # raw strips for the packer, then the one distribution file
    index, off = {}, 0
    with open(os.path.join(a.out, "raw.bin"), "wb") as fh:
        for fn in sorted(keep):
            img = np.array(Image.open(os.path.join(a.out, "sprites", fn)).convert("RGBA"))
            h, w4 = img.shape[:2]
            fh.write(img.tobytes())
            index[fn] = [off, w4 // 4, h]
            off += img.nbytes
    with open(os.path.join(a.out, "raw.json"), "w") as fh:
        json.dump(index, fh)
    import subprocess
    subprocess.run(["node", os.path.join(ROOT, "tools", "pack.mjs"), a.out, a.pack], check=True)
    subprocess.run([sys.executable, os.path.join(ROOT, "tools", "stamp.py")], check=True)   # fresh URLs for the new pack


if __name__ == "__main__":
    main()
