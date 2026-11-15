import { beforeAll, describe, expect, it } from 'vitest';
import { designJob, designSpec, parseDesign } from '../src/engine/design.js';
import { expectVolume } from '../src/engine/expect.js';
import { meshVolume, naca4, springLength, springMesh, subdMesh } from '../src/engine/generated.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { runGate } from '../src/engine/truth.js';
import type { Params } from '../src/engine/jobs.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

const build = (p: Params): { verdict: string; volume: number; components: number; height: number } => {
  const spec = designSpec(designJob.clamp(p).params);
  const out = kernel.build(spec);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 1; i < out.mesh.positions.length; i += 3) {
    lo = Math.min(lo, out.mesh.positions[i]);
    hi = Math.max(hi, out.mesh.positions[i]);
  }
  return { verdict: runGate({ props: out.props, generic: expectVolume(spec) }).verdict, volume: out.props.volume, components: out.props.components, height: hi - lo };
};

describe('springs and coils', () => {
  it('a wire swept along a helix: volume = wire area x wire length (to the sampling)', () => {
    const s = { origin: [0, 0, 0] as [number, number, number], axis: [0, 1, 0] as [number, number, number], D: 20, d: 2, pitch: 6, turns: 5, closed: false };
    const m = springMesh(s);
    const L = 5 * Math.hypot(Math.PI * 20, 6);
    expect(meshVolume(m) / (Math.PI * 1 * L)).toBeGreaterThan(0.995);
    expect(meshVolume(m) / (Math.PI * 1 * L)).toBeLessThan(1.005);
  });

  it('a closed-end compression spring by voice: one solid, verified, its free length', () => {
    const p = parseDesign('spring 20 diameter wire 2 pitch 6 8 turns closed ends', { nf: 0 }, [0, 0, 0], undefined, 0)!.params;
    const g = build(p);
    expect(g.verdict).toBe('verified');
    expect(g.components).toBe(1);
    const free = springLength({ origin: [0, 0, 0], axis: [0, 1, 0], D: 20, d: 2, pitch: 6, turns: 8, closed: true });
    expect(g.height).toBeCloseTo(free, 0);
    expect(() => springMesh({ origin: [0, 0, 0], axis: [0, 1, 0], D: 20, d: 3, pitch: 2, turns: 4, closed: false })).toThrow(/pitch must be more/);
  });
});

describe('SubD (organic) shapes', () => {
  it('an untouched cage smooths inside its box; pushing a point makes a bulge; symmetric mirrors it', () => {
    const flat = { origin: [0, 0, 0] as [number, number, number], size: [60, 30, 30] as [number, number, number], cells: [3, 2, 2] as [number, number, number], offsets: {}, levels: 0 };
    expect(meshVolume(subdMesh(flat))).toBeCloseTo(60 * 30 * 30, 6);
    const smooth = meshVolume(subdMesh({ ...flat, levels: 3 }));
    expect(smooth).toBeLessThan(54000);
    expect(smooth).toBeGreaterThan(54000 * 0.6);
    let p = parseDesign('subd box 60 by 30 by 30 cage 3 by 2 by 2 symmetric', { nf: 0 }, [0, 0, 0], undefined, 0)!.params;
    const before = build(p).volume;
    p = parseDesign('push point 1 out 15', p)!.params;
    const g = build(p);
    expect(g.components).toBe(1);
    expect(g.verdict).toBe('verified');
    expect(g.volume).toBeGreaterThan(before);
  });
});

describe('blades, fans and propellers', () => {
  it('a NACA 2412 section has the right thickness', () => {
    const f = naca4('0012', 200);
    const ys = f.map(([, y]) => y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.12, 2);
  });

  it('a twisted, tapered blade is verified; a three-blade propeller with a hub is one solid', () => {
    const blade = build(parseDesign('blade naca 2412 span 80 chord 30 to 15 twist 40 to 10', { nf: 0 }, [0, 0, 0], undefined, 0)!.params);
    expect(blade.verdict).toBe('verified');
    expect(blade.components).toBe(1);
    const prop = build(parseDesign('propeller 3 blades naca 4412 span 60 chord 25 to 12 twist 35 to 12 hub 10 by 12', { nf: 0 }, [0, 0, 0], undefined, 0)!.params);
    expect(prop.components).toBe(1);
    expect(prop.volume).toBeGreaterThan(Math.PI * 100 * 12);
  });
});
