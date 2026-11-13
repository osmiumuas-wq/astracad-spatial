/**
 * Sketch geometry for Part Language v2: named frames, loop tessellation and
 * the exact (closed-form) integrals the expectation checker uses.
 *
 * Tessellation is "equal area": every arc is replaced by chords whose
 * interior points sit slightly outside the true radius, chosen so the polygon
 * encloses exactly the area of the true shape. An extrusion of that polygon
 * therefore has the exact volume of the ideal solid, and the truth gate can
 * compare the mesh kernel against closed-form values at 1e-6 instead of at
 * the chord error.
 */

import { ArcSeg, Feature, Seg, SpecError, Vec2, Vec3 } from './types.js';

export interface Frame {
  o: Vec3;
  x: Vec3;
  y: Vec3;
  n: Vec3;
}

/** Frames exactly as docs/engineering/part-language-v2.md section 1 defines them. */
export const NAMED_FRAMES: Readonly<Record<string, Frame>> = {
  front: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] },
  top: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 0, -1], n: [0, 1, 0] },
  right: { o: [0, 0, 0], x: [0, 0, -1], y: [0, 1, 0], n: [1, 0, 0] },
};

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  if (l < 1e-12) {
    throw new SpecError('zero-length direction');
  }
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Maximum chord sag before compensation, mm. Sets the facet count of a circle. */
export const SAG_MM = 0.02;
const MIN_SEGMENTS = 24;
const MAX_SEGMENTS = 96;

/** Facets for a full circle of radius r: a multiple of 4, so facets line up with the axes. */
export function circleSegments(r: number): number {
  const ratio = Math.min(1, SAG_MM / Math.max(r, 1e-6));
  const raw = Math.PI / Math.acos(1 - ratio);
  const clamped = Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, Math.ceil(raw)));
  return Math.ceil(clamped / 4) * 4;
}

/**
 * Radial scale that makes a regular n-gon fan of angular step `step` enclose
 * the area of the true sector: sqrt(step / sin(step)).
 */
export function equalAreaScale(step: number): number {
  return Math.sqrt(step / Math.sin(step));
}

/** How far a compensated facet vertex sticks out past the true radius, mm. */
export function compensationBulge(r: number, segments = circleSegments(r)): number {
  return r * (equalAreaScale((2 * Math.PI) / segments) - 1);
}

export function circlePolygon(
  cu: number,
  cv: number,
  r: number,
  segments = circleSegments(r),
): Vec2[] {
  const step = (2 * Math.PI) / segments;
  const rr = r * equalAreaScale(step);
  const pts: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    pts.push([cu + rr * Math.cos(i * step), cv + rr * Math.sin(i * step)]);
  }
  return pts;
}

const TWO_PI = 2 * Math.PI;
const CONNECT_TOL = 1e-6;

function arcSweep(seg: ArcSeg): { r: number; a0: number; sweep: number } {
  const [, cu, cv, su, sv, eu, ev, dir] = seg;
  const r = Math.hypot(su - cu, sv - cv);
  const r2 = Math.hypot(eu - cu, ev - cv);
  if (r < 1e-9 || Math.abs(r - r2) > 1e-6 * Math.max(1, r)) {
    throw new SpecError(
      `arc start and end are not at the same radius (${r} vs ${r2})`,
    );
  }
  if (dir !== 1 && dir !== -1) {
    throw new SpecError('arc direction must be +1 or -1');
  }
  const a0 = Math.atan2(sv - cv, su - cu);
  const a1 = Math.atan2(ev - cv, eu - cu);
  let theta = (a1 - a0) * dir;
  theta = ((theta % TWO_PI) + TWO_PI) % TWO_PI;
  if (theta < 1e-12) {
    theta = TWO_PI;
  }
  return { r, a0, sweep: theta * dir };
}

const segStart = (s: Seg): Vec2 =>
  s[0] === 'L' ? [s[1], s[2]] : s[0] === 'A' ? [s[3], s[4]] : [s[1] + s[3], s[2]];
const segEnd = (s: Seg): Vec2 =>
  s[0] === 'L' ? [s[3], s[4]] : s[0] === 'A' ? [s[5], s[6]] : [s[1] + s[3], s[2]];

