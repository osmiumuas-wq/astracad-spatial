import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINTER, hatch, toGcode } from '../src/engine/gcode.js';
import type { Vec2 } from '../src/engine/types.js';

describe('gcode', () => {
  it('hatches a square with the right number and length of lines', () => {
    const sq: Vec2[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const lines = hatch([sq], 0, 1);
    expect(lines.length).toBe(10);
    for (const [a, b] of lines) expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(10, 9);
    // Zig-zag: consecutive lines run opposite ways.
    expect(Math.sign(lines[0][1][0] - lines[0][0][0])).toBe(-Math.sign(lines[1][1][0] - lines[1][0][0]));
  });

  it('skips a hole (even-odd) and keeps total hatch length equal to the area / spacing', () => {
    const outer: Vec2[] = [[0, 0], [20, 0], [20, 20], [0, 20]];
    const hole: Vec2[] = [[5, 5], [5, 15], [15, 15], [15, 5]];
    const lines = hatch([outer, hole], Math.PI / 4, 0.5);
    const total = lines.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
    // Area 400 - 100 = 300; length about area / spacing.
    expect(total / (300 / 0.5)).toBeGreaterThan(0.97);
    expect(total / (300 / 0.5)).toBeLessThan(1.03);
    // No segment midpoint falls inside the hole.
    for (const [a, b] of lines) {
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      expect(mx > 5.01 && mx < 14.99 && my > 5.01 && my < 14.99).toBe(false);
    }
  });

  it('extrudes the volumetric amount and reports time and filament', () => {
    const s = { ...DEFAULT_PRINTER };
    const r = toGcode([{ z: 0.2, paths: [{ kind: 'wall', pts: [[50, 50], [150, 50]], closed: false }] }], s);
    const area = Math.PI * (s.filament / 2) ** 2;
    // The purge line plus the 100 mm wall.
    const purge = (0.6 * 0.3 * 115) / area;
    expect(r.filamentMm - purge).toBeCloseTo((s.line * s.layer * 100) / area, 6);
    expect(r.gcode).toContain(';LAYER:0');
    expect(r.gcode).toContain('M109 S210');
    expect(r.seconds).toBeGreaterThan(100 / s.firstLayerSpeed);
  });
});
