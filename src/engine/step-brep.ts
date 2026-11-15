/**
 * Rebuilds a closed triangle mesh as a boundary representation for STEP:
 *
 * - coplanar, connected triangles become one plane face (holes as inner loops);
 * - strips of facets that all lie on one circular cylinder (holes, bosses,
 *   shafts, fillets of straight edges) become one cylinder face of the fitted
 *   radius, so desktop CAD sees a real hole or shaft it can measure and mate;
 * - each boundary between two faces, from corner to corner, is one edge: a line
 *   when straight, a circle when its points lie on one circle, otherwise a chain
 *   of short lines.
 *
 * A cylinder is only kept when every edge around it is a line along its axis or
 * a circle about its axis; otherwise its facets stay flat faces. Cones, spheres,
 * tori and freeform blends stay faceted. The result is always a closed shell.
 */

import { circleSegments, equalAreaScale } from './sketch.js';
import type { Vec3 } from './types.js';

export type Curve =
  | { kind: 'line' }
  | { kind: 'circle'; c: Vec3; n: Vec3; r: number }
  | { kind: 'poly' };

export interface Chain {
  /** Mesh vertex ids from start to end; a closed chain ends where it starts. */
  pts: number[];
  closed: boolean;
  curve: Curve;
  /** A closed circle's one vertex, moved onto the true circle (the mesh's sits on the facet polygon). */
  anchor?: Vec3;
}

export interface Cylinder {
  /** A point on the axis, the unit axis and the radius (mm). */
  o: Vec3;
  a: Vec3;
  r: number;
  /** True when the material is inside (a shaft, a boss); false for a hole. */
  convex: boolean;
}

export interface BrepFace {
  kind: 'plane' | 'cylinder';
  normal: Vec3;
  cyl?: Cylinder;
  /** Each loop: the chains it runs along, and whether it runs them start to end. */
  loops: { chain: number; same: boolean }[][];
}

