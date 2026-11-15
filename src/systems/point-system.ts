/**
 * Point and say: where a hand's ray (or the head's gaze on glasses) meets the
 * part, a cyan ring marks the spot and a label names the size there: the
 * parameter whose handle is nearest the hit. Then "make this thicker" or
 * "this 5 mm longer" (spoken or typed, within 8 seconds) edits that size;
 * see App.runCommand and deicticEdit in src/engine/commands.ts.
 */

import { createSystem, Mesh, MeshBasicMaterial, Raycaster, RingGeometry, Vector3, VisibilityState } from '@iwsdk/core';
import { ctx, probe } from '../app/context.js';
import { TextLabel, faceViewer } from '../app/labels.js';
import { COLORS, CSS } from '../app/palette.js';
import { paramDef } from '../engine/jobs.js';

export class PointSystem extends createSystem({}) {
  private readonly ray = new Raycaster();
  private readonly o = new Vector3();
  private readonly d = new Vector3();
  private readonly local = new Vector3();
  private readonly viewer = new Vector3();
  private ring!: Mesh<RingGeometry, MeshBasicMaterial>;
  private label!: TextLabel;
  private lastParam = '';

  init(): void {
    this.ring = new Mesh(
      new RingGeometry(0.0035, 0.0055, 24),
      new MeshBasicMaterial({ color: COLORS.cyan, toneMapped: false, depthTest: false, transparent: true }),
    );
    this.ring.renderOrder = 27;
    this.ring.visible = false;
    this.label = new TextLabel(0.011);
    this.label.visible = false;
    ctx.bench.turntable.add(this.ring, this.label.mesh);
  }

  update(): void {
    const { app, bench } = ctx;
    const mode = app.mode.peek();
    const live = this.world.visibilityState.peek() !== VisibilityState.NonImmersive && (mode === 'shape' || mode === 'test') && app.built.peek();
    let hit: { point: Vector3; normal: Vector3 | null } | null = null;
    if (live) {
      for (const side of ['right', 'left'] as const) {
        const space = this.player.raySpaces[side];
        if (!space) continue;
        space.getWorldPosition(this.o);
        space.getWorldDirection(this.d);
        // A ray space looks down its -Z axis.
        this.d.negate();
        this.ray.set(this.o, this.d);
        this.ray.far = 1.5;
        const hits = this.ray.intersectObject(bench.part.mesh, false);
        if (hits.length) {
          hit = { point: hits[0].point, normal: hits[0].face?.normal ?? null };
          break;
        }
      }
    }
    if (!hit) {
      this.ring.visible = false;
      this.label.visible = false;
      return;
    }
    // The size there: the job handle nearest the hit, in part millimetres.
    this.local.copy(hit.point);
    bench.turntable.worldToLocal(this.local);
    const ringAt = this.local.clone();
    bench.part.toPart(this.local, this.local);
    const params = app.params.peek();
    let best = '';
    let bestD = Infinity;
    for (const h of app.job.handles) {
      const [x, y, z] = h.at(params);
      const dd = (x - this.local.x) ** 2 + (y - this.local.y) ** 2 + (z - this.local.z) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = h.param;
      }
    }
    // The spot and its face are always kept (for "sketch here" and "drill a hole here"); the size label needs a handle.
    const fn = hit.normal;
    app.pointed = { param: best, at: performance.now(), mm: [this.local.x, this.local.y, this.local.z], normal: fn ? [fn.x, fn.y, fn.z] : undefined };
    if (!best) {
      this.ring.position.copy(ringAt);
      this.ring.visible = true;
      this.label.visible = false;
      return;
    }
    probe.pointed = best;
    const def = paramDef(app.job, best);
    if (best !== this.lastParam) {
      this.lastParam = best;
      this.label.set(`${def?.label ?? best} ${+params[best].toFixed(2)}${def?.unit ? ` ${def.unit}` : ''}  ·  say "this thicker"`, { bg: CSS.panel, border: CSS.cyan });
    }
    this.ring.position.copy(ringAt);
    (this.world.visibilityState.peek() === VisibilityState.NonImmersive ? this.world.camera : this.player.head).getWorldPosition(this.viewer);
    this.ring.lookAt(this.viewer.clone().applyMatrix4(bench.turntable.matrixWorld.clone().invert()));
    this.ring.visible = true;
    this.label.mesh.position.copy(ringAt).add(this.o.set(0, 0.022, 0));
    faceViewer(this.label.mesh, this.viewer);
    this.label.visible = true;
  }
}
