/**
 * Natural frequencies and mode shapes of the part as it is held by the job's
 * fixture: the headset's answer to "will it rattle or ring".
 *
 * Same voxel model as the stress solver (src/engine/fea.ts), with a lumped
 * mass matrix (each element's mass shared equally by its 8 nodes). The lowest
 * modes come from inverse iteration, each one kept M-orthogonal to the modes
 * already found, and the frequency is the Rayleigh quotient. Units: N, mm,
 * tonnes, so K u = lambda M u gives lambda in 1/s^2.
 *
 * Checked against the Euler-Bernoulli cantilever (tests/modal.test.ts).
 */

import { dilate, FeaSetup, prepareModel, sample } from './fea.js';

export interface ModalSetup extends Pick<FeaSetup, 'positions' | 'indices' | 'volume' | 'E' | 'nu' | 'fixture' | 'load' | 'wallHint' | 'targetElements'> {
  /** g/cm3 */
  density: number;
  modes?: number;
  onProgress?: (mode: number, iteration: number) => void;
}

export interface ModalResult {
  /** Hz, lowest first. */
  frequencies: number[];
  /** Per mode: displacement at each render vertex (xyz), scaled so the largest is 1. */
  shapes: Float32Array[];
  cell: number;
  elements: number;
  iterations: number[];
  ms: number;
}

const MAX_ITER = 30;
/** Stop when the frequency estimate moves less than this (relative, on lambda = omega^2). */
const REL_TOL = 1e-3;

export function solveModes(setup: ModalSetup): ModalResult {
  const t0 = performance.now();
  const { grid, model, cell: h } = prepareModel(setup);
  const modulus = new Float32Array(model.elementCount);
  for (let e = 0; e < model.elementCount; e++) modulus[e] = setup.E * model.elementFill[e];
  model.assemble(modulus);

  const n3 = model.nodeCount * 3;
  // Lumped mass per node, tonnes (g/cm3 -> t/mm3 is 1e-9).
  const mass = new Float64Array(model.nodeCount);
  const cellMass = setup.density * 1e-9 * h * h * h;
  for (let e = 0; e < model.elementCount; e++) {
    const share = (cellMass * model.elementFill[e]) / 8;
    for (let l = 0; l < 8; l++) mass[model.elementNodes[e * 8 + l]] += share;
  }
  const free = (i: number): boolean => !model.isFixed((i / 3) | 0);
  const mDot = (a: Float64Array, b: Float64Array): number => {
    let s = 0;
    for (let i = 0; i < n3; i++) if (free(i)) s += a[i] * mass[(i / 3) | 0] * b[i];
    return s;
  };
  const found: Float64Array[] = [];
  const orthogonalise = (x: Float64Array): void => {
    for (const v of found) {
      const c = mDot(v, x);
      for (let i = 0; i < n3; i++) x[i] -= c * v[i];
    }
  };
  const normalise = (x: Float64Array): void => {
    const s = 1 / Math.sqrt(mDot(x, x) || 1);
    for (let i = 0; i < n3; i++) x[i] = free(i) ? x[i] * s : 0;
  };

  const count = setup.modes ?? 3;
  const frequencies: number[] = [];
  const iterations: number[] = [];
  const kx = new Float64Array(n3);
  const y = new Float64Array(n3);
  for (let k = 0; k < count; k++) {
    // A deterministic start with some of every direction in it.
    let x = new Float64Array(n3);
    for (let i = 0; i < n3; i++) x[i] = free(i) ? Math.sin(0.37 * i + k) + 0.5 * Math.cos(0.11 * i * (k + 1)) : 0;
    orthogonalise(x);
    normalise(x);
    let lambda = 0;
    let it = 0;
    for (; it < MAX_ITER; it++) {
      for (let i = 0; i < n3; i++) y[i] = free(i) ? mass[(i / 3) | 0] * x[i] : 0;
      const next = x.slice();
      model.solve(y, next, 1e-6, 8000);
      orthogonalise(next);
      normalise(next);
      model.apply(next, kx);
      let num = 0;
      for (let i = 0; i < n3; i++) if (free(i)) num += next[i] * kx[i];
      const prev = lambda;
      lambda = num; // x is M-normalised, so x^T M x = 1
      x = next;
      setup.onProgress?.(k, it);
      if (prev > 0 && Math.abs(lambda - prev) / lambda < REL_TOL) break;
    }
    found.push(x);
    frequencies.push(Math.sqrt(Math.max(0, lambda)) / (2 * Math.PI));
    iterations.push(it + 1);
  }

  // Mode shapes at the render vertices, as for displacements in the stress solver.
  const total = (grid.nx + 1) * (grid.ny + 1) * (grid.nz + 1);
  const nVert = setup.positions.length / 3;
  const tmp = [0, 0, 0];
  const shapes = found.map((x) => {
    const field = new Float64Array(total * 3);
    const known = new Uint8Array(total);
    for (let n = 0; n < model.nodeCount; n++) {
      const g = model.nodeGrid[n];
      field[g * 3] = x[3 * n];
      field[g * 3 + 1] = x[3 * n + 1];
      field[g * 3 + 2] = x[3 * n + 2];
      known[g] = 1;
    }
    dilate(field, 3, known, grid, 3);
    const out = new Float32Array(nVert * 3);
    let peak = 0;
    for (let v = 0; v < nVert; v++) {
      sample(field, 3, grid, setup.positions[v * 3], setup.positions[v * 3 + 1], setup.positions[v * 3 + 2], tmp);
      out[v * 3] = tmp[0];
      out[v * 3 + 1] = tmp[1];
      out[v * 3 + 2] = tmp[2];
      peak = Math.max(peak, Math.hypot(tmp[0], tmp[1], tmp[2]));
    }
    if (peak > 0) for (let i = 0; i < out.length; i++) out[i] /= peak;
    return out;
  });
  return { frequencies, shapes, cell: h, elements: model.elementCount, iterations, ms: performance.now() - t0 };
}
