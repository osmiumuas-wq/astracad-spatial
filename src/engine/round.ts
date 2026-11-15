/**
 * Rolling-ball fillets of any edge, straight or curved, with blended corners.
 *
 * Rolling a ball of radius r inside the material and keeping only what it can
 * reach is the morphological opening of the solid by a sphere: Minkowski
 * difference, then sum. It rounds every convex edge (straight, circular or any
 * other) to radius r and blends corners where rounded edges meet into sphere
 * patches, exactly as desktop CAD's rolling-ball fillet does. Rolling the ball
 * outside (closing: sum, then difference) fills concave edges the same way.
 *
 * Done on the whole part, it rounds everything. For picked edges the kernel
 * works locally (src/engine/kernel.ts round): the part near the edge chain is
 * cut out, opened or closed, and only the change within a tube round the chain
 * is kept. This module finds that chain: from the sharp-edge segments of the
 * part's mesh, the segment nearest a picked point, then its neighbours end to
 * end while the edge keeps turning by less than 35 degrees per segment (so a
 * circle's rim is followed all the way round; a box's edge stops at its
 * corners).
 */

import type { Vec3 } from './types.js';

export type Segment = [Vec3, Vec3];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function segmentsOf(edges: ArrayLike<number>): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i + 5 < edges.length; i += 6) {
    out.push([[edges[i], edges[i + 1], edges[i + 2]], [edges[i + 3], edges[i + 4], edges[i + 5]]]);
  }
  return out;
}

function distToSegment(p: Vec3, [a, b]: Segment): number {
  const d = sub(b, a);
  const l2 = dot(d, d);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
  return len(sub(p, [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t]));
}

/**
 * The chain of sharp-edge segments through the one nearest `at` (within
 * `reach`), grown end to end while the direction turns less than `maxTurn`
 * radians per joint. Null when no edge is near.
 */
export function edgeChain(segs: Segment[], at: Vec3, reach = 6, maxTurn = (35 * Math.PI) / 180, tol = 1e-3): Segment[] | null {
  let best = -1;
  let bestD = reach;
  segs.forEach((s, i) => {
    if (len(sub(s[1], s[0])) < 1e-9) return;
    const d = distToSegment(at, s);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  if (best < 0) return null;
  const used = new Set<number>([best]);
  const chain: Segment[] = [segs[best]];
  const cosMax = Math.cos(maxTurn);
  // Grow at the end (forward) and at the start (backward).
  for (const forward of [true, false]) {
    for (;;) {
      const end = forward ? chain[chain.length - 1] : chain[0];
      const tip = forward ? end[1] : end[0];
      const dir = unit(forward ? sub(end[1], end[0]) : sub(end[0], end[1]));
      let next = -1;
      let nextSeg: Segment | null = null;
      let bestCos = cosMax;
      segs.forEach((s, i) => {
        if (used.has(i)) return;
        let cand: Segment | null = null;
        if (len(sub(s[0], tip)) < tol) cand = forward ? [s[0], s[1]] : [s[1], s[0]];
        else if (len(sub(s[1], tip)) < tol) cand = forward ? [s[1], s[0]] : [s[0], s[1]];
        if (!cand) return;
        const d2 = unit(forward ? sub(cand[1], cand[0]) : sub(cand[0], cand[1]));
        const c = dot(dir, d2);
        if (c > bestCos) {
          bestCos = c;
          next = i;
          nextSeg = cand;
        }
      });
      if (next < 0 || !nextSeg) break;
      used.add(next);
      if (forward) chain.push(nextSeg);
      else chain.unshift(nextSeg);
    }
  }
  return chain;
}

/** Steiner's formula: a box a x b x c with every edge rounded to r (r <= half the smallest side). */
export function roundedBoxVolume(a: number, b: number, c: number, r: number): number {
  const A = a - 2 * r;
  const B = b - 2 * r;
  const C = c - 2 * r;
  return A * B * C + 2 * r * (A * B + B * C + A * C) + Math.PI * r * r * (A + B + C) + (4 / 3) * Math.PI * r ** 3;
}

/**
 * A circle through the chain's points (all within `tol` mm of one plane and of
 * one radius): centre, radius and unit normal of its plane. Null when the chain
 * is not a circle (a straight edge, an arc of changing radius).
 */
export function circleOf(chain: Segment[], tol = 0.02): { c: Vec3; r: number; n: Vec3 } | null {
  if (chain.length < 6) return null;
  const pts = chain.map((s) => s[0]);
  const c: Vec3 = [0, 0, 0];
  for (const p of pts) {
    c[0] += p[0] / pts.length;
    c[1] += p[1] / pts.length;
    c[2] += p[2] / pts.length;
  }
  // Plane normal from two well-separated chords.
  const a = sub(pts[0], c);
  const b = sub(pts[Math.floor(pts.length / 4)], c);
  const n = unit([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]);
  const rs = pts.map((p) => len(sub(p, c)));
  const r = rs.reduce((x, y) => x + y, 0) / rs.length;
  if (r < 1e-6) return null;
  for (let i = 0; i < pts.length; i++) {
    if (Math.abs(rs[i] - r) > tol + r * 0.002) return null;
    if (Math.abs(dot(sub(pts[i], c), n)) > tol) return null;
  }
  // A polygonal circle's vertices sit on the true circle: r is the circle's radius.
  return { c, r, n };
}
