/**
 * Air sketch: turn a hand-drawn stroke into a clean closed outline.
 *
 * Deterministic geometric rules, no learned model: a stroke that stays at a
 * near-constant distance from its centre becomes a circle; anything else is
 * simplified (Ramer-Douglas-Peucker), its near-horizontal and near-vertical
 * edges are snapped square, its corners are rounded to a 0.5 mm grid, and the
 * result must be a simple polygon (no edge crossing another) or it is refused.
 */

import { Vec2 } from './types.js';

export type Outline =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'polygon'; points: Vec2[] };

export interface SketchResult {
  outline: Outline | null;
  /** Why the stroke was refused, when outline is null. */
  reason?: string;
  /** What the rules did, for the caption. */
  notes: string[];
}

const GRID = 0.5;
const SNAP_DEG = 12;
const MIN_SIZE = 8;

const snap = (v: number): number => Math.round(v / GRID) * GRID;

function rdp(points: Vec2[], eps: number): Vec2[] {
  if (points.length < 3) return points.slice();
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  let worst = -1;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs((points[i][0] - ax) * dy - (points[i][1] - ay) * dx) / len;
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= eps) return [points[0], points[points.length - 1]];
  const left = rdp(points.slice(0, at + 1), eps);
  const right = rdp(points.slice(at), eps);
  return left.slice(0, -1).concat(right);
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function isSimple(poly: Vec2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
    }
  }
  return true;
}

