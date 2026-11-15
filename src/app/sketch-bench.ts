/**
 * The sketch workbench's state and tools, without Three.js: what a click at
 * (u, v) on the face does with the current tool, the selection, constraints,
 * dimensions, and finishing the sketch as Extrude, Cut or Revolve. The VR
 * system (src/systems/sketch-bench-system.ts) draws it and turns pinches into
 * clicks; voice and the toolbar call the same methods.
 */

import type { GcsWrapper } from '@salusoft89/planegcs';
import { addFeature, addOutline, addPath, OPS, sketchFeatures, turnedFrame } from '../engine/design.js';
import type { Params } from '../engine/jobs.js';
import {
  addArc3,
  addCircle,
  addConstraint,
  addEllipse,
  circularPattern,
  extendAt,
  linearPattern,
  addLine,
  addPolygon,
  addRectangle,
  addSlot,
  addTangentArc,
  addSpline,
  dimension,
  filletCorner,
  measure,
  mirrorEntities,
  newSketch,
  offsetEntity,
  openChains,
  trimAt,
  pickEntity,
  profiles,
  removeEntity,
  Sketch2D,
  Snap,
  snap,
  solve,
} from '../engine/sketch2d.js';

export type SketchTool = 'line' | 'rect' | 'circle' | 'arc' | 'tangentArc' | 'slot' | 'polygon' | 'spline' | 'ellipse' | 'select' | 'dimension' | 'delete' | 'fillet' | 'trim' | 'extend' | 'offset' | 'mirror';

export const TOOL_NAMES: Record<SketchTool, string> = {
  line: 'Line',
  rect: 'Rectangle',
  circle: 'Circle',
  arc: '3-point arc',
  tangentArc: 'Tangent arc',
  slot: 'Slot',
  polygon: 'Polygon',
  spline: 'Spline',
  ellipse: 'Ellipse',
  select: 'Select',
  dimension: 'Smart dimension',
  delete: 'Delete',
  fillet: 'Sketch fillet',
  trim: 'Trim',
  extend: 'Extend',
  offset: 'Offset',
  mirror: 'Mirror',
};

/** Clicks each tool takes, and what to ask for at each. */
const STEPS: Record<SketchTool, string[]> = {
  line: ['Pick the start', 'Pick the end (pick the first point again to close)'],
  rect: ['Pick a corner', 'Pick the opposite corner'],
  circle: ['Pick the centre', 'Pick a point on the circle'],
  arc: ['Pick the start', 'Pick the end', 'Pick a point the arc passes through'],
  tangentArc: ['Pick where the arc ends (it leaves the last line tangent)'],
  slot: ['Pick one end centre', 'Pick the other end centre', 'Pick the width'],
  polygon: ['Pick the centre', 'Pick a corner'],
  spline: ['Pick points along the curve; pick the last one again (or an existing point) to finish'],
  ellipse: ['Pick the centre', 'Pick the end of the long axis', 'Pick how wide it is'],
  select: ['Pick a line, arc or circle (up to two)'],
  dimension: ['Pick a line, arc or circle, then say its size or turn the dial'],
  delete: ['Pick what to delete'],
  fillet: ['Pick a corner where two lines meet ("fillet 5" sets the radius)'],
  trim: ['Pick the piece to cut away'],
  extend: ['Pick a line near the end to extend'],
  offset: ['Pick a line, arc, circle or outline', 'Pick the side to offset to ("offset 5" sets the distance)'],
  mirror: ['Select what to mirror first, then pick the mirror line'],
};

export class SketchBench {
  sk: Sketch2D = newSketch();
  tool: SketchTool = 'line';
  pending: Snap[] = [];
  selected: string[] = [];
  polygonSides = 6;
  /** The sketch plane turned in the face (degrees) and tilted out of it (degrees): an angled plane. */
  rot = 0;
  tilt = 0;
  filletR = 3;
  offsetD = 5;
  /** A loft's first profile (its outer loop) and how far the second sketch is from it, once started. */
  loftFrom: { pts: [number, number][]; sweeps: number[]; distance: number; origin: [number, number, number] } | null = null;
  /** The line just drawn (a tangent arc leaves it). */
  lastLine: string | null = null;
  /** The first point of the line chain being drawn, to close it. */
  chainStart: string | null = null;
  status = '';
  dof = -1;
  /** Bumped on every change, for the view to redraw. */
  version = 0;
  private history: string[] = [];

