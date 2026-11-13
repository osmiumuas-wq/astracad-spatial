/**
 * Linear-elastic finite-element preview on a voxel grid.
 *
 * - The part is voxelised into equal cubes (8-node hexahedra, 3 displacement
 *   unknowns per node).
 * - Shear strains use the assumed-strain rule for rectangular elements (each
 *   shear component is sampled on the axis normal to its plane), which removes
 *   the shear locking that makes plain linear bricks far too stiff in bending
 *   without adding zero-energy modes. tests/fea.test.ts checks both claims.
 * - The stiffness matrix is stored as 27 neighbour blocks per node and solved
 *   by conjugate gradients with a block-Jacobi preconditioner.
 *
 * This is a design preview. Voxel steps over-read stress at curved or inclined
 * faces, so the peak reported to the user is the 99th percentile of nodal von
 * Mises stress, with the raw maximum beside it, and every result names its
 * element count.
 */

import { Region } from './jobs.js';
import { SpecError, Vec3 } from './types.js';

export type LoadRegion = Region | { kind: 'sphere'; c: Vec3; r: number };

export interface VoxelGrid {
  nx: number;
  ny: number;
  nz: number;
  h: number;
  origin: Vec3;
  /** 1 where the cell takes part in the model. Index i + nx (j + ny k). */
  solid: Uint8Array;
  /** Share of each cell that is material, 0 to 1. */
  fraction: Float32Array;
}

/** Rays per cell edge (so SUBSAMPLES^2 rays per cell) used to measure how full a cell is. */
const SUBSAMPLES = 5;
/** Cells emptier than this are left out of the model. */
const MIN_FRACTION = 0.1;

const GAUSS = 1 / Math.sqrt(3);

/** Signs of the 8 local nodes: node l sits at offset (l & 1, (l >> 1) & 1, (l >> 2) & 1). */
const SIGN = Array.from({ length: 8 }, (_, l) => [
  (l & 1) * 2 - 1,
  ((l >> 1) & 1) * 2 - 1,
  ((l >> 2) & 1) * 2 - 1,
]);

/** Shape-function gradients for a unit cube at natural coordinates (xi, eta, zeta). */
function gradients(xi: number, eta: number, zeta: number): number[][] {
  return SIGN.map(([sx, sy, sz]) => [
    0.25 * sx * (1 + sy * eta) * (1 + sz * zeta),
    0.25 * sy * (1 + sx * xi) * (1 + sz * zeta),
    0.25 * sz * (1 + sx * xi) * (1 + sy * eta),
  ]);
}

/** Element stiffness of a unit cube with unit Young's modulus (24 x 24, row-major). */
export function unitStiffness(nu: number): Float64Array {
  const lam = nu / ((1 + nu) * (1 - 2 * nu));
  const mu = 1 / (2 * (1 + nu));
  const K = new Float64Array(576);
  const detJ = 1 / 8;
  // Normal strains: full 2 x 2 x 2 integration.
  for (const a of [-GAUSS, GAUSS]) {
    for (const b of [-GAUSS, GAUSS]) {
      for (const c of [-GAUSS, GAUSS]) {
        const g = gradients(a, b, c);
        for (let l = 0; l < 8; l++) {
          for (let m = 0; m < 8; m++) {
            for (let r = 0; r < 3; r++) {
              for (let s = 0; s < 3; s++) {
                const d = r === s ? lam + 2 * mu : lam;
                K[(3 * l + r) * 24 + 3 * m + s] += detJ * g[l][r] * d * g[m][s];
              }
            }
          }
        }
      }
    }
  }
  // Shear strains: two points along the axis normal to the shear plane.
  const shear: [number, number, number][] = [
    [0, 1, 2], // gamma_xy sampled along z
    [1, 2, 0], // gamma_yz sampled along x
    [2, 0, 1], // gamma_zx sampled along y
  ];
  for (const [p, q, axis] of shear) {
    for (const t of [-GAUSS, GAUSS]) {
      const pt = [0, 0, 0];
      pt[axis] = t;
      const g = gradients(pt[0], pt[1], pt[2]);
      // gamma_pq = du_p/dq + du_q/dp
      const row = new Float64Array(24);
      for (let l = 0; l < 8; l++) {
        row[3 * l + p] = g[l][q];
        row[3 * l + q] = g[l][p];
      }
      for (let i = 0; i < 24; i++) {
        if (row[i] === 0) {
          continue;
        }
        for (let j = 0; j < 24; j++) {
          K[i * 24 + j] += 4 * detJ * mu * row[i] * row[j];
        }
      }
    }
  }
  return K;
}

/**
 * Fill a grid from a closed triangle mesh by counting crossings along z.
 *
 * Each cell is crossed by SUBSAMPLES^2 rays and the covered length along each
 * ray is measured exactly, so a cell cut by the surface gets a fill fraction
 * instead of an all-or-nothing vote. The solver scales such a
 * cell's stiffness by its fraction. Without this a wall a few cells thick is
 * modelled half a cell too thick or too thin depending on where the grid
 * happens to fall, and bending stiffness (which goes with thickness cubed)
 * swings by tens of percent between grid sizes.
 */
