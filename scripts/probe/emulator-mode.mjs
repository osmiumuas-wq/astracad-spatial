// Read the active CAD mode for the deterministic IWER smoke runner.
export default async function run({ page, frame }) {
  return (frame ?? page).evaluate(() => ({ mode: globalThis.astra?.app?.mode?.value ?? null }));
}
