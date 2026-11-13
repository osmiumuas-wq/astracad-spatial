/**
 * Print preview on the desk: the kernel slices the part into real layers along
 * the build direction the manufacturing agent chose, and the outlines build up
 * on the bench one after another, as a printer would lay them down. The panel
 * line states the true layer count at 0.2 mm and the time estimate. Nothing is
 * sent to a printer: a secure web page cannot reach one on the local network,
 * so the user takes the STL or 3MF instead.
 */

import {
  BufferAttribute,
  BufferGeometry,
  createSystem,
  LineBasicMaterial,
  LineSegments,
  VisibilityState,
} from '@iwsdk/core';
import { ctx } from '../app/context.js';
import { COLORS } from '../app/palette.js';
import { setButton } from '../app/ui3d.js';

const BUILD_S = 5;

export class PrintSystem extends createSystem({}) {
  private lines!: LineSegments<BufferGeometry, LineBasicMaterial>;
  private starts: Uint32Array = new Uint32Array(0);
  private total = 0;
  private t = -1;
  private active = false;
  private shownLayers = 0;

  init(): void {
    const { bench, app } = ctx;
    this.lines = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ color: COLORS.cyan, toneMapped: false, transparent: true, opacity: 0.9 }),
    );
    this.lines.name = 'Print layers';
    this.lines.visible = false;
    this.lines.frustumCulled = false;
    bench.part.pivot.add(this.lines);

    this.cleanupFuncs.push(
      app.params.subscribe(() => this.endPreview()),
      app.jobId.subscribe(() => this.endPreview()),
    );
  }

  /** The Print preview button on the tool strip calls this. */
  toggle(): void {
    if (this.active) {
      this.endPreview();
    } else {
      void this.beginPreview();
    }
  }

  private async beginPreview(): Promise<void> {
    const { app, bench, sfx } = ctx;
    if (app.rollback.peek() !== null || app.grown.peek()) {
      app.say('Print preview works on the finished solid part.', 'warn');
      return;
    }
    this.active = true;
    setButton('act:print', { toggled: true, label: 'Slicing...' });
    try {
      const res = await app.engine.run<'sliced'>({ type: 'slice', job: app.jobId.peek(), params: app.params.peek() });
      if (!this.active) return;
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(res.segments, 3));
      this.lines.geometry.dispose();
      this.lines.geometry = g;
      this.starts = res.starts;
      this.total = res.segments.length / 3;
      this.shownLayers = 0;
      g.setDrawRange(0, 0);
      this.lines.visible = true;
      bench.part.mesh.visible = false;
      bench.part.edges.visible = false;
      this.t = 0;
      setButton('act:print', { label: 'End preview' });
      sfx.play('grow');
      app.say(
        `${res.printLayers} layers at ${res.layerHeight} mm, printed ${res.upLabel}, about ${Math.max(1, Math.round(res.minutes))} min. Take the STL or 3MF to your printer.`,
        'info',
      );
    } catch (e) {
      this.endPreview();
      app.say(e instanceof Error ? e.message : String(e), 'bad');
    }
  }

  private endPreview(): void {
    if (!this.active) return;
    this.active = false;
    this.t = -1;
    this.lines.visible = false;
    const part = ctx.bench.part;
    part.mesh.visible = true;
    part.edges.visible = !part.hasStress;
    setButton('act:print', { toggled: false, label: 'Print preview' });
  }

  update(delta: number): void {
    if (this.world.visibilityState.peek() === VisibilityState.NonImmersive && this.active) {
      this.endPreview();
    }
    if (this.t < 0 || !this.starts.length) return;
    this.t += delta;
    const f = Math.min(1, this.t / BUILD_S);
    const layers = Math.min(this.starts.length, Math.ceil(f * this.starts.length));
    const end = layers >= this.starts.length ? this.total : this.starts[layers] / 3;
    this.lines.geometry.setDrawRange(0, end);
    if (layers !== this.shownLayers) {
      this.shownLayers = layers;
      if (layers % 8 === 0) ctx.sfx.play('tick', undefined, 0.8 + 0.6 * f);
    }
    if (f >= 1) this.t = -1;
  }
}
