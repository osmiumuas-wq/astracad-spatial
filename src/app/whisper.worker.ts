/**
 * On-device speech recognition for browsers without the Web Speech API (the
 * Quest Browser among them): Whisper tiny (English), run by transformers.js
 * in WebAssembly inside this worker. The audio never leaves the device; only
 * the model (about 40 MB) is downloaded, once, and then cached by the browser.
 */

import { env, pipeline } from '@huggingface/transformers';

type Asr = (audio: Float32Array) => Promise<{ text: string } | { text: string }[]>;

env.allowLocalModels = false;

let asr: Promise<Asr> | null = null;

function load(): Promise<Asr> {
  asr ??= pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p: { status?: string; progress?: number }) => {
      if (p.status === 'progress' && typeof p.progress === 'number') {
        (self as unknown as Worker).postMessage({ type: 'loading', progress: p.progress });
      }
    },
  }) as unknown as Promise<Asr>;
  return asr;
}

self.onmessage = async (ev: MessageEvent<{ type: 'warm' } | { type: 'hear'; id: number; audio: Float32Array }>) => {
  const msg = ev.data;
  try {
    const run = await load();
    if (msg.type === 'warm') {
      (self as unknown as Worker).postMessage({ type: 'ready' });
      return;
    }
    const out = await run(msg.audio);
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text).trim();
    (self as unknown as Worker).postMessage({ type: 'heard', id: msg.id, text });
  } catch (e) {
    (self as unknown as Worker).postMessage({ type: 'error', id: 'id' in msg ? msg.id : -1, message: e instanceof Error ? e.message : String(e) });
  }
};
