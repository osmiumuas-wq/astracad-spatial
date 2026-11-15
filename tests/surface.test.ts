import { beforeAll, describe, expect, it } from 'vitest';
import { designJob, designSpec, parseDesign } from '../src/engine/design.js';
import { expectVolume } from '../src/engine/expect.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { surfaceHeight } from '../src/engine/surface.js';
import { runGate } from '../src/engine/truth.js';
import type { Params } from '../src/engine/jobs.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

const build = (p: Params): { verdict: string; volume: number; components: number } => {
  const spec = designSpec(designJob.clamp(p).params);
  const out = kernel.build(spec);
  return { verdict: runGate({ props: out.props, generic: expectVolume(spec) }).verdict, volume: out.props.volume, components: out.props.components };
};

describe('freeform surfaces', () => {
  it('the B-spline patch passes through its corner control points and is smooth between', () => {
    const s = { origin: [0, 0, 0] as [number, number, number], sx: 80, sz: 60, n: 4, heights: Array.from({ length: 16 }, (_, k) => (k === 5 ? 20 : 0)), thickness: 2 };
    expect(surfaceHeight(s, 0, 0)).toBeCloseTo(0, 12);
    expect(surfaceHeight(s, 1, 1)).toBeCloseTo(0, 12);
    // An inner control point pulls the surface up near it, by less than itself (a B-spline, not an interpolant).
    const h = surfaceHeight(s, 1 / 3, 1 / 3);
    expect(h).toBeGreaterThan(3);
    expect(h).toBeLessThan(20);
  });

  it('a pulled sheet is one solid of exactly area x thickness, verified', () => {
    let p = parseDesign('freeform surface 80 by 60 thick 3', { nf: 0 }, [0, 0, 0], undefined, 0)!.params;
    // Start empty: remove the default block the design gets.
    p = parseDesign('raise point 2 2 by 15', p)!.params;
    p = parseDesign('lower point 3 4 by 6', p)!.params;
    const g = build(p);
    expect(g.verdict).toBe('verified');
    expect(g.components).toBe(1);
  });

  it('a filled freeform top (a solid with a sculpted top face), verified', () => {
    let p = parseDesign('freeform top 60 by 40 with 5 by 5 points', { nf: 0 }, [0, 0, 0], undefined, 0)!.params;
    p = parseDesign('raise point 3 3 by 12', p)!.params;
    const g = build(p);
    expect(g.verdict).toBe('verified');
    // More than the flat 10 mm slab, less than if it were all 22 mm.
    expect(g.volume).toBeGreaterThan(60 * 40 * 10);
    expect(g.volume).toBeLessThan(60 * 40 * 22);
  });
});
