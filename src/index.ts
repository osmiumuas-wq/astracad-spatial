/**
 * AstraCAD Spatial entry point: create the IWSDK world from the project
 * manifest, build the bench, and register the systems.
 */

import { DepthOccludable, DepthSensingSystem, effect, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { App } from './app/app.js';
import { Bench } from './app/bench.js';
import { CoDesign, codeFromUrl } from './app/codesign.js';
import { Voice } from './app/voice.js';
import { ctx, probe } from './app/context.js';
import { CoDesignSystem } from './systems/codesign-system.js';
import { Hands } from './app/hands.js';
import { Sfx } from './app/sfx.js';
import { mountFlatUi } from './flat/flat-ui.js';
import { CaptureSystem } from './systems/capture-system.js';
import { FlowSystem } from './systems/flow-system.js';
import { PerfSystem } from './systems/perf-system.js';
import { DrawingSystem } from './systems/drawing-system.js';
import { HingeSystem } from './systems/hinge-system.js';
import { LaserSystem } from './systems/laser-system.js';
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

  // Reliability: nothing fails silently. An unexpected error is shown once (not a stream of them),
  // kept for the debug probe, and the session carries on; the part and shelf are untouched.
  let lastErrorAt = -Infinity;
  const report = (what: unknown): void => {
    const text = what instanceof Error ? what.message : String(what ?? 'unknown');
    if (/cancelled/i.test(text)) return;
    const errors = (probe.errors as string[] | undefined) ?? [];
    probe.errors = errors;
    if (errors.length < 20) errors.push(text);
    if (performance.now() - lastErrorAt > 15000) {
      lastErrorAt = performance.now();
      app.say('Something went wrong in the background. Your part is safe; try that step again.', 'warn');
    }
  };
  window.addEventListener('error', (ev) => report(ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', (ev) => report(ev.reason));
  // Offline: the service worker (written at build time by scripts/sw-plugin.mjs) keeps the app
  // and, after first use, the speech model on the device. Not in development, where it would
  // serve stale modules.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Without it the app still runs; it just needs the network to load.
    });
  }
  // The headset can take the graphics context back (memory pressure, a system overlay). Three.js
  // restores it; the user is told why the view blinked.
  const canvas = world.renderer.domElement;
  canvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    app.say('The headset paused the graphics. Restoring the view...', 'warn');
  });
  canvas.addEventListener('webglcontextrestored', () => app.say('View restored.', 'good'));

  // Flat-page placement; an immersive session re-places the bench at the user's hands.
  bench.root.position.set(0.06, 1.0, -0.5);
  const benchEntity = world.createTransformEntity(bench.root, { persistent: true });
  const turntableEntity = world.createTransformEntity(bench.turntable, {
    parent: benchEntity,
    persistent: true,
  });

  const codesign = new CoDesign(app);
  const voice = new Voice();
  // Replies are spoken for a minute after the user last talked; otherwise they are only shown.
  let talkedAt = -Infinity;
  app.speakReply = (text) => {
    if (performance.now() - talkedAt < 60000) voice.speak(text);
  };
  const talk = async (): Promise<void> => {
    try {
      sfx.play('select');
      const text = await voice.listen();
      if (!text) return;
      talkedAt = performance.now();
      const reply = app.runCommand(text);
      voice.speak(reply);
    } catch (e) {
      app.say(e instanceof Error ? e.message : String(e), 'warn');
    }
  };
  Object.assign(ctx, {
    voice,
    talk,
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
  world.registerSystem(LaserSystem, { priority: 9 });
  world.registerSystem(SketchSystem, { priority: 7 });
  world.registerSystem(CaptureSystem, { priority: 8 });
  world.registerSystem(WorkspaceSystem, { priority: 30 });
  world.registerSystem(CoDesignSystem, { priority: 32 });
  world.registerSystem(PerfSystem, { priority: 33 });

  // Actions that voice and typed commands can trigger in systems.
  Object.assign(app.actions, {
    flow: () => world.getSystem(FlowSystem)?.toggle(),
    vibration: () => world.getSystem(ModeSystem)?.toggle(),
    drawing: () => void world.getSystem(DrawingSystem)?.toggle(),
    print: () => world.getSystem(PrintSystem)?.toggle(),
    swing: () => world.getSystem(HingeSystem)?.toggle(),
    explode: () => world.getSystem(HingeSystem)?.explode(),
  });

  // Depth occlusion (Access: "Real occlusion"): real hands and objects in front
  // of the part hide it. Off by default until it has been checked on a headset;
  // without depth data the system does nothing.
  world.registerSystem(DepthSensingSystem, { configData: { enableOcclusion: true, enableDepthTexture: true } });
  const pivotEntity = world.createTransformEntity(bench.part.pivot, { parent: turntableEntity, persistent: true });
  effect(() => {
    const s = app.settings.value;
    // Clash check needs the same depth data; it shows hidden parts in red instead of hiding them.
    const on = s.occlusion || s.clash;
    bench.part.setClash(s.clash);
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
