import { fileURLToPath } from 'node:url';
import { make_gcs_wrapper, type GcsWrapper } from '@salusoft89/planegcs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, designJob, designSpec, OPS, sketchFeatures } from '../src/engine/design.js';
import { expectVolume } from '../src/engine/expect.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import {
  addArc3,
  addCircle,
  addConstraint,
  addLine,
  addPolygon,
  addRectangle,
  addSlot,
  addTangentArc,
  dimension,
  measure,
  newSketch,
  pickEntity,
  profiles,
  snap,
  solve,
} from '../src/engine/sketch2d.js';
import { runGate } from '../src/engine/truth.js';
import type { Params } from '../src/engine/jobs.js';

let gcs: GcsWrapper;
let kernel: Kernel;
beforeAll(async () => {
  gcs = await make_gcs_wrapper(fileURLToPath(new URL('../node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm', import.meta.url)));
  kernel = await initKernel();
});

const gate = (p: Params): { verdict: string; volume: number; components: number } => {
  const spec = designSpec(designJob.clamp(p).params);
  const out = kernel.build(spec);
  return { verdict: runGate({ props: out.props, generic: expectVolume(spec) }).verdict, volume: out.props.volume, components: out.props.components };
};
const block = addFeature({ nf: 0 }, OPS.BOX, { a: 120, b: 80, c: 10 });
const S = (x: number, y: number) => ({ x, y, kind: 'free' as const });

