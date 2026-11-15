/**
 * Hidden-line views of a triangle mesh for drawings: the lines an engineering
 * drawing shows (sharp edges, and the outlines of curved faces as seen from
 * the view), each split into visible pieces (solid lines) and hidden pieces
 * (dashed lines) by a depth test against the mesh.
 *
 * A line counts as sharp where its faces meet at more than 28 degrees, so the
 * facets of a curved face are not drawn; a contour is an edge whose two faces
 * look opposite ways from the view. Visibility is decided per short piece (at
 * most 0.5 mm, and 32 per edge) at its midpoint.
 */

import type { Vec3 } from './types.js';

export interface ViewAxes {
  /** Sheet right, sheet up, and towards the viewer. */
  u: Vec3;
  v: Vec3;
  d: Vec3;
}

export const VIEW_AXES: Record<'front' | 'top' | 'right' | 'iso', ViewAxes> = {
  front: { u: [1, 0, 0], v: [0, 1, 0], d: [0, 0, 1] },
  top: { u: [1, 0, 0], v: [0, 0, -1], d: [0, 1, 0] },
  right: { u: [0, 0, -1], v: [0, 1, 0], d: [1, 0, 0] },
  iso: {
    u: [Math.SQRT1_2, 0, -Math.SQRT1_2],
    v: [-1 / Math.sqrt(6), 2 / Math.sqrt(6), -1 / Math.sqrt(6)],
    d: [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)],
  },
};

export interface ViewLines {
  /** Segments in view millimetres: x1 y1 x2 y2 ... */
  visible: number[];
  hidden: number[];
  /** The body (index into the meshes) of each visible segment. */
  visibleBody: number[];
  /** View-plane bounds of everything drawn. */
  min: [number, number];
  max: [number, number];
}

