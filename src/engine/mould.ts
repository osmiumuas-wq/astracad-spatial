/**
 * Mould and casting checks on the part's mesh: draft analysis (each face's
 * angle to the pull direction, against a required draft), the parting line
 * (where faces turn from facing the pull to facing away: the silhouette), and
 * the parting level for splitting a mould block into core and cavity (done by
 * the kernel: Kernel.mould).
 */

type V3 = [number, number, number];

export interface DraftResult {
  /** Per vertex RGB (0 to 1): green released upwards, blue released downwards, amber too little draft. */
  colors: Float32Array;
  /** Areas (mm2): with draft along the pull, against it, and too little (walls that need draft). */
  positive: number;
  negative: number;
  insufficient: number;
  /** Faces flat to the pull (their draft is 90 degrees: tops and bottoms). */
  flat: number;
}

/** Draft of each face: 90 - its angle to the pull (degrees); faces within `min` degrees of vertical need draft. */
export function draftAnalysis(positions: ArrayLike<number>, normals: ArrayLike<number>, indices: ArrayLike<number>, pull: V3, min = 1): DraftResult {
  const pl = Math.hypot(pull[0], pull[1], pull[2]) || 1;
  const u: V3 = [pull[0] / pl, pull[1] / pl, pull[2] / pl];
  const colors = new Float32Array(positions.length);
  const sin = Math.sin((min * Math.PI) / 180);
  for (let i = 0; i < positions.length; i += 3) {
    const d = normals[i] * u[0] + normals[i + 1] * u[1] + normals[i + 2] * u[2];
    const c = d >= sin ? [0.25, 0.85, 0.45] : d <= -sin ? [0.3, 0.55, 1] : [1, 0.68, 0.15];
    colors.set(c, i);
  }
  let positive = 0;
  let negative = 0;
  let insufficient = 0;
  let flat = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const e1: V3 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const e2: V3 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const area = Math.hypot(n[0], n[1], n[2]) / 2;
    if (area < 1e-12) continue;
    const d = (n[0] * u[0] + n[1] * u[1] + n[2] * u[2]) / (2 * area);
    if (Math.abs(d) > 1 - 1e-6) flat += area;
    if (d >= sin) positive += area;
    else if (d <= -sin) negative += area;
    else insufficient += area;
  }
  return { colors, positive, negative, insufficient, flat };
}

/**
 * The parting line: mesh edges between a face turned towards the pull and one turned away (or square to it),
 * as segments (x1 y1 z1 x2 y2 z2 ...), with its length and the mean level along the pull.
 */
export function partingLine(positions: ArrayLike<number>, indices: ArrayLike<number>, pull: V3): { segments: number[]; length: number; level: number } {
  const pl = Math.hypot(pull[0], pull[1], pull[2]) || 1;
  const u: V3 = [pull[0] / pl, pull[1] / pl, pull[2] / pl];
  const key = (i: number): string => `${Math.round(positions[i * 3] * 1e4)},${Math.round(positions[i * 3 + 1] * 1e4)},${Math.round(positions[i * 3 + 2] * 1e4)}`;
  const weld = new Map<string, number>();
  const vid = (i: number): number => {
    const k = key(i);
    let w = weld.get(k);
    if (w === undefined) {
      w = i;
      weld.set(k, w);
    }
    return w;
  };
  const facing: number[] = [];
  const edges = new Map<string, number[]>();
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    const e1 = [positions[ib * 3] - positions[ia * 3], positions[ib * 3 + 1] - positions[ia * 3 + 1], positions[ib * 3 + 2] - positions[ia * 3 + 2]];
    const e2 = [positions[ic * 3] - positions[ia * 3], positions[ic * 3 + 1] - positions[ia * 3 + 1], positions[ic * 3 + 2] - positions[ia * 3 + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    facing.push((n[0] * u[0] + n[1] * u[1] + n[2] * u[2]) / l);
    const v = [vid(ia), vid(ib), vid(ic)];
    for (let e = 0; e < 3; e++) {
      const p = v[e];
      const q = v[(e + 1) % 3];
      const k = p < q ? `${p}_${q}` : `${q}_${p}`;
      edges.set(k, [...(edges.get(k) ?? []), t / 3]);
    }
  }
  const segments: number[] = [];
  let length = 0;
  let levelSum = 0;
  const eps = 1e-6;
  for (const [k, ts] of edges) {
    if (ts.length !== 2) continue;
    const [f0, f1] = [facing[ts[0]], facing[ts[1]]];
    // One face turned against the pull, the other not: a sphere splits at its equator, a block at its base.
    if (!((f0 < -eps && f1 >= -eps) || (f1 < -eps && f0 >= -eps))) continue;
    const [p, q] = k.split('_').map(Number);
    const a = [positions[p * 3], positions[p * 3 + 1], positions[p * 3 + 2]];
    const b = [positions[q * 3], positions[q * 3 + 1], positions[q * 3 + 2]];
    segments.push(...a, ...b);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    length += L;
    levelSum += L * ((a[0] + b[0]) * u[0] + (a[1] + b[1]) * u[1] + (a[2] + b[2]) * u[2]) / 2;
  }
  return { segments, length, level: length > 0 ? levelSum / length : 0 };
}
