"""Deterministic layout of the RPG world (used by tools/bake_world.py).

World units are metres: x along the trail (left -> right), d = distance from the camera plane
(the camera looks along +d), h = height. The trail the player walks is the band d in PATH.
Every object gets the sprite scale (pixels per metre) nearest to its perspective scale f / d.
"""
import math
import random

# camera (shared with docs/js/world.js via world.json)
CAMERA = dict(vw=480, vh=270, f=175.0, height=11.6, horizon=200.0)
PATH = (12.2, 15.8)          # walkable depth band
LENGTH = 700.0               # trail length (m)
# sprite scales: pixels per metre, a half-octave apart, centred on the trail (d = 14 m -> 12.5)
SCALES = [round(12.5 * 2 ** ((3 - s) / 2), 3) for s in range(11)]


def scale_for(d):
    ppm = CAMERA["f"] / d
    return min(range(len(SCALES)), key=lambda s: abs(math.log(SCALES[s] / ppm)))


# Regions along the trail. Species weights per layer; densities are objects per 100 m^2.
REGIONS = [
    dict(name="Hearthmeadow", x0=-250, x1=110, ground="meadow",
         trees={"Tree_European_Aspen": 2, "Tree_Black_Poplar": 2, "Tree_Common_Hazel": 1, "Tree_Rowan": 1, "Tree_Elder": 1},
         tree_density=(0.15, 0.6, 1.4),
         shrubs={"Tree_Common_Hazel": 2, "Tree_Elder": 2, "Shrub_European_Spindle": 1},
         ground_cover={"Wild_Grass": 5, "Tufted_Grass": 3, "Tall_Grass": 2, "Field_Poppy": 2, "Leafy_Dandelions": 2, "Wheat_Grass": 1},
         rocks={"Prop_Boulders": 1}, cover_density=22.0, rock_density=0.15, fireflies=1.0),
    dict(name="Beechwood Hollow", x0=110, x1=250, ground="forest",
         trees={"Tree_European_Beech": 5, "Tree_English_Oak": 3, "Tree_Norway_Maple": 2, "Tree_Common_Hazel": 1},
         tree_density=(2.6, 4.0, 5.0),
         shrubs={"Plant_Bracken_Fern": 4, "Tree_Common_Hazel": 1, "Shrub_European_Spindle": 1, "Plant_Bilberry": 2},
         ground_cover={"Plant_Bracken_Fern": 4, "Plant_Wood_Anemone": 3, "Plant_Bilberry": 3, "Grass_Clumps": 1},
         rocks={"Prop_Logs": 2, "Prop_Boulders": 1, "Prop_Snags": 1}, cover_density=18.0, rock_density=0.35, fireflies=0.6),
    dict(name="Birchwater Glade", x0=250, x1=340, ground="glade",
         trees={"Tree_Silver_Birch": 5, "Tree_European_Aspen": 2, "Tree_Goat_Willow": 2, "Tree_Black_Alder": 2},
         tree_density=(0.9, 1.6, 2.6),
         shrubs={"Tree_Goat_Willow": 2, "Giant_Reed": 2, "Plant_Leather_Fern": 1},
         ground_cover={"Cotton_Grass": 4, "Ribbon_Grass": 3, "Wild_Grass": 3, "Plant_Wood_Anemone": 1, "Giant_Reed": 1},
         rocks={"Prop_Boulders": 1, "Prop_Logs": 1}, cover_density=22.0, rock_density=0.15, fireflies=1.6),
    dict(name="Spruce Heights", x0=340, x1=470, ground="needles",
         trees={"Tree_Norway_Spruce": 5, "Tree_Baltic_Pine": 3, "Tree_Silver_Birch": 1},
         tree_density=(2.4, 3.6, 5.0),
         shrubs={"Shrub_Heather": 3, "Shrub_Huckleberry_Oak": 2, "Plant_Bilberry": 2},
         ground_cover={"Shrub_Heather": 3, "Plant_Bilberry": 3, "Tundra_Grass": 2, "Plant_Bracken_Fern": 1},
         rocks={"Prop_Boulders": 3, "Prop_Logs": 1}, cover_density=14.0, rock_density=0.6, fireflies=0.2),
    dict(name="Ashen Ridge", x0=470, x1=560, ground="ash",
         trees={"Tree_Dead_Pine": 5, "Tree_Baltic_Pine": 1},
         tree_density=(0.8, 1.4, 2.0),
         shrubs={"Shrub_Dead_Shrubs_A": 2, "Shrub_Dead_Shrubs_B": 2, "Shrub_Heather": 1},
         ground_cover={"Dry_Grass": 4, "Marram_Grass": 2, "Shrub_Dead_Shrubs_A": 1, "Tundra_Grass": 1},
         rocks={"Prop_Snags": 3, "Prop_Boulders": 2, "Prop_Logs": 2}, cover_density=12.0, rock_density=0.6, fireflies=0.0),
    dict(name="Sunterrace Pines", x0=560, x1=950, ground="dry",
         trees={"Tree_Aleppo_Pine": 5, "Tree_Common_Hazel": 1},
         tree_density=(0.6, 1.1, 1.8),
         shrubs={"Shrub_Greasewood": 2, "Shrub_Spineless_Yucca_A": 1, "Shrub_Spineless_Yucca_B": 1},
         ground_cover={"Dry_Grass": 4, "Wheat_Grass": 2, "Marram_Grass": 2, "Field_Poppy": 1},
         rocks={"Prop_Desert_Rocks": 2, "Prop_Boulders": 2}, cover_density=14.0, rock_density=0.4, fireflies=0.4),
]
BLEND = 14.0  # metres over which neighbouring regions mix


