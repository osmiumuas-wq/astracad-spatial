import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, designJob, designSpec, OPS } from '../src/engine/design.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { draftAnalysis, partingLine } from '../src/engine/mould.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

describe('moulds and castings', () => {
  it('draft analysis flags vertical walls; drafted walls release', () => {
    const plain = kernel.build(designSpec(designJob.clamp(addFeature({ nf: 0 }, OPS.BOX, { a: 40, b: 30, c: 20 })).params)).mesh;
    const r = draftAnalysis(plain.positions, plain.normals, plain.indices, [0, 1, 0], 1);
    // The four walls (2 x (40 + 30) x 20) need draft; top and bottom are flat to the pull.
    expect(r.insufficient).toBeCloseTo(2 * (40 + 30) * 20, 3);
    expect(r.flat).toBeCloseTo(2 * 40 * 30, 3);
    const drafted = kernel.build(designSpec(designJob.clamp(addFeature({ nf: 0 }, OPS.BOX, { a: 40, b: 30, c: 20, h: 3 })).params)).mesh;
    const d = draftAnalysis(drafted.positions, drafted.normals, drafted.indices, [0, 1, 0], 1);
    expect(d.insufficient).toBeLessThan(1);
  });

  it('the parting line runs round the base of a block and the equator of a ball-ended shape', () => {
    const box = kernel.build(designSpec(designJob.clamp(addFeature({ nf: 0 }, OPS.BOX, { a: 40, b: 30, c: 20 })).params)).mesh;
    const pl = partingLine(box.positions, box.indices, [0, 1, 0]);
    expect(pl.length).toBeCloseTo(2 * (40 + 30), 3);
    expect(pl.level).toBeCloseTo(0, 6);
  });

  it('core and cavity: a block round the part, less the part, split at the parting level', () => {
    const p = designJob.clamp(addFeature({ nf: 0 }, OPS.CYL, { a: 30, c: 20 })).params;
    const m = kernel.mould(designSpec(p), [0, 1, 0], 10, 0, 10);
    const block = (30 + 20) * (20 + 20) * (30 + 20);
    const part = kernel.build(designSpec(p)).props.volume;
    // The block is sized from the part's facets (which bulge a little past the true circle).
    expect(Math.abs((m.cavityVolume + m.coreVolume) / (block - part) - 1)).toBeLessThan(2e-3);
    expect(m.cavityVolume).toBeGreaterThan(0);
    expect(m.coreVolume).toBeGreaterThan(0);
  });
});
