/**
 * Page side of the engine workers.
 *
 * Two workers run the same script. The build worker answers geometry requests
 * and coalesces them (while a handle is dragged only the newest value is
 * built). The analysis worker runs stress solves, the reinforce loop and the
 * topology optimiser; cancelling means terminating it and starting a new one.
 */

import { Params } from '../engine/jobs.js';
import { Request, Response } from '../engine/protocol.js';

type Built = Extract<Response, { type: 'built' }>;
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type AnalysisRequest = DistributiveOmit<
  Extract<Request, { type: 'solve' | 'reinforce' | 'grow' | 'export' }>,
  'id'
>;

interface Pending {
  resolve: (r: Response) => void;
  reject: (e: Error) => void;
  onEvent?: (r: Response) => void;
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

const spawn = (): Worker =>
  new Worker(new URL('../engine/engine.worker.ts', import.meta.url), { type: 'module' });

export class EngineClient {
  private builder = spawn();
  private analysis = spawn();
  private nextId = 1;
  private builderReady = false;
  private building = false;
  private wanted: { job: string; params: Params; upTo?: number } | null = null;
  private pending = new Map<number, Pending>();
  private analysisReady = false;
  private analysisQueue: (() => void)[] = [];

  /** Called for every finished build (the newest request wins). */
  onBuilt: (built: Built) => void = () => {};
  /** Called when a build is refused; the message names the feature at fault. */
  onBuildError: (message: string) => void = () => {};
  /** Called once when the kernel cannot start at all. */
  onFatal: (message: string) => void = () => {};

  constructor() {
    this.builder.onmessage = (ev: MessageEvent<Response>) => this.fromBuilder(ev.data);
    this.builder.onerror = (ev) => this.onFatal(ev.message || 'The engine worker failed to start.');
    this.wireAnalysis();
  }

  private wireAnalysis(): void {
    this.analysisReady = false;
    this.analysis.onmessage = (ev: MessageEvent<Response>) => this.fromAnalysis(ev.data);
    this.analysis.onerror = (ev) => {
      const error = new Error(ev.message || 'The analysis worker failed.');
      for (const p of this.pending.values()) {
        p.reject(error);
      }
      this.pending.clear();
    };
  }

  private fromBuilder(msg: Response): void {
    if (msg.type === 'ready') {
      this.builderReady = true;
      this.pump();
      return;
    }
    if (msg.id === 0 && msg.type === 'error') {
      this.onFatal(msg.message);
      return;
    }
    if (msg.type === 'built') {
      this.building = false;
      // A newer request is waiting: this result is already stale, skip the upload.
      if (!this.wanted) {
        this.onBuilt(msg);
      }
      this.pump();
    } else if (msg.type === 'error') {
      this.building = false;
      if (!this.wanted) {
        this.onBuildError(msg.message);
      }
      this.pump();
    }
  }

  private pump(): void {
    if (!this.builderReady || this.building || !this.wanted) {
      return;
    }
    const req = this.wanted;
    this.wanted = null;
    this.building = true;
    const message: Request = { id: this.nextId++, type: 'build', ...req };
    this.builder.postMessage(message);
  }

  /** Ask for a build. Requests made while one is running replace each other. */
  requestBuild(job: string, params: Params, upTo?: number): void {
    this.wanted = { job, params: { ...params }, upTo };
    this.pump();
  }

  get idle(): boolean {
    return !this.building && !this.wanted;
  }

  private fromAnalysis(msg: Response): void {
    if (msg.type === 'ready') {
      this.analysisReady = true;
      this.analysisQueue.splice(0).forEach((send) => send());
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) {
      return;
    }
    if (msg.type === 'error') {
      this.pending.delete(msg.id);
      p.reject(new Error(msg.message));
    } else if (
      msg.type === 'solved' ||
      msg.type === 'reinforced' ||
      msg.type === 'grown' ||
      msg.type === 'exported'
    ) {
      this.pending.delete(msg.id);
      p.resolve(msg);
    } else {
      p.onEvent?.(msg);
    }
  }

  /** Run an analysis job. `onEvent` receives progress, steps and frames. */
  run<T extends Response['type']>(
    request: AnalysisRequest,
    onEvent?: (r: Response) => void,
    transfer: Transferable[] = [],
  ): Promise<Extract<Response, { type: T }>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (r: Response) => void,
        reject,
        onEvent,
      });
      const send = (): void => this.analysis.postMessage({ id, ...request } as Request, transfer);
      if (this.analysisReady) {
        send();
      } else {
        this.analysisQueue.push(send);
      }
    });
  }

  /** Stop whatever the analysis worker is doing. Pending jobs reject with CancelledError. */
  cancelAnalysis(): void {
    if (this.pending.size === 0 && this.analysisQueue.length === 0) {
      return;
    }
    this.analysis.terminate();
    for (const p of this.pending.values()) {
      p.reject(new CancelledError());
    }
    this.pending.clear();
    this.analysisQueue = [];
    this.analysis = spawn();
    this.wireAnalysis();
  }

  get analysing(): boolean {
    return this.pending.size > 0;
  }
}
