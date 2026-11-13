// Swings the hinge in the running app and reports the contact angle (debug aid).
export default async function run({ page, frame }) {
  return (frame ?? page).evaluate(async () => {
    const a = globalThis.astra;
    a.app.selectJob('hinge');
    for (let i = 0; i < 40 && !(a.app.built.value && a.app.jobId.value === 'hinge' && a.app.built.value.features.length > 20); i++) await new Promise((r) => setTimeout(r, 100));
    a.bench.part.setZoom(2.2);
    const hs = a.world.getSystems().find((s) => s.constructor.name === 'HingeSystem');
    hs.toggle();
    await new Promise((r) => setTimeout(r, 1900));
    return { gate: a.app.built.value.gate.verdict, checks: a.app.built.value.gate.checks.map((c) => `${c.id}:${c.status}`), hinge: a.probe.hinge, notice: a.app.notice.value?.text };
  });
}
