/**
 * The sketch workbench in the headset: while a sketch is open (app.sketchBench),
 * a toolbar replaces the design strip (sketch tools, relations, sizes, and
 * Extrude / Cut / Revolve), the sketch is drawn on its face (solid geometry
 * cyan, construction grey, selection amber, the pending rubber band white,
 * snaps marked), sizes are labelled, and a pinch on the face is a click for the
 * current tool. Everything also answers to voice (src/app/sketch-bench.ts).
 */

import { BufferAttribute, BufferGeometry, createSystem, DoubleSide, Group, Mesh, MeshBasicMaterial, Vector3, VisibilityState } from '@iwsdk/core';
import { ctx, probe } from '../app/context.js';
import { TextLabel, faceViewer } from '../app/labels.js';
import { CSS } from '../app/palette.js';
import { SketchTool, TOOL_NAMES } from '../app/sketch-bench.js';
import { makeButton, setButton } from '../app/ui3d.js';
import { FACE_FRAMES } from '../engine/design.js';
import { measure } from '../engine/sketch2d.js';

const MAX_QUADS = 6000;

type Btn = [key: string, label: string, run: () => void];

export class SketchBenchSystem extends createSystem({}) {
  private readonly strip = new Group();
  private mesh!: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly pos = new Float32Array(MAX_QUADS * 4 * 3);
  private readonly col = new Float32Array(MAX_QUADS * 4 * 3);
  private quads = 0;
  private drawn = -1;
  private keys: string[] = [];
  private status!: TextLabel;
  private labels: TextLabel[] = [];
  /** Each label in a group that undoes the part's millimetre scale (the label sizes itself in metres). */
  private holders: Group[] = [];
  private readonly viewer = new Vector3();
  private readonly local = new Vector3();
  private readonly mm = new Vector3();
  private hoverUv: [number, number] | null = null;
  private lastHoverKey = '';
  private open = false;

