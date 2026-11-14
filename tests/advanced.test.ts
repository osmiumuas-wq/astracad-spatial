// Fillet, shell, loft and sweep on the headset kernel: each part is built, checked by the generic
// closed form, and also against a formula written here by hand. The gate must say "verified".
import { beforeAll, describe, expect, it } from 'vitest';
import { expectVolume } from '../src/engine/expect.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { runGate } from '../src/engine/truth.js';
import { Feature, PartSpec } from '../src/engine/types.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

const spec = (features: Feature[]): PartSpec => ({ units: 'mm', features } as PartSpec);
const PI = Math.PI;
/** Area a round of radius r takes from a 90 degree corner. */
const corner = (r: number): number => r * r * (1 - PI / 4);

function check(features: Feature[], hand: number): void {
  const s = spec(features);
  const out = kernel.build(s);
  const generic = expectVolume(s);
  const gate = runGate({ props: out.props, generic, jobVolume: hand });
  expect(generic.volume, generic.reason).not.toBeNull();
  expect(Math.abs(out.props.volume - hand) / hand).toBeLessThan(1e-5);
  expect(gate.verdict, JSON.stringify(gate.checks)).toBe('verified');
}

describe('fillet', () => {
  it('rounds the four corners of a plate', () => {
    check(
      [
        { $op: 'sketch.rectangle', id: 's', sketched_on: 'front', args: { width: 60, height: 40 } },
        { $op: 'feature.extrude', id: 'plate', args: { depth: 10 } },
        { $op: 'feature.fillet', id: 'round', args: { radius: 5, feature: 'plate' } },
      ] as Feature[],
      (2400 - 4 * corner(5)) * 10,
    );
  });

  it('rounds inside corners too (an L bracket)', () => {
    check(
      [
        {
          $op: 'sketch.profile',
          id: 's',
          sketched_on: 'front',
          args: { points: [[0, 0], [40, 0], [40, 10], [10, 10], [10, 30], [0, 30]] },
        },
        { $op: 'feature.extrude', id: 'l', args: { depth: 8 } },
        { $op: 'feature.fillet', id: 'round', args: { radius: 3, feature: 'l' } },
      ] as Feature[],
      // Five outside corners lose a round's area, the inside corner gains one.
      (600 - 5 * corner(3) + corner(3)) * 8,
    );
  });

  it('refuses a radius too big for an edge', () => {
    const s = spec([
      { $op: 'sketch.rectangle', id: 's', sketched_on: 'front', args: { width: 20, height: 8 } },
      { $op: 'feature.extrude', id: 'p', args: { depth: 5 } },
      { $op: 'feature.fillet', id: 'f', args: { radius: 5, feature: 'p' } },
    ] as Feature[]);
    expect(() => kernel.build(s)).toThrow(/too large/);
  });

  it('comes off when the history is rolled back before it', () => {
    const s = spec([
      { $op: 'sketch.rectangle', id: 's', sketched_on: 'front', args: { width: 60, height: 40 } },
      { $op: 'feature.extrude', id: 'plate', args: { depth: 10 } },
      { $op: 'feature.fillet', id: 'round', args: { radius: 5, feature: 'plate' } },
    ] as Feature[]);
    expect(kernel.build(s, 2).props.volume).toBeCloseTo(24000, 3);
  });
});

describe('shell', () => {
  it('hollows a box, open at the far face', () => {
    check(
      [
        { $op: 'sketch.rectangle', id: 's', sketched_on: 'front', args: { width: 60, height: 40 } },
        { $op: 'feature.extrude', id: 'box', args: { depth: 30 } },
        { $op: 'feature.shell', id: 'hollow', args: { thickness: 2, feature: 'box' } },
      ] as Feature[],
      60 * 40 * 30 - 56 * 36 * 28,
    );
  });

  it('hollows a rounded box: inner corners stay concentric', () => {
    check(
      [
        { $op: 'sketch.rectangle', id: 's', sketched_on: 'front', args: { width: 60, height: 40 } },
        { $op: 'feature.extrude', id: 'box', args: { depth: 30 } },
        { $op: 'feature.fillet', id: 'round', args: { radius: 5, feature: 'box' } },
        { $op: 'feature.shell', id: 'hollow', args: { thickness: 2, feature: 'box' } },
      ] as Feature[],
      (2400 - 4 * corner(5)) * 30 - (56 * 36 - 4 * corner(3)) * 28,
    );
  });

  it('makes a closed hollow cylinder', () => {
    check(
      [
        { $op: 'sketch.circle', id: 's', sketched_on: 'front', args: { radius: 20 } },
        { $op: 'feature.extrude', id: 'can', args: { depth: 50 } },
        { $op: 'feature.shell', id: 'hollow', args: { thickness: 3, feature: 'can', open: 'none' } },
      ] as Feature[],
      PI * 400 * 50 - PI * 289 * 44,
    );
  });

  it('refuses a wall thicker than the part', () => {
    const s = spec([
      { $op: 'sketch.rectangle', id: 's', sketched_on: 'front', args: { width: 10, height: 10 } },
      { $op: 'feature.extrude', id: 'b', args: { depth: 10 } },
      { $op: 'feature.shell', id: 'h', args: { thickness: 6, feature: 'b' } },
    ] as Feature[]);
    expect(() => kernel.build(s)).toThrow();
  });
});

