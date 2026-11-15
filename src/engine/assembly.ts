/**
 * Assemblies: part instances placed by mates, as in desktop CAD.
 *
 * Each instance is a part (job, parameters, material) with a pose: position
 * (mm) and orientation (unit quaternion) in assembly space, +Y up. The first
 * instance is grounded. Mates refer to geometry picked on the parts:
 *
 *   plane  a point and outward normal (a flat face)
 *   axis   a point and direction (a hole, a pin, a boss: fitted from the mesh)
 *
 * and are solved constructively, one instance at a time against instances
 * already placed (the way most assemblies are built: each part is mated to
 * what is there). For the instance being placed:
 *
 *   concentric  its axis is put on the other axis (direction and line)
 *   coincident  its face is put against the other face (normals opposed, flush)
 *   distance    as coincident, with a gap
 *   angle       its face normal is turned to an angle from the other
 *   parallel    normals made parallel only
 *
 * Concentric plus coincident leaves one freedom, the turn about the axis: a
 * hinge (revolute). Coincident twice on perpendicular faces leaves a slide: a
 * slider. Those freedoms are the drivers a motion study animates. A gear mate
 * couples one revolute's angle to another's by a ratio.
 */

import type { Vec3 } from './types.js';

export type Quat = [number, number, number, number];

export interface Pose {
  p: Vec3;
  q: Quat;
}

export interface Ref {
  kind: 'plane' | 'axis';
  /** In the part's own frame, mm. */
  point: Vec3;
  /** Unit normal (plane, pointing out of the material) or direction (axis). */
  dir: Vec3;
}

export type MateKind = 'coincident' | 'concentric' | 'distance' | 'angle' | 'parallel' | 'hinge' | 'slider' | 'gear' | 'screw' | 'rack';

export interface Mate {
  id: string;
  kind: MateKind;
  /** The instance being placed and its reference. */
  a: string;
  ra: Ref;
  /** The instance it is mated to and its reference. */
  b: string;
  rb: Ref;
  /** Distance (mm) or angle (deg) for distance/angle mates; the driven value of a hinge (deg) or slider (mm). */
  value?: number;
  /** A gear mate: the hinge it follows and the ratio (this angle = -ratio x that angle). */
  follows?: string;
  ratio?: number;
  /** Limits on the driven value (deg for hinges, mm for sliders): it stops there, like a limit mate. */
  min?: number;
  max?: number;
  /** A screw's pitch: mm along the axis per turn. */
  pitch?: number;
}

export interface Instance {
  id: string;
  name: string;
  job: string;
  params: Record<string, number>;
  material: string;
  pose: Pose;
  grounded?: boolean;
}

// ----- vector and quaternion helpers -----------------------------------------------------------

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec3): Vec3 => {
  const l = len3(a);
  return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 1];
};

export const IDENTITY: Quat = [0, 0, 0, 1];

export function qmul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function qrot(q: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]];
  const t = scale(cross3(u, v), 2);
  return add(add(v, scale(t, q[3])), cross3(u, t));
}

export function qaxis(axis: Vec3, rad: number): Quat {
  const n = unit(axis);
  const s = Math.sin(rad / 2);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(rad / 2)];
}

