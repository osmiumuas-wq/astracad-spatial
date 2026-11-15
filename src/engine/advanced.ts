/**
 * Geometry for the headset kernel's fillet, shell, loft and sweep.
 *
 * Each is defined so that its result is exact and checkable in closed form,
 * which is what lets the truth gate verify it instead of trusting it:
 *
 * - fillet: rounds the corners of an extrusion's outline, i.e. the edges that
 *   run along the extrusion, with true arcs. The rounded outline is a sketch
 *   with arcs, so its area is exact (Green's theorem) and its tessellation is
 *   equal-area.
 * - shell: hollows an extrusion to a wall thickness. The inner outline is the
 *   outline offset into the material: straight edges move in, corners stay
 *   sharp (mitred), arcs stay concentric. One face (far, near) may be left
 *   open. Hole walls from later features are not thickened.
 * - loft: a ruled solid through two or more profiles on parallel planes. Its
 *   cross-section area is quadratic in height, so the prismatoid formula
 *   h/6 (A0 + 4 Am + A1) is exact.
 * - sweep: a profile along a 3D polyline whose corners are bends of a given
 *   radius. Straight runs are prisms, bends are revolutions, so the volume is
 *   area x straight length + Pappus for each bend.
 *
 * Everything here is pure maths shared by the kernel (src/engine/kernel.ts)
 * and the closed-form checker (src/engine/expect.ts).
 */

import { circleSegments, cross, dot, equalAreaScale, Frame, loopIntegrals, norm, tessellateLoop } from './sketch.js';
import { ArcSeg, Feature, Seg, SpecError, Vec2, Vec3 } from './types.js';

const EPS = 1e-9;

const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const len2 = (a: Vec2): number => Math.hypot(a[0], a[1]);
const unit2 = (a: Vec2): Vec2 => {
  const l = len2(a);
  return [a[0] / l, a[1] / l];
};
const segStart = (s: Seg): Vec2 =>
  s[0] === 'L' ? [s[1], s[2]] : s[0] === 'A' ? [s[3], s[4]] : [s[1] + s[3], s[2]];
const segEnd = (s: Seg): Vec2 =>
  s[0] === 'L' ? [s[3], s[4]] : s[0] === 'A' ? [s[5], s[6]] : [s[1] + s[3], s[2]];

// ---------------------------------------------------------------------------
// Fillet
// ---------------------------------------------------------------------------

/**
 * Round every corner between two straight edges with radius `r`. Corners that
 * touch an arc are left as they are (they are usually tangent already).
 * Refuses a radius too large for an edge instead of producing a wrong outline.
 */
export function filletLoops(loops: Seg[][], r: number): Seg[][] {
  if (!(r > 0)) throw new SpecError('fillet radius must be positive');
  return loops.map((loop, li) => {
    if (loop.length === 1 && loop[0][0] === 'C') return loop;
    const n = loop.length;
    // Tangent length at the corner after segment i (0 when that corner is not rounded).
    const tan = new Array<number>(n).fill(0);
    const corner: ({ c: Vec2; t1: Vec2; t2: Vec2; dir: 1 | -1 } | null)[] = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % n];
      if (a[0] !== 'L' || b[0] !== 'L') continue;
      const d1 = unit2(sub2(segEnd(a), segStart(a)));
      const d2 = unit2(sub2(segEnd(b), segStart(b)));
      const z = d1[0] * d2[1] - d1[1] * d2[0];
      const c = d1[0] * d2[0] + d1[1] * d2[1];
      if (Math.abs(z) < 1e-9 && c > 0) continue; // straight on
      if (c < -1 + 1e-9) throw new SpecError(`outline ${li} turns back on itself at corner ${i}; it cannot be rounded`);
      const turn = Math.atan2(Math.abs(z), c);
      const t = r * Math.tan(turn / 2);
      const p = segEnd(a);
      const t1: Vec2 = [p[0] - d1[0] * t, p[1] - d1[1] * t];
      const t2: Vec2 = [p[0] + d2[0] * t, p[1] + d2[1] * t];
      const side = z > 0 ? 1 : -1;
      const nrm: Vec2 = [-d1[1] * side, d1[0] * side];
      corner[i] = { c: [t1[0] + nrm[0] * r, t1[1] + nrm[1] * r], t1, t2, dir: side as 1 | -1 };
      tan[i] = t;
    }
    const out: Seg[] = [];
    for (let i = 0; i < n; i++) {
      const s = loop[i];
      if (s[0] === 'L') {
        const a = segStart(s);
        const b = segEnd(s);
        const l = len2(sub2(b, a));
        const t0 = tan[(i - 1 + n) % n];
        const t1 = tan[i];
        if (t0 + t1 > l + 1e-9) {
          throw new SpecError(
            `fillet radius ${r} mm is too large: edge ${i} of outline ${li} is ${l.toFixed(3)} mm, the rounds need ${(t0 + t1).toFixed(3)} mm`,
          );
        }
        const d = unit2(sub2(b, a));
        const s0: Vec2 = [a[0] + d[0] * t0, a[1] + d[1] * t0];
        const s1: Vec2 = [b[0] - d[0] * t1, b[1] - d[1] * t1];
        if (len2(sub2(s1, s0)) > 1e-9) out.push(['L', s0[0], s0[1], s1[0], s1[1]]);
      } else {
        out.push(s);
      }
      const k = corner[i];
      if (k) out.push(['A', k.c[0], k.c[1], k.t1[0], k.t1[1], k.t2[0], k.t2[1], k.dir]);
    }
    // Close exactly: consecutive end and start points may differ by rounding.
    for (let i = 0; i < out.length; i++) snapStart(out[(i + 1) % out.length], segEnd(out[i]));
    return out;
  });
}

