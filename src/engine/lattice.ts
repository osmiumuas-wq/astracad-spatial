/**
 * Lattice core: keep a solid skin of the part and fill the inside with a
 * gyroid sheet (the triply periodic minimal surface slicers use for infill),
 * so the part keeps its outside and loses weight inside.
 *
 * The kernel carves the CAD solid with a scalar field (Kernel.carve): material
 * stays where the field is positive. The field is the larger of
 *   skin - d(p)            (within `skin` of the surface)
 *   wall / 2 - |g(p)| / k  (on the gyroid sheet, `wall` thick)
 * where d(p) is the distance from p to the part's surface (inside), and
 * g = sin kx cos ky + sin ky cos kz + sin kz cos kx with k = 2 pi / cell.
 *
 * d(p) comes from the triangle mesh: inside voxels by ray parity along z,
 * then an exact Euclidean distance transform (Felzenszwalb and Huttenlocher)
 * of the voxel grid, sampled trilinearly. It is good to about half a voxel.
 */

import { Vec3 } from './types.js';

export interface DistanceGrid {
  origin: Vec3;
  h: number;
  nx: number;
  ny: number;
  nz: number;
  /** Distance to the surface (mm) inside, 0 outside; x fastest. */
  d: Float32Array;
}

/** Squared 1D distance transform of f (0 at sources, Infinity elsewhere), in place. */
function edt1d(f: Float64Array, n: number, v: Int32Array, z: Float64Array, out: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    if (f[q] === Infinity) continue;
    if (f[v[k]] === Infinity) {
      v[k] = q;
      continue;
    }
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  if (f[v[0]] === Infinity) {
    for (let q = 0; q < n; q++) out[q] = Infinity;
    return;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Distance from inside points to the surface of a closed triangle mesh, on a grid of spacing h (mm). */
export function insideDistance(positions: ArrayLike<number>, indices: ArrayLike<number>, h: number): DistanceGrid {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    x0 = Math.min(x0, positions[i]); x1 = Math.max(x1, positions[i]);
    y0 = Math.min(y0, positions[i + 1]); y1 = Math.max(y1, positions[i + 1]);
    z0 = Math.min(z0, positions[i + 2]); z1 = Math.max(z1, positions[i + 2]);
  }
  // One voxel of outside margin all round.
  const origin: Vec3 = [x0 - h, y0 - h, z0 - h];
  const nx = Math.ceil((x1 - x0) / h) + 3;
  const ny = Math.ceil((y1 - y0) / h) + 3;
  const nz = Math.ceil((z1 - z0) / h) + 3;
  const inside = new Uint8Array(nx * ny * nz);
  // Bin triangles by their xy footprint, then cast a ray along +z through each column centre.
  const bins: number[][] = Array.from({ length: nx * ny }, () => []);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ix0 = Math.max(0, Math.floor((Math.min(positions[a], positions[b], positions[c]) - origin[0]) / h - 0.5));
    const ix1 = Math.min(nx - 1, Math.ceil((Math.max(positions[a], positions[b], positions[c]) - origin[0]) / h - 0.5));
    const iy0 = Math.max(0, Math.floor((Math.min(positions[a + 1], positions[b + 1], positions[c + 1]) - origin[1]) / h - 0.5));
    const iy1 = Math.min(ny - 1, Math.ceil((Math.max(positions[a + 1], positions[b + 1], positions[c + 1]) - origin[1]) / h - 0.5));
    for (let j = iy0; j <= iy1; j++) for (let i = ix0; i <= ix1; i++) bins[j * nx + i].push(t);
  }
  const zs: number[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      // A tiny offset keeps the ray off shared edges and vertices.
      const px = origin[0] + (i + 0.5) * h + 1.3e-7;
      const py = origin[1] + (j + 0.5) * h + 0.7e-7;
      zs.length = 0;
      for (const t of bins[j * nx + i]) {
        const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
        const ax = positions[a], ay = positions[a + 1], bx = positions[b], by = positions[b + 1], cx = positions[c], cy = positions[c + 1];
        const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(det) < 1e-14) continue;
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
        const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        zs.push(l1 * positions[a + 2] + l2 * positions[b + 2] + l3 * positions[c + 2]);
      }
      if (zs.length < 2) continue;
      zs.sort((p, q) => p - q);
      for (let m = 0; m + 1 < zs.length; m += 2) {
        const k0 = Math.max(0, Math.ceil((zs[m] - origin[2]) / h - 0.5));
        const k1 = Math.min(nz - 1, Math.floor((zs[m + 1] - origin[2]) / h - 0.5));
        for (let k = k0; k <= k1; k++) inside[(k * ny + j) * nx + i] = 1;
      }
    }
  }
  // Squared distance (in voxels) to the nearest outside voxel, separably along x, y, z.
  const n = nx * ny * nz;
  const g = new Float64Array(n);
  for (let i = 0; i < n; i++) g[i] = inside[i] ? Infinity : 0;
  const m = Math.max(nx, ny, nz);
  const f = new Float64Array(m), out = new Float64Array(m), z = new Float64Array(m + 1);
  const v = new Int32Array(m);
  const pass = (len: number, count: number, at: (line: number, q: number) => number): void => {
    for (let line = 0; line < count; line++) {
      for (let q = 0; q < len; q++) f[q] = g[at(line, q)];
      edt1d(f, len, v, z, out);
      for (let q = 0; q < len; q++) g[at(line, q)] = out[q];
    }
  };
  pass(nx, ny * nz, (line, q) => line * nx + q);
  pass(ny, nx * nz, (line, q) => (Math.floor(line / nx) * ny + q) * nx + (line % nx));
  pass(nz, nx * ny, (line, q) => (q * ny + Math.floor(line / nx)) * nx + (line % nx));
  const d = new Float32Array(n);
  // Voxel centres are half a voxel from the surface at best: subtract that.
  for (let i = 0; i < n; i++) d[i] = inside[i] ? Math.max(0, Math.sqrt(g[i]) * h - h / 2) : 0;
  return { origin, h, nx, ny, nz, d };
}

