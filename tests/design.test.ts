import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, addOutline, designJob, designSpec, OPS, removeLast } from '../src/engine/design.js';
import { expectVolume } from '../src/engine/expect.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { runGate } from '../src/engine/truth.js';
import type { Params } from '../src/engine/jobs.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

function gate(p: Params): { verdict: string; volume: number; reason?: string } {
  const params = designJob.clamp(p).params;
  const spec = designSpec(params);
  const out = kernel.build(spec);
  const g = runGate({ props: out.props, generic: expectVolume(spec) });
  return { verdict: g.verdict, volume: out.props.volume, reason: g.reason };
}

const start: Params = { nf: 0 };

describe('free design', () => {
  it('a single box is verified by the closed form', () => {
    const p = addFeature(start, OPS.BOX, { a: 60, b: 40, c: 20 });
    const g = gate(p);
    expect(g.verdict).toBe('verified');
    expect(g.volume).toBeCloseTo(48000, 3);
  });

  it('a box with a through hole: the closed form subtracts the cylinder', () => {
    let p = addFeature(start, OPS.BOX, { a: 60, b: 40, c: 20 });
    p = addFeature(p, OPS.HOLE, { a: 8, b: 0, d: 10, e: 0, f: 20 });
    const g = gate(p);
    expect(g.verdict).not.toBe('refused');
    // A polygonal cylinder removes slightly less than pi r^2 h.
    expect(48000 - g.volume).toBeGreaterThan(Math.PI * 16 * 20 * 0.98);
    expect(48000 - g.volume).toBeLessThan(Math.PI * 16 * 20 * 1.001);
  });

  it('builds a filleted, shelled box with a boss and a patterned row of holes', () => {
    let p = addFeature(start, OPS.BOX, { a: 80, b: 50, c: 30 });
    p = addFeature(p, OPS.FILLET, { a: 6, b: 0 });
    p = addFeature(p, OPS.SHELL, { a: 2, b: 0 });
    // A boss standing on the inner floor (on top of the open shell it would float: the gate refuses that).
    p = addFeature(p, OPS.CYL, { a: 12, c: 10, d: 0, e: 0, f: 1 });
    p = addFeature(p, OPS.HOLE, { a: 4, b: 0, d: -30, e: 18, f: 30 });
    p = addFeature(p, OPS.LINPAT, { a: 4, b: 4, c: 20, d: 0 });
    const g = gate(p);
    expect(g.reason).toBeUndefined();
    expect(g.verdict).not.toBe('refused');
    expect(g.volume).toBeGreaterThan(1000);
    // Undo the pattern: fewer holes, more material.
    const fewer = gate(removeLast(p));
    expect(fewer.volume).toBeGreaterThan(g.volume);
  });

  it('extrudes a sketched outline and cuts with another', () => {
    const tri = addOutline(start, [[0, 0], [40, 0], [0, 30]]);
    let p = addFeature(tri.params, OPS.OUTLINE, { a: tri.index, c: 10, f: 0, g: 0 });
    const g = gate(p);
    expect(g.verdict).toBe('verified');
    expect(g.volume).toBeCloseTo(0.5 * 40 * 30 * 10, 3);
    p = addFeature(p, OPS.BORE, { a: 6, c: 10, d: 8, e: -6, f: 0 });
    expect(gate(p).volume).toBeLessThan(6000);
  });
});

describe('design by voice', () => {
  it('adds, drills, fillets, shells and patterns from sentences', async () => {
    const { parseDesign, featureCount, readFeature } = await import('../src/engine/design.js');
    let p = designJob.clamp({}).params;
    expect(featureCount(p)).toBe(1);
    p = parseDesign('add a cylinder 12 by 8', p)!.params;
    expect(readFeature(p, 1).op).toBe(OPS.CYL);
    expect(readFeature(p, 1).v.f).toBe(20);
    p = parseDesign('drill a 4.5 mm hole here', p, [20, 20, 10])!.params;
    expect(readFeature(p, 2).v).toMatchObject({ a: 4.5, d: 20, e: 10 });
    p = parseDesign('pattern 3 times 12 apart', p)!.params;
    expect(readFeature(p, 3)).toMatchObject({ op: OPS.LINPAT, v: { a: 3, b: 2, c: 12 } });
    p = parseDesign('round the corners 4', p)!.params;
    expect(readFeature(p, 4)).toMatchObject({ op: OPS.FILLET, v: { a: 4, b: 1 } });
    p = parseDesign('remove the last feature', p)!.params;
    expect(featureCount(p)).toBe(4);
    expect(gate(p).verdict).not.toBe('refused');
  });
});

