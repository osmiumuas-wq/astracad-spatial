/**
 * Slice: real G-code for an FDM printer, made on the headset
 * (src/engine/gcode.ts on the kernel's exact sections). The bench shows the
 * toolpaths growing layer by layer, walls amber, solid skin green, sparse fill
 * cyan, in the orientation the agents chose; a label gives layers, time,
 * filament and mass; "Save G-code" downloads the file for the printer.
 */

import { BufferAttribute, BufferGeometry, createSystem, Group, LineBasicMaterial, LineSegments, Vector3, VisibilityState } from '@iwsdk/core';
import { ctx, probe } from '../app/context.js';
import { CancelledError } from '../app/engine-client.js';
import { TextLabel, faceViewer } from '../app/labels.js';
import { CSS } from '../app/palette.js';
import { makeButton, setButton } from '../app/ui3d.js';

const BUILD_S = 8;

export class GcodeSystem extends createSystem({}) {
  private lines!: LineSegments<BufferGeometry, LineBasicMaterial>;
  private label!: TextLabel;
  private starts: Uint32Array = new Uint32Array(0);
  private total = 0;
  private t = 0;
  private active = false;
  private file: { gcode: string; name: string } | null = null;
  private readonly viewer = new Vector3();
  private readonly saveGroup = new Group();

  init(): void {
    const { app, bench } = ctx;
    this.lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ vertexColors: true, toneMapped: false }));
    this.lines.name = 'G-code toolpaths';
    this.lines.visible = false;
    this.lines.frustumCulled = false;
    bench.part.pivot.add(this.lines);
    this.label = new TextLabel(0.014);
    this.label.visible = false;
    bench.turntable.add(this.label.mesh);
    // The save button floats beside the bench while toolpaths are shown.
    this.saveGroup.position.set(0.16, 0.06, 0.02);
    bench.root.add(this.saveGroup);
    const saveEntity = this.world.createTransformEntity(this.saveGroup, { parent: ctx.benchEntity, persistent: true });
    makeButton(saveEntity, { key: 'gcode:save', label: 'Save G-code', width: 0.07, height: 0.024, tone: 'primary' }, () => this.save());
    setButton('gcode:save', { visible: false });
    this.cleanupFuncs.push(app.params.subscribe(() => this.end()), app.jobId.subscribe(() => this.end()), app.material.subscribe(() => this.end()));
    app.actions.gcode = () => void this.toggle();
  }

  private async toggle(): Promise<void> {
    if (this.active) {
      this.end();
      return;
    }
    const { app, bench } = ctx;
    if (!app.built.peek()) {
      app.say('Slicing works on the finished part.', 'warn');
      return;
    }
    if (app.grown.peek()?.final) app.say('Slicing the solid part; for the grown or lattice shape, export the STL to your slicer.', 'info');
    this.active = true;
    setButton('lab:gcode', { toggled: true });
    app.busy.value = { kind: 'export', label: 'Slicing: walls, skin and infill', progress: -1 };
    try {
      const res = await app.engine.run<'gcoded'>({ type: 'gcode', job: app.jobId.peek(), params: app.params.peek(), material: app.material.peek() });
      app.busy.value = null;
      if (!this.active) return;
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(res.segments, 3));
      g.setAttribute('color', new BufferAttribute(res.colors, 3));
      g.setDrawRange(0, 0);
      this.lines.geometry.dispose();
      this.lines.geometry = g;
      this.starts = res.starts;
      this.total = res.segments.length / 3;
      this.t = 0;
      this.lines.visible = true;
      bench.part.mesh.visible = false;
      bench.part.edges.visible = false;
      this.file = { gcode: res.gcode, name: res.name };
      const min = Math.round(res.seconds / 60);
      const time = min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
      const mat = app.materialData.name;
      this.label.set(`${res.layers} layers · about ${time} · ${res.grams.toFixed(1)} g ${mat} · ${(res.filamentMm / 1000).toFixed(2)} m`, { bg: CSS.panel, border: CSS.amber });
      this.label.visible = true;
      setButton('gcode:save', { visible: true });
      probe.gcode = { layers: res.layers, minutes: min, grams: +res.grams.toFixed(2), metres: +(res.filamentMm / 1000).toFixed(3), bytes: res.gcode.length, up: res.upLabel };
      app.say(
        `Sliced for a 0.4 mm nozzle at 0.2 mm layers, printed ${res.upLabel}: ${res.layers} layers, about ${time}, ${res.grams.toFixed(1)} g of ${mat}. ` +
          'Walls amber, solid skin green, infill cyan. Save the G-code for your printer. No supports are added.',
        'good',
      );
    } catch (e) {
      app.busy.value = null;
      if (!(e instanceof CancelledError)) app.say(e instanceof Error ? e.message : String(e), 'warn');
      this.end();
    }
  }

  private save(): void {
    const f = this.file;
    if (!f) return;
    const url = URL.createObjectURL(new Blob([f.gcode], { type: 'text/x-gcode' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${f.name}.gcode`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    ctx.sfx.play('save');
    ctx.app.say(`Saved ${f.name}.gcode to your downloads.`, 'good');
  }

  private end(): void {
    if (!this.active) return;
    this.active = false;
    this.lines.visible = false;
    this.label.visible = false;
    this.file = null;
    ctx.bench.part.mesh.visible = true;
    ctx.bench.part.edges.visible = true;
    setButton('lab:gcode', { toggled: false });
    setButton('gcode:save', { visible: false });
  }

  update(delta: number): void {
    if (!this.active || !this.lines.visible) return;
    this.t += delta;
    const n = this.starts.length;
    const shown = Math.min(n, Math.floor((this.t / BUILD_S) * n) + 1);
    const end = shown >= n ? this.total : this.starts[shown] * 2;
    this.lines.geometry.setDrawRange(0, end);
    const { bench } = ctx;
    const { box } = bench.part;
    this.label.mesh.position.set(0, (box.max[1] - box.min[1]) * bench.part.scale + 0.04, 0);
    (this.world.visibilityState.peek() === VisibilityState.NonImmersive ? this.world.camera : this.player.head).getWorldPosition(this.viewer);
    faceViewer(this.label.mesh, this.viewer);
  }
}
