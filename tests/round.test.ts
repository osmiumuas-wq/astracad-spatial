import { beforeAll, describe, expect, it } from 'vitest';
import { filletArea } from '../src/engine/edges.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { roundedBoxVolume } from '../src/engine/round.js';
import type { PartSpec } from '../src/engine/types.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

// A 40 x 30 x 20 block: x -20..20, y 0..20, z -15..15.
const block = (extra: PartSpec['features'] = [], hole = false): PartSpec => ({
  language: 2,
  name: 'b',
  units: 'mm',
  features: [
    { $op: 'sketch.rectangle', id: 's', sketched_on: 'top', args: { width: 40, height: 30, x: -20, y: -15 } },
    { $op: 'feature.extrude', id: 'body', args: { depth: 20 } },
    ...(hole
      ? [
          { $op: 'ref.plane', id: 'up', args: { base: 'top', offset: 20 } },
          { $op: 'sketch.circle', id: 'h', sketched_on: 'up', args: { diameter: 16, x: 0, y: 0 } },
          { $op: 'feature.cut', id: 'hole', args: { through_all: true } },
        ]
      : []),
    ...extra,
  ],
});

describe('rolling-ball fillets: any edge, blended corners', () => {
  it('rounds every edge and corner of a block: Steiner volume', () => {
    const t = performance.now();
    const out = kernel.build(block([{ $op: 'feature.round', id: 'r', args: { radius: 3, all: true } }]));
    const ms = performance.now() - t;
    const exact = roundedBoxVolume(40, 20, 30, 3);
    // A 32-segment ball is a polyhedron a little inside the sphere.
    expect(out.props.volume / exact).toBeGreaterThan(0.997);
    expect(out.props.volume / exact).toBeLessThan(1.0001);
    expect(out.props.components).toBe(1);
    expect(ms).toBeLessThan(3000);
  });

  it('rounds the curved rim of a hole all the way round (Pappus)', () => {
    const plain = kernel.build(block([], true)).props.volume;
    const t = performance.now();
    // A point on the rim: top face (y = 20), radius 8 from the axis.
    const out = kernel.build(block([{ $op: 'feature.round', id: 'r', args: { at: [8, 20, 0], radius: 2 } }], true));
    const ms = performance.now() - t;
    const removed = plain - out.props.volume;
    // The fillet's section (area r^2 (1 - pi/4)) swept round the rim; its centroid sits r (10 - 3 pi)/(12 - 3 pi) out from the hole wall.
    const r = 2;
    const area = filletArea(r, Math.PI / 2);
    const cx = (r * (10 - 3 * Math.PI)) / (12 - 3 * Math.PI);
    const exact = area * 2 * Math.PI * (8 + cx);
    expect(removed / exact).toBeGreaterThan(0.93);
    expect(removed / exact).toBeLessThan(1.07);
    expect(out.props.components).toBe(1);
    console.log('rim ms', Math.round(ms), 'removed', removed.toFixed(3), 'exact', exact.toFixed(3));
  });

  it('blends a corner where three rounded edges meet (one fillet set)', () => {
    // The top front right corner: x = 20, y = 20, z = 15; its three edges picked one after another, same radius.
    const out = kernel.build(block([
      { $op: 'feature.round', id: 'r1', args: { at: [0, 20, 15], radius: 3 } },
      { $op: 'feature.round', id: 'r2', args: { at: [20, 20, 0], radius: 3 } },
      { $op: 'feature.round', id: 'r3', args: { at: [20, 10, 15], radius: 3 } },
    ]));
    // No point of the solid may stick out past the sphere of radius 3 centred 3 mm in from the corner.
    const c = [17, 17, 12];
    let worst = 0;
    let worstAt = [0, 0, 0];
    const P = out.mesh.positions;
    for (let i = 0; i < P.length; i += 3) {
      if (P[i] > 17 && P[i + 1] > 17 && P[i + 2] > 12) {
        const dd = Math.hypot(P[i] - c[0], P[i + 1] - c[1], P[i + 2] - c[2]);
        if (dd > worst) {
          worst = dd;
          worstAt = [P[i], P[i + 1], P[i + 2]];
        }
      }
    }
    if (worst > 3.05) console.log('WORST', worstAt.map((v) => v.toFixed(3)).join(' '));
    expect(worst).toBeLessThan(3.05);
    expect(out.props.components).toBe(1);
  });
});

describe('curved chamfers', () => {
  it('chamfers the rim of a hole all the way round (Pappus)', () => {
    const plain = kernel.build(block([], true)).props.volume;
    const out = kernel.build(block([{ $op: 'feature.round', id: 'c', args: { at: [8, 20, 0], radius: 1.5, kind: 'chamfer' } }], true));
    const removed = plain - out.props.volume;
    // A 45 degree chamfer d = 1.5 on a rim of radius 8: triangle area d^2/2 at centroid radius 8 + d/3.
    const exact = (1.5 * 1.5) / 2 * 2 * Math.PI * (8 + 1.5 / 3);
    expect(removed / exact).toBeGreaterThan(0.97);
    expect(removed / exact).toBeLessThan(1.03);
    expect(out.props.components).toBe(1);
  });

  // A slot boss (two lines, two half circles of radius 5) 5 mm tall on the block's top.
  const slot = (extra: PartSpec['features'] = []): PartSpec => block([
    { $op: 'ref.plane', id: 'up2', args: { base: 'top', offset: 20 } },
    { $op: 'sketch.loops', id: 'sl', sketched_on: 'up2', args: { loops: [[['L', -10, -5, 10, -5], ['A', 10, 0, 10, -5, 10, 5, 1], ['L', 10, 5, -10, 5], ['A', -10, 0, -10, 5, -10, -5, 1]]] } },
    { $op: 'feature.extrude', id: 'boss', args: { depth: 5 } },
    ...extra,
  ]);
  const P = 40 + 10 * Math.PI;

  it('chamfers any curved edge: a slot boss rim, lines and arcs in one bevel', () => {
    const plain = kernel.build(slot()).props.volume;
    const out = kernel.build(slot([{ $op: 'feature.round', id: 'c', args: { at: [0, 25, 5], radius: 1, kind: 'chamfer' } }]));
    // Inward offsets of a convex outline: A - P s + pi s^2, so the bevel removes P d^2/2 - pi d^3/3.
    const exact = (P * 1) / 2 - Math.PI / 3;
    expect((plain - out.props.volume) / exact).toBeGreaterThan(0.97);
    expect((plain - out.props.volume) / exact).toBeLessThan(1.03);
    expect(out.props.components).toBe(1);
  });

  it('chamfers a concave curved edge by filling it: the slot boss foot', () => {
    const plain = kernel.build(slot()).props.volume;
    const out = kernel.build(slot([{ $op: 'feature.round', id: 'c', args: { at: [0, 20, 5], radius: 1, kind: 'chamfer' } }]));
    const exact = (P * 1) / 2 + Math.PI / 3;
    expect((out.props.volume - plain) / exact).toBeGreaterThan(0.97);
    expect((out.props.volume - plain) / exact).toBeLessThan(1.03);
  });
});