export function voxelize(
  positions: Float32Array,
  indices: Uint32Array,
  h: number,
): VoxelGrid {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], positions[i + a]);
      max[a] = Math.max(max[a], positions[i + a]);
    }
  }
  const nx = Math.max(1, Math.ceil((max[0] - min[0]) / h - 1e-6));
  const ny = Math.max(1, Math.ceil((max[1] - min[1]) / h - 1e-6));
  const nz = Math.max(1, Math.ceil((max[2] - min[2]) / h - 1e-6));
  const S = SUBSAMPLES;
  const fx = nx * S;
  const fy = ny * S;
  const hf = h / S;
  // Covered length along z, summed over the rays of each cell.
  const cover = new Float32Array(nx * ny * nz);
  // Rays are nudged off the sub-cell centres so one never runs along an edge.
  const jx = 0.5 + 0.000371;
  const jy = 0.5 + 0.000613;
  const hits: number[][] = Array.from({ length: fx * fy }, () => []);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 1e-14) {
      continue;
    }
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - min[0]) / hf - jx));
    const i1 = Math.min(fx - 1, Math.ceil((Math.max(ax, bx, cx) - min[0]) / hf - jx));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - min[1]) / hf - jy));
    const j1 = Math.min(fy - 1, Math.ceil((Math.max(ay, by, cy) - min[1]) / hf - jy));
    for (let j = j0; j <= j1; j++) {
      const py = min[1] + (j + jy) * hf;
      for (let i = i0; i <= i1; i++) {
        const px = min[0] + (i + jx) * hf;
        const u = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) / det;
        const v = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / det;
        if (u < 0 || v < 0 || u + v > 1) {
          continue;
        }
        hits[i + fx * j].push(az + u * (bz - az) + v * (cz - az));
      }
    }
  }
  for (let j = 0; j < fy; j++) {
    const cj = Math.floor(j / S);
    for (let i = 0; i < fx; i++) {
      const col = hits[i + fx * j];
      if (col.length < 2) {
        continue;
      }
      col.sort((p, q) => p - q);
      const ci = Math.floor(i / S);
      for (let seg = 0; seg + 1 < col.length; seg += 2) {
        // The ray is inside the solid from col[seg] to col[seg + 1]: exact along z.
        const z0 = (col[seg] - min[2]) / h;
        const z1 = (col[seg + 1] - min[2]) / h;
        const k0 = Math.max(0, Math.floor(z0));
        const k1 = Math.min(nz - 1, Math.floor(z1 - 1e-9));
        for (let k = k0; k <= k1; k++) {
          const len = Math.min(z1, k + 1) - Math.max(z0, k);
          if (len > 0) {
            cover[ci + nx * (cj + ny * k)] += len;
          }
        }
      }
    }
  }
  const rays = S * S;
  const solid = new Uint8Array(cover.length);
  const fraction = new Float32Array(cover.length);
  for (let c = 0; c < cover.length; c++) {
    const f = Math.min(1, cover[c] / rays);
    if (f >= MIN_FRACTION) {
      solid[c] = 1;
      fraction[c] = f;
    }
  }
  return { nx, ny, nz, h, origin: min, solid, fraction };
}

function inRegion(r: LoadRegion, x: number, y: number, z: number, pad: number): boolean {
  if (r.kind === 'box') {
    return (
      x >= r.min[0] - pad && x <= r.max[0] + pad &&
      y >= r.min[1] - pad && y <= r.max[1] + pad &&
      z >= r.min[2] - pad && z <= r.max[2] + pad
    );
  }
  if (r.kind === 'ringY') {
    const rad = Math.hypot(x, z);
    return rad >= r.rMin - pad && rad <= r.rMax + pad && y >= r.y0 - pad && y <= r.y1 + pad;
  }
  return Math.hypot(x - r.c[0], y - r.c[1], z - r.c[2]) <= r.r + pad;
}

export interface SolveStats {
  elements: number;
  dofs: number;
  iterations: number;
  residual: number;
  converged: boolean;
}

/** The assembled voxel model: geometry, numbering, matrix and solver. */
export class VoxelModel {
  readonly grid: VoxelGrid;
  readonly nodeCount: number;
  readonly elementCount: number;
  /** Grid node index -> active node id, or -1. */
  readonly nodeId: Int32Array;
  /** Active node id -> grid node index. */
  readonly nodeGrid: Int32Array;
  /** Element id -> cell index. */
  readonly elementCell: Int32Array;
  /** Element id -> its 8 active node ids. */
  readonly elementNodes: Int32Array;
  /** Element id -> share of the cell that is material. */
  readonly elementFill: Float32Array;
  private readonly neighbours: Int32Array;
  private readonly A: Float32Array;
  private readonly unitK: Float64Array;
  private readonly invDiag: Float64Array;
  private readonly fixed: Uint8Array;
  readonly nu: number;

