import { fileURLToPath } from 'node:url';
import { make_gcs_wrapper, type GcsWrapper } from '@salusoft89/planegcs';
import { beforeAll, describe, expect, it } from 'vitest';
import { SketchBench } from '../src/app/sketch-bench.js';
import { addFeature, designJob, designSpec, OPS } from '../src/engine/design.js';
import { expectVolume } from '../src/engine/expect.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { runGate } from '../src/engine/truth.js';

let gcs: GcsWrapper;
let kernel: Kernel;
beforeAll(async () => {
  gcs = await make_gcs_wrapper(fileURLToPath(new URL('../node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm', import.meta.url)));
  kernel = await initKernel();
});

describe('the sketch workbench, driven like a user', () => {
  it('picks a line chain with a tangent arc, dimensions it, adds a hole, extrudes: one verified solid', () => {
    const b = new SketchBench([-30, 10, 20], 0, gcs);
    // Clicks a hand would make on the top face (u right, v back), a little off the grid.
    b.click(0.2, -0.3);
    b.click(40.6, 0.3);
    b.click(40, 20.4);
    expect(b.command('tangent arc')).toMatch(/Tangent arc/);
    b.click(20, 40);
    b.click(0, 40.2);
    expect(b.click(0.4, -0.2)).toMatch(/closed/);
    b.setTool('dimension');
    expect(b.click(20, 0)).toMatch(/say the size/);
    expect(b.command('45')).toMatch(/Length 45 mm/);
    b.setTool('circle');
    b.click(15, 20);
    b.click(19, 20);
    b.setTool('dimension');
    b.click(19, 20);
    expect(b.command('diameter 8')).toMatch(/Diameter 8 mm/);
    const base = addFeature({ nf: 0 }, OPS.BOX, { a: 100, b: 70, c: 10 });
    const { params, reply } = b.finish(base, 'extrude', 8);
    expect(reply).toMatch(/Extruded 8 mm: 1 region/);
    const spec = designSpec(designJob.clamp(params).params);
    const out = kernel.build(spec);
    expect(runGate({ props: out.props, generic: expectVolume(spec) }).verdict).toBe('verified');
    expect(out.props.components).toBe(1);
  });

  it('relations from the selection, construction geometry, undo', () => {
    const b = new SketchBench([0, 0, 0], 0, gcs);
    b.setTool('line');
    b.click(0, 0);
    b.click(30, 4);
    b.setTool('line');
    b.click(30, 4);
    b.click(33, 25);
    b.setTool('select');
    b.click(15, 2);
    b.click(31.5, 14);
    expect(b.command('perpendicular')).toMatch(/perpendicular/);
    expect(b.command('construction')).toMatch(/Construction/);
    expect(b.sk.ents.some((e) => e.construction)).toBe(true);
    expect(b.undo()).toBe('Undone.');
    expect(b.sk.ents.some((e) => e.construction)).toBe(false);
  });

  const build = (params: Record<string, number>): { verdict: string; volume: number; components: number } => {
    const spec = designSpec(designJob.clamp(params).params);
    const out = kernel.build(spec);
    return { verdict: runGate({ props: out.props, generic: expectVolume(spec) }).verdict, volume: out.props.volume, components: out.props.components };
  };

  it('revolves about a vertical construction line: a ring', () => {
    const b = new SketchBench([0, 0, 0], 4, gcs);
    b.setTool('line');
    b.click(30, -5);
    b.click(30, 40);
    b.setTool('select');
    b.click(30, 10);
    b.command('construction');
    b.setTool('rect');
    b.click(40, 0);
    b.click(50, 20);
    const { params } = b.finish({ nf: 0 }, 'revolve', 360);
    const g = build(params);
    // About the line at u = 30: inner radius 10, outer 20, 20 tall.
    expect(g.volume).toBeCloseTo(Math.PI * (400 - 100) * 20, 0);
  });

  it('sweeps a rod along a sketched path lying on the face', () => {
    const b = new SketchBench([-30, 10, 10], 0, gcs);
    b.setTool('line');
    b.click(0, 0);
    b.click(40, 0);
    b.click(40, 20);
    b.setTool('select');
    const { params, reply } = b.finishSweep(addFeature({ nf: 0 }, OPS.BOX, { a: 100, b: 70, c: 10 }), 6, 8);
    expect(reply).toMatch(/2-line path/);
    const g = build(params);
    expect(g.components).toBe(1);
    expect(g.volume).toBeGreaterThan(70000 + Math.PI * 9 * 40);
  });

  it('lofts from a square to a circle on an offset plane', () => {
    const b = new SketchBench([0, 10, 0], 0, gcs);
    b.setTool('rect');
    b.click(-10, -10);
    b.click(10, 10);
    expect(b.startLoft(25)).toMatch(/second profile/);
    expect(b.origin[1]).toBeCloseTo(35, 9);
    b.setTool('circle');
    b.click(0, 0);
    b.click(6, 0);
    const { params } = b.finishLoft(addFeature({ nf: 0 }, OPS.BOX, { a: 60, b: 60, c: 10 }));
    const g = build(params);
    expect(g.components).toBe(1);
    // Between the circle's and the square's prisms.
    expect(g.volume - 36000).toBeGreaterThan(Math.PI * 36 * 25);
    expect(g.volume - 36000).toBeLessThan(400 * 25);
  });

  it('fillet, trim, offset, mirror and spline tools by clicks', () => {
    const b = new SketchBench([0, 0, 0], 0, gcs);
    b.setTool('rect');
    b.click(0, 0);
    b.click(40, 20);
    expect(b.command('fillet 4')).toMatch(/Sketch fillet/);
    expect(b.click(40.3, 20.2)).toMatch(/Fillet R4/);
    expect(b.command('offset 3')).toMatch(/Offset/);
    b.click(20, 0.2);
    expect(b.click(20, -5)).toMatch(/Offset 3 mm/);
    b.setTool('spline');
    b.click(60, 0);
    b.click(70, 8);
    b.click(80, 0);
    expect(b.click(80, 0)).toMatch(/Spline through 3 points/);
    b.setTool('line');
    b.click(50, -10);
    b.click(50, 30);
    expect(b.command('trim')).toMatch(/Trim/);
    expect(b.click(50, 25)).toMatch(/Deleted|Trimmed/);
  });

  it('ellipse, extend and sketch patterns', () => {
    const b = new SketchBench([0, 0, 0], 0, gcs);
    b.setTool('ellipse');
    b.click(0, 0);
    b.click(20, 0);
    expect(b.click(0, 10)).toMatch(/Ellipse/);
    const { params } = b.finish({ nf: 0 }, 'extrude', 5);
    // 96 straight pieces: within 0.1 % of pi a b.
    expect(Math.abs(build(params).volume / (Math.PI * 200 * 5) - 1)).toBeLessThan(1e-3);
    const c = new SketchBench([0, 0, 0], 0, gcs);
    c.setTool('line');
    c.click(0, 0);
    c.click(10, 0);
    c.setTool('line');
    c.click(30, -10);
    c.click(30, 10);
    expect(c.command('extend')).toMatch(/Extend/);
    expect(c.click(9, 0)).toMatch(/Extended 20\.0 mm/);
    const d = new SketchBench([0, 0, 0], 0, gcs);
    d.setTool('circle');
    d.click(20, 0);
    d.click(23, 0);
    d.setTool('select');
    d.click(23, 0);
    expect(d.command('circular pattern 6')).toMatch(/6 in a circle/);
    expect(d.sk.ents.filter((e) => e.kind === 'circle')).toHaveLength(6);
    d.setTool('select');
    d.click(23, 0);
    expect(d.command('pattern 3 10')).toMatch(/3 in a row/);
  });

  it('a sketch on a tilted plane, and a revolve about a slanted construction line', () => {
    const b = new SketchBench([0, 30, 0], 0, gcs);
    expect(b.tiltPlane(30)).toMatch(/30 degrees/);
    b.setTool('rect');
    b.click(-10, -10);
    b.click(10, 10);
    const { params } = b.finish({ nf: 0 }, 'extrude', 5);
    const g = build(params);
    expect(g.volume).toBeCloseTo(400 * 5, 3);
    // The pad's normal leans 30 degrees from vertical: its top corners are not level.
    const r = new SketchBench([0, 0, 0], 4, gcs);
    r.setTool('line');
    r.click(0, 0);
    r.click(30, 30);
    r.setTool('select');
    r.click(15, 15);
    r.command('construction');
    r.setTool('circle');
    r.click(20, 0);
    r.click(24, 0);
    const rev = r.finish({ nf: 0 }, 'revolve', 360);
    // Pappus: a circle of radius 4 whose centre is 20 / sqrt(2) from the 45-degree axis.
    const want = Math.PI * 16 * 2 * Math.PI * (20 / Math.SQRT2);
    expect(Math.abs(build(rev.params).volume / want - 1)).toBeLessThan(2e-3);
  });
});
