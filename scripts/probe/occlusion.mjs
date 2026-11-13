// Turns the Real occlusion setting on and reports the depth system's state (debug aid).
export default async function run({ page, frame }) {
  return (frame ?? page).evaluate(async () => {
    const a = globalThis.astra;
    a.app.setSetting('occlusion', true);
    await new Promise((r) => setTimeout(r, 1500));
    const ds = a.world.getSystems().find((s) => s.constructor.name === 'DepthSensingSystem');
    const m = a.bench.part.mesh.material;
    return { occlusion: a.app.settings.value.occlusion, depthUsage: a.world.session?.depthUsage ?? null, gpu: ds?.gpuDepthData?.length ?? null, cpu: ds?.cpuDepthData?.length ?? null, transparent: m.transparent, key: m.customProgramCacheKey(), visible: a.bench.part.mesh.visible };
  });
}
