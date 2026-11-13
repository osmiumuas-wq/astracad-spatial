import { describe, expect, it } from 'vitest';
import { solveModes } from '../src/engine/modal.js';

/** A closed box mesh from min to max (mm). */
function box(min: [number, number, number], max: [number, number, number]): { positions: Float32Array; indices: Uint32Array } {
  const p: number[] = [];
  for (let k = 0; k < 8; k++) p.push(k & 1 ? max[0] : min[0], k & 2 ? max[1] : min[1], k & 4 ? max[2] : min[2]);
  // Outward-facing triangles of the six faces.
  const f = [
    [0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5],
  ];
  const idx: number[] = [];
  for (const [a, b, c, d] of f) idx.push(a, b, c, a, c, d);
  return { positions: new Float32Array(p), indices: new Uint32Array(idx) };
}

describe('natural frequencies', () => {
  it('match the Euler-Bernoulli cantilever', () => {
    // Steel cantilever, 100 mm long, 10 x 10 mm section, clamped at x = 0.
    const L = 100;
    const b = 10;
    const E = 200000;
    const rho = 7.85;
    const mesh = box([0, 0, 0], [L, b, b]);
    const res = solveModes({
      ...mesh,
      volume: L * b * b,
      E,
      nu: 0.3,
      density: rho,
      fixture: [{ kind: 'box', min: [-1, -1, -1], max: [0.01, b + 1, b + 1] }],
      load: { region: { kind: 'box', min: [L - 1, -1, -1], max: [L + 1, b + 1, b + 1] }, dir: [0, -1, 0], newtons: 1 },
      modes: 2,
    });
    const I = (b * b ** 3) / 12;
    const A = b * b;
    const theory = ((1.875104 ** 2) / (2 * Math.PI)) * Math.sqrt((E * I) / (rho * 1e-9 * A * L ** 4));
    // eslint-disable-next-line no-console
    console.log(`f1 ${res.frequencies[0].toFixed(1)} Hz, f2 ${res.frequencies[1].toFixed(1)} Hz, theory ${theory.toFixed(1)} Hz, ${res.elements} cells, ${res.ms.toFixed(0)} ms, iterations ${res.iterations}`);
    expect(Math.abs(res.frequencies[0] - theory) / theory).toBeLessThan(0.06);
    // A square section bends the same way in both directions: the second mode matches the first.
    expect(Math.abs(res.frequencies[1] - theory) / theory).toBeLessThan(0.06);
    // The tip moves most.
    const shape = res.shapes[0];
    let tip = 0;
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      if (mesh.positions[v * 3] === L) tip = Math.max(tip, Math.hypot(shape[v * 3], shape[v * 3 + 1], shape[v * 3 + 2]));
    }
    expect(tip).toBeGreaterThan(0.95);
  }, 120000);
});
