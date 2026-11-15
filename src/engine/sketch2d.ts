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
  | { id: string; kind: 'arc'; c: string; a: string; b: string; construction?: boolean };

export type SkConstraint =
  | { id: string; kind: 'horizontal' | 'vertical'; e: string }
  | { id: string; kind: 'parallel' | 'perpendicular' | 'equal' | 'tangent'; e1: string; e2: string }
  | { id: string; kind: 'fix'; p: string }
  | { id: string; kind: 'coincident'; p1: string; p2: string }
  | { id: string; kind: 'pointOnLine'; p: string; e: string }
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
    if (e.kind === 'circle' || e.kind === 'arc') {
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
        const endsOf = (e: SkEntity | undefined): string[] => (!e || e.kind === 'circle' ? [] : [e.a, e.b]);
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
    if (e.kind !== 'circle') continue;
    const c = P(e.c);
    // Two half circles: exact arcs in the outline.
    const pts: [number, number][] = [[c[0] + e.r, c[1]], [c[0] - e.r, c[1]]];
    const poly = [...[pts[0]], ...arcPts(c, pts[0], 180), pts[1], ...arcPts(c, pts[1], 180)];
    loops.push({ pts, sweeps: [180, 180], area: Math.PI * e.r * e.r, poly });
  }
  // Lines and arcs: a graph on their end points.
  const edges = solid.filter((e) => e.kind !== 'circle') as Exclude<SkEntity, { kind: 'circle' }>[];
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
