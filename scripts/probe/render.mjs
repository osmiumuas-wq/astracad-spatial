// Frame cost snapshot: draw calls, triangles, geometries and textures (debug aid).
export default async function run({ page, frame }) {
  return (frame ?? page).evaluate(async () => {
    const r = globalThis.astra.world.renderer;
    await new Promise((res) => setTimeout(res, 500));
    const i = r.info;
    const times = [];
    let last = performance.now();
    await new Promise((res) => {
      let n = 0;
      const tick = () => { const t = performance.now(); times.push(t - last); last = t; if (++n < 120) requestAnimationFrame(tick); else res(); };
      requestAnimationFrame(tick);
    });
    times.sort((a, b) => a - b);
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, frameMsMedian: +times[60].toFixed(2), frameMsP95: +times[114].toFixed(2), objects: (() => { let c = 0; globalThis.astra.world.scene.traverse(() => c++); return c; })() };
  });
}
