/**
 * Vibration modes on the bench: the part's three lowest natural frequencies
 * (src/engine/modal.ts), held the way the job's fixture holds it. The part
 * swings in the chosen mode shape, slowed down to about one swing a second so
 * the eye can follow it, with the true frequency on a label.
 */

import { createSystem, Vector3, VisibilityState } from '@iwsdk/core';
import { ctx, probe } from '../app/context.js';
import { TextLabel, faceViewer } from '../app/labels.js';
import { CSS } from '../app/palette.js';
import { setButton } from '../app/ui3d.js';

/** Swings per second shown, whatever the true frequency. */
const SHOWN_HZ = 1.1;

export class ModeSystem extends createSystem({}) {
  private frequencies: number[] = [];
  private shapes: Float32Array[] = [];
  private index = -1;
  private running = false;
  private t = 0;
  private label!: TextLabel;
  private readonly viewer = new Vector3();

  init(): void {
    const { app, bench } = ctx;
    this.label = new TextLabel(0.016);
    this.label.visible = false;
    bench.turntable.add(this.label.mesh);
    this.cleanupFuncs.push(
      app.params.subscribe(() => this.end(true)),
      app.jobId.subscribe(() => this.end(true)),
      app.material.subscribe(() => this.end(true)),
    );
  }

  /** The Vibration button: solve, then step through the modes, then off. */
  toggle(): void {
    if (this.running) return;
    if (this.index < 0) void this.begin();
    else if (this.index + 1 < this.frequencies.length) this.show(this.index + 1);
    else this.end(false);
  }

  private async begin(): Promise<void> {
    const { app, sfx } = ctx;
    if (app.rollback.peek() !== null || !app.built.peek()) {
      app.say('Vibration works on the finished part.', 'warn');
      return;
    }
    this.running = true;
    setButton('act:modes', { toggled: true, label: 'Solving...' });
    app.busy.value = { kind: 'solve', label: 'Finding natural frequencies', progress: -1 };
    try {
      const res = await app.engine.run<'moded'>(
        { type: 'modes', job: app.jobId.peek(), params: app.params.peek(), material: app.material.peek() },
        (ev) => {
          if (ev.type === 'mode-progress') {
            app.busy.value = { kind: 'solve', label: `Finding natural frequencies: mode ${ev.mode + 1} of 3`, progress: -1 };
          }
        },
      );
      app.busy.value = null;
      this.frequencies = res.frequencies;
      this.shapes = res.shapes;
      probe.modes = { hz: res.frequencies.map((f) => Math.round(f)), cells: res.elements, ms: Math.round(res.ms) };
      const hz = res.frequencies.map((f) => `${f < 100 ? f.toFixed(1) : f.toFixed(0)} Hz`).join(', ');
      app.say(
        `Natural frequencies (${res.fixtureLabel.toLowerCase()}): ${hz}. ${res.frequencies[0] < 120 ? 'The first is low: a motor or fan nearby could make it buzz.' : 'Well above everyday motor and fan speeds.'}`,
        res.frequencies[0] < 120 ? 'warn' : 'good',
      );
      sfx.play('grow');
      this.show(0);
    } catch (e) {
      app.busy.value = null;
      this.end(false);
      app.say(e instanceof Error ? e.message : String(e), 'bad');
    } finally {
      this.running = false;
    }
  }

  private show(i: number): void {
    this.index = i;
    this.t = 0;
    const f = this.frequencies[i];
    this.label.set(`Mode ${i + 1}: ${f < 100 ? f.toFixed(1) : f.toFixed(0)} Hz (slowed down)`, { bg: CSS.panel, border: CSS.violet });
    this.label.visible = true;
    setButton('act:modes', { toggled: true, label: i + 1 < this.frequencies.length ? `Mode ${i + 2}` : 'End modes' });
  }

  private end(invalidated: boolean): void {
    if (this.index < 0 && !invalidated) {
      setButton('act:modes', { toggled: false, label: 'Vibration' });
      return;
    }
    if (this.index >= 0) ctx.bench.part.restoreShape();
    this.index = -1;
    this.frequencies = [];
    this.shapes = [];
    this.label.visible = false;
    setButton('act:modes', { toggled: false, label: 'Vibration' });
  }

  update(delta: number): void {
    if (this.index < 0) return;
    const { bench, app } = ctx;
    this.t += delta;
    const still = app.settings.peek().reduceMotion;
    // Swing by 5 % of the part's size.
    const amp = 0.05 * bench.part.size * (still ? 1 : Math.sin(2 * Math.PI * SHOWN_HZ * this.t));
    if (!bench.part.showMode(this.shapes[this.index], amp)) {
      this.end(true);
      return;
    }
    const { box } = bench.part;
    this.label.mesh.position.set(0, (box.max[1] - box.min[1]) * bench.part.scale + 0.03, 0);
    (this.world.visibilityState.peek() === VisibilityState.NonImmersive ? this.world.camera : this.player.head).getWorldPosition(this.viewer);
    faceViewer(this.label.mesh, this.viewer);
  }
}
