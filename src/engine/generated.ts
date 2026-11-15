/**
 * Bodies generated as closed meshes: springs and coils (a wire swept along a
 * helix), subdivision (SubD) shapes (a cage of control points smoothed by
 * Catmull-Clark subdivision: grips, shells, car bodies), and blades (NACA
 * airfoil sections, tapered and twisted along a span: fans, propellers,
 * turbines). The kernel makes each a solid; the checker measures the same
 * generated mesh by the divergence theorem, independent of the booleans.
 */

import { SpecError } from './types.js';

export type V3 = [number, number, number];
export interface GenMesh {
  positions: number[];
  indices: number[];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

/** Volume of a closed mesh (positive when its faces point outwards). */
export function meshVolume(m: GenMesh): number {
  let v = 0;
  const p = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t] * 3;
    const b = m.indices[t + 1] * 3;
    const c = m.indices[t + 2] * 3;
    v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return v;
}

export function meshBox(m: GenMesh): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], m.positions[i + k]);
      max[k] = Math.max(max[k], m.positions[i + k]);
    }
  }
  return { min, max };
}

/** Flip every triangle when the mesh's volume is negative (faces pointing in). */
function outward(m: GenMesh): GenMesh {
  if (meshVolume(m) >= 0) return m;
  for (let t = 0; t < m.indices.length; t += 3) {
    const x = m.indices[t + 1];
    m.indices[t + 1] = m.indices[t + 2];
    m.indices[t + 2] = x;
  }
  return m;
}

/** An axis and two directions square to it, from a vector. */
function frameOf(axis: V3): { a: V3; u: V3; v: V3 } {
  const a = unit(axis);
  const u = unit(cross(Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], a));
  return { a, u, v: cross(a, u) };
}

/** A tube along a polyline of centre points with given frames: rings of `sides` points, capped at both ends. */
function tube(centres: V3[], normals: V3[], binormals: V3[], section: [number, number][]): GenMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const k = section.length;
  centres.forEach((c, i) => {
    for (const [x, y] of section) positions.push(...add(c, add(mul(normals[i], x), mul(binormals[i], y))));
  });
  const n = centres.length;
  for (let i = 0; i + 1 < n; i++) {
    for (let j = 0; j < k; j++) {
      const a = i * k + j;
      const b = i * k + ((j + 1) % k);
      const c = (i + 1) * k + j;
      const d = (i + 1) * k + ((j + 1) % k);
      indices.push(a, c, b, b, c, d);
    }
  }
  // End caps: a centre vertex each.
  const c0 = positions.length / 3;
  positions.push(...centres[0]);
  const c1 = positions.length / 3;
  positions.push(...centres[n - 1]);
  for (let j = 0; j < k; j++) {
    indices.push(c0, j, (j + 1) % k);
    indices.push(c1, (n - 1) * k + ((j + 1) % k), (n - 1) * k + j);
  }
  return outward({ positions, indices });
}

export interface SpringSpec {
  origin: V3;
  axis: V3;
  /** Mean coil diameter, wire diameter (or width and height of a rectangular wire), pitch, active turns. */
  D: number;
  d: number;
  w?: number;
  h?: number;
  pitch: number;
  turns: number;
  /** Closed ends: the last three quarters of a turn at each end close to the wire's thickness. */
  closed: boolean;
}

