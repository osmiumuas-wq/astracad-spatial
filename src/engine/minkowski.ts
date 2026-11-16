/**
 * Rolling-ball opening and closing of any solid, patch by patch.
 *
 * For a convex tool B (the ball), A + B is A together with every boundary triangle t of A swept by B,
 * hull(t + B); A - B is A less those same sweeps. manifold-3d builds one hull per triangle and unions them
 * all, which is slow once A is not convex: for a round-all of a 70 x 45 x 18 block with a 24 x 12 boss, the
 * body eroded by the ball has 1770 triangles and growing it back took 29 s (over a minute in all).
 *
 * Three things make it fast without changing the solid (sweep, below, has the reasoning for the third):
 *
 * 1. Coplanar neighbouring triangles are gathered into convex planar patches. For a convex patch P, P + B
 *    is convex and is the union of t + B over its triangles, so hull(P + B) covers exactly the same points
 *    with one hull (a cylinder's side quad is one hull, not two; its cap one, not dozens).
 *
 * 2. Growing the eroded body back (the second half of an opening), only its patches that are offsets of
 *    the part's own faces are swept. The rest are ball facets the erosion left in the part's concave
 *    corners (round a boss's foot), and what they would add is already covered by the offset faces next
 *    to them: a point within r of the concave edge is within r of an offset face's border, as long as the
 *    corner's faces turn by no more than 120 degrees (a part with a corner sharper than that keeps every
 *    patch). Closing is the same with material and air swapped. Leaving a patch out can only take material
 *    away, never add it; on the boss block the volume moves by 1e-8 of itself, a thousandth of what the
 *    truth gate allows.
 *
 * 3. Each patch sweeps only the half of the ball on its own side, and patches that together bound a convex
 *    piece of solid (or of air) are swept as one hull.
 */

import type { Manifold, ManifoldToplevel } from 'manifold-3d';

type Keep = <T extends { delete(): void }>(o: T) => T;
type P3 = [number, number, number];
export interface Patch {
  /** Indices of the patch's vertices. */
  verts: number[];
  /** Outward unit normal. */
  n: P3;
  /** The triangles it is made of. */
  tris: number[];
}

/** Convex planar patches of a closed triangle mesh (vertices merged where equal). */
export function convexPatches(pos: ArrayLike<number>, tris: ArrayLike<number>, planeTol = 1e-6): Patch[] {
  const nTri = Math.floor(tris.length / 3);
  const P = (v: number): P3 => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  const nrm: P3[] = [];
  const off: number[] = [];
  const area: number[] = [];
  for (let t = 0; t < nTri; t++) {
    const a = P(tris[t * 3]);
    const b = P(tris[t * 3 + 1]);
    const c = P(tris[t * 3 + 2]);
    const u: P3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w: P3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: P3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(n[0], n[1], n[2]);
    area.push(l / 2);
    const un: P3 = l > 0 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 0];
    nrm.push(un);
    off.push(un[0] * a[0] + un[1] * a[1] + un[2] * a[2]);
  }
  // Area of the 2D convex hull of points projected on the plane with unit normal n.
  const hullArea = (ids: number[], n: P3): number => {
    const ax: P3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let x: P3 = [n[1] * ax[2] - n[2] * ax[1], n[2] * ax[0] - n[0] * ax[2], n[0] * ax[1] - n[1] * ax[0]];
    const lx = Math.hypot(x[0], x[1], x[2]);
    x = [x[0] / lx, x[1] / lx, x[2] / lx];
    const y: P3 = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
    const pts = ids.map((v) => {
      const p = P(v);
      return [p[0] * x[0] + p[1] * x[1] + p[2] * x[2], p[0] * y[0] + p[1] * y[1] + p[2] * y[2]] as [number, number];
    });
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o: number[], a: number[], b: number[]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const chain = (list: [number, number][]): [number, number][] => {
      const h: [number, number][] = [];
      for (const p of list) {
        while (h.length >= 2 && cr(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
        h.push(p);
      }
      return h.slice(0, -1);
    };
    const h = chain(pts).concat(chain([...pts].reverse()));
    let s = 0;
    for (let i = 0; i < h.length; i++) {
      const a = h[i];
      const b = h[(i + 1) % h.length];
      s += a[0] * b[1] - a[1] * b[0];
    }
    return Math.abs(s) / 2;
  };
  // Triangles sharing an edge.
  const edgeTris = new Map<string, number[]>();
  for (let t = 0; t < nTri; t++) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t * 3 + e];
      const b = tris[t * 3 + ((e + 1) % 3)];
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      const l = edgeTris.get(k);
      if (l) l.push(t);
      else edgeTris.set(k, [t]);
    }
  }
  const nbrs: number[][] = Array.from({ length: nTri }, () => []);
  for (const l of edgeTris.values()) {
    if (l.length !== 2) continue;
    nbrs[l[0]].push(l[1]);
    nbrs[l[1]].push(l[0]);
  }
  // Each patch grows breadth first from a seed triangle, taking a neighbour when it lies in the seed's plane
  // and the two together stay convex (the hull of their vertices has no more area than they have).
  const out: Patch[] = [];
  const taken = new Uint8Array(nTri);
  for (let s = 0; s < nTri; s++) {
    if (taken[s]) continue;
    taken[s] = 1;
    const n = nrm[s];
    const verts = new Set<number>([tris[s * 3], tris[s * 3 + 1], tris[s * 3 + 2]]);
    let pArea = area[s];
    const queue = [s];
    const members = [s];
    for (let qi = 0; qi < queue.length && area[s] > 0; qi++) {
      for (const u of nbrs[queue[qi]]) {
        if (taken[u] || area[u] === 0) continue;
        if (n[0] * nrm[u][0] + n[1] * nrm[u][1] + n[2] * nrm[u][2] < 1 - 1e-9) continue;
        let flat = true;
        for (let e = 0; e < 3 && flat; e++) {
          const p = P(tris[u * 3 + e]);
          if (Math.abs(n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - off[s]) > planeTol) flat = false;
        }
        if (!flat) continue;
        const joined = Array.from(new Set([...verts, tris[u * 3], tris[u * 3 + 1], tris[u * 3 + 2]]));
        const sum = pArea + area[u];
        if (hullArea(joined, n) > sum * (1 + 1e-9) + 1e-12) continue;
        for (const v of joined) verts.add(v);
        pArea = sum;
        taken[u] = 1;
        queue.push(u);
        members.push(u);
      }
    }
    out.push({ verts: Array.from(verts), n, tris: members });
  }
  return out;
}

