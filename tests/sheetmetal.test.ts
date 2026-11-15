import { beforeAll, describe, expect, it } from 'vitest';
import { designFlatPattern, designJob, designSpec, parseDesign, readFeature } from '../src/engine/design.js';
import { expectVolume } from '../src/engine/expect.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { bendAllowance, flangeArea, flatPatternDxf, sheetEdges } from '../src/engine/sheetmetal.js';
import { runGate } from '../src/engine/truth.js';
import type { Params } from '../src/engine/jobs.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

const build = (p: Params): { verdict: string; volume: number; components: number; box: number[] } => {
  const spec = designSpec(designJob.clamp(p).params);
  const out = kernel.build(spec);
  let maxY = -Infinity;
  for (let i = 1; i < out.mesh.positions.length; i += 3) maxY = Math.max(maxY, out.mesh.positions[i]);
  return { verdict: runGate({ props: out.props, generic: expectVolume(spec) }).verdict, volume: out.props.volume, components: out.props.components, box: [maxY] };
};

describe('sheet metal', () => {
  it('a base flange and an edge flange bent up 90 degrees: exact bend and flange, flat pattern by bend allowance', () => {
    let p = parseDesign('sheet metal 100 by 60 thick 2 bend 2', { nf: 0 }, [0, 0, 0], undefined, 0)!.params;
    const edges = sheetEdges([[-50, -30], [50, -30], [50, 30], [-50, 30]]);
    expect(edges[0].out[1]).toBeLessThan(0);
    p = parseDesign('flange edge 1 30', p)!.params;
    const g = build(p);
    expect(g.verdict).toBe('verified');
    expect(g.components).toBe(1);
    expect(g.volume).toBeCloseTo(100 * 60 * 2 + flangeArea(2, 2, 90, 30) * 100, 3);
    // It stands up: the top is the sheet, the bend (R + t) and the flange.
    expect(g.box[0]).toBeCloseTo(2 + 2 + 30, 1);
    const fp = designFlatPattern(p)!;
    const BA = bendAllowance(90, 2, 2, 0.44);
    expect(fp.size[0]).toBeCloseTo(100, 6);
    expect(fp.size[1]).toBeCloseTo(60 + BA + 30, 6);
    const dxf = flatPatternDxf(fp);
    expect(dxf).toContain('BEND');
    expect(dxf.trim().endsWith('EOF')).toBe(true);
  });

  it('two flanges at a corner get corner relief; a flange can bend down at any angle', () => {
    let p = parseDesign('sheet metal 80 by 50 thick 1.5 bend 1', { nf: 0 }, [0, 0, 0], undefined, 0)!.params;
    p = parseDesign('flange edge 1 20', p)!.params;
    p = parseDesign('flange edge 2 15 at 60 down', p)!.params;
    const f2 = readFeature(p, 2);
    expect(f2.v.d).toBe(60);
    expect(f2.v.e).toBe(1);
    const g = build(p);
    expect(g.components).toBe(1);
    // Each flange is set back R + t at the shared corner.
    const relief = 1 + 1.5;
    const want = 80 * 50 * 1.5 + flangeArea(1.5, 1, 90, 20) * (80 - relief) + flangeArea(1.5, 1, 60, 15) * (50 - relief);
    expect(g.volume).toBeCloseTo(want, 2);
    expect(g.verdict).toBe('verified');
  });
});
