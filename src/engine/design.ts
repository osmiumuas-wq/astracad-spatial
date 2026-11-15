/**
 * Free design: a CAD feature list built on the bench, one feature at a time,
 * by voice, buttons and hands. It is an ordinary job whose parameters encode
 * the features, so everything that works on a part (build, truth gate, stress
 * test, explore, slice, export, undo) works on a design unchanged.
 *
 * Encoding: `nf` features; feature i has op code `o{i}` and up to eight sizes
 * `a{i}` .. `h{i}`. Outlines for sketch extrusions live in `q{k}n`,
 * `q{k}x{j}`, `q{k}y{j}`. Coordinates: millimetres, +Y up, the bench at y = 0;
 * a position is (x, z) on the bench and y up from it.
 *
 *   1 BOX     a w (x), b d (z), c h (y), d x, e z, f y
 *   2 CYL     a diameter, c h, d x, e z, f y
 *   3 CUTBOX  as BOX, removed
 *   4 HOLE    a diameter, b depth (0 = through), d x, e z, f top y   (drilled down)
 *   5 FILLET  a radius, b feature index (a BOX/CYL/CUTBOX: its vertical edges)
 *   6 SHELL   a thickness, b feature index (open at the top)
 *   7 LINPAT  a count, b feature index, c spacing, d axis (0 x, 1 z)
 *   8 CIRCPAT a count, b feature index, d centre x, e centre z
 *   9 OUTLINE a outline index, c h, f y, g 0 add / 1 cut
 *  10 BORE    a diameter, c depth, d x, e z, f y  (a cylinder removed, upwards from f)
 *  11 CHAMFER a distance, b feature index (its upright edges)
 *  12 MIRROR  a plane (0 x, 1 y, 2 z), b offset: everything so far, mirrored and joined
 *  13 REVOLVE a outline index, b angle (deg), d x, e y, f z origin, g normal code: the outline turned about
 *             its plane's upright axis through the origin (a turned part: a knob, a bottle, a wheel)
 *  15 EDGE    a radius or distance, b 0 fillet / 1 chamfer, c d e one end, f g h the other end:
 *             a fillet or chamfer of any straight edge between two flat faces
 *  16 ROUND   a radius, b 1 = every edge, c d e a point on the edge, f 1 = chamfer (straight or circular edges):
 *             a rolling-ball fillet of any edge,
 *             straight or curved, following tangent edges; rounds in a row with one radius blend their corners
 *  17 FCIRC   a diameter, b normal code, c depth (a cut: 0 = right through), d e f centre, g 0 boss / 1 cut:
 *             an exact circle on any flat face (a hole on any face, a boss, a counterbore)
 *  18 GEAR    a module, b teeth, c thickness, d e f centre, g normal code, h bore: an ISO involute spur gear
 *  19 THREAD  a major diameter, b pitch, c length, d e f start, g normal code (the thread runs along it),
 *             h 1 = internal (tapped into a hole) / 0 = a threaded rod
 *  20 LOFT    a outline A, b outline B, c distance, d e f origin, g normal code: from A on the plane to B, c along
 *  21 SWEEP   a profile outline, b path (an outline with z: its points in mm), c bend radius: the profile,
 *             square to the path's first run, swept along it with round bends (a pipe, a handle, a rail)
 *  22 RIB     a thickness, b length along the floor, c height up the wall, d e f corner (on the floor, at
 *             the wall), g normal code of the wall face (2 to 5): a triangular gusset centred on its plane
 *  23 BASE    a imported solid (its slot), b c min / max x, d e min / max y, f g min / max z: an imported
 *             STEP model as a body, so holes, bosses, fillets and chamfers can be added to it
 * Bosses (BOX, CYL, OUTLINE, FACE, FCIRC) take h = draft angle in degrees.
 *  14 FACE    a outline index, b normal code, c depth, d x, e y, f z origin, g 0 boss / 1 cut:
 *             a sketch on any flat face, pulled out of it or cut into it
 *
 * Normal codes: 0 +Y, 1 -Y, 2 +X, 3 -X, 4 +Z, 5 -Z.
 */

import type { Feature, PartSpec } from './types.js';
import { gearOutline, polygonOutline, rectOutline, slotOutline } from './profiles.js';
import type { HandleDef, Job, LoadCase, ParamDef, Params } from './jobs.js';

export const OPS = { BOX: 1, CYL: 2, CUTBOX: 3, HOLE: 4, FILLET: 5, SHELL: 6, LINPAT: 7, CIRCPAT: 8, OUTLINE: 9, BORE: 10, CHAMFER: 11, MIRROR: 12, REVOLVE: 13, FACE: 14, EDGE: 15, ROUND: 16, FCIRC: 17, GEAR: 18, THREAD: 19, LOFT: 20, SWEEP: 21, RIB: 22, BASE: 23 } as const;
export const OP_NAMES: Record<number, string> = { 1: 'Box', 2: 'Cylinder', 3: 'Cut box', 4: 'Hole', 5: 'Fillet', 6: 'Shell', 7: 'Pattern', 8: 'Circular pattern', 9: 'Sketch', 10: 'Bore', 11: 'Chamfer', 12: 'Mirror', 13: 'Revolve', 14: 'Face sketch', 15: 'Edge', 16: 'Fillet', 17: 'Circle', 18: 'Gear', 19: 'Thread', 20: 'Loft', 21: 'Sweep', 22: 'Rib', 23: 'Imported' };

/** Plane normal and in-plane axes per normal code; the sketch's y runs up (or back, on a flat top). */
export const FACE_FRAMES: { n: [number, number, number]; x: [number, number, number]; y: [number, number, number] }[] = [
  { n: [0, 1, 0], x: [1, 0, 0], y: [0, 0, -1] },
  { n: [0, -1, 0], x: [1, 0, 0], y: [0, 0, 1] },
  { n: [1, 0, 0], x: [0, 0, -1], y: [0, 1, 0] },
  { n: [-1, 0, 0], x: [0, 0, 1], y: [0, 1, 0] },
  { n: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] },
  { n: [0, 0, -1], x: [-1, 0, 0], y: [0, 1, 0] },
];

/** The normal code nearest a direction, or -1 when it is more than 10 degrees from every axis. */
export function normalCode(n: [number, number, number]): number {
  let best = -1;
  let bestDot = Math.cos((10 * Math.PI) / 180);
  FACE_FRAMES.forEach((f, i) => {
    const d = f.n[0] * n[0] + f.n[1] * n[1] + f.n[2] * n[2];
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  });
  return best;
}
const SLOTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const MAX_FEATURES = 24;

export interface DesignFeature {
  op: number;
  v: Record<(typeof SLOTS)[number], number>;
}

export function featureCount(p: Params): number {
  return Math.max(0, Math.min(MAX_FEATURES, Math.round(p.nf ?? 0)));
}

export function readFeature(p: Params, i: number): DesignFeature {
  const v = {} as DesignFeature['v'];
  for (const s of SLOTS) v[s] = p[`${s}${i}`] ?? 0;
  return { op: Math.round(p[`o${i}`] ?? 0), v };
}

/** The parameters with one more feature at the end. */
export function addFeature(p: Params, op: number, v: Partial<DesignFeature['v']>): Params {
  const i = featureCount(p);
  const out: Params = { ...p, nf: i + 1, [`o${i}`]: op };
  // A new feature is the one being edited.
  delete out.sel;
  for (const s of SLOTS) out[`${s}${i}`] = v[s] ?? 0;
  return out;
}

/** The parameters without the last feature (and any feature that referred to it). */
export function removeLast(p: Params): Params {
  const n = featureCount(p);
  if (!n) return p;
  const out: Params = { ...p, nf: n - 1 };
  for (const k of ['o', ...SLOTS]) delete out[`${k}${n - 1}`];
  return out;
}

export function addOutline(p: Params, pts: [number, number][], sweeps?: number[]): { params: Params; index: number } {
  let k = 0;
  while (`q${k}n` in p) k++;
  const out: Params = { ...p, [`q${k}n`]: pts.length };
  pts.forEach(([x, y], j) => {
    out[`q${k}x${j}`] = x;
    out[`q${k}y${j}`] = y;
    // An exact arc from this point to the next: its signed sweep in degrees (+ turns left, anticlockwise).
    if (sweeps?.[j]) out[`q${k}b${j}`] = sweeps[j];
  });
  return { params: out, index: k };
}

/** The arc from a to b turning `deg` degrees (+ anticlockwise) as a sketch arc segment. */
export function arcSeg(a: [number, number], b: [number, number], deg: number): ['A', number, number, number, number, number, number, 1 | -1] {
  const th = (Math.abs(deg) * Math.PI) / 180;
  const c = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const r = c / (2 * Math.sin(th / 2));
  const u = [(b[0] - a[0]) / c, (b[1] - a[1]) / c];
  const left = [-u[1], u[0]];
  const s = Math.sign(deg) * r * Math.cos(th / 2);
  const cx = (a[0] + b[0]) / 2 + left[0] * s;
  const cy = (a[1] + b[1]) / 2 + left[1] * s;
  return ['A', cx, cy, a[0], a[1], b[0], b[1], deg > 0 ? 1 : -1];
}

/** The outline's segments when it holds an arc (else null: a plain polygon). */
function outlineSegs(p: Params, k: number): unknown[] | null {
  const m = Math.round(p[`q${k}n`] ?? 0);
  let arcs = false;
  const segs: unknown[] = [];
  for (let j = 0; j < m; j++) {
    const a: [number, number] = [p[`q${k}x${j}`], p[`q${k}y${j}`]];
    const b: [number, number] = [p[`q${k}x${(j + 1) % m}`], p[`q${k}y${(j + 1) % m}`]];
    const sw = p[`q${k}b${j}`] ?? 0;
    if (sw) {
      arcs = true;
      segs.push(arcSeg(a, b, sw));
    } else segs.push(['L', a[0], a[1], b[0], b[1]]);
  }
  return arcs ? segs : null;
}