  constructor(grid: VoxelGrid, nu: number) {
    this.grid = grid;
    this.nu = nu;
    const { nx, ny, nz, solid } = grid;
    const sx = nx + 1;
    const sy = ny + 1;
    const total = sx * sy * (nz + 1);
    this.nodeId = new Int32Array(total).fill(-1);
    let elements = 0;
    for (let c = 0; c < solid.length; c++) {
      elements += solid[c];
    }
    if (elements === 0) {
      throw new SpecError('the part is thinner than one cell of the stress grid');
    }
    this.elementCount = elements;
    this.elementCell = new Int32Array(elements);
    this.elementNodes = new Int32Array(elements * 8);
    this.elementFill = new Float32Array(elements);
    const gridNodes: number[] = [];
    let e = 0;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const cell = i + nx * (j + ny * k);
          if (!solid[cell]) {
            continue;
          }
          this.elementCell[e] = cell;
          this.elementFill[e] = grid.fraction[cell];
          for (let l = 0; l < 8; l++) {
            const g = i + (l & 1) + sx * (j + ((l >> 1) & 1) + sy * (k + ((l >> 2) & 1)));
            let id = this.nodeId[g];
            if (id < 0) {
              id = gridNodes.length;
              this.nodeId[g] = id;
              gridNodes.push(g);
            }
            this.elementNodes[e * 8 + l] = id;
          }
          e++;
        }
      }
    }
    this.nodeCount = gridNodes.length;
    this.nodeGrid = Int32Array.from(gridNodes);
    this.neighbours = new Int32Array(this.nodeCount * 27).fill(-1);
    for (let n = 0; n < this.nodeCount; n++) {
      const g = this.nodeGrid[n];
      const i = g % sx;
      const j = Math.floor(g / sx) % sy;
      const k = Math.floor(g / (sx * sy));
      for (let dk = -1; dk <= 1; dk++) {
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            const jj = j + dj;
            const kk = k + dk;
            if (ii < 0 || jj < 0 || kk < 0 || ii > nx || jj > ny || kk > nz) {
              continue;
            }
            this.neighbours[n * 27 + (di + 1) + 3 * (dj + 1) + 9 * (dk + 1)] =
              this.nodeId[ii + sx * (jj + sy * kk)];
          }
        }
      }
    }
    this.A = new Float32Array(this.nodeCount * 243);
    this.unitK = unitStiffness(nu);
    this.invDiag = new Float64Array(this.nodeCount * 9);
    this.fixed = new Uint8Array(this.nodeCount);
  }

  nodePosition(n: number, out: Vec3): Vec3 {
    const { nx, ny, h, origin } = this.grid;
    const sx = nx + 1;
    const sy = ny + 1;
    const g = this.nodeGrid[n];
    out[0] = origin[0] + (g % sx) * h;
    out[1] = origin[1] + (Math.floor(g / sx) % sy) * h;
    out[2] = origin[2] + Math.floor(g / (sx * sy)) * h;
    return out;
  }

  /** True when the node touches at least one empty cell (it lies on the surface). */
  private onSurface(n: number): boolean {
    const { nx, ny, nz, solid } = this.grid;
    const sx = nx + 1;
    const sy = ny + 1;
    const g = this.nodeGrid[n];
    const i = g % sx;
    const j = Math.floor(g / sx) % sy;
    const k = Math.floor(g / (sx * sy));
    for (let l = 0; l < 8; l++) {
      const ci = i - (l & 1);
      const cj = j - ((l >> 1) & 1);
      const ck = k - ((l >> 2) & 1);
      if (ci < 0 || cj < 0 || ck < 0 || ci >= nx || cj >= ny || ck >= nz) {
        return true;
      }
      if (!solid[ci + nx * (cj + ny * ck)]) {
        return true;
      }
    }
    return false;
  }

  /** Active nodes inside any of the regions (grown by half a cell). */
  select(regions: LoadRegion[], surfaceOnly = false): number[] {
    const pad = this.grid.h * 0.5;
    const p: Vec3 = [0, 0, 0];
    const out: number[] = [];
    for (let n = 0; n < this.nodeCount; n++) {
      this.nodePosition(n, p);
      if (regions.some((r) => inRegion(r, p[0], p[1], p[2], pad))) {
        if (!surfaceOnly || this.onSurface(n)) {
          out.push(n);
        }
      }
    }
    return out;
  }

  /** Mask of the given nodes plus every node that shares a cell with one of them. */
  ringAround(nodes: number[]): Uint8Array {
    const mask = new Uint8Array(this.nodeCount);
    for (const n of nodes) {
      mask[n] = 1;
      for (let o = 0; o < 27; o++) {
        const m = this.neighbours[n * 27 + o];
        if (m >= 0) {
          mask[m] = 1;
        }
      }
    }
    return mask;
  }

  setFixed(nodes: number[]): void {
    this.fixed.fill(0);
    for (const n of nodes) {
      this.fixed[n] = 1;
    }
  }

  /**
   * Assemble the matrix. `modulus` gives Young's modulus per element (MPa);
   * a single number applies to all.
   */
  assemble(modulus: number | Float32Array): void {
    const { A, elementNodes, unitK } = this;
    const h = this.grid.h;
    A.fill(0);
    for (let e = 0; e < this.elementCount; e++) {
      const scale = (typeof modulus === 'number' ? modulus : modulus[e]) * h;
      for (let l = 0; l < 8; l++) {
        const row = elementNodes[e * 8 + l];
        for (let m = 0; m < 8; m++) {
          const o =
            ((m & 1) - (l & 1) + 1) +
            3 * (((m >> 1) & 1) - ((l >> 1) & 1) + 1) +
            9 * (((m >> 2) & 1) - ((l >> 2) & 1) + 1);
          const base = (row * 27 + o) * 9;
          const kb = 3 * l * 24 + 3 * m;
          A[base] += scale * unitK[kb];
          A[base + 1] += scale * unitK[kb + 1];
          A[base + 2] += scale * unitK[kb + 2];
          A[base + 3] += scale * unitK[kb + 24];
          A[base + 4] += scale * unitK[kb + 25];
          A[base + 5] += scale * unitK[kb + 26];
          A[base + 6] += scale * unitK[kb + 48];
          A[base + 7] += scale * unitK[kb + 49];
          A[base + 8] += scale * unitK[kb + 50];
        }
      }
    }
    // Inverse of each node's own 3 x 3 block, for the preconditioner.
    const inv = this.invDiag;
    for (let n = 0; n < this.nodeCount; n++) {
      const b = (n * 27 + 13) * 9;
      const a = A[b], bb = A[b + 1], c = A[b + 2];
      const d = A[b + 3], ee = A[b + 4], f = A[b + 5];
      const g = A[b + 6], hh = A[b + 7], i = A[b + 8];
      const co0 = ee * i - f * hh;
      const co1 = f * g - d * i;
      const co2 = d * hh - ee * g;
      const det = a * co0 + bb * co1 + c * co2;
      const s = det !== 0 ? 1 / det : 0;
      const t = n * 9;
      inv[t] = co0 * s;
      inv[t + 1] = (c * hh - bb * i) * s;
      inv[t + 2] = (bb * f - c * ee) * s;
      inv[t + 3] = co1 * s;
      inv[t + 4] = (a * i - c * g) * s;
      inv[t + 5] = (c * d - a * f) * s;
      inv[t + 6] = co2 * s;
      inv[t + 7] = (bb * g - a * hh) * s;
      inv[t + 8] = (a * ee - bb * d) * s;
    }
  }

  private multiply(x: Float64Array, y: Float64Array): void {
    const { A, neighbours, fixed } = this;
    for (let n = 0; n < this.nodeCount; n++) {
      if (fixed[n]) {
        y[3 * n] = 0;
        y[3 * n + 1] = 0;
        y[3 * n + 2] = 0;
        continue;
      }
      let y0 = 0;
      let y1 = 0;
      let y2 = 0;
      const row = n * 27;
      for (let o = 0; o < 27; o++) {
        const m = neighbours[row + o];
        if (m < 0 || fixed[m]) {
          continue;
        }
        const a = (row + o) * 9;
        const x0 = x[3 * m];
        const x1 = x[3 * m + 1];
        const x2 = x[3 * m + 2];
        y0 += A[a] * x0 + A[a + 1] * x1 + A[a + 2] * x2;
        y1 += A[a + 3] * x0 + A[a + 4] * x1 + A[a + 5] * x2;
        y2 += A[a + 6] * x0 + A[a + 7] * x1 + A[a + 8] * x2;
      }
      y[3 * n] = y0;
      y[3 * n + 1] = y1;
      y[3 * n + 2] = y2;
    }
  }

  private precondition(r: Float64Array, z: Float64Array): void {
    const inv = this.invDiag;
    for (let n = 0; n < this.nodeCount; n++) {
      const t = n * 9;
      const r0 = r[3 * n];
      const r1 = r[3 * n + 1];
      const r2 = r[3 * n + 2];
      z[3 * n] = inv[t] * r0 + inv[t + 1] * r1 + inv[t + 2] * r2;
      z[3 * n + 1] = inv[t + 3] * r0 + inv[t + 4] * r1 + inv[t + 5] * r2;
      z[3 * n + 2] = inv[t + 6] * r0 + inv[t + 7] * r1 + inv[t + 8] * r2;
    }
  }

  /**
   * Solve K u = f by preconditioned conjugate gradients. `u` holds the start
   * vector on entry (zeros, or the previous solution as a warm start) and the
   * solution on return.
   */
  solve(
    f: Float64Array,
    u: Float64Array,
    tol: number,
    maxIter: number,
    onProgress?: (iteration: number, residual: number) => void,
  ): SolveStats {
    const n3 = this.nodeCount * 3;
    const r = new Float64Array(n3);
    const z = new Float64Array(n3);
    const p = new Float64Array(n3);
    const q = new Float64Array(n3);
    const { fixed } = this;
    let bNorm = 0;
    for (let n = 0; n < this.nodeCount; n++) {
      if (fixed[n]) {
        u[3 * n] = u[3 * n + 1] = u[3 * n + 2] = 0;
        continue;
      }
      bNorm += f[3 * n] ** 2 + f[3 * n + 1] ** 2 + f[3 * n + 2] ** 2;
    }
    bNorm = Math.sqrt(bNorm);
    const stats: SolveStats = {
      elements: this.elementCount,
      dofs: n3,
      iterations: 0,
      residual: 0,
      converged: true,
    };
    if (bNorm === 0) {
      u.fill(0);
      return stats;
    }
    this.multiply(u, q);
    for (let i = 0; i < n3; i++) {
      r[i] = fixed[(i / 3) | 0] ? 0 : f[i] - q[i];
    }
    this.precondition(r, z);
    p.set(z);
    let rz = 0;
    for (let i = 0; i < n3; i++) {
      rz += r[i] * z[i];
    }
    let res = 1;
    for (let it = 1; it <= maxIter; it++) {
      let rNorm = 0;
      for (let i = 0; i < n3; i++) {
        rNorm += r[i] * r[i];
      }
      res = Math.sqrt(rNorm) / bNorm;
      if (res <= tol) {
        break;
      }
      this.multiply(p, q);
      let pq = 0;
      for (let i = 0; i < n3; i++) {
        pq += p[i] * q[i];
      }
      if (!(pq > 0)) {
        stats.converged = false;
        break;
      }
      const alpha = rz / pq;
      for (let i = 0; i < n3; i++) {
        u[i] += alpha * p[i];
        r[i] -= alpha * q[i];
      }
      this.precondition(r, z);
      let rzNext = 0;
      for (let i = 0; i < n3; i++) {
        rzNext += r[i] * z[i];
      }
      const beta = rzNext / rz;
      rz = rzNext;
      for (let i = 0; i < n3; i++) {
        p[i] = z[i] + beta * p[i];
      }
      stats.iterations = it;
      if (onProgress && it % 25 === 0) {
        onProgress(it, res);
      }
    }
    stats.residual = res;
    if (res > tol) {
      stats.converged = false;
    }
    return stats;
  }

  /** u^T K_unit u per element, with K_unit for unit modulus (used for sensitivities). */
  elementEnergy(u: Float64Array, out: Float32Array): void {
    const { elementNodes, unitK } = this;
    const h = this.grid.h;
    const ue = new Float64Array(24);
    for (let e = 0; e < this.elementCount; e++) {
      for (let l = 0; l < 8; l++) {
        const n = elementNodes[e * 8 + l] * 3;
        ue[3 * l] = u[n];
        ue[3 * l + 1] = u[n + 1];
        ue[3 * l + 2] = u[n + 2];
      }
      let s = 0;
      for (let i = 0; i < 24; i++) {
        let row = 0;
        const k = i * 24;
        for (let j = 0; j < 24; j++) {
          row += unitK[k + j] * ue[j];
        }
        s += ue[i] * row;
      }
      out[e] = s * h;
    }
  }

  /**
   * Von Mises stress at each node (MPa). Strains are evaluated at the element
   * corners with the same assumed shear field the stiffness uses, stresses are
   * averaged over the elements sharing a node, and von Mises is taken of the
   * averaged tensor. Corner evaluation matters: a centre value would under-read
   * the outer fibre of a bending member by half a cell.
   */
  nodalVonMises(u: Float64Array, modulus: number | Float32Array): Float32Array {
    const { elementNodes, nu } = this;
    const inv = 1 / this.grid.h;
    const lamU = nu / ((1 + nu) * (1 - 2 * nu));
    const muU = 1 / (2 * (1 + nu));
    // Per corner: gradients for the normal strains and for each shear component.
    const corner = SIGN.map(([sx, sy, sz]) => ({
      n: gradients(sx, sy, sz),
      xy: gradients(0, 0, sz),
      yz: gradients(sx, 0, 0),
      zx: gradients(0, sy, 0),
    }));
    const acc = new Float64Array(this.nodeCount * 6);
    const counts = new Uint16Array(this.nodeCount);
    const ue = new Float64Array(24);
    for (let e = 0; e < this.elementCount; e++) {
      for (let l = 0; l < 8; l++) {
        const n = elementNodes[e * 8 + l] * 3;
        ue[3 * l] = u[n];
        ue[3 * l + 1] = u[n + 1];
        ue[3 * l + 2] = u[n + 2];
      }
      const E = typeof modulus === 'number' ? modulus : modulus[e];
      const lam = lamU * E;
      const mu = muU * E;
      for (let c = 0; c < 8; c++) {
        const g = corner[c];
        let exx = 0, eyy = 0, ezz = 0, gxy = 0, gyz = 0, gzx = 0;
        for (let l = 0; l < 8; l++) {
          const ux = ue[3 * l], uy = ue[3 * l + 1], uz = ue[3 * l + 2];
          exx += g.n[l][0] * ux;
          eyy += g.n[l][1] * uy;
          ezz += g.n[l][2] * uz;
          gxy += g.xy[l][1] * ux + g.xy[l][0] * uy;
          gyz += g.yz[l][2] * uy + g.yz[l][1] * uz;
          gzx += g.zx[l][2] * ux + g.zx[l][0] * uz;
        }
        const tr = (exx + eyy + ezz) * inv;
        const node = elementNodes[e * 8 + c];
        const a = node * 6;
        acc[a] += lam * tr + 2 * mu * exx * inv;
        acc[a + 1] += lam * tr + 2 * mu * eyy * inv;
        acc[a + 2] += lam * tr + 2 * mu * ezz * inv;
        acc[a + 3] += mu * gxy * inv;
        acc[a + 4] += mu * gyz * inv;
        acc[a + 5] += mu * gzx * inv;
        counts[node]++;
      }
    }
    const out = new Float32Array(this.nodeCount);
    for (let n = 0; n < this.nodeCount; n++) {
      const k = 1 / counts[n];
      const a = n * 6;
      const sx = acc[a] * k, sy = acc[a + 1] * k, sz = acc[a + 2] * k;
      const txy = acc[a + 3] * k, tyz = acc[a + 4] * k, tzx = acc[a + 5] * k;
      out[n] = Math.sqrt(
        0.5 * ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) +
          3 * (txy * txy + tyz * tyz + tzx * tzx),
      );
    }
    return out;
  }
}

