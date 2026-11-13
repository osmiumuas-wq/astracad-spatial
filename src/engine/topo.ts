/**
 * Topology optimisation ("living bone"): remove the material that carries the
 * least load, a little at a time, until a target fraction of the part is left.
 *
 * Method: SIMP with penalty 3, a sensitivity filter against checkerboards, and
 * the optimality-criteria update, on the same voxel model the stress preview
 * uses. Every iteration is a full finite-element solve (warm-started from the
 * previous one), so the density field can be shown while it evolves.
 */

import { dilate, FeaSetup, prepareModel, sample, VoxelGrid } from './fea.js';

export interface TopoSetup
  extends Pick<FeaSetup, 'positions' | 'indices' | 'volume' | 'E' | 'nu' | 'fixture' | 'load' | 'wallHint'> {
  /** Fraction of the material to keep, 0.25 to 0.9. */
  keep: number;
  iterations?: number;
  targetElements?: number;
  /** Called after every iteration; return false to stop early. */
  onIteration?: (info: TopoIteration) => boolean | void;
}

export interface TopoIteration {
  iteration: number;
  /** Work done by the load (N mm): lower is stiffer. */
  compliance: number;
  /** Largest density change in this iteration. */
  change: number;
  field: DensityField;
}

/** Density on the grid nodes, spread a few cells past the part so it can be iso-surfaced. */
export interface DensityField {
  grid: Pick<VoxelGrid, 'nx' | 'ny' | 'nz' | 'h' | 'origin'>;
  values: Float32Array;
}

export interface TopoResult {
  iterations: number;
  complianceStart: number;
  compliance: number;
  elements: number;
  cell: number;
  field: DensityField;
  ms: number;
}

const PENALTY = 3;
const MOVE = 0.2;
const E_MIN_RATIO = 1e-3;
const FILTER_RADIUS = 1.6;

/** Signed value for the iso-surface: positive where material stays. */
export function fieldSampler(field: DensityField): (p: [number, number, number]) => number {
  const { grid, values } = field;
  const wide = new Float64Array(values);
  const tmp = [0];
  const g = { ...grid, solid: new Uint8Array(0) } as VoxelGrid;
  const max = [
    grid.origin[0] + grid.nx * grid.h,
    grid.origin[1] + grid.ny * grid.h,
    grid.origin[2] + grid.nz * grid.h,
  ];
  return (p) => {
    if (
      p[0] < grid.origin[0] || p[1] < grid.origin[1] || p[2] < grid.origin[2] ||
      p[0] > max[0] || p[1] > max[1] || p[2] > max[2]
    ) {
      // Outside the grid the part does not exist; the base solid trims it anyway.
      return 0.5;
    }
    sample(wide, 1, g, p[0], p[1], p[2], tmp);
    return tmp[0] - 0.5;
  };
}

