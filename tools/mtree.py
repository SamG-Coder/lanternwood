"""Read the plant table (names and bounding boxes) of SmartImposter .mtree packs without loading
the meshes (src/asset.rs load: the mesh arrays are skipped by seeking)."""
import os
import struct


def plants(path):
    """{variant name: (bmin xyz, bmax xyz)} of one .mtree file."""
    out = {}
    with open(path, "rb") as f:
        rd = lambda n: f.read(n)
        u32 = lambda: struct.unpack("<I", rd(4))[0]
        assert rd(4) == b"MTRE", path
        version = u32()
        for _ in range(u32()):
            f.seek(u32(), 1)  # name
            v, t = u32(), u32()
            skip = v * 3 * 4 * 2 + (v * 2 * 4 if version >= 2 else 0) + t * 3 * 4 + (t + 3) // 4 * 4
            f.seek(skip, 1)
        for _ in range(u32()):
            name = rd(u32()).decode("utf-8", "replace")
            b = struct.unpack("<6f", rd(24))
            n = u32()
            f.seek(n * (4 + 48), 1)
            out[name] = (b[:3], b[3:])
    return out


def all_plants(species_dir):
    """{variant name: dict(species, bmin, bmax, height)} over every pack in a directory."""
    res = {}
    for fn in sorted(os.listdir(species_dir)):
        if fn.endswith(".mtree"):
            sp = fn[:-6]
            for name, (lo, hi) in plants(os.path.join(species_dir, fn)).items():
                res[name] = dict(species=sp, bmin=lo, bmax=hi, height=hi[1] - lo[1])
    return res


if __name__ == "__main__":
    import sys
    d = sys.argv[1] if len(sys.argv) > 1 else "D:/SmartImposter/assets/species"
    p = all_plants(d)
    for k, v in p.items():
        print(f"{k:40s} {v['species']:28s} h={v['height']:.2f} m  w={v['bmax'][0] - v['bmin'][0]:.2f}")
    print(len(p), "variants")