  constructor(
    public origin: [number, number, number],
    readonly code: number,
    private readonly gcs: GcsWrapper,
  ) {
    this.status = `${TOOL_NAMES[this.tool]}: ${STEPS[this.tool][0]}.`;
  }

  setTool(t: SketchTool): string {
    this.tool = t;
    this.pending = [];
    this.chainStart = null;
    if (t !== 'select' && t !== 'dimension' && t !== 'mirror') this.selected = [];
    this.version++;
    if (t === 'tangentArc' && !this.lastLine) return (this.status = 'Draw a line first: a tangent arc leaves the end of the last line.');
    return (this.status = `${TOOL_NAMES[t]}: ${STEPS[t][0]}.`);
  }

  /** Where a click would land (for the preview): snapped. */
  hover(u: number, v: number): Snap {
    return snap(this.sk, u, v);
  }

  private remember(): void {
    this.history.push(JSON.stringify(this.sk));
    if (this.history.length > 50) this.history.shift();
  }

  undo(): string {
    const last = this.history.pop();
    if (!last) return (this.status = 'Nothing to undo in this sketch.');
    this.sk = JSON.parse(last) as Sketch2D;
    this.pending = [];
    this.selected = [];
    this.chainStart = null;
    this.lastLine = null;
    this.version++;
    return (this.status = 'Undone.');
  }

  private settle(what: string): string {
    const r = solve(this.gcs, this.sk);
    this.dof = r.dof;
    this.version++;
    const def = r.dof === 0 ? 'fully defined' : r.dof > 0 ? `${r.dof} degree${r.dof === 1 ? '' : 's'} of freedom left` : '';
    if (!r.ok) return (this.status = `${what} That over-defines the sketch: undo it or delete a dimension.`);
    return (this.status = `${what}${def ? ` Sketch ${def}.` : ''}`);
  }

