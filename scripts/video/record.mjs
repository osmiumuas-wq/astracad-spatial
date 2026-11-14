// Records the managed emulator browser for a while, writing numbered JPEG frames and a timing file.
// Run with:
//   npx @iwsdk/cli browser run scripts/video/record.mjs
// Settings come from scripts/video/record.json:
//   { "out": "<folder>", "seconds": 20, "size": 1000, "dpr": 1.6, "fps": 30 }
// Frames are taken with Page.captureScreenshot on a fixed clock, which works even when the window
// is behind others (the screencast stops sending frames then). `size`/`dpr` enlarge and sharpen the
// view for the length of the recording only.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function run({ page }) {
  const cfg = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'video', 'record.json'), 'utf8'));
  mkdirSync(cfg.out, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  if (cfg.size) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: cfg.size, height: cfg.size, deviceScaleFactor: cfg.dpr ?? 1, mobile: false });
    await new Promise((r) => setTimeout(r, cfg.settle ?? 2500));
  }
  const fps = cfg.fps ?? 30;
  const times = [];
  const start = Date.now();
  let n = 0;
  while (Date.now() - start < cfg.seconds * 1000) {
    const due = start + (n * 1000) / fps;
    const wait = due - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const t = Date.now();
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, captureBeyondViewport: false });
    const name = `f${String(n).padStart(5, '0')}.jpg`;
    writeFileSync(join(cfg.out, name), Buffer.from(shot.data, 'base64'));
    times.push([name, (t - start) / 1000]);
    n++;
  }
  writeFileSync(join(cfg.out, 'times.json'), JSON.stringify({ times }));
  const span = (Date.now() - start) / 1000;
  return { frames: n, seconds: span, fps: n / span };
}
