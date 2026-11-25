"""Read SmartImposter impostor cache files (assets/cache/impostors/*.bc).

File layout (src/atlas.rs): header (magic SIIMP\\0\\0\\x03, key u64, grid, res_x, res_y, mips,
stream_len as u32) then the BC block stream: for each level 0..mips the albedo (BC3), normal
(BC5) and depth (BC5) atlases, then the half-resolution visibility (BC3) levels 1..mips.

Channel meaning (shaders/bake.rgen, shaders/bcenc.comp):
  albedo BC3:  rgb = sqrt(albedo), a = ray traced AO x material AO
  normal BC5:  rg  = octahedral object-space normal * 0.5 + 0.5
  depth  BC5:  r   = depth toward the viewer (1.05 - t/R) * 0.5 + 0.5,  g = coverage
  vis    BC3:  rgb = (normal spread, b.y/3+0.5, b.z/3+0.5), a = sky visibility a
Texel row 0 is the bottom of the frame (frame up = +u).
"""
import struct
import numpy as np

MAGIC = b"SIIMP\0\0\x03"
HEADER = 8 + 8 + 5 * 4


def read_header(path):
    with open(path, "rb") as f:
        h = f.read(HEADER)
    assert h[:8] == MAGIC, f"not an impostor cache: {path}"
    key = struct.unpack_from("<Q", h, 8)[0]
    grid, rx, ry, mips, slen = struct.unpack_from("<5I", h, 16)
    return dict(key=key, grid=grid, res=(rx, ry), mips=mips, stream=slen)


def layout(grid, res, mips):
    out, off = [], 0

    def push(img, src_level, level):
        nonlocal off
        s = ((grid * res[0]) >> src_level, (grid * res[1]) >> src_level)
        n = (s[0] // 4) * (s[1] // 4) * 16
        out.append(dict(img=img, level=level, size=s, offset=off, bytes=n))
        off += n

    for level in range(mips):
        for img in range(3):
            push(img, level, level)
    for level in range(1, mips):
        push(3, level, level - 1)
    return out


def _bc4(b):
    """b: (N, 8) uint8 -> (N, 16) float in [0,1]."""
    e0 = b[:, 0].astype(np.float32)
    e1 = b[:, 1].astype(np.float32)
    bits = np.zeros(len(b), dtype=np.uint64)
    for i in range(6):
        bits |= b[:, 2 + i].astype(np.uint64) << np.uint64(8 * i)
    idx = np.stack([(bits >> np.uint64(3 * i)) & np.uint64(7) for i in range(16)], 1).astype(np.int64)
    pal = np.zeros((len(b), 8), np.float32)
    pal[:, 0], pal[:, 1] = e0, e1
    gt = e0 > e1
    for k in range(1, 7):  # 8-value mode
        pal[:, k + 1] = np.where(gt, ((7 - k) * e0 + k * e1) / 7.0, pal[:, k + 1])
    for k in range(1, 5):  # 6-value mode
        pal[:, k + 1] = np.where(gt, pal[:, k + 1], ((5 - k) * e0 + k * e1) / 5.0)
    pal[:, 6] = np.where(gt, pal[:, 6], 0.0)
    pal[:, 7] = np.where(gt, pal[:, 7], 255.0)
    return np.take_along_axis(pal, idx, 1) / 255.0


def _565(c):
    r = ((c >> 11) & 31) / 31.0
    g = ((c >> 5) & 63) / 63.0
    bl = (c & 31) / 31.0
    return np.stack([r, g, bl], -1).astype(np.float32)


def _bc1(b):
    """b: (N, 8) uint8 -> (N, 16, 3), always 4-colour mode (as in BC3)."""
    c0 = b[:, 0].astype(np.int64) | (b[:, 1].astype(np.int64) << 8)
    c1 = b[:, 2].astype(np.int64) | (b[:, 3].astype(np.int64) << 8)
    p0, p1 = _565(c0), _565(c1)
    pal = np.stack([p0, p1, (2 * p0 + p1) / 3, (p0 + 2 * p1) / 3], 1)  # (N,4,3)
    bits = b[:, 4].astype(np.int64) | (b[:, 5].astype(np.int64) << 8) | (b[:, 6].astype(np.int64) << 16) | (b[:, 7].astype(np.int64) << 24)
    idx = np.stack([(bits >> (2 * i)) & 3 for i in range(16)], 1)
    return np.take_along_axis(pal, idx[:, :, None].repeat(3, 2), 1)


def _blocks_to_image(vals, bx, by, ch):
    """vals: (bx*by, 16, ch) in block order -> (by*4, bx*4, ch)."""
    v = vals.reshape(by, bx, 4, 4, ch)
    return v.transpose(0, 2, 1, 3, 4).reshape(by * 4, bx * 4, ch)


def decode_region(raw, region, x0=0, y0=0, w=None, h=None):
    """Decode a texel rectangle (multiples of 4) of a region. Returns (h, w, 4) float32, row 0 = bottom."""
    W, H = region["size"]
    w = W if w is None else w
    h = H if h is None else h
    bxs, bys = x0 // 4, y0 // 4
    bw, bh = w // 4, h // 4
    BX = W // 4
    data = np.frombuffer(raw, np.uint8, count=region["bytes"], offset=HEADER + region["offset"]).reshape(-1, 16)
    rows = [data[(bys + j) * BX + bxs:(bys + j) * BX + bxs + bw] for j in range(bh)]
    blk = np.concatenate(rows, 0)
    img = region["img"]
    if img in (1, 2):  # BC5
        r = _bc4(blk[:, :8])
        g = _bc4(blk[:, 8:])
        vals = np.stack([r, g, np.zeros_like(r), np.ones_like(r)], -1)
    else:  # BC3
        a = _bc4(blk[:, :8])
        c = _bc1(blk[:, 8:])
        vals = np.concatenate([c, a[:, :, None]], -1)
    return _blocks_to_image(vals, bw, bh, 4)


def oct_decode(e):
    """e: (..., 2) in [-1,1] -> unit vectors (..., 3), Y up (shaders/shared.glsl octDecode)."""
    x, z = e[..., 0], e[..., 1]
    y = 1.0 - np.abs(x) - np.abs(z)
    neg = y < 0
    sx = np.where(x >= 0, 1.0, -1.0)
    sz = np.where(z >= 0, 1.0, -1.0)
    nx = np.where(neg, (1.0 - np.abs(z)) * sx, x)
    nz = np.where(neg, (1.0 - np.abs(x)) * sz, z)
    v = np.stack([nx, y, nz], -1)
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-8)


