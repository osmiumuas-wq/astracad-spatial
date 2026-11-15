import { fileURLToPath } from 'node:url';
import { make_gcs_wrapper, type GcsWrapper } from '@salusoft89/planegcs';
import { beforeAll, describe, expect, it } from 'vitest';
import { SketchBench } from '../src/app/sketch-bench.js';
import { addMember, designJob, designMembers, designSpec } from '../src/engine/design.js';
import { expectVolume } from '../src/engine/expect.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { runGate } from '../src/engine/truth.js';
import { cutListCsv, parseProfile, profileArea } from '../src/engine/weldment.js';
import type { Params } from '../src/engine/jobs.js';

let gcs: GcsWrapper;
let kernel: Kernel;
beforeAll(async () => {
  gcs = await make_gcs_wrapper(fileURLToPath(new URL('../node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm', import.meta.url)));
  kernel = await initKernel();
});

const build = (p: Params): { verdict: string; volume: number; components: number } => {
  const spec = designSpec(designJob.clamp(p).params);
  const out = kernel.build(spec);
  return { verdict: runGate({ props: out.props, generic: expectVolume(spec) }).verdict, volume: out.props.volume, components: out.props.components };
};

describe('weldments', () => {
  it('one member of each profile is its section along its line, verified', () => {
    for (const words of ['square tube 20 by 2', 'rectangular tube 40 by 20 by 2', 'round tube 25 by 2', 'angle 30 by 3', 'flat bar 40 by 5']) {
      const prof = parseProfile(words)!;
      const p = addMember({ nf: 0 }, prof, [0, 0, 0], [150, 0, 40]);
      const g = build(p);
      expect(g.verdict, words).toBe('verified');
      expect(g.volume, words).toBeCloseTo(profileArea(prof) * Math.hypot(150, 40), 2);
    }
  });

  it('a frame sketched as a rectangle becomes four tube members, one solid, and a cut list', () => {
    const b = new SketchBench([0, 0, 0], 0, gcs);
    b.setTool('rect');
    b.click(0, 0);
    b.click(200, 100);
    const { params, reply } = b.finishWeldment({ nf: 0 }, parseProfile('square tube 20 by 2')!);
    expect(reply).toMatch(/4 members/);
    const g = build(params);
    expect(g.components).toBe(1);
    const members = designMembers(params);
    expect(members).toHaveLength(4);
    const cl = cutListCsv(members, 7.85);
    expect(cl.csv.split('\n')[1]).toMatch(/Square tube 20 x 20 x 2",200\.0,2/);
    expect(cl.total).toBeCloseTo(600, 6);
  });
});
