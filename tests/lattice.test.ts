import { describe, expect, it } from 'vitest';
import { gyroid, insideDistance, latticeField, sampleDistance } from '../src/engine/lattice.js';

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): { positions: number[]; indices: number[] } {
  const positions = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
  const indices: number[] = [];
  for (const [a, b, c, d] of quads) indices.push(a, b, c, a, c, d);
  return { positions, indices };
}

describe('lattice', () => {
  it('measures the distance to the surface inside a box to within a voxel', () => {
    const m = box(0, 0, 0, 40, 20, 30);
    const g = insideDistance(m.positions, m.indices, 1);
    // The centre is 10 mm from the nearest face (the y faces).
    expect(sampleDistance(g, [20, 10, 15])).toBeGreaterThan(9);
    expect(sampleDistance(g, [20, 10, 15])).toBeLessThan(10.6);
    // 3 mm in from the x = 0 face, away from the others.
    expect(Math.abs(sampleDistance(g, [3, 10, 15]) - 3)).toBeLessThan(0.75);
    // Outside: zero.
    expect(sampleDistance(g, [-5, 10, 15])).toBe(0);
  });

  it('keeps the skin and the gyroid sheet, and carves between', () => {
    const m = box(0, 0, 0, 40, 40, 40);
    const g = insideDistance(m.positions, m.indices, 1);
    const field = latticeField(g, { cell: 10, wall: 1, skin: 1.5 });
    // Near a face: skin, kept.
    expect(field([0.6, 20, 20])).toBeGreaterThan(0);
    // The gyroid is zero at the origin of every cell: on the sheet, kept.
    expect(gyroid([20, 20, 20], 10)).toBeCloseTo(0, 9);
    expect(field([20, 20, 20])).toBeGreaterThan(0);
    // Between sheets, deep inside: carved away.
    let carved = 0;
    for (let x = 10; x < 30; x += 1.3) if (field([x, 17.5, 22.5]) < 0) carved++;
    expect(carved).toBeGreaterThan(3);
  });
});