describe('pro part tools', () => {
  it('chamfers exactly: area loses d^2/2 per right-angle corner', async () => {
    const { parseDesign } = await import('../src/engine/design.js');
    let p = addFeature(start, OPS.BOX, { a: 40, b: 30, c: 10 });
    p = parseDesign('chamfer 3', p)!.params;
    const g = gate(p);
    expect(g.verdict).toBe('verified');
    expect(g.volume).toBeCloseTo((40 * 30 - 4 * (3 * 3) / 2) * 10, 6);
  });

  it('mirrors across X and joins the copy (kernel-checked)', async () => {
    const { parseDesign } = await import('../src/engine/design.js');
    let p = addFeature(start, OPS.BOX, { a: 20, b: 10, c: 10, d: 10 });
    p = parseDesign('mirror across x 0', p)!.params;
    const g = gate(p);
    expect(g.verdict).not.toBe('refused');
    expect(g.volume).toBeCloseTo(4000, 3);
  });

  it('sketches on a side face, pulls a boss out, then cuts into it instead', async () => {
    const { parseDesign, addFaceSketch } = await import('../src/engine/design.js');
    let p = addFeature(start, OPS.BOX, { a: 40, b: 30, c: 20 });
    // A 10 x 8 rectangle on the +X face (x = 20), centred at y = 10, z = 0.
    p = addFaceSketch(p, [[-5, 6], [5, 6], [5, 14], [-5, 14]], [20, 0, 0], 2);
    p = parseDesign('extrude 15', p)!.params;
    expect(gate(p).volume).toBeCloseTo(40 * 30 * 20 + 10 * 8 * 15, 3);
    p = parseDesign('cut 5', p)!.params;
    expect(gate(p).volume).toBeCloseTo(40 * 30 * 20 - 10 * 8 * 5, 3);
  });

  it('revolves a face sketch into a turned part (Pappus)', async () => {
    const { parseDesign, addFaceSketch } = await import('../src/engine/design.js');
    // A 10 x 20 rectangle on the front face, revolved about its left edge: a cylinder r 10, h 20 (polygonal).
    let p = addFeature(start, OPS.BOX, { a: 4, b: 4, c: 4 });
    // On the block's front face (z = 2), u from 0 to 10: the revolved cylinder swallows the block, one solid.
    p = addFaceSketch(p, [[0, 0], [10, 0], [10, 20], [0, 20]], [0, 0, 2], 4);
    p = parseDesign('revolve it', p)!.params;
    const g = gate(p);
    expect(g.reason).toBeUndefined();
    const cyl = Math.PI * 100 * 20;
    expect(g.volume).toBeGreaterThan(cyl * 0.98);
    expect(g.volume).toBeLessThan(cyl * 1.001);
  });

  it('edits an earlier feature', async () => {
    const { parseDesign, designJob: job } = await import('../src/engine/design.js');
    let p = addFeature(start, OPS.BOX, { a: 40, b: 30, c: 20 });
    p = addFeature(p, OPS.CYL, { a: 10, c: 10, f: 20 });
    p = parseDesign('edit feature 1', p)!.params;
    job.clamp(p);
    expect(job.params.map((d) => d.id)).toContain('a0');
  });
});

describe('fillet or chamfer any picked edge', () => {
  it('finds the whole edge near a pointed spot and rounds it', async () => {
    const { parseDesign, edgeNear } = await import('../src/engine/design.js');
    const { filletArea } = await import('../src/engine/edges.js');
    const p0 = addFeature(start, OPS.BOX, { a: 60, b: 40, c: 20 });
    const built = kernel.build(designSpec(designJob.clamp(p0).params));
    // Near the top front edge (y = 20, z = 20), pointed 1 mm off it.
    const e = edgeNear(built.mesh.edges, [5, 19.2, 20.5])!;
    expect(Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1], e.b[2] - e.a[2])).toBeCloseTo(60, 6);
    const p = parseDesign('fillet this edge 3', p0, [5, 19.2, 20.5], (at) => edgeNear(built.mesh.edges, at))!.params;
    const g = gate(p);
    expect(g.verdict).not.toBe('refused');
    const removed = 48000 - g.volume;
    expect(removed).toBeGreaterThan(filletArea(3, Math.PI / 2) * 60 * 0.999);
    expect(removed).toBeLessThan(filletArea(3, Math.PI / 2) * 60 * 1.02);
  });
});