/** Fewest cells through the wall the manufacturing agent watches. */
export const MIN_CELLS_PER_WALL = 3;

/**
 * Pick the cell size: about `target` elements. When the part has a named wall,
 * the cell is an exact fraction of its thickness (at least three cells), so
 * that wall is represented without partly filled cells; a bending wall with
 * fewer than three cells through it reads up to 20 % too stiff.
 */
export function chooseCellSize(
  volume: number,
  target: number,
  wallHint?: number,
  maxElements = 16000,
): number {
  let h = Math.cbrt(volume / target);
  if (wallHint && wallHint > 0) {
    const cells = Math.max(MIN_CELLS_PER_WALL, Math.ceil(wallHint / h - 1e-9));
    h = wallHint / cells;
  }
  return Math.max(h, Math.cbrt(volume / maxElements));
}

/** Keep only the material connected (through cell faces) to the given seed cells. */
function keepConnected(grid: VoxelGrid, seeds: number[]): number {
  const { nx, ny, nz, solid } = grid;
  const mark = new Uint8Array(solid.length);
  const stack: number[] = [];
  for (const s of seeds) {
    if (solid[s] && !mark[s]) {
      mark[s] = 1;
      stack.push(s);
    }
  }
  while (stack.length) {
    const c = stack.pop() as number;
    const i = c % nx;
    const j = Math.floor(c / nx) % ny;
    const k = Math.floor(c / (nx * ny));
    const visit = (ii: number, jj: number, kk: number): void => {
      if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) {
        return;
      }
      const d = ii + nx * (jj + ny * kk);
      if (solid[d] && !mark[d]) {
        mark[d] = 1;
        stack.push(d);
      }
    };
    visit(i - 1, j, k);
    visit(i + 1, j, k);
    visit(i, j - 1, k);
    visit(i, j + 1, k);
    visit(i, j, k - 1);
    visit(i, j, k + 1);
  }
  let dropped = 0;
  for (let c = 0; c < solid.length; c++) {
    if (solid[c] && !mark[c]) {
      solid[c] = 0;
      grid.fraction[c] = 0;
      dropped++;
    }
  }
  return dropped;
}

