/**
 * The parametric jobs: small real parts a seated person can finish in a few
 * minutes. Each job is a Part Language v2 program written as a function of
 * its parameters, plus everything the bench needs around it: the hand-derived
 * volume formula the truth gate checks, where the drag handles sit, how the
 * part is held and loaded for the stress preview, and which parameters the
 * agents may change.
 *
 * Model axes follow SOLIDWORKS: Y is up, the front plane is XY.
 */

import { compensationBulge } from './sketch.js';
import { Box3, PartSpec, Seg, Vec3 } from './types.js';

export type Params = Record<string, number>;

export interface ParamDef {
  id: string;
  label: string;
  unit: 'mm' | 'deg' | '';
  min: number;
  max: number;
  /** Step of a handle drag. */
  step: number;
  /** Step of one dial detent. */
  fine: number;
  value: number;
  /** How this value can be taken from a real object: finger span or two-hand tape. */
  measure?: 'span' | 'tape';
  /** Clearance added to a bound measurement, mm. */
  fit?: number;
  /** What to measure, shown while measuring. */
  prompt?: string;
}

export interface HandleDef {
  param: string;
  at: (p: Params) => Vec3;
  /** Unit direction the handle travels when the value grows. */
  axis: Vec3;
  /** Parameter change per millimetre of travel (may depend on the other parameters). */
  gain: number | ((p: Params) => number);
}

export type Region =
  | { kind: 'box'; min: Vec3; max: Vec3 }
  /** Annulus about the Y axis: rMin <= radius <= rMax, y0 <= y <= y1. */
  | { kind: 'ringY'; rMin: number; rMax: number; y0: number; y1: number };

export interface LoadCase {
  fixtureLabel: string;
  fixture: Region[];
  loadLabel: string;
  region: Region;
  /** Unit direction of the force. */
  dir: Vec3;
  newtons: number;
}

export interface JobRoles {
  /** The wall the manufacturing agent checks. */
  wall?: string;
  /** Parameters the structural agent may grow, most effective first. */
  stiffen: string[];
  hole?: string;
  cbore?: string;
  cboreDepth?: string;
  /** The parameter a real-world measurement binds to. */
  fit?: string;
}

