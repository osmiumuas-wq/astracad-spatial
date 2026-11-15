/**
 * Regression against an independent solver: the default wall bracket under its
 * standard load, solved with CalculiX (scripts/verify/ccx_bracket.py: C3D8I
 * hexahedra, refined until tip deflection changed 0.6 %) gave 4.458 mm and a
 * P99 von Mises of 28.33 MPa (load patch left out). Before the stress grid was
 * aligned to the part's faces, this solver read 23 % stiff here.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { solveFea } from '../src/engine/fea.js';
import { defaultParams, jobById } from '../src/engine/jobs.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { materialById } from '../src/engine/materials.js';

const CCX_DEFLECTION_MM = 4.458;
const CCX_P99_MPA = 28.33;

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

describe('agreement with CalculiX', () => {
  it('the wall bracket bends and stresses as CalculiX says (default grid)', () => {
    const job = jobById('wall-bracket');
    const params = defaultParams(job);
    const built = kernel.build(job.spec(params));
    const lc = job.loadCase(params);
    const pla = materialById('pla');
    const res = solveFea({
      positions: built.mesh.positions,
      indices: built.mesh.indices,
      volume: built.props.volume,
      E: pla.E,
      nu: pla.nu,
      fixture: lc.fixture,
      load: { region: lc.region, dir: lc.dir, newtons: lc.newtons },
      wallHint: params.t,
      targetElements: 3500,
      tol: 1e-6,
    });
    // eslint-disable-next-line no-console
    console.log(`bracket: ${res.maxDisp.toFixed(3)} mm (CalculiX ${CCX_DEFLECTION_MM}), P99 ${res.stressP99.toFixed(2)} MPa (CalculiX ${CCX_P99_MPA})`);
    expect(Math.abs(res.maxDisp / CCX_DEFLECTION_MM - 1)).toBeLessThan(0.05);
    expect(Math.abs(res.stressP99 / CCX_P99_MPA - 1)).toBeLessThan(0.05);
  }, 120000);

  it('converges towards CalculiX as the grid is refined (the in-app convergence study)', () => {
    const job = jobById('wall-bracket');
    const params = defaultParams(job);
    const built = kernel.build(job.spec(params));
    const lc = job.loadCase(params);
    const pla = materialById('pla');
    const rows = [3500, 16000, 32000].map((targetElements) => {
      const t0 = performance.now();
      const res = solveFea({
        positions: built.mesh.positions,
        indices: built.mesh.indices,
        volume: built.props.volume,
        E: pla.E,
        nu: pla.nu,
        fixture: lc.fixture,
        load: { region: lc.region, dir: lc.dir, newtons: lc.newtons },
        wallHint: params.t,
        targetElements,
        tol: 1e-4,
      });
      return { elements: res.stats.elements, d: res.maxDisp, s: res.stressP99, ms: performance.now() - t0 };
    });
    // eslint-disable-next-line no-console
    console.log(rows.map((r) => `${r.elements} cells: ${r.d.toFixed(3)} mm, ${r.s.toFixed(2)} MPa, ${r.ms.toFixed(0)} ms`).join('\n'));
    // Three, four and five cells through the wall: each grid finer than the last, all within 10 % of CalculiX.
    expect(rows[1].elements).toBeGreaterThan(rows[0].elements * 1.5);
    expect(rows[2].elements).toBeGreaterThan(rows[1].elements * 1.5);
    for (const r of rows) expect(Math.abs(r.d / CCX_DEFLECTION_MM - 1)).toBeLessThan(0.1);
    expect(rows[2].ms).toBeLessThan(60000);
  }, 300000);
});
