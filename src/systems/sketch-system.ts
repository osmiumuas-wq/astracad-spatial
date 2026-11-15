/**
 * Air sketch: in Sketch mode, pinch just above the bench and draw. Releasing
 * the pinch ends the stroke; the sketcher (src/engine/sketcher.ts) cleans it
 * into a circle or a square-cornered outline on a 0.5 mm grid, and the outline
 * becomes a new part on the bench, ready to be pulled up by its height handle.
 * The part goes through the same truth gate as every other part.
 */

import {
  BufferAttribute,
  BufferGeometry,
  createSystem,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { SKETCH_MAX_POINTS, Params } from '../engine/jobs.js';
import { cleanStroke } from '../engine/sketcher.js';
import { Vec2 } from '../engine/types.js';
import { ctx, probe } from '../app/context.js';
import { HandState } from '../app/hands.js';
import { COLORS } from '../app/palette.js';
import { addFaceSketch, FACE_FRAMES } from '../engine/design.js';

const MAX_POINTS = 2000;
/** Minimum travel between stroke samples, m. */
const STEP = 0.0015;
/** Half the drawn stroke's width, m. A WebGL line is one pixel wide on every headset, too thin to follow. */
const HALF_WIDTH = 0.002;

export class SketchSystem extends createSystem({}) {
  private line!: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly buf = new Float32Array(MAX_POINTS * 3);
  /** The stroke as a flat ribbon on the bench: two vertices per sample, either side of the path. */
  private readonly ribbon = new Float32Array(MAX_POINTS * 2 * 3);
  private count = 0;
  private drawing: HandState | null = null;
  private readonly local = new Vector3();
  private readonly last = new Vector3();
  /** Free design: the face being sketched on (part mm), or null for the bench top. */
  private face: { o: Vector3; x: Vector3; y: Vector3; n: Vector3; code: number } | null = null;
  /** The stroke's plane normal (turntable space): the ribbon lies in this plane. */
  private readonly planeN = new Vector3(0, 1, 0);
  /** Face sketches: the stroke in the face's own coordinates, mm. */
  private readonly uv = new Float32Array(MAX_POINTS * 2);
  private readonly lastUv: [number, number] = [0, 0];
  private readonly tmp = new Vector3();
  private readonly travel = new Vector3();
  private readonly across = new Vector3();

  init(): void {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.ribbon, 3));
    const index = new Uint16Array((MAX_POINTS - 1) * 6);
    for (let i = 0; i < MAX_POINTS - 1; i++) {
      const a = i * 2;
      index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    g.setIndex(new BufferAttribute(index, 1));
    g.setDrawRange(0, 0);
    this.line = new Mesh(
      g,
      // Transparent so it sorts with (and after) the translucent turntable instead of being drawn under it.
      new MeshBasicMaterial({ color: COLORS.amber, toneMapped: false, depthTest: false, side: DoubleSide, transparent: true }),
    );
    this.line.name = 'Air sketch stroke';
    this.line.renderOrder = 25;
    this.line.frustumCulled = false;
    ctx.bench.turntable.add(this.line);
    this.world.createTransformEntity(this.line, { parent: ctx.turntableEntity, persistent: true });
  }

  /** Set sample i's two ribbon vertices, offset across the direction of travel (in the bench plane). */
  private widen(i: number): void {
    const b = this.buf;
    const p = Math.max(0, i - 1);
    // Across the direction of travel, within the sketch plane.
    this.travel.set(b[i * 3] - b[p * 3], b[i * 3 + 1] - b[p * 3 + 1], b[i * 3 + 2] - b[p * 3 + 2]);
    if (this.travel.lengthSq() < 1e-18) this.travel.set(1, 0, 0);
    this.across.crossVectors(this.planeN, this.travel).normalize().multiplyScalar(HALF_WIDTH);
    const [nx, ny, nz] = [this.across.x, this.across.y, this.across.z];
    const r = this.ribbon;
    const k = i * 6;
    r[k] = b[i * 3] + nx;
    r[k + 1] = b[i * 3 + 1] + ny;
    r[k + 2] = b[i * 3 + 2] + nz;
    r[k + 3] = b[i * 3] - nx;
    r[k + 4] = b[i * 3 + 1] - ny;
    r[k + 5] = b[i * 3 + 2] - nz;
    // The first sample takes its direction from the second.
    if (i === 1) {
      r[0] = b[0] + nx;
      r[1] = b[1] + ny;
      r[2] = b[2] + nz;
      r[3] = b[0] - nx;
      r[4] = b[1] - ny;
      r[5] = b[2] - nz;
    }
  }

  private reset(): void {
    this.drawing = null;
    this.count = 0;
    this.line.geometry.setDrawRange(0, 0);
  }

  /** Pinch point in turntable space, if it is over the bench and close to its surface. */
  private overBench(hand: HandState, out: Vector3): boolean {
    out.copy(hand.pinchPoint);
    ctx.bench.turntable.worldToLocal(out);
    const f = this.face;
    if (f) {
      // Onto the face's plane (part millimetres), if the pinch is within 6 cm of it.
      const part = ctx.bench.part;
      part.toPart(out, this.tmp).sub(f.o);
      const d = this.tmp.dot(f.n);
      if (Math.abs(d) > 60) return false;
      this.lastUv[0] = this.tmp.dot(f.x);
      this.lastUv[1] = this.tmp.dot(f.y);
      this.tmp.copy(f.o).addScaledVector(f.x, this.lastUv[0]).addScaledVector(f.y, this.lastUv[1]).addScaledVector(f.n, 0.4);
      out.copy(this.tmp).multiplyScalar(part.scale).add(part.pivot.position);
      return true;
    }
    return out.y > -0.01 && out.y < 0.07 && Math.hypot(out.x, out.z) < 0.14;
  }

  /** A face sketch is finished: its outline becomes a boss on that face. */
  private finishFace(): void {
    const { app, sfx } = ctx;
    const f = this.face!;
    const stroke: Vec2[] = [];
    const trim = this.count > 30 ? 5 : 0;
    for (let i = trim; i < this.count - trim; i++) stroke.push([this.uv[i * 2], this.uv[i * 2 + 1]]);
    const res = cleanStroke(stroke);
    probe.sketch = res.outline ? `face ${res.outline.kind}` : res.reason;
    if (!res.outline) {
      sfx.play('refused');
      app.say(res.reason ?? 'That stroke could not be used.', 'warn');
      this.reset();
      return;
    }
    const o = res.outline;
    const pts: [number, number][] =
      o.kind === 'circle'
        ? Array.from({ length: 40 }, (_, k) => [o.cx + o.r * Math.cos((2 * Math.PI * k) / 40), o.cy + o.r * Math.sin((2 * Math.PI * k) / 40)] as [number, number])
        : o.points.map((q) => [q[0], q[1]] as [number, number]);
    sfx.play('bind');
    app.replaceParams(addFaceSketch(app.params.peek(), pts, [f.o.x, f.o.y, f.o.z], f.code));
    app.sketchFace = null;
    app.mode.value = 'shape';
    app.say('Sketch pulled 10 mm out of the face. Say "extrude 20", "cut 5" or "revolve it", or pull its handle.', 'good');
    this.reset();
  }

  private finish(): void {
    if (this.face) {
      this.finishFace();
      return;
    }
    const { app, sfx, bench } = ctx;
    const s = bench.part.scale;
    const stroke: Vec2[] = [];
    // The fingers are still closing at the start of a pinch and opening at its
    // end, which drags the pinch point; leave out those first and last samples.
    const trim = this.count > 30 ? 5 : 0;
    for (let i = trim; i < this.count - trim; i++) {
      // Top plane: u = X, v = -Z, in millimetres.
      stroke.push([this.buf[i * 3] / s, -this.buf[i * 3 + 2] / s]);
    }
    const res = cleanStroke(stroke);
    probe.sketch = res.outline ? res.outline.kind : res.reason;
    if (!res.outline) {
      sfx.play('refused');
      app.say(res.reason ?? 'That stroke could not be used.', 'warn');
      this.reset();
      return;
    }
    const params: Params = { h: 10 };
    if (res.outline.kind === 'circle') {
      Object.assign(params, { kind: 1, cx: 0, cy: 0, r: res.outline.r });
    } else {
      const pts = res.outline.points;
      if (pts.length > SKETCH_MAX_POINTS) {
        sfx.play('refused');
        app.say(`That outline has ${pts.length} corners; the most is ${SKETCH_MAX_POINTS}.`, 'warn');
        this.reset();
        return;
      }
      const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length;
      const cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
      params.kind = 0;
      params.n = pts.length;
      pts.forEach(([x, y], i) => {
        params[`x${i}`] = Math.round((x - cx) * 2) / 2;
        params[`y${i}`] = Math.round((y - cy) * 2) / 2;
      });
    }
    sfx.play('bind');
    app.loadSketch(params, res.notes);
    this.reset();
  }

  update(): void {
    const { app, hands } = ctx;
    // The sketch workbench takes pinches on the face itself (src/systems/sketch-bench-system.ts).
    if (app.mode.peek() !== 'sketch' || app.sketchBench || this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
      if (this.count) this.reset();
      return;
    }
    // Free design: sketch on the face picked with "sketch here".
    const sf = app.jobId.peek() === 'design' ? app.sketchFace : null;
    if (sf && (!this.face || this.face.code !== sf.code || this.face.o.x !== sf.origin[0] || this.face.o.y !== sf.origin[1] || this.face.o.z !== sf.origin[2])) {
      const fr = FACE_FRAMES[sf.code];
      this.face = { o: new Vector3(...sf.origin), x: new Vector3(...fr.x), y: new Vector3(...fr.y), n: new Vector3(...fr.n), code: sf.code };
      this.planeN.set(...fr.n);
    } else if (!sf && this.face) {
      this.face = null;
      this.planeN.set(0, 1, 0);
    }
    if (!this.drawing) {
      for (const hand of [hands.right, hands.left]) {
        if (hand.tracked && hand.pinchStarted && this.overBench(hand, this.local)) {
          this.drawing = hand;
          this.count = 0;
          ctx.sfx.play('grab');
          break;
        }
      }
      if (!this.drawing) return;
    }
    const hand = this.drawing;
    if (!hand.tracked || hand.pinchEnded || !hand.pinching) {
      this.finish();
      return;
    }
    if (!this.overBench(hand, this.local) && this.face) return;
    // Draw on the bench surface (or the picked face): the stroke lies flat whatever the hand height.
    if (!this.face) this.local.y = 0.0015;
    if (this.count === 0 || this.local.distanceTo(this.last) >= STEP) {
      if (this.count < MAX_POINTS) {
        this.buf[this.count * 3] = this.local.x;
        this.buf[this.count * 3 + 1] = this.local.y;
        this.buf[this.count * 3 + 2] = this.local.z;
        this.uv[this.count * 2] = this.lastUv[0];
        this.uv[this.count * 2 + 1] = this.lastUv[1];
        this.count++;
        this.last.copy(this.local);
        this.widen(this.count - 1);
        (this.line.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
        this.line.geometry.setDrawRange(0, Math.max(0, this.count - 1) * 6);
      }
    }
  }
}
