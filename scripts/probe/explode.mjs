// Loads the hinge, zooms in and explodes it (debug aid).
export default async function run({ page, frame }) {
  return (frame ?? page).evaluate(async () => {
    const a = globalThis.astra;
    a.app.selectJob('hinge');
    for (let i = 0; i < 40 && !(a.app.built.value && a.app.jobId.value === 'hinge' && a.app.built.value.features.length > 20); i++) await new Promise((r) => setTimeout(r, 100));
    a.bench.part.setZoom(2.4);
    const reply = a.app.runCommand('pull it apart');
    await new Promise((r) => setTimeout(r, 1500));
    return { reply };
  });
}