export function polyArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Clean a stroke (millimetres, in the drawing plane) into an outline. */
export function cleanStroke(stroke: Vec2[]): SketchResult {
  const notes: string[] = [];
  if (stroke.length < 6) return { outline: null, reason: 'The stroke is too short.', notes };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of stroke) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const size = Math.max(maxX - minX, maxY - minY);
  if (size < MIN_SIZE) return { outline: null, reason: `Draw larger than ${MIN_SIZE} mm.`, notes };

  // Circle: radius about the centroid nearly constant all the way round.
  let cx = 0;
  let cy = 0;
  for (const [x, y] of stroke) {
    cx += x;
    cy += y;
  }
  cx /= stroke.length;
  cy /= stroke.length;
  const radii = stroke.map(([x, y]) => Math.hypot(x - cx, y - cy));
  const mean = radii.reduce((s, r) => s + r, 0) / radii.length;
  const sd = Math.sqrt(radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length);
  let turned = 0;
  for (let i = 1; i < stroke.length; i++) {
    const a0 = Math.atan2(stroke[i - 1][1] - cy, stroke[i - 1][0] - cx);
    const a1 = Math.atan2(stroke[i][1] - cy, stroke[i][0] - cx);
    let d = a1 - a0;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    turned += d;
  }
  if (sd / mean < 0.1 && Math.abs(turned) > 1.7 * Math.PI) {
    notes.push('Recognised a circle');
    return { outline: { kind: 'circle', cx: snap(cx), cy: snap(cy), r: Math.max(GRID, snap(mean)) }, notes };
  }

  // Polygon.
  // A closed curve is split at the point farthest from its start, and each half simplified.
  const eps = Math.max(2.5, size * 0.035);
  let far = 0;
  let farD = -1;
  stroke.forEach(([x, y], i) => {
    const d = Math.hypot(x - stroke[0][0], y - stroke[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  });
  const first = rdp(stroke.slice(0, far + 1), eps);
  const second = rdp(stroke.slice(far).concat([stroke[0]]), eps);
  let poly = first.slice(0, -1).concat(second.slice(0, -1)).map(([x, y]): Vec2 => [x, y]);
  if (poly.length < 3) return { outline: null, reason: 'The stroke does not enclose an area.', notes };
  // Drop repeated or collinear points.
  const clean: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const prev = clean[clean.length - 1];
    if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 1) continue;
    clean.push(p);
  }
  for (let changed = true; changed && clean.length > 3; ) {
    changed = false;
    for (let i = 0; i < clean.length; i++) {
      const a = clean[(i + clean.length - 1) % clean.length];
      const b = clean[i];
      const c = clean[(i + 1) % clean.length];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const span = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      // Drop a corner that sits within 1 mm of the line through its neighbours.
      if (Math.abs(cross) / span < 1 || Math.hypot(b[0] - c[0], b[1] - c[1]) < 1) {
        clean.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  if (clean.length < 3) return { outline: null, reason: 'The stroke does not enclose an area.', notes };
  // A very short edge is a corner the hand rounded: replace it by the meeting point of its neighbours.
  const shortEdge = Math.max(4, size * 0.08);
  for (let changed = true; changed && clean.length > 3; ) {
    changed = false;
    for (let i = 0; i < clean.length; i++) {
      const n = clean.length;
      const a = clean[(i + n - 1) % n];
      const b = clean[i];
      const c = clean[(i + 1) % n];
      const d = clean[(i + 2) % n];
      if (Math.hypot(c[0] - b[0], c[1] - b[1]) >= shortEdge) continue;
      const d1x = b[0] - a[0], d1y = b[1] - a[1];
      const d2x = d[0] - c[0], d2y = d[1] - c[1];
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) > 1e-9) {
        const t = ((c[0] - a[0]) * d2y - (c[1] - a[1]) * d2x) / den;
        clean[i] = [a[0] + d1x * t, a[1] + d1y * t];
      }
      clean.splice((i + 1) % n, 1);
      changed = true;
      break;
    }
  }
  // Square up near-horizontal and near-vertical edges.
  const tan = Math.tan((SNAP_DEG * Math.PI) / 180);
  let squared = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < clean.length; i++) {
      const a = clean[i];
      const b = clean[(i + 1) % clean.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      if (Math.abs(dy) <= Math.abs(dx) * tan && dy !== 0) {
        const y = (a[1] + b[1]) / 2;
        a[1] = y;
        b[1] = y;
        squared++;
      } else if (Math.abs(dx) <= Math.abs(dy) * tan && dx !== 0) {
        const x = (a[0] + b[0]) / 2;
        a[0] = x;
        b[0] = x;
        squared++;
      }
    }
  }
  if (squared) notes.push('Squared edges to the axes');
  // A short slanted edge between a horizontal and a vertical edge is a corner cut off
  // where the stroke started and ended (the first and last samples are trimmed).
  // Put the square corner back.
  const isH = (p: Vec2, q: Vec2): boolean => p[1] === q[1] && p[0] !== q[0];
  const isV = (p: Vec2, q: Vec2): boolean => p[0] === q[0] && p[1] !== q[1];
  for (let changed = true; changed && clean.length > 4; ) {
    changed = false;
    const n = clean.length;
    for (let i = 0; i < n; i++) {
      const a = clean[(i + n - 1) % n];
      const b = clean[i];
      const c = clean[(i + 1) % n];
      const d = clean[(i + 2) % n];
      if (isH(b, c) || isV(b, c) || Math.hypot(c[0] - b[0], c[1] - b[1]) > 0.3 * size) continue;
      let corner: Vec2 | null = null;
      if (isV(a, b) && isH(c, d)) corner = [b[0], c[1]];
      else if (isH(a, b) && isV(c, d)) corner = [c[0], b[1]];
      if (!corner) continue;
      clean[i] = corner;
      clean.splice((i + 1) % n, 1);
      changed = true;
      notes.push('Restored a square corner');
      break;
    }
  }
  for (let i = 0; i < clean.length; i++) clean[i] = [snap(clean[i][0]), snap(clean[i][1])];
  if (clean.length < 3) return { outline: null, reason: 'The stroke does not enclose an area.', notes };
  if (!isSimple(clean)) return { outline: null, reason: 'The outline crosses itself. Draw it again without crossing.', notes };
  if (Math.abs(polyArea(clean)) < MIN_SIZE * MIN_SIZE / 2) {
    return { outline: null, reason: 'The outline encloses too little area.', notes };
  }
  // Counter-clockwise, as the sketch frame expects for an outer loop.
  if (polyArea(clean) < 0) clean.reverse();
  notes.push(`${clean.length} corners on a ${GRID} mm grid`);
  return { outline: { kind: 'polygon', points: clean }, notes };
}