/** A compression spring or any coil: the wire's section, square to the helix, swept along it. */
export function springMesh(s: SpringSpec): GenMesh {
  const R = s.D / 2;
  const rect = s.w && s.h;
  const thick = rect ? (s.h as number) : s.d;
  if (!(R > 0 && thick > 0 && s.turns > 0)) throw new SpecError('a spring needs a coil diameter, a wire and turns');
  if (thick / 2 >= R) throw new SpecError('the wire is too thick for that coil diameter');
  const endTurns = s.closed ? 0.75 : 0;
  const total = s.turns + 2 * endTurns;
  const closePitch = thick * 1.02;
  if (s.pitch < thick * 1.02) throw new SpecError(`the pitch must be more than the wire (${thick} mm) or the coils pass through each other`);
  const per = 48;
  const steps = Math.ceil(total * per);
  const f = frameOf(s.axis);
  // Height as the integral of the pitch over the turns: closed ends at the wire's thickness.
  const pitchAt = (turn: number): number => (turn < endTurns || turn > total - endTurns ? closePitch : s.pitch);
  const centres: V3[] = [];
  const normals: V3[] = [];
  const binormals: V3[] = [];
  let z = thick / 2;
  for (let i = 0; i <= steps; i++) {
    const turn = (total * i) / steps;
    if (i > 0) z += (pitchAt(turn - total / steps / 2) * total) / steps;
    const th = 2 * Math.PI * turn;
    const radial: V3 = add(mul(f.u, Math.cos(th)), mul(f.v, Math.sin(th)));
    const c = add(s.origin, add(mul(radial, R), mul(f.a, z)));
    // Tangent of the helix; the section's x points at the axis (square to the tangent), y along the binormal.
    const tangent = unit(add(mul(add(mul(f.u, -Math.sin(th)), mul(f.v, Math.cos(th))), 2 * Math.PI * R), mul(f.a, pitchAt(turn))));
    const inward = unit(sub(mul(radial, -1), mul(tangent, dot(mul(radial, -1), tangent))));
    centres.push(c);
    normals.push(inward);
    binormals.push(cross(tangent, inward));
  }
  const sides = 24;
  const k = Math.sqrt((2 * Math.PI) / sides / Math.sin((2 * Math.PI) / sides));
  const section: [number, number][] = rect
    ? [[-(s.w as number) / 2, -(s.h as number) / 2], [(s.w as number) / 2, -(s.h as number) / 2], [(s.w as number) / 2, (s.h as number) / 2], [-(s.w as number) / 2, (s.h as number) / 2]].map(([x, y]) => [y, x] as [number, number])
    : Array.from({ length: sides }, (_, j) => [(s.d / 2) * k * Math.cos((2 * Math.PI * j) / sides), (s.d / 2) * k * Math.sin((2 * Math.PI * j) / sides)] as [number, number]);
  return tube(centres, normals, binormals, section);
}

/** The free length of a spring (its height, end to end). */
export function springLength(s: SpringSpec): number {
  const thick = s.w && s.h ? s.h : s.d;
  const endTurns = s.closed ? 0.75 : 0;
  return thick + s.turns * s.pitch + 2 * endTurns * thick * 1.02;
}

export interface SubdSpec {
  origin: V3;
  /** The cage box size and cells along x, y, z. */
  size: V3;
  cells: [number, number, number];
  /** Per cage vertex: an offset (x, y, z) and a push along its outward normal, by vertex index. */
  offsets: Record<number, { x?: number; y?: number; z?: number; n?: number }>;
  levels: number;
}

/** The cage: the box's surface as quads on a grid, vertex index by (i, j, k) on the surface. */
export function subdCage(s: SubdSpec): { verts: V3[]; quads: number[][]; normals: V3[]; key: Map<string, number> } {
  const [nx, ny, nz] = s.cells;
  const key = new Map<string, number>();
  const verts: V3[] = [];
  const normals: V3[] = [];
  const onSurface = (i: number, j: number, k: number): boolean => i === 0 || j === 0 || k === 0 || i === nx || j === ny || k === nz;
  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        if (!onSurface(i, j, k)) continue;
        key.set(`${i},${j},${k}`, verts.length);
        const p: V3 = [s.origin[0] - s.size[0] / 2 + (s.size[0] * i) / nx, s.origin[1] + (s.size[1] * j) / ny, s.origin[2] - s.size[2] / 2 + (s.size[2] * k) / nz];
        const nrm: V3 = unit([i === 0 ? -1 : i === nx ? 1 : 0, j === 0 ? -1 : j === ny ? 1 : 0, k === 0 ? -1 : k === nz ? 1 : 0]);
        const o = s.offsets[verts.length] ?? {};
        verts.push(add(add(p, [o.x ?? 0, o.y ?? 0, o.z ?? 0]), mul(nrm, o.n ?? 0)));
        normals.push(nrm);
      }
    }
  }
  const V = (i: number, j: number, k: number): number => key.get(`${i},${j},${k}`)!;
  const quads: number[][] = [];
  // Six faces, each wound outwards.
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    quads.push([V(0, j, k), V(0, j, k + 1), V(0, j + 1, k + 1), V(0, j + 1, k)]);
    quads.push([V(nx, j, k), V(nx, j + 1, k), V(nx, j + 1, k + 1), V(nx, j, k + 1)]);
  }
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    quads.push([V(i, 0, k), V(i + 1, 0, k), V(i + 1, 0, k + 1), V(i, 0, k + 1)]);
    quads.push([V(i, ny, k), V(i, ny, k + 1), V(i + 1, ny, k + 1), V(i + 1, ny, k)]);
  }
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    quads.push([V(i, j, 0), V(i, j + 1, 0), V(i + 1, j + 1, 0), V(i + 1, j, 0)]);
    quads.push([V(i, j, nz), V(i + 1, j, nz), V(i + 1, j + 1, nz), V(i, j + 1, nz)]);
  }
  return { verts, quads, normals, key };
}