/** A closed solid's vertex positions (merged where equal) and triangles. */
function meshOf(s: Manifold): { pos: Float64Array; tris: Uint32Array } {
  const mesh = s.getMesh();
  const np = mesh.numProp;
  const nv = mesh.vertProperties.length / np;
  const id = new Map<string, number>();
  const remap = new Uint32Array(nv);
  const pos: number[] = [];
  for (let v = 0; v < nv; v++) {
    const x = mesh.vertProperties[v * np];
    const y = mesh.vertProperties[v * np + 1];
    const z = mesh.vertProperties[v * np + 2];
    const k = `${x},${y},${z}`;
    let i = id.get(k);
    if (i === undefined) {
      i = pos.length / 3;
      id.set(k, i);
      pos.push(x, y, z);
    }
    remap[v] = i;
  }
  const tris = new Uint32Array(mesh.triVerts.length);
  for (let i = 0; i < tris.length; i++) tris[i] = remap[mesh.triVerts[i]];
  return { pos: Float64Array.from(pos), tris };
}

const isConvex = (s: Manifold, keep: Keep): boolean => Math.abs(keep(s.hull()).volume() - s.volume()) <= 1e-9 * Math.abs(s.volume());

/**
 * `body` grown (sum) or shrunk (difference, `inset`) by the convex `tool`: the same solid as manifold-3d's
 * minkowskiSum / minkowskiDifference, from far fewer and smaller hulls. With `keepPatch`, only the patches
 * it accepts are swept.
 *
 * Every point a sum adds lies on the outer side of a face it is swept from, within the tool's reach: take
 * the nearest point of the body (in the tool's own measure) and a face there that the point does not lie
 * behind; one always exists, since the scaled tool round the point misses the body. So each patch sweeps
 * only the half of the tool on its outer side, and a difference only the half on its inner side.
 *
 * Patches joined by convex edges (for a sum: a whole boss, side, cap and chamfer) or by concave edges that
 * turn under 30 degrees (for a difference: a hole's wall) are swept together, as the tool swept over their
 * hull K, when K lies inside the body (sum) or wholly outside it (difference). K holds every one of those
 * patches, so that sweep covers theirs; and any point of it is within the tool's reach of K, so of the
 * body (sum) or of the air (difference), which the full sum or difference adds or removes anyway. Checked
 * with one boolean per group; a group whose hull does not fit is split in two and tried again.
 */
