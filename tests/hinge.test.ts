import { beforeAll, describe, expect, it } from 'vitest';
import { expectVolume } from '../src/engine/expect.js';
import { defaultParams, hingeGeometry, hingeLimit, jobById } from '../src/engine/jobs.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { runGate } from '../src/engine/truth.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

describe('print-in-place hinge', () => {
  const job = jobById('hinge');

  it('builds two bodies that pass the truth gate', () => {
    for (const change of [{}, { L: 80, W: 40, t: 6, c: 0.3 }, { t: 3, c: 0.8 }]) {
      const params = job.clamp({ ...defaultParams(job), ...change }).params;
      const spec = job.spec(params);
      const out = kernel.build(spec);
      const gate = runGate({ props: out.props, generic: expectVolume(spec), jobVolume: job.volume(params), jobBox: job.box(params), jobGenus: job.genus(params), jobBodies: job.bodies });
      expect(gate.checks.filter((c) => c.status === 'fail')).toEqual([]);
      expect(gate.verdict).toBe('verified');
    }
  });

  it('keeps the knuckle wall when the clearance is too big for the thickness', () => {
    const { params, notes } = job.clamp({ ...defaultParams(job), t: 3, c: 0.8 });
    const { R, r } = hingeGeometry(params);
    expect(R - (r + params.c)).toBeGreaterThanOrEqual(0.4 - 1e-9);
    expect(notes.join(' ')).toMatch(/Clearance limited/);
  });

  it('swings until the inner corners of the leaves meet', () => {
    // Both leaves are as thick as the knuckle: the inner corners, at angle atan(R / (R + c))
    // either side of the section's mid-line, meet after 180 - 2 atan(R / (R + c)) degrees.
    for (const c of [0.2, 0.4, 0.6]) {
      const p = job.clamp({ ...defaultParams(job), c }).params;
      const { R } = hingeGeometry(p);
      const theory = 180 - (2 * Math.atan(R / (R + p.c)) * 180) / Math.PI;
      expect(Math.abs(hingeLimit(p) - theory)).toBeLessThan(0.1);
    }
    const tight = hingeLimit(job.clamp({ ...defaultParams(job), c: 0.2 }).params);
    const loose = hingeLimit(job.clamp({ ...defaultParams(job), c: 0.6 }).params);
    expect(loose).toBeGreaterThan(tight);
  });
});
