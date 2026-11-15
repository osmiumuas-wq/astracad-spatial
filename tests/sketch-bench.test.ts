import { fileURLToPath } from 'node:url';
import { make_gcs_wrapper, type GcsWrapper } from '@salusoft89/planegcs';
import { beforeAll, describe, expect, it } from 'vitest';
import { SketchBench } from '../src/app/sketch-bench.js';
import { addFeature, designJob, designSpec, OPS } from '../src/engine/design.js';
import { expectVolume } from '../src/engine/expect.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { runGate } from '../src/engine/truth.js';

let gcs: GcsWrapper;
let kernel: Kernel;
beforeAll(async () => {
  gcs = await make_gcs_wrapper(fileURLToPath(new URL('../node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm', import.meta.url)));
  kernel = await initKernel();
});

describe('the sketch workbench, driven like a user', () => {
  it('picks a line chain with a tangent arc, dimensions it, adds a hole, extrudes: one verified solid', () => {
    const b = new SketchBench([-30, 10, 20], 0, gcs);
    // Clicks a hand would make on the top face (u right, v back), a little off the grid.
    b.click(0.2, -0.3);
    b.click(40.6, 0.3);
    b.click(40, 20.4);
    expect(b.command('tangent arc')).toMatch(/Tangent arc/);
    b.click(20, 40);
    b.click(0, 40.2);
    expect(b.click(0.4, -0.2)).toMatch(/closed/);
    b.setTool('dimension');
    expect(b.click(20, 0)).toMatch(/say the size/);
    expect(b.command('45')).toMatch(/Length 45 mm/);
    b.setTool('circle');
    b.click(15, 20);
    b.click(19, 20);
    b.setTool('dimension');
    b.click(19, 20);
    expect(b.command('diameter 8')).toMatch(/Diameter 8 mm/);
    const base = addFeature({ nf: 0 }, OPS.BOX, { a: 100, b: 70, c: 10 });
    const { params, reply } = b.finish(base, 'extrude', 8);
    expect(reply).toMatch(/Extruded 8 mm: 1 region/);
    const spec = designSpec(designJob.clamp(params).params);
    const out = kernel.build(spec);
    expect(runGate({ props: out.props, generic: expectVolume(spec) }).verdict).toBe('verified');
    expect(out.props.components).toBe(1);
  });

  it('relations from the selection, construction geometry, undo', () => {
    const b = new SketchBench([0, 0, 0], 0, gcs);
    b.setTool('line');
    b.click(0, 0);
    b.click(30, 4);
    b.setTool('line');
    b.click(30, 4);
    b.click(33, 25);
    b.setTool('select');
    b.click(15, 2);
    b.click(31.5, 14);
    expect(b.command('perpendicular')).toMatch(/perpendicular/);
    expect(b.command('construction')).toMatch(/Construction/);
    expect(b.sk.ents.some((e) => e.construction)).toBe(true);
    expect(b.undo()).toBe('Undone.');
    expect(b.sk.ents.some((e) => e.construction)).toBe(false);
  });
});
