import { describe, expect, it } from 'vitest';
import { dot3, fitAxis, IDENTITY, Instance, len3, Mate, qaxis, solveAssembly, sub, toWorld, unit, worldRef } from '../src/engine/assembly.js';
import type { Vec3 } from '../src/engine/types.js';

const inst = (id: string, p: Vec3 = [0, 0, 0], q = IDENTITY, grounded = false): Instance => ({ id, name: id, job: 'design', params: {}, material: 'pla', pose: { p, q }, grounded });

describe('assembly mates', () => {
  // A plate grounded at the origin with a vertical hole at (20, 0, 0); its top face at y = 5.
  const plate = inst('plate', [0, 0, 0], IDENTITY, true);
  const hole = { kind: 'axis' as const, point: [20, 0, 0] as Vec3, dir: [0, 1, 0] as Vec3 };
  const top = { kind: 'plane' as const, point: [0, 5, 0] as Vec3, dir: [0, 1, 0] as Vec3 };
  // A pin whose own axis is its local Z and whose head underside faces -Z at z = 0; placed anywhere, tilted.
  const pinAxis = { kind: 'axis' as const, point: [0, 0, 0] as Vec3, dir: [0, 0, 1] as Vec3 };
  const pinHead = { kind: 'plane' as const, point: [0, 0, 0] as Vec3, dir: [0, 0, -1] as Vec3 };
  const pin = inst('pin', [100, 40, -30], qaxis([1, 1, 0], 0.7));

  it('puts a pin in a hole (concentric) and its head flush on the plate (coincident)', () => {
    const mates: Mate[] = [
      { id: 'm1', kind: 'concentric', a: 'pin', ra: pinAxis, b: 'plate', rb: hole },
      { id: 'm2', kind: 'coincident', a: 'pin', ra: pinHead, b: 'plate', rb: top },
    ];
    const r = solveAssembly([plate, pin], mates);
    expect(r.failed).toEqual([]);
    const P = r.instances.find((i) => i.id === 'pin')!;
    const axis = worldRef(P, pinAxis);
    // On the hole's line: parallel to Y, through x = 20, z = 0.
    expect(Math.abs(dot3(axis.dir, [0, 1, 0]))).toBeCloseTo(1, 9);
    expect(axis.point[0]).toBeCloseTo(20, 9);
    expect(axis.point[2]).toBeCloseTo(0, 9);
    // Head flush on the top face.
    const head = worldRef(P, pinHead);
    expect(head.point[1]).toBeCloseTo(5, 9);
    expect(head.dir[1]).toBeCloseTo(-1, 9);
  });

  it('turns a hinge to its driven angle and a gear follows by its ratio', () => {
    const marker: Vec3 = [10, 0, 0];
    const at = (deg: number): Vec3 => {
      const mates: Mate[] = [
        { id: 'h', kind: 'hinge', a: 'pin', ra: pinAxis, b: 'plate', rb: hole, value: deg },
        { id: 'm2', kind: 'coincident', a: 'pin', ra: pinHead, b: 'plate', rb: top },
      ];
      const r = solveAssembly([plate, pin], mates);
      return toWorld(r.instances.find((i) => i.id === 'pin')!.pose, marker);
    };
    const a0 = sub(at(0), [20, 0, 0]);
    const a90 = sub(at(90), [20, 0, 0]);
    // A point 10 mm off the axis turns through 90 degrees about Y, staying 10 mm out.
    const flat = (v: Vec3): Vec3 => unit([v[0], 0, v[2]]);
    expect(dot3(flat(a0), flat(a90))).toBeCloseTo(0, 6);
    expect(Math.hypot(a90[0], a90[2])).toBeCloseTo(10, 6);

    // Gear: a second pin in a second hole, following the first at ratio 2.
    const hole2 = { kind: 'axis' as const, point: [60, 0, 0] as Vec3, dir: [0, 1, 0] as Vec3 };
    const pin2 = inst('pin2', [0, 80, 0]);
    const r = solveAssembly([plate, pin, pin2], [
      { id: 'h', kind: 'hinge', a: 'pin', ra: pinAxis, b: 'plate', rb: hole, value: 30 },
      { id: 'g', kind: 'gear', a: 'pin2', ra: pinAxis, b: 'plate', rb: hole2, follows: 'h', ratio: 2 },
    ]);
    expect(r.failed).toEqual([]);
    const P2 = r.instances.find((i) => i.id === 'pin2')!;
    const g0 = solveAssembly([plate, pin, pin2], [
      { id: 'h', kind: 'hinge', a: 'pin', ra: pinAxis, b: 'plate', rb: hole, value: 0 },
      { id: 'g', kind: 'gear', a: 'pin2', ra: pinAxis, b: 'plate', rb: hole2, follows: 'h', ratio: 2 },
    ]).instances.find((i) => i.id === 'pin2')!;
    const v0 = flatOff(toWorld(g0.pose, marker));
    const v1 = flatOff(toWorld(P2.pose, marker));
    const turned = (Math.acos(Math.max(-1, Math.min(1, dot3(v0, v1)))) * 180) / Math.PI;
    expect(turned).toBeCloseTo(60, 4);
    function flatOff(v: Vec3): Vec3 {
      return unit([v[0] - 60, 0, v[2]]);
    }
  });

  it('fits the axis of a round surface from mesh points and normals', () => {
    // A cylinder of radius 6 about the line through (5, 0, -3) along (1, 1, 0)/sqrt2.
    const axis = unit([1, 1, 0]);
    const c: Vec3 = [5, 0, -3];
    const e1 = unit([1, -1, 0]);
    const e2: Vec3 = [0, 0, 1];
    const pos: number[] = [];
    const nrm: number[] = [];
    for (let i = 0; i < 24; i++) {
      for (let k = -2; k <= 2; k++) {
        const t = (2 * Math.PI * i) / 24;
        const n: Vec3 = [e1[0] * Math.cos(t) + e2[0] * Math.sin(t), e1[1] * Math.cos(t) + e2[1] * Math.sin(t), e1[2] * Math.cos(t) + e2[2] * Math.sin(t)];
        const p: Vec3 = [c[0] + axis[0] * k * 3 + n[0] * 6, c[1] + axis[1] * k * 3 + n[1] * 6, c[2] + axis[2] * k * 3 + n[2] * 6];
        pos.push(...p);
        nrm.push(...n);
      }
    }
    const r = fitAxis(pos, nrm, [c[0] + 6 * e2[0], c[1], c[2] + 6], 30)!;
    expect(r).not.toBeNull();
    expect(Math.abs(dot3(r.dir, axis))).toBeCloseTo(1, 6);
    // Distance from the fitted point to the true axis line is ~0.
    const d = sub(r.point, c);
    const perp = sub(d, [axis[0] * dot3(d, axis), axis[1] * dot3(d, axis), axis[2] * dot3(d, axis)]);
    expect(len3(perp)).toBeLessThan(1e-6);
    // A flat patch is not an axis.
    const flat = fitAxis([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 2, 0, 0, 2, 0, 2], [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], [1, 0, 1], 5);
    expect(flat).toBeNull();
  });
});
