import { beforeAll, describe, expect, it } from 'vitest';
import { chamferArea, edgeFaces, filletArea } from '../src/engine/edges.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import type { PartSpec } from '../src/engine/types.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

// A 40 x 30 x 20 block: x -20..20, y 0..20, z -15..15 (extruded up from the top plane).
const block = (extra: PartSpec['features'] = []): PartSpec => ({
  language: 2,
  name: 'b',
  units: 'mm',
  features: [
    { $op: 'sketch.rectangle', id: 's', sketched_on: 'top', args: { width: 40, height: 30, x: -20, y: -15 } },
    { $op: 'feature.extrude', id: 'body', args: { depth: 20 } },
    ...extra,
  ],
});

describe('fillets and chamfers of any edge', () => {
  it('rounds a top edge: removed volume is the closed-form area times the length', () => {
    // The top front edge: y = 20, z = 15, along x.
    const out = kernel.build(block([{ $op: 'feature.edge_fillet', id: 'r', args: { from: [-20, 20, 15], to: [20, 20, 15], radius: 4 } }]));
    const removed = 40 * 30 * 20 - out.props.volume;
    const exact = filletArea(4, Math.PI / 2) * 40;
    // A polygonal arc (24 segments) removes a little more than the exact fillet.
    expect(removed).toBeGreaterThan(exact * 0.999);
    expect(removed).toBeLessThan(exact * 1.02);
    expect(out.props.components).toBe(1);
  });

  it('chamfers a vertical edge exactly', () => {
    const out = kernel.build(block([{ $op: 'feature.edge_fillet', id: 'c', args: { from: [20, 0, 15], to: [20, 20, 15], radius: 3, kind: 'chamfer' } }]));
    expect(40 * 30 * 20 - out.props.volume).toBeCloseTo(chamferArea(3, Math.PI / 2) * 20, 6);
  });

  it('finds the two faces at an edge and knows a convex edge', () => {
    const out = kernel.build(block());
    const f = edgeFaces(out.mesh.positions, out.mesh.indices, [-20, 20, 15], [20, 20, 15], 2e-3)!;
    expect(f).not.toBeNull();
    expect(f.convex).toBe(true);
    expect(f.phi).toBeCloseTo(Math.PI / 2, 9);
    expect(filletArea(4, Math.PI / 2)).toBeCloseTo(16 - 4 * Math.PI, 9);
  });

  it('fills an inner corner (concave edge): adds the same closed-form area', () => {
    // A step: the 40 x 30 x 20 block with a 20 x 30 x 10 block on its left half; the inner corner runs along z at x = 0, y = 20.
    const step = block([
      { $op: 'ref.plane', id: 'up', args: { base: 'top', offset: 20 } },
      { $op: 'sketch.rectangle', id: 's2', sketched_on: 'up', args: { width: 20, height: 30, x: -20, y: -15 } },
      { $op: 'feature.extrude', id: 'b2', args: { depth: 10 } },
    ]);
    const plain = kernel.build(step).props.volume;
    const out = kernel.build({ ...step, features: [...step.features, { $op: 'feature.edge_fillet', id: 'r', args: { from: [0, 20, -15], to: [0, 20, 15], radius: 5 } }] });
    const added = out.props.volume - plain;
    const exact = filletArea(5, Math.PI / 2) * 30;
    expect(added).toBeGreaterThan(exact * 0.999);
    // The 24-segment arc cuts inside the true circle, so a polygonal fillet adds a little more.
    expect(added).toBeLessThan(exact * 1.01);
  });

  it('refuses a line that is not an edge', () => {
    expect(() => kernel.build(block([{ $op: 'feature.edge_fillet', id: 'r', args: { from: [-20, 10, 0], to: [20, 10, 0], radius: 2 } }]))).toThrow(/not a sharp straight edge/);
  });
});