export function sweep(m: ManifoldToplevel, body: Manifold, tool: Manifold, inset: boolean, keep: Keep, keepPatch?: (p: Patch) => boolean): Manifold {
  const { Manifold: M } = m;
  if (body.isEmpty()) return body;
  // A convex body grown by a convex tool: manifold-3d's own single hull is already fast.
  if (!inset && isConvex(body, keep)) return keep(body.minkowskiSum(tool));
  const { pos, tris } = meshOf(body);
  const tm = tool.getMesh();
  // The difference sweeps the tool reflected through its origin, as manifold-3d does.
  const sign = inset ? -1 : 1;
  const tp: P3[] = [];
  for (let i = 0; i < tm.vertProperties.length; i += tm.numProp) {
    tp.push([sign * tm.vertProperties[i], sign * tm.vertProperties[i + 1], sign * tm.vertProperties[i + 2]]);
  }
  const toolEdges: [number, number][] = [];
  {
    const seen = new Set<string>();
    for (let i = 0; i < tm.triVerts.length; i += 3) {
      for (let e = 0; e < 3; e++) {
        const a = tm.triVerts[i + e];
        const b = tm.triVerts[i + ((e + 1) % 3)];
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        if (!seen.has(k)) {
          seen.add(k);
          toolEdges.push([a, b]);
        }
      }
    }
  }
  // The half of the tool on the sweep's side of a patch (outside it for a sum, inside for a difference),
  // taken one ring of tool vertices past the patch's plane: every crossing edge is kept whole, and no hull
  // face lies exactly on the body's face (that would leave a zero-thickness film behind).
  const toolNbrs: number[][] = tp.map(() => []);
  for (const [a, b] of toolEdges) {
    toolNbrs[a].push(b);
    toolNbrs[b].push(a);
  }
  const half = (n: P3): P3[] => {
    const pick = new Uint8Array(tp.length);
    tp.forEach((t, i) => {
      if (sign * (t[0] * n[0] + t[1] * n[1] + t[2] * n[2]) >= 0) {
        pick[i] = 1;
        for (const k of toolNbrs[i]) pick[k] = 1;
      }
    });
    return tp.filter((_, i) => pick[i]);
  };
  const sumPoints = (verts: ArrayLike<number>, by: P3[]): P3[] => {
    const pts: P3[] = [];
    for (let i = 0; i < verts.length; i += 3) for (const b of by) pts.push([verts[i] + b[0], verts[i + 1] + b[1], verts[i + 2] + b[2]]);
    return pts;
  };
  const coords = (ids: number[]): number[] => ids.flatMap((v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
  const patches = convexPatches(pos, tris).filter((p) => !keepPatch || keepPatch(p));
  // Smooth faces: patches joined across edges that turn by under 30 degrees the right way.
  const nTri = tris.length / 3;
  const triPatch = new Int32Array(nTri).fill(-1);
  patches.forEach((p, i) => {
    for (const t of p.tris) triPatch[t] = i;
  });
  const parent = patches.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const cosSmooth = Math.cos((30 * Math.PI) / 180);
  const firstTri = new Map<string, number>();
  for (let t = 0; t < nTri; t++) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t * 3 + e];
      const b = tris[t * 3 + ((e + 1) % 3)];
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      const o = firstTri.get(k);
      if (o === undefined) {
        firstTri.set(k, t);
        continue;
      }
      const i = triPatch[o];
      const j = triPatch[t];
      if (i < 0 || j < 0 || find(i) === find(j)) continue;
      const ni = patches[i].n;
      const nj = patches[j].n;
      if (inset && ni[0] * nj[0] + ni[1] * nj[1] + ni[2] * nj[2] < cosSmooth) continue;
      // Convex when this triangle's far corner lies behind the other patch's plane.
      const v = tris[t * 3 + ((e + 2) % 3)];
      const h = ni[0] * (pos[v * 3] - pos[a * 3]) + ni[1] * (pos[v * 3 + 1] - pos[a * 3 + 1]) + ni[2] * (pos[v * 3 + 2] - pos[a * 3 + 2]);
      if (inset ? h > 1e-9 : h < -1e-9) parent[find(j)] = find(i);
    }
  }
  const faces = new Map<number, number[]>();
  patches.forEach((_, i) => {
    const r = find(i);
    const l = faces.get(r);
    if (l) l.push(i);
    else faces.set(r, [i]);
  });
  const hulls: Manifold[] = [];
  const sweepFace = (ids: number[]): void => {
    if (ids.length === 1) {
      const p = patches[ids[0]];
      hulls.push(keep(M.hull(sumPoints(coords(p.verts), half(p.n)))));
      return;
    }
    const verts = Array.from(new Set(ids.flatMap((i) => patches[i].verts)));
    const K = keep(M.hull(sumPoints(coords(verts), [[0, 0, 0]])));
    const kv = K.volume();
    // A near-flat hull proves nothing: its patches are swept one by one.
    const outside = kv > 1e-6 ? keep(inset ? K.intersect(body) : K.subtract(body)).volume() : Infinity;
    if (outside <= 1e-7 * kv) {
      hulls.push(keep(M.hull(sumPoints(coords(verts), tp))));
      return;
    }
    const mid = ids.length >> 1;
    sweepFace(ids.slice(0, mid));
    sweepFace(ids.slice(mid));
  };
  for (const ids of faces.values()) sweepFace(ids);
  if (hulls.length === 0) return body;
  const swept = keep(M.union(hulls));
  return keep(inset ? body.subtract(swept) : body.add(swept));
}

