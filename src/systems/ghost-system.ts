/**
 * Pinch-and-extract: once the length, width and height of a real object are
 * measured for the cradle, a glowing box of exactly that size rises from where
 * the hands measured it and flies to the bench, where it settles into the
 * cradle's pocket. It stays there, translucent, so the clearance around the
 * object can be seen. It is the object's bounding box, not a scan of its shape.
 */

import {
  BoxGeometry,
  createSystem,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from '@iwsdk/core';
import { ctx } from '../app/context.js';
import { COLORS } from '../app/palette.js';

const FLIGHT_S = 1.4;

export class GhostSystem extends createSystem({}) {
  private box!: Mesh<BoxGeometry, MeshStandardMaterial>;
  private edges!: LineSegments<EdgesGeometry, LineBasicMaterial>;
  private flying = -1;
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private readonly tmp = new Vector3();

  init(): void {
    const { app, bench } = ctx;
    const unit = new BoxGeometry(1, 1, 1);
    this.box = new Mesh(
      unit,
      new MeshStandardMaterial({
        color: COLORS.cyan,
        emissive: COLORS.cyan,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    this.box.name = 'Measured object';
    this.box.renderOrder = 5;
    this.edges = new LineSegments(
      new EdgesGeometry(unit),
      new LineBasicMaterial({ color: COLORS.cyan, toneMapped: false }),
    );
    this.box.add(this.edges);
    this.box.visible = false;
    bench.turntable.add(this.box);
    this.world.createTransformEntity(this.box, { parent: ctx.turntableEntity, persistent: true });

    this.cleanupFuncs.push(
      app.extractFrom.subscribe((at) => {
        if (!at || app.jobId.peek() !== 'cradle') return;
        // Start where the hands were, in turntable space.
        this.from.set(at[0], at[1], at[2]);
        bench.turntable.worldToLocal(this.from);
        this.flying = 0;
        ctx.sfx.play('bind');
      }),
      app.jobId.subscribe((id) => {
        if (id !== 'cradle') this.box.visible = false;
      }),
    );
  }

  /** Where the object sits in the pocket, turntable space (metres). */
  private seat(out: Vector3): Vector3 {
    const { app, bench } = ctx;
    const p = app.params.peek();
    const s = bench.part.scale;
    return out.set(0, (p.floor + p.H / 2) * s, 0).add(bench.part.pivot.position);
  }

  update(delta: number): void {
    const { app, bench } = ctx;
    const p = app.params.peek();
    const show = app.jobId.peek() === 'cradle' && app.bound.peek().length > 0 && app.rollback.peek() === null;
    if (!show) {
      this.box.visible = false;
      return;
    }
    const s = bench.part.scale;
    this.box.visible = true;
    this.box.scale.set(p.L * s, p.H * s, p.W * s);
    this.seat(this.to);
    if (this.flying >= 0) {
      this.flying += delta / FLIGHT_S;
      const t = Math.min(1, this.flying);
      const e = 1 - Math.pow(1 - t, 3);
      // Rise first, then glide down into the pocket.
      this.tmp.copy(this.from).lerp(this.to, e);
      this.tmp.y += Math.sin(Math.PI * t) * 0.08;
      this.box.position.copy(this.tmp);
      this.box.material.emissiveIntensity = 0.6 + (1 - t) * 1.4;
      if (t >= 1) this.flying = -1;
    } else {
      this.box.position.copy(this.to);
    }
  }
}
