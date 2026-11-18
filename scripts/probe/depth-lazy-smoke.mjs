// Verify optional depth-system lifecycle and collect emulator-only frame timings.
// Run against an active IWER XR session with `iwsdk browser run`.
export default async function run({ page, frame }) {
  return (frame ?? page).evaluate(async () => {
    const a = globalThis.astra;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const depthSystem = () => a.world.getSystems().find((s) => s.constructor.name === 'DepthSensingSystem');
    const original = {
      occlusion: a.app.settings.peek().occlusion,
      clash: a.app.settings.peek().clash,
    };
    const measure = async (seconds = 6) => {
      const session = a.world.renderer.xr.getSession?.();
      if (!session) throw new Error('XR session ended during depth-toggle smoke');
      const times = [];
      let last;
      await new Promise((done) => {
        const start = performance.now();
        const tick = (time) => {
          if (last !== undefined) times.push(time - last);
          last = time;
          if (time - start < seconds * 1000) session.requestAnimationFrame(tick);
          else done();
        };
        session.requestAnimationFrame(tick);
      });
      const sorted = [...times].sort((x, y) => x - y);
      return {
        frames: times.length,
        fps: +(1000 / (times.reduce((sum, x) => sum + x, 0) / times.length)).toFixed(1),
        p95ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
        worstMs: +sorted[sorted.length - 1].toFixed(2),
      };
    };

    try {
      a.app.setSetting('occlusion', false);
      a.app.setSetting('clash', false);
      await wait(250);
      const offState = {
        settings: { ...a.app.settings.peek() },
        systemActive: !!depthSystem(),
        session: !!a.world.session,
      };
      if (offState.systemActive || !offState.session) {
        throw new Error('depth system did not start idle in active XR');
      }
      const off = await measure();

      a.app.setSetting('clash', true);
      await wait(500);
      const clashSystem = depthSystem();
      const clashState = {
        clash: a.app.settings.peek().clash,
        occlusion: a.app.settings.peek().occlusion,
        systemActive: !!clashSystem,
        eligibleOccludables: clashSystem?.queries.occludables.entities.size ?? 0,
        session: !!a.world.session,
      };
      if (!clashSystem || clashState.eligibleOccludables !== 1 || !clashState.session) {
        throw new Error(`clash check did not activate depth correctly: ${JSON.stringify(clashState)}`);
      }
      const clash = await measure();
      a.app.setSetting('clash', false);
      await wait(250);
      if (depthSystem() || !a.world.session) {
        throw new Error('depth system did not stop after clash check was disabled');
      }

      a.app.setSetting('occlusion', true);
      await wait(500);
      const system = depthSystem();
      const onState = {
        occlusion: a.app.settings.peek().occlusion,
        systemActive: !!system,
        eligibleOccludables: system?.queries.occludables.entities.size ?? 0,
        depthUsage: a.world.session?.depthUsage ?? null,
        session: !!a.world.session,
      };
      if (!system || onState.eligibleOccludables !== 1 || !onState.session) {
        throw new Error(`depth feature did not activate correctly: ${JSON.stringify(onState)}`);
      }
      const on = await measure();

      a.app.setSetting('occlusion', false);
      await wait(250);
      const offAgainState = {
        occlusion: a.app.settings.peek().occlusion,
        systemActive: !!depthSystem(),
        session: !!a.world.session,
      };
      if (offAgainState.systemActive || !offAgainState.session) {
        throw new Error('depth system did not stop after feature was disabled');
      }
      const offAgain = await measure();
      return { offState, off, clashState, clash, onState, on, offAgainState, offAgain };
    } finally {
      a.app.setSetting('occlusion', original.occlusion);
      a.app.setSetting('clash', original.clash);
      await wait(250);
    }
  });
}
