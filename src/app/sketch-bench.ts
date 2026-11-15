/**
 * The sketch workbench's state and tools, without Three.js: what a click at
 * (u, v) on the face does with the current tool, the selection, constraints,
 * dimensions, and finishing the sketch as Extrude, Cut or Revolve. The VR
 * system (src/systems/sketch-bench-system.ts) draws it and turns pinches into
 * clicks; voice and the toolbar call the same methods.
 */

import type { GcsWrapper } from '@salusoft89/planegcs';
import { sketchFeatures } from '../engine/design.js';
import type { Params } from '../engine/jobs.js';
import {
  addArc3,
  addCircle,
  addConstraint,
  addLine,
  addPolygon,
  addRectangle,
  addSlot,
  addTangentArc,
  dimension,
  measure,
  newSketch,
  pickEntity,
  profiles,
  removeEntity,
  Sketch2D,
  Snap,
  snap,
  solve,
} from '../engine/sketch2d.js';

export type SketchTool = 'line' | 'rect' | 'circle' | 'arc' | 'tangentArc' | 'slot' | 'polygon' | 'select' | 'dimension' | 'delete';

export const TOOL_NAMES: Record<SketchTool, string> = {
  line: 'Line',
  rect: 'Rectangle',
  circle: 'Circle',
  arc: '3-point arc',
  tangentArc: 'Tangent arc',
  slot: 'Slot',
  polygon: 'Polygon',
  select: 'Select',
  dimension: 'Smart dimension',
  delete: 'Delete',
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
  select: ['Pick a line, arc or circle (up to two)'],
  dimension: ['Pick a line, arc or circle, then say its size or turn the dial'],
  delete: ['Pick what to delete'],
};

export class SketchBench {
  sk: Sketch2D = newSketch();
  tool: SketchTool = 'line';
  pending: Snap[] = [];
  selected: string[] = [];
  polygonSides = 6;
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
    readonly origin: [number, number, number],
    readonly code: number,
    private readonly gcs: GcsWrapper,
  ) {
    this.status = `${TOOL_NAMES[this.tool]}: ${STEPS[this.tool][0]}.`;
  }

  setTool(t: SketchTool): string {
    this.tool = t;
    this.pending = [];
    this.chainStart = null;
    if (t !== 'select' && t !== 'dimension') this.selected = [];
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
        const joined = this.sk.ents.some((e) => e.id !== id && e.kind !== 'circle' && (e.a === line.b || e.b === line.b));
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

  /** The finished sketch as features: Extrude (boss), Cut (pocket) or Revolve (about the sketch's vertical axis). */
  finish(params: Params, op: 'extrude' | 'cut' | 'revolve', size: number): { params: Params; reply: string } {
    const regions = profiles(this.sk);
    const out = sketchFeatures(params, regions, this.origin, this.code, op, size);
    const area = regions.reduce((s, r) => s + r.area, 0);
    const n = regions.length;
    const what = op === 'revolve' ? `Revolved ${size} degrees` : op === 'cut' ? `Cut ${size} mm deep` : `Extruded ${size} mm`;
    return { params: out, reply: `${what}: ${n} region${n === 1 ? '' : 's'}, ${area.toFixed(1)} mm2 of profile.` };
  }

  /** Words while sketching: tools, relations, sizes, undo. Null when not a sketch command. */
  command(t: string): string | null {
    const T = t.toLowerCase();
    const tools: [RegExp, SketchTool][] = [
      [/\btangent arc\b/u, 'tangentArc'],
      [/\b(three point arc|3 point arc|arc tool|^arc$|draw an arc)\b/u, 'arc'],
      [/\b(rectangle|rect)\b/u, 'rect'],
      [/\bcircle\b/u, 'circle'],
      [/\bslot\b/u, 'slot'],
      [/\b(polygon|hexagon)\b/u, 'polygon'],
      [/\b(smart dimension|dimension)\b/u, 'dimension'],
      [/\b(select)\b/u, 'select'],
      [/\b(delete|trim|erase)\b/u, 'delete'],
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
