"""
Second-kernel check: build every exchange spec with OpenCASCADE and compare
its volume with the closed-form volume and with the spatial (Manifold) kernel.

The OpenCASCADE builder is astracad_geom.occ_build from the desktop AstraCAD
project (written from the Part Language document, independently of this app's
kernel); it is imported, not copied or changed.

Usage:  <python with OCP> scripts/verify/occ_volumes.py <path to astracad-gen/src>
Writes exchange/results/occ_volumes.json and prints a summary.
"""

import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
TOL = 1e-5


def main():
    sys.path.insert(0, os.path.abspath(sys.argv[1]))
    from astracad_geom.occ_build import build  # noqa: E402
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib

    listed = json.load(open(os.path.join(ROOT, "exchange", "expected.json"), encoding="utf-8"))
    # expected.json is a list of entries keyed by "file" (specs/<name>.json); flatten what is compared.
    expected = {
        os.path.splitext(os.path.basename(e["file"]))[0]: {
            "closed_form_volume_mm3": e.get("closed_form_volume_mm3"),
            "spatial_kernel_volume_mm3": (e.get("spatial_kernel") or {}).get("volume_mm3"),
        }
        for e in listed
    }
    rows = []
    for path in sorted(glob.glob(os.path.join(ROOT, "exchange", "specs", "*.json"))):
        name = os.path.splitext(os.path.basename(path))[0]
        spec = json.load(open(path, encoding="utf-8"))
        exp = expected.get(name) or expected.get(f"{name}.json") or {}
        row = {"spec": name}
        try:
            built = build(spec)
            props = GProp_GProps()
            BRepGProp.VolumeProperties_s(built.shape, props)
            vol = props.Mass()
            sprops = GProp_GProps()
            BRepGProp.SurfaceProperties_s(built.shape, sprops)
            box = Bnd_Box()
            BRepBndLib.AddOptimal_s(built.shape, box, False, False)
            x0, y0, z0, x1, y1, z1 = box.Get()
            row.update({"occ_volume_mm3": vol, "occ_area_mm2": sprops.Mass(), "occ_box": [[x0, y0, z0], [x1, y1, z1]]})
            cf = exp.get("closed_form_volume_mm3")
            sk = exp.get("spatial_kernel_volume_mm3")
            if cf:
                row["closed_form_volume_mm3"] = cf
                row["rel_diff_occ_vs_closed_form"] = abs(vol - cf) / cf
                row["pass"] = row["rel_diff_occ_vs_closed_form"] <= TOL
            if sk:
                row["spatial_kernel_volume_mm3"] = sk
                row["rel_diff_occ_vs_spatial"] = abs(vol - sk) / sk
        except Exception as ex:  # report every refusal with its message
            row.update({"error": f"{type(ex).__name__}: {ex}", "pass": False})
        rows.append(row)
        print(json.dumps({k: row.get(k) for k in ("spec", "rel_diff_occ_vs_closed_form", "rel_diff_occ_vs_spatial", "pass", "error")}))
    passed = sum(1 for r in rows if r.get("pass"))
    worst = max((r.get("rel_diff_occ_vs_closed_form", 0) for r in rows if "error" not in r), default=None)
    out = {"tolerance": TOL, "passed": passed, "total": len(rows), "worst_rel_diff_vs_closed_form": worst, "specs": rows}
    dest = os.path.join(ROOT, "exchange", "results")
    os.makedirs(dest, exist_ok=True)
    with open(os.path.join(dest, "occ_volumes.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=2)
    print(json.dumps({"passed": passed, "total": len(rows), "worst": worst}))


if __name__ == "__main__":
    main()