export function optimise(setup: TopoSetup): TopoResult {
  const t0 = performance.now();
  const keep = Math.min(0.9, Math.max(0.25, setup.keep));
  const prepared = prepareModel(
    { ...setup, targetElements: setup.targetElements ?? 3500 },
    9000,
  );
  const { grid, model, fixedNodes, loadedNodes, f } = prepared;
  const n = model.elementCount;
  const { nx, ny, nz } = grid;

  const cellElement = new Int32Array(nx * ny * nz).fill(-1);
  for (let e = 0; e < n; e++) {
    cellElement[model.elementCell[e]] = e;
  }

  // Elements that hold the fixture or take the load stay solid.
  const pinned = new Uint8Array(model.nodeCount);
  fixedNodes.forEach((v) => (pinned[v] = 1));
  loadedNodes.forEach((v) => (pinned[v] = 1));
  const passive = new Uint8Array(n);
  for (let e = 0; e < n; e++) {
    for (let l = 0; l < 8; l++) {
      if (pinned[model.elementNodes[e * 8 + l]]) {
        passive[e] = 1;
        break;
      }
    }
  }

  // Filter stencil: neighbours within FILTER_RADIUS cells, weight falling linearly.
  const stencil: { di: number; dj: number; dk: number; w: number }[] = [];
  for (let dk = -1; dk <= 1; dk++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const w = FILTER_RADIUS - Math.hypot(di, dj, dk);
        if (w > 0) {
          stencil.push({ di, dj, dk, w });
        }
      }
    }
  }

  const fill = model.elementFill;
  // Material available to the optimiser, counted in whole cells.
  let designFill = 0;
  for (let e = 0; e < n; e++) {
    designFill += passive[e] ? 0 : fill[e];
  }
  const rho = new Float32Array(n);
  for (let e = 0; e < n; e++) {
    rho[e] = passive[e] ? 1 : keep;
  }
  const modulus = new Float32Array(n);
  const energy = new Float32Array(n);
  const dc = new Float32Array(n);
  const dcf = new Float32Array(n);
  const next = new Float32Array(n);
  const u = new Float64Array(model.nodeCount * 3);
  const eMin = setup.E * E_MIN_RATIO;
  const iterations = setup.iterations ?? 32;

  const buildField = (): DensityField => {
    const sx = nx + 1;
    const sy = ny + 1;
    const total = sx * sy * (nz + 1);
    const sum = new Float64Array(total);
    const count = new Uint8Array(total);
    for (let e = 0; e < n; e++) {
      const cell = model.elementCell[e];
      const i = cell % nx;
      const j = Math.floor(cell / nx) % ny;
      const k = Math.floor(cell / (nx * ny));
      for (let l = 0; l < 8; l++) {
        const g = i + (l & 1) + sx * (j + ((l >> 1) & 1) + sy * (k + ((l >> 2) & 1)));
        sum[g] += rho[e];
        count[g]++;
      }
    }
    const known = new Uint8Array(total);
    for (let g = 0; g < total; g++) {
      if (count[g]) {
        sum[g] /= count[g];
        known[g] = 1;
      }
    }
    // Carry the surface value outwards so the iso-surface leaves the part cleanly.
    dilate(sum, 1, known, grid, 3);
    return {
      grid: { nx, ny, nz, h: grid.h, origin: grid.origin },
      values: Float32Array.from(sum),
    };
  };

  let compliance = 0;
  let complianceStart = 0;
  let done = 0;
  for (let it = 1; it <= iterations; it++) {
    for (let e = 0; e < n; e++) {
      modulus[e] = (eMin + Math.pow(rho[e], PENALTY) * (setup.E - eMin)) * fill[e];
    }
    model.assemble(modulus);
    model.solve(f, u, 1e-4, 600);
    model.elementEnergy(u, energy);
    compliance = 0;
    for (let e = 0; e < n; e++) {
      compliance += modulus[e] * energy[e];
      dc[e] = -PENALTY * Math.pow(rho[e], PENALTY - 1) * (setup.E - eMin) * fill[e] * energy[e];
    }
    if (it === 1) {
      complianceStart = compliance;
    }

    // Sensitivity filter.
    for (let e = 0; e < n; e++) {
      const cell = model.elementCell[e];
      const i = cell % nx;
      const j = Math.floor(cell / nx) % ny;
      const k = Math.floor(cell / (nx * ny));
      let num = 0;
      let den = 0;
      for (const s of stencil) {
        const ii = i + s.di;
        const jj = j + s.dj;
        const kk = k + s.dk;
        if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) {
          continue;
        }
        const o = cellElement[ii + nx * (jj + ny * kk)];
        if (o < 0) {
          continue;
        }
        num += s.w * rho[o] * dc[o];
        den += s.w;
      }
      dcf[e] = num / (Math.max(1e-3, rho[e]) * den);
    }

    // Optimality-criteria update, bisecting on the volume multiplier.
    let lo = 0;
    let hi = 1e12;
    let change = 0;
    for (let b = 0; b < 80 && hi - lo > 1e-9 * (lo + hi); b++) {
      const mid = 0.5 * (lo + hi);
      let total = 0;
      for (let e = 0; e < n; e++) {
        if (passive[e]) {
          next[e] = 1;
          continue;
        }
        const target = rho[e] * Math.sqrt(Math.max(0, -dcf[e]) / mid);
        const v = Math.min(1, rho[e] + MOVE, Math.max(0.001, rho[e] - MOVE, target));
        next[e] = v;
        total += v * fill[e];
      }
      if (total > keep * designFill) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    for (let e = 0; e < n; e++) {
      change = Math.max(change, Math.abs(next[e] - rho[e]));
      rho[e] = next[e];
    }
    done = it;
    const cont = setup.onIteration?.({ iteration: it, compliance, change, field: buildField() });
    if (cont === false || change < 0.01) {
      break;
    }
  }

  return {
    iterations: done,
    complianceStart,
    compliance,
    elements: n,
    cell: grid.h,
    field: buildField(),
    ms: performance.now() - t0,
  };
}