  /** A pick at (u, v) mm on the face, with the current tool. */
  click(u: number, v: number): string {
    const s = snap(this.sk, u, v);
    const t = this.tool;
    try {
      if (t === 'select' || t === 'dimension' || t === 'delete') {
        const id = pickEntity(this.sk, u, v, 3);
        if (!id) return (this.status = 'Nothing there: pick closer to a line, arc or circle.');
        if (t === 'delete') {
          this.remember();
          removeEntity(this.sk, id);
          this.selected = this.selected.filter((x) => x !== id);
          return this.settle('Deleted.');
        }
        if (t === 'dimension') {
          this.selected = [id];
          this.version++;
          const m = measure(this.sk, id)!;
          return (this.status = `${m.kind === 'length' ? 'Length' : 'Diameter'} now ${(m.kind === 'radius' ? 2 * m.value : m.value).toFixed(2)} mm: say the size you want (for example "40"), or turn the dial.`);
        }
        this.selected = this.selected.includes(id) ? this.selected.filter((x) => x !== id) : [...this.selected.slice(-1), id];
        this.version++;
        return (this.status = `${this.selected.length} selected. Say or press a relation: horizontal, vertical, parallel, perpendicular, equal, tangent.`);
      }
      if (t === 'fillet') {
        this.remember();
        filletCorner(this.sk, u, v, this.filletR);
        return this.settle(`Fillet R${this.filletR}.`);
      }
      if (t === 'extend') {
        this.remember();
        return this.settle(extendAt(this.sk, u, v));
      }
      if (t === 'trim') {
        this.remember();
        const what = trimAt(this.sk, u, v);
        this.selected = [];
        return this.settle(what);
      }
      if (t === 'mirror') {
        const axis = pickEntity(this.sk, u, v, 3);
        if (!axis) return (this.status = 'Pick the mirror line (a construction centre line is usual).');
        if (!this.selected.length) return (this.status = 'Select what to mirror first (Select tool), then pick the mirror line.');
        this.remember();
        const made = mirrorEntities(this.sk, this.selected, axis);
        this.selected = [];
        return this.settle(`Mirrored ${made.length} item${made.length === 1 ? '' : 's'}; they stay symmetric.`);
      }
      if (t === 'offset') {
        if (!this.pending.length) {
          const id = pickEntity(this.sk, u, v, 3);
          if (!id) return (this.status = 'Pick a line, arc, circle or outline to offset.');
          this.selected = [id];
          this.pending = [s];
          this.version++;
          return (this.status = `Offset ${this.offsetD} mm: ${STEPS.offset[1]}.`);
        }
        const id = this.selected[0];
        this.pending = [];
        this.remember();
        const made = offsetEntity(this.sk, id, this.offsetD, { x: u, y: v });
        this.selected = [];
        return this.settle(`Offset ${this.offsetD} mm: ${made.length} new item${made.length === 1 ? '' : 's'}.`);
      }
      if (t === 'spline') {
        const last = this.pending[this.pending.length - 1];
        const done = this.pending.length >= 2 && (Math.hypot(s.x - last.x, s.y - last.y) < 1e-6 || s.point);
        if (!done) {
          this.pending.push(s);
          this.version++;
          return (this.status = `Spline: ${this.pending.length} point${this.pending.length === 1 ? '' : 's'}. ${STEPS.spline[0]}.`);
        }
        const picks = Math.hypot(s.x - last.x, s.y - last.y) < 1e-6 ? this.pending : [...this.pending, s];
        this.pending = [];
        this.remember();
        addSpline(this.sk, picks);
        return this.settle(`Spline through ${picks.length} points.`);
      }
      this.pending.push(s);
      const need = STEPS[t].length;
      if (this.pending.length < need) {
        this.version++;
        return (this.status = `${TOOL_NAMES[t]}: ${STEPS[t][this.pending.length]}.`);
      }
      this.remember();
      const p = this.pending;
      let what = '';
      if (t === 'line') {
        const id = addLine(this.sk, p[0], p[1]);
        const line = this.sk.ents.find((e) => e.id === id) as { a: string; b: string };
        this.chainStart ??= line.a;
        this.lastLine = id;
        const len = measure(this.sk, id)!.value;
        // Closed when the end lands on a point that already had an edge (the chain's start, or any outline).
        const joined = this.sk.ents.some((e) => e.id !== id && e.kind !== 'circle' && e.kind !== 'ellipse' && (e.a === line.b || e.b === line.b));
        if (line.b === this.chainStart || joined) {
          this.pending = [];
          this.chainStart = null;
          what = `Line ${len.toFixed(1)} mm; the outline is closed.`;
        } else {
          // Chain on from the end.
          const end = this.sk.points.find((q) => q.id === line.b)!;
          this.pending = [{ x: end.x, y: end.y, point: end.id, kind: 'point' }];
          what = `Line ${len.toFixed(1)} mm. Pick the next point, or the first one to close.`;
        }
        return this.settle(what);
      }
      this.pending = [];
      if (t === 'rect') {
        addRectangle(this.sk, p[0], p[1]);
        what = `Rectangle ${Math.abs(p[1].x - p[0].x).toFixed(1)} x ${Math.abs(p[1].y - p[0].y).toFixed(1)} mm.`;
      } else if (t === 'circle') {
        const id = addCircle(this.sk, p[0], p[1]);
        what = `Circle, diameter ${(2 * measure(this.sk, id)!.value).toFixed(1)} mm.`;
      } else if (t === 'arc') {
        addArc3(this.sk, p[0], p[1], p[2]);
        what = 'Arc.';
      } else if (t === 'tangentArc') {
        if (!this.lastLine) return (this.status = 'Draw a line first: a tangent arc leaves the end of the last line.');
        const id = addTangentArc(this.sk, this.lastLine, p[0]);
        const arc = this.sk.ents.find((e) => e.id === id) as { a: string; b: string };
        // Carry on with lines from the arc's free end.
        const lineEnd = (this.sk.ents.find((e) => e.id === this.lastLine) as { b: string }).b;
        const endId = arc.a === lineEnd ? arc.b : arc.a;
        const end = this.sk.points.find((q) => q.id === endId)!;
        this.tool = 'line';
        this.pending = [{ x: end.x, y: end.y, point: end.id, kind: 'point' }];
        what = 'Tangent arc. Carry on with lines from its end.';
      } else if (t === 'slot') {
        const ax = p[1].x - p[0].x;
        const ay = p[1].y - p[0].y;
        const L = Math.hypot(ax, ay) || 1;
        const half = Math.abs(((p[2].x - p[0].x) * -ay + (p[2].y - p[0].y) * ax) / L);
        addSlot(this.sk, p[0], p[1], Math.max(0.5, 2 * half));
        what = `Slot ${L.toFixed(1)} mm between centres, ${(2 * half).toFixed(1)} mm wide.`;
      } else if (t === 'ellipse') {
        addEllipse(this.sk, p[0], p[1], p[2]);
        what = 'Ellipse.';
      } else if (t === 'polygon') {
        addPolygon(this.sk, p[0], p[1], this.polygonSides);
        what = `${this.polygonSides}-sided polygon.`;
      }
      return this.settle(what);
    } catch (e) {
      this.pending = [];
      this.version++;
      return (this.status = e instanceof Error ? e.message : String(e));
    }
  }