export interface Brep {
  P: (i: number) => Vec3;
  faces: BrepFace[];
  chains: Chain[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A unit vector square to d. */
export function squareTo(d: Vec3): Vec3 {
  return unit(cross(Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], d));
}

/** Distance tolerance (mm): the mesh is float32, a few micrometres on a 300 mm part. */
const TOL = 5e-4;
/** Neighbouring facets of one cylinder turn by at most this (circles have 24 or more segments). */
const MAX_STEP = (16 * Math.PI) / 180;

interface Graph {
  nTri: number;
  tri: (t: number) => [number, number, number];
  P: (i: number) => Vec3;
  normal: Vec3[];
  offset: number[];
  edgeTris: Map<string, number[]>;
}

const ek = (p: number, q: number): string => (p < q ? `${p}_${q}` : `${q}_${p}`);

function graph(positions: ArrayLike<number>, indices: ArrayLike<number>, tol = 1e-5): Graph {
  const key = (i: number): string => `${Math.round(positions[i * 3] / tol)},${Math.round(positions[i * 3 + 1] / tol)},${Math.round(positions[i * 3 + 2] / tol)}`;
  const weld = new Map<string, number>();
  const vid = new Int32Array(positions.length / 3);
  for (let i = 0; i < vid.length; i++) {
    const k = key(i);
    let w = weld.get(k);
    if (w === undefined) {
      w = i;
      weld.set(k, w);
    }
    vid[i] = w;
  }
  const nTri = indices.length / 3;
  const tri = (t: number): [number, number, number] => [vid[indices[t * 3]], vid[indices[t * 3 + 1]], vid[indices[t * 3 + 2]]];
  const P = (i: number): Vec3 => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  const normal: Vec3[] = [];
  const offset: number[] = [];
  const edgeTris = new Map<string, number[]>();
  for (let t = 0; t < nTri; t++) {
    const v = tri(t);
    const [a, b, c] = v.map(P);
    const n = unit(cross(sub(b, a), sub(c, a)));
    normal.push(n);
    offset.push(dot(n, a));
    for (let e = 0; e < 3; e++) {
      const k = ek(v[e], v[(e + 1) % 3]);
      const list = edgeTris.get(k);
      if (list) list.push(t);
      else edgeTris.set(k, [t]);
    }
  }
  return { nTri, tri, P, normal, offset, edgeTris };
}

/** Flat groups: coplanar, edge-connected triangles. */
function planarGroups(g: Graph): { group: Int32Array; normal: Vec3[]; members: number[][] } {
  const group = new Int32Array(g.nTri).fill(-1);
  const normal: Vec3[] = [];
  const members: number[][] = [];
  // Seeds largest first: a big triangle's normal is accurate; a sliver's is not (the mesh is float32).
  const area = new Float64Array(g.nTri);
  for (let t = 0; t < g.nTri; t++) {
    const [a, b, c] = g.tri(t).map(g.P);
    area[t] = len(cross(sub(b, a), sub(c, a)));
  }
  const order = Array.from({ length: g.nTri }, (_, t) => t).sort((x, y) => area[y] - area[x]);
  const onPlane = (s: number, o: number): boolean =>
    dot(g.normal[s], g.normal[o]) > 0.99 && g.tri(o).every((v) => Math.abs(dot(g.P(v), g.normal[s]) - g.offset[s]) < 2e-4);
  for (const s of order) {
    if (group[s] >= 0) continue;
    const id = members.length;
    const list: number[] = [];
    const stack = [s];
    group[s] = id;
    while (stack.length) {
      const t = stack.pop()!;
      list.push(t);
      const v = g.tri(t);
      for (let e = 0; e < 3; e++) {
        for (const o of g.edgeTris.get(ek(v[e], v[(e + 1) % 3])) ?? []) {
          if (group[o] < 0 && onPlane(s, o)) {
            group[o] = id;
            stack.push(o);
          }
        }
      }
    }
    members.push(list);
    normal.push(g.normal[s]);
  }
  return { group, normal, members };
}

/** Circle through three 2D points, or null when they are in a line. */
function circle3(a: [number, number], b: [number, number], c: [number, number]): { x: number; y: number; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] * a[0] + a[1] * a[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const c2 = c[0] * c[0] + c[1] * c[1];
  const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { x, y, r: Math.hypot(a[0] - x, a[1] - y) };
}

/** Least-squares circle (Kasa) through 2D points. */
function fitCircle2(pts: [number, number][]): { x: number; y: number; r: number } | null {
  if (pts.length < 3) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p[0];
    my += p[1];
  }
  mx /= pts.length;
  my /= pts.length;
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p[0] - mx;
    const v = p[1] - my;
    suu += u * u;
    suv += u * v;
    svv += v * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-18) return null;
  const bu = 0.5 * (suuu + suvv);
  const bv = 0.5 * (svvv + svuu);
  const uc = (bu * svv - bv * suv) / det;
  const vc = (suu * bv - suv * bu) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length);
  return { x: uc + mx, y: vc + my, r };
}

