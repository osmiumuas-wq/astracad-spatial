"""
Independent check of the spatial stress solver on the wall bracket, with CalculiX.

Reads exchange/stress_reference.json (the case and the spatial solver's numbers),
meshes the bracket profile with conforming hexahedra (C3D8I: incompatible modes,
accurate in bending), extruded through the width, refines until the tip
deflection changes by less than 1 %, and writes exchange/results/ccx_bracket.json.

Usage:  python scripts/verify/ccx_bracket.py <path to ccx.exe> <work folder>

Simplifications, stated in the output: the two screw holes in the back plate are
left out (the whole back face x = 0 is clamped, so they sit in the clamped plate);
the load is a uniform pressure on the stated top-face patch.
"""

import json
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))


def mesh(p, k, nz):
    """Conforming hex mesh of the bracket profile. k sets the density (divisions per 7 mm of gusset edge)."""
    t, H, A, g, w = p["t"], p["height"], p["arm"], p["g"], p["w"]
    y0, y1, y2 = 0.0, H - t - g, H - t          # plate bottom, gusset start, arm underside
    x0, x1, x2, x4 = 0.0, t, t + g, A          # back face, plate front, gusset end, arm tip
    xl = 0.72 * A                              # start of the load patch
    h = (g / 2) / k                            # element size set by the gusset
    div = lambda length: max(2, int(round(length / h)))
    m1, n1, n3 = div(t), div(y1 - y0), div(t)
    ma, mb = div(xl - x2), div(x4 - xl)

    nodes = {}
    coords = []

    def node(x, y):
        key = (round(x * 1e6), round(y * 1e6))
        if key not in nodes:
            nodes[key] = len(coords)
            coords.append((x, y))
        return nodes[key]

    quads = []

    def block(p00, p10, p11, p01, nx, ny):
        """Bilinear block from four corners, counter-clockwise."""
        grid = [[None] * (ny + 1) for _ in range(nx + 1)]
        for i in range(nx + 1):
            for j in range(ny + 1):
                u, v = i / nx, j / ny
                x = (1 - u) * (1 - v) * p00[0] + u * (1 - v) * p10[0] + u * v * p11[0] + (1 - u) * v * p01[0]
                y = (1 - u) * (1 - v) * p00[1] + u * (1 - v) * p10[1] + u * v * p11[1] + (1 - u) * v * p01[1]
                grid[i][j] = node(x, y)
        for i in range(nx):
            for j in range(ny):
                quads.append((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))

    # Back plate below the gusset, beside the gusset, and the corner under the arm.
    block((x0, y0), (x1, y0), (x1, y1), (x0, y1), m1, n1)
    block((x0, y1), (x1, y1), (x1, y2), (x0, y2), m1, 2 * k)
    block((x0, y2), (x1, y2), (x1, H), (x0, H), m1, n3)
    # Gusset triangle A (x1, y1), B (x2, y2), C (x1, y2) as three quads round its centroid.
    A_, B_, C_ = (x1, y1), (x2, y2), (x1, y2)
    mid = lambda a, b: ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    G = ((A_[0] + B_[0] + C_[0]) / 3, (A_[1] + B_[1] + C_[1]) / 3)
    mAB, mBC, mCA = mid(A_, B_), mid(B_, C_), mid(C_, A_)
    block(A_, mAB, G, mCA, k, k)
    block(mAB, B_, mBC, G, k, k)
    block(mCA, G, mBC, C_, k, k)
    # Arm: over the gusset, to the load patch, and the loaded end.
    block((x1, y2), (x2, y2), (x2, H), (x1, H), 2 * k, n3)
    block((x2, y2), (xl, y2), (xl, H), (x2, H), ma, n3)
    block((xl, y2), (x4, y2), (x4, H), (xl, H), mb, n3)

    zs = [-w / 2 + w * i / nz for i in range(nz + 1)]
    n2d = len(coords)
    xyz = [(x, y, z) for z in zs for (x, y) in coords]
    elems = []
    for layer in range(nz):
        a, b = layer * n2d, (layer + 1) * n2d
        for q in quads:
            elems.append([a + q[0], a + q[1], a + q[2], a + q[3], b + q[0], b + q[1], b + q[2], b + q[3]])
    return xyz, elems, xl


