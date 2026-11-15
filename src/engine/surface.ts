/**
 * Freeform surfacing: a B-spline surface patch (clamped, cubic for four or
 * more control points a side, the same basis a NURBS patch with unit weights
 * uses) over a rectangle, its control points' heights pulled by hand. The
 * patch becomes a solid either as a sheet thickened straight down by t, or
 * filled down to its base plane.
 *
 * The solid is the surface sampled on a regular grid. Its volume is exact for
 * that grid: a thickened sheet is area x t whatever its shape, and a filled
 * patch is the sum over the grid's triangles, which the checker computes from
 * the same samples.
 */

export interface SurfacePatch {
  /** Centre of the rectangle on its base plane (mm). */
  origin: [number, number, number];
  /** Rectangle size along x and z (mm). */
  sx: number;
  sz: number;
  /** Control points a side (2 to 8), and their heights above the base, row by row (z rows of x). */
  n: number;
  heights: number[];
  /** Sheet thickness; 0 fills down to the base plane. */
  thickness: number;
}

import { SpecError } from './types.js';

/** A surface feature's arguments, checked. */
export function surfacePatchOf(a: Record<string, unknown>): SurfacePatch {
  const n = Math.round(Number(a.n));
  const heights = a.heights as number[];
  if (!(n >= 2 && n <= 8) || !Array.isArray(heights) || heights.length !== n * n || heights.some((h) => !Number.isFinite(h))) {
    throw new SpecError('a surface needs 2 to 8 control points a side and a height for each');
  }
  const sx = Number(a.sx);
  const sz = Number(a.sz);
  const t = Number(a.thickness ?? 0);
  if (!(sx > 0 && sz > 0) || !(t >= 0)) throw new SpecError('a surface needs a positive size and thickness');
  return { origin: a.origin as [number, number, number], sx, sz, n, heights, thickness: t };
}

/** Samples a side. */
export const SURFACE_GRID = 32;

/** Clamped B-spline basis values N_i,p(t) for n control points, degree min(3, n - 1). */
function basis(n: number, t: number): number[] {
  const p = Math.min(3, n - 1);
  const m = n + p + 1;
  const knots: number[] = [];
  for (let i = 0; i < m; i++) knots.push(i <= p ? 0 : i >= n ? 1 : (i - p) / (n - p));
  const tt = Math.min(t, 1 - 1e-12);
  let N: number[] = knots.slice(0, m - 1).map((k, i) => (tt >= k && tt < knots[i + 1] ? 1 : 0));
  for (let d = 1; d <= p; d++) {
    const next: number[] = [];
    for (let i = 0; i < m - 1 - d; i++) {
      const a = knots[i + d] - knots[i];
      const b = knots[i + d + 1] - knots[i + 1];
      next.push((a > 0 ? ((tt - knots[i]) / a) * N[i] : 0) + (b > 0 ? ((knots[i + d + 1] - tt) / b) * N[i + 1] : 0));
    }
    N = next;
  }
  return N.slice(0, n);
}

/** Height of the surface at (u, v) in [0, 1]^2 (u along x, v along z). */
export function surfaceHeight(s: SurfacePatch, u: number, v: number): number {
  const bu = basis(s.n, u);
  const bv = basis(s.n, v);
  let h = 0;
  for (let j = 0; j < s.n; j++) for (let i = 0; i < s.n; i++) h += bu[i] * bv[j] * (s.heights[j * s.n + i] ?? 0);
  return h;
}

/** The sampled top (and bottom) heights on the grid: (G + 1)^2 values each, x fastest. */
export function surfaceSamples(s: SurfacePatch): { top: Float64Array; bottom: Float64Array } {
  const G = SURFACE_GRID;
  const top = new Float64Array((G + 1) * (G + 1));
  const bottom = new Float64Array((G + 1) * (G + 1));
  for (let j = 0; j <= G; j++) {
    for (let i = 0; i <= G; i++) {
      const h = surfaceHeight(s, i / G, j / G);
      const k = j * (G + 1) + i;
      if (s.thickness > 0) {
        top[k] = s.origin[1] + h;
        bottom[k] = top[k] - s.thickness;
      } else {
        // Filled to the base: never thinner than 0.2 mm, so the solid stays one closed body.
        top[k] = s.origin[1] + Math.max(0.2, h);
        bottom[k] = s.origin[1];
      }
    }
  }
  return { top, bottom };
}