function checkClosed(loop: Seg[]): void {
  for (let i = 0; i < loop.length; i++) {
    const a = segEnd(loop[i]);
    const b = segStart(loop[(i + 1) % loop.length]);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > CONNECT_TOL) {
      throw new SpecError(
        `loop is not closed: segment ${i} ends at (${a[0]}, ${a[1]}) but the next starts at (${b[0]}, ${b[1]})`,
      );
    }
  }
}

/** Closed polygon (last point not repeated) for one loop, equal-area. */
export function tessellateLoop(loop: Seg[]): Vec2[] {
  if (loop.length === 0) {
    throw new SpecError('empty loop');
  }
  if (loop.length === 1 && loop[0][0] === 'C') {
    const [, cu, cv, r] = loop[0];
    if (!(r > 0)) {
      throw new SpecError('circle radius must be positive');
    }
    return circlePolygon(cu, cv, r);
  }
  if (loop.some((s) => s[0] === 'C')) {
    throw new SpecError('a "C" circle must be a loop on its own');
  }
  checkClosed(loop);
  const pts: Vec2[] = [];
  for (const seg of loop) {
    if (seg[0] === 'L') {
      pts.push([seg[1], seg[2]]);
      continue;
    }
    const arc = seg as ArcSeg;
    const { r, a0, sweep } = arcSweep(arc);
    const theta = Math.abs(sweep);
    const full = circleSegments(r);
    const n = Math.max(2, Math.ceil(theta / (TWO_PI / full)));
    const step = theta / n;
    // Interior radius rp solves: sector area = fan area with end points on r.
    const rp =
      n === 2
        ? (r * theta) / (2 * Math.sin(step))
        : (r * (-1 + Math.sqrt(1 + ((n - 2) * theta) / Math.sin(step)))) / (n - 2);
    pts.push([arc[3], arc[4]]);
    const sign = Math.sign(sweep);
    for (let i = 1; i < n; i++) {
      const a = a0 + sign * i * step;
      pts.push([arc[1] + rp * Math.cos(a), arc[2] + rp * Math.sin(a)]);
    }
  }
  return pts;
}

/** Exact area and first moments of one loop (signed: counter-clockwise positive). */
export interface LoopIntegrals {
  area: number;
  /** Integral of u over the region. */
  mu: number;
  /** Integral of v over the region. */
  mv: number;
}

export function loopIntegrals(loop: Seg[]): LoopIntegrals {
  if (loop.length === 1 && loop[0][0] === 'C') {
    const [, cu, cv, r] = loop[0];
    const a = Math.PI * r * r;
    return { area: a, mu: cu * a, mv: cv * a };
  }
  checkClosed(loop);
  let area = 0;
  let iu2 = 0; // closed integral of u^2 dv
  let iv2 = 0; // closed integral of v^2 du
  for (const seg of loop) {
    if (seg[0] === 'L') {
      const [, u1, v1, u2, v2] = seg;
      area += 0.5 * (u1 * v2 - u2 * v1);
      iu2 += ((v2 - v1) * (u1 * u1 + u1 * u2 + u2 * u2)) / 3;
      iv2 += ((u2 - u1) * (v1 * v1 + v1 * v2 + v2 * v2)) / 3;
    } else if (seg[0] === 'A') {
      const arc = seg as ArcSeg;
      const [, cu, cv] = arc;
      const { r, a0, sweep } = arcSweep(arc);
      const a1 = a0 + sweep;
      const s0 = Math.sin(a0);
      const s1 = Math.sin(a1);
      const c0 = Math.cos(a0);
      const c1 = Math.cos(a1);
      area += 0.5 * (r * r * sweep + cu * r * (s1 - s0) - cv * r * (c1 - c0));
      const fu = (a: number, s: number): number =>
        cu * cu * s +
        2 * cu * r * (a / 2 + Math.sin(2 * a) / 4) +
        r * r * (s - (s * s * s) / 3);
      iu2 += r * (fu(a1, s1) - fu(a0, s0));
      const fv = (a: number, c: number): number =>
        -cv * cv * c +
        2 * cv * r * (a / 2 - Math.sin(2 * a) / 4) +
        r * r * (-c + (c * c * c) / 3);
      iv2 += -r * (fv(a1, c1) - fv(a0, c0));
    } else {
      throw new SpecError('a "C" circle must be a loop on its own');
    }
  }
  return { area, mu: 0.5 * iu2, mv: -0.5 * iv2 };
}

