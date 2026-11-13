import { beforeAll, describe, expect, it } from 'vitest';
import { chooseScale, drawingSvg } from '../src/engine/drawing.js';
import { defaultParams, jobById } from '../src/engine/jobs.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

const info = { title: 'Test', name: 'test', material: 'PLA', massG: 1, volume: 1000, verdict: 'Verified', date: '2026-11-13', params: [] };

describe('engineering drawing', () => {
  it('views match the part box and the drawing reads the holes exactly', () => {
    const job = jobById('flange-plate');
    const params = job.clamp(defaultParams(job)).params;
    const spec = job.spec(params);
    const views = kernel.views(spec);
    const box = kernel.build(spec).props.bbox;
    const { svg, holes } = drawingSvg(views, info);
    const ext = (loops: [number, number][][], a: 0 | 1) => {
      const v = loops.flat().map((p) => p[a]);
      return Math.max(...v) - Math.min(...v);
    };
    // Front: X by Y; top: X by Z; right: Z by Y.
    expect(ext(views.front, 0)).toBeCloseTo(box.max[0] - box.min[0], 3);
    expect(ext(views.front, 1)).toBeCloseTo(box.max[1] - box.min[1], 3);
    expect(ext(views.top, 1)).toBeCloseTo(box.max[2] - box.min[2], 3);
    expect(ext(views.right, 0)).toBeCloseTo(box.max[2] - box.min[2], 3);
    // The flange's bolt holes go through along Y: they show in the top view only.
    const top = holes.filter((h) => h.view === 'top');
    expect(top.length).toBeGreaterThan(0);
    expect(svg).toContain('THRU');
    expect(svg.startsWith('<svg')).toBe(true);
  });

  it('picks the largest standard scale that fits', () => {
    expect(chooseScale(40, 20, 10)).toBe(2);
    // (400 + 100) x 0.25 + 28 is over the 150 mm the views may use, so 1:5.
    expect(chooseScale(400, 100, 100)).toBe(0.2);
  });
});
