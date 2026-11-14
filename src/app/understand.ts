/** Page side of the on-device language model (src/app/intent.worker.ts). */

import { decide, Understood } from '../engine/intents.js';

export class Understander {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, (u: Understood | null) => void>();

  private ensure(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./intent.worker.ts', import.meta.url), {
      type: 'module',
      name: new URL(import.meta.env.BASE_URL, document.baseURI).href,
    });
    this.worker.onmessage = (ev: MessageEvent<{ type: string; id?: number; scores?: { key: string; score: number }[] }>) => {
      const m = ev.data;
      if (m.id === undefined) return;
      const done = this.pending.get(m.id);
      if (!done) return;
      this.pending.delete(m.id);
      done(m.type === 'ranked' && m.scores ? decide(m.scores) : null);
    };
    this.worker.onerror = () => {
      for (const done of this.pending.values()) done(null);
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    return this.worker;
  }

  /** Load the model ahead of first use. */
  warm(): void {
    this.ensure().postMessage({ type: 'warm' });
  }

  /** What the sentence most likely means, or null if the model could not run. */
  understand(text: string): Promise<Understood | null> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.ensure().postMessage({ type: 'rank', id, text });
      // A model that never answers must not leave the user waiting.
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve(null);
        }
      }, 20000);
    });
  }
}
