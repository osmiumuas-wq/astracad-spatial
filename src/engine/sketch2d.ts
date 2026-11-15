/**
 * The sketcher behind the sketch workbench: points, lines, circles and arcs on
 * a face, held together by constraints (coincident, horizontal, vertical,
 * parallel, perpendicular, tangent, equal, fixed) and driven by dimensions
 * (length, distance, radius, angle), solved by FreeCAD's planeGCS, the way a
 * SOLIDWORKS, CATIA or NX sketch works.
 *
 * Coordinates are the face's own (u, v) in millimetres. Tools add geometry
 * from picked points, snapped to existing points, centres, midpoints and a
 * grid, and infer horizontal and vertical lines. profiles() finds the closed
 * regions (an outer loop and its holes) for Extrude, Cut and Revolve.
 *
 * Pure: solve() takes a planeGCS wrapper; everything else is plain data.
 */

import type { GcsWrapper, SketchPrimitive } from '@salusoft89/planegcs';

export interface SkPoint {
  id: string;
  x: number;
  y: number;
}

export type SkEntity =
  | { id: string; kind: 'line'; a: string; b: string; construction?: boolean }
  | { id: string; kind: 'circle'; c: string; r: number; construction?: boolean }
  /** Anticlockwise from a to b about c. */
  | { id: string; kind: 'arc'; c: string; a: string; b: string; construction?: boolean }
  /** A smooth curve through its points (Catmull-Rom), from a (pts[0]) to b (the last). */
  | { id: string; kind: 'spline'; a: string; b: string; pts: string[]; construction?: boolean }
  /** An ellipse: centre c, the end of its major half-axis at point m, minor half-axis rb (mm). */
  | { id: string; kind: 'ellipse'; c: string; m: string; rb: number; construction?: boolean };

export type SkConstraint =
  | { id: string; kind: 'horizontal' | 'vertical'; e: string }
  | { id: string; kind: 'parallel' | 'perpendicular' | 'equal' | 'tangent'; e1: string; e2: string }
  | { id: string; kind: 'fix'; p: string }
  | { id: string; kind: 'coincident'; p1: string; p2: string }
  | { id: string; kind: 'pointOnLine'; p: string; e: string }
  | { id: string; kind: 'symmetric'; p1: string; p2: string; e: string }
  | { id: string; kind: 'length'; e: string; value: number }
  | { id: string; kind: 'distance'; p1: string; p2: string; value: number }
  | { id: string; kind: 'radius'; e: string; value: number }
  | { id: string; kind: 'angle'; e1: string; e2: string; value: number };

export interface Sketch2D {
  points: SkPoint[];
  ents: SkEntity[];
  cons: SkConstraint[];
  next: number;
}

export type ConstraintSpec = SkConstraint extends infer C ? (C extends SkConstraint ? Omit<C, 'id'> : never) : never;

export function newSketch(): Sketch2D {
  // The sketch origin (where the face was picked), fixed: geometry is placed relative to it.
  return { points: [{ id: 'o', x: 0, y: 0 }], ents: [], cons: [{ id: 'k0', kind: 'fix', p: 'o' }], next: 1 };
}

const nid = (sk: Sketch2D, p: string): string => `${p}${sk.next++}`;
const pt = (sk: Sketch2D, id: string): SkPoint => {
  const q = sk.points.find((x) => x.id === id);
  if (!q) throw new Error(`no point ${id}`);
  return q;
};
const ent = (sk: Sketch2D, id: string): SkEntity | undefined => sk.ents.find((e) => e.id === id);

/** A centripetal Catmull-Rom curve through the points: the polyline (ends included), `per` pieces a span. */
export function splinePts(q: [number, number][], per = 8): [number, number][] {
  if (q.length < 3) return q.slice();
  const out: [number, number][] = [q[0]];
  const ext = [[2 * q[0][0] - q[1][0], 2 * q[0][1] - q[1][1]] as [number, number], ...q, [2 * q[q.length - 1][0] - q[q.length - 2][0], 2 * q[q.length - 1][1] - q[q.length - 2][1]] as [number, number]];
  for (let i = 1; i + 2 < ext.length; i++) {
    const [p0, p1, p2, p3] = [ext[i - 1], ext[i], ext[i + 1], ext[i + 2]];
    const d = (a: [number, number], b: [number, number]): number => Math.max(1e-9, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t0 = 0;
    const t1 = t0 + d(p0, p1);
    const t2 = t1 + d(p1, p2);
    const t3 = t2 + d(p2, p3);
    for (let k = 1; k <= per; k++) {
      const t = t1 + ((t2 - t1) * k) / per;
      const L = (a: [number, number], b: [number, number], ta: number, tb: number): [number, number] => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
      const A1 = L(p0, p1, t0, t1);
      const A2 = L(p1, p2, t1, t2);
      const A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2);
      const B2 = L(A2, A3, t1, t3);
      out.push(L(B1, B2, t1, t2));
    }
  }
  return out;
}

/** An ellipse as 96 points, anticlockwise, area-compensated (as the kernel's circles): the polygon's area is pi a b. */
export function ellipsePts(sk: Sketch2D, e: Extract<SkEntity, { kind: 'ellipse' }>): [number, number][] {
  const c = sk.points.find((q) => q.id === e.c)!;
  const m = sk.points.find((q) => q.id === e.m)!;
  const step = (2 * Math.PI) / 96;
  const k = Math.sqrt(step / Math.sin(step));
  const ra = Math.hypot(m.x - c.x, m.y - c.y) * k;
  const rbk = e.rb * k;
  const rot = Math.atan2(m.y - c.y, m.x - c.x);
  return Array.from({ length: 96 }, (_, k) => {
    const t = (2 * Math.PI * k) / 96;
    const x = ra * Math.cos(t);
    const y = rbk * Math.sin(t);
    return [c.x + x * Math.cos(rot) - y * Math.sin(rot), c.y + x * Math.sin(rot) + y * Math.cos(rot)] as [number, number];
  });
}

export interface Snap {
  x: number;
  y: number;
  /** An existing point it landed on (the new geometry shares it: coincident). */
  point?: string;
  kind: 'point' | 'centre' | 'midpoint' | 'grid' | 'free';
}

/**
 * Snap a picked position: to an existing point or centre within `reach` mm, a line's midpoint, else the grid.
 */
export function snap(sk: Sketch2D, x: number, y: number, reach = 3, grid = 1): Snap {
  let best: Snap | null = null;
  let bestD = reach;
  const consider = (s: Snap): void => {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  };
  for (const e of sk.ents) {
    if (e.kind === 'circle' || e.kind === 'arc' || e.kind === 'ellipse') {
      const c = pt(sk, e.c);
      consider({ x: c.x, y: c.y, point: c.id, kind: 'centre' });
    }
    if (e.kind === 'line') {
      const a = pt(sk, e.a);
      const b = pt(sk, e.b);
      consider({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, kind: 'midpoint' });
    }
  }
  for (const p of sk.points) {
    // Centres are offered above; ends and the origin here.
    consider({ x: p.x, y: p.y, point: p.id, kind: 'point' });
  }
  if (best) return best;
  if (grid > 0) return { x: Math.round(x / grid) * grid, y: Math.round(y / grid) * grid, kind: 'grid' };
  return { x, y, kind: 'free' };
}

/** A point for a snap: the existing one it landed on, else a new one. */
function pointFor(sk: Sketch2D, s: Snap): string {
  if (s.point) return s.point;
  // A point already there is the same point (coincident).
  const same = sk.points.find((q) => Math.hypot(q.x - s.x, q.y - s.y) < 1e-6);
  if (same) return same.id;
  const id = nid(sk, 'p');
  sk.points.push({ id, x: s.x, y: s.y });
  return id;
}