/** One Catmull-Clark step on a closed quad mesh. */
function catmullClark(verts: V3[], quads: number[][]): { verts: V3[]; quads: number[][] } {
  const facePts = quads.map((q) => mul(q.reduce<V3>((s, i) => add(s, verts[i]), [0, 0, 0]), 1 / q.length));
  const edgeKey = (a: number, b: number): string => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const edgeFaces = new Map<string, number[]>();
  quads.forEach((q, f) => q.forEach((a, i) => {
    const k = edgeKey(a, q[(i + 1) % q.length]);
    edgeFaces.set(k, [...(edgeFaces.get(k) ?? []), f]);
  }));
  const edgePt = new Map<string, number>();
  const out: V3[] = [];
  // New positions of the old vertices.
  const vFaces: number[][] = verts.map(() => []);
  const vEdges: Set<number>[] = verts.map(() => new Set());
  quads.forEach((q, f) => q.forEach((a, i) => {
    vFaces[a].push(f);
    vEdges[a].add(q[(i + 1) % q.length]);
    vEdges[a].add(q[(i + q.length - 1) % q.length]);
  }));
  verts.forEach((p, i) => {
    const n = vFaces[i].length;
    const F = mul(vFaces[i].reduce<V3>((s, f) => add(s, facePts[f]), [0, 0, 0]), 1 / n);
    const Rm = mul([...vEdges[i]].reduce<V3>((s, j) => add(s, mul(add(p, verts[j]), 0.5)), [0, 0, 0]), 1 / vEdges[i].size);
    out.push(mul(add(add(F, mul(Rm, 2)), mul(p, n - 3)), 1 / n));
  });
  const faceIdx = facePts.map((fp) => {
    out.push(fp);
    return out.length - 1;
  });
  for (const [k, fs] of edgeFaces) {
    const [a, b] = k.split('_').map(Number);
    const e = mul(add(add(verts[a], verts[b]), add(facePts[fs[0]], facePts[fs[1] ?? fs[0]])), 0.25);
    out.push(e);
    edgePt.set(k, out.length - 1);
  }
  const nq: number[][] = [];
  quads.forEach((q, f) => {
    for (let i = 0; i < q.length; i++) {
      const a = q[i];
      const next = edgePt.get(edgeKey(a, q[(i + 1) % q.length]))!;
      const prev = edgePt.get(edgeKey(q[(i + q.length - 1) % q.length], a))!;
      nq.push([a, next, faceIdx[f], prev]);
    }
  });
  return { verts: out, quads: nq };
}

/** The SubD shape: the cage smoothed `levels` times (each level four times the faces). */
export function subdMesh(s: SubdSpec): GenMesh {
  const c = subdCage(s);
  let m: { verts: V3[]; quads: number[][] } = { verts: c.verts, quads: c.quads };
  for (let l = 0; l < Math.max(0, Math.min(4, s.levels)); l++) m = catmullClark(m.verts, m.quads);
  const positions = m.verts.flat();
  const indices: number[] = [];
  for (const q of m.quads) indices.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  return outward({ positions, indices });
}

export interface BladeSpec {
  origin: V3;
  /** The span direction (a blade stands out from the hub along it) and the rotation axis of a fan. */
  axis: V3;
  naca: string;
  span: number;
  rootChord: number;
  tipChord: number;
  rootTwist: number;
  tipTwist: number;
  /** Blades round the axis (a fan or propeller), the hub radius and height. */
  count: number;
  hubR: number;
  hubH: number;
}

