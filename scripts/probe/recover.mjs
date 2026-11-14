// Exercises the reliability guards: replaces the build worker mid-session, fails the analysis
// worker, throws an uncaught error, then checks the part still rebuilds and a solve still runs.
export default async function run({ page, frame }) {
  const f = frame ?? page;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  out.before = await f.evaluate(() => globalThis.astra.app.built.value?.props.volume);
  await f.evaluate(() => {
    const e = globalThis.astra.app.engine;
    e.builder.terminate(); // a dead worker: nothing will answer
    e.building = true;
    e.buildStarted = performance.now() - 60000; // looks hung to the watchdog
  });
  await wait(4500);
  out.afterBuild = await f.evaluate(() => ({ notice: globalThis.astra.app.notice.value?.text, building: globalThis.astra.app.engine.building }));
  await f.evaluate(() => {
    const a = globalThis.astra.app;
    a.params.value = { ...a.params.value };
  });
  await wait(1500);
  out.rebuilt = await f.evaluate(() => globalThis.astra.app.built.value?.props.volume);
  await f.evaluate(() => globalThis.astra.app.engine.analysis.onerror({ message: 'probe crash', preventDefault() {} }));
  await wait(300);
  out.afterAnalysis = await f.evaluate(() => globalThis.astra.app.notice.value?.text);
  out.solve = await f.evaluate(async () => {
    const a = globalThis.astra.app;
    try {
      const built = a.built.value;
      const r = await a.engine.run({ type: 'views', job: a.jobId.value, params: a.params.value });
      return r.type;
    } catch (e) {
      return 'error: ' + e.message;
    }
  });
  await f.evaluate(() => setTimeout(() => { throw new Error('probe uncaught'); }));
  await wait(300);
  out.errors = await f.evaluate(() => globalThis.astra.probe.errors);
  out.lastNotice = await f.evaluate(() => globalThis.astra.app.notice.value?.text);
  console.log(JSON.stringify(out, null, 1));
  return out;
}
