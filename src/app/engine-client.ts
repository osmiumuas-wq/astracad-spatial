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
  Extract<Request, { type: 'solve' | 'reinforce' | 'grow' | 'export' | 'build' | 'slice' | 'flow' | 'modes' | 'views' | 'lattice' | 'template' }>,
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

/** Longest a single build may take before its worker is treated as hung. */
const BUILD_TIMEOUT_MS = 20000;
/** Worker replacements allowed in one session before the kernel is declared unusable. */
const MAX_RESTARTS = 3;

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

  /** Called when a worker died and was replaced; the app tells the user, the part is rebuilt. */
  onRecovered: (what: 'build' | 'analysis') => void = () => {};
  /** The last build asked for, kept so a replaced build worker can redo it. */
  private last: { job: string; params: Params; upTo?: number } | null = null;
  private buildStarted = 0;
  private restarts = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.wireBuilder();
    this.wireAnalysis();
    // A build normally takes milliseconds. One still running after this long has hung (or the
    // WebAssembly heap is gone): replace the worker and build again.
    if (typeof setInterval !== 'undefined') {
      this.watchdog = setInterval(() => {
        if (this.building && performance.now() - this.buildStarted > BUILD_TIMEOUT_MS) this.restartBuilder();
      }, 2000);
    }
  }

  private wireBuilder(): void {
    this.builderReady = false;
    this.builder.onmessage = (ev: MessageEvent<Response>) => this.fromBuilder(ev.data);
    this.builder.onerror = (ev) => {
      ev.preventDefault?.();
      // Before the first ready, or after repeated failures, the kernel cannot run here at all.
      if (!this.everReady || this.restarts >= MAX_RESTARTS) {
        this.onFatal(ev.message || 'The engine worker failed to start.');
        return;
      }
      this.restartBuilder();
    };
  }

  private everReady = false;

  /** Replace a crashed or hung build worker and redo the newest build. */
  private restartBuilder(): void {
    this.restarts++;
    this.builder.terminate();
    this.builder = spawn();
    this.building = false;
    this.wireBuilder();
    if (!this.wanted && this.last) this.wanted = { ...this.last, params: { ...this.last.params } };
    this.onRecovered('build');
  }

  private wireAnalysis(): void {
    this.analysisReady = false;
    this.analysis.onmessage = (ev: MessageEvent<Response>) => this.fromAnalysis(ev.data);
    this.analysis.onerror = (ev) => {
      ev.preventDefault?.();
      const error = new Error(ev.message || 'The analysis worker failed.');
      for (const p of this.pending.values()) {
        p.reject(error);
      }
      this.pending.clear();
      // A worker that threw may have a broken WebAssembly heap: start a clean one for the next job.
      this.analysis.terminate();
      this.analysisQueue = [];
      this.analysis = spawn();
      this.wireAnalysis();
      this.onRecovered('analysis');
    };
  }

  dispose(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.builder.terminate();
    this.analysis.terminate();
  }

  private fromBuilder(msg: Response): void {
    if (msg.type === 'ready') {
      this.builderReady = true;
      this.everReady = true;
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
    this.last = req;
    this.building = true;
    this.buildStarted = performance.now();
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
      msg.type === 'exported' ||
      msg.type === 'built' ||
      msg.type === 'sliced' ||
      msg.type === 'latticed' ||
      msg.type === 'templated' ||
      msg.type === 'flowed' ||
      msg.type === 'moded' ||
      msg.type === 'viewed'
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