export interface FeaSetup {
  positions: Float32Array;
  indices: Uint32Array;
  /** Solid volume, mm3 (sizes the grid). */
  volume: number;
  E: number;
  nu: number;
  fixture: Region[];
  load: { region: LoadRegion; dir: Vec3; newtons: number; surfaceOnly?: boolean };
  wallHint?: number;
  targetElements?: number;
  tol?: number;
  /** Extra points (xyz, mm) at which to report stress and displacement. */
  probes?: Float32Array;
  onProgress?: (iteration: number, residual: number) => void;
}

export interface FeaResult {
  /** Displacement at each render vertex for the reference load, mm (xyz). */
  vertexDisp: Float32Array;
  /** Von Mises stress at each render vertex for the reference load, MPa. */
  vertexStress: Float32Array;
  /** The load the fields above belong to, N. Everything scales linearly with load. */
  newtons: number;
  maxDisp: number;
  stressMax: number;
  /** 99th percentile of nodal von Mises stress. */
  stressP99: number;
  /** Mean of the highest 0.5 % of nodal von Mises stress: the peak the app reports. */
  stressPeak: number;
  cell: number;
  loadedNodes: number;
  fixedNodes: number;
  /** Stress (MPa) and displacement (mm, xyz) at the requested probe points. */
  probeStress?: Float32Array;
  probeDisp?: Float32Array;
  stats: SolveStats;
  ms: number;
}