/** Facet strips that lie on one cylinder, grouped; each with its fitted axis and radius. */
function findCylinders(g: Graph, pg: ReturnType<typeof planarGroups>): (Cylinder & { groups: number[] })[] {
  const count = pg.members.length;
  const verts: number[][] = pg.members.map((m) => {
    const s = new Set<number>();
    for (const t of m) for (const v of g.tri(t)) s.add(v);
    return [...s];
  });
  const adj: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  for (const tris of g.edgeTris.values()) {
    if (tris.length !== 2) continue;
    const a = pg.group[tris[0]];
    const b = pg.group[tris[1]];
    if (a !== b) {
      adj[a].add(b);
      adj[b].add(a);
    }
  }
  const used = new Uint8Array(count);
  const out: (Cylinder & { groups: number[] })[] = [];
  const cosStep = Math.cos(MAX_STEP);
  for (let A = 0; A < count; A++) {
    if (used[A] || verts[A].length > 64) continue;
    for (const B of adj[A]) {
      if (used[A]) break;
      if (used[B]) continue;
      const nA = pg.normal[A];
      const nB = pg.normal[B];
      const c = dot(nA, nB);
      if (c < cosStep || c > Math.cos((0.5 * Math.PI) / 180)) continue;
      const axis = unit(cross(nA, nB));
      const u = squareTo(axis);
      const w = cross(axis, u);
      const to2 = (i: number): [number, number] => {
        const p = g.P(i);
        return [dot(p, u), dot(p, w)];
      };
      const distinct = (ids: number[]): [number, number][] => {
        const out2: [number, number][] = [];
        for (const i of ids) {
          const q = to2(i);
          if (!out2.some((o) => Math.hypot(o[0] - q[0], o[1] - q[1]) < 1e-3)) out2.push(q);
        }
        return out2;
      };
      const dA = distinct(verts[A]);
      const dB = distinct(verts[B]);
      if (dA.length !== 2 || dB.length !== 2) continue;
      const all = distinct([...verts[A], ...verts[B]]);
      if (all.length !== 3) continue;
      const circ = circle3(all[0], all[1], all[2]);
      if (!circ || circ.r > 1e4) continue;
      const centre: Vec3 = [u[0] * circ.x + w[0] * circ.y, u[1] * circ.x + w[1] * circ.y, u[2] * circ.x + w[2] * circ.y];
      const radial = (i: number): number => {
        const d = sub(g.P(i), centre);
        const along = dot(d, axis);
        return len([d[0] - axis[0] * along, d[1] - axis[1] * along, d[2] - axis[2] * along]);
      };
      // The kernel's circles have circleSegments(r) facets, area-compensated: facet vertices sit a little
      // outside the true radius (arcs' inner points up to about three times as far as a full circle's).
      const S = (2 * Math.PI) / circleSegments(circ.r);
      const band = TOL + 3.5 * circ.r * (equalAreaScale(S) - 1);
      // A facet of the cylinder spans at most one facet's turn about the axis (a flat face between fillets does not).
      const span = (G: number): number => {
        const d = distinct(verts[G]);
        if (d.length !== 2) return Infinity;
        const a0 = Math.atan2(d[0][1] - circ.y, d[0][0] - circ.x);
        const a1 = Math.atan2(d[1][1] - circ.y, d[1][0] - circ.x);
        return Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)));
      };
      const onIt = (G: number): boolean => Math.abs(dot(pg.normal[G], axis)) < 1e-4 && span(G) >= 0.45 * S - 1e-4 && span(G) <= MAX_STEP + 1e-3 && verts[G].every((i) => Math.abs(radial(i) - circ.r) < band);
      if (!onIt(A) || !onIt(B)) continue;
      const region = [A, B];
      const inRegion = new Set(region);
      for (let k = 0; k < region.length; k++) {
        for (const C of adj[region[k]]) {
          if (inRegion.has(C) || used[C]) continue;
          if (dot(pg.normal[C], pg.normal[region[k]]) < cosStep) continue;
          if (!onIt(C)) continue;
          inRegion.add(C);
          region.push(C);
        }
      }
      if (region.length < 3) continue;
      // Refit with every vertex of the region.
      const pts2 = distinct(region.flatMap((G) => verts[G]));
      const fit = fitCircle2(pts2) ?? circ;
      const o: Vec3 = [u[0] * fit.x + w[0] * fit.y, u[1] * fit.x + w[1] * fit.y, u[2] * fit.x + w[2] * fit.y];
      const c0 = verts[A].reduce<Vec3>((s, i) => {
        const p = g.P(i);
        return [s[0] + p[0], s[1] + p[1], s[2] + p[2]];
      }, [0, 0, 0]).map((x) => x / verts[A].length) as Vec3;
      const convex = dot(nA, sub(c0, o)) - dot(nA, axis) * dot(sub(c0, o), axis) > 0;
      for (const G of region) used[G] = 1;
      out.push({ o, a: axis, r: fit.r, convex, groups: region });
    }
  }
  return out;
}

