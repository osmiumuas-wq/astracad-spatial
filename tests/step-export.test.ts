import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, designJob, designSpec, OPS } from '../src/engine/design.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { planarFaces, writeStep } from '../src/engine/step-export.js';
import { Occt, readStep } from '../src/engine/step-import.js';

const require = createRequire(import.meta.url);
let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

describe('STEP export', () => {
  it('merges each flat face into one STEP face, holes as inner loops', () => {
    let p = addFeature({ nf: 0 }, OPS.BOX, { a: 60, b: 40, c: 20 });
    p = addFeature(p, OPS.HOLE, { a: 10, b: 0, d: 0, e: 0, f: 20 });
    const out = kernel.build(designSpec(designJob.clamp(p).params));
    const faces = planarFaces(out.mesh.positions, out.mesh.indices);
    // The top face is one face with a hole: an outer loop and one inner loop.
    const top = faces.find((f) => f.normal[1] > 0.999)!;
    expect(top.loops.length).toBe(2);
  });

  it('round-trips through OpenCascade with the same volume', async () => {
    let p = addFeature({ nf: 0 }, OPS.BOX, { a: 60, b: 40, c: 20 });
    p = addFeature(p, OPS.FILLET, { a: 5, b: 0 });
    p = addFeature(p, OPS.HOLE, { a: 10, b: 0, d: 10, e: 0, f: 20 });
    const out = kernel.build(designSpec(designJob.clamp(p).params));
    const step = writeStep([{ name: 'bracket', positions: out.mesh.positions, indices: out.mesh.indices }], 'bracket.step');
    expect(step.startsWith('ISO-10303-21;')).toBe(true);
    const occt = await (require('occt-import-js') as () => Promise<Occt>)();
    const back = readStep(occt, new TextEncoder().encode(step), 'bracket');
    expect(back.closed).toBe(true);
    expect(back.volume / out.props.volume).toBeGreaterThan(0.9999);
    expect(back.volume / out.props.volume).toBeLessThan(1.0001);
  }, 60000);
});
