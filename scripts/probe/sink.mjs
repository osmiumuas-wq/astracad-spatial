// Moves the bench so the bracket's lower part goes into the emulated floor (debug aid).
export default async function run({ page, frame }) {
  return (frame ?? page).evaluate(async () => {
    const a = globalThis.astra;
    a.bench.root.position.y = -0.06;
    a.bench.root.updateMatrixWorld(true);
    await new Promise((r) => setTimeout(r, 300));
    return { bench: a.bench.root.position.toArray().map((v) => +v.toFixed(3)) };
  });
}
