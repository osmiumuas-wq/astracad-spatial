// Profiles a window of frames while the app performs a scripted sequence (scheduled in the page), and reports
// the long frames and the functions with the most self time inside them.
// Input: scripts/probe/hitch.json {"seconds": 8, "steps": [[t_seconds, "js using a and x"], ...]}.
import { readFileSync } from 'node:fs';

export default async function run({ page, frame }) {
  const { seconds = 8, steps = [] } = JSON.parse(readFileSync('scripts/probe/hitch.json', 'utf8'));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
  await cdp.send('Profiler.start');
  const t0Wall = Date.now();
  const res = await (frame ?? page).evaluate(async ({ ms, steps }) => {
    const x = globalThis.astra;
    const a = x.app;
    for (const [t, code] of steps) setTimeout(() => { try { new Function('a', 'x', code)(a, x); } catch (e) { console.error(e); } }, t * 1000);
    const r = x.world.renderer;
    const s = r.xr.getSession?.();
    const frames = [];
    const origin = performance.timeOrigin;
    await new Promise((done) => {
      const t0 = performance.now();
      let last = t0;
      const tick = (now) => { frames.push([last, now - last]); last = now; if (now - t0 < ms) (s ?? window).requestAnimationFrame(tick); else done(); };
      (s ?? window).requestAnimationFrame(tick);
    });
    frames.shift();
    return { origin, t0: frames[0]?.[0] ?? 0, frames };
  }, { ms: seconds * 1000, steps });
  const { profile } = await cdp.send('Profiler.stop');
  // Map each profile sample to a page time and keep the samples inside long frames (> 40 ms).
  const long = res.frames.filter(([, d]) => d > 40).map(([start, d]) => [start, start + d]);
  const perfToProfile = (pt) => (res.origin + pt) * 1000; // microseconds, wall-clock based
  let tUs = profile.startTime;
  const offset = (t0Wall * 1000) - profile.startTime; // approx: profile clock to wall clock
  const self = new Map();
  profile.samples.forEach((id, i) => {
    tUs += profile.timeDeltas[i];
    const wall = tUs + offset;
    if (!long.some(([s, e]) => wall >= perfToProfile(s) - 5000 && wall <= perfToProfile(e) + 5000)) return;
    self.set(id, (self.get(id) || 0) + profile.timeDeltas[i]);
  });
  // Inclusive time by the nearest app (src/) frame on each sample's stack.
  const parentOf = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parentOf.set(c, n.id);
  const nodeById = new Map(profile.nodes.map((n) => [n.id, n]));
  const byApp = new Map();
  for (const [id, us] of self) {
    let cur = id;
    let label = '(no app frame)';
    let guard = 0;
    while (cur !== undefined && guard++ < 80) {
      const n = nodeById.get(cur);
      const u = n.callFrame.url || '';
      const i = u.indexOf('/src/');
      if (i >= 0) { label = `${n.callFrame.functionName || '(anon)'} ${u.slice(i + 5).split('?')[0]}:${n.callFrame.lineNumber + 1}`; break; }
      cur = parentOf.get(cur);
    }
    byApp.set(label, (byApp.get(label) || 0) + us);
  }
  const byFn = new Map();
  for (const n of profile.nodes) {
    const us = self.get(n.id) || 0;
    if (!us) continue;
    const f = n.callFrame;
    const key = `${f.functionName || '(anon)'} ${(f.url || '').split('/').pop().split('?')[0]}:${f.lineNumber + 1}`;
    byFn.set(key, (byFn.get(key) || 0) + us);
  }
  return {
    frames: res.frames.length,
    longFrames: long.length,
    longest: res.frames.map(([, d]) => d).sort((p, q) => q - p).slice(0, 8).map((d) => +d.toFixed(0)),
    longAt: res.frames.filter(([, d]) => d > 40).map(([s, d]) => [+((s - res.t0) / 1000).toFixed(2), +d.toFixed(0)]),
    appInLong: [...byApp.entries()].sort((p, q) => q[1] - p[1]).slice(0, 16).map(([k, v]) => [k, +(v / 1000).toFixed(1)]),
    hotInLong: [...byFn.entries()].sort((p, q) => q[1] - p[1]).slice(0, 18).map(([k, v]) => [k, +(v / 1000).toFixed(1)]),
  };
}
