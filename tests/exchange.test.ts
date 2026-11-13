/**
 * Writes the hand-off files for independent cross-checks on the desktop
 * kernels and solvers (see COORDINATION.md). Skipped in normal test runs:
 *
 *   ASTRA_EXPORT=1 npx vitest run tests/exchange.test.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectVolume } from '../src/engine/expect.js';
import { solveFea } from '../src/engine/fea.js';
import { defaultParams, JOBS, Params } from '../src/engine/jobs.js';
import { initKernel } from '../src/engine/kernel.js';
import { materialById } from '../src/engine/materials.js';

const OUT = join(process.cwd(), 'exchange');

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe.skipIf(process.env.ASTRA_EXPORT !== '1')('exchange files', () => {
  it('writes specs with expected values, and one stress reference case', async () => {
    const kernel = await initKernel();
    mkdirSync(join(OUT, 'specs'), { recursive: true });
    const index: unknown[] = [];
    for (const job of JOBS) {
      const rand = rng(job.id.length * 104729 + 7);
      for (let k = 0; k < 4; k++) {
        const raw: Params = defaultParams(job);
        if (k > 0) {
          for (const d of job.params) {
            raw[d.id] = d.min + rand() * (d.max - d.min);
          }
        }
        const { params } = job.clamp(raw);
        const spec = job.spec(params);
        const out = kernel.build(spec);
        const file = `${job.id}_${k}.json`;
        writeFileSync(join(OUT, 'specs', file), `${JSON.stringify(spec, null, 2)}\n`);
        index.push({
          file: `specs/${file}`,
          job: job.id,
          parameters: params,
          closed_form_volume_mm3: job.volume(params),
          generic_closed_form_volume_mm3: expectVolume(spec).volume,
          closed_form_bbox_mm: job.box(params).box,
          expected_genus: job.genus(params),
          spatial_kernel: {
            volume_mm3: out.props.volume,
            surface_area_mm2: out.props.surfaceArea,
            bbox_mm: out.props.bbox,
            genus: out.props.genus,
          },
        });
      }
    }
    writeFileSync(join(OUT, 'expected.json'), `${JSON.stringify(index, null, 2)}\n`);

    // Stress reference: the default wall bracket under its standard load case.
    const job = JOBS.find((j) => j.id === 'wall-bracket')!;
    const params = defaultParams(job);
    const built = kernel.build(job.spec(params));
    const lc = job.loadCase(params);
    const pla = materialById('pla');
    const cases = [3500, 6000, 12000].map((target) => {
      const res = solveFea({
        positions: built.mesh.positions,
        indices: built.mesh.indices,
        volume: built.props.volume,
        E: pla.E,
        nu: pla.nu,
        fixture: lc.fixture,
        load: { region: lc.region, dir: lc.dir, newtons: lc.newtons },
        wallHint: params.t,
        targetElements: target,
        tol: 1e-6,
      });
      return {
        cells: res.stats.elements,
        cell_mm: res.cell,
        max_displacement_mm: res.maxDisp,
        von_mises_p99_mpa: res.stressP99,
        von_mises_max_mpa: res.stressMax,
        iterations: res.stats.iterations,
      };
    });
    writeFileSync(
      join(OUT, 'stress_reference.json'),
      `${JSON.stringify(
        {
          spec: 'specs/wall-bracket_0.json',
          parameters: params,
          material: { name: pla.name, E_mpa: pla.E, nu: pla.nu },
          fixture: { description: lc.fixtureLabel, all_nodes_fixed_on: 'the face x = 0' },
          load: {
            description: lc.loadLabel,
            total_newtons: lc.newtons,
            direction: lc.dir,
            applied_on: 'the top face (y = height) for x from 0.72 * arm to arm, full width, spread evenly',
          },
          method: 'linear static, small displacement, voxel hexahedra with assumed shear strains',
          spatial_solver: cases,
        },
        null,
        2,
      )}\n`,
    );
    expect(index.length).toBe(JOBS.length * 4);
  });
});