export function addConstraint(sk: Sketch2D, c: ConstraintSpec): string {
  const id = nid(sk, 'k');
  sk.cons.push({ ...c, id } as SkConstraint);
  return id;
}

const INFER = (3 * Math.PI) / 180;

/** A line; nearly horizontal or vertical (within 3 degrees) becomes so. */
export function addLine(sk: Sketch2D, from: Snap, to: Snap, construction = false): string {
  const a = pointFor(sk, from);
  const b = pointFor(sk, to);
  if (a === b) throw new Error('a line needs two different points');
  const id = nid(sk, 'l');
  sk.ents.push({ id, kind: 'line', a, b, construction });
  const pa = pt(sk, a);
  const pb = pt(sk, b);
  const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
  if (Math.abs(Math.sin(ang)) < Math.sin(INFER)) addConstraint(sk, { kind: 'horizontal', e: id });
  else if (Math.abs(Math.cos(ang)) < Math.sin(INFER)) addConstraint(sk, { kind: 'vertical', e: id });
  return id;
}

/** A corner rectangle: four lines, two horizontal and two vertical. */
export function addRectangle(sk: Sketch2D, c1: Snap, c2: Snap): string[] {
  if (Math.abs(c1.x - c2.x) < 1e-9 || Math.abs(c1.y - c2.y) < 1e-9) throw new Error('a rectangle needs two opposite corners');
  const p1 = pointFor(sk, c1);
  const p3 = pointFor(sk, c2);
  const p2 = pointFor(sk, { x: c2.x, y: c1.y, kind: 'free' });
  const p4 = pointFor(sk, { x: c1.x, y: c2.y, kind: 'free' });
  const ids = [
    [p1, p2],
    [p2, p3],
    [p3, p4],
    [p4, p1],
  ].map(([a, b]) => {
    const id = nid(sk, 'l');
    sk.ents.push({ id, kind: 'line', a, b });
    return id;
  });
  addConstraint(sk, { kind: 'horizontal', e: ids[0] });
  addConstraint(sk, { kind: 'vertical', e: ids[1] });
  addConstraint(sk, { kind: 'horizontal', e: ids[2] });
  addConstraint(sk, { kind: 'vertical', e: ids[3] });
  return ids;
}

/** A circle from its centre and a point on it. */
export function addCircle(sk: Sketch2D, centre: Snap, rim: Snap, construction = false): string {
  const r = Math.hypot(rim.x - centre.x, rim.y - centre.y);
  if (r < 1e-6) throw new Error('a circle needs a radius');
  const c = pointFor(sk, centre);
  const id = nid(sk, 'c');
  sk.ents.push({ id, kind: 'circle', c, r, construction });
  return id;
}