describe('sketch workbench: tools, constraints, dimensions', () => {
  it('draws a rough rectangle, dimensions it 50 by 30 and extrudes it, verified', () => {
    const sk = newSketch();
    const [bottom, right] = addRectangle(sk, snap(sk, 0.2, -0.1), S(41.3, 19.6));
    dimension(sk, bottom, 50);
    dimension(sk, right, 30);
    const r = solve(gcs, sk);
    expect(r.ok).toBe(true);
    expect(measure(sk, bottom)!.value).toBeCloseTo(50, 9);
    expect(measure(sk, right)!.value).toBeCloseTo(30, 9);
    const regions = profiles(sk);
    expect(regions).toHaveLength(1);
    expect(regions[0].area).toBeCloseTo(1500, 6);
    const p = sketchFeatures(block, regions, [-20, 10, 10], 0, 'extrude', 12);
    const g = gate(p);
    expect(g).toMatchObject({ verdict: 'verified', components: 1 });
    expect(g.volume).toBeCloseTo(120 * 80 * 10 + 1500 * 12, 3);
  });

  it('a plate with a hole: a rectangle and a circle inside it are one region, cut through', () => {
    const sk = newSketch();
    addRectangle(sk, S(0, 0), S(40, 30));
    const c = addCircle(sk, S(20, 15), S(26, 15));
    dimension(sk, c, 5);
    expect(solve(gcs, sk).ok).toBe(true);
    const regions = profiles(sk);
    expect(regions).toHaveLength(1);
    expect(regions[0].loops).toHaveLength(2);
    expect(regions[0].area).toBeCloseTo(1200 - Math.PI * 25, 6);
    const g = gate(sketchFeatures(block, regions, [-20, 10, -15], 0, 'extrude', 5));
    expect(g.verdict).toBe('verified');
    expect(g.volume).toBeCloseTo(96000 + (1200 - Math.PI * 25) * 5, 3);
  });

  it('a slot (lines tangent to arcs) and a hexagon, dimensioned and cut into the block', () => {
    const sk = newSketch();
    const [, arc] = addSlot(sk, S(-30, 0), S(-10, 0), 8);
    dimension(sk, arc, 5);
    addPolygon(sk, S(25, 0), S(31, 0), 6);
    expect(solve(gcs, sk).ok).toBe(true);
    const regions = profiles(sk);
    expect(regions).toHaveLength(2);
    const areas = regions.map((r) => r.area).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo((3 * Math.sqrt(3) / 2) * 36, 6);
    expect(areas[1]).toBeCloseTo(20 * 10 + Math.PI * 25, 6);
    const g = gate(sketchFeatures(block, regions, [0, 10, 0], 0, 'cut', 4));
    expect(g.verdict).toBe('verified');
    expect(96000 - g.volume).toBeCloseTo((areas[0] + areas[1]) * 4, 3);
  });

  it('lines and a tangent arc joined end to end, closed by snapping onto the start', () => {
    const sk = newSketch();
    const l1 = addLine(sk, S(0, 0), S(30, 0.4));
    expect(sk.cons.some((c) => c.kind === 'horizontal')).toBe(true);
    const end1 = sk.points.find((p) => Math.abs(p.x - 30) < 1e-9)!;
    addTangentArc(sk, l1, S(30, 20));
    const top = snap(sk, 30.6, 20.3);
    expect(top.kind).toBe('point');
    addLine(sk, top, S(0, 20));
    addLine(sk, snap(sk, 0.4, 19.8), snap(sk, 0.3, 0.2));
    expect(solve(gcs, sk).ok).toBe(true);
    expect(end1).toBeDefined();
    const regions = profiles(sk);
    expect(regions).toHaveLength(1);
    expect(regions[0].loops[0].sweeps.filter((s) => s !== 0)).toHaveLength(1);
    // About a 30 x 20 rectangle and a half circle of radius 10 (the solver moved the hand-placed ends a little).
    expect(Math.abs(regions[0].area / (30 * 20 + (Math.PI * 100) / 2) - 1)).toBeLessThan(0.01);
    // The solid has exactly the region's area times its height, checked in closed form.
    const g = gate(sketchFeatures(block, regions, [-20, 10, 0], 0, 'extrude', 3));
    expect(g.verdict).toBe('verified');
    expect(g.volume - 96000).toBeCloseTo(regions[0].area * 3, 3);
  });

  it('a three-point arc and constraints: perpendicular, equal, angle', () => {
    const sk = newSketch();
    const a = addLine(sk, S(0, 0), S(20, 5));
    const b = addLine(sk, snap(sk, 20, 5), S(18, 30));
    addConstraint(sk, { kind: 'perpendicular', e1: a, e2: b });
    addConstraint(sk, { kind: 'equal', e1: a, e2: b });
    dimension(sk, a, 25);
    const arc = addArc3(sk, snap(sk, 18, 30), snap(sk, 0, 0), S(-8, 18));
    expect(solve(gcs, sk).ok).toBe(true);
    expect(measure(sk, b)!.value).toBeCloseTo(25, 6);
    expect(pickEntity(sk, 10, 2.5, 3)).toBe(a);
    expect(measure(sk, arc)!.kind).toBe('radius');
    expect(profiles(sk)).toHaveLength(1);
  });

  it('names the trouble: an open profile, and conflicting dimensions', () => {
    const sk = newSketch();
    addLine(sk, S(0, 0), S(20, 0));
    addLine(sk, snap(sk, 20, 0), S(20, 10));
    expect(() => profiles(sk)).toThrow(/open at/);
    const sq = newSketch();
    const [b, , t] = addRectangle(sq, S(0, 0), S(10, 10));
    dimension(sq, b, 10);
    dimension(sq, t, 20);
    expect(solve(gcs, sq).ok).toBe(false);
  });

  it('revolves a profile into a turned part', () => {
    const sk = newSketch();
    addRectangle(sk, S(5, 0), S(15, 20));
    expect(solve(gcs, sk).ok).toBe(true);
    const p = sketchFeatures({ nf: 0 }, profiles(sk), [0, 0, 0], 4, 'revolve', 360);
    const g = gate(p);
    expect(g.volume).toBeCloseTo(Math.PI * (15 * 15 - 5 * 5) * 20, 0);
  });

  it('sketch fillet rounds a corner, tangent, at its radius', async () => {
    const { filletCorner } = await import('../src/engine/sketch2d.js');
    const sk = newSketch();
    addRectangle(sk, S(0, 0), S(40, 20));
    filletCorner(sk, 40.5, 20.4, 5);
    expect(solve(gcs, sk).ok).toBe(true);
    const [r] = profiles(sk);
    expect(r.area).toBeCloseTo(800 - (1 - Math.PI / 4) * 25, 6);
    const g = gate(sketchFeatures(block, [r], [-20, 10, 10], 0, 'extrude', 5));
    expect(g.verdict).toBe('verified');
  });

  it('trims a line back to the lines it crosses, and a circle to an arc', async () => {
    const { trimAt } = await import('../src/engine/sketch2d.js');
    const sk = newSketch();
    addRectangle(sk, S(0, 0), S(40, 20));
    const v = addLine(sk, S(20, -10), S(20, 30));
    trimAt(sk, 20, -5);
    trimAt(sk, 20, 25);
    expect(measure(sk, v)!.value).toBeCloseTo(20, 9);
    const c = newSketch();
    addCircle(c, S(0, 0), S(10, 0));
    addLine(c, S(-20, 0), S(20, 0));
    trimAt(c, 0, -10);
    expect(c.ents.some((e) => e.kind === 'arc')).toBe(true);
    expect(c.ents.some((e) => e.kind === 'circle')).toBe(false);
  });

  it('offsets a closed outline outwards: a frame with a hole', async () => {
    const { offsetEntity } = await import('../src/engine/sketch2d.js');
    const sk = newSketch();
    const [bottom] = addRectangle(sk, S(0, 0), S(40, 20));
    offsetEntity(sk, bottom, 5, { x: 20, y: -10 });
    expect(solve(gcs, sk).ok).toBe(true);
    const regions = profiles(sk);
    expect(regions).toHaveLength(1);
    expect(regions[0].area).toBeCloseTo(50 * 30 - 40 * 20, 6);
  });

  it('mirrors half a profile across a construction centre line: symmetric, closed', async () => {
    const { mirrorEntities } = await import('../src/engine/sketch2d.js');
    const sk = newSketch();
    const axis = addLine(sk, S(0, -5), S(0, 30), true);
    const a = addLine(sk, S(0, 0), S(20, 0));
    const b = addLine(sk, snap(sk, 20, 0), S(20, 10));
    const c = addLine(sk, snap(sk, 20, 10), S(0, 20));
    mirrorEntities(sk, [a, b, c], axis);
    expect(solve(gcs, sk).ok).toBe(true);
    const regions = profiles(sk);
    expect(regions).toHaveLength(1);
    expect(regions[0].area).toBeCloseTo(600, 6);
  });

  it('a spline closed by a line is a profile; its solid is exact to its own outline', async () => {
    const { addSpline } = await import('../src/engine/sketch2d.js');
    const sk = newSketch();
    addSpline(sk, [S(0, 0), S(10, 8), S(20, 6), S(30, 0)]);
    addLine(sk, snap(sk, 30, 0), snap(sk, 0, 0));
    expect(solve(gcs, sk).ok).toBe(true);
    const regions = profiles(sk);
    expect(regions).toHaveLength(1);
    expect(regions[0].area).toBeGreaterThan(100);
    const g = gate(sketchFeatures(block, regions, [-20, 10, 10], 0, 'extrude', 4));
    expect(g.verdict).toBe('verified');
    expect(g.volume - 96000).toBeCloseTo(regions[0].area * 4, 3);
  });
});