export interface Job {
  id: string;
  title: string;
  blurb: string;
  params: ParamDef[];
  /** Enforce the relations between parameters. Returns notes on anything it changed. */
  clamp: (p: Params) => { params: Params; notes: string[] };
  spec: (p: Params) => PartSpec;
  /** Volume derived by hand from the drawing, independent of the kernel. */
  volume: (p: Params) => number;
  box: (p: Params) => { box: Box3; tol: number };
  genus: (p: Params) => number;
  handles: HandleDef[];
  loadCase: (p: Params) => LoadCase;
  roles: JobRoles;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;
const EXACT_BOX_TOL = 1e-4;

function snap(v: number, def: ParamDef): number {
  const s = def.fine;
  const clamped = Math.min(def.max, Math.max(def.min, v));
  return Math.round(clamped / s) * s;
}

/** Clamp every parameter to its own range and step, then apply the job's relations. */
function baseClamp(defs: ParamDef[], p: Params): Params {
  const out: Params = {};
  for (const d of defs) {
    out[d.id] = snap(p[d.id] ?? d.value, d);
  }
  return out;
}

function limit(
  p: Params,
  id: string,
  max: number,
  min: number,
  notes: string[],
  why: string,
): void {
  const v = p[id];
  const next = Math.max(min, Math.min(max, v));
  if (Math.abs(next - v) > 1e-9) {
    // Round towards the allowed side so the limit itself is never crossed.
    const q = next / 0.05;
    p[id] = (next < v ? Math.floor(q + 1e-9) : Math.ceil(q - 1e-9)) * 0.05;
    notes.push(why);
  }
}

// ---------------------------------------------------------------------------
// 1. Fit clip
// ---------------------------------------------------------------------------

const clipParams: ParamDef[] = [
  { id: 'gap', label: 'Grip opening', unit: 'mm', min: 2, max: 60, step: 1, fine: 0.05, value: 18, measure: 'tape', fit: 0.3, prompt: 'Pinch both faces of the edge it should grip' },
  { id: 'reach', label: 'Arm length', unit: 'mm', min: 10, max: 80, step: 1, fine: 0.05, value: 30 },
  { id: 't', label: 'Wall', unit: 'mm', min: 0.6, max: 8, step: 0.5, fine: 0.05, value: 3 },
  { id: 'w', label: 'Width', unit: 'mm', min: 5, max: 40, step: 1, fine: 0.05, value: 14 },
  { id: 'r', label: 'Corner radius', unit: 'mm', min: 0.5, max: 6, step: 0.5, fine: 0.05, value: 1.5 },
  { id: 'lip', label: 'Snap lip', unit: 'mm', min: 0, max: 4, step: 0.5, fine: 0.05, value: 1 },
];

const fitClip: Job = {
  id: 'fit-clip',
  title: 'Fit clip',
  blurb: 'A clip that grips the edge you measure.',
  params: clipParams,
  clamp(input) {
    const p = baseClamp(clipParams, input);
    const notes: string[] = [];
    limit(p, 'r', (p.gap - 0.5) / 2, 0.5, notes, 'Corner radius reduced to fit inside the opening.');
    limit(p, 'lip', Math.max(0, p.gap - 1), 0, notes, 'Snap lip reduced: it cannot close the opening.');
    limit(p, 'reach', 80, p.t + p.r + 2, notes, 'Arm lengthened so the lip clears the corner radius.');
    return { params: p, notes };
  },
  spec(p) {
    const { gap, reach, t, w, r, lip } = p;
    const top = 2 * t + gap;
    const loop: Seg[] = [
      ['L', -t, 0, reach, 0],
      ['L', reach, 0, reach, t],
      ['L', reach, t, r, t],
      ['A', r, t + r, r, t, 0, t + r, -1],
      ['L', 0, t + r, 0, t + gap - r],
      ['A', r, t + gap - r, 0, t + gap - r, r, t + gap, -1],
    ];
    if (lip > 1e-9) {
      loop.push(
        ['L', r, t + gap, reach - t, t + gap],
        ['L', reach - t, t + gap, reach - t, t + gap - lip],
        ['L', reach - t, t + gap - lip, reach, t + gap - lip],
        ['L', reach, t + gap - lip, reach, top],
      );
    } else {
      loop.push(['L', r, t + gap, reach, t + gap], ['L', reach, t + gap, reach, top]);
    }
    loop.push(['L', reach, top, -t, top], ['L', -t, top, -t, 0]);
    return {
      language: 2,
      name: 'fit_clip',
      units: 'mm',
      features: [
        { $op: 'sketch.loops', id: 'profile', sketched_on: 'front', args: { loops: [loop] } },
        { $op: 'feature.extrude', id: 'body', args: { depth: w / 2, direction: 'both' } },
      ],
      notes: {
        hand_check:
          'area = t (2t + gap) + 2 reach t + 2 r^2 (1 - pi/4) + lip t; volume = area x w',
      },
    };
  },
  volume(p) {
    const { gap, reach, t, w, r, lip } = p;
    const area =
      t * (2 * t + gap) + 2 * reach * t + 2 * r * r * (1 - Math.PI / 4) + lip * t;
    return area * w;
  },
  box(p) {
    return {
      box: { min: [-p.t, 0, -p.w / 2], max: [p.reach, 2 * p.t + p.gap, p.w / 2] },
      tol: EXACT_BOX_TOL,
    };
  },
  genus: () => 0,
  handles: [
    { param: 'gap', at: (p) => [p.reach * 0.45, 2 * p.t + p.gap, 0], axis: [0, 1, 0], gain: 1 },
    { param: 'reach', at: (p) => [p.reach, p.t / 2, 0], axis: [1, 0, 0], gain: 1 },
    { param: 't', at: (p) => [-p.t, p.t + p.gap / 2, 0], axis: [-1, 0, 0], gain: 1 },
    { param: 'w', at: (p) => [p.reach * 0.55, p.t + p.gap + p.t / 2, p.w / 2], axis: [0, 0, 1], gain: 2 },
  ],
  loadCase(p) {
    const top = 2 * p.t + p.gap;
    return {
      fixtureLabel: 'Lower arm held flat',
      fixture: [{ kind: 'box', min: [-p.t - 1, -1, -p.w], max: [p.reach + 1, 0, p.w] }],
      loadLabel: 'Opening force at the upper tip',
      region: {
        kind: 'box',
        min: [p.reach - Math.max(p.t, 3), p.t + p.gap - p.lip - 0.5, -p.w],
        max: [p.reach + 1, top + 1, p.w],
      },
      dir: [0, 1, 0],
      newtons: 10,
    };
  },
  roles: { wall: 't', stiffen: ['t', 'w', 'r'], fit: 'gap' },
};

// ---------------------------------------------------------------------------
// 2. Phone stand
// ---------------------------------------------------------------------------

const standParams: ParamDef[] = [
  { id: 'slot', label: 'Slot', unit: 'mm', min: 5, max: 18, step: 0.5, fine: 0.05, value: 9.5, measure: 'span', fit: 0.6, prompt: 'Hold the edge of your phone between thumb and finger' },
  { id: 'tilt', label: 'Lean angle', unit: 'deg', min: 8, max: 30, step: 1, fine: 0.25, value: 18 },
  { id: 'H', label: 'Back height', unit: 'mm', min: 30, max: 100, step: 1, fine: 0.05, value: 55 },
  { id: 'w', label: 'Width', unit: 'mm', min: 30, max: 100, step: 1, fine: 0.05, value: 60, measure: 'tape', prompt: 'Pinch both sides of your phone' },
  { id: 'lipH', label: 'Front lip height', unit: 'mm', min: 7, max: 25, step: 1, fine: 0.05, value: 12 },
  { id: 'front', label: 'Front lip depth', unit: 'mm', min: 5, max: 25, step: 1, fine: 0.05, value: 10 },
  { id: 'floor', label: 'Base thickness', unit: 'mm', min: 3, max: 10, step: 0.5, fine: 0.05, value: 4 },
  { id: 'back', label: 'Back wall', unit: 'mm', min: 2, max: 12, step: 0.5, fine: 0.05, value: 5 },
];

function standLength(p: Params): number {
  const tan = Math.tan(rad(p.tilt));
  return p.front + p.slot / Math.cos(rad(p.tilt)) + (p.H - p.floor) * tan + p.back;
}

const phoneStand: Job = {
  id: 'phone-stand',
  title: 'Phone stand',
  blurb: 'A stand with a slot cut to your phone.',
  params: standParams,
  clamp(input) {
    const p = baseClamp(standParams, input);
    const notes: string[] = [];
    limit(p, 'lipH', 25, p.floor + 3, notes, 'Front lip raised above the base.');
    limit(p, 'H', 100, p.lipH + 10, notes, 'Back raised above the front lip.');
    return { params: p, notes };
  },
  spec(p) {
    const tan = Math.tan(rad(p.tilt));
    const L = standLength(p);
    const f = p.floor;
    const rear = p.front + p.slot / Math.cos(rad(p.tilt));
    const pts: [number, number][] = [
      [0, 0],
      [L, 0],
      [L, p.H],
      [L - p.back, p.H],
      [rear, f],
      [p.front, f],
      [p.front + (p.lipH - f) * tan, p.lipH],
      [0, p.lipH],
    ];
    const loop: Seg[] = pts.map((a, i): Seg => {
      const b = pts[(i + 1) % pts.length];
      return ['L', a[0], a[1], b[0], b[1]];
    });
    return {
      language: 2,
      name: 'phone_stand',
      units: 'mm',
      features: [
        { $op: 'sketch.loops', id: 'profile', sketched_on: 'front', args: { loops: [loop] } },
        { $op: 'feature.extrude', id: 'body', args: { depth: p.w / 2, direction: 'both' } },
      ],
      notes: {
        hand_check:
          'area = L floor + front (lipH - floor) + (lipH - floor)^2 tan/2 + back (H - floor) + (H - floor)^2 tan/2; volume = area x w',
      },
    };
  },
  volume(p) {
    const tan = Math.tan(rad(p.tilt));
    const L = standLength(p);
    const a = p.lipH - p.floor;
    const b = p.H - p.floor;
    const area =
      L * p.floor + p.front * a + (a * a * tan) / 2 + p.back * b + (b * b * tan) / 2;
    return area * p.w;
  },
  box(p) {
    return {
      box: { min: [0, 0, -p.w / 2], max: [standLength(p), p.H, p.w / 2] },
      tol: EXACT_BOX_TOL,
    };
  },
  genus: () => 0,
  handles: [
    { param: 'H', at: (p) => [standLength(p) - p.back / 2, p.H, 0], axis: [0, 1, 0], gain: 1 },
    { param: 'w', at: (p) => [standLength(p) * 0.5, p.floor / 2, p.w / 2], axis: [0, 0, 1], gain: 2 },
    {
      param: 'slot',
      at: (p) => [p.front + p.slot / Math.cos(rad(p.tilt)), p.floor, p.w / 2],
      axis: [1, 0, 0],
      gain: 0.95,
    },
    { param: 'front', at: (p) => [0, p.lipH / 2, 0], axis: [-1, 0, 0], gain: 1 },
  ],
  loadCase(p) {
    const L = standLength(p);
    const t = rad(p.tilt);
    return {
      fixtureLabel: 'Base resting on the desk',
      fixture: [{ kind: 'box', min: [-1, -1, -p.w], max: [L + 1, 0, p.w] }],
      loadLabel: 'Phone leaning on the back',
      region: {
        kind: 'box',
        min: [L - p.back - (p.H - p.floor) * Math.tan(t) * 0.35 - 1, p.H * 0.65, -p.w],
        max: [L + 1, p.H + 1, p.w],
      },
      dir: [Math.cos(t), -Math.sin(t), 0],
      newtons: 6,
    };
  },
  roles: { wall: 'back', stiffen: ['back', 'floor'], fit: 'slot' },
};

// ---------------------------------------------------------------------------
// 3. Wall bracket
// ---------------------------------------------------------------------------

const bracketParams: ParamDef[] = [
  { id: 'arm', label: 'Arm length', unit: 'mm', min: 25, max: 140, step: 1, fine: 0.05, value: 70, measure: 'tape', prompt: 'Pinch the depth of what it must carry' },
  { id: 'height', label: 'Plate height', unit: 'mm', min: 30, max: 140, step: 1, fine: 0.05, value: 70 },
  { id: 't', label: 'Wall', unit: 'mm', min: 1, max: 10, step: 0.5, fine: 0.05, value: 4 },
  { id: 'w', label: 'Width', unit: 'mm', min: 10, max: 60, step: 1, fine: 0.05, value: 24 },
  { id: 'g', label: 'Gusset', unit: 'mm', min: 0, max: 60, step: 1, fine: 0.05, value: 14 },
  { id: 'd', label: 'Screw hole', unit: 'mm', min: 2.5, max: 9, step: 0.5, fine: 0.05, value: 4.2 },
];

const bracketZone = (p: Params): number => p.height - p.t - p.g;

const wallBracket: Job = {
  id: 'wall-bracket',
  title: 'Wall bracket',
  blurb: 'A shelf bracket you can load-test with your palm.',
  params: bracketParams,
  clamp(input) {
    const p = baseClamp(bracketParams, input);
    const notes: string[] = [];
    limit(p, 'd', p.w - 4, 2.5, notes, 'Screw hole reduced to leave wall on both sides.');
    limit(p, 'g', Math.min(p.arm - p.t - 2, p.height - p.t - 3 * p.d - 6), 0, notes, 'Gusset reduced to leave room for both screws.');
    return { params: p, notes };
  },
  spec(p) {
    const { arm, height, t, w, g, d } = p;
    const pts: [number, number][] = [[0, 0], [t, 0]];
    if (g > 1e-9) {
      pts.push([t, height - t - g], [t + g, height - t]);
    } else {
      pts.push([t, height - t]);
    }
    pts.push([arm, height - t], [arm, height], [0, height]);
    const loop: Seg[] = pts.map((a, i): Seg => {
      const b = pts[(i + 1) % pts.length];
      return ['L', a[0], a[1], b[0], b[1]];
    });
    const zone = bracketZone(p);
    return {
      language: 2,
      name: 'wall_bracket',
      units: 'mm',
      features: [
        { $op: 'sketch.loops', id: 'profile', sketched_on: 'front', args: { loops: [loop] } },
        { $op: 'feature.extrude', id: 'body', args: { depth: w / 2, direction: 'both' } },
        {
          $op: 'feature.hole',
          id: 'screws',
          sketched_on: 'right',
          args: {
            diameter: d,
            depth: t,
            direction: 'normal',
            centers: [
              [0, zone * 0.22],
              [0, zone * 0.78],
            ],
          },
        },
      ],
      notes: {
        hand_check:
          'area = t height + (arm - t) t + g^2/2; volume = area x w - 2 pi (d/2)^2 t',
      },
    };
  },
  volume(p) {
    const area = p.t * p.height + (p.arm - p.t) * p.t + (p.g * p.g) / 2;
    return area * p.w - 2 * Math.PI * (p.d / 2) ** 2 * p.t;
  },
  box(p) {
    return {
      box: { min: [0, 0, -p.w / 2], max: [p.arm, p.height, p.w / 2] },
      tol: EXACT_BOX_TOL,
    };
  },
  genus: () => 2,
  handles: [
    { param: 'arm', at: (p) => [p.arm, p.height - p.t / 2, 0], axis: [1, 0, 0], gain: 1 },
    { param: 'height', at: (p) => [p.arm * 0.4, p.height, 0], axis: [0, 1, 0], gain: 1 },
    { param: 'w', at: (p) => [p.arm * 0.6, p.height - p.t / 2, p.w / 2], axis: [0, 0, 1], gain: 2 },
    { param: 't', at: (p) => [p.t, bracketZone(p) * 0.5, 0], axis: [1, 0, 0], gain: 1 },
  ],
  loadCase(p) {
    return {
      fixtureLabel: 'Back face screwed to the wall',
      fixture: [{ kind: 'box', min: [-1, -1, -p.w], max: [0, p.height + 1, p.w] }],
      loadLabel: 'Hanging load at the arm tip',
      region: {
        kind: 'box',
        min: [p.arm * 0.72, p.height - 0.5, -p.w],
        max: [p.arm + 1, p.height + 1, p.w],
      },
      dir: [0, -1, 0],
      newtons: 50,
    };
  },
  roles: { wall: 't', stiffen: ['g', 't', 'w'], hole: 'd' },
};

// ---------------------------------------------------------------------------
// 4. Flange plate
// ---------------------------------------------------------------------------

const flangeParams: ParamDef[] = [
  { id: 'D', label: 'Outer diameter', unit: 'mm', min: 40, max: 130, step: 1, fine: 0.05, value: 70 },
  { id: 'B', label: 'Bore', unit: 'mm', min: 5, max: 70, step: 0.5, fine: 0.05, value: 22, measure: 'span', fit: 0.2, prompt: 'Span the shaft or tube it must fit over' },
  { id: 'th', label: 'Thickness', unit: 'mm', min: 3, max: 16, step: 0.5, fine: 0.05, value: 8 },
  { id: 'N', label: 'Bolts', unit: '', min: 3, max: 8, step: 1, fine: 1, value: 4 },
  { id: 'bcd', label: 'Bolt circle', unit: 'mm', min: 20, max: 115, step: 1, fine: 0.05, value: 50 },
  { id: 'd', label: 'Bolt hole', unit: 'mm', min: 3, max: 11, step: 0.5, fine: 0.05, value: 5.2 },
  { id: 'cb', label: 'Counterbore', unit: 'mm', min: 5, max: 18, step: 0.5, fine: 0.05, value: 9.5 },
  { id: 'cbd', label: 'Counterbore depth', unit: 'mm', min: 0, max: 12, step: 0.5, fine: 0.05, value: 4 },
];

const flangePlate: Job = {
  id: 'flange-plate',
  title: 'Flange plate',
  blurb: 'A bolted flange with a standard bolt circle.',
  params: flangeParams,
  clamp(input) {
    const p = baseClamp(flangeParams, input);
    p.N = Math.round(p.N);
    const notes: string[] = [];
    limit(p, 'cb', 18, p.d + 1, notes, 'Counterbore widened past the bolt hole.');
    limit(p, 'cbd', p.th - 1.5, 0, notes, 'Counterbore made shallower to keep a floor under the head.');
    limit(p, 'bcd', p.D - p.cb - 4, p.B + p.cb + 4, notes, 'Bolt circle moved to sit between the bore and the rim.');
    if (p.bcd + p.cb + 4 > p.D) {
      p.D = Math.ceil(p.bcd + p.cb + 4);
      notes.push('Outer diameter grown to hold the bolt circle.');
    }
    while (p.N > 3 && p.bcd * Math.sin(Math.PI / p.N) < p.cb + 2) {
      p.N -= 1;
      notes.push('One bolt removed: the counterbores would overlap.');
    }
    return { params: p, notes };
  },
  spec(p) {
    const { D, B, th, N, bcd, d, cb, cbd } = p;
    const hole: Record<string, unknown> =
      cbd > 1e-9
        ? { diameter: d, depth: th, direction: 'reverse', type: 'counterbore', cbore_diameter: cb, cbore_depth: cbd, centers: [[bcd / 2, 0]] }
        : { diameter: d, depth: th, direction: 'reverse', centers: [[bcd / 2, 0]] };
    return {
      language: 2,
      name: 'flange_plate',
      units: 'mm',
      features: [
        {
          $op: 'sketch.loops',
          id: 'disc',
          sketched_on: 'top',
          args: { loops: [[['C', 0, 0, D / 2]], [['C', 0, 0, B / 2]]] },
        },
        { $op: 'feature.extrude', id: 'plate', args: { depth: th } },
        { $op: 'ref.plane', id: 'deck', args: { base: 'top', offset: th } },
        { $op: 'feature.hole', id: 'bolt', sketched_on: 'deck', args: hole },
        { $op: 'feature.pattern.circular', id: 'bolts', args: { feature: 'bolt', count: N, axis: 'Y' } },
      ],
      notes: {
        hand_check:
          'pi (D^2 - B^2)/4 th - N [pi d^2/4 th + pi (cb^2 - d^2)/4 cbd]',
      },
    };
  },
  volume(p) {
    const plate = (Math.PI * (p.D * p.D - p.B * p.B) * p.th) / 4;
    const bolt =
      (Math.PI * p.d * p.d * p.th) / 4 +
      (p.cbd > 1e-9 ? (Math.PI * (p.cb * p.cb - p.d * p.d) * p.cbd) / 4 : 0);
    return plate - p.N * bolt;
  },
  box(p) {
    const R = p.D / 2;
    return {
      box: { min: [-R, 0, -R], max: [R, p.th, R] },
      tol: compensationBulge(R) + EXACT_BOX_TOL,
    };
  },
  genus: (p) => Math.round(p.N) + 1,
  handles: [
    { param: 'D', at: (p) => [p.D / 2, p.th / 2, 0], axis: [1, 0, 0], gain: 2 },
    {
      param: 'th',
      at: (p) => {
        const a = Math.PI / Math.round(p.N);
        const rho = (p.D / 2) * 0.88;
        return [rho * Math.cos(a), p.th, rho * Math.sin(a)];
      },
      axis: [0, 1, 0],
      gain: 1,
    },
    { param: 'B', at: (p) => [-p.B / 2, p.th, 0], axis: [-1, 0, 0], gain: 2 },
  ],
  loadCase(p) {
    return {
      fixtureLabel: 'Bolted down around the bolt circle',
      fixture: [{ kind: 'ringY', rMin: p.bcd / 2 - p.d, rMax: p.D, y0: -1, y1: 0 }],
      loadLabel: 'Axial load at the bore',
      region: { kind: 'ringY', rMin: 0, rMax: p.B / 2 + Math.max(3, p.th * 0.4), y0: p.th - 0.5, y1: p.th + 1 },
      dir: [0, -1, 0],
      newtons: 200,
    };
  },
  roles: { wall: 'th', stiffen: ['th'], hole: 'd', cbore: 'cb', cboreDepth: 'cbd', fit: 'B' },
};

// ---------------------------------------------------------------------------
// 5. Knob
// ---------------------------------------------------------------------------

const knobParams: ParamDef[] = [
  { id: 'bore', label: 'Shaft bore', unit: 'mm', min: 3, max: 30, step: 0.5, fine: 0.05, value: 6, measure: 'span', fit: 0.2, prompt: 'Span the shaft, pen or rod it should cap' },
  { id: 'depth', label: 'Bore depth', unit: 'mm', min: 4, max: 40, step: 1, fine: 0.05, value: 12 },
  { id: 'D', label: 'Grip diameter', unit: 'mm', min: 12, max: 80, step: 1, fine: 0.05, value: 28 },
  { id: 'H', label: 'Height', unit: 'mm', min: 8, max: 60, step: 1, fine: 0.05, value: 18 },
  { id: 'c', label: 'Top chamfer', unit: 'mm', min: 0.5, max: 8, step: 0.5, fine: 0.05, value: 2 },
];

const knob: Job = {
  id: 'knob',
  title: 'Knob',
  blurb: 'A turned cap for the shaft you measure.',
  params: knobParams,
  clamp(input) {
    const p = baseClamp(knobParams, input);
    const notes: string[] = [];
    limit(p, 'D', 80, p.bore + 4, notes, 'Grip diameter grown to leave wall around the bore.');
    limit(p, 'H', 60, p.depth + 2, notes, 'Height grown to close the top of the bore.');
    limit(p, 'c', Math.min(p.D * 0.3, p.H * 0.5), 0.5, notes, 'Chamfer reduced to fit the rim.');
    return { params: p, notes };
  },
  spec(p) {
    const R = p.D / 2;
    const rb = p.bore / 2;
    const pts: [number, number][] = [
      [rb, 0],
      [R, 0],
      [R, p.H - p.c],
      [R - p.c, p.H],
      [0, p.H],
      [0, p.depth],
      [rb, p.depth],
    ];
    return {
      language: 2,
      name: 'knob',
      units: 'mm',
      features: [
        { $op: 'sketch.profile', id: 'half', sketched_on: 'front', args: { points: pts } },
        { $op: 'feature.revolve', id: 'body', args: { axis: 'v', angle: 360 } },
      ],
      notes: {
        hand_check:
          'pi R^2 (H - c) + pi c (R^2 + R (R - c) + (R - c)^2)/3 - pi rb^2 depth',
      },
    };
  },
  volume(p) {
    const R = p.D / 2;
    const rb = p.bore / 2;
    const top = R - p.c;
    return (
      Math.PI * R * R * (p.H - p.c) +
      (Math.PI * p.c * (R * R + R * top + top * top)) / 3 -
      Math.PI * rb * rb * p.depth
    );
  },
  box(p) {
    const R = p.D / 2;
    return {
      box: { min: [-R, 0, -R], max: [R, p.H, R] },
      tol: compensationBulge(R) + EXACT_BOX_TOL,
    };
  },
  genus: () => 0,
  handles: [
    { param: 'D', at: (p) => [p.D / 2, (p.H - p.c) / 2, 0], axis: [1, 0, 0], gain: 2 },
    { param: 'H', at: (p) => [0, p.H, 0], axis: [0, 1, 0], gain: 1 },
  ],
  loadCase(p) {
    const R = p.D / 2;
    return {
      fixtureLabel: 'Held on the shaft',
      fixture: [{ kind: 'ringY', rMin: 0, rMax: p.bore / 2, y0: -1, y1: p.depth }],
      loadLabel: 'Side load on the rim',
      region: {
        kind: 'box',
        min: [R * 0.55, p.H - p.c - Math.max(3, p.H * 0.25), -R * 0.6],
        max: [R + 1, p.H + 1, R * 0.6],
      },
      dir: [-1, 0, 0],
      newtons: 20,
    };
  },
  roles: { stiffen: ['D'], fit: 'bore' },
};

// ---------------------------------------------------------------------------
// 6. Cradle: a tray that holds the object you measured
// ---------------------------------------------------------------------------

const cradleParams: ParamDef[] = [
  { id: 'L', label: 'Object length', unit: 'mm', min: 10, max: 160, step: 1, fine: 0.05, value: 75, measure: 'tape', prompt: 'Pinch both ends of the object' },
  { id: 'W', label: 'Object width', unit: 'mm', min: 10, max: 120, step: 1, fine: 0.05, value: 40, measure: 'tape', prompt: 'Pinch both sides of the object' },
  { id: 'H', label: 'Object height', unit: 'mm', min: 4, max: 80, step: 1, fine: 0.05, value: 12, measure: 'span', prompt: 'Span its thickness between thumb and finger' },
  { id: 'clr', label: 'Clearance', unit: 'mm', min: 0, max: 2, step: 0.1, fine: 0.05, value: 0.4 },
  { id: 'hold', label: 'Held height', unit: '', min: 0.2, max: 1, step: 0.05, fine: 0.05, value: 0.6 },
  { id: 't', label: 'Wall', unit: 'mm', min: 0.6, max: 8, step: 0.5, fine: 0.05, value: 2 },
  { id: 'floor', label: 'Floor', unit: 'mm', min: 1, max: 8, step: 0.5, fine: 0.05, value: 2 },
];

function cradleDims(p: Params) {
  const pl = p.L + 2 * p.clr;
  const pw = p.W + 2 * p.clr;
  const ol = pl + 2 * p.t;
  const ow = pw + 2 * p.t;
  const depth = p.H * p.hold;
  return { pl, pw, ol, ow, depth, total: p.floor + depth };
}

const cradle: Job = {
  id: 'cradle',
  title: 'Cradle',
  blurb: 'A tray with a pocket the size of the thing you measured.',
  params: cradleParams,
  clamp(input) {
    const p = baseClamp(cradleParams, input);
    return { params: p, notes: [] };
  },
  spec(p) {
    const d = cradleDims(p);
    return {
      language: 2,
      name: 'cradle',
      units: 'mm',
      features: [
        { $op: 'sketch.rectangle', id: 'outline', sketched_on: 'top', args: { width: d.ol, height: d.ow, x: -d.ol / 2, y: -d.ow / 2 } },
        { $op: 'feature.extrude', id: 'block', args: { depth: d.total } },
        { $op: 'ref.plane', id: 'rim', args: { base: 'top', offset: d.total } },
        { $op: 'sketch.rectangle', id: 'pocket_sk', sketched_on: 'rim', args: { width: d.pl, height: d.pw, x: -d.pl / 2, y: -d.pw / 2 } },
        { $op: 'feature.cut', id: 'pocket', args: { depth: d.depth, direction: 'reverse' } },
      ],
      notes: {
        hand_check: 'pocket = (L + 2 clr) x (W + 2 clr) x H hold; volume = outer area x (floor + H hold) - pocket',
      },
    };
  },
  volume(p) {
    const d = cradleDims(p);
    return d.ol * d.ow * d.total - d.pl * d.pw * d.depth;
  },
  box(p) {
    const d = cradleDims(p);
    return { box: { min: [-d.ol / 2, 0, -d.ow / 2], max: [d.ol / 2, d.total, d.ow / 2] }, tol: EXACT_BOX_TOL };
  },
  genus: () => 0,
  handles: [
    { param: 'L', at: (p) => [cradleDims(p).ol / 2, cradleDims(p).total, 0], axis: [1, 0, 0], gain: 2 },
    { param: 'W', at: (p) => [0, cradleDims(p).total, cradleDims(p).ow / 2], axis: [0, 0, 1], gain: 2 },
    { param: 'H', at: (p) => [-cradleDims(p).ol / 2, cradleDims(p).total, 0], axis: [0, 1, 0], gain: (p) => 1 / Math.max(0.2, p.hold) },
  ],
  loadCase(p) {
    const d = cradleDims(p);
    return {
      fixtureLabel: 'Base on the desk',
      fixture: [{ kind: 'box', min: [-d.ol, -1, -d.ow], max: [d.ol, 0, d.ow] }],
      loadLabel: 'Pushing one long wall inwards at the rim',
      region: { kind: 'box', min: [-d.pl / 4, d.total - Math.min(3, d.depth / 2), d.ow / 2 - 0.5], max: [d.pl / 4, d.total + 1, d.ow / 2 + 1] },
      dir: [0, 0, -1],
      newtons: 20,
    };
  },
  roles: { wall: 't', stiffen: ['t', 'floor'], fit: 'L' },
};

export const JOBS: readonly Job[] = [cradle, fitClip, phoneStand, wallBracket, flangePlate, knob];

export const jobById = (id: string): Job => JOBS.find((j) => j.id === id) ?? JOBS[0];

export function defaultParams(job: Job): Params {
  const p: Params = {};
  for (const d of job.params) {
    p[d.id] = d.value;
  }
  return job.clamp(p).params;
}

export const paramDef = (job: Job, id: string): ParamDef | undefined =>
  job.params.find((d) => d.id === id);

export const handleGain = (h: HandleDef, p: Params): number =>
  typeof h.gain === 'function' ? h.gain(p) : h.gain;