/**
 * Chamfer every corner between two straight edges of each outline: the corner
 * is cut by a straight line `d` mm back along both edges (an equal-distance
 * chamfer). Exact, like the fillet: the area changes by d^2 sin(turn) / 2 per corner.
 */
export function chamferLoops(loops: Seg[][], d: number): Seg[][] {
  if (!(d > 0)) throw new SpecError('chamfer distance must be positive');
  return loops.map((loop, li) => {
    if (loop.length === 1 && loop[0][0] === 'C') return loop;
    const n = loop.length;
    const cut = new Array<boolean>(n).fill(false);
    for (let i = 0; i < n; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % n];
      if (a[0] !== 'L' || b[0] !== 'L') continue;
      const d1 = unit2(sub2(segEnd(a), segStart(a)));
      const d2 = unit2(sub2(segEnd(b), segStart(b)));
      const z = d1[0] * d2[1] - d1[1] * d2[0];
      const c = d1[0] * d2[0] + d1[1] * d2[1];
      if (Math.abs(z) < 1e-9 && c > 0) continue;
      cut[i] = true;
    }
    const out: Seg[] = [];
    for (let i = 0; i < n; i++) {
      const s = loop[i];
      if (s[0] === 'L') {
        const a = segStart(s);
        const b = segEnd(s);
        const l = len2(sub2(b, a));
        const t0 = cut[(i - 1 + n) % n] ? d : 0;
        const t1 = cut[i] ? d : 0;
        if (t0 + t1 > l + 1e-9) {
          throw new SpecError(`chamfer ${d} mm is too large: edge ${i} of outline ${li} is ${l.toFixed(3)} mm`);
        }
        const u = unit2(sub2(b, a));
        const s0: Vec2 = [a[0] + u[0] * t0, a[1] + u[1] * t0];
        const s1: Vec2 = [b[0] - u[0] * t1, b[1] - u[1] * t1];
        if (len2(sub2(s1, s0)) > 1e-9) out.push(['L', s0[0], s0[1], s1[0], s1[1]]);
        if (cut[i]) {
          const nb = loop[(i + 1) % n];
          const nd = unit2(sub2(segEnd(nb), segStart(nb)));
          const q: Vec2 = [b[0] + nd[0] * d, b[1] + nd[1] * d];
          out.push(['L', s1[0], s1[1], q[0], q[1]]);
        }
      } else {
        out.push(s);
      }
    }
    for (let i = 0; i < out.length; i++) snapStart(out[(i + 1) % out.length], segEnd(out[i]));
    return out;
  });
}

function snapStart(s: Seg, p: Vec2): void {
  if (s[0] === 'L') {
    s[1] = p[0];
    s[2] = p[1];
  } else if (s[0] === 'A') {
    s[3] = p[0];
    s[4] = p[1];
  }
}

function snapEnd(s: Seg, p: Vec2): void {
  if (s[0] === 'L') {
    s[3] = p[0];
    s[4] = p[1];
  } else if (s[0] === 'A') {
    s[5] = p[0];
    s[6] = p[1];
  }
}

// ---------------------------------------------------------------------------
// Shell (offset into the material)
// ---------------------------------------------------------------------------

