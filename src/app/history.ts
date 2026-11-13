/**
 * Undo and redo for the part: job, every dimension and the material.
 *
 * A state is recorded once it settles: a handle drag or a dial twist is one
 * step, not one per frame. Anything that changes the part goes through the
 * same signals (handles, dial, sliders, fixes, Marcus, capture, sketch,
 * STEP import, a co-design partner), so all of it can be undone.
 */

import { effect, Signal, signal } from '@iwsdk/core';
import { Params } from '../engine/jobs.js';
import type { App } from './app.js';
import { partKey, SharedPart } from './codesign.js';

const SETTLE_MS = 350;
const LIMIT = 60;

export class History {
  readonly canUndo: Signal<boolean> = signal(false);
  readonly canRedo: Signal<boolean> = signal(false);
  private undoStack: SharedPart[] = [];
  private redoStack: SharedPart[] = [];
  private settled: SharedPart;
  private settledKey: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly stop: () => void;

  constructor(private readonly app: App) {
    this.settled = this.current();
    this.settledKey = partKey(this.settled);
    this.stop = effect(() => {
      void app.jobId.value;
      void app.params.value;
      void app.material.value;
      const dragging = app.dragging.value;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      // While a handle or dial is held the state is still moving.
      if (!dragging) this.timer = setTimeout(() => this.settleNow(), SETTLE_MS);
    });
  }

  private current(): SharedPart {
    return { job: this.app.jobId.peek(), params: { ...this.app.params.peek() } as Params, material: this.app.material.peek() };
  }

  /** Record the present state if it differs from the last recorded one. */
  settleNow(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const now = this.current();
    const key = partKey(now);
    if (key === this.settledKey) return;
    this.undoStack.push(this.settled);
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.settled = now;
    this.settledKey = key;
    this.refresh();
  }

  undo(): boolean {
    this.settleNow();
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.settled);
    this.restore(prev);
    return true;
  }

  redo(): boolean {
    this.settleNow();
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.settled);
    this.restore(next);
    return true;
  }

  private restore(s: SharedPart): void {
    // Mark it settled first, so the change it causes is not recorded as a new step.
    this.settled = s;
    this.settledKey = partKey(s);
    this.app.adoptShared(s);
    this.refresh();
  }

  private refresh(): void {
    this.canUndo.value = this.undoStack.length > 0;
    this.canRedo.value = this.redoStack.length > 0;
  }

  dispose(): void {
    this.stop();
    if (this.timer) clearTimeout(this.timer);
  }
}
