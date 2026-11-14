import { describe, expect, it } from 'vitest';
import { convexHull, massProperties, stability } from '../src/engine/stability.js';

/** An axis-aligned box mesh, outward-facing triangles. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): { positions: number[]; indices: number[] } {
  const positions = [
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ];
  const quads = [
    [0, 3, 2, 1], // z0 (normal -z)
    [4, 5, 6, 7], // z1 (+z)
    [0, 1, 5, 4], // y0 (-y)
    [3, 7, 6, 2], // y1 (+y)
    [0, 4, 7, 3], // x0 (-x)
    [1, 2, 6, 5], // x1 (+x)
  ];
  const indices: number[] = [];
  for (const [a, b, c, d] of quads) indices.push(a, b, c, a, c, d);
  return { positions, indices };
}

function merge(...meshes: { positions: number[]; indices: number[] }[]): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const m of meshes) {
    const base = positions.length / 3;
    positions.push(...m.positions);
    indices.push(...m.indices.map((i) => i + base));
  }
  return { positions, indices };
}

describe('stability', () => {
  it('finds the volume and centre of mass of a box exactly', () => {
    const { volume, com } = massProperties(box(0, 0, 0, 20, 40, 10));
    expect(volume).toBeCloseTo(8000, 6);
    expect(com[0]).toBeCloseTo(10, 9);
    expect(com[1]).toBeCloseTo(20, 9);
    expect(com[2]).toBeCloseTo(5, 9);
  });

  it('tips a cube at 45 degrees and a tall block at atan(half width / half height)', () => {
    const cube = stability(box(0, 0, 0, 10, 10, 10), 1);
    expect(cube.standsAlone).toBe(true);
    expect(cube.weakest!.tipDeg).toBeCloseTo(45, 9);
    const tall = stability(box(0, 0, 0, 20, 60, 10), 1.24);
    // The narrow way (depth 10): atan(5 / 30).
    expect(tall.weakest!.tipDeg).toBeCloseTo((Math.atan(5 / 30) * 180) / Math.PI, 9);
    expect(tall.mass).toBeCloseTo(12 * 1.24, 9);
    expect(tall.footprint).toHaveLength(4);
  });

  it('gives the tipping factor W d / (F h) for a sideways push at the top', () => {
    const s = stability(box(0, 0, 0, 20, 40, 20), 1, [{ at: [10, 40, 10], force: [0.1, 0, 0] }]);
    const weight = (16000 / 1000 / 1000) * 9.81;
    expect(s.factor).toBeCloseTo((weight * 10) / (0.1 * 40), 9);
    // Pushing down inside the footprint never tips it.
    const down = stability(box(0, 0, 0, 20, 40, 20), 1, [{ at: [10, 40, 10], force: [0, -5, 0] }]);
    expect(down.factor).toBe(Infinity);
  });

  it('knows an overhanging L tips when its centre of mass is outside the foot', () => {
    // A thin foot with a heavy arm reaching far out past it.
    const foot = box(0, 0, 0, 10, 2, 10);
    const post = box(0, 2, 0, 2, 30, 10);
    const arm = box(0, 30, 0, 120, 40, 10);
    const s = stability(merge(foot, post, arm), 1);
    expect(s.standsAlone).toBe(false);
    expect(s.weakest!.margin).toBeLessThan(0);
    expect(s.factor).toBe(0);
  });

  it('moves the centre of mass with a carried weight and tips sooner', () => {
    // A 10 x 10 x 10 cube of density 1 weighs 1 g (0.00981 N); hang 0.00981 N at its top edge corner line.
    const alone = stability(box(0, 0, 0, 10, 10, 10), 1);
    const w = (1 / 1000) * 9.81;
    const loaded = stability(box(0, 0, 0, 10, 10, 10), 1, [], 0.2, [{ at: [10, 10, 5], newtons: w }]);
    // Combined centre: x = (5 + 10) / 2 = 7.5, y = (5 + 10) / 2 = 7.5; over the x = 10 edge: atan(2.5 / 7.5).
    expect(loaded.comLoaded[0]).toBeCloseTo(7.5, 9);
    expect(loaded.comLoaded[1]).toBeCloseTo(7.5, 9);
    expect(loaded.com[0]).toBeCloseTo(5, 9);
    expect(loaded.weakest!.tipDeg).toBeCloseTo((Math.atan(2.5 / 7.5) * 180) / Math.PI, 9);
    expect(loaded.weakest!.tipDeg).toBeLessThan(alone.weakest!.tipDeg);
  });

  it('builds a counter-clockwise hull without interior or collinear points', () => {
    const hull = convexHull([[0, 0], [5, 0], [10, 0], [10, 10], [5, 5], [0, 10]]);
    expect(hull).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
  });
});