/** A NACA 4-digit airfoil (closed trailing edge), `n` points round, chord 1, leading edge at x = 0. */
export function naca4(code: string, n = 60): [number, number][] {
  const m = parseInt(code[0], 10) / 100;
  const p = parseInt(code[1], 10) / 10;
  const t = parseInt(code.slice(2), 10) / 100;
  if (!(t > 0) || code.length !== 4) throw new SpecError('a NACA airfoil is four digits, for example 2412');
  const yt = (x: number): number => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const camber = (x: number): [number, number] => {
    if (m === 0 || p === 0) return [0, 0];
    return x < p ? [(m / (p * p)) * (2 * p * x - x * x), ((2 * m) / (p * p)) * (p - x)] : [(m / (1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x * x), ((2 * m) / (1 - p) ** 2) * (p - x)];
  };
  const half = Math.floor(n / 2);
  const xs = Array.from({ length: half + 1 }, (_, i) => (1 - Math.cos((Math.PI * i) / half)) / 2);
  const pt = (x: number, upper: boolean): [number, number] => {
    const [yc, dy] = camber(x);
    const th = Math.atan(dy);
    const s = upper ? 1 : -1;
    return [x - s * yt(x) * Math.sin(th), yc + s * yt(x) * Math.cos(th)];
  };
  // Trailing edge to leading edge along the top, back along the bottom (anticlockwise).
  const top = xs.slice().reverse().map((x) => pt(x, true));
  const bottom = xs.slice(1, -1).map((x) => pt(x, false));
  return [...top, ...bottom];
}

/** A blade (or several round a hub): airfoil sections along the span, scaled by chord and turned by twist. */
export function bladeMesh(s: BladeSpec): GenMesh {
  const f = frameOf(s.axis);
  const foil = naca4(s.naca);
  const sections = 24;
  const positions: number[] = [];
  const indices: number[] = [];
  const count = Math.max(1, Math.round(s.count));
  for (let b = 0; b < count; b++) {
    const ang = (2 * Math.PI * b) / count;
    // Span direction for this blade: out from the axis (radial), or along the axis for a single blade (count 1, no hub).
    const radial = count > 1 || s.hubR > 0 ? add(mul(f.u, Math.cos(ang)), mul(f.v, Math.sin(ang))) : f.a;
    const chordDir = count > 1 || s.hubR > 0 ? cross(f.a, radial) : f.u;
    const thickDir = count > 1 || s.hubR > 0 ? f.a : f.v;
    const base = positions.length / 3;
    const k = foil.length;
    for (let i = 0; i <= sections; i++) {
      const t = i / sections;
      const chord = s.rootChord + (s.tipChord - s.rootChord) * t;
      const tw = ((s.rootTwist + (s.tipTwist - s.rootTwist) * t) * Math.PI) / 180;
      // Roots start a fifth of the hub radius inside it, so the blades fuse with the hub.
      const r = s.hubR * 0.8 + s.span * t;
      const centre = add(s.origin, add(mul(radial, r), count > 1 || s.hubR > 0 ? mul(f.a, s.hubH / 2) : [0, 0, 0]));
      for (const [x, y] of foil) {
        // About the quarter chord, turned by the twist.
        const cx = (x - 0.25) * chord;
        const cy = y * chord;
        const xr = cx * Math.cos(tw) - cy * Math.sin(tw);
        const yr = cx * Math.sin(tw) + cy * Math.cos(tw);
        positions.push(...add(centre, add(mul(chordDir, xr), mul(thickDir, yr))));
      }
    }
    for (let i = 0; i < sections; i++) {
      for (let j = 0; j < k; j++) {
        const a = base + i * k + j;
        const bb = base + i * k + ((j + 1) % k);
        const c = base + (i + 1) * k + j;
        const d = base + (i + 1) * k + ((j + 1) % k);
        indices.push(a, bb, c, bb, d, c);
      }
    }
    // Caps: fans from each end's centre.
    const c0 = positions.length / 3;
    const centreOf = (row: number): V3 => {
      let acc: V3 = [0, 0, 0];
      for (let j = 0; j < k; j++) acc = add(acc, [positions[(base + row * k + j) * 3], positions[(base + row * k + j) * 3 + 1], positions[(base + row * k + j) * 3 + 2]]);
      return mul(acc, 1 / k);
    };
    positions.push(...centreOf(0));
    const c1 = positions.length / 3;
    positions.push(...centreOf(sections));
    for (let j = 0; j < k; j++) {
      indices.push(c0, base + ((j + 1) % k), base + j);
      indices.push(c1, base + sections * k + j, base + sections * k + ((j + 1) % k));
    }
  }
  return outward({ positions, indices });
}

export type GeneratedKind = 'spring' | 'subd' | 'blade';

/** The mesh of a generated body (blades without their hub: the kernel adds it). */
export function generate(kind: GeneratedKind, spec: unknown): GenMesh {
  if (kind === 'spring') return springMesh(spec as SpringSpec);
  if (kind === 'subd') return subdMesh(spec as SubdSpec);
  if (kind === 'blade') return bladeMesh(spec as BladeSpec);
  throw new SpecError(`unknown generated body "${String(kind)}"`);
}