/** The shortest rotation taking unit vector a to unit vector b. */
export function qbetween(a: Vec3, b: Vec3): Quat {
  const d = dot3(a, b);
  if (d > 1 - 1e-12) return IDENTITY;
  if (d < -1 + 1e-12) {
    const ortho = Math.abs(a[0]) < 0.9 ? cross3(a, [1, 0, 0]) : cross3(a, [0, 1, 0]);
    return qaxis(ortho, Math.PI);
  }
  const c = cross3(a, b);
  const q: Quat = [c[0], c[1], c[2], 1 + d];
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** A point of an instance's part, in assembly space. */
export const toWorld = (pose: Pose, v: Vec3): Vec3 => add(qrot(pose.q, v), pose.p);
export const dirToWorld = (pose: Pose, v: Vec3): Vec3 => qrot(pose.q, v);

/** A reference of an instance, in assembly space. */
export function worldRef(inst: Instance, r: Ref): Ref {
  return { kind: r.kind, point: toWorld(inst.pose, r.point), dir: unit(dirToWorld(inst.pose, r.dir)) };
}

// ----- picking references from a mesh ----------------------------------------------------------

/**
 * The axis of a round surface near a picked point: the normals of a cylinder
 * are all perpendicular to its axis, so the axis is the direction the nearby
 * normals vary least along (smallest eigenvector of their scatter); the centre
 * is a least-squares circle fit of the nearby points projected along it.
 * Returns null when the surface there is flat (no round patch).
 */
export function fitAxis(positions: ArrayLike<number>, normals: ArrayLike<number>, at: Vec3, radius: number): Ref | null {
  const pts: Vec3[] = [];
  const nrm: Vec3[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const p: Vec3 = [positions[i], positions[i + 1], positions[i + 2]];
    if (len3(sub(p, at)) <= radius) {
      pts.push(p);
      nrm.push([normals[i], normals[i + 1], normals[i + 2]]);
    }
  }
  if (pts.length < 6) return null;
  // Scatter matrix of the normals.
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const n of nrm) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 3 + c] += n[r] * n[c];
  const { values, vectors } = eigenSym3(m);
  // A flat patch has one big eigenvalue; a round one two comparable ones.
  const sorted = values.map((v, i) => [v, i] as [number, number]).sort((x, y) => x[0] - y[0]);
  if (sorted[1][0] < 0.05 * sorted[2][0]) return null;
  const axis = unit(vectors[sorted[0][1]]);
  // Circle fit in the plane perpendicular to the axis (Kasa).
  const e1 = unit(Math.abs(axis[0]) < 0.9 ? cross3(axis, [1, 0, 0]) : cross3(axis, [0, 1, 0]));
  const e2 = cross3(axis, e1);
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sxz = 0, syz = 0, sz = 0;
  const n = pts.length;
  for (const p of pts) {
    const x = dot3(p, e1);
    const y = dot3(p, e2);
    const z = x * x + y * y;
    sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; sxz += x * z; syz += y * z; sz += z;
  }
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] [A B C]^T = [sxz syz sz]: centre (A/2, B/2).
  const sol = solve3([sxx, sxy, sx, sxy, syy, sy, sx, sy, n], [sxz, syz, sz]);
  if (!sol) return null;
  const cx = sol[0] / 2;
  const cy = sol[1] / 2;
  const mid = pts.reduce((s, p) => s + dot3(p, axis), 0) / n;
  const point = add(add(scale(e1, cx), scale(e2, cy)), scale(axis, mid));
  return { kind: 'axis', point, dir: axis };
}