/** Spread values from active nodes to the rest of the grid, a layer per pass. */
export function dilate(values: Float64Array, width: number, known: Uint8Array, grid: VoxelGrid, passes: number): void {
  const sx = grid.nx + 1;
  const sy = grid.ny + 1;
  const sz = grid.nz + 1;
  for (let pass = 0; pass < passes; pass++) {
    const next: number[] = [];
    const acc: number[] = [];
    for (let k = 0; k < sz; k++) {
      for (let j = 0; j < sy; j++) {
        for (let i = 0; i < sx; i++) {
          const g = i + sx * (j + sy * k);
          if (known[g]) {
            continue;
          }
          let count = 0;
          const sum = new Array<number>(width).fill(0);
          for (let dk = -1; dk <= 1; dk++) {
            for (let dj = -1; dj <= 1; dj++) {
              for (let di = -1; di <= 1; di++) {
                const ii = i + di, jj = j + dj, kk = k + dk;
                if (ii < 0 || jj < 0 || kk < 0 || ii >= sx || jj >= sy || kk >= sz) {
                  continue;
                }
                const q = ii + sx * (jj + sy * kk);
                if (known[q]) {
                  count++;
                  for (let c = 0; c < width; c++) {
                    sum[c] += values[q * width + c];
                  }
                }
              }
            }
          }
          if (count > 0) {
            next.push(g);
            for (let c = 0; c < width; c++) {
              acc.push(sum[c] / count);
            }
          }
        }
      }
    }
    next.forEach((g, idx) => {
      known[g] = 1;
      for (let c = 0; c < width; c++) {
        values[g * width + c] = acc[idx * width + c];
      }
    });
    if (next.length === 0) {
      break;
    }
  }
}

