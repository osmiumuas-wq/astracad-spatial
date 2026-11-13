// Per-system update cost over 240 frames, in ms per frame (debug aid).
export default async function run({ page, frame }) {
  return (frame ?? page).evaluate(async () => {
    const w = globalThis.astra.world;
    const cost = new Map();
    const restore = [];
    for (const s of w.getSystems()) {
      const name = s.constructor.name;
      const orig = s.update;
      if (typeof orig !== 'function') continue;
      s.update = function (...args) { const t = performance.now(); const r = orig.apply(this, args); cost.set(name, (cost.get(name) ?? 0) + performance.now() - t); return r; };
      restore.push(() => { s.update = orig; });
    }
    const r = w.renderer;
    const origRender = r.render.bind(r);
    let renderMs = 0;
    r.render = (...args) => { const t = performance.now(); origRender(...args); renderMs += performance.now() - t; };
    await new Promise((res) => { let n = 0; const tick = () => (++n < 240 ? requestAnimationFrame(tick) : res()); requestAnimationFrame(tick); });
    restore.forEach((f) => f());
    r.render = origRender;
    const per = [...cost.entries()].map(([k, v]) => [k, +(v / 240).toFixed(3)]).sort((a, b) => b[1] - a[1]);
    return { systemsMsPerFrame: per.slice(0, 12), totalSystems: +per.reduce((s, x) => s + x[1], 0).toFixed(3), renderMsPerFrame: +(renderMs / 240).toFixed(3) };
  });
}