/** The sketch feature for an outline: exact arcs and lines when it has arcs, else a polygon. */
function outlineSketch(p: Params, k: number, id: string, on: string): Feature {
  const segs = outlineSegs(p, k);
  return segs ? { $op: 'sketch.loops', id, sketched_on: on, args: { loops: [segs] } } : { $op: 'sketch.profile', id, sketched_on: on, args: { points: outlinePts(p, k) } };
}

const isBody = (op: number): boolean => op === OPS.BOX || op === OPS.CYL || op === OPS.CUTBOX || op === OPS.OUTLINE || op === OPS.BORE || op === OPS.FACE || op === OPS.REVOLVE || op === OPS.FCIRC || op === OPS.GEAR || op === OPS.THREAD || op === OPS.LOFT || op === OPS.SWEEP || op === OPS.RIB || op === OPS.BASE;

function outlinePts(p: Params, k: number): [number, number][] {
  const m = Math.round(p[`q${k}n`] ?? 0);
  const pts: [number, number][] = [];
  for (let j = 0; j < m; j++) {
    pts.push([p[`q${k}x${j}`], p[`q${k}y${j}`]]);
    const sw = p[`q${k}b${j}`] ?? 0;
    if (!sw) continue;
    const [, cx, cy, ax, ay] = arcSeg([p[`q${k}x${j}`], p[`q${k}y${j}`]], [p[`q${k}x${(j + 1) % m}`], p[`q${k}y${(j + 1) % m}`]], sw);
    const steps = Math.max(2, Math.ceil(Math.abs(sw) / 7.5));
    const a0 = Math.atan2(ay - cy, ax - cx);
    const r = Math.hypot(ax - cx, ay - cy);
    for (let i = 1; i < steps; i++) {
      const a = a0 + (((sw * Math.PI) / 180) * i) / steps;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return pts;
}

/** A path: an outline whose points also carry z. */
export function addPath(p: Params, pts: [number, number, number][]): { params: Params; index: number } {
  const o = addOutline(p, pts.map(([x, y]) => [x, y]));
  pts.forEach(([, , z], j) => {
    o.params[`q${o.index}z${j}`] = z;
  });
  return o;
}

function pathPts(p: Params, k: number): [number, number, number][] {
  return outlinePts(p, k).map(([x, y], j) => [x, y, p[`q${k}z${j}`] ?? 0]);
}

/** A unit vector square to d (a sketch x axis for a plane facing d). */
function squareTo(d: [number, number, number]): [number, number, number] {
  const a: [number, number, number] = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const c: [number, number, number] = [a[1] * d[2] - a[2] * d[1], a[2] * d[0] - a[0] * d[2], a[0] * d[1] - a[1] * d[0]];
  const l = Math.hypot(c[0], c[1], c[2]) || 1;
  return [c[0] / l, c[1] / l, c[2] / l];
}

/**
 * Flat faces of the features before `upto` square to axis k (0 x, 1 y, 2 z): their exact coordinates.
 * A picked point is a few micrometres off its face (the mesh is float32); snapped onto it, a boss
 * starts exactly on the face and fuses with it, and the bodies touch without overlapping.
 */
function facePlanes(p: Params, upto: number, k: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.min(upto, featureCount(p)); i++) {
    const { op, v } = readFeature(p, i);
    if (op === OPS.BOX || op === OPS.CUTBOX) {
      if (k === 0) out.push(v.d - v.a / 2, v.d + v.a / 2);
      if (k === 1) out.push(v.f, v.f + v.c);
      if (k === 2) out.push(v.e - v.b / 2, v.e + v.b / 2);
    } else if (op === OPS.CYL || op === OPS.BORE || op === OPS.OUTLINE) {
      if (k === 1) out.push(v.f, v.f + v.c);
    } else if (op === OPS.FACE || op === OPS.FCIRC || op === OPS.GEAR || op === OPS.LOFT) {
      const code = Math.round(op === OPS.FACE || op === OPS.FCIRC ? v.b : v.g);
      const fr = FACE_FRAMES[Math.max(0, Math.min(5, code))];
      const axis = fr.n.findIndex((x) => Math.abs(x) > 0.5);
      if (axis !== k) continue;
      const o = [v.d, v.e, v.f][k];
      const cut = (op === OPS.FACE || op === OPS.FCIRC) && Math.round(v.g) === 1;
      out.push(o, o + fr.n[k] * (cut ? -v.c : v.c));
    }
  }
  return out;
}

/** A point moved along axis k onto the nearest face plane within 0.011 mm (else unchanged). */
function onFace(p: Params, upto: number, at: [number, number, number], k: number): [number, number, number] {
  let best = at[k];
  let bestD = 0.011;
  for (const c of facePlanes(p, upto, k)) {
    if (Math.abs(c - at[k]) < bestD) {
      bestD = Math.abs(c - at[k]);
      best = c;
    }
  }
  const out: [number, number, number] = [at[0], at[1], at[2]];
  out[k] = best;
  return out;
}

const axisOf = (code: number): number => FACE_FRAMES[Math.max(0, Math.min(5, code))].n.findIndex((x) => Math.abs(x) > 0.5);

/** The feature list as Part Language v2. */
export function designSpec(p: Params): PartSpec {
  const n = featureCount(p);
  const features: Feature[] = [];
  const plane = (id: string, y: number): Feature => ({ $op: 'ref.plane', id, args: { base: 'top', offset: y } });
  for (let i = 0; i < n; i++) {
    const { op, v } = readFeature(p, i);
    const id = `f${i}`;
    // Sketch coordinates on a top plane: (x, -z).
    if (op === OPS.BOX || op === OPS.CUTBOX) {
      features.push(plane(`pl${i}`, v.f));
      features.push({ $op: 'sketch.rectangle', id: `s${i}`, sketched_on: `pl${i}`, args: { width: v.a, height: v.b, x: v.d - v.a / 2, y: -v.e - v.b / 2 } });
      features.push(op === OPS.BOX ? { $op: 'feature.extrude', id, args: v.h > 0 ? { depth: v.c, draft: v.h } : { depth: v.c } } : { $op: 'feature.cut', id, args: { depth: v.c, direction: 'normal' } });
    } else if (op === OPS.CYL || op === OPS.BORE) {
      features.push(plane(`pl${i}`, v.f));
      features.push({ $op: 'sketch.circle', id: `s${i}`, sketched_on: `pl${i}`, args: { diameter: v.a, x: v.d, y: -v.e } });
      features.push(op === OPS.CYL ? { $op: 'feature.extrude', id, args: v.h > 0 ? { depth: v.c, draft: v.h } : { depth: v.c } } : { $op: 'feature.cut', id, args: { depth: v.c, direction: 'normal' } });
    } else if (op === OPS.HOLE) {
      features.push(plane(`pl${i}`, v.f));
      features.push({ $op: 'sketch.circle', id: `s${i}`, sketched_on: `pl${i}`, args: { diameter: v.a, x: v.d, y: -v.e } });
      features.push(v.b > 0 ? { $op: 'feature.cut', id, args: { depth: v.b, direction: 'reverse' } } : { $op: 'feature.cut', id, args: { through_all: true } });
    } else if (op === OPS.FILLET) {
      features.push({ $op: 'feature.fillet', id, args: { radius: v.a, feature: `f${Math.round(v.b)}`, edges: 'profile' } });
    } else if (op === OPS.SHELL) {
      features.push({ $op: 'feature.shell', id, args: { thickness: v.a, feature: `f${Math.round(v.b)}`, open: 'far' } });
    } else if (op === OPS.LINPAT) {
      features.push({ $op: 'feature.pattern.linear', id, args: { feature: `f${Math.round(v.b)}`, count: Math.round(v.a), spacing: v.c, direction: Math.round(v.d) === 1 ? 'Z' : 'X' } });
    } else if (op === OPS.CIRCPAT) {
      features.push({ $op: 'feature.pattern.circular', id, args: { feature: `f${Math.round(v.b)}`, count: Math.round(v.a), axis: { origin: [v.d, 0, v.e], direction: [0, 1, 0] } } });
    } else if (op === OPS.FCIRC || op === OPS.GEAR) {
      const fr = FACE_FRAMES[Math.max(0, Math.min(5, Math.round(op === OPS.FCIRC ? v.b : v.g)))];
      const cut = op === OPS.FCIRC && Math.round(v.g) === 1;
      // Exactly on the face (the origin is snapped): a gear or boss wider than the face must not poke out below it.
      const sink = 0;
      const o = onFace(p, i, [v.d, v.e, v.f], axisOf(Math.round(op === OPS.FCIRC ? v.b : v.g)));
      features.push({ $op: 'ref.plane', id: `pl${i}`, args: { origin: o, normal: fr.n, x_dir: fr.x } });
      if (op === OPS.FCIRC) {
        features.push({ $op: 'sketch.circle', id: `s${i}`, sketched_on: `pl${i}`, args: { diameter: v.a, x: 0, y: 0 } });
        if (cut) features.push(v.c > 0 ? { $op: 'feature.cut', id, args: { depth: v.c, direction: 'reverse' } } : { $op: 'feature.cut', id, args: { through_all: true } });
        else features.push({ $op: 'feature.extrude', id, args: v.h > 0 ? { depth: v.c + sink, draft: v.h } : { depth: v.c + sink } });
      } else {
        const pts = gearOutline({ module: v.a, teeth: Math.round(v.b) });
        const loops: unknown[] = [pts.map((q, k) => ['L', q[0], q[1], pts[(k + 1) % pts.length][0], pts[(k + 1) % pts.length][1]])];
        if (v.h > 0) loops.push([['C', 0, 0, v.h / 2]]);
        features.push({ $op: 'sketch.loops', id: `s${i}`, sketched_on: `pl${i}`, args: { loops } });
        features.push({ $op: 'feature.extrude', id, args: { depth: v.c + sink } });
      }
    } else if (op === OPS.THREAD) {
      const fr = FACE_FRAMES[Math.max(0, Math.min(5, Math.round(v.g)))];
      const internal = Math.round(v.h) === 1;
      // A rod grows out of the face; a tapped thread runs into the material.
      const axis = internal ? [-fr.n[0], -fr.n[1], -fr.n[2]] : fr.n;
      features.push({ $op: 'feature.thread', id, args: { origin: onFace(p, i, [v.d, v.e, v.f], axisOf(Math.round(v.g))), axis, major: v.a, pitch: v.b, length: v.c, internal } });
    } else if (op === OPS.LOFT) {
      const fr = FACE_FRAMES[Math.max(0, Math.min(5, Math.round(v.g)))];
      const o = onFace(p, i, [v.d, v.e, v.f], axisOf(Math.round(v.g)));
      features.push({ $op: 'ref.plane', id: `pa${i}`, args: { origin: o, normal: fr.n, x_dir: fr.x } });
      features.push({ $op: 'sketch.profile', id: `sa${i}`, sketched_on: `pa${i}`, args: { points: outlinePts(p, Math.round(v.a)) } });
      features.push({ $op: 'ref.plane', id: `pb${i}`, args: { origin: [o[0] + fr.n[0] * v.c, o[1] + fr.n[1] * v.c, o[2] + fr.n[2] * v.c], normal: fr.n, x_dir: fr.x } });
      features.push({ $op: 'sketch.profile', id: `sb${i}`, sketched_on: `pb${i}`, args: { points: outlinePts(p, Math.round(v.b)) } });
      features.push({ $op: 'feature.loft', id, args: { sketches: [`sa${i}`, `sb${i}`] } });
    } else if (op === OPS.SWEEP) {
      let path = pathPts(p, Math.round(v.b));
      if (path.length >= 2) {
        const run = [path[1][0] - path[0][0], path[1][1] - path[0][1], path[1][2] - path[0][2]];
        const k = run.findIndex((x) => Math.abs(x) > 1e-9 && run.every((y, j) => j === run.indexOf(x) || Math.abs(y) < 1e-9));
        if (k >= 0) {
          const s = onFace(p, i, path[0], k);
          const dk = s[k] - path[0][k];
          path = path.map((q) => [q[0], q[1], q[2]].map((x, j) => (j === k ? x + dk : x)) as [number, number, number]);
        }
        const d0: [number, number, number] = [path[1][0] - path[0][0], path[1][1] - path[0][1], path[1][2] - path[0][2]];
        const l0 = Math.hypot(d0[0], d0[1], d0[2]) || 1;
        const n: [number, number, number] = [d0[0] / l0, d0[1] / l0, d0[2] / l0];
        features.push({ $op: 'ref.plane', id: `pl${i}`, args: { origin: path[0], normal: n, x_dir: squareTo(n) } });
        features.push({ $op: 'sketch.profile', id: `s${i}`, sketched_on: `pl${i}`, args: { points: outlinePts(p, Math.round(v.a)) } });
        features.push({ $op: 'feature.sweep', id, args: path.length > 2 ? { sketch: `s${i}`, path, bend_radius: v.c } : { sketch: `s${i}`, path } });
      }
    } else if (op === OPS.BASE) {
      features.push({ $op: 'feature.mesh', id, args: { mesh: `imp${Math.round(v.a)}` } });
    } else if (op === OPS.RIB) {
      // In the plane of the floor's up and the wall's normal; its legs lie on the wall and the floor.
      const fr = FACE_FRAMES[Math.max(2, Math.min(5, Math.round(v.g)))];
      const x = fr.n;
      // leg x up: the sketch's y (normal x x_dir) then runs up the wall.
      const n: [number, number, number] = [-x[2], 0, x[0]];
      const t = v.a;
      const c0 = onFace(p, i, onFace(p, i, [v.d, v.e, v.f], 1), axisOf(Math.round(v.g)));
      features.push({ $op: 'ref.plane', id: `pl${i}`, args: { origin: [c0[0] - n[0] * t / 2, c0[1] - n[1] * t / 2, c0[2] - n[2] * t / 2], normal: n, x_dir: x } });
      features.push({ $op: 'sketch.profile', id: `s${i}`, sketched_on: `pl${i}`, args: { points: [[0, 0], [v.b, 0], [0, v.c]] } });
      features.push({ $op: 'feature.extrude', id, args: { depth: t } });
    } else if (op === OPS.ROUND) {
      features.push({ $op: 'feature.round', id, args: Math.round(v.b) === 1 ? { radius: v.a, all: true } : Math.round(v.f) === 1 ? { radius: v.a, at: [v.c, v.d, v.e], kind: 'chamfer' } : { radius: v.a, at: [v.c, v.d, v.e] } });
    } else if (op === OPS.EDGE) {
      features.push({ $op: 'feature.edge_fillet', id, args: { from: [v.c, v.d, v.e], to: [v.f, v.g, v.h], radius: v.a, kind: Math.round(v.b) === 1 ? 'chamfer' : 'fillet' } });
    } else if (op === OPS.CHAMFER) {
      features.push({ $op: 'feature.chamfer', id, args: { distance: v.a, feature: `f${Math.round(v.b)}`, edges: 'profile' } });
    } else if (op === OPS.MIRROR) {
      features.push({ $op: 'feature.mirror', id, args: { plane: ['X', 'Y', 'Z'][Math.max(0, Math.min(2, Math.round(v.a)))], offset: v.b } });
    } else if (op === OPS.FACE || op === OPS.REVOLVE) {
      const fr = FACE_FRAMES[Math.max(0, Math.min(5, Math.round(op === OPS.FACE ? v.b : v.g)))];
      // A boss starts exactly on the face it stands on (snapped onto it), so it fuses with it and the two touch
      // without overlapping (the closed-form check adds their volumes). Formerly: a 0.01 mm sink (the overlap is
      // inside material that is already there, so the volume is unchanged).
      const k = axisOf(Math.round(v.b));
      const snapped: [number, number, number] = op === OPS.FACE ? onFace(p, i, [v.d, v.e, v.f], k) : [v.d, v.e, v.f];
      // Off the design's own planes (on an imported body's face): sink 0.01 mm in, so it still fuses.
      const sink = op === OPS.FACE && Math.round(v.g) !== 1 && snapped[k] === [v.d, v.e, v.f][k] && !facePlanes(p, i, k).includes(snapped[k]) ? 0.01 : 0;
      const origin: [number, number, number] = [snapped[0] - fr.n[0] * sink, snapped[1] - fr.n[1] * sink, snapped[2] - fr.n[2] * sink];
      features.push({ $op: 'ref.plane', id: `pl${i}`, args: { origin, normal: fr.n, x_dir: fr.x } });
      features.push(outlineSketch(p, Math.round(v.a), `s${i}`, `pl${i}`));
      if (op === OPS.REVOLVE) features.push({ $op: 'feature.revolve', id, args: { angle: Math.max(1, Math.min(360, v.b || 360)), axis: 'v' } });
      else features.push(Math.round(v.g) === 1 ? { $op: 'feature.cut', id, args: { depth: v.c, direction: 'reverse' } } : { $op: 'feature.extrude', id, args: v.h > 0 ? { depth: v.c + sink, draft: v.h } : { depth: v.c + sink } });
    } else if (op === OPS.OUTLINE) {
      features.push(plane(`pl${i}`, v.f));
      features.push(outlineSketch(p, Math.round(v.a), `s${i}`, `pl${i}`));
      features.push(Math.round(v.g) === 1 ? { $op: 'feature.cut', id, args: { depth: v.c, direction: 'normal' } } : { $op: 'feature.extrude', id, args: { depth: v.c } });
    }
  }
  return { language: 2, name: 'design', units: 'mm', features, notes: { hand_check: 'closed form where the checker can derive one; otherwise kernel-checked' } };
}

/** Index of the last feature that adds an extruded body (what a fillet or chamfer rounds: a box, a cylinder, a boss), or -1. */
export function lastBoss(p: Params): number {
  for (let i = featureCount(p) - 1; i >= 0; i--) {
    const { op, v } = readFeature(p, i);
    if (op === OPS.BOX || op === OPS.CYL || ((op === OPS.FACE || op === OPS.OUTLINE) && Math.round(v.g) !== 1)) return i;
  }
  return -1;
}

/** Index of the last feature that is a body (a box, cylinder, cut, sketch), or -1. */
export function lastBody(p: Params): number {
  for (let i = featureCount(p) - 1; i >= 0; i--) if (isBody(readFeature(p, i).op)) return i;
  return -1;
}

/** The feature being edited: the one picked with "edit feature N", else the last. */
export function editing(p: Params): number {
  const n = featureCount(p);
  const s = Math.round(p.sel ?? -1);
  return s >= 0 && s < n ? s : n - 1;
}

/** Editable sizes: those of the feature being edited, so "make it 10 taller" and the handles act on it. */
function liveDefs(p: Params): ParamDef[] {
  const i = editing(p);
  if (i < 0) return [];
  const { op } = readFeature(p, i);
  const d = (s: string, label: string, min: number, max: number, step = 1): ParamDef => ({ id: `${s}${i}`, label, unit: 'mm', min, max, step, fine: 0.05, value: p[`${s}${i}`] ?? min });
  switch (op) {
    case OPS.BOX:
    case OPS.CUTBOX:
      return [d('a', 'Width', 1, 300), d('b', 'Depth', 1, 300), d('c', 'Height', 0.5, 300), d('d', 'X position', -150, 150), d('e', 'Z position', -150, 150), d('f', 'Base height', -50, 300)];
    case OPS.CYL:
    case OPS.BORE:
      return [d('a', 'Diameter', 0.5, 300, 0.5), d('c', 'Height', 0.5, 300), d('d', 'X position', -150, 150), d('e', 'Z position', -150, 150), d('f', 'Base height', -50, 300)];
    case OPS.HOLE:
      return [d('a', 'Hole diameter', 0.5, 100, 0.1), d('b', 'Hole depth', 0, 300), d('d', 'X position', -150, 150), d('e', 'Z position', -150, 150)];
    case OPS.FILLET:
      return [d('a', 'Fillet radius', 0.2, 60, 0.5)];
    case OPS.SHELL:
      return [d('a', 'Wall', 0.4, 30, 0.2)];
    case OPS.LINPAT:
      return [{ ...d('a', 'Count', 2, 50), unit: '' }, d('c', 'Spacing', 1, 300)];
    case OPS.CIRCPAT:
      return [{ ...d('a', 'Count', 2, 72), unit: '' }];
    case OPS.OUTLINE:
      return [d('c', 'Height', 0.5, 300), d('f', 'Base height', -50, 300)];
    case OPS.FACE:
      return [d('c', 'Depth', 0.2, 300)];
    case OPS.CHAMFER:
      return [d('a', 'Chamfer', 0.2, 60, 0.5)];
    case OPS.EDGE:
      return [d('a', 'Edge radius', 0.2, 60, 0.5)];
    case OPS.ROUND:
      return [d('a', 'Fillet radius', 0.2, 60, 0.5)];
    case OPS.FCIRC:
      return [d('a', 'Diameter', 0.5, 300, 0.5), d('c', 'Depth', 0, 300)];
    case OPS.GEAR:
      return [d('a', 'Module', 0.3, 10, 0.1), { ...d('b', 'Teeth', 6, 200), unit: '' }, d('c', 'Thickness', 1, 100), d('h', 'Bore', 0, 100, 0.5)];
    case OPS.THREAD:
      return [d('a', 'Thread diameter', 1, 100, 0.5), d('b', 'Pitch', 0.2, 6, 0.05), d('c', 'Thread length', 1, 300)];
    case OPS.LOFT:
      return [d('c', 'Loft height', 1, 300)];
    case OPS.SWEEP:
      return [d('c', 'Bend radius', 0.5, 200, 0.5)];
    case OPS.RIB:
      return [d('a', 'Rib thickness', 0.4, 50, 0.2), d('b', 'Rib length', 1, 300), d('c', 'Rib height', 1, 300)];
    case OPS.MIRROR:
      return [d('b', 'Mirror offset', -150, 150)];
    case OPS.REVOLVE:
      return [{ ...d('b', 'Revolve angle', 1, 360), unit: 'deg' }];
    default:
      return [];
  }
}

/** Handles on the last feature: width, depth, height for a box; diameter and height for a cylinder. */
function liveHandles(p: Params): HandleDef[] {
  const i = editing(p);
  if (i < 0) return [];
  const { op, v } = readFeature(p, i);
  if (op === OPS.BOX || op === OPS.CUTBOX) {
    return [
      { param: `a${i}`, at: () => [v.d + v.a / 2, v.f + v.c / 2, v.e], axis: [1, 0, 0], gain: 2 },
      { param: `b${i}`, at: () => [v.d, v.f + v.c / 2, v.e + v.b / 2], axis: [0, 0, 1], gain: 2 },
      { param: `c${i}`, at: () => [v.d, v.f + v.c, v.e], axis: [0, 1, 0], gain: 1 },
    ];
  }
  if (op === OPS.CYL || op === OPS.BORE) {
    return [
      { param: `a${i}`, at: () => [v.d + v.a / 2, v.f + v.c / 2, v.e], axis: [1, 0, 0], gain: 2 },
      { param: `c${i}`, at: () => [v.d, v.f + v.c, v.e], axis: [0, 1, 0], gain: 1 },
    ];
  }
  if (op === OPS.OUTLINE) return [{ param: `c${i}`, at: () => [0, v.f + v.c, 0], axis: [0, 1, 0], gain: 1 }];
  return [];
}

let current: Params = { nf: 1, o0: OPS.BOX, a0: 60, b0: 40, c0: 20, d0: 0, e0: 0, f0: 0, g0: 0, h0: 0 };

/** Keep the live sizes and handles in step with parameters set without a clamp (undo, redo). */
export function setDesignCurrent(p: Params): void {
  current = p;
}

/** The bounding box of the bodies that add material (cuts may only shrink it, so it is a bound, not a check). */
function addedBox(p: Params): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < featureCount(p); i++) {
    const { op, v } = readFeature(p, i);
    if (op === OPS.BOX) {
      min[0] = Math.min(min[0], v.d - v.a / 2); max[0] = Math.max(max[0], v.d + v.a / 2);
      min[2] = Math.min(min[2], v.e - v.b / 2); max[2] = Math.max(max[2], v.e + v.b / 2);
      min[1] = Math.min(min[1], v.f); max[1] = Math.max(max[1], v.f + v.c);
    } else if (op === OPS.BASE) {
      min[0] = Math.min(min[0], v.b); max[0] = Math.max(max[0], v.c);
      min[1] = Math.min(min[1], v.d); max[1] = Math.max(max[1], v.e);
      min[2] = Math.min(min[2], v.f); max[2] = Math.max(max[2], v.g);
    } else if (op === OPS.CYL) {
      min[0] = Math.min(min[0], v.d - v.a / 2); max[0] = Math.max(max[0], v.d + v.a / 2);
      min[2] = Math.min(min[2], v.e - v.a / 2); max[2] = Math.max(max[2], v.e + v.a / 2);
      min[1] = Math.min(min[1], v.f); max[1] = Math.max(max[1], v.f + v.c);
    }
  }
  return { min, max };
}