/** Index of the outside loop: the largest by area (the sketch rule used everywhere). */
export function outerIndex(loops: Seg[][]): number {
  let best = 0;
  let area = -1;
  loops.forEach((l, i) => {
    const a = Math.abs(loopIntegrals(l).area);
    if (a > area) {
      area = a;
      best = i;
    }
  });
  return best;
}

/**
 * Offset every loop `t` into the material: the outside loop shrinks, openings
 * grow. Straight corners are mitred; arcs stay concentric (an arc that would
 * vanish becomes a sharp corner). Refuses a thickness that would turn an edge
 * round or make walls meet.
 */
export function offsetLoops(loops: Seg[][], t: number): Seg[][] {
  if (!(t > 0)) throw new SpecError('wall thickness must be positive');
  const outer = outerIndex(loops);
  const result = loops.map((loop, li) => {
    const area = loopIntegrals(loop).area;
    // +1 moves to the left of the direction of travel.
    const s = (li === outer ? 1 : -1) * Math.sign(area);
    if (loop.length === 1 && loop[0][0] === 'C') {
      const [, cu, cv, r] = loop[0];
      const rr = li === outer ? r - t : r + t;
      if (rr <= EPS) throw new SpecError(`wall thickness ${t} mm is larger than the ${r} mm radius`);
      return [['C', cu, cv, rr] as Seg];
    }
    // Offset each segment on its own.
    const segs: (Seg | null)[] = loop.map((g) => {
      if (g[0] === 'L') {
        const d = unit2(sub2(segEnd(g), segStart(g)));
        const o: Vec2 = [-d[1] * s * t, d[0] * s * t];
        return ['L', g[1] + o[0], g[2] + o[1], g[3] + o[0], g[4] + o[1]];
      }
      if (g[0] === 'A') {
        const arc = g as ArcSeg;
        const r = Math.hypot(arc[3] - arc[1], arc[4] - arc[2]);
        const rr = r - s * t * arc[7];
        if (rr <= 1e-6) return null; // the arc closes up into a sharp corner
        const k = rr / r;
        return [
          'A', arc[1], arc[2],
          arc[1] + (arc[3] - arc[1]) * k, arc[2] + (arc[4] - arc[2]) * k,
          arc[1] + (arc[5] - arc[1]) * k, arc[2] + (arc[6] - arc[2]) * k,
          arc[7],
        ];
      }
      throw new SpecError('a "C" circle must be a loop on its own');
    });
    const kept = segs.filter((g): g is Seg => g !== null);
    if (kept.length < 2) throw new SpecError(`wall thickness ${t} mm leaves no opening inside outline ${li}`);
    // Join neighbours: tangent pairs already meet; straight corners are mitred.
    for (let i = 0; i < kept.length; i++) {
      const a = kept[i];
      const b = kept[(i + 1) % kept.length];
      const pa = segEnd(a);
      const pb = segStart(b);
      if (len2(sub2(pa, pb)) < 1e-7) {
        snapStart(b, pa);
        continue;
      }
      if (a[0] !== 'L' || b[0] !== 'L') {
        throw new SpecError(`outline ${li} has a corner between an arc and an edge that are not tangent; it cannot be shelled here`);
      }
      const p = intersectLines([a[1], a[2]], [a[3], a[4]], [b[1], b[2]], [b[3], b[4]]);
      if (!p) throw new SpecError(`outline ${li}: two parallel edges meet at a corner`);
      snapEnd(a, p);
      snapStart(b, p);
    }
    // Every straight edge must keep its direction: otherwise the wall swallowed it.
    for (let i = 0; i < kept.length; i++) {
      const g = kept[i];
      if (g[0] !== 'L') continue;
      const src = loop[segs.indexOf(g)];
      const d0 = sub2(segEnd(src), segStart(src));
      const d1 = sub2(segEnd(g), segStart(g));
      if (d0[0] * d1[0] + d0[1] * d1[1] <= 1e-9 * len2(d0) * len2(d0)) {
        throw new SpecError(`wall thickness ${t} mm is too large for edge ${i} of outline ${li}`);
      }
    }
    return kept;
  });
  // Walls must not meet: no two offset outlines may cross, and openings must stay inside.
  const polys = result.map(tessellateLoop);
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      if (polygonsCross(polys[i], polys[j])) {
        throw new SpecError(`wall thickness ${t} mm makes the walls of outlines ${i} and ${j} meet`);
      }
    }
  }
  return result;
}