  init(): void {
    const { app, bench } = ctx;
    // The workbench's toolbar sits right of the bench, where the feature tree is (hidden while sketching).
    this.strip.position.set(0.235, 0.06, 0.06);
    this.strip.rotation.set(-0.7, -0.55, 0, 'YXZ');
    bench.root.add(this.strip);
    const e = this.world.createTransformEntity(this.strip, { parent: ctx.benchEntity, persistent: true });
    const tool = (t: SketchTool): (() => void) => () => this.say(app.sketchBench?.setTool(t));
    const run = (f: () => string | undefined): (() => void) => () => this.say(f());
    const b = (): NonNullable<typeof app.sketchBench> => app.sketchBench!;
    const buttons: Btn[] = [
      ['sk:line', 'Line', tool('line')],
      ['sk:rect', 'Rectangle', tool('rect')],
      ['sk:circle', 'Circle', tool('circle')],
      ['sk:arc', '3-pt arc', tool('arc')],
      ['sk:tarc', 'Tangent arc', tool('tangentArc')],
      ['sk:slot', 'Slot', tool('slot')],
      ['sk:poly', 'Polygon', tool('polygon')],
      ['sk:select', 'Select', tool('select')],
      ['sk:dim', 'Smart dim', tool('dimension')],
      ['sk:del', 'Delete', tool('delete')],
      ['sk:constr', 'Construction', run(() => b().toggleConstruction())],
      ['sk:undo', 'Undo', run(() => b().undo())],
      ['sk:h', 'Horizontal', run(() => b().constrain('horizontal'))],
      ['sk:v', 'Vertical', run(() => b().constrain('vertical'))],
      ['sk:par', 'Parallel', run(() => b().constrain('parallel'))],
      ['sk:perp', 'Perpendicular', run(() => b().constrain('perpendicular'))],
      ['sk:eq', 'Equal', run(() => b().constrain('equal'))],
      ['sk:tan', 'Tangent', run(() => b().constrain('tangent'))],
      ['sk:minus', 'Size -1', run(() => this.nudge(-1))],
      ['sk:plus', 'Size +1', run(() => this.nudge(1))],
      ['sk:extrude', 'Extrude 10', run(() => app.finishSketchBench('extrude', 10))],
      ['sk:cut', 'Cut 5', run(() => app.finishSketchBench('cut', 5))],
      ['sk:revolve', 'Revolve', run(() => app.finishSketchBench('revolve', 360))],
      ['sk:exit', 'Exit sketch', run(() => {
        app.closeSketchBench();
        return 'Sketch closed without a feature.';
      })],
    ];
    buttons.forEach(([key, label, fn], i) => {
      const tone = key === 'sk:extrude' || key === 'sk:cut' || key === 'sk:revolve' ? 'primary' : key === 'sk:exit' ? 'warn' : 'default';
      const m = makeButton(e, { key, label, width: 0.058, height: 0.02, tone }, () => {
        ctx.sfx.play('select');
        fn();
      });
      m.position.set((i % 3) * 0.062 - 0.062, 0.1 - Math.floor(i / 3) * 0.024, 0);
      setButton(key, { visible: false });
      this.keys.push(key);
    });
    this.status = new TextLabel(0.013);
    this.status.mesh.position.set(0, 0.128, 0);
    this.status.visible = false;
    this.strip.add(this.status.mesh);
    for (let i = 0; i < 24; i++) {
      const l = new TextLabel(0.0085);
      l.visible = false;
      const holder = new Group();
      holder.add(l.mesh);
      bench.part.pivot.add(holder);
      this.holders.push(holder);
      this.labels.push(l);
    }
    // The sketch itself: flat quads in the part's millimetres, on the face.
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('color', new BufferAttribute(this.col, 3));
    const index = new Uint32Array(MAX_QUADS * 6);
    for (let q = 0; q < MAX_QUADS; q++) index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2], q * 6);
    g.setIndex(new BufferAttribute(index, 1));
    g.setDrawRange(0, 0);
    this.mesh = new Mesh(g, new MeshBasicMaterial({ vertexColors: true, toneMapped: false, depthTest: false, side: DoubleSide, transparent: true }));
    this.mesh.name = 'Sketch workbench geometry';
    this.mesh.renderOrder = 26;
    this.mesh.frustumCulled = false;
    bench.part.pivot.add(this.mesh);
    this.cleanupFuncs.push(app.sketchBenchOpen.subscribe((on) => this.show(on)));
  }

  private say(text: string | undefined): void {
    if (!text) return;
    ctx.app.say(text, /over-defines|Nothing there|first|open at|meet at|no closed/u.test(text) ? 'warn' : 'info');
    this.drawn = -1;
  }

  /** Change the selected dimension by a step. */
  private nudge(step: number): string {
    const b = ctx.app.sketchBench;
    const id = b?.selected[b.selected.length - 1];
    if (!b || !id) return 'Pick a line, arc or circle with Smart dimension first.';
    const m = measure(b.sk, id);
    if (!m) return 'Pick another.';
    const now = m.kind === 'radius' ? 2 * m.value : m.value;
    return b.setSize(Math.max(0.5, Math.round((now + step) * 100) / 100));
  }

  private show(on: boolean): void {
    this.open = on;
    for (const k of this.keys) setButton(k, { visible: on });
    // The design strip hides itself while a sketch is open (src/systems/design-system.ts).
    this.status.visible = on;
    this.mesh.visible = on;
    if (!on) {
      this.mesh.geometry.setDrawRange(0, 0);
      for (const l of this.labels) l.visible = false;
    }
    this.drawn = -1;
  }

  /** (u, v) on the face to part millimetres, lifted a little off it. */
  private toMm(u: number, v: number, out: Vector3): Vector3 {
    const b = ctx.app.sketchBench!;
    const f = FACE_FRAMES[b.code];
    const lift = 0.25;
    return out.set(
      b.origin[0] + f.x[0] * u + f.y[0] * v + f.n[0] * lift,
      b.origin[1] + f.x[1] * u + f.y[1] * v + f.n[1] * lift,
      b.origin[2] + f.x[2] * u + f.y[2] * v + f.n[2] * lift,
    );
  }

  private readonly a3 = new Vector3();
  private readonly b3 = new Vector3();

  /** A segment from (u0, v0) to (u1, v1) as a flat quad of half width w (mm), in a colour. */
  private segment(u0: number, v0: number, u1: number, v1: number, w: number, c: [number, number, number]): void {
    if (this.quads >= MAX_QUADS) return;
    const du = u1 - u0;
    const dv = v1 - v0;
    const l = Math.hypot(du, dv) || 1;
    const nu = (-dv / l) * w;
    const nv = (du / l) * w;
    const q = this.quads++;
    const corners: [number, number][] = [[u0 + nu, v0 + nv], [u0 - nu, v0 - nv], [u1 + nu, v1 + nv], [u1 - nu, v1 - nv]];
    corners.forEach(([u, v], k) => {
      this.toMm(u, v, this.a3);
      this.pos.set([this.a3.x, this.a3.y, this.a3.z], (q * 4 + k) * 3);
      this.col.set(c, (q * 4 + k) * 3);
    });
  }

  private dot(u: number, v: number, r: number, c: [number, number, number]): void {
    this.segment(u - r, v, u + r, v, r, c);
  }

  private redraw(): void {
    const b = ctx.app.sketchBench!;
    const part = ctx.bench.part;
    // About 1.6 mm wide on screen at any zoom.
    const w = 0.0008 / part.scale;
    this.quads = 0;
    const P = (id: string): [number, number] => {
      const q = b.sk.points.find((x) => x.id === id)!;
      return [q.x, q.y];
    };
    const CYAN: [number, number, number] = [0.3, 0.85, 1];
    const GREY: [number, number, number] = [0.55, 0.6, 0.7];
    const AMBER: [number, number, number] = [1, 0.72, 0.2];
    const WHITE: [number, number, number] = [1, 1, 1];
    const GREEN: [number, number, number] = [0.4, 1, 0.55];
    const arc = (c: [number, number], a: [number, number], sweep: number, colr: [number, number, number]): void => {
      const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
      const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
      const n = Math.max(8, Math.ceil(Math.abs(sweep) / 0.12));
      for (let i = 0; i < n; i++) {
        const t0 = a0 + (sweep * i) / n;
        const t1 = a0 + (sweep * (i + 1)) / n;
        this.segment(c[0] + r * Math.cos(t0), c[1] + r * Math.sin(t0), c[0] + r * Math.cos(t1), c[1] + r * Math.sin(t1), w, colr);
      }
    };
    let li = 0;
    const label = (u: number, v: number, text: string): void => {
      const holder = this.holders[li];
      const l = this.labels[li++];
      if (!l) return;
      this.toMm(u, v, this.b3);
      holder.position.copy(this.b3);
      // Labels are sized in metres; the pivot scales millimetres, so the holder undoes it.
      holder.scale.setScalar(1 / part.scale);
      l.set(text, { bg: CSS.panel, border: CSS.cyan });
      l.visible = true;
    };
    const driven = new Set(b.sk.cons.filter((c) => c.kind === 'length' || c.kind === 'radius').map((c) => (c as { e: string }).e));
    for (const e of b.sk.ents) {
      const colr = b.selected.includes(e.id) ? AMBER : e.construction ? GREY : CYAN;
      if (e.kind === 'line') {
        const a = P(e.a);
        const c = P(e.b);
        this.segment(a[0], a[1], c[0], c[1], e.construction ? w * 0.5 : w, colr);
        const m = measure(b.sk, e.id)!;
        if (!e.construction) label((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, `${driven.has(e.id) ? '' : '~'}${m.value.toFixed(m.value < 10 ? 2 : 1)}`);
      } else if (e.kind === 'circle') {
        const c = P(e.c);
        arc(c, [c[0] + e.r, c[1]], 2 * Math.PI, colr);
        if (!e.construction) label(c[0], c[1] + e.r, `${driven.has(e.id) ? '' : '~'}⌀${(2 * e.r).toFixed(1)}`);
      } else {
        const c = P(e.c);
        const a = P(e.a);
        const z = P(e.b);
        let s = Math.atan2(z[1] - c[1], z[0] - c[0]) - Math.atan2(a[1] - c[1], a[0] - c[0]);
        while (s <= 0) s += 2 * Math.PI;
        arc(c, a, s, colr);
        const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
        const mid = Math.atan2(a[1] - c[1], a[0] - c[0]) + s / 2;
        label(c[0] + r * Math.cos(mid), c[1] + r * Math.sin(mid), `${driven.has(e.id) ? '' : '~'}R${r.toFixed(1)}`);
      }
    }
    for (const q of b.sk.points) this.dot(q.x, q.y, w * 1.6, q.id === 'o' ? GREEN : WHITE);
    // The rubber band from the last pick to where the hand is, and the snap it would take.
    const h = this.hoverUv;
    if (h) {
      const s = b.hover(h[0], h[1]);
      if (b.pending.length) {
        const p0 = b.pending[b.pending.length - 1];
        if (b.tool === 'circle') {
          arc([p0.x, p0.y], [s.x, s.y], 2 * Math.PI, WHITE);
        } else if (b.tool === 'rect') {
          const [x0, y0, x1, y1] = [p0.x, p0.y, s.x, s.y];
          this.segment(x0, y0, x1, y0, w * 0.6, WHITE);
          this.segment(x1, y0, x1, y1, w * 0.6, WHITE);
          this.segment(x1, y1, x0, y1, w * 0.6, WHITE);
          this.segment(x0, y1, x0, y0, w * 0.6, WHITE);
        } else this.segment(p0.x, p0.y, s.x, s.y, w * 0.6, WHITE);
      }
      this.dot(s.x, s.y, w * (s.kind === 'grid' ? 1.2 : 2.4), s.kind === 'grid' ? WHITE : GREEN);
    }
    for (let i = li; i < this.labels.length; i++) this.labels[i].visible = false;
    const g = this.mesh.geometry;
    (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, this.quads * 6);
    this.status.set(`${TOOL_NAMES[b.tool]}: ${b.status.replace(/^[^:]*: /u, '')}`.slice(0, 64), { bg: CSS.panel, border: b.dof === 0 ? CSS.green : CSS.cyan });
    probe.sketchBench = { tool: b.tool, ents: b.sk.ents.length, dof: b.dof, status: b.status };
  }

  /** A hand's pinch point on the face, as (u, v) mm, when it is within 6 cm of it. */
  private faceUv(p: Vector3): [number, number] | null {
    const b = ctx.app.sketchBench!;
    const f = FACE_FRAMES[b.code];
    this.local.copy(p);
    ctx.bench.turntable.worldToLocal(this.local);
    ctx.bench.part.toPart(this.local, this.mm);
    const d: [number, number, number] = [this.mm.x - b.origin[0], this.mm.y - b.origin[1], this.mm.z - b.origin[2]];
    const n = d[0] * f.n[0] + d[1] * f.n[1] + d[2] * f.n[2];
    if (Math.abs(n) > 60) return null;
    return [d[0] * f.x[0] + d[1] * f.x[1] + d[2] * f.x[2], d[0] * f.y[0] + d[1] * f.y[1] + d[2] * f.y[2]];
  }

  update(): void {
    const { app, hands } = ctx;
    const b = app.sketchBench;
    if (!b || !this.open) return;
    if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive) {
      // Hover with the hand nearest the face; a pinch there is a click.
      this.hoverUv = null;
      for (const hand of [hands.right, hands.left]) {
        if (!hand.tracked) continue;
        const uv = this.faceUv(hand.pinchPoint);
        if (!uv) continue;
        this.hoverUv = uv;
        if (hand.pinchStarted) {
          this.say(b.click(uv[0], uv[1]));
          ctx.sfx.play('bind');
        }
        break;
      }
    }
    const key = this.hoverUv ? `${this.hoverUv[0].toFixed(1)},${this.hoverUv[1].toFixed(1)}` : '';
    if (b.version !== this.drawn || key !== this.lastHoverKey) {
      this.drawn = b.version;
      this.lastHoverKey = key;
      this.redraw();
    }
    (this.world.visibilityState.peek() === VisibilityState.NonImmersive ? this.world.camera : this.player.head).getWorldPosition(this.viewer);
    faceViewer(this.status.mesh, this.viewer);
    for (const l of this.labels) if (l.visible) faceViewer(l.mesh, this.viewer);
  }
}