export const designJob: Job = {
  id: 'design',
  title: 'Free design',
  blurb: 'Build any part feature by feature: boxes, cylinders, cuts, holes, fillets, shells, patterns and sketches.',
  get params(): ParamDef[] {
    return liveDefs(current);
  },
  clamp(input) {
    const p: Params = { ...input };
    const notes: string[] = [];
    if (!(featureCount(p) > 0)) {
      Object.assign(p, { nf: 1, o0: OPS.BOX, a0: 60, b0: 40, c0: 20, d0: 0, e0: 0, f0: 0, g0: 0, h0: 0 });
    }
    for (let i = 0; i < featureCount(p); i++) {
      for (const s of SLOTS) if (!Number.isFinite(p[`${s}${i}`])) p[`${s}${i}`] = 0;
      const { op } = readFeature(p, i);
      if (op === OPS.BOX || op === OPS.CUTBOX || op === OPS.CYL || op === OPS.BORE) {
        for (const s of op === OPS.CYL || op === OPS.BORE ? ['a', 'c'] : ['a', 'b', 'c']) {
          if (p[`${s}${i}`] < 0.5) {
            p[`${s}${i}`] = 0.5;
            notes.push(`${OP_NAMES[op]} ${i + 1}: a size was raised to 0.5 mm.`);
          }
        }
      }
    }
    current = p;
    return { params: p, notes };
  },
  spec: designSpec,
  // No hand-derived formula: the generic closed-form checker covers single bodies; the rest is kernel-checked.
  volume: () => NaN,
  box: (p) => ({ box: addedBox(p), tol: Infinity }),
  genus: () => -1,
  get handles(): HandleDef[] {
    return liveHandles(current);
  },
  loadCase(p): LoadCase {
    const b = addedBox(p);
    const h = b.max[1] - b.min[1];
    return {
      fixtureLabel: 'Base on the desk',
      fixture: [{ kind: 'box', min: [b.min[0] - 1, b.min[1] - 1, b.min[2] - 1], max: [b.max[0] + 1, b.min[1] + 0.5, b.max[2] + 1] }],
      loadLabel: '20 N pressing down on the top',
      region: { kind: 'box', min: [b.min[0] - 1, b.max[1] - Math.min(2, h / 4), b.min[2] - 1], max: [b.max[0] + 1, b.max[1] + 1, b.max[2] + 1] },
      dir: [0, -1, 0],
      newtons: 20,
    };
  },
  roles: { stiffen: [] },
};