/** A three-point arc: from start to end, through the third point. */
export function addArc3(sk: Sketch2D, start: Snap, end: Snap, through: Snap): string {
  const ax = start.x, ay = start.y, bx = end.x, by = end.y, mx = through.x, my = through.y;
  const d = 2 * (ax * (by - my) + bx * (my - ay) + mx * (ay - by));
  if (Math.abs(d) < 1e-12) throw new Error('the three points of an arc are in a line');
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, m2 = mx * mx + my * my;
  const cx = (a2 * (by - my) + b2 * (my - ay) + m2 * (ay - by)) / d;
  const cy = (a2 * (mx - bx) + b2 * (ax - mx) + m2 * (bx - ax)) / d;
  // Anticlockwise from a to b passes through m when m's angle lies between theirs going anticlockwise.
  const ang = (x: number, y: number): number => Math.atan2(y - cy, x - cx);
  const t = (u: number): number => ((u % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = t(ang(mx, my) - ang(ax, ay)) < t(ang(bx, by) - ang(ax, ay));
  const ps = pointFor(sk, start);
  const pe = pointFor(sk, end);
  const c = pointFor(sk, { x: cx, y: cy, kind: 'free' });
  const id = nid(sk, 'a');
  sk.ents.push(ccw ? { id, kind: 'arc', c, a: ps, b: pe } : { id, kind: 'arc', c, a: pe, b: ps });
  return id;
}

/** A tangent arc from the end of a line, to a picked point. */
export function addTangentArc(sk: Sketch2D, line: string, end: Snap): string {
  const l = ent(sk, line);
  if (!l || l.kind !== 'line') throw new Error('a tangent arc starts from a line');
  const A = pt(sk, l.a);
  const B = pt(sk, l.b);
  const tx = B.x - A.x;
  const ty = B.y - A.y;
  const tl = Math.hypot(tx, ty);
  const nx = -ty / tl;
  const ny = tx / tl;
  // Centre on the normal at B, equidistant from B and the end: B + n s with |B + n s - E| = |s|.
  const ex = end.x - B.x;
  const ey = end.y - B.y;
  const den = 2 * (ex * nx + ey * ny);
  if (Math.abs(den) < 1e-12) throw new Error('that end is straight on from the line; draw a line instead');
  const s = (ex * ex + ey * ey) / den;
  const through: Snap = (() => {
    // A point on the arc between B and the end: rotate B about the centre half way.
    const cx = B.x + nx * s;
    const cy = B.y + ny * s;
    const a0 = Math.atan2(B.y - cy, B.x - cx);
    let a1 = Math.atan2(end.y - cy, end.x - cx);
    const dir = s > 0 ? 1 : -1;
    while (dir * (a1 - a0) <= 0) a1 += dir * 2 * Math.PI;
    const am = (a0 + a1) / 2;
    return { x: cx + Math.abs(s) * Math.cos(am), y: cy + Math.abs(s) * Math.sin(am), kind: 'free' };
  })();
  const id = addArc3(sk, { x: B.x, y: B.y, point: B.id, kind: 'point' }, end, through);
  addConstraint(sk, { kind: 'tangent', e1: line, e2: id });
  return id;
}

/** A straight slot: two lines and two half circles, tangent, from one arc centre to the other. */
export function addSlot(sk: Sketch2D, c1: Snap, c2: Snap, width: number): string[] {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-6 || width <= 0) throw new Error('a slot needs two centres and a width');
  const r = width / 2;
  const nx = (-dy / L) * r;
  const ny = (dx / L) * r;
  const a = pointFor(sk, c1);
  const b = pointFor(sk, c2);
  const P = (x: number, y: number): string => pointFor(sk, { x, y, kind: 'free' });
  const p1 = P(c1.x - nx, c1.y - ny);
  const p2 = P(c2.x - nx, c2.y - ny);
  const p3 = P(c2.x + nx, c2.y + ny);
  const p4 = P(c1.x + nx, c1.y + ny);
  const l1 = nid(sk, 'l');
  const l2 = nid(sk, 'l');
  const a1 = nid(sk, 'a');
  const a2 = nid(sk, 'a');
  sk.ents.push({ id: l1, kind: 'line', a: p1, b: p2 }, { id: a1, kind: 'arc', c: b, a: p2, b: p3 }, { id: l2, kind: 'line', a: p3, b: p4 }, { id: a2, kind: 'arc', c: a, a: p4, b: p1 });
  addConstraint(sk, { kind: 'tangent', e1: l1, e2: a1 });
  addConstraint(sk, { kind: 'tangent', e1: l2, e2: a1 });
  addConstraint(sk, { kind: 'tangent', e1: l2, e2: a2 });
  addConstraint(sk, { kind: 'tangent', e1: l1, e2: a2 });
  addConstraint(sk, { kind: 'equal', e1: a1, e2: a2 });
  return [l1, a1, l2, a2];
}

/** A regular polygon from its centre and one corner: equal sides, corners on a construction circle. */
export function addPolygon(sk: Sketch2D, centre: Snap, corner: Snap, sides: number): string[] {
  const n = Math.max(3, Math.min(64, Math.round(sides)));
  const r = Math.hypot(corner.x - centre.x, corner.y - centre.y);
  if (r < 1e-6) throw new Error('a polygon needs a size');
  const a0 = Math.atan2(corner.y - centre.y, corner.x - centre.x);
  const c = pointFor(sk, centre);
  const circ = nid(sk, 'c');
  sk.ents.push({ id: circ, kind: 'circle', c, r, construction: true });
  const ps = Array.from({ length: n }, (_, k) =>
    k === 0 ? pointFor(sk, corner) : pointFor(sk, { x: centre.x + r * Math.cos(a0 + (2 * Math.PI * k) / n), y: centre.y + r * Math.sin(a0 + (2 * Math.PI * k) / n), kind: 'free' }),
  );
  const ls = ps.map((p, k) => {
    const id = nid(sk, 'l');
    sk.ents.push({ id, kind: 'line', a: p, b: ps[(k + 1) % n] });
    return id;
  });
  for (let k = 1; k < n; k++) addConstraint(sk, { kind: 'equal', e1: ls[0], e2: ls[k] });
  // Corners on the circle: the distance from the centre equals its radius (as point-to-point distances kept equal).
  return [circ, ...ls];
}

/** Remove an entity, the constraints on it, and points nothing uses any more. */
export function removeEntity(sk: Sketch2D, id: string): void {
  sk.ents = sk.ents.filter((e) => e.id !== id);
  sk.cons = sk.cons.filter((c) => !('e' in c && c.e === id) && !('e1' in c && (c.e1 === id || c.e2 === id)));
  const used = new Set<string>(['o']);
  for (const e of sk.ents) {
    if (e.kind === 'line') used.add(e.a).add(e.b);
    else if (e.kind === 'circle') used.add(e.c);
    else if (e.kind === 'spline') for (const q of e.pts) used.add(q);
    else if (e.kind === 'ellipse') used.add(e.c).add(e.m);
    else used.add(e.c).add(e.a).add(e.b);
  }
  sk.points = sk.points.filter((p) => used.has(p.id));
  sk.cons = sk.cons.filter((c) => {
    const ps = 'p' in c ? [c.p] : 'p1' in c ? [c.p1, c.p2] : [];
    return ps.every((p) => used.has(p));
  });
}

/** The entity nearest a position (mm), within reach, or null. */
export function pickEntity(sk: Sketch2D, x: number, y: number, reach = 3): string | null {
  let best: string | null = null;
  let bestD = reach;
  for (const e of sk.ents) {
    let d = Infinity;
    if (e.kind === 'line') {
      const a = pt(sk, e.a);
      const b = pt(sk, e.b);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
      d = Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
    } else if (e.kind === 'circle') {
      const c = pt(sk, e.c);
      d = Math.abs(Math.hypot(x - c.x, y - c.y) - e.r);
    } else if (e.kind === 'spline' || e.kind === 'ellipse') {
      const poly = e.kind === 'ellipse' ? ellipsePts(sk, e) : splinePts(e.pts.map((id) => [pt(sk, id).x, pt(sk, id).y] as [number, number]));
      for (let i = 0; i + 1 < poly.length; i++) {
        const [ax, ay] = poly[i];
        const dx = poly[i + 1][0] - ax;
        const dy = poly[i + 1][1] - ay;
        const l2 = dx * dx + dy * dy;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
        d = Math.min(d, Math.hypot(ax + dx * t - x, ay + dy * t - y));
      }
    } else {
      const c = pt(sk, e.c);
      const a = pt(sk, e.a);
      const r = Math.hypot(a.x - c.x, a.y - c.y);
      d = Math.abs(Math.hypot(x - c.x, y - c.y) - r);
    }
    if (d < bestD) {
      bestD = d;
      best = e.id;
    }
  }
  return best;
}

/** The size a dimension on this entity would take now: a line's length, a circle's or arc's radius. */
export function measure(sk: Sketch2D, id: string): { kind: 'length' | 'radius'; value: number } | null {
  const e = ent(sk, id);
  if (!e) return null;
  if (e.kind === 'line') {
    const a = pt(sk, e.a);
    const b = pt(sk, e.b);
    return { kind: 'length', value: Math.hypot(b.x - a.x, b.y - a.y) };
  }
  if (e.kind === 'circle') return { kind: 'radius', value: e.r };
  if (e.kind === 'spline' || e.kind === 'ellipse') return null;
  const c = pt(sk, e.c);
  const a = pt(sk, e.a);
  return { kind: 'radius', value: Math.hypot(a.x - c.x, a.y - c.y) };
}

/** Set (or change) the driving dimension on an entity: a line's length, a circle's or arc's radius. */
export function dimension(sk: Sketch2D, id: string, value: number): string {
  const m = measure(sk, id);
  if (!m) throw new Error('nothing to dimension');
  if (!(value > 0)) throw new Error('a dimension must be positive');
  const old = sk.cons.find((c) => (c.kind === 'length' || c.kind === 'radius') && c.e === id);
  if (old && (old.kind === 'length' || old.kind === 'radius')) {
    old.value = value;
    return old.id;
  }
  return addConstraint(sk, m.kind === 'length' ? { kind: 'length', e: id, value } : { kind: 'radius', e: id, value });
}

export interface SolveResult {
  ok: boolean;
  /** Constraints that fight each other (ids), when the sketch is over-defined. */
  conflicting: string[];
  /** Degrees of freedom left: 0 is fully defined (black in SOLIDWORKS), more is under-defined (blue). */
  dof: number;
}

/** Solve the sketch in place: points move, radii change, so every constraint and dimension holds. */
export function solve(gcs: GcsWrapper, sk: Sketch2D): SolveResult {
  const prims: SketchPrimitive[] = [];
  const P = (id: string): SkPoint => pt(sk, id);
  const fixed = new Set(sk.cons.filter((c) => c.kind === 'fix').map((c) => (c as { p: string }).p));
  for (const p of sk.points) prims.push({ id: p.id, type: 'point', x: p.x, y: p.y, fixed: fixed.has(p.id) } as SketchPrimitive);
  for (const e of sk.ents) {
    if (e.kind === 'line') prims.push({ id: e.id, type: 'line', p1_id: e.a, p2_id: e.b } as SketchPrimitive);
    else if (e.kind === 'circle') prims.push({ id: e.id, type: 'circle', c_id: e.c, radius: e.r } as SketchPrimitive);
    else if (e.kind === 'spline' || e.kind === 'ellipse') continue;
    else {
      const c = P(e.c);
      const a = P(e.a);
      const b = P(e.b);
      const sa = Math.atan2(a.y - c.y, a.x - c.x);
      let ea = Math.atan2(b.y - c.y, b.x - c.x);
      while (ea <= sa) ea += 2 * Math.PI;
      prims.push({ id: e.id, type: 'arc', c_id: e.c, start_id: e.a, end_id: e.b, radius: Math.hypot(a.x - c.x, a.y - c.y), start_angle: sa, end_angle: ea } as SketchPrimitive);
      prims.push({ id: `${e.id}_rules`, type: 'arc_rules', a_id: e.id } as SketchPrimitive);
    }
  }
  const kindOf = (id: string): SkEntity['kind'] | undefined => ent(sk, id)?.kind;
  for (const c of sk.cons) {
    switch (c.kind) {
      case 'horizontal':
        prims.push({ id: c.id, type: 'horizontal_l', l_id: c.e } as SketchPrimitive);
        break;
      case 'vertical':
        prims.push({ id: c.id, type: 'vertical_l', l_id: c.e } as SketchPrimitive);
        break;
      case 'parallel':
        prims.push({ id: c.id, type: 'parallel', l1_id: c.e1, l2_id: c.e2 } as SketchPrimitive);
        break;
      case 'perpendicular':
        prims.push({ id: c.id, type: 'perpendicular_ll', l1_id: c.e1, l2_id: c.e2 } as SketchPrimitive);
        break;
      case 'equal': {
        const k1 = kindOf(c.e1);
        const k2 = kindOf(c.e2);
        if (k1 === 'line' && k2 === 'line') prims.push({ id: c.id, type: 'equal_length', l1_id: c.e1, l2_id: c.e2 } as SketchPrimitive);
        else if (k1 === 'arc' && k2 === 'arc') prims.push({ id: c.id, type: 'equal_radius_aa', a1_id: c.e1, a2_id: c.e2 } as SketchPrimitive);
        else if (k1 === 'circle' && k2 === 'circle') prims.push({ id: c.id, type: 'equal_radius_cc', c1_id: c.e1, c2_id: c.e2 } as SketchPrimitive);
        else if (k1 && k2) prims.push({ id: c.id, type: 'equal_radius_ca', c1_id: k1 === 'circle' ? c.e1 : c.e2, a2_id: k1 === 'circle' ? c.e2 : c.e1 } as SketchPrimitive);
        break;
      }
      case 'tangent': {
        const k1 = kindOf(c.e1);
        const k2 = kindOf(c.e2);
        // Tangent where they meet (a shared end), as FreeCAD does: the line square to the radius there, or two
        // arcs' centres in line with the shared point. "Tangent anywhere" on top of a shared end is redundant.
        const E1 = ent(sk, c.e1);
        const E2 = ent(sk, c.e2);
        const endsOf = (e: SkEntity | undefined): string[] => (!e || e.kind === 'circle' || e.kind === 'ellipse' ? [] : [e.a, e.b]);
        const shared = endsOf(E1).find((q) => endsOf(E2).includes(q));
        if (shared && E1 && E2) {
          const line = E1.kind === 'line' ? E1 : E2.kind === 'line' ? E2 : null;
          const arc1 = E1.kind === 'arc' ? E1 : null;
          const arc2 = E2.kind === 'arc' ? E2 : null;
          if (line && (arc1 || arc2)) {
            const arc = (arc1 ?? arc2)!;
            prims.push({ id: c.id, type: 'perpendicular_pppp', l1p1_id: line.a, l1p2_id: line.b, l2p1_id: arc.c, l2p2_id: shared } as SketchPrimitive);
            break;
          }
          if (arc1 && arc2) {
            prims.push({ id: c.id, type: 'point_on_line_ppp', p_id: shared, lp1_id: arc1.c, lp2_id: arc2.c } as SketchPrimitive);
            break;
          }
        }
        const lineId = k1 === 'line' ? c.e1 : k2 === 'line' ? c.e2 : null;
        const other = lineId === c.e1 ? c.e2 : c.e1;
        const ko = kindOf(other);
        if (lineId && ko === 'arc') prims.push({ id: c.id, type: 'tangent_la', l_id: lineId, a_id: other } as SketchPrimitive);
        else if (lineId && ko === 'circle') prims.push({ id: c.id, type: 'tangent_lc', l_id: lineId, c_id: other } as SketchPrimitive);
        else if (k1 === 'arc' && k2 === 'arc') prims.push({ id: c.id, type: 'tangent_aa', a1_id: c.e1, a2_id: c.e2 } as SketchPrimitive);
        else if (k1 === 'circle' && k2 === 'circle') prims.push({ id: c.id, type: 'tangent_cc', c1_id: c.e1, c2_id: c.e2 } as SketchPrimitive);
        else if (k1 && k2) prims.push({ id: c.id, type: 'tangent_ca', c_id: k1 === 'circle' ? c.e1 : c.e2, a_id: k1 === 'circle' ? c.e2 : c.e1 } as SketchPrimitive);
        break;
      }
      case 'coincident':
        prims.push({ id: c.id, type: 'p2p_coincident', p1_id: c.p1, p2_id: c.p2 } as SketchPrimitive);
        break;
      case 'pointOnLine':
        prims.push({ id: c.id, type: 'point_on_line_pl', p_id: c.p, l_id: c.e } as SketchPrimitive);
        break;
      case 'symmetric':
        prims.push({ id: c.id, type: 'p2p_symmetric_ppl', p1_id: c.p1, p2_id: c.p2, l_id: c.e } as SketchPrimitive);
        break;
      case 'length': {
        const l = ent(sk, c.e);
        if (l?.kind === 'line') prims.push({ id: c.id, type: 'p2p_distance', p1_id: l.a, p2_id: l.b, distance: c.value } as SketchPrimitive);
        break;
      }
      case 'distance':
        prims.push({ id: c.id, type: 'p2p_distance', p1_id: c.p1, p2_id: c.p2, distance: c.value } as SketchPrimitive);
        break;
      case 'radius':
        if (kindOf(c.e) === 'circle') prims.push({ id: c.id, type: 'circle_radius', c_id: c.e, radius: c.value } as SketchPrimitive);
        else prims.push({ id: c.id, type: 'arc_radius', a_id: c.e, radius: c.value } as SketchPrimitive);
        break;
      case 'angle':
        prims.push({ id: c.id, type: 'l2l_angle_ll', l1_id: c.e1, l2_id: c.e2, angle: (c.value * Math.PI) / 180 } as SketchPrimitive);
        break;
      case 'fix':
        break;
    }
  }
  gcs.clear_data();
  gcs.push_primitives_and_params(prims);
  gcs.solve();
  gcs.apply_solution();
  const conflicting = gcs.has_gcs_conflicting_constraints() ? gcs.get_gcs_conflicting_constraints() : [];
  for (const p of sk.points) {
    const q = gcs.sketch_index.get_sketch_point(p.id);
    p.x = q.x;
    p.y = q.y;
  }
  for (const e of sk.ents) {
    if (e.kind === 'circle') {
      const q = gcs.sketch_index.get_primitive(e.id) as { radius: number } | undefined;
      if (q) e.r = q.radius;
    }
  }
  let dof = 0;
  try {
    dof = (gcs as unknown as { gcs: { dof(): number } }).gcs.dof();
  } catch {
    dof = -1;
  }
  // Every driving dimension must hold after the solve.
  const holds = sk.cons.every((c) => {
    if (c.kind === 'length') return Math.abs((measure(sk, c.e)?.value ?? NaN) - c.value) < 1e-6;
    if (c.kind === 'radius') return Math.abs((measure(sk, c.e)?.value ?? NaN) - c.value) < 1e-6;
    return true;
  });
  return { ok: holds && !conflicting.length, conflicting, dof };
}

/** One closed region for a feature: its outer loop and the holes in it, as points with arc sweeps (deg). */
export interface Region {
  loops: { pts: [number, number][]; sweeps: number[] }[];
  area: number;
}

/**
 * The closed regions of the sketch (construction geometry left out): every loop of lines and arcs joined
 * end to end and every circle, nested into outer loops and their holes. Throws, naming the trouble, when a
 * profile is open (a free end) or branches (three edges at one point).
 */
export function profiles(sk: Sketch2D): Region[] {
  const solid = sk.ents.filter((e) => !e.construction);
  const loops: { pts: [number, number][]; sweeps: number[]; area: number; poly: [number, number][] }[] = [];
  const P = (id: string): [number, number] => {
    const q = pt(sk, id);
    return [q.x, q.y];
  };
  const sweepOf = (e: Extract<SkEntity, { kind: 'arc' }>): number => {
    const c = P(e.c);
    const a = P(e.a);
    const b = P(e.b);
    let s = Math.atan2(b[1] - c[1], b[0] - c[0]) - Math.atan2(a[1] - c[1], a[0] - c[0]);
    while (s <= 0) s += 2 * Math.PI;
    return (s * 180) / Math.PI;
  };
  const arcPts = (c: [number, number], a: [number, number], sweepDeg: number): [number, number][] => {
    const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
    const n = Math.max(2, Math.ceil(Math.abs(sweepDeg) / 5));
    return Array.from({ length: n - 1 }, (_, i) => {
      const t = a0 + (((sweepDeg * Math.PI) / 180) * (i + 1)) / n;
      return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)] as [number, number];
    });
  };
  const shoelace = (poly: [number, number][]): number => {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  };
  for (const e of solid) {
    if (e.kind !== 'ellipse') continue;
    // An ellipse: 96 straight pieces (the solid is exact to that outline).
    const poly = ellipsePts(sk, e);
    let area = 0;
    for (let i = 0; i < poly.length; i++) area += (poly[i][0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * poly[i][1]) / 2;
    loops.push({ pts: poly, sweeps: poly.map(() => 0), area: Math.abs(area), poly });
  }
  for (const e of solid) {
    if (e.kind !== 'circle') continue;
    const c = P(e.c);
    // Two half circles: exact arcs in the outline.
    const pts: [number, number][] = [[c[0] + e.r, c[1]], [c[0] - e.r, c[1]]];
    const poly = [...[pts[0]], ...arcPts(c, pts[0], 180), pts[1], ...arcPts(c, pts[1], 180)];
    loops.push({ pts, sweeps: [180, 180], area: Math.PI * e.r * e.r, poly });
  }
  // Lines and arcs: a graph on their end points.
  const edges = solid.filter((e) => e.kind !== 'circle' && e.kind !== 'ellipse') as Exclude<SkEntity, { kind: 'circle' } | { kind: 'ellipse' }>[];
  const at = new Map<string, number[]>();
  edges.forEach((e, i) => {
    for (const p of [e.a, e.b]) at.set(p, [...(at.get(p) ?? []), i]);
  });
  for (const [p, list] of at) {
    if (list.length === 1) {
      const q = pt(sk, p);
      throw new Error(`the profile is open at (${q.x.toFixed(1)}, ${q.y.toFixed(1)}): join that end to another`);
    }
    if (list.length > 2) {
      const q = pt(sk, p);
      throw new Error(`${list.length} edges meet at (${q.x.toFixed(1)}, ${q.y.toFixed(1)}); a profile may only pass through a point once (make the extra edges construction)`);
    }
  }
  const used = new Set<number>();
  for (let s = 0; s < edges.length; s++) {
    if (used.has(s)) continue;
    const pts: [number, number][] = [];
    const sweeps: number[] = [];
    const poly: [number, number][] = [];
    let cur = s;
    let from = edges[s].a;
    for (let guard = 0; guard <= edges.length; guard++) {
      used.add(cur);
      const e = edges[cur];
      const forward = e.a === from;
      const to = forward ? e.b : e.a;
      pts.push(P(from));
      poly.push(P(from));
      if (e.kind === 'arc') {
        const sw = sweepOf(e) * (forward ? 1 : -1);
        sweeps.push(sw);
        poly.push(...arcPts(P(e.c), P(from), sw));
      } else if (e.kind === 'spline') {
        // The curve as short straight pieces (its inner samples join the loop).
        const s = splinePts(e.pts.map(P));
        const inner = (forward ? s : [...s].reverse()).slice(1, -1);
        sweeps.push(0);
        for (const q of inner) {
          pts.push(q);
          poly.push(q);
          sweeps.push(0);
        }
      } else sweeps.push(0);
      const next = (at.get(to) ?? []).find((i) => i !== cur);
      if (next === undefined || used.has(next)) break;
      cur = next;
      from = to;
    }
    // Exact signed area: the polygon of the end points plus each arc's circular segment.
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area += (a[0] * b[1] - b[0] * a[1]) / 2;
      if (sweeps[i]) {
        const th = (Math.abs(sweeps[i]) * Math.PI) / 180;
        const r = Math.hypot(b[0] - a[0], b[1] - a[1]) / (2 * Math.sin(th / 2));
        area += Math.sign(sweeps[i]) * ((r * r) / 2) * (th - Math.sin(th));
      }
    }
    void shoelace;
    // Anticlockwise loops (positive area): reverse a clockwise one, flipping its arcs.
    if (area < 0) {
      const n = pts.length;
      const rp: [number, number][] = [pts[0]];
      const rs: number[] = [];
      for (let i = n - 1; i >= 1; i--) rp.push(pts[i]);
      for (let i = n - 1; i >= 0; i--) rs.push(-sweeps[i]);
      loops.push({ pts: rp, sweeps: rs, area: -area, poly: [...poly].reverse() });
    } else loops.push({ pts, sweeps, area, poly });
  }
  // Nesting: a loop inside an odd number of others is a hole of the smallest that holds it.
  const inside = (q: [number, number], poly: [number, number][]): boolean => {
    let r = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a[1] > q[1] !== b[1] > q[1] && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]) r = !r;
    }
    return r;
  };
  const probe = (l: (typeof loops)[number]): [number, number] => {
    // A point just inside the loop's first edge (its midpoint, nudged towards the left: anticlockwise loops).
    const a = l.poly[0];
    const b = l.poly[1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(a[0] + b[0]) / 2 - ((b[1] - a[1]) / len) * 1e-4, (a[1] + b[1]) / 2 + ((b[0] - a[0]) / len) * 1e-4];
  };
  const parents = loops.map((l, i) =>
    loops
      .map((o, j) => ({ o, j }))
      .filter(({ o, j }) => j !== i && o.area > l.area && inside(probe(l), o.poly))
      .sort((x, y) => x.o.area - y.o.area),
  );
  const depth = parents.map((p) => p.length);
  const regions: Region[] = [];
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 1) return;
    const holes = loops.filter((_, j) => depth[j] === depth[i] + 1 && parents[j][0]?.j === i);
    regions.push({
      loops: [l, ...holes].map((x) => ({ pts: x.pts, sweeps: x.sweeps })),
      area: l.area - holes.reduce((s, h) => s + h.area, 0),
    });
  });
  if (!regions.length) throw new Error('the sketch has no closed profile');
  return regions;
}

