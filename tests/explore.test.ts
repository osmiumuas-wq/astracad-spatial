import { describe, expect, it } from 'vitest';
import { exploreAxes, paretoFront, variants } from '../src/engine/explore.js';
import { JOBS, Job, Params } from '../src/engine/jobs.js';

const find = (id: string): Job => JOBS.find((j) => j.id === id)!;
const defaults = (job: Job): Params => Object.fromEntries(job.params.map((d) => [d.id, d.value]));

describe('explore', () => {
  it('varies the two most effective structural parameters of the wall bracket', () => {
    const job = find('wall-bracket');
    expect(exploreAxes(job)).toEqual(['g', 't']);
    const vs = variants(job, defaults(job));
    expect(vs.length).toBe(6);
    for (const v of vs) {
      for (const d of job.params) {
        expect(v.params[d.id]).toBeGreaterThanOrEqual(d.min);
        expect(v.params[d.id]).toBeLessThanOrEqual(d.max);
      }
    }
    // The current design is one of them.
    const base = defaults(job);
    expect(vs.some((v) => v.params.g === base.g && v.params.t === base.t)).toBe(false);
    expect(new Set(vs.map((v) => `${v.params.g}|${v.params.t}`)).size).toBe(6);
  });

  it('keeps only variants no other beats on both mass and safety factor', () => {
    const front = paretoFront([
      { mass: 10, factor: 1 },
      { mass: 12, factor: 3 },
      { mass: 12, factor: 2 }, // beaten by the one before
      { mass: 20, factor: 3 }, // beaten: heavier, same factor
      { mass: 25, factor: 5 },
    ]);
    expect(front).toEqual([0, 1, 4]);
  });
});
