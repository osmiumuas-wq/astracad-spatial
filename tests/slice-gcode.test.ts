import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PRINTER, hatch, Layer, Path, toGcode } from '../src/engine/gcode.js';
import { JOBS, Job, Params } from '../src/engine/jobs.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

const find = (id: string): Job => JOBS.find((j) => j.id === id)!;
const defaults = (job: Job): Params => Object.fromEntries(job.params.map((d) => [d.id, d.value]));

describe('slicing a real part to G-code', () => {
  it('slices the phone stand: filament mass close to the part mass at 20 % infill', () => {
    const job = find('phone-stand');
    const p = defaults(job);
    const s = DEFAULT_PRINTER;
    const t0 = performance.now();
    const tp = kernel.toolpaths(job.spec(p), [0, 0, 1], { layer: s.layer, line: s.line, walls: s.walls, skins: s.skins, bed: s.bed });
    const t1 = performance.now();
    const layers: Layer[] = tp.layers.map((L, i) => {
      const paths: Path[] = L.walls.map((pts) => ({ kind: 'wall' as const, pts, closed: true }));
      const a = i % 2 ? -Math.PI / 4 : Math.PI / 4;
      for (const seg of hatch(L.skin, a, s.line)) paths.push({ kind: 'skin', pts: seg, closed: false });
      for (const seg of hatch(L.sparse, a, s.line / s.infill)) paths.push({ kind: 'infill', pts: seg, closed: false });
      return { z: L.z, paths };
    });
    const g = toGcode(layers, s, job.title);
    const t2 = performance.now();
    expect(g.layers).toBeGreaterThan(50);
    expect(g.grams).toBeGreaterThan(5);
    // A full solid of this stand weighs about 69 g; 2 walls + skins + 20 % infill must weigh less.
    expect(g.grams).toBeLessThan(69.5);
  }, 120000);
});