/** A spline through picked points (at least two). */
export function addSpline(sk: Sketch2D, picks: Snap[]): string {
  if (picks.length < 2) throw new Error('a spline needs at least two points');
  const ids = picks.map((p) => pointFor(sk, p));
  const id = nid(sk, 's');
  sk.ents.push({ id, kind: 'spline', a: ids[0], b: ids[ids.length - 1], pts: ids });
  return id;
}

/** The lines meeting at a point (by id). */
function linesAt(sk: Sketch2D, p: string): Extract<SkEntity, { kind: 'line' }>[] {
  return sk.ents.filter((e): e is Extract<SkEntity, { kind: 'line' }> => e.kind === 'line' && (e.a === p || e.b === p));
}

/**
 * A sketch fillet: the corner where two lines meet is rounded with an arc of radius r, tangent to both; the
 * lines are cut back to where it touches them (as in SOLIDWORKS' Sketch Fillet).
 */
export function filletCorner(sk: Sketch2D, x: number, y: number, r: number): string {
  // The corner: the point nearest the pick that has exactly two lines.
  let best: SkPoint | null = null;
  let bestD = 4;
  for (const q of sk.points) {
    if (linesAt(sk, q.id).length !== 2) continue;
    const d = Math.hypot(q.x - x, q.y - y);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  if (!best) throw new Error('pick a corner where two lines meet');
  const P = best;
  const [l1, l2] = linesAt(sk, P.id);
  const far = (l: Extract<SkEntity, { kind: 'line' }>): SkPoint => pt(sk, l.a === P.id ? l.b : l.a);
  const A = far(l1);
  const B = far(l2);
  const u1 = [A.x - P.x, A.y - P.y];
  const u2 = [B.x - P.x, B.y - P.y];
  const L1 = Math.hypot(u1[0], u1[1]);
  const L2 = Math.hypot(u2[0], u2[1]);
  u1[0] /= L1; u1[1] /= L1;
  u2[0] /= L2; u2[1] /= L2;
  const cosT = u1[0] * u2[0] + u1[1] * u2[1];
  const theta = Math.acos(Math.max(-1, Math.min(1, cosT)));
  if (theta < 1e-3 || theta > Math.PI - 1e-3) throw new Error('those lines are in line; there is no corner to round');
  const t = r / Math.tan(theta / 2);
  if (t >= L1 - 1e-6 || t >= L2 - 1e-6) throw new Error(`a ${r} mm fillet does not fit those lines`);
  const bis = [u1[0] + u2[0], u1[1] + u2[1]];
  const bl = Math.hypot(bis[0], bis[1]);
  const h = r / Math.sin(theta / 2);
  const T1 = pointFor(sk, { x: P.x + u1[0] * t, y: P.y + u1[1] * t, kind: 'free' });
  const T2 = pointFor(sk, { x: P.x + u2[0] * t, y: P.y + u2[1] * t, kind: 'free' });
  const C = pointFor(sk, { x: P.x + (bis[0] / bl) * h, y: P.y + (bis[1] / bl) * h, kind: 'free' });
  if (l1.a === P.id) l1.a = T1;
  else l1.b = T1;
  if (l2.a === P.id) l2.a = T2;
  else l2.b = T2;
  // Anticlockwise from T1 to T2 about C, or the other way round.
  const c = pt(sk, C);
  const a1 = Math.atan2(pt(sk, T1).y - c.y, pt(sk, T1).x - c.x);
  const a2 = Math.atan2(pt(sk, T2).y - c.y, pt(sk, T2).x - c.x);
  let sweep = a2 - a1;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  const id = nid(sk, 'a');
  sk.ents.push(sweep > 0 ? { id, kind: 'arc', c: C, a: T1, b: T2 } : { id, kind: 'arc', c: C, a: T2, b: T1 });
  addConstraint(sk, { kind: 'tangent', e1: l1.id, e2: id });
  addConstraint(sk, { kind: 'tangent', e1: l2.id, e2: id });
  addConstraint(sk, { kind: 'radius', e: id, value: r });
  // The old corner point goes, with anything that held it.
  if (!sk.ents.some((e) => (e.kind === 'line' || e.kind === 'arc' || e.kind === 'spline' ? e.a === P.id || e.b === P.id : e.c === P.id) || (e.kind === 'arc' && e.c === P.id))) {
    sk.points = sk.points.filter((q) => q.id !== P.id || q.id === 'o');
    sk.cons = sk.cons.filter((k) => !(('p' in k && k.p === P.id) || ('p1' in k && (k.p1 === P.id || k.p2 === P.id))));
  }
  return id;
}

/** Where a line segment (a to b) crosses other geometry: parameters along it, 0 to 1. */
function crossings(sk: Sketch2D, a: [number, number], b: [number, number], skip: string): number[] {
  const out: number[] = [];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  for (const e of sk.ents) {
    if (e.id === skip) continue;
    if (e.kind === 'line') {
      const p = pt(sk, e.a);
      const q = pt(sk, e.b);
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((p.x - a[0]) * ey - (p.y - a[1]) * ex) / den;
      const s = ((p.x - a[0]) * dy - (p.y - a[1]) * dx) / den;
      if (t > 1e-9 && t < 1 - 1e-9 && s >= -1e-9 && s <= 1 + 1e-9) out.push(t);
    } else if (e.kind === 'circle' || e.kind === 'arc') {
      const c = pt(sk, e.c);
      const r = e.kind === 'circle' ? e.r : Math.hypot(pt(sk, e.a).x - c.x, pt(sk, e.a).y - c.y);
      const fx = a[0] - c.x;
      const fy = a[1] - c.y;
      const A = dx * dx + dy * dy;
      const B = 2 * (fx * dx + fy * dy);
      const C = fx * fx + fy * fy - r * r;
      const disc = B * B - 4 * A * C;
      if (disc < 0) continue;
      for (const t of [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)]) {
        if (!(t > 1e-9 && t < 1 - 1e-9)) continue;
        if (e.kind === 'arc') {
          const ang = Math.atan2(a[1] + dy * t - c.y, a[0] + dx * t - c.x);
          const a0 = Math.atan2(pt(sk, e.a).y - c.y, pt(sk, e.a).x - c.x);
          let s1 = Math.atan2(pt(sk, e.b).y - c.y, pt(sk, e.b).x - c.x) - a0;
          while (s1 <= 0) s1 += 2 * Math.PI;
          let sa = ang - a0;
          while (sa < 0) sa += 2 * Math.PI;
          if (sa > s1) continue;
        }
        out.push(t);
      }
    }
  }
  return out.sort((x, y) => x - y);
}

