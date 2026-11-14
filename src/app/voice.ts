/**
 * Voice: say a command, hear the answer.
 *
 * Listening uses the browser's own speech recognition when it has one
 * (desktop Chrome, Edge). The Quest Browser has none, so there the
 * microphone is recorded until you stop talking and transcribed on the device
 * by Whisper (src/app/whisper.worker.ts). Replies are spoken with the
 * browser's speech synthesis when it has a voice, and always shown as text.
 */

import { Signal, signal } from '@iwsdk/core';

export type VoiceState = 'idle' | 'loading' | 'listening' | 'thinking' | 'unavailable';

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
}

const SAMPLE_RATE = 16000;
/** Stop recording after this much quiet once speech has started, s. */
const TAIL_S = 0.9;
const MAX_S = 9;

export class Voice {
  readonly state: Signal<VoiceState> = signal('idle');
  /** What was heard so far (interim, then final). */
  readonly heard = signal('');
  /** Model download progress, 0 to 100, while loading the on-device recogniser. */
  readonly loading = signal(0);
  speakReplies = true;

  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, (text: string) => void>();
  private stopRecording: (() => void) | null = null;

  /** Set when the browser's recogniser exists but cannot work (no speech service behind it). */
  private nativeBroken = false;

  /** Does this browser have a working recogniser of its own? */
  get native(): boolean {
    const w = globalThis as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    return !this.nativeBroken && Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
  }

  /** Listen for one sentence and return it ('' if nothing was understood). */
  async listen(): Promise<string> {
    if (this.state.peek() === 'listening') {
      this.stopRecording?.();
      return '';
    }
    this.heard.value = '';
    try {
      if (this.native) {
        try {
          return await this.listenNative();
        } catch (e) {
          // Some Chromium builds expose the API with no speech service behind it: use the device instead.
          if (e instanceof Error && /network|service|language/u.test(e.message)) {
            this.nativeBroken = true;
            return await this.listenOnDevice();
          }
          throw e;
        }
      }
      return await this.listenOnDevice();
    } catch (e) {
      this.state.value = 'idle';
      throw e;
    }
  }

  private listenNative(): Promise<string> {
    const w = globalThis as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as new () => Recognition;
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    return new Promise((resolve, reject) => {
      let final = '';
      rec.onresult = (ev) => {
        let text = '';
        for (let i = 0; i < ev.results.length; i++) {
          text += ev.results[i][0].transcript;
          if (ev.results[i].isFinal) final = text;
        }
        this.heard.value = text;
      };
      rec.onerror = (ev) => {
        this.state.value = 'idle';
        if (ev.error === 'no-speech' || ev.error === 'aborted') resolve('');
        else reject(new Error(ev.error === 'not-allowed' ? 'The microphone is blocked for this page.' : `Speech recognition: ${ev.error}`));
      };
      rec.onend = () => {
        this.state.value = 'idle';
        resolve((final || this.heard.peek()).trim());
      };
      this.stopRecording = () => rec.stop();
      this.state.value = 'listening';
      rec.start();
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    // The worker's name carries the app's base URL, so it finds the model shipped with the app.
    this.worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), {
      type: 'module',
      name: new URL(import.meta.env.BASE_URL, document.baseURI).href,
    });
    this.worker.onmessage = (ev: MessageEvent<{ type: string; id?: number; text?: string; progress?: number; message?: string }>) => {
      const m = ev.data;
      if (m.type === 'loading') {
        this.loading.value = Math.round(m.progress ?? 0);
      } else if (m.type === 'heard' && m.id !== undefined) {
        this.pending.get(m.id)?.(m.text ?? '');
        this.pending.delete(m.id);
      } else if (m.type === 'error') {
        if (m.id !== undefined) {
          this.pending.get(m.id)?.('');
          this.pending.delete(m.id);
        }
        this.state.value = 'idle';
      }
    };
    return this.worker;
  }

  /** Start fetching the on-device model before it is first needed. */
  warm(): void {
    if (!this.native) this.ensureWorker().postMessage({ type: 'warm' });
  }

  private async listenOnDevice(): Promise<string> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.state.value = 'unavailable';
      throw new Error('This browser gives the page no microphone.');
    }
    const worker = this.ensureWorker();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const audio = await this.record(stream);
    stream.getTracks().forEach((t) => t.stop());
    if (!audio.length) {
      this.state.value = 'idle';
      return '';
    }
    this.state.value = this.loading.peek() > 0 && this.loading.peek() < 100 ? 'loading' : 'thinking';
    const id = this.nextId++;
    const text = await new Promise<string>((resolve) => {
      this.pending.set(id, resolve);
      worker.postMessage({ type: 'hear', id, audio }, [audio.buffer]);
    });
    this.state.value = 'idle';
    // Whisper writes "[BLANK_AUDIO]" or "(music)" for silence and noise.
    const clean = text.replace(/\[[^\]]*\]|\([^)]*\)/gu, '').trim();
    this.heard.value = clean;
    return clean;
  }

  /** Record until a pause after speech (or the time limit), resampled to 16 kHz mono. */
  private record(stream: MediaStream): Promise<Float32Array> {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    const rate = ctx.sampleRate;
    let floor = 0.01;
    let speaking = false;
    let quiet = 0;
    let total = 0;
    this.state.value = 'listening';
    return new Promise((resolve) => {
      const finish = (): void => {
        proc.disconnect();
        source.disconnect();
        void ctx.close();
        this.stopRecording = null;
        resolve(speaking ? resample(chunks, rate, SAMPLE_RATE) : new Float32Array(0));
      };
      this.stopRecording = finish;
      proc.onaudioprocess = (ev) => {
        const data = ev.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const dt = data.length / rate;
        total += dt;
        if (!speaking) {
          // Learn the room's noise before the first word.
          floor = 0.9 * floor + 0.1 * rms;
          if (rms > Math.max(0.015, floor * 3)) speaking = true;
        }
        if (speaking) {
          chunks.push(new Float32Array(data));
          quiet = rms < Math.max(0.01, floor * 2) ? quiet + dt : 0;
        } else if (chunks.length < 3) {
          // Keep a little lead-in so the first syllable is not cut.
          chunks.push(new Float32Array(data));
        } else {
          chunks.shift();
          chunks.push(new Float32Array(data));
        }
        if ((speaking && quiet > TAIL_S) || total > MAX_S) finish();
      };
      source.connect(proc);
      proc.connect(ctx.destination);
    });
  }

  /** Say a reply aloud, if the browser can and replies are on. */
  speak(text: string): void {
    const synth = (globalThis as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    if (!this.speakReplies || !synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\bmm\b/gu, 'millimetres').replace(/\bx\b/gu, 'by'));
    u.rate = 1.05;
    synth.speak(u);
  }
}

/** Concatenate chunks and resample linearly to `to` Hz. */
export function resample(chunks: Float32Array[], from: number, to: number): Float32Array {
  const n = chunks.reduce((s, c) => s + c.length, 0);
  const all = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  if (from === to) return all;
  const out = new Float32Array(Math.floor((n * to) / from));
  const k = from / to;
  for (let i = 0; i < out.length; i++) {
    const x = i * k;
    const j = Math.floor(x);
    const t = x - j;
    out[i] = all[j] * (1 - t) + (all[Math.min(n - 1, j + 1)] ?? 0) * t;
  }
  return out;
}