def write_inp(path, p, mat, load, xyz, elems, xl):
    H = p["height"]
    tip_x = p["arm"]
    with open(path, "w", encoding="ascii", newline="\n") as f:
        f.write("*HEADING\nAstraCAD wall bracket check\n*NODE, NSET=NALL\n")
        for i, (x, y, z) in enumerate(xyz, 1):
            f.write(f"{i},{x:.9g},{y:.9g},{z:.9g}\n")
        f.write("*ELEMENT, TYPE=C3D8I, ELSET=EALL\n")
        for i, e in enumerate(elems, 1):
            f.write(f"{i}," + ",".join(str(n + 1) for n in e) + "\n")
        f.write("*NSET, NSET=FIX\n")
        fixed = [i for i, (x, _, _) in enumerate(xyz, 1) if abs(x) < 1e-9]
        for i in range(0, len(fixed), 12):
            f.write(",".join(map(str, fixed[i:i + 12])) + "\n")
        f.write(f"*MATERIAL, NAME=M\n*ELASTIC\n{mat['E_mpa']},{mat['nu']}\n*SOLID SECTION, ELSET=EALL, MATERIAL=M\n")
        f.write("*STEP\n*STATIC\n*BOUNDARY\nFIX,1,3,0.\n*DLOAD\n")
        # Top face of a hexahedron (nodes 3,4,7,8 in this numbering: y = H) is face S4 for C3D8 with this ordering;
        # find it from the coordinates instead of assuming.
        faces = {"S1": (0, 1, 2, 3), "S2": (4, 5, 6, 7), "S3": (0, 1, 5, 4), "S4": (1, 2, 6, 5), "S5": (2, 3, 7, 6), "S6": (3, 0, 4, 7)}
        area_total = 0.0
        loaded = []
        for i, e in enumerate(elems, 1):
            for name, idx in faces.items():
                pts = [xyz[e[j]] for j in idx]
                if all(abs(q[1] - H) < 1e-9 for q in pts) and min(q[0] for q in pts) >= xl - 1e-9:
                    xs = [q[0] for q in pts]
                    zs = [q[2] for q in pts]
                    area_total += (max(xs) - min(xs)) * (max(zs) - min(zs))
                    loaded.append((i, name))
        pressure = load["total_newtons"] / area_total
        for i, name in loaded:
            f.write(f"{i},P{name[1]},{pressure:.9g}\n")
        f.write("*NODE FILE\nU\n*EL FILE\nS\n*END STEP\n")
    return len(loaded), area_total, tip_x


