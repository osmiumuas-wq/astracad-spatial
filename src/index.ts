/**
 * AstraCAD Spatial entry point: create the IWSDK world from the project
 * manifest, build the bench, and register the systems.
 */

import { DepthOccludable, DepthSensingSystem, effect, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { App } from './app/app.js';
import { Bench } from './app/bench.js';
import { CoDesign, codeFromUrl } from './app/codesign.js';
import { ctx, probe } from './app/context.js';
import { CoDesignSystem } from './systems/codesign-system.js';
import { Hands } from './app/hands.js';
import { Sfx } from './app/sfx.js';
import { mountFlatUi } from './flat/flat-ui.js';
import { CaptureSystem } from './systems/capture-system.js';
import { FlowSystem } from './systems/flow-system.js';
import { DrawingSystem } from './systems/drawing-system.js';
import { HingeSystem } from './systems/hinge-system.js';
import { ModeSystem } from './systems/mode-system.js';
import { ReferenceSystem } from './systems/reference-system.js';
import { ForearmSystem } from './systems/forearm-system.js';
import { GhostSystem } from './systems/ghost-system.js';
import { InteractionSystem } from './systems/interaction-system.js';
import { PartSystem } from './systems/part-system.js';
import { PrintSystem } from './systems/print-system.js';
import { ShelfSystem } from './systems/shelf-system.js';
import { SketchSystem } from './systems/sketch-system.js';
import { UiSystem } from './systems/ui-system.js';
import { WorkspaceSystem } from './systems/workspace-system.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  const app = new App();
  const bench = new Bench();
  const sfx = new Sfx();
  sfx.enabled = app.settings.peek().sound;

  world.renderer.localClippingEnabled = true;

  // Flat-page placement; an immersive session re-places the bench at the user's hands.
  bench.root.position.set(0.06, 1.0, -0.5);
  const benchEntity = world.createTransformEntity(bench.root, { persistent: true });
  const turntableEntity = world.createTransformEntity(bench.turntable, {
    parent: benchEntity,
    persistent: true,
  });

  const codesign = new CoDesign(app);
  Object.assign(ctx, {
    world,
    app,
    bench,
    hands: new Hands(),
    sfx,
    codesign,
    benchEntity,
    turntableEntity,
  });

  world.registerSystem(InteractionSystem, { priority: 5 });
  world.registerSystem(UiSystem, { priority: 6 });
  world.registerSystem(PartSystem, { priority: 20 });
  world.registerSystem(GhostSystem, { priority: 21 });
  world.registerSystem(ShelfSystem, { priority: 31 });
  world.registerSystem(PrintSystem, { priority: 22 });
  world.registerSystem(ForearmSystem, { priority: 23 });
  world.registerSystem(FlowSystem, { priority: 24 });
  world.registerSystem(ModeSystem, { priority: 25 });
  world.registerSystem(ReferenceSystem, { priority: 26 });
  world.registerSystem(HingeSystem, { priority: 27 });
  world.registerSystem(DrawingSystem, { priority: 28 });
  world.registerSystem(SketchSystem, { priority: 7 });
  world.registerSystem(CaptureSystem, { priority: 8 });
  world.registerSystem(WorkspaceSystem, { priority: 30 });
  world.registerSystem(CoDesignSystem, { priority: 32 });

  // Depth occlusion (Access: "Real occlusion"): real hands and objects in front
  // of the part hide it. Off by default until it has been checked on a headset;
  // without depth data the system does nothing.
  world.registerSystem(DepthSensingSystem, { configData: { enableOcclusion: true, enableDepthTexture: true } });
  const pivotEntity = world.createTransformEntity(bench.part.pivot, { parent: turntableEntity, persistent: true });
  effect(() => {
    const on = app.settings.value.occlusion;
    if (on && !pivotEntity.hasComponent(DepthOccludable)) pivotEntity.addComponent(DepthOccludable);
    if (!on && pivotEntity.hasComponent(DepthOccludable)) pivotEntity.removeComponent(DepthOccludable);
  });

  mountFlatUi(world, app, bench, sfx, codesign);

  // A join link (?room=123456) from a partner's QR code joins their room straight away.
  const room = codeFromUrl(location.search);
  if (room) {
    void codesign.join(room);
  }

  // Handy when testing from the browser console or an automated run.
  (globalThis as unknown as { astra: unknown }).astra = Object.assign(ctx, { probe });
});
