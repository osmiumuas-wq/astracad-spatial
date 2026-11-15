import { beforeAll, describe, expect, it } from 'vitest';
import { appearanceOf } from '../src/app/appearance.js';
import { addFeature, designJob, designSpec, OPS, parseDesign } from '../src/engine/design.js';
import { expectVolume } from '../src/engine/expect.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { knurlSection } from '../src/engine/profiles.js';
import { textBars } from '../src/engine/strokefont.js';
import { runGate } from '../src/engine/truth.js';
import type { Params } from '../src/engine/jobs.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

const build = (p: Params): { verdict: string; volume: number; components: number } => {
  const spec = designSpec(designJob.clamp(p).params);
  const out = kernel.build(spec);
  return { verdict: runGate({ props: out.props, generic: expectVolume(spec) }).verdict, volume: out.props.volume, components: out.props.components };
};

describe('knurling, lettering, appearances', () => {
  it('a straight knurl is its serrated section times its length, verified; a diamond knurl is real teeth', () => {
    const straight = build(parseDesign('straight knurl 20 diameter 30 long pitch 1', { nf: 0 }, [0, 0, 0], undefined, 0)!.params);
    const star = knurlSection(20, 1);
    let area = 0;
    for (let i = 0; i < star.length; i++) area += (star[i][0] * star[(i + 1) % star.length][1] - star[(i + 1) % star.length][0] * star[i][1]) / 2;
    expect(straight.verdict).toBe('verified');
    expect(straight.volume).toBeCloseTo(area * 30, 2);
    const diamond = build(parseDesign('knurl 20 diameter 30 long pitch 1 diamond', { nf: 0 }, [0, 0, 0], undefined, 0)!.params);
    expect(diamond.components).toBe(1);
    // Teeth cut both ways leave less than the straight knurl and more than the core.
    expect(diamond.volume).toBeLessThan(straight.volume);
    expect(diamond.volume).toBeGreaterThan(Math.PI * (10 - 0.4) ** 2 * 30);
  });

  it('engraved lettering cuts into a face; embossed lettering stands out of it', () => {
    expect(textBars('AB 12', 6).length).toBeGreaterThan(10);
    const base = addFeature({ nf: 0 }, OPS.BOX, { a: 80, b: 40, c: 10 });
    const plain = build(base).volume;
    const engraved = build(parseDesign('engrave ACME 7 here 8 high 0.5 deep', base, [0, 10, 0], undefined, 0)!.params);
    expect(engraved.volume).toBeLessThan(plain);
    expect(engraved.components).toBe(1);
    const embossed = build(parseDesign('emboss LOT 42 here 6 high 1 tall', base, [0, 10, 0], undefined, 0)!.params);
    expect(embossed.volume).toBeGreaterThan(plain);
  });

  it('reads appearances', () => {
    expect(appearanceOf('appearance brushed aluminium')!.texture).toBe('brushed');
    expect(appearanceOf('make it anodised red')!.color).toBe(0xc0392b);
    expect(appearanceOf('finish carbon fibre')!.texture).toBe('carbon');
    expect(appearanceOf('looks like walnut')!.name).toBe('walnut');
    expect(appearanceOf('appearance glass')!.opacity).toBeLessThan(1);
  });
});
