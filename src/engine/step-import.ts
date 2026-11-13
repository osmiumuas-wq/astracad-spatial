/**
 * STEP import: OpenCascade (occt-import-js, an Emscripten build of OCCT's STEP
 * reader, LGPL-2.1, loaded only when a file is opened) tessellates the file;
 * the meshes are merged into one triangle set in millimetres.
 *
 * The volume is computed from the closed triangle mesh by the divergence
 * theorem, so a tessellated curved part reads slightly under its exact
 * volume (the chords cut inside the arcs). The import is a reference model:
 * it is measured, shown on the bench and can be fitted with a cradle, but it
 * is not turned back into editable features.
 */

import type { Box3 } from './types.js';

export interface ImportedMesh {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  /** mm3; NaN when the mesh is not closed. */
  volume: number;
  box: Box3;
  bodies: number;
  closed: boolean;
}

interface OcctMesh {
  name?: string;
  attributes: { position: { array: ArrayLike<number> } };
  index: { array: ArrayLike<number> };
}

export interface Occt {
  ReadStepFile(content: Uint8Array, params: Record<string, unknown> | null): { success: boolean; meshes: OcctMesh[] };
}

/** Read a STEP file into one mesh, in millimetres. */
export function readStep(occt: Occt, bytes: Uint8Array, name = 'part'): ImportedMesh {
  const res = occt.ReadStepFile(bytes, {
    linearUnit: 'millimeter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.001,
    angularDeflection: 0.3,
  });
  if (!res.success || !res.meshes.length) {
    throw new Error('That file could not be read as STEP, or it holds no solid.');
  }
  let nv = 0;
  let ni = 0;
  for (const m of res.meshes) {
    nv += m.attributes.position.array.length;
    ni += m.index.array.length;
  }
  const positions = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const m of res.meshes) {
    positions.set(m.attributes.position.array as ArrayLike<number>, vo);
    const base = vo / 3;
    const idx = m.index.array;
    for (let i = 0; i < idx.length; i++) indices[io + i] = idx[i] + base;
    vo += m.attributes.position.array.length;
    io += idx.length;
  }
  return measure(name, positions, indices, res.meshes.length);
}

/** Volume (divergence theorem), bounding box and closedness of a triangle set. */
export function measure(name: string, positions: Float32Array, indices: Uint32Array, bodies = 1): ImportedMesh {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], positions[i + a]);
      max[a] = Math.max(max[a], positions[i + a]);
    }
  }
  // Signed volume about the box centre (smaller round-off than about the origin).
  const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  let v6 = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, d = indices[t + 2] * 3;
    const ax = positions[a] - c[0], ay = positions[a + 1] - c[1], az = positions[a + 2] - c[2];
    const bx = positions[b] - c[0], by = positions[b + 1] - c[1], bz = positions[b + 2] - c[2];
    const dx = positions[d] - c[0], dy = positions[d + 1] - c[1], dz = positions[d + 2] - c[2];
    v6 += ax * (by * dz - bz * dy) - ay * (bx * dz - bz * dx) + az * (bx * dy - by * dx);
  }
  // Closed when every edge (welded by position) is shared by exactly two triangles.
  const key = (i: number): string =>
    `${Math.round(positions[i * 3] * 1e3)},${Math.round(positions[i * 3 + 1] * 1e3)},${Math.round(positions[i * 3 + 2] * 1e3)}`;
  const edges = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const p = key(indices[t + e]);
      const q = key(indices[t + ((e + 1) % 3)]);
      if (p === q) continue;
      const k = p < q ? `${p}|${q}` : `${q}|${p}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let closed = edges.size > 0;
  for (const n of edges.values()) {
    if (n !== 2) {
      closed = false;
      break;
    }
  }
  return { name, positions, indices, volume: closed ? Math.abs(v6) / 6 : NaN, box: { min, max }, bodies, closed };
}

export type Recognised =
  | { shape: 'block'; x: number; y: number; h: number }
  | { shape: 'cylinder'; d: number; h: number };

/**
 * Reverse engineering for the simplest solids: a closed mesh whose volume is
 * its box's volume is a block; one whose volume is pi/4 of its box, with two
 * equal sides, is a cylinder (diameter = the equal sides, height = the third).
 * The tolerances allow for the facets of a tessellated cylinder. Anything else
 * returns null and stays a reference model.
 */
export function recognise(m: ImportedMesh): Recognised | null {
  if (!m.closed || !Number.isFinite(m.volume) || m.bodies !== 1) return null;
  const e = [0, 1, 2].map((a) => m.box.max[a] - m.box.min[a]);
  const boxVol = e[0] * e[1] * e[2];
  if (Math.abs(m.volume - boxVol) / boxVol < 1e-4) {
    // Laid flat: X long, Z across, Y up.
    return { shape: 'block', x: e[0], y: e[2], h: e[1] };
  }
  const ratio = m.volume / boxVol;
  if (Math.abs(ratio - Math.PI / 4) / (Math.PI / 4) < 0.01) {
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3;
      const c = (a + 2) % 3;
      if (Math.abs(e[b] - e[c]) / Math.max(e[b], e[c]) < 0.005) {
        // The facets sit just inside the true circle: a 25 mm shaft spans 24.98. Snap to the
        // 0.05 mm step when that close, as a designed size would be.
        const raw = (e[b] + e[c]) / 2;
        const step = Math.round(raw * 20) / 20;
        return { shape: 'cylinder', d: Math.abs(raw - step) < 0.05 ? step : raw, h: e[a] };
      }
    }
  }
  return null;
}

/**
 * Lay the part flat: its smallest extent becomes the height (Y), with proper
 * rotations only (no mirroring), centred over the origin and standing on y = 0.
 */
export function layFlat(m: ImportedMesh): ImportedMesh {
  const ext = [0, 1, 2].map((a) => m.box.max[a] - m.box.min[a]);
  const smallest = ext.indexOf(Math.min(...ext));
  const p = new Float32Array(m.positions.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = m.positions[i], y = m.positions[i + 1], z = m.positions[i + 2];
    if (smallest === 2) {
      // (x, y, z) -> (x, z, -y)
      p[i] = x; p[i + 1] = z; p[i + 2] = -y;
    } else if (smallest === 0) {
      // (x, y, z) -> (y, x, -z)
      p[i] = y; p[i + 1] = x; p[i + 2] = -z;
    } else {
      p[i] = x; p[i + 1] = y; p[i + 2] = z;
    }
  }
  // Long side along X, as the cradle's length is.
  {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]);
      z0 = Math.min(z0, p[i + 2]); z1 = Math.max(z1, p[i + 2]);
    }
    if (z1 - z0 > x1 - x0) {
      for (let i = 0; i < p.length; i += 3) {
        // (x, y, z) -> (z, y, -x): a quarter turn about Y
        const x = p[i];
        p[i] = p[i + 2];
        p[i + 2] = -x;
      }
    }
  }
  const turned = measure(m.name, p, m.indices, m.bodies);
  const { min, max } = turned.box;
  const off = [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2];
  for (let i = 0; i < p.length; i += 3) {
    p[i] += off[0];
    p[i + 1] += off[1];
    p[i + 2] += off[2];
  }
  return { ...turned, positions: p, box: { min: [min[0] + off[0], 0, min[2] + off[2]], max: [max[0] + off[0], max[1] + off[1], max[2] + off[2]] } };
}