/** Top of the bodies added so far (mm), where a new feature goes by default. */
export function topOf(p: Params): number {
  const b = addedBox(p);
  return Number.isFinite(b.max[1]) ? b.max[1] : 0;
}

/** "1 Box 60 x 40 x 20 · 2 Fillet r 3 ..." */
export function describeDesign(p: Params): string[] {
  const f = (v: number): string => `${+v.toFixed(2)}`;
  const out: string[] = [];
  for (let i = 0; i < featureCount(p); i++) {
    const { op, v } = readFeature(p, i);
    const name = OP_NAMES[op] ?? '?';
    let s = '';
    if (op === OPS.BOX || op === OPS.CUTBOX) s = `${f(v.a)} x ${f(v.b)} x ${f(v.c)}`;
    else if (op === OPS.CYL || op === OPS.BORE) s = `⌀${f(v.a)} x ${f(v.c)}`;
    else if (op === OPS.HOLE) s = `⌀${f(v.a)} ${v.b > 0 ? `${f(v.b)} deep` : 'through'}`;
    else if (op === OPS.FILLET) s = `r ${f(v.a)} on ${Math.round(v.b) + 1}`;
    else if (op === OPS.SHELL) s = `${f(v.a)} wall on ${Math.round(v.b) + 1}`;
    else if (op === OPS.LINPAT) s = `${Math.round(v.a)} x ${f(v.c)} of ${Math.round(v.b) + 1}`;
    else if (op === OPS.CIRCPAT) s = `${Math.round(v.a)} round of ${Math.round(v.b) + 1}`;
    else if (op === OPS.OUTLINE) s = `${Math.round(v.g) === 1 ? 'cut' : 'extruded'} ${f(v.c)}`;
    else if (op === OPS.FACE) s = `${Math.round(v.g) === 1 ? 'cut' : 'boss'} ${f(v.c)} on ${['top', 'bottom', 'right', 'left', 'front', 'back'][Math.round(v.b)] ?? '?'}`;
    else if (op === OPS.CHAMFER) s = `${f(v.a)} on ${Math.round(v.b) + 1}`;
    else if (op === OPS.FCIRC) s = `\u2300${f(v.a)} ${Math.round(v.g) === 1 ? (v.c > 0 ? `${f(v.c)} deep` : 'through') : `boss ${f(v.c)}`}`;
    else if (op === OPS.GEAR) s = `m ${f(v.a)}, ${Math.round(v.b)} teeth, ${f(v.c)} thick`;
    else if (op === OPS.THREAD) s = `M${f(v.a)} x ${f(v.b)}, ${f(v.c)} ${Math.round(v.h) === 1 ? 'tapped' : 'rod'}`;
    else if (op === OPS.LOFT) s = `${f(v.c)} tall`;
    else if (op === OPS.SWEEP) s = `${Math.max(0, Math.round(p[`q${Math.round(v.b)}n`] ?? 0) - 1)} runs, bends r ${f(v.c)}`;
    else if (op === OPS.RIB) s = `${f(v.a)} thick, ${f(v.b)} x ${f(v.c)}`;
    else if (op === OPS.BASE) s = `${f(v.c - v.b)} x ${f(v.e - v.d)} x ${f(v.g - v.f)} from STEP`;
    else if (op === OPS.ROUND) s = Math.round(v.b) === 1 ? `r ${f(v.a)}, every edge` : `r ${f(v.a)} on an edge`;
    else if (op === OPS.EDGE) s = `${Math.round(v.b) === 1 ? 'chamfer' : 'fillet'} ${f(v.a)}, ${f(Math.hypot(v.f - v.c, v.g - v.d, v.h - v.e))} long`;
    else if (op === OPS.MIRROR) s = `across ${['X', 'Y', 'Z'][Math.round(v.a)] ?? '?'} = ${f(v.b)}`;
    else if (op === OPS.REVOLVE) s = `${f(v.b || 360)} deg`;
    out.push(`${i + 1} ${name} ${s}`);
  }
  return out;
}

