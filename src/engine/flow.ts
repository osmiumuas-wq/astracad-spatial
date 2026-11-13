/**
 * Air-flow preview: ideal (potential) flow around the part, sitting on the
 * bench, in a steady horizontal breeze.
 *
 * The part is voxelised, and Laplace's equation for the velocity potential is
 * solved on the air cells around it (finite volumes, red-black SOR): no flow
 * through the part or the bench, undisturbed flow far away. Streamlines are
 * traced through the resulting velocity field and coloured by speed relative
 * to the oncoming air.
 *
 * What this is not: ideal flow has no viscosity, so it has no wake, no
 * separation, no drag and no lift. It shows where the air goes and where it
 * speeds up or stalls. It gives no forces, and the app shows none.
 */

import { voxelize } from './fea.js';

export type Wind = '+x' | '-z';

export interface FlowResult {
  /** Streamline points in part coordinates (mm), concatenated. */
  points: Float32Array;
  /** Speed relative to the oncoming air at each point. */
  speeds: Float32Array;
  /** Index (in points) where each streamline starts. */
  starts: Uint32Array;
  /** Cell size of the flow grid, mm. */
  h: number;
  cells: number;
  iterations: number;
  /** Largest potential change in the last sweep, relative to U h. */
  residual: number;
  ms: number;
}

export interface FlowField {
  nx: number;
  ny: number;
  nz: number;
  h: number;
  origin: [number, number, number];
  /** 1 for part cells. */
  solid: Uint8Array;
  /** Velocity at cell centres (3 per cell), in units of the oncoming speed. */
  vel: Float32Array;
  iterations: number;
  residual: number;
}

const MAX_CELLS = 70000;
const MAX_ITER = 1500;
const TOL = 1e-6;

/** Solve the potential flow around a closed mesh standing on the plane y = min y. */
export function flowField(positions: Float32Array, indices: Uint32Array, wind: Wind, maxCells = MAX_CELLS): FlowField {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], positions[i + a]);
      max[a] = Math.max(max[a], positions[i + a]);
    }
  }
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const pad = 0.9 * size;
  // Domain: the part plus a margin on every side except below (the bench).
  const vol = (max[0] - min[0] + 2 * pad) * (max[1] - min[1] + pad) * (max[2] - min[2] + 2 * pad);
  const h = Math.cbrt(vol / maxCells);
  const part = voxelize(positions, indices, h);
  const P = Math.ceil(pad / h);
  const nx = part.nx + 2 * P;
  const ny = part.ny + P;
  const nz = part.nz + 2 * P;
  const origin: [number, number, number] = [min[0] - P * h, min[1], min[2] - P * h];
  const n = nx * ny * nz;
  const solid = new Uint8Array(n);
  for (let k = 0; k < part.nz; k++) {
    for (let j = 0; j < part.ny; j++) {
      for (let i = 0; i < part.nx; i++) {
        // Half-full cells and fuller count as part, so the solid keeps its true size on average.
        if (part.fraction[i + part.nx * (j + part.ny * k)] >= 0.5) {
          solid[i + P + nx * (j + ny * (k + P))] = 1;
        }
      }
    }
  }
  const U: [number, number, number] = wind === '+x' ? [1, 0, 0] : [0, 0, -1];
  const far = (i: number, j: number, k: number): number =>
    U[0] * (origin[0] + (i + 0.5) * h) + U[1] * (origin[1] + (j + 0.5) * h) + U[2] * (origin[2] + (k + 0.5) * h);
  const phi = new Float64Array(n);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) phi[i + nx * (j + ny * k)] = far(i, j, k);

  const omega = 2 / (1 + Math.sin(Math.PI / Math.max(nx, ny, nz)));
  let iterations = 0;
  let residual = Infinity;
  for (; iterations < MAX_ITER && residual > TOL; iterations++) {
    let worst = 0;
    for (let colour = 0; colour < 2; colour++) {
      for (let k = 0; k < nz; k++) {
        for (let j = 0; j < ny; j++) {
          for (let i = (j + k + colour) & 1; i < nx; i += 2) {
            const c = i + nx * (j + ny * k);
            if (solid[c]) continue;
            let sum = 0;
            let cnt = 0;
            // x neighbours (outside the domain: the undisturbed stream)
            if (i > 0) { if (!solid[c - 1]) { sum += phi[c - 1]; cnt++; } } else { sum += far(-1, j, k); cnt++; }
            if (i < nx - 1) { if (!solid[c + 1]) { sum += phi[c + 1]; cnt++; } } else { sum += far(nx, j, k); cnt++; }
            // y: the bench below is a wall (no flow through it)
            if (j > 0 && !solid[c - nx]) { sum += phi[c - nx]; cnt++; }
            if (j < ny - 1) { if (!solid[c + nx]) { sum += phi[c + nx]; cnt++; } } else { sum += far(i, ny, k); cnt++; }
            const sz = nx * ny;
            if (k > 0) { if (!solid[c - sz]) { sum += phi[c - sz]; cnt++; } } else { sum += far(i, j, -1); cnt++; }
            if (k < nz - 1) { if (!solid[c + sz]) { sum += phi[c + sz]; cnt++; } } else { sum += far(i, j, nz); cnt++; }
            if (!cnt) continue;
            const d = sum / cnt - phi[c];
            phi[c] += omega * d;
            if (Math.abs(d) > worst) worst = Math.abs(d);
          }
        }
      }
    }
    residual = worst / h;
  }

  // Cell-centre velocity: the mean of the two face velocities on each axis; faces against
  // the part or the bench carry no flow.
  const vel = new Float32Array(n * 3);
  const sz = nx * ny;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = i + nx * (j + ny * k);
        if (solid[c]) continue;
        const face = (has: boolean, nb: number, ghost: () => number, sign: number): number => {
          if (!has) return sign * (ghost() - phi[c]) / h;
          return solid[nb] ? 0 : sign * (phi[nb] - phi[c]) / h;
        };
        vel[c * 3] = 0.5 * (face(i < nx - 1, c + 1, () => far(nx, j, k), 1) + face(i > 0, c - 1, () => far(-1, j, k), -1));
        const up = face(j < ny - 1, c + nx, () => far(i, ny, k), 1);
        const down = j > 0 ? face(true, c - nx, () => 0, -1) : 0;
        vel[c * 3 + 1] = 0.5 * (up + down);
        vel[c * 3 + 2] = 0.5 * (face(k < nz - 1, c + sz, () => far(i, j, nz), 1) + face(k > 0, c - sz, () => far(i, j, -1), -1));
      }
    }
  }
  return { nx, ny, nz, h, origin, solid, vel, iterations, residual };
}

