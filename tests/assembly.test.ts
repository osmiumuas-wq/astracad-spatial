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

describe('saving and sharing an assembly', () => {
  it('round-trips through a link and refuses garbage', async () => {
    const { encodeAssembly, decodeAssembly } = await import('../src/engine/assembly.js');
    const doc = {
      instances: [inst('a', [0, 0, 0], IDENTITY, true), { ...inst('b', [1.5, -2, 3], qaxis([0, 1, 0], 0.4)), params: { nf: 1, a0: 12.25 } }],
      mates: [{ id: 'm1', kind: 'hinge' as const, a: 'b', ra: { kind: 'axis' as const, point: [1, 2, 3] as Vec3, dir: [0, 1, 0] as Vec3 }, b: 'a', rb: { kind: 'plane' as const, point: [0, 5, 0] as Vec3, dir: [0, 1, 0] as Vec3 }, value: 45 }],
    };
    const back = decodeAssembly(encodeAssembly(doc), (j) => j === 'design')!;
    expect(back.instances.map((i) => i.id)).toEqual(['a', 'b']);
    expect(back.instances[1].params.a0).toBe(12.25);
    expect(back.instances[1].pose.q[1]).toBeCloseTo(Math.sin(0.2), 6);
    expect(back.mates[0]).toMatchObject({ kind: 'hinge', a: 'b', b: 'a', value: 45 });
    expect(back.mates[0].ra.kind).toBe('axis');
    expect(decodeAssembly('not-a-link', () => true)).toBeNull();
    expect(decodeAssembly(encodeAssembly(doc), (j) => j !== 'design')).toBeNull();
  });
});

describe('closed loops', () => {
  it('solves a four-bar linkage and matches Freudenstein at every crank angle', () => {
    const ax = (x: number): { kind: 'axis'; point: Vec3; dir: Vec3 } => ({ kind: 'axis', point: [x, 0, 0], dir: [0, 0, 1] });
    const a = 15, b = 40, c = 35, d = 40;
    const ground = inst('ground', [0, 0, 0], IDENTITY, true);
    for (const deg of [10, 60, 120, 200, 300]) {
      const crank = inst('crank', [3, 5, 0], qaxis([0, 0, 1], 0.3));
      const coupler = inst('coupler', [10, 30, 0], qaxis([0, 0, 1], 0.2));
      const rocker = inst('rocker', [40, 0, 0], qaxis([0, 0, 1], 1.4));
      const mates: Mate[] = [
        { id: 'h', kind: 'hinge', a: 'crank', ra: ax(0), b: 'ground', rb: ax(0), value: deg },
        { id: 'r', kind: 'concentric', a: 'rocker', ra: ax(0), b: 'ground', rb: ax(d) },
        { id: 'c1', kind: 'concentric', a: 'coupler', ra: ax(0), b: 'crank', rb: ax(a) },
        { id: 'c2', kind: 'concentric', a: 'coupler', ra: ax(b), b: 'rocker', rb: ax(c) },
      ];
      const r = solveAssembly([ground, crank, coupler, rocker], mates);
      expect(r.failed).toEqual([]);
      const get = (id: string): Instance => r.instances.find((i) => i.id === id)!;
      const t = (Math.PI * deg) / 180;
      // The crank tip is where the crank angle says; both coupler holes sit on their pins.
      const tip = toWorld(get('crank').pose, [a, 0, 0]);
      expect(tip[0]).toBeCloseTo(a * Math.cos(t), 5);
      expect(tip[1]).toBeCloseTo(a * Math.sin(t), 5);
      expect(len3(sub(toWorld(get('coupler').pose, [0, 0, 0]), tip))).toBeLessThan(1e-5);
      const P = toWorld(get('rocker').pose, [c, 0, 0]);
      expect(len3(sub(toWorld(get('coupler').pose, [b, 0, 0]), P))).toBeLessThan(1e-5);
      // Freudenstein: the rocker angle is one of the two closed-form solutions.
      const K1 = d / a, K2 = d / c, K3 = (a * a - b * b + c * c + d * d) / (2 * a * c);
      const A = Math.cos(t) - K1 - K2 * Math.cos(t) + K3;
      const B = -2 * Math.sin(t);
      const C = K1 - (K2 + 1) * Math.cos(t) + K3;
      const disc = Math.sqrt(B * B - 4 * A * C);
      const sols = [2 * Math.atan2(-B + disc, 2 * A), 2 * Math.atan2(-B - disc, 2 * A)];
      const got = Math.atan2(P[1], P[0] - d);
      const diff = Math.min(...sols.map((s) => Math.abs(Math.atan2(Math.sin(s - got), Math.cos(s - got)))));
      expect(diff).toBeLessThan(1e-5);
    }
  });
});

describe('screw, rack and pinion, limits', () => {
  const ax = (x: number): { kind: 'axis'; point: Vec3; dir: Vec3 } => ({ kind: 'axis', point: [x, 0, 0], dir: [0, 1, 0] });
  const plane = (y: number, up: boolean): { kind: 'plane'; point: Vec3; dir: Vec3 } => ({ kind: 'plane', point: [0, y, 0], dir: [0, up ? 1 : -1, 0] });

  it('a screw advances its pitch per turn', () => {
    const base = inst('base', [0, 0, 0], IDENTITY, true);
    const nut = inst('nut', [5, 3, 1], qaxis([0, 1, 0], 0.4));
    for (const deg of [0, 90, 720]) {
      const r = solveAssembly([base, nut], [{ id: 's', kind: 'screw', a: 'nut', ra: ax(0), b: 'base', rb: ax(0), value: deg, pitch: 1.25 }]);
      expect(r.failed).toEqual([]);
      const p = toWorld(r.instances.find((i) => i.id === 'nut')!.pose, [0, 0, 0]);
      expect(p[1]).toBeCloseTo((1.25 * deg) / 360, 6);
      expect(Math.hypot(p[0], p[2])).toBeLessThan(1e-6);
    }
  });

  it('a rack slides with its pinion, and a hinge stops at its limit', () => {
    const frame = inst('frame', [0, 0, 0], IDENTITY, true);
    const pinion = inst('pinion', [0, 0, 0]);
    const rack = inst('rack', [10, 0, 3]);
    // Pinion of pitch radius 10: one degree of turn moves the rack 2 pi 10 / 360 mm.
    const k = (2 * Math.PI * 10) / 360;
    const mates: Mate[] = [
      { id: 'h', kind: 'hinge', a: 'pinion', ra: ax(0), b: 'frame', rb: ax(0), value: 45, min: -30, max: 30 },
      { id: 'r', kind: 'rack', a: 'rack', ra: plane(0, false), b: 'frame', rb: plane(5, true), follows: 'h', ratio: k },
    ];
    const r = solveAssembly([frame, pinion, rack], mates);
    expect(r.failed).toEqual([]);
    // The hinge stops at 30 degrees, and the rack moves 30 k.
    const R = r.instances.find((i) => i.id === 'rack')!;
    const travel = toWorld(R.pose, [0, 0, 0]);
    // The slide runs along the face's first in-plane direction, here -z; the rack keeps its free sideways place.
    expect(-travel[2]).toBeCloseTo(30 * k, 5);
    expect(travel[1]).toBeCloseTo(5, 6);
  });
});