export interface DesignEdit {
  params: Params;
  reply: string;
}

/**
 * Spoken or typed design steps. Numbers are millimetres. `here` is the point
 * the hand ray rests on (part mm), for "drill a hole here".
 *
 *   "add a box 40 by 30 by 10"        "add a cylinder 20 by 30" (diameter by height)
 *   "cut a box 20 by 20 by 5"         "drill a 5 mm hole here" / "a 5 mm hole 10 deep"
 *   "fillet 3" / "round the corners"  "shell 2" / "hollow it"
 *   "pattern 4 times 15 apart"        "4 around" (circular)        "remove the last feature"
 */
export function parseDesign(text: string, p: Params, here?: [number, number, number], edgeAt?: (at: [number, number, number]) => { a: [number, number, number]; b: [number, number, number] } | null, faceCode = 0): DesignEdit | null {
  let t = text.toLowerCase().replace(/(\d)\s*x\s*(\d)/gu, '$1 by $2');
  // Exact placement by numbers, not the hand: "at 10, -5" (x, z on the top face) or "at 10, 20, -5" (x, y, z).
  if (!typedSketch(t)) {
    const N = '(-?\\d+(?:\\.\\d+)?)';
    const pm = t.match(new RegExp(`\\b(?:at|centred at|centered at|positioned at)\\s*\\(?\\s*(?:x\\s*)?${N}\\s*,?\\s*(?:y\\s*)?${N}(?:\\s*,?\\s*(?:z\\s*)?${N})?\\s*\\)?`, 'u'));
    if (pm) {
      const [x, b, c] = [pm[1], pm[2], pm[3]].map((s) => (s === undefined ? undefined : parseFloat(s)));
      here = c === undefined ? [x!, topOf(p), b!] : [x!, b!, c];
      if (c === undefined) faceCode = 0;
      t = t.replace(pm[0], ' ');
    }
  }
  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)/gu)].map((m) => parseFloat(m[1]));
  const top = topOf(p);
  const at = here ?? [0, top, 0];
  const prod = parseProduction(t, p, here, faceCode);
  if (prod) return prod;
  const edit = t.match(/\b(edit|select|change) feature (\d+)\b/u);
  if (edit) {
    const k = parseInt(edit[2], 10) - 1;
    if (k < 0 || k >= featureCount(p)) return { params: p, reply: `There are ${featureCount(p)} features.` };
    return { params: { ...p, sel: k }, reply: `Editing feature ${k + 1}, ${OP_NAMES[readFeature(p, k).op] ?? ''}: pull its handles or say its new size.` };
  }
  const last = featureCount(p) - 1;
  const lastF = last >= 0 ? readFeature(p, last) : null;
  if (lastF?.op === OPS.FACE && /\b(extrude|pull|boss|cut|deep|depth)\b/u.test(t) && nums.length && !/\b(box|cylinder|hole)\b/u.test(t)) {
    const cut = /\bcut\b/u.test(t);
    return { params: { ...p, [`c${last}`]: nums[0], [`g${last}`]: cut ? 1 : 0 }, reply: `${cut ? 'Cut' : 'Pulled'} the sketch ${nums[0]} mm ${cut ? 'into' : 'out of'} the face.` };
  }
  if (lastF?.op === OPS.FACE && /\b(revolve|lathe)\b|\bturn it\b/u.test(t)) {
    const k = Math.round(lastF.v.a);
    const pts = outlinePts(p, k);
    const minU = Math.min(...pts.map((q) => q[0]));
    const fr = FACE_FRAMES[Math.round(lastF.v.b)];
    const out: Params = { ...p, [`o${last}`]: OPS.REVOLVE, [`b${last}`]: nums[0] ?? 360, [`g${last}`]: Math.round(lastF.v.b), [`d${last}`]: lastF.v.d + fr.x[0] * minU, [`e${last}`]: lastF.v.e + fr.x[1] * minU, [`f${last}`]: lastF.v.f + fr.x[2] * minU };
    pts.forEach(([u], j) => (out[`q${k}x${j}`] = u - minU));
    return { params: out, reply: `Revolved the sketch ${nums[0] ?? 360} degrees about its left edge.` };
  }
  // "round all edges 2": a rolling ball over the whole part.
  if (/\b(fillet|round)\b/u.test(t) && /\b(all|every) (the )?edges\b/u.test(t)) {
    const r = nums[0] ?? 2;
    return { params: addFeature(p, OPS.ROUND, { a: r, b: 1 }), reply: `Rounded every edge to ${r} mm, corners blended.` };
  }
  // "fillet this edge 3": a rolling-ball fillet of the edge at the pointed spot (straight or curved).
  if (/\b(fillet|round)\b/u.test(t) && /\b(this|that) edge\b|\bedge here\b/u.test(t)) {
    if (!here) return { params: p, reply: 'Point at an edge of the part, then say "fillet this edge 3".' };
    const r = nums[0] ?? 2;
    const r3 = (x: number): number => Math.round(x * 1e4) / 1e4;
    return { params: addFeature(p, OPS.ROUND, { a: r, c: r3(here[0]), d: r3(here[1]), e: r3(here[2]) }), reply: `Filleted that edge to ${r} mm, following its tangent edges. Fillet the edges next to it with the same radius and the corner blends.` };
  }
  // "chamfer this edge 2": a straight edge or a circle (a hole's rim) at the pointed spot.
  if (/\b(chamfer|bevel)\b/u.test(t) && /\b(this|that) edge\b|\bedge here\b|\b(rim|hole edge)\b/u.test(t) && here) {
    const d = nums[0] ?? 1;
    const r3 = (x: number): number => Math.round(x * 1e4) / 1e4;
    return { params: addFeature(p, OPS.ROUND, { a: d, c: r3(here[0]), d: r3(here[1]), e: r3(here[2]), f: 1 }), reply: `Chamfered that edge by ${d} mm.` };
  }
  if (/\b(chamfer|bevel)\b/u.test(t) && /\b(this|that) edge\b|\bedge here\b/u.test(t)) {
    if (!here || !edgeAt) return { params: p, reply: 'Point at an edge of the part, then say "fillet this edge 3".' };
    const e = edgeAt(here);
    if (!e) return { params: p, reply: 'No sharp straight edge there. Point closer to an edge.' };
    const chamfer = /\b(chamfer|bevel)\b/u.test(t);
    const size = nums[0] ?? (chamfer ? 1 : 2);
    const r3 = (x: number): number => Math.round(x * 1e4) / 1e4;
    return {
      params: addFeature(p, OPS.EDGE, { a: size, b: chamfer ? 1 : 0, c: r3(e.a[0]), d: r3(e.a[1]), e: r3(e.a[2]), f: r3(e.b[0]), g: r3(e.b[1]), h: r3(e.b[2]) }),
      reply: `${chamfer ? 'Chamfered' : 'Rounded'} that edge${chamfer ? ' by' : ' to'} ${size} mm (${Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1], e.b[2] - e.a[2]).toFixed(1)} mm long).`,
    };
  }
  if (/\bchamfer\b/u.test(t)) {
    const body = lastBoss(p);
    if (body < 0) return null;
    const d = nums[0] ?? 1;
    return { params: addFeature(p, OPS.CHAMFER, { a: d, b: body }), reply: `Chamfered the upright edges of feature ${body + 1} by ${d} mm.` };
  }
  if (/\bmirror\b/u.test(t)) {
    const axis = /\b(across|in|about|on) (the )?y\b/u.test(t) ? 1 : /\b(across|in|about|on) (the )?z\b|\bfront to back\b/u.test(t) ? 2 : 0;
    const b = addedBox(p);
    const off = nums.length ? nums[0] : axis === 1 ? b.min[1] : b.max[axis];
    return { params: addFeature(p, OPS.MIRROR, { a: axis, b: off }), reply: `Mirrored across ${['X', 'Y', 'Z'][axis]} = ${+off.toFixed(2)} and joined.` };
  }
  if (/\b(remove|delete|undo) (the )?last (feature|step)\b/u.test(t)) {
    if (featureCount(p) <= 1) return { params: p, reply: 'The first feature stays; change its sizes instead.' };
    return { params: removeLast(p), reply: 'Removed the last feature.' };
  }
  if (/\b(drill|hole)\b/u.test(t)) {
    const d = nums[0] ?? 5;
    const deep = /\bdeep\b/u.test(t) && nums.length > 1 ? nums[1] : 0;
    return { params: addFeature(p, OPS.HOLE, { a: d, b: deep, d: at[0], e: at[2], f: top + 0.01 }), reply: `${d} mm hole ${deep ? `${deep} mm deep` : 'right through'}${here ? ' where you pointed' : ' in the middle'}.` };
  }
  if (/\bcylinder|boss|post|peg|round bar\b/u.test(t)) {
    const [dia = 20, h = 20] = nums;
    const cut = /\b(cut|bore|remove)\b/u.test(t);
    const base = cut ? top - h : top;
    return { params: addFeature(p, cut ? OPS.BORE : OPS.CYL, { a: dia, c: h, d: here ? at[0] : 0, e: here ? at[2] : 0, f: base }), reply: `${cut ? 'Bored' : 'Added'} a ⌀${dia} mm cylinder ${h} mm ${cut ? 'deep' : 'tall'}.` };
  }
  if (/\b(box|block|cube|slab|plate|pocket)\b/u.test(t)) {
    const [w = 30, d = w, h = /\bcube\b/u.test(t) ? w : 10] = nums;
    const cut = /\b(cut|pocket|remove)\b/u.test(t);
    const base = cut ? top - h : top;
    return { params: addFeature(p, cut ? OPS.CUTBOX : OPS.BOX, { a: w, b: d, c: h, d: here ? at[0] : 0, e: here ? at[2] : 0, f: base }), reply: `${cut ? 'Cut' : 'Added'} a ${w} x ${d} x ${h} mm box${cut ? ' pocket' : ''}${here ? ' where you pointed' : ' on top'}.` };
  }
  if (/\b(fillet|round (the )?(corners|edges))\b/u.test(t)) {
    const body = lastBoss(p);
    if (body < 0) return null;
    const r = nums[0] ?? 3;
    return { params: addFeature(p, OPS.FILLET, { a: r, b: body }), reply: `Rounded the upright edges of feature ${body + 1} to ${r} mm.` };
  }
  if (/\b(shell|hollow)\b/u.test(t)) {
    let body = -1;
    for (let i = 0; i < featureCount(p); i++) if (readFeature(p, i).op === OPS.BOX || readFeature(p, i).op === OPS.CYL) {
      body = i;
      break;
    }
    if (body < 0) return null;
    const w = nums[0] ?? 2;
    return { params: addFeature(p, OPS.SHELL, { a: w, b: body }), reply: `Shelled feature ${body + 1} to ${w} mm walls, open at the top.` };
  }
  if (/\b(around|circular|in a circle)\b/u.test(t) && nums.length) {
    const seed = featureCount(p) - 1;
    return { params: addFeature(p, OPS.CIRCPAT, { a: Math.round(nums[0]), b: seed, d: 0, e: 0 }), reply: `${Math.round(nums[0])} copies of feature ${seed + 1} round the middle.` };
  }
  if (/\b(pattern|repeat|times|copies|row)\b/u.test(t) && nums.length) {
    const seed = featureCount(p) - 1;
    const n = Math.round(nums[0]);
    const gap = nums[1] ?? 15;
    const axis = /\b(z|depth|back)\b/u.test(t) ? 1 : 0;
    return { params: addFeature(p, OPS.LINPAT, { a: n, b: seed, c: gap, d: axis }), reply: `${n} in a row, ${gap} mm apart, of feature ${seed + 1}.` };
  }
  return null;
}

