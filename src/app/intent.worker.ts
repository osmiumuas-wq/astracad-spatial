/**
 * On-device language model for free-form sentences: all-MiniLM-L6-v2 (a
 * sentence-embedding transformer, 23 MB, int8) run by transformers.js in
 * WebAssembly. It embeds the intent catalogue once, then each sentence, and
 * returns the best similarity per intent. The model and runtime are served
 * with the app (public/models, public/ort), so it works offline; nothing
 * leaves the device.
 */

import { env, pipeline } from '@huggingface/transformers';
import { catalogue } from '../engine/intents.js';

type Embed = (texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

const base = self.name || new URL('../../', self.location.href).href;
env.allowLocalModels = true;
env.localModelPath = new URL('models/', base).href;
env.allowRemoteModels = true;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = new URL('ort/', base).href;

const phrases = catalogue();
let ready: Promise<{ embed: Embed; cat: number[][] }> | null = null;

function load(): Promise<{ embed: Embed; cat: number[][] }> {
  ready ??= (async () => {
    const embed = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8', device: 'wasm' })) as unknown as Embed;
    const cat = (await embed(phrases.map((p) => p.text), { pooling: 'mean', normalize: true })).tolist();
    return { embed, cat };
  })();
  return ready;
}

self.onmessage = async (ev: MessageEvent<{ type: 'warm' } | { type: 'rank'; id: number; text: string }>) => {
  const msg = ev.data;
  try {
    const { embed, cat } = await load();
    if (msg.type === 'warm') {
      (self as unknown as Worker).postMessage({ type: 'ready' });
      return;
    }
    const [v] = (await embed([msg.text], { pooling: 'mean', normalize: true })).tolist();
    const best = new Map<string, number>();
    cat.forEach((c, i) => {
      let s = 0;
      for (let j = 0; j < c.length; j++) s += c[j] * v[j];
      const k = phrases[i].key;
      if (!best.has(k) || (best.get(k) as number) < s) best.set(k, s);
    });
    (self as unknown as Worker).postMessage({ type: 'ranked', id: msg.id, scores: [...best].map(([key, score]) => ({ key, score })) });
  } catch (e) {
    (self as unknown as Worker).postMessage({ type: 'error', id: 'id' in msg ? msg.id : -1, message: e instanceof Error ? e.message : String(e) });
  }
};