export function sample(values: Float64Array, width: number, grid: VoxelGrid, x: number, y: number, z: number, out: number[]): void {
  const { nx, ny, nz, h, origin } = grid;
  const sx = nx + 1;
  const sy = ny + 1;
  const fx = Math.min(nx - 1e-9, Math.max(0, (x - origin[0]) / h));
  const fy = Math.min(ny - 1e-9, Math.max(0, (y - origin[1]) / h));
  const fz = Math.min(nz - 1e-9, Math.max(0, (z - origin[2]) / h));
  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
  const tx = fx - i, ty = fy - j, tz = fz - k;
  for (let c = 0; c < width; c++) {
    out[c] = 0;
  }
  for (let l = 0; l < 8; l++) {
    const a = l & 1, b = (l >> 1) & 1, d = (l >> 2) & 1;
    const w = (a ? tx : 1 - tx) * (b ? ty : 1 - ty) * (d ? tz : 1 - tz);
    const g = i + a + sx * (j + b + sy * (k + d));
    for (let c = 0; c < width; c++) {
      out[c] += w * values[g * width + c];
    }
  }
}

export interface PreparedModel {
  grid: VoxelGrid;
  model: VoxelModel;
  fixedNodes: number[];
  loadedNodes: number[];
  /** Load vector for the reference load. */
  f: Float64Array;
  cell: number;
}

/** Voxelise, drop material the fixture does not hold, number it, and build the load vector. */
export function prepareModel(
  setup: Pick<FeaSetup, 'positions' | 'indices' | 'volume' | 'nu' | 'fixture' | 'load' | 'wallHint' | 'targetElements'>,
  maxElements = 9000,
): PreparedModel {
  const h = chooseCellSize(setup.volume, setup.targetElements ?? 6000, setup.wallHint, maxElements);
  const grid = voxelize(setup.positions, setup.indices, h);

  // Material not connected to the fixture would float; drop it before numbering.
  const probe = new VoxelModel(grid, setup.nu);
  const fixedProbe = probe.select(setup.fixture);
  if (fixedProbe.length === 0) {
    throw new SpecError('the fixture touches no material: nothing holds the part');
  }
  const heldProbe = new Uint8Array(probe.nodeCount);
  fixedProbe.forEach((n) => (heldProbe[n] = 1));
  const seedCells: number[] = [];
  for (let e = 0; e < probe.elementCount; e++) {
    for (let l = 0; l < 8; l++) {
      if (heldProbe[probe.elementNodes[e * 8 + l]]) {
        seedCells.push(probe.elementCell[e]);
        break;
      }
    }
  }
  const dropped = keepConnected(grid, seedCells);
  const model = dropped > 0 ? new VoxelModel(grid, setup.nu) : probe;
  const fixedNodes = dropped > 0 ? model.select(setup.fixture) : fixedProbe;
  model.setFixed(fixedNodes);

  const isFixed = new Uint8Array(model.nodeCount);
  fixedNodes.forEach((n) => (isFixed[n] = 1));
  const loadedNodes = model
    .select([setup.load.region], setup.load.surfaceOnly ?? false)
    .filter((n) => !isFixed[n]);
  if (loadedNodes.length === 0) {
    throw new SpecError('the load touches no free material');
  }
  // Share the load by the material around each node, so a node that only
  // touches a nearly empty boundary cell carries almost none of it.
  const around = new Float32Array(model.nodeCount);
  for (let e = 0; e < model.elementCount; e++) {
    for (let l = 0; l < 8; l++) {
      around[model.elementNodes[e * 8 + l]] += model.elementFill[e];
    }
  }
  let weight = 0;
  for (const n of loadedNodes) {
    weight += around[n];
  }
  const f = new Float64Array(model.nodeCount * 3);
  for (const n of loadedNodes) {
    const share = (setup.load.newtons * around[n]) / weight;
    f[3 * n] += share * setup.load.dir[0];
    f[3 * n + 1] += share * setup.load.dir[1];
    f[3 * n + 2] += share * setup.load.dir[2];
  }
  return { grid, model, fixedNodes, loadedNodes, f, cell: h };
}

