// Prints the world positions of the forearm filmstrip frames (debug aid).
export default async function run({ page, frame }) {
  const out = await (frame ?? page).evaluate(() => {
    const a = globalThis.astra;
    const strip = a.world.scene.getObjectByName('Forearm filmstrip');
    if (!strip || !strip.visible) return { visible: false };
    return { visible: true, frames: strip.children.filter((c) => c.visible).map((c) => { const v = c.getWorldPosition(new strip.position.constructor()); return [v.x, v.y, v.z].map((n) => +n.toFixed(4)); }) };
  });
  console.log(JSON.stringify(out));
  return out;
}