describe('loft', () => {
  it('lofts a circle to a smaller circle: a frustum', () => {
    check(
      [
        { $op: 'ref.plane', id: 'up', args: { base: 'front', offset: 30 } },
        { $op: 'sketch.circle', id: 'a', sketched_on: 'front', args: { radius: 20 } },
        { $op: 'sketch.circle', id: 'b', sketched_on: 'up', args: { radius: 10 } },
        { $op: 'feature.loft', id: 'cone', args: { sketches: ['a', 'b'] } },
      ] as Feature[],
      (PI * 30 * (400 + 200 + 100)) / 3,
    );
  });

  it('lofts a square to a smaller square: a pyramid frustum', () => {
    check(
      [
        { $op: 'ref.plane', id: 'up', args: { base: 'front', offset: 30 } },
        { $op: 'sketch.rectangle', id: 'a', sketched_on: 'front', args: { width: 40, height: 40, x: -20, y: -20 } },
        { $op: 'sketch.rectangle', id: 'b', sketched_on: 'up', args: { width: 20, height: 20, x: -10, y: -10 } },
        { $op: 'feature.loft', id: 'p', args: { sketches: ['a', 'b'] } },
      ] as Feature[],
      (30 / 3) * (1600 + 400 + Math.sqrt(1600 * 400)),
    );
  });

  it('lofts through three circles', () => {
    check(
      [
        { $op: 'ref.plane', id: 'p1', args: { base: 'front', offset: 20 } },
        { $op: 'ref.plane', id: 'p2', args: { base: 'front', offset: 50 } },
        { $op: 'sketch.circle', id: 'a', sketched_on: 'front', args: { radius: 10 } },
        { $op: 'sketch.circle', id: 'b', sketched_on: 'p1', args: { radius: 25 } },
        { $op: 'sketch.circle', id: 'c', sketched_on: 'p2', args: { radius: 15 } },
        { $op: 'feature.loft', id: 'vase', args: { sketches: ['a', 'b', 'c'] } },
      ] as Feature[],
      (PI * 20 * (100 + 250 + 625)) / 3 + (PI * 30 * (625 + 375 + 225)) / 3,
    );
  });
});

describe('sweep', () => {
  it('sweeps a rod round a 90 degree bend', () => {
    const r = 5;
    const R = 15;
    check(
      [
        { $op: 'sketch.circle', id: 's', sketched_on: 'front', args: { radius: r } },
        { $op: 'feature.sweep', id: 'rod', args: { path: [[0, 0, 0], [0, 0, 50], [50, 0, 50]], bend_radius: R } },
      ] as Feature[],
      // Straight runs shortened by the bend's tangent length R, plus Pappus for the quarter torus.
      PI * r * r * (50 - R + 50 - R) + (PI / 2) * PI * r * r * R,
    );
  });

  it('sweeps a tube (a profile with an opening) along a three-run path', () => {
    const R = 12;
    const A = PI * (36 - 16);
    check(
      [
        { $op: 'sketch.loops', id: 's', sketched_on: 'front', args: { loops: [[['C', 0, 0, 6]], [['C', 0, 0, 4]]] } },
        {
          $op: 'feature.sweep',
          id: 'pipe',
          args: { path: [[0, 0, 0], [0, 0, 40], [40, 0, 40], [40, 40, 40]], bend_radius: R },
        },
      ] as Feature[],
      A * (40 - R + 40 - 2 * R + 40 - R) + 2 * (PI / 2) * A * R,
    );
  });

  it('refuses a path that does not start on the profile', () => {
    const s = spec([
      { $op: 'sketch.circle', id: 's', sketched_on: 'front', args: { radius: 5 } },
      { $op: 'feature.sweep', id: 'rod', args: { path: [[0, 0, 3], [0, 0, 20]] } },
    ] as Feature[]);
    expect(() => kernel.build(s)).toThrow(/start on the profile/);
  });
});