def region_at(rng, x):
    """The region an object at x belongs to (randomly mixed near borders)."""
    for i, r in enumerate(REGIONS):
        if r["x0"] <= x < r["x1"]:
            if i + 1 < len(REGIONS) and x > r["x1"] - BLEND and rng.random() < 0.5 * (x - (r["x1"] - BLEND)) / BLEND:
                return REGIONS[i + 1]
            if i > 0 and x < r["x0"] + BLEND and rng.random() < 0.5 * (r["x0"] + BLEND - x) / BLEND:
                return REGIONS[i - 1]
            return r
    return REGIONS[0] if x < 0 else REGIONS[-1]


def generate(avail, seed=7):
    """avail: {variant: dict(species, height, width, kind)} of the baked variants."""
    rng = random.Random(seed)
    by_species = {}
    for v, info in avail.items():
        by_species.setdefault(info["species"], []).append(v)
    for k in by_species:
        by_species[k].sort()

    def pick(weights, max_h=None, min_h=None):
        items = [(s, w) for s, w in weights.items() if s in by_species]
        if not items:
            return None
        tot = sum(w for _, w in items)
        r = rng.random() * tot
        for s, w in items:
            r -= w
            if r <= 0:
                break
        vs = by_species[s]
        if max_h is not None:
            vs = [v for v in vs if avail[v]["height"] <= max_h] or vs
        if min_h is not None:
            vs = [v for v in vs if avail[v]["height"] >= min_h] or vs
        return rng.choice(vs)

    objects = []
    occupied = []  # (x, d, radius) of trees, to keep trunks apart

    def free(x, d, rad):
        for ox, od, orad in occupied:
            if (ox - x) ** 2 + (od - d) ** 2 < (0.42 * (rad + orad)) ** 2:
                return False
        return True

    def add(v, x, d, layer):
        objects.append(dict(v=v, x=round(x, 2), d=round(d, 2), s=scale_for(d), f=rng.random() < 0.5, l=layer))

    vw, f = CAMERA["vw"], CAMERA["f"]
    # trees: (d0, d1, density index) bands; far bands span wider x (perspective)
    tree_bands = [(5.5, 9.5, 0, 0.12), (16.5, 24.0, 0, 1.0), (24.0, 60.0, 1, 1.0), (60.0, 170.0, 2, 1.0)]
    for d0, d1, di, mul in tree_bands:
        half = vw / 2 * d1 / f
        x0, x1 = -half - 20, LENGTH + half + 20
        area = (x1 - x0) * (d1 - d0)
        n = int(area / 100.0 * 5.0 * mul)
        for _ in range(n):
            x, d = rng.uniform(x0, x1), rng.uniform(d0, d1)
            reg = region_at(rng, x)
            if rng.random() > reg["tree_density"][di] / 5.0:
                continue
            v = pick(reg["trees"], min_h=4.0 if d > 24 else None)
            if v is None:
                continue
            rad = max(avail[v]["width"] * 0.5, 1.0)
            if not free(x, d, rad):
                continue
            occupied.append((x, d, rad))
            add(v, x, d, "tree")
    # shrubs and saplings near the trail (not on it)
    for d0, d1 in [(5.5, 11.5), (16.0, 30.0)]:
        x0, x1 = -40, LENGTH + 40
        n = int((x1 - x0) * (d1 - d0) / 100.0 * 2.5)
        for _ in range(n):
            x, d = rng.uniform(x0, x1), rng.uniform(d0, d1)
            reg = region_at(rng, x)
            v = pick(reg["shrubs"], max_h=6.0)
            if v and free(x, d, 0.6):
                add(v, x, d, "shrub")
    # ground cover: grass patches, ferns, flowers. On the trail only low grass at its edges.
    for d0, d1 in [(5.5, 9.0), (9.0, PATH[0] + 0.3), (PATH[1] - 0.3, 22.0), (22.0, 34.0), (34.0, 55.0)]:
        x0, x1 = -40, LENGTH + 40
        dens_mul = {22.0: 0.5, 34.0: 0.3}.get(d0, 1.0)
        for x in [x0 + i * 0.5 for i in range(int((x1 - x0) / 0.5))]:
            reg = region_at(rng, x)
            p = reg["cover_density"] / 100.0 * 0.5 * (d1 - d0) * dens_mul
            k = int(p) + (1 if rng.random() < p - int(p) else 0)
            for _ in range(k):
                d = rng.uniform(d0, d1)
                v = pick(reg["ground_cover"], max_h=2.5)
                if v:
                    add(v, x + rng.uniform(-0.25, 0.25), d, "cover")
    # rocks and logs
    for d0, d1 in [(5.5, PATH[0]), (PATH[1], 35.0)]:
        x0, x1 = -40, LENGTH + 40
        n = int((x1 - x0) * (d1 - d0) / 100.0)
        for _ in range(n):
            x, d = rng.uniform(x0, x1), rng.uniform(d0, d1)
            reg = region_at(rng, x)
            if rng.random() < reg["rock_density"]:
                v = pick(reg["rocks"])
                if v and free(x, d, 1.0):
                    occupied.append((x, d, 0.8))
                    add(v, x, d, "rock")

    objects.sort(key=lambda o: (-o["d"], o["x"]))  # far first
    regions = [dict(name=r["name"], x0=max(r["x0"], 0.0) if i == 0 else r["x0"], x1=min(r["x1"], LENGTH),
                    ground=r["ground"], fireflies=r["fireflies"]) for i, r in enumerate(REGIONS)]
    return dict(camera=CAMERA, path=PATH, length=LENGTH, scales=SCALES, regions=regions, objects=objects)