/** A sketch drawn on a flat face: a boss 10 mm out of it, ready to be pulled or turned into a cut. */
export function addFaceSketch(p: Params, pts: [number, number][], origin: [number, number, number], code: number, sweeps?: number[]): Params {
  const o = addOutline(p, pts, sweeps);
  // The picked point, snapped to a thousandth of a millimetre: the face it was picked on.
  const r = (x: number): number => Math.round(x * 1000) / 1000;
  return addFeature(o.params, OPS.FACE, { a: o.index, b: code, c: 10, d: r(origin[0]), e: r(origin[1]), f: r(origin[2]), g: 0 });
}

/**
 * The straight sharp edge nearest a point (part mm), from a mesh's sharp-edge
 * segments (xyz pairs): the nearest segment within `reach` mm, extended along
 * its line over every collinear segment that touches it. Null when none is near.
 */
export function edgeNear(edges: ArrayLike<number>, at: [number, number, number], reach = 6): { a: [number, number, number]; b: [number, number, number] } | null {
  const seg = (i: number): [[number, number, number], [number, number, number]] => [
    [edges[i * 6], edges[i * 6 + 1], edges[i * 6 + 2]],
    [edges[i * 6 + 3], edges[i * 6 + 4], edges[i * 6 + 5]],
  ];
  const n = Math.floor(edges.length / 6);
  let best = -1;
  let bestD = reach;
  for (let i = 0; i < n; i++) {
    const [p, q] = seg(i);
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const l2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
    if (l2 < 1e-12) continue;
    const t = Math.max(0, Math.min(1, ((at[0] - p[0]) * d[0] + (at[1] - p[1]) * d[1] + (at[2] - p[2]) * d[2]) / l2));
    const dist = Math.hypot(p[0] + t * d[0] - at[0], p[1] + t * d[1] - at[1], p[2] + t * d[2] - at[2]);
    if (dist < bestD) {
      bestD = dist;
      best = i;
    }
  }
  if (best < 0) return null;
  const [p0, q0] = seg(best);
  const L = Math.hypot(q0[0] - p0[0], q0[1] - p0[1], q0[2] - p0[2]);
  const u = [(q0[0] - p0[0]) / L, (q0[1] - p0[1]) / L, (q0[2] - p0[2]) / L];
  const along = (x: number[]): number => (x[0] - p0[0]) * u[0] + (x[1] - p0[1]) * u[1] + (x[2] - p0[2]) * u[2];
  const offLine = (x: number[]): number => {
    const s = along(x);
    return Math.hypot(x[0] - p0[0] - u[0] * s, x[1] - p0[1] - u[1] * s, x[2] - p0[2] - u[2] * s);
  };
  // Grow the span over collinear segments that overlap or touch it.
  let lo = 0;
  let hi = L;
  let grew = true;
  while (grew) {
    grew = false;
    for (let i = 0; i < n; i++) {
      const [p, q] = seg(i);
      if (offLine(p) > 1e-3 || offLine(q) > 1e-3) continue;
      const a = Math.min(along(p), along(q));
      const b = Math.max(along(p), along(q));
      if (b < lo - 1e-3 || a > hi + 1e-3) continue;
      if (a < lo - 1e-9 || b > hi + 1e-9) {
        lo = Math.min(lo, a);
        hi = Math.max(hi, b);
        grew = true;
      }
    }
  }
  const pt = (s: number): [number, number, number] => [p0[0] + u[0] * s, p0[1] + u[1] * s, p0[2] + u[2] * s];
  return { a: pt(lo), b: pt(hi) };
}

/** Metric coarse pitches (ISO 261), mm. */
const COARSE: Record<number, number> = { 2: 0.4, 2.5: 0.45, 3: 0.5, 4: 0.7, 5: 0.8, 6: 1, 8: 1.25, 10: 1.5, 12: 1.75, 14: 2, 16: 2, 20: 2.5, 24: 3, 30: 3.5, 36: 4 };

/**
 * Production tools by voice, on the face the hand ray points at (or the top):
 *   "drill a 5 mm hole here" (any face), "counterbore 10 3 deep"
 *   "sketch a rectangle 40 by 20 here", "a circle 12 here", "a slot 30 by 8", "a hexagon 13" (+ "cut 5" / "10 tall")
 *   "gear module 2 with 20 teeth 8 thick bore 6"
 *   "M8 thread 20 long" (a rod), "tap M8 15 deep here" (inside a hole)
 *   "loft a rectangle 40 by 30 to a circle 20 over 25"
 *   "draft 3" (degrees, on the last boss)
 */
