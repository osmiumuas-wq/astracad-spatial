import { describe, expect, it } from 'vitest';
import { minRect, scanBox } from '../src/engine/scan.js';

describe('ray scan', () => {
  it('finds the minimum-area rectangle of a rotated box footprint', () => {
    const a = 0.5;
    const pts: [number, number][] = [];
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 4; j++) {
      const u = i * 8 - 40, v = j * 5 - 10; // 80 x 20
      pts.push([u * Math.cos(a) - v * Math.sin(a) + 3, u * Math.sin(a) + v * Math.cos(a) - 2]);
    }
    const r = minRect(pts);
    expect(Math.max(r.a, r.b)).toBeCloseTo(80, 6);
    expect(Math.min(r.a, r.b)).toBeCloseTo(20, 6);
    expect(r.c[0]).toBeCloseTo(3, 6);
    expect(r.c[1]).toBeCloseTo(-2, 6);
  });

  it('measures a block standing on a table from scattered hits', () => {
    const hits: [number, number, number][] = [];
    const table = 0.75;
    // Table around the object.
    for (let i = 0; i < 40; i++) hits.push([-0.2 + i * 0.01, table, -0.15 + (i % 5) * 0.075]);
    // A 90 x 60 x 30 mm block centred at (0.05, -0.02): top and sides.
    for (let i = 0; i <= 9; i++) for (let j = 0; j <= 6; j++) hits.push([0.005 + i * 0.01, table + 0.03, -0.05 + j * 0.01]);
    for (let k = 1; k <= 3; k++) hits.push([0.005, table + k * 0.01, -0.02], [0.095, table + k * 0.01, 0.01]);
    // A second, smaller thing 20 cm away is not part of it.
    for (let i = 0; i < 4; i++) hits.push([0.35 + i * 0.01, table + 0.05, 0.2]);
    const b = scanBox(hits)!;
    expect(b.length).toBeCloseTo(90, 3);
    expect(b.width).toBeCloseTo(60, 3);
    expect(b.height).toBeCloseTo(30, 3);
    expect(b.floor).toBeCloseTo(table, 9);
  });
});