/** Outer loop minus openings: "the largest loop is the outside, every other loop an opening". */
export function sketchIntegrals(loops: Seg[][]): LoopIntegrals {
  if (loops.length === 0) {
    throw new SpecError('sketch has no loops');
  }
  const parts = loops.map(loopIntegrals).map((p) => {
    const s = p.area < 0 ? -1 : 1;
    return { area: p.area * s, mu: p.mu * s, mv: p.mv * s };
  });
  let outer = 0;
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].area > parts[outer].area) {
      outer = i;
    }
  }
  const out = { ...parts[outer] };
  parts.forEach((p, i) => {
    if (i !== outer) {
      out.area -= p.area;
      out.mu -= p.mu;
      out.mv -= p.mv;
    }
  });
  return out;
}

export function polygonArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

const num = (v: unknown, name: string, fallback?: number): number => {
  if (v === undefined && fallback !== undefined) {
    return fallback;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new SpecError(`argument "${name}" must be a finite number`);
  }
  return v;
};

/** Loops of any sketch operation, in the sketch frame. */
export function sketchLoops(f: Feature): Seg[][] {
  const a = f.args;
  switch (f.$op) {
    case 'sketch.rectangle': {
      const w = num(a.width, 'width');
      const h = num(a.height, 'height');
      const x = num(a.x, 'x', 0);
      const y = num(a.y, 'y', 0);
      if (!(w > 0 && h > 0)) {
        throw new SpecError('rectangle width and height must be positive', f.id);
      }
      return [
        [
          ['L', x, y, x + w, y],
          ['L', x + w, y, x + w, y + h],
          ['L', x + w, y + h, x, y + h],
          ['L', x, y + h, x, y],
        ],
      ];
    }
    case 'sketch.circle': {
      const r =
        a.radius !== undefined
          ? num(a.radius, 'radius')
          : num(a.diameter, 'diameter') / 2;
      if (!(r > 0)) {
        throw new SpecError('circle radius must be positive', f.id);
      }
      return [[['C', num(a.x, 'x', 0), num(a.y, 'y', 0), r]]];
    }
    case 'sketch.loops': {
      if (!Array.isArray(a.loops) || a.loops.length === 0) {
        throw new SpecError('sketch.loops needs at least one loop', f.id);
      }
      return a.loops as Seg[][];
    }
    case 'sketch.profile': {
      const pts = a.points as Vec2[];
      if (!Array.isArray(pts) || pts.length < 3) {
        throw new SpecError('sketch.profile needs at least three points', f.id);
      }
      return [
        pts.map((p, i): Seg => {
          const q = pts[(i + 1) % pts.length];
          return ['L', p[0], p[1], q[0], q[1]];
        }),
      ];
    }
    default:
      throw new SpecError(`"${f.$op}" is not a sketch operation`, f.id);
  }
}

export const isSketchOp = (op: string): boolean => op.startsWith('sketch.');

/** Resolve a `ref.plane` (offset or explicit form) against the frames known so far. */
export function resolvePlane(f: Feature, frames: Map<string, Frame>): Frame {
  const a = f.args;
  if (a.base !== undefined) {
    const base = frames.get(String(a.base));
    if (!base) {
      throw new SpecError(`unknown base plane "${String(a.base)}"`, f.id);
    }
    const off = num(a.offset, 'offset');
    return {
      o: [
        base.o[0] + base.n[0] * off,
        base.o[1] + base.n[1] * off,
        base.o[2] + base.n[2] * off,
      ],
      x: base.x,
      y: base.y,
      n: base.n,
    };
  }
  const n = norm(a.normal as Vec3);
  const x = norm(a.x_dir as Vec3);
  if (Math.abs(dot(n, x)) > 1e-9) {
    throw new SpecError('ref.plane normal and x_dir must be perpendicular', f.id);
  }
  return { o: a.origin as Vec3, x, y: cross(n, x), n };
}

export { num as numArg };
