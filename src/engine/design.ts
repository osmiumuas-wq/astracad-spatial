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
 *  14 FACE    a outline index, b normal code, c depth, d x, e y, f z origin, g 0 boss / 1 cut:
 *             a sketch on any flat face, pulled out of it or cut into it
 *
 * Normal codes: 0 +Y, 1 -Y, 2 +X, 3 -X, 4 +Z, 5 -Z.
 */

import type { Feature, PartSpec } from './types.js';
import type { HandleDef, Job, LoadCase, ParamDef, Params } from './jobs.js';

export const OPS = { BOX: 1, CYL: 2, CUTBOX: 3, HOLE: 4, FILLET: 5, SHELL: 6, LINPAT: 7, CIRCPAT: 8, OUTLINE: 9, BORE: 10, CHAMFER: 11, MIRROR: 12, REVOLVE: 13, FACE: 14, EDGE: 15 } as const;
export const OP_NAMES: Record<number, string> = { 1: 'Box', 2: 'Cylinder', 3: 'Cut box', 4: 'Hole', 5: 'Fillet', 6: 'Shell', 7: 'Pattern', 8: 'Circular pattern', 9: 'Sketch', 10: 'Bore', 11: 'Chamfer', 12: 'Mirror', 13: 'Revolve', 14: 'Face sketch', 15: 'Edge' };

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

export function addOutline(p: Params, pts: [number, number][]): { params: Params; index: number } {
  let k = 0;
  while (`q${k}n` in p) k++;
  const out: Params = { ...p, [`q${k}n`]: pts.length };
  pts.forEach(([x, y], j) => {
    out[`q${k}x${j}`] = x;
    out[`q${k}y${j}`] = y;
  });
  return { params: out, index: k };
}

const isBody = (op: number): boolean => op === OPS.BOX || op === OPS.CYL || op === OPS.CUTBOX || op === OPS.OUTLINE || op === OPS.BORE || op === OPS.FACE || op === OPS.REVOLVE;

function outlinePts(p: Params, k: number): [number, number][] {
  const m = Math.round(p[`q${k}n`] ?? 0);
  const pts: [number, number][] = [];
  for (let j = 0; j < m; j++) pts.push([p[`q${k}x${j}`], p[`q${k}y${j}`]]);
  return pts;
}

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
      features.push(op === OPS.BOX ? { $op: 'feature.extrude', id, args: { depth: v.c } } : { $op: 'feature.cut', id, args: { depth: v.c, direction: 'normal' } });
    } else if (op === OPS.CYL || op === OPS.BORE) {
      features.push(plane(`pl${i}`, v.f));
      features.push({ $op: 'sketch.circle', id: `s${i}`, sketched_on: `pl${i}`, args: { diameter: v.a, x: v.d, y: -v.e } });
      features.push(op === OPS.CYL ? { $op: 'feature.extrude', id, args: { depth: v.c } } : { $op: 'feature.cut', id, args: { depth: v.c, direction: 'normal' } });
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
    } else if (op === OPS.EDGE) {
      features.push({ $op: 'feature.edge_fillet', id, args: { from: [v.c, v.d, v.e], to: [v.f, v.g, v.h], radius: v.a, kind: Math.round(v.b) === 1 ? 'chamfer' : 'fillet' } });
    } else if (op === OPS.CHAMFER) {
      features.push({ $op: 'feature.chamfer', id, args: { distance: v.a, feature: `f${Math.round(v.b)}`, edges: 'profile' } });
    } else if (op === OPS.MIRROR) {
      features.push({ $op: 'feature.mirror', id, args: { plane: ['X', 'Y', 'Z'][Math.max(0, Math.min(2, Math.round(v.a)))], offset: v.b } });
    } else if (op === OPS.FACE || op === OPS.REVOLVE) {
      const fr = FACE_FRAMES[Math.max(0, Math.min(5, Math.round(op === OPS.FACE ? v.b : v.g)))];
      // A boss starts 0.01 mm inside the face it stands on, so it always fuses with it (the overlap is
      // inside material that is already there, so the volume is unchanged).
      const sink = op === OPS.FACE && Math.round(v.g) !== 1 ? 0.01 : 0;
      const origin: [number, number, number] = [v.d - fr.n[0] * sink, v.e - fr.n[1] * sink, v.f - fr.n[2] * sink];
      features.push({ $op: 'ref.plane', id: `pl${i}`, args: { origin, normal: fr.n, x_dir: fr.x } });
      features.push({ $op: 'sketch.profile', id: `s${i}`, sketched_on: `pl${i}`, args: { points: outlinePts(p, Math.round(v.a)) } });
      if (op === OPS.REVOLVE) features.push({ $op: 'feature.revolve', id, args: { angle: Math.max(1, Math.min(360, v.b || 360)), axis: 'v' } });
      else features.push(Math.round(v.g) === 1 ? { $op: 'feature.cut', id, args: { depth: v.c, direction: 'reverse' } } : { $op: 'feature.extrude', id, args: { depth: v.c + sink } });
    } else if (op === OPS.OUTLINE) {
      const k = Math.round(v.a);
      const m = Math.round(p[`q${k}n`] ?? 0);
      const pts: [number, number][] = [];
      for (let j = 0; j < m; j++) pts.push([p[`q${k}x${j}`], p[`q${k}y${j}`]]);
      features.push(plane(`pl${i}`, v.f));
      features.push({ $op: 'sketch.profile', id: `s${i}`, sketched_on: `pl${i}`, args: { points: pts } });
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
export function parseDesign(text: string, p: Params, here?: [number, number, number], edgeAt?: (at: [number, number, number]) => { a: [number, number, number]; b: [number, number, number] } | null): DesignEdit | null {
  const t = text.toLowerCase().replace(/(\d)\s*x\s*(\d)/gu, '$1 by $2');
  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)/gu)].map((m) => parseFloat(m[1]));
  const top = topOf(p);
  const at = here ?? [0, top, 0];
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
  // "fillet this edge 3", "chamfer that edge 2": the edge nearest the pointed spot.
  if (/\b(fillet|round|chamfer|bevel)\b/u.test(t) && /\b(this|that) edge\b|\bedge here\b/u.test(t)) {
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
export function addFaceSketch(p: Params, pts: [number, number][], origin: [number, number, number], code: number): Params {
  const o = addOutline(p, pts);
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
