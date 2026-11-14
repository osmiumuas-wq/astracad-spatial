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
 */

import type { Feature, PartSpec } from './types.js';
import type { HandleDef, Job, LoadCase, ParamDef, Params } from './jobs.js';

export const OPS = { BOX: 1, CYL: 2, CUTBOX: 3, HOLE: 4, FILLET: 5, SHELL: 6, LINPAT: 7, CIRCPAT: 8, OUTLINE: 9, BORE: 10 } as const;
export const OP_NAMES: Record<number, string> = { 1: 'Box', 2: 'Cylinder', 3: 'Cut box', 4: 'Hole', 5: 'Fillet', 6: 'Shell', 7: 'Pattern', 8: 'Circular pattern', 9: 'Sketch', 10: 'Bore' };
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

const isBody = (op: number): boolean => op === OPS.BOX || op === OPS.CYL || op === OPS.CUTBOX || op === OPS.OUTLINE || op === OPS.BORE;

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

/** Index of the last feature that is a body (a box, cylinder, cut, sketch), or -1. */
export function lastBody(p: Params): number {
  for (let i = featureCount(p) - 1; i >= 0; i--) if (isBody(readFeature(p, i).op)) return i;
  return -1;
}

/** Editable sizes: those of the last feature, so "make it 10 taller" and the handles act on it. */
function liveDefs(p: Params): ParamDef[] {
  const i = featureCount(p) - 1;
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
    default:
      return [];
  }
}

/** Handles on the last feature: width, depth, height for a box; diameter and height for a cylinder. */
function liveHandles(p: Params): HandleDef[] {
  const i = featureCount(p) - 1;
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
export function parseDesign(text: string, p: Params, here?: [number, number, number]): DesignEdit | null {
  const t = text.toLowerCase().replace(/(\d)\s*x\s*(\d)/gu, '$1 by $2');
  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)/gu)].map((m) => parseFloat(m[1]));
  const top = topOf(p);
  const at = here ?? [0, top, 0];
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
    const body = lastBody(p);
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
