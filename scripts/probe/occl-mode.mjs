// Switches between plain occlusion and clash mode on the current view (debug aid). Mode from location.hash is not used; edit MODE.
const MODE = 'clash';
export default async function run({ page, frame }) {
  return (frame ?? page).evaluate(async (mode) => {
    const a = globalThis.astra;
    a.app.setSetting('clash', mode === 'clash');
    a.app.setSetting('occlusion', mode === 'occlusion');
    await new Promise((r) => setTimeout(r, 500));
    const ds = a.world.getSystems().find((s) => s.constructor.name === 'DepthSensingSystem');
    const sh = a.bench.part.mesh.material.userData.shader;
    return { mode, gpu: ds?.gpuDepthData?.length ?? null, enabled: sh?.uniforms?.occlusionEnabled?.value, near: sh?.uniforms?.uDepthNear?.value, raw: sh?.uniforms?.uRawValueToMeters?.value, isGpu: sh?.uniforms?.uIsGPUDepth?.value, tex: !!sh?.uniforms?.uXRDepthTextureArray?.value };
  }, MODE);
}
