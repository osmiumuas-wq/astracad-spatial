/**
 * Free design on the bench: a tool strip (add a box or cylinder, drill a hole
 * where the ray points, cut a pocket, fillet, shell, pattern, remove the last
 * feature) and the feature tree beside the part. Every tool is also a sentence
 * (src/engine/design.ts parseDesign), so voice and buttons do the same thing.
 * The last feature's sizes get the handles, the dial and "make it 10 taller".
 */

import { createSystem, Group, Vector3, VisibilityState } from '@iwsdk/core';
import { ctx } from '../app/context.js';
import { TextLabel, faceViewer } from '../app/labels.js';
import { CSS } from '../app/palette.js';
import { makeButton, setButton } from '../app/ui3d.js';
import { describeDesign, setDesignCurrent } from '../engine/design.js';

const TOOLS: [string, string, string][] = [
  ['design:box', '+ Box', 'add a box 30 by 30 by 10'],
  ['design:cyl', '+ Cylinder', 'add a cylinder 20 by 15'],
  ['design:hole', 'Hole here', 'drill a 5 mm hole here'],
  ['design:pocket', 'Pocket here', 'cut a box pocket 15 by 15 by 5'],
  ['design:fillet', 'Fillet 3', 'fillet 3'],
  ['design:shell', 'Shell 2', 'shell 2'],
  ['design:pattern', 'Pattern x3', 'pattern 3 times 20 apart'],
  ['design:remove', 'Remove last', 'remove the last feature'],
];

export class DesignSystem extends createSystem({}) {
  private readonly strip = new Group();
  private tree: TextLabel[] = [];
  private readonly viewer = new Vector3();
  private shown = false;

  init(): void {
    const { app, bench } = ctx;
    // Left of the bench, facing the user, like the other strips.
    this.strip.position.set(-0.205, 0.0, 0.05);
    this.strip.rotation.set(-0.7, 0.55, 0, 'YXZ');
    bench.root.add(this.strip);
    const e = this.world.createTransformEntity(this.strip, { parent: ctx.benchEntity, persistent: true });
    TOOLS.forEach(([key, label, sentence], i) => {
      const b = makeButton(e, { key, label, width: 0.062, height: 0.022 }, () => {
        ctx.sfx.play('select');
        app.runCommand(sentence);
      });
      b.position.set((i % 2) * 0.068 - 0.034, 0.045 - Math.floor(i / 2) * 0.028, 0);
    });
    for (let i = 0; i < 12; i++) {
      const l = new TextLabel(0.0105);
      l.visible = false;
      l.mesh.position.set(0.19, 0.115 - i * 0.0135, 0.05);
      bench.root.add(l.mesh);
      this.tree.push(l);
    }
    this.cleanupFuncs.push(
      app.params.subscribe((p) => {
        if (app.jobId.peek() === 'design') {
          setDesignCurrent(p);
          this.refresh();
        }
      }),
      app.jobId.subscribe(() => this.refresh()),
    );
    app.actions.design = () => {
      app.selectJob('design');
      app.say('Free design: a block to start. Add boxes and cylinders, drill holes where you point, fillet, shell and pattern, by voice or from the design strip on the left.', 'info');
    };
    this.refresh();
  }

  private refresh(): void {
    const { app } = ctx;
    const on = app.jobId.peek() === 'design';
    this.shown = on;
    for (const [key] of TOOLS) setButton(key, { visible: on });
    const lines = on ? ['FEATURES', ...describeDesign(app.params.peek())] : [];
    this.tree.forEach((l, i) => {
      if (i < lines.length) {
        l.set(lines[i], { bg: CSS.panel, border: i === 0 ? CSS.cyan : i === lines.length - 1 ? CSS.amber : CSS.panel });
        l.visible = true;
      } else {
        l.visible = false;
      }
    });
  }

  update(): void {
    if (!this.shown) return;
    (this.world.visibilityState.peek() === VisibilityState.NonImmersive ? this.world.camera : this.player.head).getWorldPosition(this.viewer);
    for (const l of this.tree) if (l.visible) faceViewer(l.mesh, this.viewer);
  }
}
