/**
 * AstraCAD Spatial entry point: create the IWSDK world from the project
 * manifest, build the bench, and register the systems.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { App } from './app/app.js';
import { Bench } from './app/bench.js';
import { ctx, probe } from './app/context.js';
import { Hands } from './app/hands.js';
import { Sfx } from './app/sfx.js';
import { mountFlatUi } from './flat/flat-ui.js';
import { InteractionSystem } from './systems/interaction-system.js';
import { PartSystem } from './systems/part-system.js';
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

  Object.assign(ctx, {
    world,
    app,
    bench,
    hands: new Hands(),
    sfx,
    benchEntity,
    turntableEntity,
  });

  world.registerSystem(InteractionSystem, { priority: 5 });
  world.registerSystem(UiSystem, { priority: 6 });
  world.registerSystem(PartSystem, { priority: 20 });
  world.registerSystem(WorkspaceSystem, { priority: 30 });

  mountFlatUi(world, app, bench, sfx);

  // Handy when testing from the browser console or an automated run.
  (globalThis as unknown as { astra: unknown }).astra = Object.assign(ctx, { probe });
});
