"""Pack sprite G-buffers for the WebGL viewer (viewer/index.html).

    python tools/export_viewer.py sprites/alder_a [more sprite dirs...]

Writes into each sprite dir:
  v_albedo.png  rgb = albedo (sRGB), a = 1-bit alpha
  v_normal.png  rgb = shading normal * 0.5 + 0.5 (view space), a = normal spread
  v_data.png    r = front depth, g = back depth (0.5 + d / (2 * depth_range), in bounding radii;
                times zscale = sprite pixels), b = AO, a = sky visibility
  v_mat.png     r = coverage, g = leafiness
and lists them in viewer/sprites.json.
"""
import json, os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import render2d

u8 = lambda x: (np.clip(x, 0, 1) * 255 + 0.5).astype(np.uint8)
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
index = []
for d in sys.argv[1:]:
    g = render2d.load(d)
    m = g["mask"]
    nd = render2d.shading_normal(g)
    D = g["meta"]["depth_range"]
    alb = np.clip(g["albedo"], 0, 1) ** (1 / 2.2)
    Image.fromarray(u8(np.dstack([alb, m]))).save(os.path.join(d, "v_albedo.png"))
    Image.fromarray(u8(np.dstack([nd * 0.5 + 0.5, g["spread"]]))).save(os.path.join(d, "v_normal.png"))
    Image.fromarray(u8(np.dstack([0.5 + g["dfront"] / (2 * D), 0.5 + g["dback"] / (2 * D), g["ao"], g["sky"]]))).save(os.path.join(d, "v_data.png"))
    Image.fromarray(u8(np.dstack([g["cov"], g["leaf"], np.zeros_like(g["cov"]), np.ones_like(g["cov"])]))).save(os.path.join(d, "v_mat.png"))
    meta = dict(g["meta"])
    meta["dir"] = os.path.relpath(os.path.abspath(d), root).replace("\\", "/")
    index.append(meta)
    print("packed", d)
os.makedirs(os.path.join(root, "viewer"), exist_ok=True)
with open(os.path.join(root, "viewer", "sprites.json"), "w") as f:
    json.dump(index, f, indent=1)