/** The volume of the sampled solid: each grid square split into two triangles, prism volumes summed. */
export function surfaceVolume(s: SurfacePatch): number {
  const G = SURFACE_GRID;
  const { top, bottom } = surfaceSamples(s);
  const dx = s.sx / G;
  const dz = s.sz / G;
  let v = 0;
  const th = (k: number): number => top[k] - bottom[k];
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const a = j * (G + 1) + i;
      const b = a + 1;
      const c = a + (G + 1);
      const d = c + 1;
      // Triangles (a, c, b) and (b, c, d): each a prism of area dx dz / 2 and mean thickness.
      v += ((dx * dz) / 2) * ((th(a) + th(c) + th(b)) / 3 + (th(b) + th(c) + th(d)) / 3);
    }
  }
  return v;
}

/** The solid as a closed triangle mesh (outward faces). */
export function surfaceMesh(s: SurfacePatch): { positions: Float32Array; indices: Uint32Array } {
  const G = SURFACE_GRID;
  const W = G + 1;
  const { top, bottom } = surfaceSamples(s);
  const pos: number[] = [];
  const x0 = s.origin[0] - s.sx / 2;
  const z0 = s.origin[2] - s.sz / 2;
  for (const layer of [top, bottom]) {
    for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) pos.push(x0 + (s.sx * i) / G, layer[j * W + i], z0 + (s.sz * j) / G);
  }
  const T = (i: number, j: number): number => j * W + i;
  const B = (i: number, j: number): number => W * W + j * W + i;
  const idx: number[] = [];
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      // Top faces up (+y): (i,j), (i,j+1), (i+1,j) ...; the bottom the other way round.
      idx.push(T(i, j), T(i, j + 1), T(i + 1, j), T(i + 1, j), T(i, j + 1), T(i + 1, j + 1));
      idx.push(B(i, j), B(i + 1, j), B(i, j + 1), B(i + 1, j), B(i + 1, j + 1), B(i, j + 1));
    }
  }
  // Four sides, each a strip of quads between the top and bottom edges, wound outwards.
  const side = (a: [number, number], b: [number, number], out: [number, number]): void => {
    const [ai, aj] = a;
    const [bi, bj] = b;
    const P = (k: number): number[] => pos.slice(k * 3, k * 3 + 3);
    const ta = T(ai, aj), tb = T(bi, bj), ba = B(ai, aj), bb = B(bi, bj);
    // Normal of (ta, ba, tb): flip when it points inwards.
    const p0 = P(ta), p1 = P(ba), p2 = P(tb);
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const w = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const nx = u[1] * w[2] - u[2] * w[1];
    const nz = u[0] * w[1] - u[1] * w[0];
    if (nx * out[0] + nz * out[1] >= 0) idx.push(ta, ba, tb, tb, ba, bb);
    else idx.push(ta, tb, ba, tb, bb, ba);
  };
  for (let k = 0; k < G; k++) {
    side([0, k], [0, k + 1], [-1, 0]);
    side([G, k], [G, k + 1], [1, 0]);
    side([k, 0], [k + 1, 0], [0, -1]);
    side([k, G], [k + 1, G], [0, 1]);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** A box that holds the solid. */
export function surfaceBox(s: SurfacePatch): { min: [number, number, number]; max: [number, number, number] } {
  const { top, bottom } = surfaceSamples(s);
  return {
    min: [s.origin[0] - s.sx / 2, Math.min(...bottom), s.origin[2] - s.sz / 2],
    max: [s.origin[0] + s.sx / 2, Math.max(...top), s.origin[2] + s.sz / 2],
  };
}
