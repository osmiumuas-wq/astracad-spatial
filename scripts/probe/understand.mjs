// Sends free-form sentences the word rules do not know through runCommand and reports what the
// on-device language model made of them (debug aid).
import { existsSync, readFileSync } from 'node:fs';
export default async function run({ page, frame }) {
  const f = frame ?? page;
  const custom = existsSync('scripts/probe/understand.json') ? JSON.parse(readFileSync('scripts/probe/understand.json', 'utf8')) : null;
  const hosts = new Set();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  const out = await f.evaluate(async (custom) => {
    const a = globalThis.astra.app;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const res = [];
    for (const s of custom ?? [
      'something to stop my table wobbling, the leg is 30 across',
      'I want a box to keep my raspberry pi in, around 90 wide 65 deep and 30 tall',
      'handle for my kitchen drawer, the holes are 128 apart',
      'what is the weather tomorrow',
    ]) {
      const t0 = performance.now();
      const first = a.runCommand(s);
      for (let i = 0; i < 200 && a.notice.value?.text === first; i++) await wait(50);
      res.push({ s, first, then: a.notice.value?.text, job: a.jobId.value, params: a.params.value, ms: Math.round(performance.now() - t0) });
    }
    return res;
  }, custom);
  console.log(JSON.stringify({ out, hosts: [...hosts] }, null, 1));
  return out;
}