def hemi_oct_decode(uv):
    o = np.asarray(uv, np.float64) * 2 - 1
    p = np.array([o[0] + o[1], o[0] - o[1]]) * 0.5
    v = np.array([p[0], 1 - abs(p[0]) - abs(p[1]), p[1]])
    return v / np.linalg.norm(v)


def frame_basis(f):
    up = np.array([0, 0, -1.0]) if abs(f[1]) > 0.999 else np.array([0, 1.0, 0])
    r = np.cross(up, f)
    r /= np.linalg.norm(r)
    u = np.cross(f, r)
    return r, u


def frame_dir(cell, grid):
    return hemi_oct_decode(np.array(cell, np.float64) / (grid - 1))


def read_view(path, cell, level=0):
    """One baked view of a variant at mip `level`, as view-space G-buffer maps (row 0 = top)."""
    hd = read_header(path)
    grid, res, mips = hd["grid"], hd["res"], hd["mips"]
    with open(path, "rb") as f:
        raw = f.read()
    regs = layout(grid, res, mips)
    fw, fh = res[0] >> level, res[1] >> level
    cx, cy = cell

    def get(img, lvl, scale=1):
        r = next(r for r in regs if r["img"] == img and r["level"] == lvl)
        w, h = fw // scale, fh // scale
        w4, h4 = max(4, (w + 3) // 4 * 4), max(4, (h + 3) // 4 * 4)
        x0, y0 = cx * w, cy * h
        # frames sit at multiples of the frame size; decode the covering 4-aligned window
        ax, ay = x0 // 4 * 4, y0 // 4 * 4
        ww = min(((x0 + w + 3) // 4 * 4) - ax, r["size"][0] - ax)
        hh = min(((y0 + h + 3) // 4 * 4) - ay, r["size"][1] - ay)
        im = decode_region(raw, r, ax, ay, ww, hh)
        return im[y0 - ay:y0 - ay + h, x0 - ax:x0 - ax + w]

    alb = get(0, level)
    nrm = get(1, level)
    dep = get(2, level)
    vis = get(3, level, 2)  # half resolution of this level
    vis = np.repeat(np.repeat(vis, 2, 0), 2, 1)[:fh, :fw]

    f = frame_dir(cell, grid)
    r, u = frame_basis(f)
    n_obj = oct_decode(nrm[..., :2] * 2 - 1)
    n_view = np.stack([n_obj @ r, n_obj @ u, n_obj @ f], -1)  # x right, y up, z toward viewer

    out = dict(
        albedo=alb[..., :3] ** 2,  # linear
        ao=alb[..., 3],
        normal=n_view,
        depth=dep[..., 0] * 2 - 1,  # toward viewer, in bounding radii
        coverage=dep[..., 1],
        spread=vis[..., 0],
        sky=np.clip(vis[..., 3] + (2 / 3) * (vis[..., 1] - 0.5) * 3, 0, 1),
    )
    # flip so row 0 = top (image convention)
    out = {k: v[::-1].copy() for k, v in out.items()}
    out["meta"] = dict(grid=grid, res=res, mips=mips, level=level, cell=list(cell), dir=f.tolist())
    return out