/** Boundary loops of a face (its triangles), each a cyclic list of vertex ids. */
function traceLoops(g: Graph, members: number[]): number[][] {
  const inside = new Set<string>();
  for (const t of members) {
    const v = g.tri(t);
    for (let e = 0; e < 3; e++) inside.add(`${v[e]}>${v[(e + 1) % 3]}`);
  }
  const directed = new Map<number, number[]>();
  for (const t of members) {
    const v = g.tri(t);
    for (let e = 0; e < 3; e++) {
      const p = v[e];
      const q = v[(e + 1) % 3];
      if (inside.has(`${q}>${p}`)) continue;
      const list = directed.get(p);
      if (list) list.push(q);
      else directed.set(p, [q]);
    }
  }
  const loops: number[][] = [];
  for (const [start] of directed) {
    while ((directed.get(start)?.length ?? 0) > 0) {
      const loop = [start];
      let cur = directed.get(start)!.pop()!;
      let guard = 0;
      while (cur !== start && guard++ < 1e7) {
        loop.push(cur);
        const nx = directed.get(cur);
        if (!nx || !nx.length) break;
        cur = nx.pop()!;
      }
      if (loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

/**
 * The curve through a chain of points: a line, a circle, or neither.
 *
 * Circles come from the kernel area-compensated (src/engine/sketch.ts): a full
 * circle's vertices sit at r sqrt(step / sin step); an arc's ends sit on r and
 * its inner points further out. The centre is fitted to the evenly spaced
 * points and the true radius recovered from that pattern, so a 10 mm hole is
 * written as a 10 mm circle and the solid keeps the true volume.
 */
export function fitChain(pts: Vec3[], closed: boolean): Curve & { anchor?: Vec3 } {
  const uniq = closed ? pts.slice(0, -1) : pts;
  if (!closed && uniq.length >= 2) {
    const a = uniq[0];
    const d = sub(uniq[uniq.length - 1], a);
    const l = len(d);
    if (l > 1e-9) {
      const dir: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
      const straight = uniq.every((p) => {
        const q = sub(p, a);
        const along = dot(q, dir);
        return len([q[0] - dir[0] * along, q[1] - dir[1] * along, q[2] - dir[2] * along]) < TOL;
      });
      if (straight) return { kind: 'line' };
    }
  }
  const inner = closed ? uniq : uniq.slice(1, -1);
  if (inner.length < 3 || (closed && uniq.length < 8)) return { kind: 'poly' };
  // Newell normal of the points (closed by their chord).
  let n: Vec3 = [0, 0, 0];
  for (let i = 0; i < uniq.length; i++) {
    const p = uniq[i];
    const q = uniq[(i + 1) % uniq.length];
    n = [n[0] + (p[1] - q[1]) * (p[2] + q[2]), n[1] + (p[2] - q[2]) * (p[0] + q[0]), n[2] + (p[0] - q[0]) * (p[1] + q[1])];
  }
  if (len(n) < 1e-12) return { kind: 'poly' };
  n = unit(n);
  const p0 = uniq[0];
  if (uniq.some((p) => Math.abs(dot(sub(p, p0), n)) > TOL)) return { kind: 'poly' };
  const u = squareTo(n);
  const w = cross(n, u);
  const fit = fitCircle2(inner.map((p) => [dot(p, u), dot(p, w)]));
  if (!fit || fit.r > 1e4) return { kind: 'poly' };
  const h = dot(p0, n);
  const c: Vec3 = [u[0] * fit.x + w[0] * fit.y + n[0] * h, u[1] * fit.x + w[1] * fit.y + n[1] * h, u[2] * fit.x + w[2] * fit.y + n[2] * h];
  const rp = fit.r;
  if (inner.some((p) => Math.abs(len(sub(p, c)) - rp) > TOL)) return { kind: 'poly' };
  // Each step turns the same way, evenly, by no more than a facet does.
  const steps: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = sub(pts[i], c);
    const b = sub(pts[i + 1], c);
    steps.push(Math.atan2(dot(cross(a, b), n), dot(a, b)));
  }
  const turn = steps.reduce((x, y) => x + y, 0);
  if (Math.abs(turn) < 1e-9 || steps.some((s) => Math.abs(s) > MAX_STEP + 1e-6 || Math.sign(s) !== Math.sign(turn))) return { kind: 'poly' };
  const nn: Vec3 = turn > 0 ? n : [-n[0], -n[1], -n[2]];
  if (closed) {
    const step = (2 * Math.PI) / uniq.length;
    if (steps.some((s) => Math.abs(Math.abs(s) - step) > 1e-3)) return { kind: 'poly' };
    const r = rp / Math.sqrt(step / Math.sin(step));
    const d0 = sub(pts[0], c);
    const k = r / (len(d0) || 1);
    return { kind: 'circle', c, n: nn, r, anchor: [c[0] + d0[0] * k, c[1] + d0[1] * k, c[2] + d0[2] * k] };
  }
  const re0 = len(sub(pts[0], c));
  const re1 = len(sub(pts[pts.length - 1], c));
  if (Math.abs(re0 - re1) > TOL) return { kind: 'poly' };
  // Ends on the circle and the inner points further out: a compensated arc of radius re; all alike: radius rp.
  return { kind: 'circle', c, n: nn, r: Math.abs(re0 - rp) < TOL ? rp : (re0 + re1) / 2 };
}

/** The mesh as faces (planes and fitted cylinders) bounded by shared line, circle and polyline edges. */
export function buildBrep(positions: ArrayLike<number>, indices: ArrayLike<number>): Brep {
  const g = graph(positions, indices);
  const pg = planarGroups(g);
  const cylinders = findCylinders(g, pg);
  const dropped = new Set<number>();
  for (let pass = 0; ; pass++) {
    // Faces: kept cylinders, then every flat group not in one.
    const faceOf = new Int32Array(g.nTri);
    const faces: { kind: 'plane' | 'cylinder'; normal: Vec3; cyl?: Cylinder; cylIndex?: number; members: number[] }[] = [];
    const groupFace = new Int32Array(pg.members.length).fill(-1);
    cylinders.forEach((c, k) => {
      if (dropped.has(k)) return;
      const f = faces.length;
      faces.push({ kind: 'cylinder', normal: c.a, cyl: { o: c.o, a: c.a, r: c.r, convex: c.convex }, cylIndex: k, members: c.groups.flatMap((G) => pg.members[G]) });
      for (const G of c.groups) groupFace[G] = f;
    });
    pg.members.forEach((m, G) => {
      if (groupFace[G] >= 0) return;
      groupFace[G] = faces.length;
      faces.push({ kind: 'plane', normal: pg.normal[G], members: m });
    });
    for (let t = 0; t < g.nTri; t++) faceOf[t] = groupFace[pg.group[t]];
    // Corners: vertices where three or more faces meet.
    const touch = new Map<number, number[]>();
    for (let t = 0; t < g.nTri; t++) {
      for (const v of g.tri(t)) {
        const list = touch.get(v);
        if (!list) touch.set(v, [faceOf[t]]);
        else if (!list.includes(faceOf[t])) list.push(faceOf[t]);
      }
    }
    const corner = (v: number): boolean => (touch.get(v)?.length ?? 0) >= 3;
    const chains: Chain[] = [];
    const chainOf = new Map<string, { chain: number; dir: string }>();
    const out: BrepFace[] = faces.map((f) => {
      const loops = traceLoops(g, f.members);
      if (f.kind === 'plane') {
        const area = (loop: number[]): number => {
          let s: Vec3 = [0, 0, 0];
          for (let i = 0; i < loop.length; i++) s = [s[0], s[1], s[2]].map((x, k) => x + cross(g.P(loop[i]), g.P(loop[(i + 1) % loop.length]))[k]) as Vec3;
          return Math.abs(dot(s, f.normal));
        };
        loops.sort((x, y) => area(y) - area(x));
      }
      return {
        kind: f.kind,
        normal: f.normal,
        cyl: f.cyl,
        loops: loops.map((loop) => {
          const refs: { chain: number; same: boolean }[] = [];
          const at = loop.findIndex(corner);
          const pieces: { pts: number[]; closed: boolean }[] = [];
          if (at < 0) pieces.push({ pts: [...loop, loop[0]], closed: true });
          else {
            const L = [...loop.slice(at), ...loop.slice(0, at)];
            let cur = [L[0]];
            for (let i = 1; i <= L.length; i++) {
              const v = L[i % L.length];
              cur.push(v);
              if (i === L.length || corner(v)) {
                pieces.push({ pts: cur, closed: cur[0] === cur[cur.length - 1] && cur.length > 2 });
                cur = [v];
              }
            }
          }
          for (const piece of pieces) {
            const first = `${piece.pts[0]}>${piece.pts[1]}`;
            const known = chainOf.get(ek(piece.pts[0], piece.pts[1]));
            if (known) {
              refs.push({ chain: known.chain, same: known.dir === first });
              continue;
            }
            const id = chains.length;
            const { anchor, ...curve } = fitChain(piece.pts.map(g.P), piece.closed);
            chains.push({ pts: piece.pts, closed: piece.closed, curve: curve as Curve, anchor });
            for (let i = 0; i + 1 < piece.pts.length; i++) chainOf.set(ek(piece.pts[i], piece.pts[i + 1]), { chain: id, dir: `${piece.pts[i]}>${piece.pts[i + 1]}` });
            refs.push({ chain: id, same: true });
          }
          return refs;
        }),
      };
    });
    // A cylinder is kept only when every edge round it runs along its axis or about it.
    let bad = false;
    faces.forEach((f, k) => {
      if (f.kind !== 'cylinder' || !f.cyl) return;
      const c = f.cyl;
      // The true axis point and radius come from a circle edge (the facets sit on the compensated polygon).
      const ref = out[k].loops.flat().map(({ chain }) => chains[chain].curve).find((cv) => cv.kind === 'circle');
      if (ref && ref.kind === 'circle' && Math.abs(dot(ref.n, c.a)) > 1 - 1e-5) {
        c.o = ref.c;
        c.a = dot(ref.n, c.a) > 0 ? ref.n : [-ref.n[0], -ref.n[1], -ref.n[2]];
        c.r = ref.r;
        out[k].normal = c.a;
      }
      const radial = (p: Vec3): number => {
        const d = sub(p, c.o);
        const along = dot(d, c.a);
        return len([d[0] - c.a[0] * along, d[1] - c.a[1] * along, d[2] - c.a[2] * along]);
      };
      const ok = !!ref && out[k].loops.every((loop) =>
        loop.every(({ chain }) => {
          const ch = chains[chain];
          if (ch.curve.kind === 'line') {
            const pa = g.P(ch.pts[0]);
            const pb = g.P(ch.pts[ch.pts.length - 1]);
            const d = unit(sub(pb, pa));
            return Math.abs(dot(d, c.a)) > 1 - 1e-6 && Math.abs(radial(pa) - c.r) < TOL && Math.abs(radial(pb) - c.r) < TOL;
          }
          if (ch.curve.kind === 'circle') {
            const cc = ch.curve;
            const off = sub(cc.c, c.o);
            const along = dot(off, c.a);
            const radialOff = len([off[0] - c.a[0] * along, off[1] - c.a[1] * along, off[2] - c.a[2] * along]);
            return Math.abs(dot(cc.n, c.a)) > 1 - 1e-6 && radialOff < TOL && Math.abs(cc.r - c.r) < TOL;
          }
          return false;
        }),
      );
      if (!ok) {
        dropped.add(f.cylIndex!);
        bad = true;
      }
    });
    if (!bad || pass > 20) return { P: g.P, faces: out, chains };
  }
}
