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

/**
 * The feature ribbon, like a CAD program's: tabs of tools (create, holes, modify, output). "Here" and "edge"
 * tools act where the hand ray last pointed; every size can be changed after (handles, dial, voice).
 */
const TABS = ['Create', 'Holes', 'Modify', 'Sheet', 'Output'] as const;
type Tab = (typeof TABS)[number];
const TOOLS: [string, string, string, Tab][] = [
  ['design:sketch', 'Sketch here', 'sketch here', 'Create'],
  ['design:box', '+ Box', 'add a box 30 by 30 by 10', 'Create'],
  ['design:cyl', '+ Cylinder', 'add a cylinder 20 by 15', 'Create'],
  ['design:pocket', 'Pocket here', 'cut a box pocket 15 by 15 by 5', 'Create'],
  ['design:rib', 'Rib here', 'rib 3 thick 15 by 15', 'Create'],
  ['design:gear', 'Gear m2 z20', 'gear module 2 with 20 teeth 8 thick', 'Create'],
  ['design:sheet', 'Sheet metal', 'sheet metal 100 by 60 thick 2 bend 2', 'Sheet'],
  ['design:flange', 'Flange here', 'flange 25', 'Sheet'],
  ['design:flange2', 'Flange 45\u00b0', 'flange 25 at 45', 'Sheet'],
  ['design:flat', 'Flat pattern', 'flat pattern', 'Sheet'],
  ['design:surface', 'Freeform', 'freeform surface 80 by 60 thick 3', 'Sheet'],
  ['design:top', 'Freeform top', 'freeform top 80 by 60', 'Sheet'],
  ['design:hole', 'Hole here', 'drill a 5 mm hole here', 'Holes'],
  ['design:cbore', 'C-bore here', 'counterbore 10 by 3', 'Holes'],
  ['design:tap', 'Tap M6 here', 'tap m6 12 deep', 'Holes'],
  ['design:thread', 'Thread M8', 'm8 thread 16 long', 'Holes'],
  ['design:pattern', 'Pattern x3', 'pattern 3 times 20 apart', 'Holes'],
  ['design:circpat', 'Circ pattern 6', 'circular pattern 6', 'Holes'],
  ['design:fillet', 'Fillet edge 2', 'fillet this edge 2', 'Modify'],
  ['design:chamfer', 'Chamfer edge 1', 'chamfer this edge 1', 'Modify'],
  ['design:roundall', 'Round all 1', 'round all edges 1', 'Modify'],
  ['design:shell', 'Shell 2', 'shell 2', 'Modify'],
  ['design:draft', 'Draft 3\u00b0', 'draft 3', 'Modify'],
  ['design:mirror', 'Mirror X', 'mirror across x', 'Modify'],
  ['design:remove', 'Remove last', 'remove the last feature', 'Output'],
  ['design:step', 'Export STEP', 'export step', 'Output'],
  ['design:drawing', 'Drawing', 'drawing', 'Output'],
];

export class DesignSystem extends createSystem({}) {
  private readonly strip = new Group();
  private tree: TextLabel[] = [];
  private readonly viewer = new Vector3();
  private shown = false;
  private tab: Tab = 'Create';

  init(): void {
    const { app, bench } = ctx;
    // Left of the bench, facing the user, like the other strips.
    this.strip.position.set(-0.215, 0.0, 0.06);
    this.strip.rotation.set(-0.7, 0.55, 0, 'YXZ');
    bench.root.add(this.strip);
    const e = this.world.createTransformEntity(this.strip, { parent: ctx.benchEntity, persistent: true });
    // Tabs along the top, then the open tab's tools in three columns.
    TABS.forEach((tab, i) => {
      const b = makeButton(e, { key: `design:tab:${tab}`, label: tab, width: 0.037, height: 0.016, tone: 'ghost' }, () => {
        ctx.sfx.play('select');
        this.tab = tab;
        this.refresh();
      });
      b.position.set(i * 0.039 - 0.078, 0.06, 0);
    });
    const slot = new Map<Tab, number>();
    TOOLS.forEach(([key, label, sentence, tab]) => {
      const i = slot.get(tab) ?? 0;
      slot.set(tab, i + 1);
      const b = makeButton(e, { key, label, width: 0.058, height: 0.02, tone: key === 'design:sketch' ? 'primary' : 'default' }, () => {
        ctx.sfx.play('select');
        const reply = app.runCommand(sentence);
        if (reply) app.say(reply, 'info');
      });
      b.position.set((i % 3) * 0.062 - 0.062, 0.035 - Math.floor(i / 3) * 0.024, 0);
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
      app.sketchBenchOpen.subscribe(() => this.refresh()),
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
    const strip = on && !app.sketchBench;
    for (const [key, , , tab] of TOOLS) setButton(key, { visible: strip && tab === this.tab });
    for (const tab of TABS) setButton(`design:tab:${tab}`, { visible: strip, toggled: tab === this.tab });
    // While a sketch is open its toolbar stands where the tree is.
    const lines = on && !app.sketchBench ? ['FEATURES', ...describeDesign(app.params.peek())] : [];
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
