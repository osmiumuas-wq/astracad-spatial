import { beforeAll, describe, expect, it } from 'vitest';
import { solveFea, unitStiffness } from '../src/engine/fea.js';
import { defaultParams, JOBS } from '../src/engine/jobs.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { materialById } from '../src/engine/materials.js';
import { PartSpec } from '../src/engine/types.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

/** Eigenvalues of a symmetric matrix by cyclic Jacobi rotations. */
function eigenvalues(input: Float64Array, n: number): number[] {
  const a = Float64Array.from(input);
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        off += a[p * n + q] ** 2;
      }
    }
    if (off < 1e-24) {
      break;
    }
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (Math.abs(apq) < 1e-300) {
          continue;
        }
        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p];
          const akq = a[k * n + q];
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k];
          const aqk = a[q * n + k];
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
      }
    }
  }
  return Array.from({ length: n }, (_, i) => a[i * n + i]).sort((x, y) => x - y);
}

describe('brick element', () => {
  it('is symmetric and has exactly six zero-energy (rigid body) modes', () => {
    for (const nu of [0, 0.3, 0.38]) {
      const K = unitStiffness(nu);
      let asym = 0;
      for (let i = 0; i < 24; i++) {
        for (let j = 0; j < 24; j++) {
          asym = Math.max(asym, Math.abs(K[i * 24 + j] - K[j * 24 + i]));
        }
      }
      expect(asym).toBeLessThan(1e-14);
      const ev = eigenvalues(K, 24);
      const zero = ev.filter((v) => Math.abs(v) < 1e-10).length;
      expect(zero, `nu ${nu}: eigenvalues ${ev.map((v) => v.toFixed(4)).join(' ')}`).toBe(6);
      expect(ev[6]).toBeGreaterThan(1e-3);
    }
  });
});

function beam(L: number, b: number, d: number): PartSpec {
  return {
    language: 2,
    name: 'beam',
    units: 'mm',
    features: [
      { $op: 'sketch.rectangle', id: 's', sketched_on: 'front', args: { width: L, height: d } },
      { $op: 'feature.extrude', id: 'b', args: { depth: b / 2, direction: 'both' } },
    ],
  };
}

describe('cantilever against Timoshenko beam theory', () => {
  const L = 60;
  const b = 10;
  const d = 10;
  const E = 3500;
  const P = 10;
  const I = (b * d ** 3) / 12;

  const run = (nu: number, target: number) => {
    const out = kernel.build(beam(L, b, d));
    const res = solveFea({
      positions: out.mesh.positions,
      indices: out.mesh.indices,
      volume: out.props.volume,
      E,
      nu,
      fixture: [{ kind: 'box', min: [-1, -1, -b], max: [0, d + 1, b] }],
      load: { region: { kind: 'box', min: [L, -1, -b], max: [L + 1, d + 1, b] }, dir: [0, -1, 0], newtons: P },
      targetElements: target,
      tol: 1e-8,
    });
    const G = E / (2 * (1 + nu));
    const theory = (P * L ** 3) / (3 * E * I) + (P * L) / ((5 / 6) * b * d * G);
    return { res, theory };
  };

  it('fine grid (10 cells through the depth): tip deflection within 2 %', () => {
    const { res, theory } = run(0, 6000);
    const err = Math.abs(res.maxDisp - theory) / theory;
    console.log(
      `fine: ${res.stats.elements} elements, tip ${res.maxDisp.toFixed(5)} mm vs theory ${theory.toFixed(5)} mm, error ${(err * 100).toFixed(2)} %, ${res.stats.iterations} iterations, ${res.ms.toFixed(0)} ms`,
    );
    expect(res.stats.converged).toBe(true);
    expect(err).toBeLessThan(0.02);
  });

  it('coarse grid (4 cells through the depth): no shear locking, within 5 %', () => {
    const { res, theory } = run(0, 384);
    const err = Math.abs(res.maxDisp - theory) / theory;
    console.log(
      `coarse: ${res.stats.elements} elements, tip ${res.maxDisp.toFixed(5)} mm vs theory ${theory.toFixed(5)} mm, error ${(err * 100).toFixed(2)} %`,
    );
    expect(err).toBeLessThan(0.05);
  });

  it('outer-fibre bending stress within 4 % of M y / I at three stations', () => {
    const out = kernel.build(beam(L, b, d));
    const stations = [L * 0.25, L * 0.5, L * 0.75];
    const res = solveFea({
      positions: out.mesh.positions,
      indices: out.mesh.indices,
      volume: out.props.volume,
      E,
      nu: 0,
      fixture: [{ kind: 'box', min: [-1, -1, -b], max: [0, d + 1, b] }],
      load: { region: { kind: 'box', min: [L, -1, -b], max: [L + 1, d + 1, b] }, dir: [0, -1, 0], newtons: P },
      targetElements: 6000,
      tol: 1e-8,
      probes: Float32Array.from(stations.flatMap((x) => [x, d, 0])),
    });
    stations.forEach((x, i) => {
      const theory = (P * (L - x) * (d / 2)) / I;
      const got = (res.probeStress as Float32Array)[i];
      const err = Math.abs(got - theory) / theory;
      console.log(`x = ${x} mm: ${got.toFixed(4)} MPa vs M y / I ${theory.toFixed(4)} MPa, error ${(err * 100).toFixed(2)} %`);
      expect(err).toBeLessThan(0.04);
    });
  });
});

describe('default load case of every job solves', () => {
  for (const job of JOBS) {
    it(job.id, () => {
      const params = defaultParams(job);
      const out = kernel.build(job.spec(params));
      const lc = job.loadCase(params);
      const mat = materialById('pla');
      const res = solveFea({
        positions: out.mesh.positions,
        indices: out.mesh.indices,
        volume: out.props.volume,
        E: mat.E,
        nu: mat.nu,
        fixture: lc.fixture,
        load: { region: lc.region, dir: lc.dir, newtons: lc.newtons },
        wallHint: job.roles.wall ? params[job.roles.wall] : undefined,
        tol: 1e-5,
      });
      console.log(
        `${job.id}: ${res.stats.elements} elements, cell ${res.cell.toFixed(2)} mm, ${res.stats.iterations} iterations, ${res.ms.toFixed(0)} ms, ` +
          `max deflection ${res.maxDisp.toFixed(4)} mm, stress P99 ${res.stressP99.toFixed(2)} / max ${res.stressMax.toFixed(2)} MPa at ${lc.newtons} N, ` +
          `fixed ${res.fixedNodes} loaded ${res.loadedNodes}`,
      );
      expect(res.stats.converged).toBe(true);
      expect(Number.isFinite(res.maxDisp)).toBe(true);
      expect(res.maxDisp).toBeGreaterThan(0);
      expect(res.stressP99).toBeGreaterThan(0);
    });
  }
});
