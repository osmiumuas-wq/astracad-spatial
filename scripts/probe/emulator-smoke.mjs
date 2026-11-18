// Deterministic WebXR smoke probe for the Meta Quest 3 IWER preset.
// Run through `iwsdk browser run`; this is emulator evidence, never a Quest benchmark.
export default async function run({ page, frame }) {
  return (frame ?? page).evaluate(async () => {
    const app = globalThis.astra?.app;
    const world = globalThis.astra?.world;
    if (!app || !world) throw new Error('AstraCAD app runtime is not ready');
    const session = world.renderer.xr.getSession?.();
    if (!session) throw new Error('No active IWER XR session; enter emulated XR first');

    const checks = [];
    const check = (id, pass, detail) => {
      checks.push({ id, pass, detail });
      if (!pass) throw new Error(`${id}: ${detail}`);
    };
    const waitForBuild = async (previous) => {
      const deadline = performance.now() + 30000;
      while (performance.now() < deadline) {
        if (app.engine.idle && app.built.value && app.built.value !== previous) return app.built.value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('A new geometry build did not complete within 30 seconds');
    };

    // Reset deterministic inputs so the same smoke can run repeatedly without hitting parameter clamps.
    let previousBuild = app.built.value;
    app.selectJob('wall-bracket');
    app.setMaterial('petg');
    app.setParams({ arm: 100, height: 80, w: 30, d: 9 });
    let built = await waitForBuild(previousBuild);
    check('wall-bracket-build', app.jobId.value === 'wall-bracket' && app.params.value.arm === 100,
      `job=${app.jobId.value}; arm=${app.params.value.arm}`);
    check('valid-solid', built.props.status === 'NoError' && built.props.volume > 0 && built.props.triangles > 0,
      `status=${built.props.status}; volume=${built.props.volume}; triangles=${built.props.triangles}`);

    const armKey = Object.hasOwn(app.params.value, 'arm') ? 'arm' : 'L';
    const beforeArm = app.params.value[armKey];
    previousBuild = app.built.value;
    const editReply = app.runCommand('make the arm 20 mm longer');
    const expectedArm = beforeArm + 20;
    const editDeadline = performance.now() + 30000;
    while (performance.now() < editDeadline && app.params.value[armKey] !== expectedArm) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (app.params.value[armKey] !== expectedArm) {
      throw new Error(`Parametric edit did not apply: ${armKey}=${app.params.value[armKey]}; reply=${editReply}`);
    }
    built = await waitForBuild(previousBuild);
    const afterArm = app.params.value[armKey];
    check('parametric-edit', Math.abs(afterArm - beforeArm - 20) < 1e-9,
      `${armKey}: ${beforeArm} -> ${afterArm}; reply=${editReply}`);
    check('truth-gate', built.gate.verdict === 'verified',
      `verdict=${built.gate.verdict}; checks=${built.gate.checks.map((c) => `${c.id}:${c.status}`).join(',')}`);

    const paramsBeforeFit = JSON.stringify(app.params.value);
    const fitReply = app.runCommand('fit view');
    const bbox = built.props.bbox;
    const footprint = Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[2] - bbox.min[2]);
    const expectedZoom = Math.max(0.3, Math.min(4, 208 / footprint));
    check('fit-view', fitReply.startsWith('Fit view:') && Math.abs(app.viewZoom.value - expectedZoom) < 1e-8,
      `${fitReply}; zoom=${app.viewZoom.value}; expected=${expectedZoom}`);
    check('fit-preserves-dimensions', JSON.stringify(app.params.value) === paramsBeforeFit,
      'fit view must change presentation scale, not CAD parameters');

    const enabledFeatures = [...(session.enabledFeatures ?? [])];
    const leftTracked = !!globalThis.astra.hands?.left?.tracked;
    const rightTracked = !!globalThis.astra.hands?.right?.tracked;
    check('emulated-hand-tracking', enabledFeatures.includes('hand-tracking') && leftTracked && rightTracked,
      `enabled=${enabledFeatures.includes('hand-tracking')}; left=${leftTracked}; right=${rightTracked}`);

    const intervals = [];
    const samples = [];
    let last;
    const until = performance.now() + 3600;
    await new Promise((resolve) => {
      const tick = (time) => {
        if (last !== undefined) samples.push(time - last);
        last = time;
        if (time < until) session.requestAnimationFrame(tick);
        else resolve();
      };
      session.requestAnimationFrame(tick);
    });
    intervals.push(...samples.filter((n) => Number.isFinite(n) && n > 0));
    const sorted = intervals.toSorted((a, b) => a - b);
    const quantile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
    const meanMs = intervals.reduce((sum, n) => sum + n, 0) / Math.max(1, intervals.length);
    const frameTiming = {
      sampleCount: intervals.length,
      sampleSeconds: +(intervals.reduce((sum, n) => sum + n, 0) / 1000).toFixed(2),
      meanFps: +(1000 / meanMs).toFixed(1),
      p50Ms: +quantile(0.50).toFixed(2),
      p95Ms: +quantile(0.95).toFixed(2),
      p99Ms: +quantile(0.99).toFixed(2),
      maxMs: +sorted.at(-1).toFixed(2),
      over13_89msPercent: +(100 * intervals.filter((n) => n > 1000 / 72).length / Math.max(1, intervals.length)).toFixed(1),
      targetHzForReference: 72,
      samplesMs: intervals.map((n) => +n.toFixed(2)),
    };

    return {
      test: 'astracad-iwer-xr-smoke',
      classification: 'simulated WebXR functional test; desktop frame timings are not Quest performance measurements',
      environment: {
        runtime: 'IWER via IWSDK development plugin',
        headsetPreset: 'Meta Quest 3',
        sessionMode: session.mode,
        enabledFeatures,
        userAgent: navigator.userAgent,
      },
      checks,
      geometry: {
        job: app.jobId.value,
        material: app.material.value,
        params: { ...app.params.value },
        verdict: built.gate.verdict,
        kernel: {
          status: built.props.status,
          volumeMm3: built.props.volume,
          triangles: built.props.triangles,
          components: built.props.components,
        },
        truthChecks: built.gate.checks.map(({ id, status, detail }) => ({ id, status, detail })),
      },
      fitView: { reply: fitReply, zoom: app.viewZoom.value, footprintMm: +footprint.toFixed(3) },
      frameTiming,
    };
  });
}