/** "a circle 20", "a rectangle 40 by 30", "a hexagon 13": an exact outline about the origin, or null. */
function shapeOf(s: string): [number, number][] | null {
  const n = [...s.matchAll(/(\d+(?:\.\d+)?)/gu)].map((m) => parseFloat(m[1]));
  if (/\b(circle|round|tube|pipe|rod)\b/u.test(s) && n.length) return Array.from({ length: 48 }, (_, k) => [(n[0] / 2) * Math.cos((2 * Math.PI * k) / 48), (n[0] / 2) * Math.sin((2 * Math.PI * k) / 48)] as [number, number]);
  if (/\b(rectangle|square|box|bar)\b/u.test(s) && n.length) return rectOutline(n[0], n[1] ?? n[0]) as [number, number][];
  if (/\bhex(agon)?\b/u.test(s) && n.length) return polygonOutline(6, n[0]) as [number, number][];
  return null;
}

/** The highest box or cylinder top under (x, z) at or below y: the floor a rib stands on (else y). */
function floorAt(p: Params, x: number, z: number, y: number): number {
  let best = -Infinity;
  for (let i = 0; i < featureCount(p); i++) {
    const { op, v } = readFeature(p, i);
    const top = v.f + v.c;
    if (top > y + 1e-6) continue;
    const inside = op === OPS.BOX ? Math.abs(x - v.d) <= v.a / 2 && Math.abs(z - v.e) <= v.b / 2 : op === OPS.CYL ? Math.hypot(x - v.d, z - v.e) <= v.a / 2 : false;
    if (inside) best = Math.max(best, top);
  }
  return Number.isFinite(best) ? best : y;
}

/**
 * A sketch typed or spoken step by step, each step with its dimension:
 * "sketch 40 right, 20 up, arc 10 left 90, 15 at 135, close, 8 tall".
 * Steps: a length and a direction (right, left, up, down: the face's own axes),
 * "L at A" (A degrees from right, anticlockwise), "line L" (straight on), "turn
 * left|right A" (then the next line), and "arc R left|right A" (a tangent arc of
 * radius R turning A degrees). It starts where you point and closes itself.
 */
export function typedSketch(t: string): { pts: [number, number][]; sweeps: number[]; depth?: number; cut: boolean; lines: number; arcs: number; area: number; closedBy: boolean } | { error: string } | null {
  if (!/\b(sketch|draw|profile|polyline|outline)\b/u.test(t)) return null;
  const body = t.replace(/^.*?\b(sketch|draw|profile|polyline|outline)\b/u, '');
  const steps = body.split(/,|;|\bthen\b|\band\b/u).map((s) => s.trim()).filter(Boolean);
  const NUM = '(-?\\d+(?:\\.\\d+)?)';
  const isStep = (s: string): boolean => new RegExp(`^(arc\\b|line\\b|turn\\b|${NUM}\\s*(mm\\s*)?(right|left|up|down|at\\b|long|forward|on\\b))`, 'u').test(s);
  if (steps.filter(isStep).length < 2) return null;
  const DIR: Record<string, number> = { right: 0, up: 90, left: 180, down: 270 };
  const pts: [number, number][] = [[0, 0]];
  const sweeps: number[] = [];
  let heading = 0;
  let lines = 0;
  let arcs = 0;
  let depth: number | undefined;
  const cut = /\b(cut|pocket|recess)\b/u.test(t);
  const here = (): [number, number] => pts[pts.length - 1];
  const go = (l: number, deg: number): void => {
    const r = (deg * Math.PI) / 180;
    const [x, y] = here();
    const q: [number, number] = [x + l * Math.cos(r), y + l * Math.sin(r)];
    pts.push([Math.round(q[0] * 1e6) / 1e6, Math.round(q[1] * 1e6) / 1e6]);
    sweeps.push(0);
    heading = deg;
    lines++;
  };
  for (const s of steps) {
    let m: RegExpMatchArray | null;
    if ((m = s.match(new RegExp(`^arc\\s*(?:of\\s*)?(?:radius\\s*)?${NUM}\\s*(?:mm\\s*)?(left|right)?\\s*(?:by\\s*)?${NUM}?`, 'u')))) {
      const r = parseFloat(m[1]);
      const turn = (m[2] === 'right' ? -1 : 1) * (m[3] ? parseFloat(m[3]) : 90);
      if (r <= 0 || Math.abs(turn) >= 360) return { error: `An arc needs a positive radius and a turn under 360 degrees.` };
      // Tangent arc: centre to the side it turns towards.
      const h = (heading * Math.PI) / 180;
      const side = turn > 0 ? 1 : -1;
      const [x, y] = here();
      const cx = x - side * r * Math.sin(h);
      const cy = y + side * r * Math.cos(h);
      const a0 = Math.atan2(y - cy, x - cx);
      const a1 = a0 + (turn * Math.PI) / 180;
      pts.push([Math.round((cx + r * Math.cos(a1)) * 1e6) / 1e6, Math.round((cy + r * Math.sin(a1)) * 1e6) / 1e6]);
      sweeps.push(turn);
      heading += turn;
      arcs++;
    } else if ((m = s.match(new RegExp(`^turn\\s*(left|right)\\s*${NUM}?`, 'u')))) {
      heading += (m[1] === 'left' ? 1 : -1) * (m[2] ? parseFloat(m[2]) : 90);
    } else if ((m = s.match(new RegExp(`^${NUM}\\s*(?:mm\\s*)?at\\s*${NUM}`, 'u')))) {
      go(parseFloat(m[1]), parseFloat(m[2]));
    } else if ((m = s.match(new RegExp(`^${NUM}\\s*(?:mm\\s*)?(right|left|up|down)\\b`, 'u')))) {
      go(parseFloat(m[1]), DIR[m[2]]);
    } else if ((m = s.match(new RegExp(`^(?:line\\s*)?${NUM}\\s*(?:mm\\s*)?(?:long|forward|on)?$`, 'u'))) && /^line\b|long|forward|on$/u.test(s)) {
      go(parseFloat(m[1]), heading);
    } else if ((m = s.match(new RegExp(`${NUM}\\s*(?:mm\\s*)?(tall|high|deep|thick)`, 'u'))) || (m = s.match(new RegExp(`(?:extrude|cut|pocket)\\s*${NUM}`, 'u')))) {
      depth = parseFloat(m[1]);
    } else if (/^close/u.test(s) || /^(here|on this face|on the \w+ face)$/u.test(s) || s === '') {
      // Closing is automatic.
    }
  }
  if (sweeps.length < 2) return { error: 'A sketch needs at least two steps, for example "sketch 40 right, 20 up, close".' };
  // Close: back to the start with a line (unless the last step landed on it).
  const last = here();
  const closedBy = Math.hypot(last[0], last[1]) > 1e-6;
  if (closedBy) sweeps.push(0);
  else {
    pts.pop();
  }
  // Signed area with the arcs' segments: shoelace plus each arc's circular segment.
  let area = 0;
  for (let j = 0; j < pts.length; j++) {
    const a = pts[j];
    const b = pts[(j + 1) % pts.length];
    area += (a[0] * b[1] - b[0] * a[1]) / 2;
    const sw = sweeps[j] ?? 0;
    if (sw) {
      const th = (Math.abs(sw) * Math.PI) / 180;
      const c = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const r = c / (2 * Math.sin(th / 2));
      area += Math.sign(sw) * ((r * r) / 2) * (th - Math.sin(th));
    }
  }
  if (Math.abs(area) < 1e-6) return { error: 'That sketch encloses no area: the lines fold back on themselves.' };
  return { pts, sweeps, depth, cut, lines: lines + (closedBy ? 1 : 0), arcs, area: Math.abs(area), closedBy };
}

