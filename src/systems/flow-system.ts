/**
 * Air-flow preview on the bench: streamlines of ideal flow around the part
 * (src/engine/flow.ts), with beads running along them faster where the air
 * speeds up. Colour is speed relative to the oncoming air: blue where it
 * stalls, cyan at the oncoming speed, white where it is faster.
 *
 * Ideal flow has no viscosity: no wake, no separation, no drag, no lift. The
 * label says so, and no force is computed or shown.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  createSystem,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import type { Wind } from '../engine/flow.js';
import { ctx, quality, probe } from '../app/context.js';
import { TextLabel, faceViewer } from '../app/labels.js';
import { CSS } from '../app/palette.js';
import { setButton } from '../app/ui3d.js';

const BEADS_PER_LINE = 3;
const MAX_BEADS = 400;
/** Points per second a bead moves at the oncoming speed. */
const RATE = 40;

const SLOW = new Color(0x2a5bff);
const MID = new Color(0x2fe6ff);
const FAST = new Color(0xffffff);

function speedColor(s: number, out: Color): Color {
  if (s <= 1) return out.copy(SLOW).lerp(MID, Math.max(0, s));
  return out.copy(MID).lerp(FAST, Math.min(1, (s - 1) / 0.5));
}

export class FlowSystem extends createSystem({}) {
  private lines!: LineSegments<BufferGeometry, LineBasicMaterial>;
  private beads!: InstancedMesh<SphereGeometry, MeshBasicMaterial>;
  private label!: TextLabel;
  private points: Float32Array = new Float32Array(0);
  private speeds: Float32Array = new Float32Array(0);
  private starts: Uint32Array = new Uint32Array(0);
  private beadLine = new Uint16Array(0);
  private beadAt = new Float32Array(0);
  private beadCount = 0;
  private wind: Wind | null = null;
  private running = false;
  private readonly m = new Matrix4();
  private readonly c = new Color();
  private readonly viewer = new Vector3();

