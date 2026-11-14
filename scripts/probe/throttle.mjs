// Slows the managed browser's CPU for a while and samples the frame-rate governor (debug aid).
export default async function run({ page, frame }) {
  const f = frame ?? page;
  const cdp = await page.context().newCDPSession(page);
  const sample = () => f.evaluate(() => globalThis.astra.probe.perf);
  const out = { before: await sample() };
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 });
  await new Promise((r) => setTimeout(r, 9000));
  out.throttled = await sample();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await new Promise((r) => setTimeout(r, 3000));
  out.after = await sample();
  console.log(JSON.stringify(out));
  return out;
}