function intersectLines(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): Vec2 | null {
  const r = sub2(a1, a0);
  const q = sub2(b1, b0);
  const den = r[0] * q[1] - r[1] * q[0];
  if (Math.abs(den) < 1e-12 * len2(r) * len2(q)) return null;
  const w = sub2(b0, a0);
  const u = (w[0] * q[1] - w[1] * q[0]) / den;
  return [a0[0] + r[0] * u, a0[1] + r[1] * u];
}

function segmentsCross(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const o = (a: Vec2, b: Vec2, c: Vec2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = o(p3, p4, p1);
  const d2 = o(p3, p4, p2);
  const d3 = o(p1, p2, p3);
  const d4 = o(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function polygonsCross(a: Vec2[], b: Vec2[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i];
    const a1 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a0, a1, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Loft
// ---------------------------------------------------------------------------

export interface LoftSection {
  frame: Frame;
  loops: Seg[][];
}

export interface LoftPlan {
  /** Points per section (all the same count), world coordinates, counter-clockwise about `n`. */
  rings: Vec3[][];
  /** The same points in the common (x, y) basis, and each section's height along `n`. */
  flat: Vec2[][];
  heights: number[];
  /** Loft axis (the shared plane normal, pointing from the first section to the last). */
  n: Vec3;
  x: Vec3;
  y: Vec3;
  /** 'circles' and 'polygons' have an exact closed form; 'resampled' does not. */
  kind: 'circles' | 'polygons' | 'resampled';
  /** Exact centre and radius per section, for 'circles'. */
  circles?: { c: Vec2; r: number }[];
}

export function loftPlan(sections: LoftSection[]): LoftPlan {
  if (sections.length < 2) throw new SpecError('a loft needs at least two profiles');
  for (const s of sections) {
    if (s.loops.length !== 1) throw new SpecError('each loft profile must be one closed outline without openings');
  }
  const f0 = sections[0].frame;
  let n = f0.n;
  for (const s of sections) {
    if (Math.abs(Math.abs(dot(s.frame.n, n)) - 1) > 1e-9) throw new SpecError('loft profiles must lie on parallel planes');
  }
  const h = sections.map((s) => dot([s.frame.o[0] - f0.o[0], s.frame.o[1] - f0.o[1], s.frame.o[2] - f0.o[2]], n));
  const up = h[h.length - 1] > h[0];
  let x = f0.x;
  let y = f0.y;
  if (!up) {
    n = [-n[0], -n[1], -n[2]];
    y = [-y[0], -y[1], -y[2]];
  }
  const heights = h.map((v) => (up ? v : -v));
  for (let i = 1; i < heights.length; i++) {
    if (!(heights[i] > heights[i - 1] + 1e-9)) throw new SpecError('loft profiles must be in order along the loft, on separate planes');
  }
  // Each section's own 2D coordinates to the common basis.
  const toCommon = (s: LoftSection, p: Vec2): Vec2 => {
    const w: Vec3 = [
      s.frame.o[0] + p[0] * s.frame.x[0] + p[1] * s.frame.y[0] - f0.o[0],
      s.frame.o[1] + p[0] * s.frame.x[1] + p[1] * s.frame.y[1] - f0.o[1],
      s.frame.o[2] + p[0] * s.frame.x[2] + p[1] * s.frame.y[2] - f0.o[2],
    ];
    return [dot(w, x), dot(w, y)];
  };
  const lift = (p: Vec2, height: number): Vec3 => [
    f0.o[0] + p[0] * x[0] + p[1] * y[0] + height * n[0],
    f0.o[1] + p[0] * x[1] + p[1] * y[1] + height * n[1],
    f0.o[2] + p[0] * x[2] + p[1] * y[2] + height * n[2],
  ];
  const allCircles = sections.every((s) => s.loops[0].length === 1 && s.loops[0][0][0] === 'C');
  let flat: Vec2[][];
  let kind: LoftPlan['kind'];
  let circles: { c: Vec2; r: number }[] | undefined;
  if (allCircles) {
    circles = sections.map((s) => {
      const [, cu, cv, r] = s.loops[0][0] as ['C', number, number, number];
      return { c: toCommon(s, [cu, cv]), r };
    });
    const segs = Math.max(...circles.map((c) => circleSegments(c.r)));
    const k = equalAreaScale((2 * Math.PI) / segs);
    // Same angles in every section, so corresponding edges are parallel and side faces flat.
    flat = circles.map(({ c, r }) =>
      Array.from({ length: segs }, (_, i): Vec2 => {
        const a = (i * 2 * Math.PI) / segs;
        return [c[0] + r * k * Math.cos(a), c[1] + r * k * Math.sin(a)];
      }),
    );
    kind = 'circles';
  } else {
    const straight = sections.every((s) => s.loops[0].every((g) => g[0] === 'L'));
    let pts = sections.map((s) => ccw(tessellateLoop(s.loops[0]).map((p) => toCommon(s, p))));
    const counts = new Set(pts.map((p) => p.length));
    if (straight && counts.size === 1) {
      kind = 'polygons';
    } else {
      const m = Math.max(64, ...pts.map((p) => p.length));
      pts = pts.map((p) => resample(p, m));
      kind = 'resampled';
    }
    // Start each ring where it best matches the one before (least twist).
    for (let i = 1; i < pts.length; i++) pts[i] = align(pts[i], pts[i - 1]);
    flat = pts;
  }
  const rings = flat.map((ring, i) => ring.map((p) => lift(p, heights[i])));
  return { rings, flat, heights, n, x, y, kind, circles };
}

function signedArea(p: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a / 2;
}

export function polygonAreaSigned(p: Vec2[]): number {
  return signedArea(p);
}

function ccw(p: Vec2[]): Vec2[] {
  return signedArea(p) < 0 ? [...p].reverse() : p;
}

function resample(p: Vec2[], m: number): Vec2[] {
  const n = p.length;
  const cum = [0];
  for (let i = 0; i < n; i++) cum.push(cum[i] + len2(sub2(p[(i + 1) % n], p[i])));
  const total = cum[n];
  const out: Vec2[] = [];
  let j = 0;
  for (let k = 0; k < m; k++) {
    const s = (k * total) / m;
    while (cum[j + 1] < s) j++;
    const t = (s - cum[j]) / Math.max(1e-12, cum[j + 1] - cum[j]);
    const a = p[j];
    const b = p[(j + 1) % n];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

function align(p: Vec2[], ref: Vec2[]): Vec2[] {
  const n = p.length;
  let best = 0;
  let bestCost = Infinity;
  for (let s = 0; s < n; s++) {
    let c = 0;
    for (let j = 0; j < n; j++) {
      const q = p[(j + s) % n];
      c += (q[0] - ref[j][0]) ** 2 + (q[1] - ref[j][1]) ** 2;
    }
    if (c < bestCost) {
      bestCost = c;
      best = s;
    }
  }
  return p.map((_, j) => p[(j + best) % n]);
}

/**
 * Exact loft volume, or null when the profiles were resampled. For circles the
 * smooth answer (the tessellation is equal-area, so the kernel matches it); for
 * polygons the ruled solid through the given corners.
 */
export function loftVolume(plan: LoftPlan): { volume: number | null; terms: string[] } {
  const terms: string[] = [];
  if (plan.kind === 'resampled') return { volume: null, terms };
  let v = 0;
  for (let i = 0; i + 1 < plan.flat.length; i++) {
    const h = plan.heights[i + 1] - plan.heights[i];
    let a0: number;
    let a1: number;
    let am: number;
    if (plan.kind === 'circles') {
      const c0 = plan.circles![i];
      const c1 = plan.circles![i + 1];
      a0 = Math.PI * c0.r * c0.r;
      a1 = Math.PI * c1.r * c1.r;
      const rm = (c0.r + c1.r) / 2;
      am = Math.PI * rm * rm;
    } else {
      const p0 = plan.flat[i];
      const p1 = plan.flat[i + 1];
      a0 = signedArea(p0);
      a1 = signedArea(p1);
      am = signedArea(p0.map((p, j): Vec2 => [(p[0] + p1[j][0]) / 2, (p[1] + p1[j][1]) / 2]));
    }
    const part = (h / 6) * (a0 + 4 * am + a1);
    terms.push(`span ${i + 1}: prismatoid h ${h.toFixed(4)} x (A0 ${a0.toFixed(4)} + 4 Am ${am.toFixed(4)} + A1 ${a1.toFixed(4)}) / 6 = ${part.toFixed(4)}`);
    v += part;
  }
  return { volume: v, terms };
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

export interface SweepPlan {
  /** The profile moved so the path passes through its origin, mirrored if needed. */
  loops: Seg[][];
  /** Straight runs: a frame whose normal is the run direction, and the run length. */
  runs: { frame: Frame; length: number }[];
  /** Bends: the frame where the bend starts, the bend axis in that frame's 2D coordinates, angle in degrees. */
  bends: { frame: Frame; p0: Vec2; ax: Vec2; angle: number }[];
  /** Runs and bends in path order, with each bend's axis in world coordinates. */
  steps: (
    | { kind: 'run'; frame: Frame; length: number }
    | { kind: 'bend'; frame: Frame; center: Vec3; axis: Vec3; angle: number; radius: number }
  )[];
}

/** Move loops by (du, dv) and optionally mirror v (which reverses each arc's direction). */
export function mapLoops(loops: Seg[][], du: number, dv: number, flipV: boolean): Seg[][] {
  const m = (u: number, v: number): Vec2 => [u + du, flipV ? -(v + dv) : v + dv];
  return loops.map((loop) =>
    loop.map((g): Seg => {
      if (g[0] === 'L') {
        const a = m(g[1], g[2]);
        const b = m(g[3], g[4]);
        return ['L', a[0], a[1], b[0], b[1]];
      }
      if (g[0] === 'A') {
        const c = m(g[1], g[2]);
        const s = m(g[3], g[4]);
        const e = m(g[5], g[6]);
        return ['A', c[0], c[1], s[0], s[1], e[0], e[1], (flipV ? -g[7] : g[7]) as 1 | -1];
      }
      const c = m(g[1], g[2]);
      return ['C', c[0], c[1], g[3]];
    }),
  );
}

function rotate(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return [v[0] * c + k[0] * s + axis[0] * d, v[1] * c + k[1] * s + axis[1] * d, v[2] * c + k[2] * s + axis[2] * d];
}

export function sweepPlan(frame: Frame, loops: Seg[][], path: Vec3[], bendRadius: number | undefined): SweepPlan {
  if (!Array.isArray(path) || path.length < 2) throw new SpecError('a sweep path needs at least two points');
  for (const p of path) {
    if (!Array.isArray(p) || p.length !== 3 || p.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      throw new SpecError('each path point must be [x, y, z] in mm');
    }
  }
  const d: Vec3[] = [];
  const L: number[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const v: Vec3 = [path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1], path[i + 1][2] - path[i][2]];
    const l = Math.hypot(...v);
    if (l < 1e-6) throw new SpecError(`path points ${i} and ${i + 1} are the same`);
    d.push([v[0] / l, v[1] / l, v[2] / l]);
    L.push(l);
  }
  const along = dot(frame.n, d[0]);
  if (Math.abs(Math.abs(along) - 1) > 1e-9) throw new SpecError('the profile must be sketched square to the first run of the path');
  const p0 = path[0];
  const off: Vec3 = [p0[0] - frame.o[0], p0[1] - frame.o[1], p0[2] - frame.o[2]];
  if (Math.abs(dot(off, frame.n)) > 1e-6) throw new SpecError('the path must start on the profile\'s plane');
  const flip = along < 0;
  const mapped = mapLoops(loops, -dot(off, frame.x), -dot(off, frame.y), flip);
  // Bends: angle and tangent length at each inner point.
  const turn: number[] = [0];
  for (let i = 1; i + 1 < path.length; i++) {
    const c = Math.max(-1, Math.min(1, dot(d[i - 1], d[i])));
    const a = Math.acos(c);
    if (a > Math.PI - 1e-6) throw new SpecError(`the path turns straight back at point ${i}`);
    turn.push(a);
  }
  turn.push(0);
  const needsBend = turn.some((a) => a > 1e-9);
  if (needsBend && !(typeof bendRadius === 'number' && bendRadius > 0)) {
    throw new SpecError('a path with corners needs a bend_radius in mm');
  }
  const R = bendRadius ?? 0;
  const tan = turn.map((a) => (a > 1e-9 ? R * Math.tan(a / 2) : 0));
  let x = frame.x;
  let y: Vec3 = flip ? [-frame.y[0], -frame.y[1], -frame.y[2]] : frame.y;
  const runs: SweepPlan['runs'] = [];
  const bends: SweepPlan['bends'] = [];
  const steps: SweepPlan['steps'] = [];
  for (let i = 0; i < d.length; i++) {
    const length = L[i] - tan[i] - tan[i + 1];
    if (length < -1e-9) {
      throw new SpecError(`bend radius ${R} mm is too large for run ${i + 1} of the path (${L[i].toFixed(3)} mm long)`);
    }
    const start: Vec3 = [path[i][0] + d[i][0] * tan[i], path[i][1] + d[i][1] * tan[i], path[i][2] + d[i][2] * tan[i]];
    if (length > 1e-9) {
      runs.push({ frame: { o: start, x, y, n: d[i] }, length });
      steps.push({ kind: 'run', frame: { o: start, x, y, n: d[i] }, length });
    }
    const a = turn[i + 1];
    if (i + 1 < d.length && a > 1e-9) {
      const e = [start[0] + d[i][0] * length, start[1] + d[i][1] * length, start[2] + d[i][2] * length] as Vec3;
      const nb = norm(cross(d[i], d[i + 1]));
      const c = dot(d[i], d[i + 1]);
      const m = norm([d[i + 1][0] - d[i][0] * c, d[i + 1][1] - d[i][1] * c, d[i + 1][2] - d[i][2] * c]);
      const bf: Frame = { o: e, x, y, n: d[i] };
      bends.push({ frame: bf, p0: [R * dot(m, x), R * dot(m, y)], ax: [dot(nb, x), dot(nb, y)], angle: (a * 180) / Math.PI });
      const center: Vec3 = [e[0] + m[0] * R, e[1] + m[1] * R, e[2] + m[2] * R];
      steps.push({ kind: 'bend', frame: bf, center, axis: nb, angle: a, radius: R });
      x = rotate(x, nb, a);
      y = rotate(y, nb, a);
    }
  }
  return { loops: mapped, runs, bends, steps };
}

/** Rotate `p` about the line through `c` along unit `axis` by `angle` radians. */
export function rotateAbout(p: Vec3, c: Vec3, axis: Vec3, angle: number): Vec3 {
  const r = rotate([p[0] - c[0], p[1] - c[1], p[2] - c[2]], axis, angle);
  return [r[0] + c[0], r[1] + c[1], r[2] + c[2]];
}

/**
 * The rings of a sweep: the tessellated profile placed at every station along
 * the path, in world coordinates. Straight runs need only their two end rings.
 * A bend of angle theta in n steps would, with every ring on the true circle,
 * enclose n sin(theta/n) A rc instead of Pappus' theta A rc (ruled sides cut
 * the corner). So the bend's inner rings are moved out from the bend axis by
 * delta = n rc (step / sin(step) - 1) / (n - 1), which makes the enclosed
 * volume exactly Pappus while the end rings stay exact for the straight runs.
 * (Each ruled segment between rings offset a and b encloses
 * sin(step) A (rc + (a + b) / 2).)
 */
export function sweepRings(plan: SweepPlan, polys: Vec2[][]): Vec3[][][] {
  const place = (f: Frame, p: Vec2): Vec3 => [
    f.o[0] + p[0] * f.x[0] + p[1] * f.y[0],
    f.o[1] + p[0] * f.x[1] + p[1] * f.y[1],
    f.o[2] + p[0] * f.x[2] + p[1] * f.y[2],
  ];
  let area = 0;
  let mu = 0;
  let mv = 0;
  for (const poly of polys) {
    // Polygon area and first moments (shoelace).
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const c = a[0] * b[1] - b[0] * a[1];
      area += c / 2;
      mu += ((a[0] + b[0]) * c) / 6;
      mv += ((a[1] + b[1]) * c) / 6;
    }
  }
  const stations: Vec3[][][] = [];
  const ring = (f: Frame): Vec3[][] => polys.map((poly) => poly.map((p) => place(f, p)));
  for (const s of plan.steps) {
    if (s.kind === 'run') {
      if (stations.length === 0) stations.push(ring(s.frame));
      const end: Frame = {
        ...s.frame,
        o: [s.frame.o[0] + s.frame.n[0] * s.length, s.frame.o[1] + s.frame.n[1] * s.length, s.frame.o[2] + s.frame.n[2] * s.length],
      };
      stations.push(ring(end));
      continue;
    }
    const start = ring(s.frame);
    if (stations.length === 0) stations.push(start);
    // Unit vector from the bend axis out to the profile's origin, and the centroid's distance from the axis.
    const out: Vec3 = [(s.frame.o[0] - s.center[0]) / s.radius, (s.frame.o[1] - s.center[1]) / s.radius, (s.frame.o[2] - s.center[2]) / s.radius];
    const cu = mu / area;
    const cv = mv / area;
    const rc = s.radius + cu * dot(s.frame.x, out) + cv * dot(s.frame.y, out);
    const n = Math.max(2, Math.ceil((circleSegments(rc) * s.angle) / (2 * Math.PI)));
    const step = s.angle / n;
    const delta = (n * rc * (step / Math.sin(step) - 1)) / (n - 1);
    for (let j = 1; j <= n; j++) {
      const shift = j < n ? delta : 0;
      stations.push(
        start.map((loop) =>
          loop.map((p) => rotateAbout([p[0] + out[0] * shift, p[1] + out[1] * shift, p[2] + out[2] * shift], s.center, s.axis, step * j)),
        ),
      );
    }
  }
  return stations;
}

/** First moment of a region about a line in its plane (absolute), as the revolve check uses. */
export function momentAboutLine(integ: { area: number; mu: number; mv: number }, p0: Vec2, ax: Vec2): number {
  const l = Math.hypot(ax[0], ax[1]);
  const nx = -ax[1] / l;
  const ny = ax[0] / l;
  return Math.abs(nx * (integ.mu - p0[0] * integ.area) + ny * (integ.mv - p0[1] * integ.area));
}

// ---------------------------------------------------------------------------
// Fillet and shell as modifiers of an earlier extrusion
// ---------------------------------------------------------------------------

export interface ExtrudeMods {
  fillet?: number;
  chamfer?: number;
  shell?: { t: number; open: 'far' | 'near' | 'none' };
}

/**
 * Fillet and shell name an earlier extrusion and change how it is built. Only
 * features before `upTo` count, so rolling the history back removes them.
 */
export function extrudeModifiers(features: Feature[], upTo: number): Map<string, ExtrudeMods> {
  const mods = new Map<string, ExtrudeMods>();
  const index = new Map(features.map((f, i) => [f.id, i]));
  for (let i = 0; i < Math.min(upTo, features.length); i++) {
    const f = features[i];
    if (f.$op !== 'feature.fillet' && f.$op !== 'feature.shell' && f.$op !== 'feature.chamfer') continue;
    const a = f.args ?? {};
    const target = a.feature;
    const ti = typeof target === 'string' ? index.get(target) : undefined;
    if (ti === undefined || ti >= i || features[ti].$op !== 'feature.extrude') {
      throw new SpecError(`"feature" must name an earlier feature.extrude`, f.id);
    }
    const m = mods.get(target as string) ?? {};
    if (f.$op === 'feature.chamfer') {
      if (a.edges !== undefined && a.edges !== 'profile') {
        throw new SpecError('the headset kernel chamfers "profile" edges (the edges along the extrusion) only', f.id);
      }
      if (m.fillet !== undefined || m.chamfer !== undefined) throw new SpecError(`"${String(target)}" already has rounded or chamfered corners`, f.id);
      const d = Number(a.distance);
      if (!(d > 0)) throw new SpecError('chamfer distance must be positive', f.id);
      m.chamfer = d;
    } else if (f.$op === 'feature.fillet') {
      if (a.edges !== undefined && a.edges !== 'profile') {
        throw new SpecError('the headset kernel rounds "profile" edges (the edges along the extrusion) only', f.id);
      }
      if (m.fillet !== undefined || m.chamfer !== undefined) throw new SpecError(`"${String(target)}" is already filleted or chamfered`, f.id);
      const r = Number(a.radius);
      if (!(r > 0)) throw new SpecError('fillet radius must be positive', f.id);
      m.fillet = r;
    } else {
      if (m.shell) throw new SpecError(`"${String(target)}" is already shelled`, f.id);
      const t = Number(a.thickness);
      if (!(t > 0)) throw new SpecError('shell thickness must be positive', f.id);
      const open = a.open === undefined ? 'far' : a.open;
      if (open !== 'far' && open !== 'near' && open !== 'none') throw new SpecError('shell "open" must be far, near or none', f.id);
      m.shell = { t, open };
    }
    mods.set(target as string, m);
  }
  return mods;
}

/**
 * Height range of a shell's cavity. `cut` reaches past an open face (so no film
 * is left); `solid` is the cavity inside the extrusion, for the volume.
 */
export function shellRange(
  z: [number, number],
  direction: unknown,
  t: number,
  open: 'far' | 'near' | 'none',
  probe: number,
): { cut: [number, number]; solid: [number, number] } {
  // The far face is the one away from the sketch plane.
  const farIsTop = direction !== 'reverse';
  const openTop = (open === 'far' && farIsTop) || (open === 'near' && !farIsTop);
  const openBottom = (open === 'far' && !farIsTop) || (open === 'near' && farIsTop);
  const solid: [number, number] = [openBottom ? z[0] : z[0] + t, openTop ? z[1] : z[1] - t];
  if (!(solid[1] - solid[0] > 1e-9)) throw new SpecError(`shell thickness ${t} mm leaves no cavity in a ${(z[1] - z[0]).toFixed(3)} mm extrusion`);
  return { cut: [openBottom ? solid[0] - probe : solid[0], openTop ? solid[1] + probe : solid[1]], solid };
}
