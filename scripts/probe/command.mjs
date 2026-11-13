// Runs one typed command in the app, as the voice layer would (debug aid).
export default async function run({ page, frame }) {
  return (frame ?? page).evaluate(async () => {
    const a = globalThis.astra.app;
    const reply = a.runCommand('wall bracket, 100 mm arm, 80 high, 30 wide, M5 screws, in PETG');
    await new Promise((r) => setTimeout(r, 1200));
    return { reply, second: a.runCommand('make the arm 20 mm longer') };
  });
}
