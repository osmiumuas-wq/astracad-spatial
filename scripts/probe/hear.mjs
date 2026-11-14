// Runs artifacts/voice/say.json (16 kHz mono samples) through the on-device recogniser and
// lists every network host the page contacted on the way (debug aid).
import { readFileSync } from 'node:fs';
export default async function run({ page, frame }) {
  const f = frame ?? page;
  const hosts = new Set();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  const samples = JSON.parse(readFileSync('artifacts/voice/say.json', 'utf8'));
  const t0 = Date.now();
  const text = await f.evaluate(async (s) => {
    const v = globalThis.astra.voice;
    const w = v.ensureWorker();
    return new Promise((res) => {
      const prev = w.onmessage;
      w.onmessage = (ev) => {
        prev?.(ev);
        if (ev.data.type === 'heard') res(ev.data.text);
        if (ev.data.type === 'error') res('ERROR ' + ev.data.message);
      };
      w.postMessage({ type: 'hear', id: 999, audio: new Float32Array(s) });
    });
  }, samples);
  const out = { text, seconds: (Date.now() - t0) / 1000, hosts: [...hosts] };
  console.log(JSON.stringify(out));
  return out;
}
