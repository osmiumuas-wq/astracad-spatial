import { signal } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { History } from '../src/app/history.js';
import type { App } from '../src/app/app.js';

/** The slice of App the history uses: three signals, the drag flag and adoptShared. */
function fakeApp() {
  const app = {
    jobId: signal('cradle'),
    params: signal<Record<string, number>>({ L: 75, W: 40 }),
    material: signal('pla'),
    dragging: signal(false),
    adoptShared(p: { job: string; params: Record<string, number>; material: string }) {
      app.jobId.value = p.job;
      app.params.value = { ...p.params };
      app.material.value = p.material;
    },
  };
  return app;
}

describe('undo and redo', () => {
  it('steps back and forward through settled states', () => {
    const app = fakeApp();
    const h = new History(app as unknown as App);
    app.params.value = { L: 80, W: 40 };
    h.settleNow();
    app.material.value = 'petg';
    h.settleNow();
    expect(h.canUndo.peek()).toBe(true);
    h.undo();
    expect(app.material.peek()).toBe('pla');
    expect(app.params.peek().L).toBe(80);
    h.undo();
    expect(app.params.peek().L).toBe(75);
    expect(h.canUndo.peek()).toBe(false);
    h.redo();
    h.redo();
    expect(app.params.peek().L).toBe(80);
    expect(app.material.peek()).toBe('petg');
    expect(h.canRedo.peek()).toBe(false);
    h.dispose();
  });

  it('records a whole drag as one step', () => {
    const app = fakeApp();
    const h = new History(app as unknown as App);
    app.dragging.value = true;
    for (let L = 76; L <= 90; L++) app.params.value = { L, W: 40 };
    app.dragging.value = false;
    h.settleNow();
    h.undo();
    expect(app.params.peek().L).toBe(75);
    h.dispose();
  });

  it('a new change after undo drops the redo branch', () => {
    const app = fakeApp();
    const h = new History(app as unknown as App);
    app.params.value = { L: 80, W: 40 };
    h.settleNow();
    h.undo();
    app.params.value = { L: 70, W: 40 };
    h.settleNow();
    expect(h.canRedo.peek()).toBe(false);
    h.undo();
    expect(app.params.peek().L).toBe(75);
    h.dispose();
  });
});
