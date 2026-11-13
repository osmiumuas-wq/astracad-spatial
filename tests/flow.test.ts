import { describe, expect, it } from 'vitest';
import { flowField, solveFlow, velocityAt } from '../src/engine/flow.js';

/** A closed hemisphere of radius R standing on y = 0. */
function hemisphere(R: number, rings = 24, segs = 48): { positions: Float32Array; indices: Uint32Array } {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const th = (r / rings) * (Math.PI / 2); // 0 at the top, pi/2 at the base
    for (let s = 0; s < segs; s++) {
      const ph = (s / segs) * 2 * Math.PI;
      pos.push(R * Math.sin(th) * Math.cos(ph), R * Math.cos(th), R * Math.sin(th) * Math.sin(ph));
    }
  }
  const at = (r: number, s: number): number => r * segs + (s % segs);
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      idx.push(at(r, s), at(r, s + 1), at(r + 1, s + 1), at(r, s), at(r + 1, s + 1), at(r + 1, s));
    }
  }
  const centre = pos.length / 3;
  pos.push(0, 0, 0);
  for (let s = 0; s < segs; s++) idx.push(centre, at(rings, s), at(rings, s + 1));
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

describe('air-flow preview (ideal flow)', () => {
  // A hemisphere on a wall is half of a sphere in open flow (mirror symmetry),
  // where the speed above the centre is U (1 + R^3 / (2 r^3)): 1.5 U on the surface.
  const R = 10;
  const { positions, indices } = hemisphere(R);
  const f = flowField(positions, indices, '+x', 90000);

  it('converges', () => {
    expect(f.residual).toBeLessThan(1e-4);
  });

  it('matches the sphere solution above the dome', () => {
    const v = [0, 0, 0];
    for (const r of [R + 2 * f.h, R + 4 * f.h, 1.8 * R]) {
      expect(velocityAt(f, 0, r, 0, v)).toBe(true);
      const theory = 1 + R ** 3 / (2 * r ** 3);
      const got = Math.hypot(v[0], v[1], v[2]);
      expect(Math.abs(got - theory) / theory).toBeLessThan(0.06);
    }
  });

  it('stalls in front of the dome and keeps the oncoming speed far away', () => {
    const v = [0, 0, 0];
    velocityAt(f, -R - f.h, 0.6 * f.h, 0, v);
    expect(Math.hypot(v[0], v[1], v[2])).toBeLessThan(0.35);
    velocityAt(f, f.origin[0] + 2 * f.h, f.origin[1] + (f.ny - 2) * f.h, f.origin[2] + 2 * f.h, v);
    expect(Math.abs(Math.hypot(v[0], v[1], v[2]) - 1)).toBeLessThan(0.05);
  });

  it('carries the same air past every cross-section', () => {
    const flux = (i: number): number => {
      let q = 0;
      for (let k = 0; k < f.nz; k++) {
        for (let j = 0; j < f.ny; j++) {
          const c = i + f.nx * (j + f.ny * k);
          if (!f.solid[c]) q += f.vel[c * 3];
        }
      }
      return q;
    };
    const mid = Math.floor(f.nx / 2);
    const inlet = flux(2);
    for (const i of [mid, f.nx - 3]) expect(Math.abs(flux(i) - inlet) / inlet).toBeLessThan(0.03);
  });

  it('traces streamlines around the part', () => {
    const res = solveFlow(positions, indices, '+x', 40000);
    expect(res.starts.length).toBeGreaterThan(30);
    expect(res.points.length / 3).toBe(res.speeds.length);
    // No streamline point inside the dome.
    for (let p = 0; p < res.points.length; p += 3) {
      expect(Math.hypot(res.points[p], res.points[p + 1], res.points[p + 2])).toBeGreaterThan(R - res.h);
    }
  });
});