/** Trilinear sample of the distance grid at p (mm). */
export function sampleDistance(grid: DistanceGrid, p: Vec3): number {
  const { origin, h, nx, ny, nz, d } = grid;
  const fx = Math.min(nx - 1.001, Math.max(0, (p[0] - origin[0]) / h - 0.5));
  const fy = Math.min(ny - 1.001, Math.max(0, (p[1] - origin[1]) / h - 0.5));
  const fz = Math.min(nz - 1.001, Math.max(0, (p[2] - origin[2]) / h - 0.5));
  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
  const u = fx - i, w = fy - j, t = fz - k;
  const at = (a: number, b: number, c: number): number => d[((k + c) * ny + (j + b)) * nx + (i + a)];
  const c00 = at(0, 0, 0) * (1 - u) + at(1, 0, 0) * u;
  const c10 = at(0, 1, 0) * (1 - u) + at(1, 1, 0) * u;
  const c01 = at(0, 0, 1) * (1 - u) + at(1, 0, 1) * u;
  const c11 = at(0, 1, 1) * (1 - u) + at(1, 1, 1) * u;
  return (c00 * (1 - w) + c10 * w) * (1 - t) + (c01 * (1 - w) + c11 * w) * t;
}

export interface LatticeSpec {
  /** Gyroid cell size, mm. */
  cell: number;
  /** Sheet thickness, mm. */
  wall: number;
  /** Solid skin kept under every surface, mm. */
  skin: number;
}

/** The gyroid value at p for cells of size `cell`. */
export function gyroid(p: Vec3, cell: number): number {
  const k = (2 * Math.PI) / cell;
  const x = k * p[0], y = k * p[1], z = k * p[2];
  return Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x);
}

/** The carving field: positive where material stays (skin or gyroid sheet). */
export function latticeField(grid: DistanceGrid, spec: LatticeSpec): (p: Vec3) => number {
  const k = (2 * Math.PI) / spec.cell;
  return (p) => {
    const skin = spec.skin - sampleDistance(grid, p);
    const sheet = spec.wall / 2 - Math.abs(gyroid(p, spec.cell)) / k;
    return Math.max(skin, sheet);
  };
}

/** A lattice sized for a part whose largest dimension is `size` mm. */
export function latticeFor(size: number): LatticeSpec {
  const cell = Math.min(14, Math.max(7, size / 6));
  return { cell, wall: Math.max(1.2, cell * 0.15), skin: 1.6 };
}

/** The deepest point inside the part, mm (half its thickest section). */
export function maxDepth(grid: DistanceGrid): number {
  let m = 0;
  for (let i = 0; i < grid.d.length; i++) m = Math.max(m, grid.d[i]);
  return m;
}
