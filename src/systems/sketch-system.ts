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
  Line,
  LineBasicMaterial,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { SKETCH_MAX_POINTS, Params } from '../engine/jobs.js';
import { cleanStroke } from '../engine/sketcher.js';
import { Vec2 } from '../engine/types.js';
import { ctx, probe } from '../app/context.js';
import { HandState } from '../app/hands.js';
import { COLORS } from '../app/palette.js';

const MAX_POINTS = 2000;
/** Minimum travel between stroke samples, m. */
const STEP = 0.0015;

export class SketchSystem extends createSystem({}) {
  private line!: Line<BufferGeometry, LineBasicMaterial>;
  private readonly buf = new Float32Array(MAX_POINTS * 3);
  private count = 0;
  private drawing: HandState | null = null;
  private readonly local = new Vector3();
  private readonly last = new Vector3();

  init(): void {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.buf, 3));
    g.setDrawRange(0, 0);
    this.line = new Line(g, new LineBasicMaterial({ color: COLORS.amber, toneMapped: false, depthTest: false }));
    this.line.name = 'Air sketch stroke';
    this.line.renderOrder = 25;
    this.line.frustumCulled = false;
    ctx.bench.turntable.add(this.line);
    this.world.createTransformEntity(this.line, { parent: ctx.turntableEntity, persistent: true });
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
    return out.y > -0.01 && out.y < 0.07 && Math.hypot(out.x, out.z) < 0.14;
  }

  private finish(): void {
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
    if (app.mode.peek() !== 'sketch' || this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
      if (this.count) this.reset();
      return;
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
    this.overBench(hand, this.local);
    // Draw on the bench surface: the stroke lies flat whatever the hand height.
    this.local.y = 0.0015;
    if (this.count === 0 || this.local.distanceTo(this.last) >= STEP) {
      if (this.count < MAX_POINTS) {
        this.buf[this.count * 3] = this.local.x;
        this.buf[this.count * 3 + 1] = this.local.y;
        this.buf[this.count * 3 + 2] = this.local.z;
        this.count++;
        this.last.copy(this.local);
        (this.line.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
        this.line.geometry.setDrawRange(0, this.count);
      }
    }
  }
}