  /** A relation on the selection. */
  constrain(kind: 'horizontal' | 'vertical' | 'parallel' | 'perpendicular' | 'equal' | 'tangent'): string {
    const sel = this.selected;
    if (kind === 'horizontal' || kind === 'vertical') {
      const lines = sel.filter((id) => this.sk.ents.find((e) => e.id === id)?.kind === 'line');
      if (!lines.length) return (this.status = `Select a line first, then make it ${kind}.`);
      this.remember();
      for (const e of lines) addConstraint(this.sk, { kind, e });
      return this.settle(`Made ${lines.length === 1 ? 'it' : 'them'} ${kind}.`);
    }
    if (sel.length !== 2) return (this.status = `Select two entities for ${kind} (Select tool, then pick both).`);
    this.remember();
    addConstraint(this.sk, { kind, e1: sel[0], e2: sel[1] });
    return this.settle(`Made them ${kind}.`);
  }

  /** The selected entity's size: a line's length, or a circle's or arc's diameter (or radius when asked). */
  setSize(value: number, asRadius = false): string {
    const id = this.selected[this.selected.length - 1] ?? this.lastLine;
    if (!id) return (this.status = 'Pick a line, arc or circle with Smart dimension first.');
    const m = measure(this.sk, id);
    if (!m) return (this.status = 'That is gone; pick another.');
    this.remember();
    dimension(this.sk, id, m.kind === 'radius' && !asRadius ? value / 2 : value);
    return this.settle(`${m.kind === 'length' ? 'Length' : asRadius ? 'Radius' : 'Diameter'} ${value} mm.`);
  }

  toggleConstruction(): string {
    const id = this.selected[this.selected.length - 1];
    if (!id) return (this.status = 'Select a line, arc or circle to make it construction geometry.');
    const e = this.sk.ents.find((x) => x.id === id);
    if (!e) return this.status;
    this.remember();
    e.construction = !e.construction;
    this.version++;
    return (this.status = e.construction ? 'Construction geometry: it guides, it is not part of the profile.' : 'Back to solid geometry.');
  }

