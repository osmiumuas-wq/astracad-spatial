/**
 * Capture: pull a real object into CAD.
 *
 * In Capture mode the user traces round the base of a real object on the
 * table with a pinch, then pinches its top. The trace is cleaned by the same
 * rules as the air sketch (circle, or square-cornered outline on a 0.5 mm
 * grid) at real size, the top pinch gives the height, and a glowing solid of
 * that outline rises out of the real object and flies to the bench, where it
 * becomes an ordinary parametric part: every corner and the height can be
 * edited, it goes through the truth gate, and it can be tested and printed.
 *
 * It is a parametric model of the object's footprint and height (an
 * extrusion), not a 3D scan: overhangs, tapers and curved tops are not
 * captured. The caption says so. The Quest browser gives web pages no camera
 * image, so the shape comes from the hands; the size is as good as hand
 * tracking (a few millimetres).
 */

import {
  BufferAttribute,
  BufferGeometry,
  createSystem,
  EdgesGeometry,
  ExtrudeGeometry,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Shape,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { Params, SKETCH_MAX_POINTS } from '../engine/jobs.js';
import { cleanStroke, Outline } from '../engine/sketcher.js';
import { Vec2 } from '../engine/types.js';
import { ctx, probe } from '../app/context.js';
import { HandState } from '../app/hands.js';
import { COLORS } from '../app/palette.js';

const MAX_POINTS = 3000;
const STEP = 0.002;
const FLIGHT_S = 1.6;
const MIN_HEIGHT_MM = 3;
/** Seconds after a pinch starts before its point is trusted. */
const SETTLE_S = 0.12;

type Phase = 'trace' | 'drawing' | 'height' | 'flying';

/** Outline and height as sketch-job parameters, centred on the outline's centroid. */
export function captureParams(outline: Outline, heightMm: number): Params {
  const params: Params = { h: Math.round(heightMm * 2) / 2 };
  if (outline.kind === 'circle') {
    return Object.assign(params, { kind: 1, cx: 0, cy: 0, r: outline.r });
  }
  const pts = outline.points;
  const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length;
  const cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
  params.kind = 0;
  params.n = pts.length;
  pts.forEach(([x, y], i) => {
    params[`x${i}`] = Math.round((x - cx) * 2) / 2;
    params[`y${i}`] = Math.round((y - cy) * 2) / 2;
  });
  return params;
}

export class CaptureSystem extends createSystem({}) {
  private phase: Phase = 'trace';
  private line!: Line<BufferGeometry, LineBasicMaterial>;
  private holo!: Mesh<ExtrudeGeometry, MeshStandardMaterial>;
  private holoEdges!: LineSegments<EdgesGeometry, LineBasicMaterial>;
  private readonly buf = new Float32Array(MAX_POINTS * 3);
  private count = 0;
  private drawing: HandState | null = null;
  private outline: Outline | null = null;
  private notes: string[] = [];
  private baseY = 0;
  private readonly centre = new Vector3();
  private readonly local = new Vector3();
  private readonly last = new Vector3();
  private readonly from = new Vector3();
  private t = 0;
  private params: Params | null = null;
  private topHand: HandState | null = null;
  private topHeld = 0;

  init(): void {
    const { bench } = ctx;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.buf, 3));
    g.setDrawRange(0, 0);
    this.line = new Line(g, new LineBasicMaterial({ color: COLORS.cyan, toneMapped: false, depthTest: false }));
    this.line.name = 'Capture trace';
    this.line.renderOrder = 25;
    this.line.frustumCulled = false;
    bench.root.add(this.line);
    this.world.createTransformEntity(this.line, { parent: ctx.benchEntity, persistent: true });

    this.holo = new Mesh(
      new ExtrudeGeometry(new Shape(), { depth: 0.01, bevelEnabled: false }),
      new MeshStandardMaterial({ color: COLORS.cyan, emissive: COLORS.cyan, emissiveIntensity: 1.2, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.holo.name = 'Captured object';
    this.holo.visible = false;
    this.holo.renderOrder = 6;
    this.holoEdges = new LineSegments(new EdgesGeometry(this.holo.geometry), new LineBasicMaterial({ color: COLORS.white, toneMapped: false }));
    this.holo.add(this.holoEdges);
    bench.root.add(this.holo);
    this.world.createTransformEntity(this.holo, { parent: ctx.benchEntity, persistent: true });

    this.cleanupFuncs.push(
      ctx.app.mode.subscribe((m) => {
        if (m === 'capture') this.restart();
        else if (this.phase !== 'flying') this.clearTrace();
      }),
    );
  }

  /** What the coach panel says in each phase. */
  get prompt(): string {
    switch (this.phase) {
      case 'trace':
      case 'drawing':
        return 'Pinch at the table and trace round the base of a real object. Let go to finish.';
      case 'height':
        return 'Now pinch the top of the object.';
      default:
        return 'Bringing it to the bench...';
    }
  }

  private restart(): void {
    this.clearTrace();
    this.phase = 'trace';
    this.outline = null;
    this.topHand = null;
    probe.capture = 'trace';
    ctx.app.coachTick.value++;
  }

  private clearTrace(): void {
    this.count = 0;
    this.drawing = null;
    this.line.geometry.setDrawRange(0, 0);
  }

  private toLocal(hand: HandState, out: Vector3): Vector3 {
    out.copy(hand.pinchPoint);
    return ctx.bench.root.worldToLocal(out);
  }

  /** The trace is done: clean it at real size (bench axes, millimetres). */
  private finishTrace(): void {
    const { app, sfx } = ctx;
    const stroke: Vec2[] = [];
    const trim = this.count > 30 ? 5 : 0;
    let ySum = 0;
    for (let i = trim; i < this.count - trim; i++) {
      stroke.push([this.buf[i * 3] * 1000, -this.buf[i * 3 + 2] * 1000]);
      ySum += this.buf[i * 3 + 1];
    }
    const res = cleanStroke(stroke);
    if (!res.outline || (res.outline.kind === 'polygon' && res.outline.points.length > SKETCH_MAX_POINTS)) {
      sfx.play('refused');
      app.say(res.reason ?? `That outline has too many corners; the most is ${SKETCH_MAX_POINTS}.`, 'warn');
      this.restart();
      return;
    }
    this.outline = res.outline;
    this.notes = res.notes;
    this.baseY = ySum / Math.max(1, stroke.length);
    // Centre of the footprint in bench space, for the hologram.
    let cx = 0;
    let cz = 0;
    if (res.outline.kind === 'circle') {
      cx = res.outline.cx / 1000;
      cz = -res.outline.cy / 1000;
    } else {
      const pts = res.outline.points;
      cx = pts.reduce((a, q) => a + q[0], 0) / pts.length / 1000;
      cz = -pts.reduce((a, q) => a + q[1], 0) / pts.length / 1000;
    }
    this.centre.set(cx, this.baseY, cz);
    this.phase = 'height';
    probe.capture = 'height';
    sfx.play('bind');
    app.say(res.outline.kind === 'circle' ? `Round base, ${(res.outline.r * 2).toFixed(1)} mm across. Now pinch its top.` : `${res.outline.points.length}-corner base traced. Now pinch its top.`, 'info');
    app.coachTick.value++;
  }

  private finishHeight(hand: HandState): void {
    const { app, sfx } = ctx;
    const top = this.toLocal(hand, this.local).y;
    const h = (top - this.baseY) * 1000;
    if (!this.outline || h < MIN_HEIGHT_MM) {
      sfx.play('refused');
      app.say('Pinch the top of the object, above where you traced.', 'warn');
      return;
    }
    this.params = captureParams(this.outline, Math.min(200, h));
    this.showHologram(this.outline, this.params.h);
    this.from.copy(this.centre);
    this.t = 0;
    this.phase = 'flying';
    probe.capture = { kind: this.outline.kind, h: this.params.h, n: this.params.n ?? 0, r: this.params.r ?? 0 };
    sfx.play('grow');
  }

  private showHologram(outline: Outline, hMm: number): void {
    const shape = new Shape();
    if (outline.kind === 'circle') {
      shape.absarc(0, 0, outline.r / 1000, 0, Math.PI * 2, false);
    } else {
      const pts = outline.points;
      const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length;
      const cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
      pts.forEach(([x, y], i) => {
        if (i === 0) shape.moveTo((x - cx) / 1000, (y - cy) / 1000);
        else shape.lineTo((x - cx) / 1000, (y - cy) / 1000);
      });
      shape.closePath();
    }
    const geo = new ExtrudeGeometry(shape, { depth: hMm / 1000, bevelEnabled: false, curveSegments: 48 });
    // Shape XY becomes the table plane (u, -z); the extrusion goes up.
    geo.rotateX(-Math.PI / 2);
    this.holo.geometry.dispose();
    this.holo.geometry = geo;
    this.holoEdges.geometry.dispose();
    this.holoEdges.geometry = new EdgesGeometry(geo, 20);
    this.holo.position.copy(this.centre);
    this.holo.scale.setScalar(1);
    this.holo.visible = true;
  }

  update(delta: number): void {
    const { app, hands, bench } = ctx;
    if (this.phase === 'flying') {
      this.t += delta / FLIGHT_S;
      const t = Math.min(1, this.t);
      const e = 1 - Math.pow(1 - t, 3);
      // Rise out of the real object, then glide onto the turntable, shrinking to the bench zoom.
      this.holo.position.copy(this.from).lerp(this.local.set(0, 0, 0), e);
      this.holo.position.y += Math.sin(Math.PI * t) * 0.12;
      this.holo.scale.setScalar(1 + (bench.part.scale / 0.001 - 1) * e);
      this.holo.material.emissiveIntensity = 1.2 + (1 - t) * 1.5;
      if (t >= 1) {
        this.holo.visible = false;
        this.clearTrace();
        this.phase = 'trace';
        if (this.params) app.loadCapture(this.params, this.notes);
        this.params = null;
      }
      return;
    }
    if (app.mode.peek() !== 'capture' || this.world.visibilityState.peek() === VisibilityState.NonImmersive) return;

    if (this.phase === 'height') {
      // The pinch point moves while the fingers close; read it once the pinch has settled
      // (or at release, for a very quick pinch).
      if (this.topHand) {
        const h = this.topHand;
        this.topHeld += delta;
        if (this.topHeld >= SETTLE_S || h.pinchEnded || !h.pinching) {
          this.topHand = null;
          this.finishHeight(h);
        }
        return;
      }
      for (const hand of [hands.right, hands.left]) {
        if (hand.tracked && hand.pinchStarted) {
          this.topHand = hand;
          this.topHeld = 0;
          return;
        }
      }
      return;
    }
    if (!this.drawing) {
      for (const hand of [hands.right, hands.left]) {
        if (hand.tracked && hand.pinchStarted) {
          this.drawing = hand;
          this.count = 0;
          this.phase = 'drawing';
          ctx.sfx.play('grab');
          break;
        }
      }
      if (!this.drawing) return;
    }
    const hand = this.drawing;
    if (!hand.tracked || hand.pinchEnded || !hand.pinching) {
      this.drawing = null;
      this.finishTrace();
      return;
    }
    this.toLocal(hand, this.local);
    if (this.count === 0 || this.local.distanceTo(this.last) >= STEP) {
      if (this.count < MAX_POINTS) {
        this.local.toArray(this.buf, this.count * 3);
        this.count++;
        this.last.copy(this.local);
        (this.line.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
        this.line.geometry.setDrawRange(0, this.count);
      }
    }
  }
}
