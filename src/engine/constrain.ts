/**
 * Constraint sketching with FreeCAD's 2D solver (planeGCS, through the
 * @salusoft89/planegcs WebAssembly build, LGPL). A drawn outline is a closed
 * polygon; the solver keeps what the hand meant and applies what was said:
 *
 *  - every edge that is horizontal or vertical (within 2 degrees) stays so;
 *  - edges of equal length (within 2 %) stay equal;
 *  - a spoken dimension ("this side 40") becomes a driving distance;
 *  - the first point is fixed, so the outline grows away from it.
 *
 * inferConstraints is pure; solveOutline needs a GcsWrapper (async to load).
 */

import type { GcsWrapper, SketchPrimitive } from '@salusoft89/planegcs';
import type { Vec2 } from './types.js';

export interface Dimension {
  /** Edge index: from point i to point i + 1. */
  edge: number;
  length: number;
}

export type Inferred =
  | { kind: 'horizontal'; edge: number }
  | { kind: 'vertical'; edge: number }
  | { kind: 'equal'; a: number; b: number };

const ANGLE_TOL = (2 * Math.PI) / 180;

export function edgeLength(pts: Vec2[], i: number): number {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** The constraints the drawing already obeys. A dimensioned edge is not made equal to others (its length changes). */
export function inferConstraints(pts: Vec2[], dims: Dimension[] = []): Inferred[] {
  const out: Inferred[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const s = Math.abs(Math.sin(ang));
    const c = Math.abs(Math.cos(ang));
    if (s < Math.sin(ANGLE_TOL)) out.push({ kind: 'horizontal', edge: i });
    else if (c < Math.sin(ANGLE_TOL)) out.push({ kind: 'vertical', edge: i });
  }
  const fixed = new Set(dims.map((d) => d.edge));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (fixed.has(i) && fixed.has(j)) continue;
      const li = edgeLength(pts, i);
      const lj = edgeLength(pts, j);
      if (Math.abs(li - lj) <= 0.02 * Math.max(li, lj)) out.push({ kind: 'equal', a: i, b: j });
    }
  }
  return out;
}

/** The edge of `pts` nearest the point q (mm). */
export function nearestEdge(pts: Vec2[], q: Vec2): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(ax + t * dx - q[0], ay + t * dy - q[1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface SolveResult {
  pts: Vec2[];
  ok: boolean;
  conflicting: string[];
  applied: Inferred[];
}

/** Solve the outline with its inferred constraints and the given dimensions. */
export function solveOutline(gcs: GcsWrapper, pts: Vec2[], dims: Dimension[]): SolveResult {
  const n = pts.length;
  const prims: SketchPrimitive[] = [];
  pts.forEach(([x, y], i) => prims.push({ id: `p${i}`, type: 'point', x, y, fixed: i === 0 } as SketchPrimitive));
  for (let i = 0; i < n; i++) prims.push({ id: `l${i}`, type: 'line', p1_id: `p${i}`, p2_id: `p${(i + 1) % n}` } as SketchPrimitive);
  const inferred = inferConstraints(pts, dims);
  for (const c of inferred) {
    if (c.kind === 'horizontal') prims.push({ id: `h${c.edge}`, type: 'horizontal_pp', p1_id: `p${c.edge}`, p2_id: `p${(c.edge + 1) % n}` } as SketchPrimitive);
    else if (c.kind === 'vertical') prims.push({ id: `v${c.edge}`, type: 'vertical_pp', p1_id: `p${c.edge}`, p2_id: `p${(c.edge + 1) % n}` } as SketchPrimitive);
    else prims.push({ id: `e${c.a}_${c.b}`, type: 'equal_length', l1_id: `l${c.a}`, l2_id: `l${c.b}` } as SketchPrimitive);
  }
  for (const d of dims) {
    prims.push({ id: `d${d.edge}`, type: 'p2p_distance', p1_id: `p${d.edge}`, p2_id: `p${(d.edge + 1) % n}`, distance: d.length } as SketchPrimitive);
  }
  gcs.clear_data();
  gcs.push_primitives_and_params(prims);
  gcs.solve();
  gcs.apply_solution();
  const conflicting = gcs.has_gcs_conflicting_constraints() ? gcs.get_gcs_conflicting_constraints() : [];
  const out: Vec2[] = pts.map((_, i) => {
    const p = gcs.sketch_index.get_sketch_point(`p${i}`);
    return [p.x, p.y];
  });
  const ok = !conflicting.length && dims.every((d) => Math.abs(edgeLength(out, d.edge) - d.length) < 1e-6);
  return { pts: out, ok, conflicting, applied: inferred };
}
