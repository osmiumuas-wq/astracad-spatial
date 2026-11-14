/**
 * Ray scan: points where the hand's ray met real surfaces (WebXR hit test,
 * which on Quest 3 rests on the depth sensor and the room's scene mesh) while
 * the hand swept over an object. The object is what stands above the surface
 * it sits on:
 *
 *  - the floor height is a low percentile of the hits (the table around it);
 *  - points more than 4 mm above the floor are the object;
 *  - its footprint is the minimum-area rectangle around their convex hull
 *    (rotating calipers: one side of the best rectangle lies on a hull edge);
 *  - its height is a high percentile above the floor.
 *
 * World metres in, millimetres out. The headset's surface hits are good to
 * about a centimetre, and the result says so.
 */

import { convexHull } from './stability.js';

export interface ScanBox {
  /** Footprint length and width (length >= width) and height, mm. */
  length: number;
  width: number;
  height: number;
  /** Footprint centre (x, z, metres), angle of the length side (rad, about +Y), floor height (m). */
  centre: [number, number];
  angle: number;
  floor: number;
  /** Points used for the object. */
  points: number;
}

function percentile(values: number[], q: number): number {
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

/** Minimum-area enclosing rectangle of 2D points: its two side lengths, centre and angle. */
export function minRect(points: [number, number][]): { a: number; b: number; c: [number, number]; angle: number } {
  const hull = convexHull(points);
  if (hull.length < 3) return { a: 0, b: 0, c: points[0] ?? [0, 0], angle: 0 };
  let best = { area: Infinity, a: 0, b: 0, c: [0, 0] as [number, number], angle: 0 };
  for (let i = 0; i < hull.length; i++) {
    const [x0, y0] = hull[i];
    const [x1, y1] = hull[(i + 1) % hull.length];
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of hull) {
      const u = x * ca + y * sa;
      const v = -x * sa + y * ca;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u);
      v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) {
      const uc = (u0 + u1) / 2;
      const vc = (v0 + v1) / 2;
      best = { area, a: u1 - u0, b: v1 - v0, c: [uc * ca - vc * sa, uc * sa + vc * ca], angle: ang };
    }
  }
  return { a: best.a, b: best.b, c: best.c, angle: best.angle };
}

/**
 * The largest group of points connected through neighbours closer than `link`
 * metres in plan (x, z): one object, not the object and the lamp beside it.
 */
export function largestCluster(points: [number, number, number][], link = 0.025): [number, number, number][] {
  const key = (x: number, z: number): string => `${Math.floor(x / link)},${Math.floor(z / link)}`;
  const grid = new Map<string, number[]>();
  points.forEach((p, i) => {
    const k = key(p[0], p[2]);
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  const seen = new Uint8Array(points.length);
  let best: number[] = [];
  for (let s = 0; s < points.length; s++) {
    if (seen[s]) continue;
    const group: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      group.push(i);
      const gx = Math.floor(points[i][0] / link);
      const gz = Math.floor(points[i][2] / link);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        for (const j of grid.get(`${gx + dx},${gz + dz}`) ?? []) {
          if (seen[j]) continue;
          if (Math.hypot(points[j][0] - points[i][0], points[j][2] - points[i][2]) <= link) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    if (group.length > best.length) best = group;
  }
  return best.map((i) => points[i]);
}

/** The object standing in a cloud of surface hits (world metres, +Y up), or null when there is none. */
export function scanBox(hits: [number, number, number][]): ScanBox | null {
  if (hits.length < 12) return null;
  const floor = percentile(hits.map((p) => p[1]), 0.05);
  const above = largestCluster(hits.filter((p) => p[1] > floor + 0.004));
  if (above.length < 6) return null;
  const r = minRect(above.map((p): [number, number] => [p[0], p[2]]));
  const top = percentile(above.map((p) => p[1]), 0.95);
  const long = r.a >= r.b;
  return {
    length: (long ? r.a : r.b) * 1000,
    width: (long ? r.b : r.a) * 1000,
    height: (top - floor) * 1000,
    centre: r.c,
    angle: long ? r.angle : r.angle + Math.PI / 2,
    floor,
    points: above.length,
  };
}
