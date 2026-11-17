// CPU-profile the running app for a few seconds (Chrome's sampling profiler) and list the functions with the
// most self time, plus long frames. Input: scripts/probe/cpuprof.json {"seconds": 5}.
import { readFileSync } from 'node:fs';

export default async function run({ page, frame }) {
  const { seconds = 5 } = JSON.parse(readFileSync('scripts/probe/cpuprof.json', 'utf8'));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  const frames = await (frame ?? page).evaluate(async (ms) => {
    const r = globalThis.astra.world.renderer;
    const s = r.xr.getSession?.();
    const t = [];
    await new Promise((done) => {
      const t0 = performance.now();
      let last = t0;
      const tick = (now) => { t.push(now - last); last = now; if (now - t0 < ms) (s ?? window).requestAnimationFrame(tick); else done(); };
      (s ?? window).requestAnimationFrame(tick);
    });
    t.shift();
    return t;
  }, seconds * 1000);
  const { profile } = await cdp.send('Profiler.stop');
  const dt = new Map();
  profile.timeDeltas.forEach((d, i) => dt.set(profile.samples[i], (dt.get(profile.samples[i]) || 0) + d));
  const self = new Map();
  for (const n of profile.nodes) {
    const us = dt.get(n.id) || 0;
    if (!us) continue;
    const f = n.callFrame;
    const file = (f.url || '').split('/').pop().split('?')[0];
    const key = `${f.functionName || '(anon)'} ${file}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + us);
  }
  // Who calls the hot functions: the first ancestor frame from the app's own source (src/).
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n);
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const callers = new Map();
  for (const n of profile.nodes) {
    const us = dt.get(n.id) || 0;
    if (!us || !/^(getParameters|getProgram|needsUpdate|getParameter|setup|setProgram)$/.test(n.callFrame.functionName)) continue;
    let p = parent.get(n.id);
    const chain = [];
    while (p && chain.length < 5) {
      const u = (p.callFrame.url || '').split('/').pop().split('?')[0];
      chain.push(`${p.callFrame.functionName || '(anon)'}@${u}:${p.callFrame.lineNumber + 1}`);
      p = parent.get(p.id);
    }
    const key = `${n.callFrame.functionName} <- ${chain.join(' < ')}`;
    callers.set(key, (callers.get(key) || 0) + us);
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 28).map(([k, v]) => [k, +(v / 1000 / frames.length).toFixed(3)]);
  const sorted = [...frames].sort((a, b) => a - b);
  return {
    frames: frames.length,
    msPerFrameSampled: +(total / 1000 / frames.length).toFixed(2),
    p50: +sorted[Math.floor(sorted.length / 2)].toFixed(1),
    over50ms: frames.filter((x) => x > 50).length,
    worst: +sorted[sorted.length - 1].toFixed(1),
    topSelfMsPerFrame: top,
    hotCallers: [...callers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, +(v / 1000 / frames.length).toFixed(3)]),
  };
}