/** Eigen-decomposition of a symmetric 3 x 3 matrix (Jacobi rotations). */
export function eigenSym3(a: number[]): { values: number[]; vectors: Vec3[] } {
  const A = a.slice();
  const V = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) off += A[p * 3 + q] ** 2;
    if (off < 1e-20) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = A[p * 3 + q];
      if (Math.abs(apq) < 1e-15) continue;
      const theta = (A[q * 3 + q] - A[p * 3 + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = A[k * 3 + p];
        const akq = A[k * 3 + q];
        A[k * 3 + p] = c * akp - s * akq;
        A[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = A[p * 3 + k];
        const aqk = A[q * 3 + k];
        A[p * 3 + k] = c * apk - s * aqk;
        A[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k * 3 + p];
        const vkq = V[k * 3 + q];
        V[k * 3 + p] = c * vkp - s * vkq;
        V[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  return {
    values: [A[0], A[4], A[8]],
    vectors: [0, 1, 2].map((j): Vec3 => [V[j], V[3 + j], V[6 + j]]),
  };
}

function solve3(m: number[], b: number[]): Vec3 | null {
  const det = (x: number[]): number =>
    x[0] * (x[4] * x[8] - x[5] * x[7]) - x[1] * (x[3] * x[8] - x[5] * x[6]) + x[2] * (x[3] * x[7] - x[4] * x[6]);
  const d = det(m);
  if (Math.abs(d) < 1e-12) return null;
  const col = (j: number): number[] => m.map((v, i) => (i % 3 === j ? b[Math.floor(i / 3)] : v));
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
}

// ----- the solver ---------------------------------------------------------------------------------

/** Rotate a pose about a world line through `at` along `axis` by `rad`. */
function turnAbout(pose: Pose, at: Vec3, axis: Vec3, rad: number): Pose {
  const r = qaxis(axis, rad);
  return { p: add(qrot(r, sub(pose.p, at)), at), q: qmul(r, pose.q) };
}

/** Rotate a pose so its part-frame direction `local` points along world `target`, keeping `pivot` (world) fixed. */
function alignDir(pose: Pose, local: Vec3, target: Vec3, pivot: Vec3): Pose {
  const now = unit(dirToWorld(pose, local));
  const r = qbetween(now, unit(target));
  return { p: add(qrot(r, sub(pose.p, pivot)), pivot), q: qmul(r, pose.q) };
}

export interface SolveReport {
  instances: Instance[];
  /** Mates that could not be met, with the reason. */
  failed: { id: string; reason: string }[];
  /** Remaining freedoms per instance (rough count, for the status line). */
  free: Record<string, number>;
}

/**
 * Place every instance from its mates. Mates are applied in order per
 * instance; the instance named `a` moves, `b` must already be placed.
 * Driven values (hinge angle, slider travel, gear) come from the mates' values.
 */
export function solveAssembly(instances: Instance[], mates: Mate[]): SolveReport {
  const out = instances.map((i) => ({ ...i, pose: { p: [...i.pose.p] as Vec3, q: [...i.pose.q] as Quat } }));
  const byId = new Map(out.map((i) => [i.id, i]));
  const placed = new Set(out.filter((i) => i.grounded).map((i) => i.id));
  if (!placed.size && out.length) placed.add(out[0].id);
  const failed: { id: string; reason: string }[] = [];
  const free: Record<string, number> = {};
  for (const i of out) free[i.id] = placed.has(i.id) ? 0 : 6;
  const hingeAngle = new Map<string, number>();
  const clampV = (m: Mate, v: number): number => Math.min(m.max ?? Infinity, Math.max(m.min ?? -Infinity, v));
  for (const m of mates) if (m.kind === 'hinge' || m.kind === 'screw' || m.kind === 'slider') hingeAngle.set(m.id, clampV(m, m.value ?? 0));
  // Followers: a gear turns the other way at its ratio; a rack slides ratio mm per degree of its pinion.
  for (const m of mates) {
    if (!m.follows) continue;
    const lead = hingeAngle.get(m.follows) ?? 0;
    if (m.kind === 'gear') hingeAngle.set(m.id, clampV(m, -(m.ratio ?? 1) * lead));
    if (m.kind === 'rack') hingeAngle.set(m.id, clampV(m, (m.ratio ?? 1) * lead));
  }

  // Keep going until no mate can be applied (each pass places what it can).
  const pending = mates.slice();
  for (let pass = 0; pass < mates.length + 1 && pending.length; pass++) {
    for (let k = 0; k < pending.length; k++) {
      const m = pending[k];
      const A = byId.get(m.a);
      const B = byId.get(m.b);
      if (!A || !B) {
        failed.push({ id: m.id, reason: 'an instance is missing' });
        pending.splice(k--, 1);
        continue;
      }
      if (!placed.has(B.id)) continue;
      const rb = worldRef(B, m.rb);
      const ra = worldRef(A, m.ra);
      switch (m.kind) {
        case 'concentric':
        case 'hinge':
        case 'screw':
        case 'gear': {
          if (m.ra.kind !== 'axis' || m.rb.kind !== 'axis') {
            failed.push({ id: m.id, reason: `${m.kind} needs two round faces (axes)` });
            break;
          }
          // Direction, then onto the line (keep the position along the axis).
          let pose = alignDir(A.pose, m.ra.dir, rb.dir, ra.point);
          const pa = toWorld(pose, m.ra.point);
          // A screw advances its pitch along the axis per turn: its axial place is set by its angle.
          const along = m.kind === 'screw' ? ((m.pitch ?? 1) * (hingeAngle.get(m.id) ?? 0)) / 360 : dot3(sub(pa, rb.point), rb.dir);
          const onLine = add(rb.point, scale(rb.dir, along));
          pose = { p: add(pose.p, sub(onLine, pa)), q: pose.q };
          if (m.kind !== 'concentric') {
            // Absolute: the angle from the other part's zero direction to this part's, about the axis.
            const now = hingeNow({ ...A, pose }, m, B);
            const want = ((hingeAngle.get(m.id) ?? 0) * Math.PI) / 180;
            pose = turnAbout(pose, rb.point, rb.dir, want - now);
          }
          A.pose = pose;
          free[A.id] = Math.min(free[A.id], 2);
          break;
        }
        case 'coincident':
        case 'distance': {
          if (m.ra.kind !== 'plane' || m.rb.kind !== 'plane') {
            failed.push({ id: m.id, reason: `${m.kind} needs two flat faces` });
            break;
          }
          const gap = m.kind === 'distance' ? m.value ?? 0 : 0;
          // Normals opposed. Turn about the point, then slide along the normal until flush (plus the gap).
          let pose = alignDir(A.pose, m.ra.dir, scale(rb.dir, -1), ra.point);
          // An axis mate already set keeps the turn about it: re-check concentricity is kept by a pure slide.
          const pa = toWorld(pose, m.ra.point);
          const off = dot3(sub(pa, rb.point), rb.dir) - gap;
          pose = { p: sub(pose.p, scale(rb.dir, off)), q: pose.q };
          A.pose = pose;
          free[A.id] = Math.max(0, free[A.id] - 3);
          break;
        }
        case 'rack':
        case 'slider': {
          if (m.ra.kind !== 'plane' || m.rb.kind !== 'plane') {
            failed.push({ id: m.id, reason: 'a slider needs two flat faces' });
            break;
          }
          // Faces against each other, then the driven travel along the face's first in-plane direction.
          let pose = alignDir(A.pose, m.ra.dir, scale(rb.dir, -1), ra.point);
          const pa = toWorld(pose, m.ra.point);
          pose = { p: sub(pose.p, scale(rb.dir, dot3(sub(pa, rb.point), rb.dir))), q: pose.q };
          const slide = unit(Math.abs(rb.dir[1]) < 0.9 ? cross3(rb.dir, [0, 1, 0]) : cross3(rb.dir, [1, 0, 0]));
          pose = { p: add(pose.p, scale(slide, hingeAngle.get(m.id) ?? m.value ?? 0)), q: pose.q };
          A.pose = pose;
          free[A.id] = Math.min(free[A.id], 1);
          break;
        }
        case 'parallel':
        case 'angle': {
          const target = m.kind === 'parallel' ? rb.dir : (() => {
            const ang = ((m.value ?? 90) * Math.PI) / 180;
            const ortho = unit(Math.abs(rb.dir[1]) < 0.9 ? cross3(rb.dir, [0, 1, 0]) : cross3(rb.dir, [1, 0, 0]));
            return add(scale(rb.dir, Math.cos(ang)), scale(ortho, Math.sin(ang)));
          })();
          A.pose = alignDir(A.pose, m.ra.dir, target, ra.point);
          free[A.id] = Math.max(0, free[A.id] - 2);
          break;
        }
      }
      placed.add(A.id);
      pending.splice(k--, 1);
    }
  }
  for (const m of pending) failed.push({ id: m.id, reason: 'mated only to parts that are not placed' });
  // Loops (a four-bar linkage, a part held by two others) are closed by refining every placed part together.
  // A far-off first guess can need more than one round; each round starts where the last stopped.
  let refined = refine(out, mates, hingeAngle);
  for (let round = 0; round < 4 && refined.residual > 1e-6; round++) refined = refine(out, mates, hingeAngle);
  if (refined.residual > 1e-6) failed.push({ id: 'loop', reason: `the mates conflict (left over ${refined.residual.toExponential(1)})` });
  return { instances: out, failed, free };
}

/** A direction perpendicular to an axis, fixed in the part: the zero of a hinge angle. */
function zeroDir(dir: Vec3): Vec3 {
  return unit(Math.abs(dir[0]) < 0.9 ? cross3(dir, [1, 0, 0]) : cross3(dir, [0, 1, 0]));
}

/** The hinge angle now (rad): from B's zero direction to A's, about B's axis. */
function hingeNow(A: Instance, m: Mate, B: Instance): number {
  const axis = unit(dirToWorld(B.pose, m.rb.dir));
  const zb = dirToWorld(B.pose, zeroDir(m.rb.dir));
  const za = dirToWorld(A.pose, zeroDir(m.ra.dir));
  // Project A's zero onto the plane of the axis.
  const pa = sub(za, scale(axis, dot3(za, axis)));
  return Math.atan2(dot3(cross3(zb, pa), axis), dot3(zb, pa));
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Residuals of every mate (mm, or mm-scaled for angles) for the current poses. */
function residuals(inst: Map<string, Instance>, mates: Mate[], angle: Map<string, number>): number[] {
  const out: number[] = [];
  const L = 20; // mm per radian, so angles weigh like a 20 mm lever
  for (const m of mates) {
    const A = inst.get(m.a);
    const B = inst.get(m.b);
    if (!A || !B) continue;
    const ra = worldRef(A, m.ra);
    const rb = worldRef(B, m.rb);
    if (m.kind === 'concentric' || m.kind === 'hinge' || m.kind === 'gear' || m.kind === 'screw') {
      const c = cross3(ra.dir, rb.dir);
      const d = sub(ra.point, rb.point);
      const perp = sub(d, scale(rb.dir, dot3(d, rb.dir)));
      out.push(c[0] * L, c[1] * L, c[2] * L, perp[0], perp[1], perp[2]);
      if (m.kind !== 'concentric') out.push(wrap(hingeNow(A, m, B) - ((angle.get(m.id) ?? 0) * Math.PI) / 180) * L);
      if (m.kind === 'screw') out.push(dot3(d, rb.dir) - ((m.pitch ?? 1) * (angle.get(m.id) ?? 0)) / 360);
    } else if (m.kind === 'slider' || m.kind === 'rack') {
      // Faces against each other, and the travel along the face's first in-plane direction.
      const s = add(ra.dir, rb.dir);
      const slide = unit(Math.abs(rb.dir[1]) < 0.9 ? cross3(rb.dir, [0, 1, 0]) : cross3(rb.dir, [1, 0, 0]));
      const d = sub(ra.point, rb.point);
      out.push(s[0] * L, s[1] * L, s[2] * L, dot3(d, rb.dir), dot3(d, slide) - (angle.get(m.id) ?? 0));
    } else if (m.kind === 'coincident' || m.kind === 'distance') {
      const s = add(ra.dir, rb.dir);
      out.push(s[0] * L, s[1] * L, s[2] * L, dot3(sub(ra.point, rb.point), rb.dir) - (m.kind === 'distance' ? m.value ?? 0 : 0));
    } else if (m.kind === 'parallel') {
      const c = cross3(ra.dir, rb.dir);
      out.push(c[0] * L, c[1] * L, c[2] * L);
    } else if (m.kind === 'angle') {
      out.push((dot3(ra.dir, rb.dir) - Math.cos(((m.value ?? 90) * Math.PI) / 180)) * L);
    }
  }
  return out;
}

/**
 * Levenberg-Marquardt over every non-grounded part's pose (3 translations, 3
 * small rotations each), numeric Jacobian. Starts from the constructive result,
 * so a chain is already solved and only loops need it. Returns the final RMS residual.
 */
export function refine(instances: Instance[], mates: Mate[], angle: Map<string, number>): { residual: number; iterations: number } {
  const free = instances.filter((i) => !i.grounded && mates.some((m) => m.a === i.id || m.b === i.id));
  const byId = new Map(instances.map((i) => [i.id, i]));
  const n = free.length * 6;
  const rms = (r: number[]): number => Math.sqrt(r.reduce((s, v) => s + v * v, 0) / Math.max(1, r.length));
  let r = residuals(byId, mates, angle);
  if (!n || rms(r) < 1e-10) return { residual: rms(r), iterations: 0 };
  const base = free.map((i) => ({ p: [...i.pose.p] as Vec3, q: [...i.pose.q] as Quat }));
  const apply = (x: number[]): void => {
    free.forEach((inst, k) => {
      const t = x.slice(k * 6, k * 6 + 3) as Vec3;
      const w = x.slice(k * 6 + 3, k * 6 + 6) as Vec3;
      const ang = len3(w);
      const dq = ang > 1e-15 ? qaxis(w, ang) : IDENTITY;
      inst.pose = { p: add(base[k].p, t), q: qmul(dq, base[k].q) };
    });
  };
  let x = new Array<number>(n).fill(0);
  let lambda = 1e-3;
  let it = 0;
  for (; it < 200; it++) {
    apply(x);
    r = residuals(byId, mates, angle);
    const cost = r.reduce((s, v) => s + v * v, 0);
    if (Math.sqrt(cost / r.length) < 1e-10) break;
    // Jacobian by forward differences.
    const J: number[][] = [];
    for (let j = 0; j < n; j++) {
      const h = j % 6 < 3 ? 1e-6 : 1e-7;
      const xp = x.slice();
      xp[j] += h;
      apply(xp);
      const rp = residuals(byId, mates, angle);
      J.push(rp.map((v, k) => (v - r[k]) / h));
    }
    // (J^T J + lambda diag) dx = -J^T r
    const A: number[][] = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J[a].reduce((s, v, k) => s + v * J[b][k], 0)));
    const g = Array.from({ length: n }, (_, a) => J[a].reduce((s, v, k) => s + v * r[k], 0));
    let improved = false;
    for (let tries = 0; tries < 10 && !improved; tries++) {
      // Marquardt scaling plus a small fixed term: directions the mates leave free (sliding along a pin)
      // get no step, instead of drifting on rounding noise.
      const M = A.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-6 : v)));
      const dx = solveLinear(M, g.map((v) => -v));
      if (!dx) {
        lambda *= 10;
        continue;
      }
      const xn = x.map((v, k) => v + dx[k]);
      apply(xn);
      const cn = residuals(byId, mates, angle).reduce((s, v) => s + v * v, 0);
      if (cn < cost) {
        x = xn;
        lambda = Math.max(1e-12, lambda / 10);
        improved = true;
      } else {
        lambda *= 10;
      }
    }
    if (!improved) break;
  }
  apply(x);
  // Fold the step into the poses (already applied) and renormalise the rotations.
  for (const i of free) {
    const l = Math.hypot(...i.pose.q);
    i.pose.q = [i.pose.q[0] / l, i.pose.q[1] / l, i.pose.q[2] / l, i.pose.q[3] / l];
  }
  return { residual: rms(residuals(byId, mates, angle)), iterations: it };
}

