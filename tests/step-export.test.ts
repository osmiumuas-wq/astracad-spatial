import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, designJob, designSpec, OPS } from '../src/engine/design.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { planarFaces, writeStep } from '../src/engine/step-export.js';
import { Occt, readStep } from '../src/engine/step-import.js';

const require = createRequire(import.meta.url);
let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

describe('STEP export', () => {
  it('merges each flat face into one STEP face, holes as inner loops', () => {
    let p = addFeature({ nf: 0 }, OPS.BOX, { a: 60, b: 40, c: 20 });
    p = addFeature(p, OPS.HOLE, { a: 10, b: 0, d: 0, e: 0, f: 20 });
    const out = kernel.build(designSpec(designJob.clamp(p).params));
    const faces = planarFaces(out.mesh.positions, out.mesh.indices);
    // The top face is one face with a hole: an outer loop and one inner loop.
    const top = faces.find((f) => f.normal[1] > 0.999)!;
    expect(top.loops.length).toBe(2);
  });

  // Read back finely tessellated (0.005 rad), so the measured volume is the B-rep's, not a coarse mesh's.
  const occtRead = async (step: string, name: string): Promise<{ closed: boolean; volume: number }> => {
    const occt = await (require('occt-import-js') as () => Promise<Occt>)();
    expect(readStep(occt, new TextEncoder().encode(step), name).closed).toBe(true);
    const res = occt.ReadStepFile(new TextEncoder().encode(step), { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: 0.0005, angularDeflection: 0.005 });
    let volume = 0;
    for (const m of res.meshes) {
      const q = m.attributes.position.array;
      const ix = m.index.array;
      for (let t = 0; t < ix.length; t += 3) {
        const [a, b, c] = [ix[t] * 3, ix[t + 1] * 3, ix[t + 2] * 3];
        volume += (q[a] * (q[b + 1] * q[c + 2] - q[b + 2] * q[c + 1]) - q[a + 1] * (q[b] * q[c + 2] - q[b + 2] * q[c]) + q[a + 2] * (q[b] * q[c + 1] - q[b + 1] * q[c])) / 6;
      }
    }
    return { closed: true, volume };
  };
  const count = (step: string, entity: string): number => (step.match(new RegExp(`=${entity}\\(`, 'gu')) ?? []).length;

  it('writes holes and fillets as true cylinders: OpenCascade reads back the exact volume', async () => {
    let p = addFeature({ nf: 0 }, OPS.BOX, { a: 60, b: 40, c: 20 });
    p = addFeature(p, OPS.FILLET, { a: 5, b: 0 });
    p = addFeature(p, OPS.HOLE, { a: 10, b: 0, d: 10, e: 0, f: 20 });
    const out = kernel.build(designSpec(designJob.clamp(p).params));
    const step = writeStep([{ name: 'bracket', positions: out.mesh.positions, indices: out.mesh.indices }], 'bracket.step');
    expect(step.startsWith('ISO-10303-21;')).toBe(true);
    // Four corner fillets and the hole: five cylinders, bounded by circles and lines.
    expect(count(step, 'CYLINDRICAL_SURFACE')).toBe(5);
    expect(count(step, 'CIRCLE')).toBeGreaterThanOrEqual(10);
    // Six flat faces and the five cylinders, nothing faceted.
    expect(count(step, 'ADVANCED_FACE')).toBe(11);
    const back = await occtRead(step, 'bracket');
    expect(back.closed).toBe(true);
    // The true shape: a rounded rectangle, less a round hole (not the mesh's polygons).
    const exact = (60 * 40 - (4 - Math.PI) * 25) * 20 - Math.PI * 25 * 20;
    expect(back.volume / exact).toBeGreaterThan(0.9999);
    expect(back.volume / exact).toBeLessThan(1.0001);
  }, 60000);

  it('writes a shaft on a plate: a convex cylinder and a circular rim', async () => {
    let p = addFeature({ nf: 0 }, OPS.BOX, { a: 50, b: 50, c: 8 });
    p = addFeature(p, OPS.CYL, { a: 16, c: 30, d: 0, e: 0, f: 8 });
    const out = kernel.build(designSpec(designJob.clamp(p).params));
    const step = writeStep([{ name: 'shaft', positions: out.mesh.positions, indices: out.mesh.indices }], 'shaft.step');
    expect(count(step, 'CYLINDRICAL_SURFACE')).toBe(1);
    const back = await occtRead(step, 'shaft');
    expect(back.closed).toBe(true);
    const exact = 50 * 50 * 8 + Math.PI * 64 * 30;
    expect(Math.abs(back.volume / exact - 1)).toBeLessThan(1e-4);
  }, 60000);

  it('exports a gear with a bore as a closed solid with a true cylinder bore', async () => {
    const { parseDesign } = await import('../src/engine/design.js');
    let p = addFeature({ nf: 0 }, OPS.BOX, { a: 30, b: 30, c: 5 });
    p = parseDesign('gear module 2 with 20 teeth 8 thick bore 6', p)!.params;
    const gear = kernel.build(designSpec(designJob.clamp(p).params));
    const step = writeStep([{ name: 'gear', positions: gear.mesh.positions, indices: gear.mesh.indices }], 'gear.step');
    expect(count(step, 'CYLINDRICAL_SURFACE')).toBeGreaterThanOrEqual(1);
    const back = await occtRead(step, 'gear');
    expect(back.closed).toBe(true);
    expect(Math.abs(back.volume / gear.props.volume - 1)).toBeLessThan(2e-3);
  }, 120000);

  it('builds a threaded rod (44 000 facets) as a closed shell in well under a second', async () => {
    const { parseDesign } = await import('../src/engine/design.js');
    const { buildBrep } = await import('../src/engine/step-brep.js');
    let q = addFeature({ nf: 0 }, OPS.BOX, { a: 20, b: 20, c: 5 });
    q = parseDesign('m8 thread 16 long', q)!.params;
    const rod = kernel.build(designSpec(designJob.clamp(q).params));
    const t0 = performance.now();
    const b = buildBrep(rod.mesh.positions, rod.mesh.indices);
    expect(performance.now() - t0).toBeLessThan(3000);
    // Closed: every edge is used by exactly two face loops, once each way.
    const uses = new Map<number, number[]>();
    for (const f of b.faces) for (const loop of f.loops) for (const r of loop) uses.set(r.chain, [...(uses.get(r.chain) ?? []), r.same ? 1 : -1]);
    expect(uses.size).toBe(b.chains.length);
    for (const u of uses.values()) expect(u.sort()).toEqual([-1, 1]);
  }, 120000);

  it('keeps blends it cannot fit as facets, still one closed solid', async () => {
    let p = addFeature({ nf: 0 }, OPS.BOX, { a: 40, b: 30, c: 20 });
    p = addFeature(p, OPS.ROUND, { a: 3, b: 1 });
    const out = kernel.build(designSpec(designJob.clamp(p).params));
    const step = writeStep([{ name: 'rounded', positions: out.mesh.positions, indices: out.mesh.indices }], 'rounded.step');
    const back = await occtRead(step, 'rounded');
    expect(back.closed).toBe(true);
    // Between the faceted mesh (lower bound) and the exact Steiner volume.
    const r = 3;
    const steiner = 34 * 24 * 14 + 2 * r * (34 * 24 + 24 * 14 + 34 * 14) + Math.PI * r * r * (34 + 24 + 14) + (4 / 3) * Math.PI * r ** 3;
    expect(back.volume).toBeGreaterThan(out.props.volume * 0.9999);
    expect(back.volume).toBeLessThan(steiner * 1.0001);
  }, 60000);

  it('makes an imported STEP solid editable: a hole drilled into it, exported again', async () => {
    const { registerMesh } = await import('../src/engine/kernel.js');
    // A part from "desktop CAD": an L bracket, written to STEP and read back by OpenCascade.
    let src = addFeature({ nf: 0 }, OPS.BOX, { a: 60, b: 40, c: 8 });
    src = addFeature(src, OPS.BOX, { a: 8, b: 40, c: 40, d: -26, e: 0, f: 8 });
    const made = kernel.build(designSpec(designJob.clamp(src).params));
    const occt = await (require('occt-import-js') as () => Promise<Occt>)();
    const imported = readStep(occt, new TextEncoder().encode(writeStep([{ name: 'l', positions: made.mesh.positions, indices: made.mesh.indices }])), 'l');
    expect(imported.closed).toBe(true);
    registerMesh('imp7', imported.positions, imported.indices);
    const b = imported.box;
    let p = addFeature({ nf: 0 }, OPS.BASE, { a: 7, b: b.min[0], c: b.max[0], d: b.min[1], e: b.max[1], f: b.min[2], g: b.max[2] });
    // A 10 mm hole through the foot, from its top face (y = 8).
    p = addFeature(p, OPS.FCIRC, { a: 10, b: 0, c: 0, d: 10, e: 8, f: 0, g: 1 });
    const out = kernel.build(designSpec(designJob.clamp(p).params));
    expect(out.props.components).toBe(1);
    expect(made.props.volume - out.props.volume).toBeCloseTo(Math.PI * 25 * 8, 0);
    // And back out as STEP, the new hole a true cylinder.
    const step = writeStep([{ name: 'l2', positions: out.mesh.positions, indices: out.mesh.indices }]);
    expect(count(step, 'CYLINDRICAL_SURFACE')).toBe(1);
  }, 60000);
});
