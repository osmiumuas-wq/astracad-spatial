// Builds each part made with fillet + shell, sweep and loft, runs its load test, and reports the
// gate verdict, volume and safety factor (debug aid).
export default async function run({ page, frame }) {
  const f = frame ?? page;
  const out = await f.evaluate(async () => {
    const a = globalThis.astra.app;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const res = {};
    for (const id of ['project-box', 'pull-handle', 'tapered-foot']) {
      a.selectJob(id);
      for (let i = 0; i < 40 && !(a.built.value && a.jobId.value === id && a.engine.idle); i++) await wait(100);
      await wait(300);
      const b = a.built.value;
      const t0 = performance.now();
      let tested = null;
      try {
        tested = await a.runTest();
      } catch (e) {
        tested = 'error ' + e.message;
      }
      const s = a.stress.value;
      res[id] = {
        verdict: b?.gate.verdict,
        checks: b?.gate.checks.map((c) => `${c.id}:${c.status}`).join(' '),
        volume: Math.round(b?.props.volume * 1000) / 1000,
        tested,
        factor: a.factor(),
        p99: s?.stressP99,
        solveMs: Math.round(performance.now() - t0),
      };
    }
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
  return out;
}
