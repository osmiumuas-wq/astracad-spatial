// Prints the live XR sub-camera projection half-angles (debug aid).
export default async function run({ page, frame }) {
  const out = await (frame ?? page).evaluate(() => {
    const w = globalThis.astra.world;
    const cams = w.renderer.xr.getCamera().cameras ?? [];
    const deg = (t) => Math.round((Math.atan(t) * 180) / Math.PI);
    return cams.map((c) => { const e = c.projectionMatrix.elements; return { up: deg((1 + e[9]) / e[5]), down: deg((1 - e[9]) / e[5]), left: deg((1 - e[8]) / e[0]), right: deg((1 + e[8]) / e[0]) }; });
  });
  console.log(JSON.stringify(out));
  return out;
}
