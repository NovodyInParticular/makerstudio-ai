"""Test part script for MakerStudio: a plate and a peg (plain Python, no libraries)."""
from pathlib import Path

# ============================== PARAMETERS ==============================
WIDTH = 20                 # plate width (X)
DEPTH = 10.0               # plate depth (Y)
HEIGHT = 5.0               # plate thickness (Z)

# --- peg ---
PEG = (4.0, 4.0, 6.0)      # peg size (x, y, z)
PEG_ON = True              # make the peg part
GAP = WIDTH / 2 + 5        # peg distance from the plate centre (computed)
OUT = Path(__file__).parent / "out"
# =========================================================================


def box(x0, y0, z0, x1, y1, z1):
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    return [(v[a], v[b], v[c]) for a, b, c in f]


def stl(name, tris):
    lines = [f"solid {name}"]
    for t in tris:
        lines.append("facet normal 0 0 0\n outer loop")
        lines += [f"  vertex {p[0]} {p[1]} {p[2]}" for p in t]
        lines.append(" endloop\nendfacet")
    lines.append(f"endsolid {name}")
    (OUT / f"{name}.stl").write_text("\n".join(lines))


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    stl("plate", box(-WIDTH / 2, -DEPTH / 2, 0, WIDTH / 2, DEPTH / 2, HEIGHT))
    if PEG_ON:
        stl("peg", box(GAP, -PEG[1] / 2, 0, GAP + PEG[0], PEG[1] / 2, PEG[2]))
    stl("_ghost", box(0, 0, 0, 1, 1, 1))
    print("built", WIDTH, DEPTH, HEIGHT)
