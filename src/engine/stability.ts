/**
 * Will it tip? The part standing on the bench (part frame: millimetres, +Y up,
 * resting on its lowest face), checked with exact rigid-body statics:
 *
 *  - centre of mass and volume from the closed mesh (divergence theorem: signed
 *    tetrahedra from the origin), so the numbers are exact for the mesh;
 *  - the footprint: the convex hull of the vertices touching the floor;
 *  - tip angle: the smallest tilt that carries the centre of mass over a
 *    footprint edge, atan(distance to edge / height of the centre of mass);
 *  - with an applied force (a phone leaning on a stand), the tipping safety
 *    factor about every footprint edge: the part's weight moment over the
 *    force's overturning moment. Below 1 it tips.
 */

import { Vec3 } from './types.js';

export interface StabilityInput {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

export interface AppliedForce {
  /** Where it acts, part frame, mm. */
  at: Vec3;
  /** Force vector, newtons. */
  force: Vec3;
}

/** A weight carried by the part (a phone resting on a stand): newtons, acting straight down at a point. */
export interface CarriedWeight {
  at: Vec3;
  newtons: number;
}

export interface TipEdge {
  /** Edge end points on the floor, mm, part frame (y = floor). */
  a: Vec3;
  b: Vec3;
  /** Distance from the centre of mass (projected) to this edge, mm; negative when outside. */
  margin: number;
  /** Tilt that tips it over this edge, degrees. */
  tipDeg: number;
  /** Weight moment over overturning moment about this edge (Infinity when the force does not overturn). */
  factor: number;
}

export interface Stability {
  /** mm^3 */
  volume: number;
  /** grams */
  mass: number;
  /** Centre of mass of the part, mm. */
  com: Vec3;
  /** Centre of mass of the part with the carried weights, mm (the one the tip angles use). */
  comLoaded: Vec3;
  /** Floor height (lowest y), mm. */
  floor: number;
  /** Footprint: convex hull of the floor contact, counter-clockwise in (x, z), mm. */
  footprint: [number, number][];
  /** Every footprint edge, ranked from the weakest. */
  edges: TipEdge[];
  /** The edge it tips over first with no force (smallest tip angle). */
  weakest: TipEdge | null;
  /** Smallest tipping factor with the applied forces (Infinity with none). */
  factor: number;
  /** Stands on its own: centre of mass inside the footprint. */
  standsAlone: boolean;
}

const G = 9.81;

/** Andrew's monotone chain; counter-clockwise, no collinear points. */
export function convexHull(points: [number, number][]): [number, number][] {
  const pts = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts;
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-9) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-9) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Volume and centre of mass of a closed, outward-facing triangle mesh. */
export function massProperties(mesh: StabilityInput): { volume: number; com: Vec3 } {
  const P = mesh.positions;
  const I = mesh.indices;
  let vol = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3;
    const b = I[t + 1] * 3;
    const c = I[t + 2] * 3;
    const ax = P[a], ay = P[a + 1], az = P[a + 2];
    const bx = P[b], by = P[b + 1], bz = P[b + 2];
    const qx = P[c], qy = P[c + 1], qz = P[c + 2];
    const v = (ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx)) / 6;
    vol += v;
    cx += v * (ax + bx + qx);
    cy += v * (ay + by + qy);
    cz += v * (az + bz + qz);
  }
  if (Math.abs(vol) < 1e-12) return { volume: 0, com: [0, 0, 0] };
  return { volume: vol, com: [cx / (4 * vol), cy / (4 * vol), cz / (4 * vol)] };
}

/**
 * Stability of the part on a level floor. `density` in g/cm^3. `contactTol` is
 * how close to the lowest point a vertex must be to touch the floor, mm.
 */
export function stability(
  mesh: StabilityInput,
  density: number,
  forces: AppliedForce[] = [],
  contactTol = 0.2,
  carried: CarriedWeight[] = [],
): Stability {
  const { volume, com: partCom } = massProperties(mesh);
  const mass = (volume / 1000) * density;
  // The carried weights move the centre of mass that gravity acts through.
  const partW = (mass / 1000) * G;
  let wSum = partW;
  const c: Vec3 = [partCom[0] * partW, partCom[1] * partW, partCom[2] * partW];
  for (const w of carried) {
    wSum += w.newtons;
    c[0] += w.at[0] * w.newtons;
    c[1] += w.at[1] * w.newtons;
    c[2] += w.at[2] * w.newtons;
  }
  const com: Vec3 = wSum > 0 ? [c[0] / wSum, c[1] / wSum, c[2] / wSum] : partCom;
  const P = mesh.positions;
  let floor = Infinity;
  for (let i = 1; i < P.length; i += 3) floor = Math.min(floor, P[i]);
  const touching: [number, number][] = [];
  for (let i = 0; i < P.length; i += 3) {
    if (P[i + 1] <= floor + contactTol) touching.push([P[i], P[i + 2]]);
  }
  const footprint = convexHull(touching);
  const height = com[1] - floor;
  const weight = wSum;
  const edges: TipEdge[] = [];
  if (footprint.length >= 3) {
    for (let k = 0; k < footprint.length; k++) {
      const [ax, az] = footprint[k];
      const [bx, bz] = footprint[(k + 1) % footprint.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-9) continue;
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      // In (x, z) with the hull counter-clockwise, the inside is to the left of a->b.
      const margin = ux * (com[2] - az) - uz * (com[0] - ax);
      const tipDeg = (Math.atan2(margin, Math.max(1e-9, height)) * 180) / Math.PI;
      // Moments about the edge axis u = (ux, 0, uz) through A: u . ((r - A) x F).
      const moment = (r: Vec3, f: Vec3): number => {
        const rx = r[0] - ax;
        const ry = r[1] - floor;
        const rz = r[2] - az;
        const mx = ry * f[2] - rz * f[1];
        const mz = rx * f[1] - ry * f[0];
        return ux * mx + uz * mz;
      };
      const restoring = moment(com, [0, -weight, 0]);
      let overturning = 0;
      for (const f of forces) overturning += moment(f.at, f.force);
      // Tipping happens when the forces turn the part against its weight.
      const against = restoring !== 0 ? -overturning * Math.sign(restoring) : -Math.abs(overturning);
      const factor = margin <= 0 ? 0 : against > 1e-12 ? Math.abs(restoring) / against : Infinity;
      edges.push({ a: [ax, floor, az], b: [bx, floor, bz], margin, tipDeg, factor });
    }
  }
  const byAngle = edges.slice().sort((p, q) => p.tipDeg - q.tipDeg);
  const weakest = byAngle[0] ?? null;
  const factor = edges.reduce((m, e) => Math.min(m, e.factor), Infinity);
  edges.sort((p, q) => (forces.length ? p.factor - q.factor : p.tipDeg - q.tipDeg));
  return {
    volume,
    mass,
    com: partCom,
    comLoaded: com,
    floor,
    footprint,
    edges,
    weakest,
    factor: edges.length ? factor : 0,
    standsAlone: !!weakest && weakest.margin > 0,
  };
}