/** Velocity at a point (trilinear between cell centres), in units of the oncoming speed. */
export function velocityAt(f: FlowField, x: number, y: number, z: number, out: number[]): boolean {
  const gx = (x - f.origin[0]) / f.h - 0.5;
  const gy = (y - f.origin[1]) / f.h - 0.5;
  const gz = (z - f.origin[2]) / f.h - 0.5;
  if (gx < 0 || gy < -0.5 || gz < 0 || gx > f.nx - 1 || gy > f.ny - 1 || gz > f.nz - 1) return false;
  const i0 = Math.min(f.nx - 2, Math.floor(gx));
  const j0 = Math.max(0, Math.min(f.ny - 2, Math.floor(gy)));
  const k0 = Math.min(f.nz - 2, Math.floor(gz));
  const tx = gx - i0;
  const ty = Math.max(0, gy - j0);
  const tz = gz - k0;
  out[0] = out[1] = out[2] = 0;
  for (let dk = 0; dk < 2; dk++) {
    for (let dj = 0; dj < 2; dj++) {
      for (let di = 0; di < 2; di++) {
        const w = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dk ? tz : 1 - tz);
        const c = (i0 + di + f.nx * (j0 + dj + f.ny * (k0 + dk))) * 3;
        out[0] += w * f.vel[c];
        out[1] += w * f.vel[c + 1];
        out[2] += w * f.vel[c + 2];
      }
    }
  }
  return true;
}

/** Solve the flow and trace streamlines from a grid of seeds upstream of the part. */
export function solveFlow(positions: Float32Array, indices: Uint32Array, wind: Wind, maxCells = MAX_CELLS): FlowResult {
  const t0 = performance.now();
  const f = flowField(positions, indices, wind, maxCells);
  const pts: number[] = [];
  const spd: number[] = [];
  const starts: number[] = [];
  // Seeds: a plane two cells in from the upstream edge, covering the part's
  // shadow and a margin around it.
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    min = min.map((m, a) => Math.min(m, positions[i + a]));
    max = max.map((m, a) => Math.max(m, positions[i + a]));
  }
  const across = wind === '+x' ? 2 : 0;
  const lo = min[across] - 0.35 * (max[across] - min[across]) - 2 * f.h;
  const hi = max[across] + 0.35 * (max[across] - min[across]) + 2 * f.h;
  const top = max[1] + 0.4 * (max[1] - min[1]) + 2 * f.h;
  const COLS = 11;
  const ROWS = 6;
  const along = wind === '+x' ? 0 : 2;
  const startAlong = wind === '+x' ? f.origin[0] + 2 * f.h : f.origin[2] + (f.nz - 2) * f.h;
  const step = 0.5 * f.h;
  const v = [0, 0, 0];
  const mid = [0, 0, 0];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = [0, 0, 0];
      p[along] = startAlong;
      p[across] = lo + ((c + 0.5 + (r % 2) * 0.5) / (COLS + 0.5)) * (hi - lo);
      p[1] = min[1] + 0.6 * f.h + ((r + 0.5) / ROWS) * (top - min[1]);
      starts.push(pts.length / 3);
      for (let s = 0; s < 1200; s++) {
        if (!velocityAt(f, p[0], p[1], p[2], v)) break;
        const speed = Math.hypot(v[0], v[1], v[2]);
        if (s % 2 === 0) {
          pts.push(p[0], p[1], p[2]);
          spd.push(speed);
        }
        if (speed < 0.03) break;
        // Midpoint (RK2) step of fixed length, so slow regions are not over-sampled.
        const k = step / speed;
        const q0 = p[0] + 0.5 * k * v[0], q1 = p[1] + 0.5 * k * v[1], q2 = p[2] + 0.5 * k * v[2];
        if (!velocityAt(f, q0, q1, q2, mid)) break;
        const ms = Math.hypot(mid[0], mid[1], mid[2]) || speed;
        p[0] += (step / ms) * mid[0];
        p[1] += (step / ms) * mid[1];
        p[2] += (step / ms) * mid[2];
      }
      // A line too short to read is dropped.
      if (pts.length / 3 - starts[starts.length - 1] < 4) {
        pts.length = starts[starts.length - 1] * 3;
        spd.length = starts[starts.length - 1];
        starts.pop();
      }
    }
  }
  return {
    points: new Float32Array(pts),
    speeds: new Float32Array(spd),
    starts: new Uint32Array(starts),
    h: f.h,
    cells: f.nx * f.ny * f.nz,
    iterations: f.iterations,
    residual: f.residual,
    ms: performance.now() - t0,
  };
}