  init(): void {
    const { bench, app } = ctx;
    this.lines = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false }),
    );
    this.lines.name = 'Air flow streamlines';
    this.lines.visible = false;
    this.lines.frustumCulled = false;
    this.beads = new InstancedMesh(
      new SphereGeometry(1.4, 8, 6),
      new MeshBasicMaterial({ toneMapped: false }),
      MAX_BEADS,
    );
    this.beads.name = 'Air flow beads';
    this.beads.visible = false;
    this.beads.frustumCulled = false;
    this.beads.count = 0;
    bench.part.pivot.add(this.lines, this.beads);
    this.label = new TextLabel(0.016);
    this.label.visible = false;
    bench.turntable.add(this.label.mesh);
    this.cleanupFuncs.push(
      app.params.subscribe(() => this.end()),
      app.jobId.subscribe(() => this.end()),
    );
  }

  get active(): boolean {
    return this.wind !== null;
  }

  /** The Air flow button: side wind, then front wind, then off. */
  toggle(): void {
    if (this.wind === null) void this.begin('+x');
    else if (this.wind === '+x') void this.begin('-z');
    else this.end();
  }

  async begin(wind: Wind): Promise<void> {
    const { app, sfx } = ctx;
    if (this.running) return;
    if (app.rollback.peek() !== null || !app.built.peek()) {
      app.say('Air flow works on the finished part.', 'warn');
      return;
    }
    this.running = true;
    this.wind = wind;
    setButton('act:flow', { toggled: true, label: 'Solving air...' });
    try {
      const res = await app.engine.run<'flowed'>({ type: 'flow', job: app.jobId.peek(), params: app.params.peek(), wind });
      if (this.wind !== wind) return;
      this.points = res.points;
      this.speeds = res.speeds;
      this.starts = res.starts;
      const segs: number[] = [];
      for (let l = 0; l < this.starts.length; l++) {
        const a = this.starts[l];
        const b = l + 1 < this.starts.length ? this.starts[l + 1] : this.speeds.length;
        for (let p = a; p + 1 < b; p++) segs.push(p, p + 1);
      }
      const colors = new Float32Array(this.speeds.length * 3);
      for (let p = 0; p < this.speeds.length; p++) speedColor(this.speeds[p], this.c).toArray(colors, p * 3);
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(this.points, 3));
      g.setAttribute('color', new BufferAttribute(colors, 3));
      g.setIndex(segs);
      this.lines.geometry.dispose();
      this.lines.geometry = g;
      this.lines.visible = true;
      // Beads spread evenly along each line.
      this.beadCount = Math.min(MAX_BEADS, this.starts.length * BEADS_PER_LINE);
      this.beadLine = new Uint16Array(this.beadCount);
      this.beadAt = new Float32Array(this.beadCount);
      for (let i = 0; i < this.beadCount; i++) {
        this.beadLine[i] = Math.floor(i / BEADS_PER_LINE);
        this.beadAt[i] = ((i % BEADS_PER_LINE) + Math.random() * 0.3) / BEADS_PER_LINE;
      }
      this.beads.count = this.beadCount;
      this.beads.visible = true;
      let peak = 0;
      for (let p = 0; p < this.speeds.length; p++) peak = Math.max(peak, this.speeds[p]);
      this.label.set(wind === '+x' ? 'Ideal flow, wind from the left. No wake, no forces.' : 'Ideal flow, wind from you. No wake, no forces.', { bg: CSS.panel, border: CSS.cyan });
      this.label.visible = true;
      setButton('act:flow', { label: wind === '+x' ? 'Turn wind' : 'End flow' });
      sfx.play('grow');
      probe.flow = { wind, lines: this.starts.length, cells: res.cells, iterations: res.iterations, ms: Math.round(res.ms), peak: Math.round(peak * 100) / 100 };
      app.say(
        `Air-flow preview: up to ${peak.toFixed(1)} times the oncoming speed along these lines. Ideal flow shows where air goes; it has no wake and gives no forces.`,
        'info',
      );
    } catch (e) {
      this.end();
      app.say(e instanceof Error ? e.message : String(e), 'bad');
    } finally {
      this.running = false;
    }
  }

  end(): void {
    if (this.wind === null) return;
    this.wind = null;
    this.lines.visible = false;
    this.beads.visible = false;
    this.label.visible = false;
    setButton('act:flow', { toggled: false, label: 'Air flow' });
  }

  update(delta: number): void {
    if (!this.beads.visible || !this.beadCount) return;
    const { bench } = ctx;
    const n = this.speeds.length;
    // Under frame-rate pressure only every third bead is drawn; the lines stay.
    const stride = quality.level >= 3 ? 3 : 1;
    let slot = 0;
    for (let i = 0; i < this.beadCount; i += stride) {
      const l = this.beadLine[i];
      const a = this.starts[l];
      const b = l + 1 < this.starts.length ? this.starts[l + 1] : n;
      const len = b - a;
      if (len < 2) continue;
      const at = Math.min(len - 1, Math.floor(this.beadAt[i] * (len - 1)));
      const p = a + at;
      // Points are evenly spaced along the line, so moving faster through them shows faster air.
      this.beadAt[i] += (delta * RATE * Math.max(0.15, this.speeds[p])) / len;
      if (this.beadAt[i] >= 1) this.beadAt[i] -= 1;
      this.m.makeTranslation(this.points[p * 3], this.points[p * 3 + 1], this.points[p * 3 + 2]);
      this.beads.setMatrixAt(slot, this.m);
      this.beads.setColorAt(slot, speedColor(this.speeds[p], this.c));
      slot++;
    }
    this.beads.count = slot;
    this.beads.instanceMatrix.needsUpdate = true;
    if (this.beads.instanceColor) this.beads.instanceColor.needsUpdate = true;
    // The label floats above the part.
    const { box } = bench.part;
    this.label.mesh.position.set(0, (box.max[1] - box.min[1]) * bench.part.scale + 0.03, 0);
    (this.world.visibilityState.peek() === VisibilityState.NonImmersive ? this.world.camera : this.player.head).getWorldPosition(this.viewer);
    faceViewer(this.label.mesh, this.viewer);
  }
}