/**
 * The part's face normals, and whether any of its concave or convex edges turns by more than 120 degrees
 * (where the offset faces next to a corner no longer cover what the ball facets in it would add).
 */
function faceSet(body: Manifold): { normals: P3[]; sharpConcave: boolean; sharpConvex: boolean } {
  const { pos, tris } = meshOf(body);
  const normals: P3[] = [];
  for (const p of convexPatches(pos, tris)) {
    if (!normals.some((n) => n[0] * p.n[0] + n[1] * p.n[1] + n[2] * p.n[2] > 1 - 1e-9)) normals.push(p.n);
  }
  const nTri = tris.length / 3;
  const nrm = (t: number): P3 => {
    const a = tris[t * 3] * 3;
    const b = tris[t * 3 + 1] * 3;
    const c = tris[t * 3 + 2] * 3;
    const u = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const w = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const n: P3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  };
  const first = new Map<string, number>();
  const cosLimit = Math.cos((120 * Math.PI) / 180);
  let sharpConcave = false;
  let sharpConvex = false;
  for (let t = 0; t < nTri; t++) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t * 3 + e];
      const b = tris[t * 3 + ((e + 1) % 3)];
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      const o = first.get(k);
      if (o === undefined) {
        first.set(k, t);
        continue;
      }
      const n1 = nrm(o);
      const n2 = nrm(t);
      if (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] >= cosLimit) continue;
      // Concave when this triangle's far corner stands above the other triangle's plane.
      const v = tris[t * 3 + ((e + 2) % 3)];
      const h = n1[0] * (pos[v * 3] - pos[a * 3]) + n1[1] * (pos[v * 3 + 1] - pos[a * 3 + 1]) + n1[2] * (pos[v * 3 + 2] - pos[a * 3 + 2]);
      if (h > 0) sharpConcave = true;
      else sharpConvex = true;
    }
  }
  return { normals, sharpConcave, sharpConvex };
}

const parallelTo = (normals: P3[]) => (p: Patch): boolean => normals.some((n) => n[0] * p.n[0] + n[1] * p.n[1] + n[2] * p.n[2] > 1 - 1e-6);

/** Morphological opening by the ball: every convex edge rounded, as far as the ball rolled inside reaches. */
export function opening(m: ManifoldToplevel, body: Manifold, ball: Manifold, keep: Keep): Manifold {
  const f = faceSet(body);
  const eroded = sweep(m, body, ball, true, keep);
  return sweep(m, eroded, ball, false, keep, f.sharpConcave ? undefined : parallelTo(f.normals));
}

/** Morphological closing by the ball: every concave edge filled, as far as the ball rolled outside reaches. */
export function closing(m: ManifoldToplevel, body: Manifold, ball: Manifold, keep: Keep): Manifold {
  const f = faceSet(body);
  const grown = sweep(m, body, ball, false, keep);
  return sweep(m, grown, ball, true, keep, f.sharpConvex ? undefined : parallelTo(f.normals));
}