/**
 * Trim: remove the piece of a line between the crossings either side of the pick (or to its end); a line
 * that crosses nothing is deleted. A circle is cut back to an arc between the crossings either side.
 */
export function trimAt(sk: Sketch2D, x: number, y: number): string {
  const id = pickEntity(sk, x, y, 3);
  if (!id) throw new Error('pick the piece to trim');
  const e = ent(sk, id)!;
  if (e.kind === 'line') {
    const A = pt(sk, e.a);
    const B = pt(sk, e.b);
    const a: [number, number] = [A.x, A.y];
    const b: [number, number] = [B.x, B.y];
    const ts = crossings(sk, a, b, id);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const tp = ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy);
    const lo = [0, ...ts].filter((t) => t < tp).pop() ?? 0;
    const hi = [...ts, 1].find((t) => t > tp) ?? 1;
    const at = (t: number): Snap => ({ x: a[0] + dx * t, y: a[1] + dy * t, kind: 'free' });
    if (lo === 0 && hi === 1) {
      removeEntity(sk, id);
      return 'Deleted (it crosses nothing).';
    }
    if (lo === 0) {
      e.a = pointFor(sk, at(hi));
      return 'Trimmed to the crossing.';
    }
    if (hi === 1) {
      e.b = pointFor(sk, at(lo));
      return 'Trimmed to the crossing.';
    }
    const mid = pointFor(sk, at(hi));
    const end = e.b;
    e.b = pointFor(sk, at(lo));
    const nl = nid(sk, 'l');
    sk.ents.push({ id: nl, kind: 'line', a: mid, b: end, construction: e.construction });
    return 'Trimmed out the piece between the crossings.';
  }
  if (e.kind === 'circle') {
    // Crossings as angles round the circle.
    const c = pt(sk, e.c);
    const angs: number[] = [];
    for (const o of sk.ents) {
      if (o.id === id || o.kind !== 'line') continue;
      const p = pt(sk, o.a);
      const q = pt(sk, o.b);
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const fx = p.x - c.x;
      const fy = p.y - c.y;
      const A = dx * dx + dy * dy;
      const B = 2 * (fx * dx + fy * dy);
      const C = fx * fx + fy * fy - e.r * e.r;
      const disc = B * B - 4 * A * C;
      if (disc < 0) continue;
      for (const t of [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)]) {
        if (t >= -1e-9 && t <= 1 + 1e-9) angs.push(Math.atan2(p.y + dy * t - c.y, p.x + dx * t - c.x));
      }
    }
    if (angs.length < 2) {
      removeEntity(sk, id);
      return 'Deleted (it crosses fewer than two lines).';
    }
    const norm = (v: number): number => ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const ap = Math.atan2(y - c.y, x - c.x);
    const sorted = angs.map((v) => norm(v - ap)).sort((u, v) => u - v);
    // Keep from the crossing after the pick round to the one before it.
    const start = norm(sorted[0] + ap);
    const stop = norm(sorted[sorted.length - 1] + ap);
    const pa = pointFor(sk, { x: c.x + e.r * Math.cos(start), y: c.y + e.r * Math.sin(start), kind: 'free' });
    const pb = pointFor(sk, { x: c.x + e.r * Math.cos(stop), y: c.y + e.r * Math.sin(stop), kind: 'free' });
    const r = e.r;
    removeEntity(sk, id);
    if (!sk.points.some((q) => q.id === e.c)) sk.points.push(c);
    const na = nid(sk, 'a');
    sk.ents.push({ id: na, kind: 'arc', c: e.c, a: pa, b: pb, construction: e.construction });
    void r;
    return 'Trimmed the circle to an arc.';
  }
  removeEntity(sk, id);
  return 'Deleted.';
}

