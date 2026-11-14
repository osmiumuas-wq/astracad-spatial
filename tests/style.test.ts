import { describe, expect, it } from 'vitest';
import { styleOf, styleParams } from '../src/engine/style.js';
import { JOBS, Job, Params } from '../src/engine/jobs.js';

const find = (id: string): Job => JOBS.find((j) => j.id === id)!;
const defaults = (job: Job): Params => Object.fromEntries(job.params.map((d) => [d.id, d.value]));

describe('physics-guided style', () => {
  it('reads style words only when asked for a look', () => {
    expect(styleOf('make it sleek')).toBe('sleek');
    expect(styleOf('give it a chunky industrial look')).toBe('chunky');
    expect(styleOf('more rounded')).toBe('rounded');
    expect(styleOf('the arm is round')).toBeNull();
  });

  it('slims the walls and rounds the corners of a project box, within its ranges', () => {
    const job = find('project-box');
    const p = defaults(job);
    const s = styleParams(job, p, 'sleek');
    expect(s.r).toBeGreaterThan(p.r);
    for (const [id, v] of Object.entries(s)) {
      const d = job.params.find((q) => q.id === id)!;
      expect(v).toBeGreaterThanOrEqual(d.min);
      expect(v).toBeLessThanOrEqual(d.max);
    }
  });
});
