// Logs the shader programs three.js creates while a scripted sequence runs (the first-use compiles that cause
// hitches). Input: scripts/probe/hitch.json (same format as hitch.mjs).
import { readFileSync } from 'node:fs';

export default async function run({ page, frame }) {
  const { seconds = 8, steps = [] } = JSON.parse(readFileSync('scripts/probe/hitch.json', 'utf8'));
  return (frame ?? page).evaluate(async ({ ms, steps }) => {
    const x = globalThis.astra;
    const a = x.app;
    const r = x.world.renderer;
    const seen = new Set(r.info.programs.map((p) => p.cacheKey));
    const before = seen.size;
    const t0 = performance.now();
    const log = [];
    for (const [t, code] of steps) setTimeout(() => { log.push([+((performance.now() - t0) / 1000).toFixed(2), 'STEP ' + code.slice(-48)]); try { new Function('a', 'x', code)(a, x); } catch (e) { log.push(['err', String(e)]); } }, t * 1000);
    const s = r.xr.getSession?.();
    await new Promise((done) => {
      const tick = (now) => {
        for (const p of r.info.programs) {
          if (seen.has(p.cacheKey)) continue;
          seen.add(p.cacheKey);
          log.push([+((now - t0) / 1000).toFixed(2), `${p.name}  key:${p.cacheKey.slice(0, 120)}`]);
        }
        if (now - t0 < ms) (s ?? window).requestAnimationFrame(tick); else done();
      };
      (s ?? window).requestAnimationFrame(tick);
    });
    return { programsBefore: before, programsAfter: seen.size, log };
  }, { ms: seconds * 1000, steps });
}
