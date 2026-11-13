// Turns the clash check on and sinks the bench into the emulated desk so the part meets real geometry (debug aid).
export default async function run({ page, frame }) {
  return (frame ?? page).evaluate(async () => {
    const a = globalThis.astra;
    a.app.selectJob('wall-bracket');
    for (let i = 0; i < 40 && !(a.app.built.value && a.app.jobId.value === 'wall-bracket'); i++) await new Promise((r) => setTimeout(r, 100));
    a.app.setSetting('clash', true);
    a.bench.part.setZoom(2.5);
    await new Promise((r) => setTimeout(r, 800));
    const m = a.bench.part.mesh.material;
    const sh = m.userData.shader;
    return {
      key: m.customProgramCacheKey(),
      patched: !!sh && sh.fragmentShader.includes('uClash'),
      clashUniform: sh?.uniforms?.uClash?.value ?? null,
      occlusion: sh?.uniforms?.occlusionEnabled?.value ?? null,
      bench: a.bench.root.position.toArray().map((v) => +v.toFixed(3)),
    };
  });
}
