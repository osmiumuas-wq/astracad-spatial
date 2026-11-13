// Loads the wall bracket, runs its load test and raises the load close to yield (debug aid for the heat glow).
export default async function run({ page, frame }) {
  return (frame ?? page).evaluate(async () => {
    const a = globalThis.astra;
    a.app.selectJob('wall-bracket');
    for (let i = 0; i < 50 && !(a.app.built.value && a.app.jobId.value === 'wall-bracket'); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 600));
    a.app.mode.value = 'test';
    await a.app.runTest();
    const s = a.app.stress.value;
    const yieldMPa = a.app.materialData.yield;
    // Load at which the peak reaches 85 % of yield.
    a.app.setLoad((0.85 * yieldMPa * s.newtons) / s.stressP99);
    a.bench.part.setZoom(2.2);
    await new Promise((r) => setTimeout(r, 800));
    return { load: a.app.loadN.value, factor: a.app.factor() };
  });
}
