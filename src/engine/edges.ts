/**
 * Fillets and chamfers of any straight edge between two flat faces, the way
 * desktop CAD offers them on a picked edge.
 *
 * At an edge the two faces have outward normals n1 and n2. In the plane across
 * the edge, t1 and t2 run along each face away from the edge; phi is the angle
 * between them (the material's angle at a convex edge). A fillet of radius r
 * touches both faces at r / tan(phi / 2) from the edge; the material between
 * the edge and that arc is removed (convex edge) or added (concave edge):
 *
 *   fillet area  = r^2 (cot(phi/2) - (pi - phi)/2)
 *   chamfer area = d^2 sin(phi) / 2          (cut d along both faces)
 *
 * times the edge length. The kernel builds the cutter from crossSection() and
 * subtracts or adds it; the closed forms check the result.
 */

import type { Vec2, Vec3 } from './types.js';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = len(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

export interface EdgeFaces {
  /** Outward normals of the two faces. */
  n1: Vec3;
  n2: Vec3;
  /** Unit directions along each face, away from the edge, across it. */
  t1: Vec3;
  t2: Vec3;
  /** Angle between t1 and t2 (rad): the material's angle at the edge when convex. */
  phi: number;
  convex: boolean;
}

/**
 * The two flat faces meeting along the straight edge a-b of a triangle mesh
 * (positions xyz, indices). Triangles with two corners on the edge's line and
 * inside its span are the ones touching it. Null when it is not a sharp edge
 * between exactly two flat faces.
 */
export function edgeFaces(positions: ArrayLike<number>, indices: ArrayLike<number>, a: Vec3, b: Vec3, tol = 1e-3): EdgeFaces | null {
  const u = unit(sub(b, a));
  const L = len(sub(b, a));
  const onEdge = (p: Vec3): boolean => {
    const d = sub(p, a);
    const s = dot(d, u);
    return s > -tol && s < L + tol && len(sub(d, scale(u, s))) < tol;
  };
  const found: { n: Vec3; inward: Vec3 }[] = [];
  const P = (i: number): Vec3 => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  for (let t = 0; t < indices.length; t += 3) {
    const v = [P(indices[t]), P(indices[t + 1]), P(indices[t + 2])];
    const on = v.map(onEdge);
    if (on.filter(Boolean).length !== 2) continue;
    // The two on-edge corners must span part of the edge, not just touch it.
    const [p, q] = v.filter((_, k) => on[k]);
    if (Math.abs(dot(sub(q, p), u)) < tol) continue;
    const n = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    if (len(n) < 1e-12) continue;
    const off = v[on.indexOf(false)];
    // Away from the edge, within the face.
    const d = sub(off, a);
    const inward = unit(sub(d, scale(u, dot(d, u))));
    found.push({ n: unit(n), inward });
  }
  // Group into faces by normal.
  const faces: { n: Vec3; inward: Vec3 }[] = [];
  for (const f of found) if (!faces.some((g) => dot(g.n, f.n) > 1 - 1e-6)) faces.push(f);
  if (faces.length !== 2) return null;
  const [f1, f2] = faces;
  if (dot(f1.n, f2.n) > 1 - 1e-6) return null;
  const phi = Math.acos(Math.max(-1, Math.min(1, dot(f1.inward, f2.inward))));
  // Convex when each face lies behind the other's plane.
  const convex = dot(f1.inward, f2.n) < 0;
  return { n1: f1.n, n2: f2.n, t1: f1.inward, t2: f2.inward, phi, convex };
}

/** Removed (convex) or added (concave) cross-section area of a fillet of radius r. */
export function filletArea(r: number, phi: number): number {
  return r * r * (1 / Math.tan(phi / 2) - (Math.PI - phi) / 2);
}

export function chamferArea(d: number, phi: number): number {
  return (d * d * Math.sin(phi)) / 2;
}

/**
 * The cutter's cross-section in 2D coordinates of the plane across the edge:
 * x along t1, y the in-plane direction towards t2. The edge is at the origin.
 * The polygon runs a little outside the material (by `out` mm, along the faces'
 * outward side) so the cut leaves no film on the faces.
 */
export function crossSection(f: EdgeFaces, size: number, kind: 'fillet' | 'chamfer', out = 0.02, arcSegments = 24): Vec2[] {
  const phi = f.phi;
  const tLen = kind === 'fillet' ? size / Math.tan(phi / 2) : size;
  const T1: Vec2 = [tLen, 0];
  const T2: Vec2 = [tLen * Math.cos(phi), tLen * Math.sin(phi)];
  // Normals of the two face lines pointing away from the wedge between t1 and t2.
  const N1: Vec2 = [0, -1];
  const n2: Vec2 = [-Math.sin(phi), Math.cos(phi)];
  const bis: Vec2 = [-Math.cos(phi / 2), -Math.sin(phi / 2)];
  const pts: Vec2[] = [];
  pts.push([T1[0] + N1[0] * out, T1[1] + N1[1] * out]);
  pts.push([bis[0] * out * 2, bis[1] * out * 2]);
  pts.push([T2[0] + n2[0] * out, T2[1] + n2[1] * out]);
  if (kind === 'chamfer') {
    pts.push(T2, T1);
  } else {
    // The arc from T2 back to T1, centred on the bisector at r / sin(phi/2).
    const c = size / Math.sin(phi / 2);
    const C: Vec2 = [c * Math.cos(phi / 2), c * Math.sin(phi / 2)];
    const a2 = Math.atan2(T2[1] - C[1], T2[0] - C[0]);
    let a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
    // The short way round, through the side facing the edge.
    while (a1 > a2) a1 -= 2 * Math.PI;
    if (a2 - a1 > Math.PI) a1 += 2 * Math.PI;
    for (let k = 0; k <= arcSegments; k++) {
      const ang = a2 + ((a1 - a2) * k) / arcSegments;
      pts.push([C[0] + size * Math.cos(ang), C[1] + size * Math.sin(ang)]);
    }
  }
  return pts;
}

/** Shoelace area of a polygon (positive counter-clockwise). */
export function polyArea(p: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}
