// Brings the managed emulator window to the front and sizes it for recording (W x H outer pixels
// from the environment, default 1180 x 1280), then reports the page's inner size (debug aid).
export default async function run({ page }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.bringToFront');
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: Number(process.env.WW || 1180), height: Number(process.env.WH || 1280) } });
  await new Promise((r) => setTimeout(r, 1500));
  return page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
}
