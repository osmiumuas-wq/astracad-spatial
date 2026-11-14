/**
 * Drilling template: the mounting face of a part, life-size, with its screw
 * holes, from a section of the solid just inside that face.
 *
 *  - The mounting face is the side of the part the job's fixture holds: the
 *    fixture region is a thin box against one side of the part.
 *  - In the section, loops wound one way are outlines and the other way are
 *    holes. A hole is reported as a circle of the same area: its centre is the
 *    loop's centroid, its diameter 2 sqrt(area / pi).
 */

import type { Region } from './jobs.js';
import type { Box3, Vec2, Vec3 } from './types.js';

/** Signed area of a loop (positive counter-clockwise) and its centroid. */
export function loopArea(loop: Vec2[]): { area: number; c: Vec2 } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x0, y0] = loop[i];
    const [x1, y1] = loop[(i + 1) % loop.length];
    const k = x0 * y1 - x1 * y0;
    a += k;
    cx += (x0 + x1) * k;
    cy += (y0 + y1) * k;
  }
  a /= 2;
  return { area: a, c: a !== 0 ? [cx / (6 * a), cy / (6 * a)] : [0, 0] };
}

/** The outward normal of the face the fixture holds, or null when the fixture is not against one side. */
export function mountingNormal(fixture: Region[], box: Box3): Vec3 | null {
  const r = fixture.find((f) => f.kind === 'box');
  if (!r || r.kind !== 'box') return null;
  const size = [r.max[0] - r.min[0], r.max[1] - r.min[1], r.max[2] - r.min[2]];
  // The thin direction of the fixture box is the face normal's axis.
  let axis = 0;
  for (let i = 1; i < 3; i++) if (size[i] < size[axis]) axis = i;
  const mid = (r.min[axis] + r.max[axis]) / 2;
  const lo = Math.abs(mid - box.min[axis]);
  const hi = Math.abs(mid - box.max[axis]);
  const n: Vec3 = [0, 0, 0];
  n[axis] = lo < hi ? -1 : 1;
  return n;
}

export interface Template {
  /** The outer outline (largest loop). */
  outline: Vec2[];
  holes: { c: Vec2; d: number }[];
}

/** Outline and round holes of a face section. Holes smaller than 1 mm or not round are left out. */
export function templateOf(loops: Vec2[][]): Template {
  const info = loops.map((l) => ({ l, ...loopArea(l) }));
  if (!info.length) return { outline: [], holes: [] };
  const outer = info.reduce((m, q) => (Math.abs(q.area) > Math.abs(m.area) ? q : m));
  const sign = Math.sign(outer.area);
  const holes: { c: Vec2; d: number }[] = [];
  for (const q of info) {
    if (q === outer || Math.sign(q.area) === sign) continue;
    const d = 2 * Math.sqrt(Math.abs(q.area) / Math.PI);
    if (d < 1) continue;
    // Round: every vertex within 15 % of the radius from the centroid.
    const round = q.l.every(([x, y]) => Math.abs(Math.hypot(x - q.c[0], y - q.c[1]) - d / 2) < 0.15 * (d / 2) + 0.1);
    if (round) holes.push({ c: q.c, d });
  }
  return { outline: outer.l, holes };
}

/** "2 holes, 4.5 mm, 44.0 mm apart" style summary. */
export function describeHoles(holes: { c: Vec2; d: number }[]): string {
  if (!holes.length) return 'No round holes on this face.';
  const ds = [...new Set(holes.map((h) => h.d.toFixed(1)))].join(' and ');
  let text = `${holes.length} hole${holes.length > 1 ? 's' : ''}, ${ds} mm`;
  if (holes.length === 2) {
    text += `, ${Math.hypot(holes[0].c[0] - holes[1].c[0], holes[0].c[1] - holes[1].c[1]).toFixed(1)} mm apart`;
  }
  return text;
}