/** Gaussian elimination with partial pivoting; null when singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f !== 0) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** The angle (deg) a gear follows from: this = -ratio x that. Exposed for the motion study. */
export function gearAngle(driver: number, ratio: number): number {
  return -ratio * driver;
}

// ----- saving and sharing ------------------------------------------------------------------------

export interface AssemblyDoc {
  instances: Instance[];
  mates: Mate[];
}

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;
const refOut = (r: Ref): unknown[] => [r.kind === 'axis' ? 1 : 0, ...r.point.map(r6), ...r.dir.map(r6)];
const refIn = (a: unknown): Ref | null => {
  if (!Array.isArray(a) || a.length !== 7 || !a.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const n = a as number[];
  return { kind: n[0] === 1 ? 'axis' : 'plane', point: [n[1], n[2], n[3]], dir: [n[4], n[5], n[6]] };
};

/** The assembly as a short, URL-safe string (compact JSON, base64url). */
export function encodeAssembly(doc: AssemblyDoc): string {
  const json = JSON.stringify({
    v: 1,
    i: doc.instances.map((i) => [i.id, i.name, i.job, i.material, Object.fromEntries(Object.entries(i.params).map(([k, v]) => [k, r6(v)])), [...i.pose.p.map(r6), ...i.pose.q.map(r6)], i.grounded ? 1 : 0]),
    m: doc.mates.map((m) => [m.id, m.kind, m.a, refOut(m.ra), m.b, refOut(m.rb), m.value ?? null, m.follows ?? null, m.ratio ?? null, m.min ?? null, m.max ?? null, m.pitch ?? null]),
  });
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

const KINDS: MateKind[] = ['coincident', 'concentric', 'distance', 'angle', 'parallel', 'hinge', 'slider', 'gear', 'screw', 'rack'];

/** Read an assembly string; anything malformed gives null, never a guessed assembly. `knownJob` checks part ids. */
export function decodeAssembly(text: string, knownJob: (id: string) => boolean): AssemblyDoc | null {
  try {
    const b64 = text.replace(/-/gu, '+').replace(/_/gu, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const o = JSON.parse(new TextDecoder().decode(bytes)) as { v: number; i: unknown[][]; m: unknown[][] };
    if (o.v !== 1 || !Array.isArray(o.i) || !Array.isArray(o.m)) return null;
    const instances: Instance[] = [];
    for (const r of o.i) {
      const [id, name, job, material, params, pose, grounded] = r as [string, string, string, string, Record<string, number>, number[], number];
      if (typeof id !== 'string' || typeof job !== 'string' || !knownJob(job) || !Array.isArray(pose) || pose.length !== 7) return null;
      if (!pose.every(Number.isFinite) || !params || typeof params !== 'object' || !Object.values(params).every(Number.isFinite)) return null;
      instances.push({ id, name: String(name), job, material: String(material), params, pose: { p: [pose[0], pose[1], pose[2]], q: [pose[3], pose[4], pose[5], pose[6]] }, grounded: grounded === 1 });
    }
    const ids = new Set(instances.map((i) => i.id));
    const mates: Mate[] = [];
    for (const r of o.m) {
      const [id, kind, a, ra, b, rb, value, follows, ratio, min, max, pitch] = r as [string, MateKind, string, unknown, string, unknown, number | null, string | null, number | null, number | null, number | null, number | null];
      const A = refIn(ra);
      const B = refIn(rb);
      if (!KINDS.includes(kind) || !ids.has(a) || !ids.has(b) || !A || !B) return null;
      mates.push({ id: String(id), kind, a, ra: A, b, rb: B, value: value ?? undefined, follows: follows ?? undefined, ratio: ratio ?? undefined, min: min ?? undefined, max: max ?? undefined, pitch: pitch ?? undefined });
    }
    return { instances, mates };
  } catch {
    return null;
  }
}