  /**
   * The finished sketch as features: Extrude (boss), Cut (pocket) or Revolve. A revolve turns about a vertical
   * construction line when the sketch has one (else about the vertical through the sketch's origin).
   */
  finish(params: Params, op: 'extrude' | 'cut' | 'revolve', size: number): { params: Params; reply: string } {
    let regions = profiles(this.sk);
    let origin = this.origin;
    let about = '';
    let rot = this.rot;
    if (op === 'revolve') {
      // About a construction line at any angle: the sketch axes are turned so that line is the vertical through
      // the new origin (revolve turns about the sketch's vertical).
      const axis = this.sk.ents.find((e) => e.kind === 'line' && e.construction);
      if (axis && axis.kind === 'line') {
        const A = this.sk.points.find((q) => q.id === axis.a)!;
        const Bp = this.sk.points.find((q) => q.id === axis.b)!;
        const phi = Math.atan2(Bp.y - A.y, Bp.x - A.x);
        const d = phi - Math.PI / 2;
        const c = Math.cos(d);
        const s = Math.sin(d);
        // New coordinates: turned by d about the old origin, then shifted so the line is u = 0.
        const turn = (x: number, y: number): [number, number] => [x * c + y * s, -x * s + y * c];
        const shift = turn(A.x, A.y)[0];
        const f = this.frame();
        const xNew = [f.x[0] * c + f.y[0] * s, f.x[1] * c + f.y[1] * s, f.x[2] * c + f.y[2] * s];
        origin = [origin[0] + xNew[0] * shift, origin[1] + xNew[1] * shift, origin[2] + xNew[2] * shift];
        regions = regions.map((r) => ({ ...r, loops: r.loops.map((l) => ({ ...l, pts: l.pts.map(([x, y]) => {
          const [u, v] = turn(x, y);
          return [u - shift, v] as [number, number];
        }) })) }));
        rot = this.rot + (d * 180) / Math.PI;
        about = ' about the construction line';
      }
    }
    const out = sketchFeatures(params, regions, origin, this.code, op, size, { rot, tilt: this.tilt });
    const area = regions.reduce((s, r) => s + r.area, 0);
    const n = regions.length;
    const what = op === 'revolve' ? `Revolved ${size} degrees${about}` : op === 'cut' ? `Cut ${size} mm deep` : `Extruded ${size} mm`;
    return { params: out, reply: `${what}: ${n} region${n === 1 ? '' : 's'}, ${area.toFixed(1)} mm2 of profile.` };
  }

  /** The sketch plane's axes: the face's, turned and tilted. */
  frame(): { n: [number, number, number]; x: [number, number, number]; y: [number, number, number] } {
    return turnedFrame(this.code, this.rot, this.tilt);
  }

  /** Tilt the sketch plane about its horizontal (u) axis through the origin: an angled reference plane. */
  tiltPlane(deg: number): string {
    this.tilt += deg;
    this.version++;
    return (this.status = `Sketch plane tilted to ${this.tilt} degrees from the face.`);
  }

  /** Turn the sketch plane's axes in the plane (so sketch "horizontal" runs at that angle). */
  turnPlane(deg: number): string {
    this.rot += deg;
    this.version++;
    return (this.status = `Sketch axes turned to ${this.rot} degrees.`);
  }

  /** A pattern of the selection: in a row (`dx`, `dy` apart) or round the sketch origin. */
  pattern(count: number, dx: number, dy: number, round: boolean): string {
    if (!this.selected.length) return (this.status = 'Select what to pattern first (Select tool).');
    this.remember();
    const made = round ? circularPattern(this.sk, this.selected, count, 0, 0) : linearPattern(this.sk, this.selected, count, dx, dy);
    this.selected = [];
    return this.settle(`${count} in a ${round ? 'circle round the origin' : 'row'}: ${made.length} copies.`);
  }

  /** A sheet-metal base flange from this sketch's outline (on a top face): thickness t, bends of inside radius R. */
  finishSheet(params: Params, t: number, R: number): { params: Params; reply: string } {
    if (this.code !== 0 || this.rot || this.tilt) throw new Error('sketch a sheet-metal base on a top face (flat, not tilted)');
    const [r] = profiles(this.sk);
    const loop = r.loops[0];
    // The sketch's (u, v) are the top plane's, shifted by the sketch origin.
    const o = this.origin;
    const out = addOutline(params, loop.pts.map(([u, v]) => [u + o[0], v - o[2]] as [number, number]), loop.sweeps);
    const q = addFeature(out.params, OPS.SHEET, { a: out.index, b: t, c: R, f: o[1], g: 0.44 });
    return { params: q, reply: `Sheet-metal base: ${t} mm thick, bends R${R}. Point at an edge and say "flange 25".` };
  }