describe('production tools', () => {
  it('drills a hole in a side face, exactly', async () => {
    const { parseDesign } = await import('../src/engine/design.js');
    let p = addFeature(start, OPS.BOX, { a: 60, b: 40, c: 20 });
    // The +X face (x = 30), code 2, at y = 10, z = 0: a 6 mm hole right through along x.
    p = parseDesign('drill a 6 mm hole here', p, [30, 10, 0], undefined, 2)!.params;
    const g = gate(p);
    expect(g.verdict).not.toBe('refused');
    expect(48000 - g.volume).toBeGreaterThan(Math.PI * 9 * 60 * 0.98);
    expect(48000 - g.volume).toBeLessThan(Math.PI * 9 * 60 * 1.001);
  });

  it('sketches exact shapes on a face: rectangle boss, hexagon pocket', async () => {
    const { parseDesign } = await import('../src/engine/design.js');
    let p = addFeature(start, OPS.BOX, { a: 60, b: 40, c: 20 });
    p = parseDesign('sketch a rectangle 20 by 10 here 5 tall', p, [0, 20, 0], undefined, 0)!.params;
    expect(gate(p).volume).toBeCloseTo(48000 + 20 * 10 * 5, 2);
    p = parseDesign('cut a hexagon 13 here 4 deep', p, [0, 10, 20], undefined, 4)!.params;
    expect(gate(p).volume).toBeCloseTo(48000 + 1000 - (Math.sqrt(3) / 2) * 169 * 4, 2);
  });

  it('makes an involute gear, verified by its own outline', async () => {
    const { parseDesign } = await import('../src/engine/design.js');
    const { gearOutline, shoelace } = await import('../src/engine/profiles.js');
    let p = addFeature(start, OPS.BOX, { a: 10, b: 10, c: 2 });
    p = parseDesign('gear module 2 with 20 teeth 8 thick bore 6', p)!.params;
    const g = gate(p);
    expect(g.verdict).not.toBe('refused');
    const A = shoelace(gearOutline({ module: 2, teeth: 20 }));
    // The gear sits on the block's top; the block (200 mm3) lies under it.
    expect(g.volume).toBeCloseTo(200 + (A - Math.PI * 9) * 8, 0);
  });

  it('makes an M8 threaded rod: section area times length', async () => {
    const { parseDesign } = await import('../src/engine/design.js');
    const { threadSection, shoelace } = await import('../src/engine/profiles.js');
    let p = addFeature(start, OPS.BOX, { a: 20, b: 20, c: 5 });
    p = parseDesign('m8 thread 16 long', p)!.params;
    const g = gate(p);
    expect(g.verdict).not.toBe('refused');
    const sec = shoelace(threadSection({ major: 8, pitch: 1.25 }, 48));
    expect(g.volume - 2000).toBeGreaterThan(sec * 16 * 0.98);
    expect(g.volume - 2000).toBeLessThan(sec * 16 * 1.01);
  });

  it('taps a thread inside a drilled hole', async () => {
    const { parseDesign } = await import('../src/engine/design.js');
    let p = addFeature(start, OPS.BOX, { a: 30, b: 30, c: 20 });
    p = parseDesign('drill a 6.8 mm hole', p)!.params;
    const before = gate(p).volume;
    p = parseDesign('tap m8 15 deep here', p, [0, 20, 0], undefined, 0)!.params;
    const g = gate(p);
    expect(g.verdict).not.toBe('refused');
    expect(g.volume).toBeLessThan(before);
  });

  it('lofts a rectangle to a circle (prismatoid formula)', async () => {
    const { parseDesign } = await import('../src/engine/design.js');
    let p = addFeature(start, OPS.BOX, { a: 50, b: 50, c: 5 });
    p = parseDesign('loft a rectangle 40 by 30 to a circle 20 over 25', p)!.params;
    const g = gate(p);
    expect(g.reason).toBeUndefined();
    expect(g.volume).toBeGreaterThan(12500 + 25 * Math.PI * 100);
  });

  it('drafts a boss: the frustum volume, checked in closed form', async () => {
    const { parseDesign } = await import('../src/engine/design.js');
    let p = addFeature(start, OPS.BOX, { a: 40, b: 20, c: 10 });
    p = parseDesign('draft 5', p)!.params;
    const g = gate(p);
    expect(g.verdict).toBe('verified');
    expect(g.volume).toBeLessThan(8000);
  });
});