function parseProduction(t: string, p: Params, here: [number, number, number] | undefined, code: number): DesignEdit | null {
  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)/gu)].map((m) => parseFloat(m[1]));
  const at: [number, number, number] = here ?? [0, topOf(p), 0];
  const fc = here ? code : 0;
  const face = ['top', 'bottom', 'right', 'left', 'front', 'back'][fc];
  // Draft on the last boss.
  const dm = t.match(/\bdraft (?:of |angle )?(\d+(?:\.\d+)?)/u);
  if (dm) {
    const k = lastBoss(p);
    if (k < 0) return { params: p, reply: 'There is no boss to draft.' };
    return { params: { ...p, [`h${k}`]: parseFloat(dm[1]) }, reply: `Drafted feature ${k + 1} by ${dm[1]} degrees: its sides lean in towards the top.` };
  }
  // Threads.
  const tm = t.match(/\bm\s?(\d+(?:\.\d+)?)\b/u);
  if (tm && /\b(thread|tap|threaded|bolt|screw|rod)\b/u.test(t)) {
    const major = parseFloat(tm[1]);
    const pm = t.match(/\bpitch (\d+(?:\.\d+)?)/u) ?? t.match(/\bx\s?(\d+(?:\.\d+)?)\b/u);
    const pitch = pm ? parseFloat(pm[1]) : COARSE[major] ?? Math.max(0.25, major * 0.15);
    const lm = t.match(/(\d+(?:\.\d+)?)\s*(?:mm\s*)?(?:long|deep|length)/u);
    const length = lm ? parseFloat(lm[1]) : major * 2;
    const internal = /\btap|tapped|internal|inside\b/u.test(t);
    return {
      params: addFeature(p, OPS.THREAD, { a: major, b: pitch, c: length, d: at[0], e: at[1], f: at[2], g: fc, h: internal ? 1 : 0 }),
      reply: internal
        ? `Tapped an M${major} x ${pitch} thread ${length} mm deep into the ${face} face. Drill the tapping hole first (${+(major - pitch).toFixed(2)} mm).`
        : `An M${major} x ${pitch} threaded rod, ${length} mm long, on the ${face} face.`,
    };
  }
  // Gears.
  if (/\bgear\b/u.test(t)) {
    const mm = t.match(/\bmod(?:ule)?\s*(\d+(?:\.\d+)?)/u);
    const zm = t.match(/(\d+)\s*teeth/u);
    const th = t.match(/(\d+(?:\.\d+)?)\s*(?:mm\s*)?(?:thick|wide)/u);
    const bm = t.match(/\bbore\s*(\d+(?:\.\d+)?)/u);
    const module = mm ? parseFloat(mm[1]) : 1.5;
    const teeth = zm ? parseInt(zm[1], 10) : 20;
    const thick = th ? parseFloat(th[1]) : 6;
    const bore = bm ? parseFloat(bm[1]) : 0;
    return {
      params: addFeature(p, OPS.GEAR, { a: module, b: teeth, c: thick, d: at[0], e: at[1], f: at[2], g: fc, h: bore }),
      reply: `A spur gear, module ${module}, ${teeth} teeth (pitch diameter ${(module * teeth).toFixed(1)} mm), ${thick} mm thick${bore ? `, ${bore} mm bore` : ''}, involute 20 degrees.`,
    };
  }
  // Sweeps: "sweep a circle 8 along 40 right then 30 up bend 10".
  if (/\bsweep\b/u.test(t)) {
    const [head, tail = ''] = t.split(/\balong\b/u);
    const prof = shapeOf(head);
    if (!prof) return { params: p, reply: 'Say "sweep a circle 8 along 40 right then 30 up, bend 10".' };
    const bm = tail.match(/\bbend(?: radius)?\s*(\d+(?:\.\d+)?)/u);
    const legsText = tail.replace(/\bbend(?: radius)?\s*\d+(?:\.\d+)?/u, '');
    const DIRS: Record<string, [number, number, number]> = { right: [1, 0, 0], left: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0], forward: [0, 0, 1], front: [0, 0, 1], back: [0, 0, -1], backward: [0, 0, -1] };
    const legs = [...legsText.matchAll(/(\d+(?:\.\d+)?)\s*(?:mm\s*)?(right|left|up|down|forward|front|backward|back)\b/gu)].map((m) => ({ l: parseFloat(m[1]), d: DIRS[m[2]] }));
    if (!legs.length) legs.push({ l: 30, d: here ? FACE_FRAMES[fc].n : [0, 1, 0] });
    // It starts on the face it grows from (snapped onto it when the part is built).
    const path: [number, number, number][] = [[at[0], at[1], at[2]]];
    legs.forEach((g) => {
      const q = path[path.length - 1];
      const l = g.l;
      path.push([q[0] + g.d[0] * l, q[1] + g.d[1] * l, q[2] + g.d[2] * l]);
    });
    const size = Math.max(...prof.map(([x, y]) => Math.hypot(x, y)));
    const bend = bm ? parseFloat(bm[1]) : +(size * 2).toFixed(2);
    const op = addOutline(p, prof);
    const pa = addPath(op.params, path);
    const runs = legs.length;
    return {
      params: addFeature(pa.params, OPS.SWEEP, { a: op.index, b: pa.index, c: bend }),
      reply: `Swept the profile along ${runs} run${runs === 1 ? '' : 's'}${runs > 1 ? ` with ${bend} mm bends` : ''}.`,
    };
  }
  // Ribs: point at a wall, "add a rib 3 thick 20 by 15".
  if (/\b(rib|gusset|web)\b/u.test(t)) {
    if (!here || fc < 2) return { params: p, reply: 'Point at the wall the rib braces (a side face), then say "rib 3 thick 20 by 20".' };
    const th = t.match(/(\d+(?:\.\d+)?)\s*(?:mm\s*)?thick/u);
    const sz = t.match(/(\d+(?:\.\d+)?)\s*(?:mm\s*)?(?:by|x)\s*(\d+(?:\.\d+)?)/u);
    const thick = th ? parseFloat(th[1]) : 3;
    const len = sz ? parseFloat(sz[1]) : 20;
    const ht = sz ? parseFloat(sz[2]) : len;
    const n = FACE_FRAMES[fc].n;
    const floor = floorAt(p, at[0] + n[0], at[2] + n[2], at[1]);
    return {
      params: addFeature(p, OPS.RIB, { a: thick, b: len, c: ht, d: at[0], e: floor, f: at[2], g: fc }),
      reply: `A ${thick} mm rib, ${len} mm along the floor and ${ht} mm up the ${face} wall.`,
    };
  }
  // Lofts.
  if (/\bloft\b/u.test(t)) {
    const parts = t.split(/\bto\b/u);
    if (parts.length < 2) return { params: p, reply: 'Say "loft a rectangle 40 by 30 to a circle 20 over 25".' };
    const shape = shapeOf;
    const over = t.match(/\b(?:over|tall|high|height)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:mm\s*)?(?:tall|high)/u);
    const A = shape(parts[0]);
    const B = shape(parts[1].replace(/\b(over|tall|high)\b.*$/u, ''));
    if (!A || !B) return { params: p, reply: 'Name both ends: a rectangle, a square, a circle or a hexagon, with sizes.' };
    const oa = addOutline(p, A);
    const ob = addOutline(oa.params, B);
    const h = over ? parseFloat(over[1] ?? over[2]) : 20;
    return { params: addFeature(ob.params, OPS.LOFT, { a: oa.index, b: ob.index, c: h, d: at[0], e: at[1], f: at[2], g: fc }), reply: `Lofted ${h} mm from one shape to the other on the ${face} face.` };
  }
  // Holes on any face, and counterbores.
  const cb = t.match(/\bcounter ?bore\s*(\d+(?:\.\d+)?)\s*(?:mm\s*)?(?:by\s*)?(\d+(?:\.\d+)?)?/u);
  if (cb) {
    const dia = parseFloat(cb[1]);
    const depth = cb[2] ? parseFloat(cb[2]) : 3;
    return { params: addFeature(p, OPS.FCIRC, { a: dia, b: fc, c: depth, d: at[0], e: at[1], f: at[2], g: 1 }), reply: `A ${dia} mm counterbore ${depth} mm deep on the ${face} face.` };
  }
  if (/\b(drill|hole)\b/u.test(t) && here && fc !== 0) {
    const dia = nums[0] ?? 5;
    const deep = /\bdeep\b/u.test(t) && nums.length > 1 ? nums[1] : 0;
    return { params: addFeature(p, OPS.FCIRC, { a: dia, b: fc, c: deep, d: at[0], e: at[1], f: at[2], g: 1 }), reply: `${dia} mm hole ${deep ? `${deep} mm deep` : 'right through'} on the ${face} face.` };
  }
  // A typed sketch: every line and arc with its own dimension.
  const typed = typedSketch(t);
  if (typed) {
    if ('error' in typed) return { params: p, reply: typed.error };
    const withFace = addFaceSketch(p, typed.pts, at, fc, typed.sweeps);
    const k = featureCount(withFace) - 1;
    const depth = typed.depth ?? (typed.cut ? 3 : 10);
    return {
      params: { ...withFace, [`c${k}`]: depth, [`g${k}`]: typed.cut ? 1 : 0 },
      reply: `Sketched ${typed.lines} line${typed.lines === 1 ? '' : 's'}${typed.arcs ? ` and ${typed.arcs} arc${typed.arcs === 1 ? '' : 's'}` : ''} on the ${face} face${typed.closedBy ? ', closed back to the start' : ''}; ${typed.cut ? `cut ${depth} mm in` : `${depth} mm tall`}. Area ${typed.area.toFixed(1)} mm2.`,
    };
  }
  // Exact sketch shapes on a face.
  const isShape = /\b(sketch|draw|add|put|make)\b/u.test(t) || /\b(here|on this face)\b/u.test(t);
  if (isShape && /\b(rectangle|square|circle|slot|hexagon|hex|octagon|pentagon)\b/u.test(t)) {
    const cut = /\b(cut|pocket|recess)\b/u.test(t);
    const dm2 = t.match(/(\d+(?:\.\d+)?)\s*(?:mm\s*)?(?:deep|tall|high|thick)/u);
    const depth = dm2 ? parseFloat(dm2[1]) : cut ? 3 : 10;
    const sizes = nums.filter((n) => !dm2 || n !== parseFloat(dm2[1]));
    if (/\bcircle\b/u.test(t)) {
      const dia = sizes[0] ?? 10;
      return { params: addFeature(p, OPS.FCIRC, { a: dia, b: fc, c: depth, d: at[0], e: at[1], f: at[2], g: cut ? 1 : 0 }), reply: `A ${dia} mm circle on the ${face} face, ${cut ? `cut ${depth} mm in` : `${depth} mm tall`}.` };
    }
    let pts: [number, number][];
    let what: string;
    if (/\bslot\b/u.test(t)) {
      pts = slotOutline(sizes[0] ?? 20, sizes[1] ?? 6) as [number, number][];
      what = `${sizes[0] ?? 20} by ${sizes[1] ?? 6} mm slot`;
    } else if (/\b(hexagon|hex|octagon|pentagon)\b/u.test(t)) {
      const n = /\boctagon\b/u.test(t) ? 8 : /\bpentagon\b/u.test(t) ? 5 : 6;
      pts = polygonOutline(n, sizes[0] ?? 10) as [number, number][];
      what = `${n}-sided polygon ${sizes[0] ?? 10} mm across`;
    } else {
      pts = rectOutline(sizes[0] ?? 20, sizes[1] ?? sizes[0] ?? 20) as [number, number][];
      what = `${sizes[0] ?? 20} by ${sizes[1] ?? sizes[0] ?? 20} mm rectangle`;
    }
    const withFace = addFaceSketch(p, pts, at, fc);
    const k = featureCount(withFace) - 1;
    return { params: { ...withFace, [`c${k}`]: depth, [`g${k}`]: cut ? 1 : 0 }, reply: `A ${what} on the ${face} face, ${cut ? `cut ${depth} mm in` : `${depth} mm tall`}.` };
  }
  return null;
}