  /** Move the sketch plane along its normal (an offset reference plane), with what is drawn on it. */
  offsetPlane(d: number): string {
    const f = this.frame();
    this.origin = [this.origin[0] + f.n[0] * d, this.origin[1] + f.n[1] * d, this.origin[2] + f.n[2] * d];
    this.version++;
    return (this.status = `Sketch plane moved ${d > 0 ? 'out' : 'in'} ${Math.abs(d)} mm (an offset plane).`);
  }

  /** Start a loft: this sketch's profile is the first; a new sketch opens `distance` mm out for the second. */
  startLoft(distance: number): string {
    const [r] = profiles(this.sk);
    const f = this.frame();
    this.loftFrom = { pts: r.loops[0].pts, sweeps: r.loops[0].sweeps, distance, origin: [...this.origin] as [number, number, number] };
    this.remember();
    this.sk = newSketch();
    this.origin = [this.origin[0] + f.n[0] * distance, this.origin[1] + f.n[1] * distance, this.origin[2] + f.n[2] * distance];
    this.selected = [];
    this.pending = [];
    this.version++;
    return (this.status = `Loft: first profile kept. Now sketch the second profile here, ${distance} mm out, then say "finish loft".`);
  }

  /** Finish a loft from the first profile to this sketch's. */
  finishLoft(params: Params): { params: Params; reply: string } {
    const from = this.loftFrom;
    if (!from) throw new Error('start a loft first: sketch the first profile and say "loft 20"');
    const [r] = profiles(this.sk);
    const a = addOutline(params, from.pts, from.sweeps);
    const b = addOutline(a.params, r.loops[0].pts, r.loops[0].sweeps);
    const o = from.origin;
    const out = addFeature(b.params, OPS.LOFT, { a: a.index, b: b.index, c: from.distance, d: o[0], e: o[1], f: o[2], g: this.code });
    return { params: out, reply: `Lofted ${from.distance} mm from the first profile to the second.` };
  }

