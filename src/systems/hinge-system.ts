/**
 * The hinge as an assembly: leaf B turns about the pin while leaf A stays put.
 * "Swing" opens it one way until the leaves touch, holds there with the
 * contact shown in red, then the other way. The contact angle comes from the
 * geometry (src/engine/jobs.ts hingeLimit), not from an animation preset.
 */

import { BufferAttribute, createSystem, Vector3, VisibilityState } from '@iwsdk/core';
import { hingeGeometry, hingeLimit } from '../engine/jobs.js';
import { ctx, probe } from '../app/context.js';
import { TextLabel, faceViewer } from '../app/labels.js';
import { CSS } from '../app/palette.js';
import { setButton } from '../app/ui3d.js';

/** Seconds for each part of the swing: open, hold at contact, close; then the same the other way. */
const OPEN_S = 1.6;
const HOLD_S = 0.9;

export class HingeSystem extends createSystem({}) {
  private leafB: Uint32Array = new Uint32Array(0);
  private limit = 0;
  private t = -1;
  private label!: TextLabel;
  private readonly viewer = new Vector3();
  private basePos: Float32Array = new Float32Array(0);
  private baseNrm: Float32Array = new Float32Array(0);
  private axisY = 0;

  init(): void {
    const { app, bench } = ctx;
    this.label = new TextLabel(0.016);
    this.label.visible = false;
    bench.turntable.add(this.label.mesh);
    this.cleanupFuncs.push(
      app.built.subscribe(() => this.endSwing()),
      app.jobId.subscribe((id) => {
        this.endSwing();
        setButton('act:swing', { visible: id === 'hinge' });
      }),
    );
  }

  toggle(): void {
    if (this.t >= 0) {
      this.endSwing();
      return;
    }
    const { app } = ctx;
    const built = app.built.peek();
    if (app.jobId.peek() !== 'hinge' || !built || app.rollback.peek() !== null) return;
    const p = app.params.peek();
    const { R, r, a, b } = hingeGeometry(p);
    this.axisY = R;
    this.limit = hingeLimit(p);
    // Leaf B: its plate (z beyond the gap) and its knuckle (the middle stretch, outside the pin's bore).
    const pos = built.mesh.positions;
    const ids: number[] = [];
    for (let v = 0; v < pos.length / 3; v++) {
      const x = pos[v * 3];
      const y = pos[v * 3 + 1] - R;
      const z = pos[v * 3 + 2];
      const inMiddle = x > a + p.c * 0.5 && x < a + p.c * 1.5 + b;
      if (z >= R + p.c - 1e-4 || (inMiddle && Math.hypot(y, z) >= r + p.c * 0.5)) ids.push(v);
    }
    this.leafB = Uint32Array.from(ids);
    this.basePos = pos.slice();
    this.baseNrm = built.mesh.normals.slice();
    this.t = 0;
    probe.hinge = { limit: Math.round(this.limit * 10) / 10, leafB: ids.length, vertices: pos.length / 3 };
    setButton('act:swing', { toggled: true, label: 'Stop' });
    app.say(`The leaves touch after ${this.limit.toFixed(1)} degrees either way. Widen the clearance or thin the leaves to open further.`, 'info');
  }

  private endSwing(): void {
    if (this.t < 0) return;
    this.t = -1;
    const part = ctx.bench.part;
    part.restoreShape();
    const nrm = part.mesh.geometry.getAttribute('normal') as BufferAttribute | undefined;
    if (nrm && nrm.array.length === this.baseNrm.length) {
      (nrm.array as Float32Array).set(this.baseNrm);
      nrm.needsUpdate = true;
    }
    part.mesh.material.emissive.setHex(0x000000);
    this.label.visible = false;
    setButton('act:swing', { toggled: false, label: 'Swing' });
  }

  /** Angle (degrees, + opens upward) and whether the leaves are touching, at time t of the swing. */
  private angleAt(t: number): { deg: number; contact: boolean } | null {
    const leg = 2 * OPEN_S + HOLD_S;
    if (t >= 2 * leg) return null;
    const sign = t < leg ? 1 : -1;
    const u = t % leg;
    if (u < OPEN_S) return { deg: sign * this.limit * (0.5 - 0.5 * Math.cos((Math.PI * u) / OPEN_S)), contact: false };
    if (u < OPEN_S + HOLD_S) return { deg: sign * this.limit, contact: true };
    const w = (u - OPEN_S - HOLD_S) / OPEN_S;
    return { deg: sign * this.limit * (0.5 + 0.5 * Math.cos(Math.PI * w)), contact: false };
  }

  update(delta: number): void {
    if (this.t < 0) return;
    const { bench } = ctx;
    const part = bench.part;
    this.t += delta;
    const at = this.angleAt(this.t);
    if (!at) {
      this.endSwing();
      return;
    }
    const pos = part.mesh.geometry.getAttribute('position') as BufferAttribute;
    const nrm = part.mesh.geometry.getAttribute('normal') as BufferAttribute;
    if (pos.array.length !== this.basePos.length) {
      this.endSwing();
      return;
    }
    const p = pos.array as Float32Array;
    const n = nrm.array as Float32Array;
    const th = (at.deg * Math.PI) / 180;
    const c = Math.cos(th);
    const s = Math.sin(th);
    // Turn about the pin (the X axis through y = R): z' = z c - y s, y' = z s + y c.
    for (let i = 0; i < this.leafB.length; i++) {
      const v = this.leafB[i] * 3;
      const y = this.basePos[v + 1] - this.axisY;
      const z = this.basePos[v + 2];
      p[v + 1] = this.axisY + z * s + y * c;
      p[v + 2] = z * c - y * s;
      const ny = this.baseNrm[v + 1];
      const nz = this.baseNrm[v + 2];
      n[v + 1] = nz * s + ny * c;
      n[v + 2] = nz * c - ny * s;
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
    part.mesh.material.emissive.setHex(at.contact ? 0x8a1020 : 0x000000);
    this.label.set(at.contact ? `Leaves touch at ${Math.abs(at.deg).toFixed(1)} deg` : `Open ${Math.abs(at.deg).toFixed(0)} deg`, {
      bg: at.contact ? 'rgba(140,20,35,0.92)' : CSS.panel,
      border: at.contact ? CSS.red : CSS.cyan,
    });
    this.label.visible = true;
    const { box } = part;
    this.label.mesh.position.set(0, (box.max[1] - box.min[1]) * part.scale + 0.05, 0);
    (this.world.visibilityState.peek() === VisibilityState.NonImmersive ? this.world.camera : this.player.head).getWorldPosition(this.viewer);
    faceViewer(this.label.mesh, this.viewer);
  }
}