export interface LineMesh {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

/** The lines of one view of the meshes (several bodies: an assembly). */
export function viewLines(meshes: LineMesh[], axes: ViewAxes, sharpDeg = 28): ViewLines {
  const { u, v, d } = axes;
  // Weld and gather triangles in view coordinates.
  const P: Vec3[] = [];
  const bodyOf: number[] = [];
  const tris: number[] = [];
  for (const [bi, m] of meshes.entries()) {
    const key = new Map<string, number>();
    const map = new Int32Array(m.positions.length / 3);
    for (let i = 0; i < map.length; i++) {
      const x = m.positions[i * 3];
      const y = m.positions[i * 3 + 1];
      const z = m.positions[i * 3 + 2];
      const k = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
      let id = key.get(k);
      if (id === undefined) {
        id = P.length;
        P.push([x * u[0] + y * u[1] + z * u[2], x * v[0] + y * v[1] + z * v[2], x * d[0] + y * d[1] + z * d[2]]);
        bodyOf.push(bi);
        key.set(k, id);
      }
      map[i] = id;
    }
    for (let t = 0; t < m.indices.length; t++) tris.push(map[m.indices[t]]);
  }
  const nT = tris.length / 3;
  // Normals in view coordinates (the frame is orthonormal, so they are the model normals turned).
  const N: Vec3[] = [];
  for (let t = 0; t < nT; t++) {
    const a = P[tris[t * 3]];
    const b = P[tris[t * 3 + 1]];
    const c = P[tris[t * 3 + 2]];
    const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    N.push([n[0] / l, n[1] / l, n[2] / l]);
  }
  // Edges and the triangles on each.
  const edgeTris = new Map<string, number[]>();
  for (let t = 0; t < nT; t++) {
    for (let e = 0; e < 3; e++) {
      const p = tris[t * 3 + e];
      const q = tris[t * 3 + ((e + 1) % 3)];
      const k = p < q ? `${p}_${q}` : `${q}_${p}`;
      const l = edgeTris.get(k);
      if (l) l.push(t);
      else edgeTris.set(k, [t]);
    }
  }
  const cosSharp = Math.cos((sharpDeg * Math.PI) / 180);
  const lines: [number, number][] = [];
  for (const [k, ts] of edgeTris) {
    if (ts.length !== 2) continue;
    const [a, b] = ts;
    const na = N[a];
    const nb = N[b];
    const sharp = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2] < cosSharp;
    const contour = na[2] * nb[2] < 0 || (Math.abs(na[2]) < 1e-9) !== (Math.abs(nb[2]) < 1e-9);
    if (!sharp && !contour) continue;
    const [p, q] = k.split('_').map(Number);
    lines.push([p, q]);
  }
  // A grid of triangle boxes in the view plane.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of P) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const G = 96;
  const sx = (maxX - minX) / G || 1;
  const sy = (maxY - minY) / G || 1;
  const cells: number[][] = Array.from({ length: G * G }, () => []);
  const cl = (x: number, n: number): number => Math.max(0, Math.min(G - 1, Math.floor(x)));
  for (let t = 0; t < nT; t++) {
    // Triangles seen edge-on hide nothing.
    if (Math.abs(N[t][2]) < 1e-6) continue;
    const a = P[tris[t * 3]];
    const b = P[tris[t * 3 + 1]];
    const c = P[tris[t * 3 + 2]];
    const x0 = cl((Math.min(a[0], b[0], c[0]) - minX) / sx, G);
    const x1 = cl((Math.max(a[0], b[0], c[0]) - minX) / sx, G);
    const y0 = cl((Math.min(a[1], b[1], c[1]) - minY) / sy, G);
    const y1 = cl((Math.max(a[1], b[1], c[1]) - minY) / sy, G);
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) cells[i * G + j].push(t);
  }
  const span = Math.max(maxX - minX, maxY - minY);
  const eps = 1e-4 * span + 1e-4;
  const hiddenAt = (x: number, y: number, z: number): boolean => {
    const list = cells[cl((x - minX) / sx, G) * G + cl((y - minY) / sy, G)];
    for (const t of list) {
      const a = P[tris[t * 3]];
      const b = P[tris[t * 3 + 1]];
      const c = P[tris[t * 3 + 2]];
      const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(den) < 1e-14) continue;
      const w0 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / den;
      const w1 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / den;
      const w2 = 1 - w0 - w1;
      const m = -1e-9;
      if (w0 < m || w1 < m || w2 < m) continue;
      const zt = w0 * a[2] + w1 * b[2] + w2 * c[2];
      if (zt > z + eps) return true;
    }
    return false;
  };
  const out: ViewLines = { visible: [], hidden: [], visibleBody: [], min: [minX, minY], max: [maxX, maxY] };
  for (const [p, q] of lines) {
    const a = P[p];
    const b = P[q];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const n = Math.min(32, Math.max(1, Math.ceil(L / 0.5)));
    let runStart = 0;
    let runHidden: boolean | null = null;
    const emit = (i0: number, i1: number, hid: boolean): void => {
      const t0 = i0 / n;
      const t1 = i1 / n;
      (hid ? out.hidden : out.visible).push(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1);
      if (!hid) out.visibleBody.push(bodyOf[p]);
    };
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const hid = hiddenAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
      if (runHidden === null) runHidden = hid;
      else if (hid !== runHidden) {
        emit(runStart, i, runHidden);
        runStart = i;
        runHidden = hid;
      }
    }
    emit(runStart, n, runHidden ?? false);
  }
  // A hidden line under a visible one is not drawn (the visible line wins, as on any drawing).
  const vg = new Map<string, number[]>();
  const cell = 0.5;
  for (let i = 0; i < out.visible.length; i += 4) {
    const x0 = Math.floor(Math.min(out.visible[i], out.visible[i + 2]) / cell);
    const x1 = Math.floor(Math.max(out.visible[i], out.visible[i + 2]) / cell);
    const y0 = Math.floor(Math.min(out.visible[i + 1], out.visible[i + 3]) / cell);
    const y1 = Math.floor(Math.max(out.visible[i + 1], out.visible[i + 3]) / cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const k = `${x},${y}`;
      const l = vg.get(k);
      if (l) l.push(i);
      else vg.set(k, [i]);
    }
  }
  const onVisible = (x: number, y: number): boolean => {
    for (const i of vg.get(`${Math.floor(x / cell)},${Math.floor(y / cell)}`) ?? []) {
      const ax = out.visible[i], ay = out.visible[i + 1], bx = out.visible[i + 2], by = out.visible[i + 3];
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      if (Math.hypot(ax + dx * t - x, ay + dy * t - y) < eps * 10) return true;
    }
    return false;
  };
  const hidden: number[] = [];
  for (let i = 0; i < out.hidden.length; i += 4) {
    const [ax, ay, bx, by] = [out.hidden[i], out.hidden[i + 1], out.hidden[i + 2], out.hidden[i + 3]];
    if (onVisible(ax + (bx - ax) * 0.25, ay + (by - ay) * 0.25) && onVisible((ax + bx) / 2, (ay + by) / 2) && onVisible(ax + (bx - ax) * 0.75, ay + (by - ay) * 0.75)) continue;
    hidden.push(ax, ay, bx, by);
  }
  out.hidden = hidden;
  return out;
}
