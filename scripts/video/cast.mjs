// Records the managed emulator window with the DevTools screencast (fast while the window is in
// front; see front.mjs). Settings from scripts/video/record.json: { "out", "seconds" }.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function run({ page }) {
  const cfg = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'video', 'record.json'), 'utf8'));
  mkdirSync(cfg.out, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const times = [];
  let n = 0;
  let t0 = null;
  cdp.on('Page.screencastFrame', async (ev) => {
    const name = `f${String(n).padStart(5, '0')}.jpg`;
    writeFileSync(join(cfg.out, name), Buffer.from(ev.data, 'base64'));
    t0 ??= ev.metadata.timestamp;
    times.push([name, ev.metadata.timestamp - t0]);
    n++;
    // Keep the timing file current, so a take that is cut short still has its clock.
    if (n % 60 === 0) writeFileSync(join(cfg.out, 'times.json'), JSON.stringify({ times }));
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId });
    } catch {
      // stopping
    }
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  await new Promise((r) => setTimeout(r, cfg.seconds * 1000));
  await cdp.send('Page.stopScreencast');
  writeFileSync(join(cfg.out, 'times.json'), JSON.stringify({ times }));
  return { frames: n, fps: n / cfg.seconds };
}