def read_frd(path):
    disp, stress = {}, {}
    block = None
    with open(path, encoding="ascii", errors="replace") as f:
        for line in f:
            if line.startswith(" -4"):
                block = line.split()[1]
                continue
            if line.startswith(" -3"):
                block = None
                continue
            if block and line.startswith(" -1"):
                n = int(line[3:13])
                vals = [float(line[13 + 12 * i: 25 + 12 * i]) for i in range((len(line.rstrip()) - 13) // 12)]
                if block == "DISP":
                    disp[n] = vals[:3]
                elif block == "STRESS":
                    stress[n] = vals[:6]
    return disp, stress


def von_mises(s):
    sx, sy, sz, sxy, syz, szx = s
    return math.sqrt(0.5 * ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) + 3 * (sxy ** 2 + syz ** 2 + szx ** 2))


def run(ccx, work, p, mat, load, k, nz):
    xyz, elems, xl = mesh(p, k, nz)
    job = os.path.join(work, f"bracket_k{k}")
    n_loaded, area, _ = write_inp(job + ".inp", p, mat, load, xyz, elems, xl)
    # A conda build of ccx needs its environment's DLL folders on PATH (else 0xC0000135, DLL not found).
    lib = os.path.dirname(os.path.abspath(ccx))
    env_root = os.path.dirname(os.path.dirname(lib))
    env = dict(os.environ)
    env["PATH"] = os.pathsep.join([lib, os.path.join(env_root, "Library", "mingw-w64", "bin"), os.path.join(env_root, "Library", "usr", "bin"), env_root, env.get("PATH", "")])
    env.setdefault("OMP_NUM_THREADS", str(os.cpu_count() or 4))
    res = subprocess.run([ccx, "-i", os.path.basename(job)], cwd=work, capture_output=True, text=True, timeout=1800, env=env)
    if res.returncode != 0:
        raise RuntimeError(f"ccx exited with {res.returncode}: {(res.stdout + res.stderr)[-800:]}")
    disp, stress = read_frd(job + ".frd")
    umax = max(math.sqrt(sum(c * c for c in d)) for d in disp.values())
    # Peak statistics as the spatial solver reports them: leave out the loaded patch and a ring round it.
    H, cell = p["height"], 2.0
    judged = [von_mises(s) for n, s in stress.items() if not (xyz[n - 1][0] >= xl - cell and xyz[n - 1][1] >= H - cell)]
    judged.sort()
    p99 = judged[min(len(judged) - 1, int(len(judged) * 0.99))]
    return {"k": k, "nz": nz, "nodes": len(xyz), "elements": len(elems), "loaded_faces": n_loaded,
            "loaded_area_mm2": area, "max_displacement_mm": umax, "von_mises_p99_mpa": p99,
            "von_mises_max_mpa": judged[-1]}


def main():
    ccx, work = sys.argv[1], sys.argv[2]
    os.makedirs(work, exist_ok=True)
    ref = json.load(open(os.path.join(ROOT, "exchange", "stress_reference.json"), encoding="utf-8"))
    p, mat, load = ref["parameters"], ref["material"], ref["load"]
    runs = []
    for k, nz in [(2, 6), (4, 12), (6, 18), (8, 24), (10, 30)]:
        r = run(ccx, work, p, mat, load, k, nz)
        runs.append(r)
        print(json.dumps(r))
        if len(runs) >= 2:
            change = abs(runs[-1]["max_displacement_mm"] - runs[-2]["max_displacement_mm"]) / runs[-1]["max_displacement_mm"]
            if change < 0.01:
                break
    best = runs[-1]
    spatial = ref["spatial_solver"]
    out = {
        "case": ref["spec"],
        "solver": "CalculiX ccx (C3D8I hexahedra, linear static)",
        "simplifications": [
            "the two screw holes in the clamped back plate are left out",
            "the load is a uniform pressure on the stated top-face patch",
            "P99 leaves out nodes within 2 mm of the load patch, as the spatial solver does",
        ],
        "refinement": runs,
        "converged": len(runs) >= 2 and abs(runs[-1]["max_displacement_mm"] - runs[-2]["max_displacement_mm"]) / runs[-1]["max_displacement_mm"] < 0.01,
        "calculix": {"max_displacement_mm": best["max_displacement_mm"], "von_mises_p99_mpa": best["von_mises_p99_mpa"]},
        "spatial_solver_default": {"max_displacement_mm": spatial[0]["max_displacement_mm"], "von_mises_p99_mpa": spatial[0]["von_mises_p99_mpa"]},
    }
    out["difference"] = {
        "displacement": spatial[0]["max_displacement_mm"] / best["max_displacement_mm"] - 1,
        "von_mises_p99": spatial[0]["von_mises_p99_mpa"] / best["von_mises_p99_mpa"] - 1,
    }
    dest = os.path.join(ROOT, "exchange", "results")
    os.makedirs(dest, exist_ok=True)
    with open(os.path.join(dest, "ccx_bracket.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=2)
    print(json.dumps(out["difference"]))


if __name__ == "__main__":
    main()
