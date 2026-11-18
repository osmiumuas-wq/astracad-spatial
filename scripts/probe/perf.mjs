// Frame-time probe for the running app (managed browser, IWSDK `browser run`): optionally slows the CPU with
// Chrome DevTools' CPU throttling, then samples frame intervals and the renderer's per-frame draw calls and
// triangles for a few seconds. An uncalibrated desktop proxy for Quest performance, not a device measurement.
// Input: scripts/probe/perf.json {"rate": 4, "seconds": 6}.
import { readFileSync } from 'node:fs';

export default async function run({ page, frame }) {
  const { rate = 1, seconds = 6 } = JSON.parse(readFileSync('scripts/probe/perf.json', 'utf8'));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  try {
    return await (frame ?? page).evaluate(async (ms) => {
      const x = globalThis.astra;
      const r = x.world.renderer;
      const session = r.xr.getSession?.();
      const times = [];
      let calls = 0;
      let tris = 0;
      let n = 0;
      await new Promise((done) => {
        const t0 = performance.now();
        let last = t0;
        const tick = (t) => {
          const now = typeof t === 'number' ? t : performance.now();
          times.push(now - last);
          last = now;
          calls += r.info.render.calls;
          tris += r.info.render.triangles;
          n++;
          if (now - t0 < ms) (session ?? window).requestAnimationFrame(tick);
          else done();
        };
        (session ?? window).requestAnimationFrame(tick);
      });
      times.shift();
      const s = [...times].sort((a, b) => a - b);
      const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
      return {
        xr: !!session,
        frames: times.length,
        fps: +(1000 / (times.reduce((a, b) => a + b, 0) / times.length)).toFixed(1),
        p50ms: +q(0.5).toFixed(2),
        p95ms: +q(0.95).toFixed(2),
        worstMs: +s[s.length - 1].toFixed(2),
        drawCalls: Math.round(calls / n),
        triangles: Math.round(tris / n),
        geometries: r.info.memory.geometries,
        textures: r.info.memory.textures,
      };
    }, seconds * 1000);
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
}