export function solveFea(setup: FeaSetup): FeaResult {
  const t0 = performance.now();
  const { grid, model, fixedNodes, loadedNodes: loaded, f, cell: h } = prepareModel(setup);

  // A partly filled cell carries its share of the stiffness.
  const modulus = new Float32Array(model.elementCount);
  for (let e = 0; e < model.elementCount; e++) {
    modulus[e] = setup.E * model.elementFill[e];
  }
  model.assemble(modulus);
  const u = new Float64Array(model.nodeCount * 3);
  const stats = model.solve(f, u, setup.tol ?? 1e-5, 6000, setup.onProgress);

  const nodeStress = model.nodalVonMises(u, setup.E);
  // Stress right under the applied forces is an artefact of how the load is
  // spread over nodes, so the loaded patch (and one ring around it) is left
  // out of the peak statistics. It is still shown in the colour map.
  const nearLoad = model.ringAround(loaded);
  const judged: number[] = [];
  for (let n = 0; n < model.nodeCount; n++) {
    if (!nearLoad[n]) {
      judged.push(nodeStress[n]);
    }
  }
  const sorted = Float32Array.from(judged.length ? judged : nodeStress).sort();
  const stressMax = sorted[sorted.length - 1];
  const stressP99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
  const top = Math.max(1, Math.round(sorted.length * 0.005));
  let topSum = 0;
  for (let i = sorted.length - top; i < sorted.length; i++) {
    topSum += sorted[i];
  }
  const stressPeak = topSum / top;

  // Node fields on the full grid, spread outwards so surface vertices can sample them.
  const total = (grid.nx + 1) * (grid.ny + 1) * (grid.nz + 1);
  const field = new Float64Array(total * 4);
  const known = new Uint8Array(total);
  for (let n = 0; n < model.nodeCount; n++) {
    const g = model.nodeGrid[n];
    field[g * 4] = u[3 * n];
    field[g * 4 + 1] = u[3 * n + 1];
    field[g * 4 + 2] = u[3 * n + 2];
    field[g * 4 + 3] = nodeStress[n];
    known[g] = 1;
  }
  dilate(field, 4, known, grid, 3);

  const nVert = setup.positions.length / 3;
  let maxDisp = 0;
  const vertexDisp = new Float32Array(nVert * 3);
  const vertexStress = new Float32Array(nVert);
  const tmp = [0, 0, 0, 0];
  for (let v = 0; v < nVert; v++) {
    sample(field, 4, grid, setup.positions[3 * v], setup.positions[3 * v + 1], setup.positions[3 * v + 2], tmp);
    vertexDisp[3 * v] = tmp[0];
    vertexDisp[3 * v + 1] = tmp[1];
    vertexDisp[3 * v + 2] = tmp[2];
    vertexStress[v] = tmp[3];
    // Deflection is read on the real surface, not on grid nodes that overhang it.
    maxDisp = Math.max(maxDisp, Math.hypot(tmp[0], tmp[1], tmp[2]));
  }

  let probeStress: Float32Array | undefined;
  let probeDisp: Float32Array | undefined;
  if (setup.probes) {
    const count = setup.probes.length / 3;
    probeStress = new Float32Array(count);
    probeDisp = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      sample(field, 4, grid, setup.probes[3 * v], setup.probes[3 * v + 1], setup.probes[3 * v + 2], tmp);
      probeDisp[3 * v] = tmp[0];
      probeDisp[3 * v + 1] = tmp[1];
      probeDisp[3 * v + 2] = tmp[2];
      probeStress[v] = tmp[3];
    }
  }

  return {
    vertexDisp,
    vertexStress,
    probeStress,
    probeDisp,
    newtons: setup.load.newtons,
    maxDisp,
    stressMax,
    stressP99,
    stressPeak,
    cell: h,
    loadedNodes: loaded.length,
    fixedNodes: fixedNodes.length,
    stats,
    ms: performance.now() - t0,
  };
}