/**
 * Offset: a line copied parallel at distance d towards the side picked; a circle or arc copied concentric,
 * d larger or smaller (towards the pick); a closed outline of lines offset as a whole (outwards for d > 0).
 */
export function offsetEntity(sk: Sketch2D, id: string, d: number, side: { x: number; y: number }): string[] {
  const e = ent(sk, id);
  if (!e) throw new Error('pick a line, arc or circle to offset');
  if (e.kind === 'circle' || e.kind === 'arc') {
    const c = pt(sk, e.c);
    const r0 = e.kind === 'circle' ? e.r : Math.hypot(pt(sk, e.a).x - c.x, pt(sk, e.a).y - c.y);
    const r = Math.hypot(side.x - c.x, side.y - c.y) > r0 ? r0 + d : r0 - d;
    if (r <= 0) throw new Error('that offset is larger than the radius');
    if (e.kind === 'circle') {
      const nidc = nid(sk, 'c');
      sk.ents.push({ id: nidc, kind: 'circle', c: e.c, r });
      return [nidc];
    }
    const k = r / r0;
    const A = pt(sk, e.a);
    const B = pt(sk, e.b);
    const pa = pointFor(sk, { x: c.x + (A.x - c.x) * k, y: c.y + (A.y - c.y) * k, kind: 'free' });
    const pb = pointFor(sk, { x: c.x + (B.x - c.x) * k, y: c.y + (B.y - c.y) * k, kind: 'free' });
    const na = nid(sk, 'a');
    sk.ents.push({ id: na, kind: 'arc', c: e.c, a: pa, b: pb });
    return [na];
  }
  if (e.kind !== 'line') throw new Error('splines and ellipses are not offset yet');
  // A closed loop of lines through this one: offset the whole outline.
  const loop: Extract<SkEntity, { kind: 'line' }>[] = [];
  let cur = e;
  let from = e.a;
  for (let guard = 0; guard < 400; guard++) {
    loop.push(cur);
    const to = cur.a === from ? cur.b : cur.a;
    const next = linesAt(sk, to).find((l) => l.id !== cur.id);
    if (!next || next.id === e.id) break;
    cur = next;
    from = to;
  }
  const closed = loop.length > 2 && linesAt(sk, from === loop[loop.length - 1].a ? loop[loop.length - 1].b : loop[loop.length - 1].a).some((l) => l.id === e.id);
  if (closed) {
    // Vertices in order, then each corner moved to where the offset sides meet.
    const vs: [number, number][] = [];
    let f = e.a;
    for (const l of loop) {
      const q = pt(sk, f);
      vs.push([q.x, q.y]);
      f = l.a === f ? l.b : l.a;
    }
    let area = 0;
    for (let i = 0; i < vs.length; i++) area += vs[i][0] * vs[(i + 1) % vs.length][1] - vs[(i + 1) % vs.length][0] * vs[i][1];
    // Outwards is to the right of travel for an anticlockwise outline.
    const out = area > 0 ? 1 : -1;
    const insidePick = (() => {
      let r = false;
      for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const a = vs[i];
        const b = vs[j];
        if (a[1] > side.y !== b[1] > side.y && side.x < ((b[0] - a[0]) * (side.y - a[1])) / (b[1] - a[1]) + a[0]) r = !r;
      }
      return r;
    })();
    const dd = insidePick ? -d : d;
    const n = vs.length;
    const shifted = vs.map((_, i) => {
      const a = vs[i];
      const b = vs[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = (out * (b[1] - a[1])) / L;
      const ny = (out * -(b[0] - a[0])) / L;
      return [[a[0] + nx * dd, a[1] + ny * dd], [b[0] + nx * dd, b[1] + ny * dd]] as [[number, number], [number, number]];
    });
    const corners: Snap[] = shifted.map((s1, i) => {
      const s0 = shifted[(i - 1 + n) % n];
      const [p, q] = s0;
      const [r1, r2] = s1;
      const den = (q[0] - p[0]) * (r2[1] - r1[1]) - (q[1] - p[1]) * (r2[0] - r1[0]);
      if (Math.abs(den) < 1e-12) return { x: r1[0], y: r1[1], kind: 'free' };
      const t = ((r1[0] - p[0]) * (r2[1] - r1[1]) - (r1[1] - p[1]) * (r2[0] - r1[0])) / den;
      return { x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t, kind: 'free' };
    });
    const ids = corners.map((c0) => pointFor(sk, c0));
    return ids.map((a, i) => {
      const lid = nid(sk, 'l');
      sk.ents.push({ id: lid, kind: 'line', a, b: ids[(i + 1) % n] });
      return lid;
    });
  }
  const A = pt(sk, e.a);
  const B = pt(sk, e.b);
  const L = Math.hypot(B.x - A.x, B.y - A.y);
  let nx = -(B.y - A.y) / L;
  let ny = (B.x - A.x) / L;
  if ((side.x - A.x) * nx + (side.y - A.y) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const id2 = addLine(sk, { x: A.x + nx * d, y: A.y + ny * d, kind: 'free' }, { x: B.x + nx * d, y: B.y + ny * d, kind: 'free' });
  addConstraint(sk, { kind: 'parallel', e1: id, e2: id2 });
  return [id2];
}

/** Mirror entities across a line (usually a construction centre line): copies kept symmetric by the solver. */
export function mirrorEntities(sk: Sketch2D, ids: string[], axis: string): string[] {
  const ax = ent(sk, axis);
  if (!ax || ax.kind !== 'line') throw new Error('mirror across a line: pick a (construction) line as the mirror');
  const A = pt(sk, ax.a);
  const B = pt(sk, ax.b);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const l2 = dx * dx + dy * dy;
  const map = new Map<string, string>();
  const image = (id: string): string => {
    const got = map.get(id);
    if (got) return got;
    const q = pt(sk, id);
    const t = ((q.x - A.x) * dx + (q.y - A.y) * dy) / l2;
    const fx = A.x + dx * t;
    const fy = A.y + dy * t;
    const mx = 2 * fx - q.x;
    const my = 2 * fy - q.y;
    // A point on the mirror line is its own image.
    if (Math.hypot(mx - q.x, my - q.y) < 1e-6) {
      map.set(id, id);
      return id;
    }
    const nidp = pointFor(sk, { x: mx, y: my, kind: 'free' });
    map.set(id, nidp);
    addConstraint(sk, { kind: 'symmetric', p1: id, p2: nidp, e: axis });
    return nidp;
  };
  const out: string[] = [];
  for (const id of ids) {
    const e = ent(sk, id);
    if (!e || id === axis) continue;
    const nidE = nid(sk, e.kind === 'line' ? 'l' : e.kind === 'circle' ? 'c' : e.kind === 'arc' ? 'a' : 's');
    if (e.kind === 'line') sk.ents.push({ id: nidE, kind: 'line', a: image(e.a), b: image(e.b), construction: e.construction });
    else if (e.kind === 'circle') sk.ents.push({ id: nidE, kind: 'circle', c: image(e.c), r: e.r, construction: e.construction });
    // A mirror turns anticlockwise into clockwise: the image runs from b's image to a's.
    else if (e.kind === 'arc') sk.ents.push({ id: nidE, kind: 'arc', c: image(e.c), a: image(e.b), b: image(e.a), construction: e.construction });
    else if (e.kind === 'ellipse') sk.ents.push({ id: nidE, kind: 'ellipse', c: image(e.c), m: image(e.m), rb: e.rb, construction: e.construction });
    else {
      const pts = e.pts.map(image);
      sk.ents.push({ id: nidE, kind: 'spline', a: pts[0], b: pts[pts.length - 1], pts, construction: e.construction });
    }
    out.push(nidE);
  }
  return out;
}

/** Open chains of solid lines (a sweep path): each as its points in order. */
export function openChains(sk: Sketch2D): [number, number][][] {
  const lines = sk.ents.filter((e): e is Extract<SkEntity, { kind: 'line' }> => e.kind === 'line' && !e.construction);
  const deg = new Map<string, number>();
  for (const l of lines) for (const p of [l.a, l.b]) deg.set(p, (deg.get(p) ?? 0) + 1);
  const used = new Set<string>();
  const out: [number, number][][] = [];
  for (const [p, n] of deg) {
    if (n !== 1) continue;
    const chain: [number, number][] = [];
    let at = p;
    for (let guard = 0; guard < 500; guard++) {
      const q = pt(sk, at);
      chain.push([q.x, q.y]);
      const next = lines.find((l) => !used.has(l.id) && (l.a === at || l.b === at));
      if (!next) break;
      used.add(next.id);
      at = next.a === at ? next.b : next.a;
    }
    if (chain.length >= 2 && !out.some((c) => c[0][0] === chain[chain.length - 1][0] && c[0][1] === chain[chain.length - 1][1])) out.push(chain);
  }
  return out;
}

/** An ellipse from its centre, the end of its major axis, and a point that sets its minor half-axis. */
export function addEllipse(sk: Sketch2D, centre: Snap, major: Snap, minor: Snap): string {
  const ra = Math.hypot(major.x - centre.x, major.y - centre.y);
  if (ra < 1e-6) throw new Error('an ellipse needs a size');
  const ux = (major.x - centre.x) / ra;
  const uy = (major.y - centre.y) / ra;
  const rb = Math.abs(-(minor.x - centre.x) * uy + (minor.y - centre.y) * ux);
  if (rb < 1e-6) throw new Error('pick the minor axis away from the major axis');
  const c = pointFor(sk, centre);
  const m = pointFor(sk, major);
  const id = nid(sk, 'e');
  sk.ents.push({ id, kind: 'ellipse', c, m, rb });
  return id;
}

/** Extend a line from its end nearer the pick to the first thing it meets. */
export function extendAt(sk: Sketch2D, x: number, y: number): string {
  const id = pickEntity(sk, x, y, 3);
  const e = id ? ent(sk, id) : undefined;
  if (!e || e.kind !== 'line') throw new Error('pick a line near the end to extend');
  const A = pt(sk, e.a);
  const B = pt(sk, e.b);
  const fromB = Math.hypot(x - B.x, y - B.y) < Math.hypot(x - A.x, y - A.y);
  const P0 = fromB ? A : B;
  const P1 = fromB ? B : A;
  const dx = P1.x - P0.x;
  const dy = P1.y - P0.y;
  // Along the line past its end: parameter t > 1, the nearest crossing.
  let best = Infinity;
  for (const o of sk.ents) {
    if (o.id === id) continue;
    if (o.kind === 'line') {
      const p = pt(sk, o.a);
      const q = pt(sk, o.b);
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((p.x - P0.x) * ey - (p.y - P0.y) * ex) / den;
      const s = ((p.x - P0.x) * dy - (p.y - P0.y) * dx) / den;
      if (t > 1 + 1e-9 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.min(best, t);
    } else if (o.kind === 'circle' || o.kind === 'arc') {
      const c = pt(sk, o.c);
      const r = o.kind === 'circle' ? o.r : Math.hypot(pt(sk, o.a).x - c.x, pt(sk, o.a).y - c.y);
      const fx = P0.x - c.x;
      const fy = P0.y - c.y;
      const a2 = dx * dx + dy * dy;
      const b2 = 2 * (fx * dx + fy * dy);
      const c2 = fx * fx + fy * fy - r * r;
      const disc = b2 * b2 - 4 * a2 * c2;
      if (disc < 0) continue;
      for (const t of [(-b2 - Math.sqrt(disc)) / (2 * a2), (-b2 + Math.sqrt(disc)) / (2 * a2)]) if (t > 1 + 1e-9) best = Math.min(best, t);
    }
  }
  if (!Number.isFinite(best)) throw new Error('nothing lies ahead of that end to extend to');
  const np = pointFor(sk, { x: P0.x + dx * best, y: P0.y + dy * best, kind: 'free' });
  if (fromB) e.b = np;
  else e.a = np;
  return `Extended ${((best - 1) * Math.hypot(dx, dy)).toFixed(1)} mm to the next edge.`;
}

/** Copies of entities moved by a transform of their points. */
function copyEntities(sk: Sketch2D, ids: string[], move: (x: number, y: number) => [number, number]): string[] {
  const map = new Map<string, string>();
  const image = (id: string): string => {
    const got = map.get(id);
    if (got) return got;
    const q = pt(sk, id);
    const [x, y] = move(q.x, q.y);
    const n = pointFor(sk, { x, y, kind: 'free' });
    map.set(id, n);
    return n;
  };
  const out: string[] = [];
  for (const id of ids) {
    const e = ent(sk, id);
    if (!e) continue;
    const k = nid(sk, e.kind[0]);
    if (e.kind === 'line') sk.ents.push({ ...e, id: k, a: image(e.a), b: image(e.b) });
    else if (e.kind === 'circle') sk.ents.push({ ...e, id: k, c: image(e.c) });
    else if (e.kind === 'arc') sk.ents.push({ ...e, id: k, c: image(e.c), a: image(e.a), b: image(e.b) });
    else if (e.kind === 'ellipse') sk.ents.push({ ...e, id: k, c: image(e.c), m: image(e.m) });
    else {
      const pts = e.pts.map(image);
      sk.ents.push({ ...e, id: k, pts, a: pts[0], b: pts[pts.length - 1] });
    }
    out.push(k);
  }
  return out;
}

/** A linear sketch pattern: `count` in a row (the originals first), `dx`, `dy` apart. */
export function linearPattern(sk: Sketch2D, ids: string[], count: number, dx: number, dy: number): string[] {
  const out: string[] = [];
  for (let k = 1; k < Math.max(2, Math.round(count)); k++) out.push(...copyEntities(sk, ids, (x, y) => [x + dx * k, y + dy * k]));
  return out;
}

/** A circular sketch pattern: `count` round (cx, cy) over `total` degrees. */
export function circularPattern(sk: Sketch2D, ids: string[], count: number, cx: number, cy: number, total = 360): string[] {
  const n = Math.max(2, Math.round(count));
  const step = ((Math.abs(total) >= 360 ? 360 / n : total / (n - 1)) * Math.PI) / 180;
  const out: string[] = [];
  for (let k = 1; k < n; k++) {
    const c = Math.cos(step * k);
    const s = Math.sin(step * k);
    out.push(...copyEntities(sk, ids, (x, y) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]));
  }
  return out;
}

