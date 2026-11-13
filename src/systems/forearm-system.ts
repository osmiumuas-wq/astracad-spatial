/**
 * Time travel on the forearm: turn the non-dominant wrist palm-up and the
 * part's feature history appears as a filmstrip along that forearm, newest at
 * the wrist. Touch a frame with the other index fingertip to roll the part back
 * to that feature; touch the wrist frame to return to the finished part. The
 * rail beside the bench does the same for anyone who cannot raise an arm.
 */

import { createSystem, Group, Matrix4, Vector3, VisibilityState } from '@iwsdk/core';
import { ctx, probe } from '../app/context.js';
import { TextLabel } from '../app/labels.js';
import { CSS } from '../app/palette.js';

const FRAMES = 6;
const SPACING = 0.036;
const TOUCH = 0.016;
const NAMES: Record<string, string> = {
  'sketch.loops': 'Sketch',
  'sketch.rectangle': 'Sketch',
  'sketch.circle': 'Sketch',
  'sketch.profile': 'Profile',
  'feature.extrude': 'Extrude',
  'feature.cut': 'Pocket',
  'feature.revolve': 'Revolve',
  'feature.hole': 'Holes',
  'feature.pattern.circular': 'Pattern',
  'feature.pattern.linear': 'Pattern',
  'ref.plane': 'Plane',
};

export class ForearmSystem extends createSystem({}) {
  private strip!: Group;
  private frames: TextLabel[] = [];
  private shown = 0;
  private touchedAt = -1;
  private time = 0;
  private readonly basis = new Matrix4();
  private readonly up = new Vector3();
  private readonly along = new Vector3();
  private readonly side = new Vector3();
  private readonly p = new Vector3();

  init(): void {
    this.strip = new Group();
    this.strip.name = 'Forearm filmstrip';
    this.strip.visible = false;
    for (let i = 0; i < FRAMES; i++) {
      const label = new TextLabel(0.02);
      label.mesh.position.set(0, 0, i * SPACING);
      this.strip.add(label.mesh);
      this.frames.push(label);
    }
    this.world.createTransformEntity(this.strip, { persistent: true });
  }

  update(delta: number): void {
    this.time += delta;
    const { app, hands } = ctx;
    const built = app.built.peek();
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    const offSide = app.settings.peek().handed === 'left' ? 'right' : 'left';
    const arm = hands.get(offSide);
    const finger = hands.other(offSide);
    const palmUp = arm.tracked && arm.palmNormal.y > 0.65 && !arm.pinching;
    if (!immersive || !built || !palmUp || app.mode.peek() !== 'shape') {
      this.strip.visible = false;
      return;
    }
    const total = built.features.length;
    const count = Math.min(FRAMES, total);
    // Frame basis: x across the arm, y out of the palm, z from the fingers towards the elbow.
    this.up.copy(arm.palmNormal);
    this.along.copy(arm.forward).negate();
    this.side.crossVectors(this.up, this.along).normalize();
    this.along.crossVectors(this.side, this.up).normalize();
    this.basis.makeBasis(this.side, this.up, this.along);
    this.strip.quaternion.setFromRotationMatrix(this.basis);
    // Lie the labels flat on the arm, readable from above.
    this.strip.position.copy(arm.wrist).addScaledVector(this.up, 0.03);
    this.strip.visible = true;
    const rolled = app.rollback.peek();
    const current = rolled ?? total;
    for (let i = 0; i < FRAMES; i++) {
      const label = this.frames[i];
      // Newest feature at the wrist (i = 0), older ones towards the elbow.
      const k = total - i;
      label.visible = i < count;
      if (i >= count) continue;
      label.mesh.rotation.set(-Math.PI / 2, 0, Math.PI);
      const name = NAMES[built.features[k - 1]?.op] ?? 'Feature';
      label.set(`${k}  ${name}`, {
        bg: k === current ? CSS.amber : CSS.panel,
        fg: k === current ? '#1a1203' : CSS.text,
        border: k === current ? '#ffd06b' : CSS.cyan,
      });
    }
    this.shown = count;
    // A fingertip touch selects a frame (with a short hold-off against double hits).
    if (!finger.tracked || this.time - this.touchedAt < 0.5) return;
    for (let i = 0; i < count; i++) {
      this.frames[i].mesh.getWorldPosition(this.p);
      if (this.p.distanceTo(finger.indexTip) < TOUCH) {
        const k = total - i;
        this.touchedAt = this.time;
        app.setRollback(k >= total ? null : k);
        probe.forearm = k;
        ctx.sfx.play('select', this.p);
        break;
      }
    }
  }
}