  /**
   * Sweep a round (or rectangular) profile along the sketch's open chain of lines: a rail, a handle, a pipe
   * lying on the face, its corners bent round.
   */
  finishSweep(params: Params, dia: number, bend?: number, rect?: [number, number]): { params: Params; reply: string } {
    const chains = openChains(this.sk);
    if (!chains.length) throw new Error('draw the path as an open chain of lines (its ends free), then sweep');
    const len = (c: [number, number][]): number => c.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - c[i - 1][0], q[1] - c[i - 1][1]) : 0), 0);
    const path2 = chains.sort((x, y) => len(y) - len(x))[0];
    const f = this.frame();
    // Sunk a fifth of its thickness into the face, so it fuses (a rod only touching the face would not).
    const lift = 0.8 * (rect ? rect[1] / 2 : dia / 2);
    const o = this.origin;
    const path: [number, number, number][] = path2.map(([u, v]) => [
      o[0] + f.x[0] * u + f.y[0] * v + f.n[0] * lift,
      o[1] + f.x[1] * u + f.y[1] * v + f.n[1] * lift,
      o[2] + f.x[2] * u + f.y[2] * v + f.n[2] * lift,
    ]);
    const prof: [number, number][] = rect
      ? [[-rect[0] / 2, -rect[1] / 2], [rect[0] / 2, -rect[1] / 2], [rect[0] / 2, rect[1] / 2], [-rect[0] / 2, rect[1] / 2]]
      : Array.from({ length: 48 }, (_, k) => [(dia / 2) * Math.cos((2 * Math.PI * k) / 48), (dia / 2) * Math.sin((2 * Math.PI * k) / 48)] as [number, number]);
    const op = addOutline(params, prof);
    const pa = addPath(op.params, path);
    const r = bend ?? +(2 * Math.max(dia, rect ? Math.max(...rect) : 0)).toFixed(2);
    const out = addFeature(pa.params, OPS.SWEEP, { a: op.index, b: pa.index, c: r });
    return { params: out, reply: `Swept ${rect ? `a ${rect[0]} by ${rect[1]} mm bar` : `a ${dia} mm rod`} along the ${path2.length - 1}-line path${path2.length > 2 ? `, bends R${r}` : ''}.` };
  }

  /** Words while sketching: tools, relations, sizes, undo. Null when not a sketch command. */
  command(t: string): string | null {
    const T = t.toLowerCase();
    const fr = T.match(/\b(?:sketch )?fillet\s*(?:radius\s*)?(\d+(?:\.\d+)?)/u);
    if (fr) {
      this.filletR = parseFloat(fr[1]);
      return this.setTool('fillet');
    }
    const od = T.match(/\boffset\s*(\d+(?:\.\d+)?)/u);
    if (od && !/\bplane\b/u.test(T)) {
      this.offsetD = parseFloat(od[1]);
      return this.setTool('offset');
    }
    const pat = T.match(/\b(circular |polar |round )?pattern\s*(\d+)(?:\D+?(-?\d+(?:\.\d+)?))?(?:\D+?(-?\d+(?:\.\d+)?))?/u);
    if (pat) {
      const n = parseInt(pat[2], 10);
      const round = !!pat[1] || /\baround|round the\b/u.test(T);
      const d1 = pat[3] ? parseFloat(pat[3]) : 15;
      const up = /\b(up|vertical|down)\b/u.test(T);
      return this.pattern(n, up ? 0 : d1, up ? (/\bdown\b/u.test(T) ? -d1 : d1) : pat[4] ? parseFloat(pat[4]) : 0, round);
    }
    const tools: [RegExp, SketchTool][] = [
      [/\bellipse\b|\boval\b/u, 'ellipse'],
      [/\bextend\b/u, 'extend'],
      [/\bspline\b|\bcurve\b/u, 'spline'],
      [/\b(sketch )?fillet\b/u, 'fillet'],
      [/\btrim\b/u, 'trim'],
      [/\boffset\b/u, 'offset'],
      [/\bmirror\b/u, 'mirror'],
      [/\btangent arc\b/u, 'tangentArc'],
      [/\b(three point arc|3 point arc|arc tool|^arc$|draw an arc)\b/u, 'arc'],
      [/\b(rectangle|rect)\b/u, 'rect'],
      [/\bcircle\b/u, 'circle'],
      [/\bslot\b/u, 'slot'],
      [/\b(polygon|hexagon)\b/u, 'polygon'],
      [/\b(smart dimension|dimension)\b/u, 'dimension'],
      [/\b(select)\b/u, 'select'],
      [/\b(delete|erase)\b/u, 'delete'],
      [/\b(line|lines)\b/u, 'line'],
    ];
    if (/\bundo\b/u.test(T)) return this.undo();
    if (/\bconstruction\b/u.test(T)) return this.toggleConstruction();
    for (const k of ['horizontal', 'vertical', 'parallel', 'perpendicular', 'equal', 'tangent'] as const) {
      if (new RegExp(`\\b(make (it|them) )?${k}\\b`, 'u').test(T) && !/\btangent arc\b/u.test(T)) return this.constrain(k);
    }
    const sides = T.match(/\bpolygon\s*(\d+)|(\d+)\s*sides?\b/u);
    if (sides) this.polygonSides = parseInt(sides[1] ?? sides[2], 10);
    for (const [re, tool] of tools) if (re.test(T)) return this.setTool(tool);
    const size = T.match(/^\s*(?:set (?:it )?to |make it |size |length |diameter |radius )?(\d+(?:\.\d+)?)\s*(?:mm)?\s*$/u) ?? T.match(/\b(diameter|radius|length)\s*(\d+(?:\.\d+)?)/u);
    if (size) {
      const v = parseFloat(size[2] ?? size[1]);
      return this.setSize(v, /\bradius\b/u.test(T));
    }
    return null;
  }
}
