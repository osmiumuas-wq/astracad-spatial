import { beforeAll, describe, expect, it } from 'vitest';
import { expectVolume } from '../src/engine/expect.js';
import { defaultParams, JOBS } from '../src/engine/jobs.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { loopIntegrals, polygonArea, tessellateLoop } from '../src/engine/sketch.js';
import { runGate } from '../src/engine/truth.js';
import { PartSpec, Seg } from '../src/engine/types.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

/** Deterministic pseudo-random numbers, so a failing case can be replayed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('equal-area tessellation', () => {
  it('encloses the exact area of a loop with concave and convex arcs', () => {
    const loop: Seg[] = [
      ['L', 0, 0, 30, 0],
      ['A', 30, 10, 30, 0, 40, 10, 1],
      ['L', 40, 10, 40, 30],
      ['L', 40, 30, 12, 30],
      ['A', 12, 22, 12, 30, 4, 22, 1],
      ['L', 4, 22, 4, 14],
      ['A', 0, 14, 4, 14, 0, 10, -1],
      ['L', 0, 10, 0, 0],
    ];
    const exact = loopIntegrals(loop).area;
    const poly = polygonArea(tessellateLoop(loop));
    expect(rel(poly, exact)).toBeLessThan(1e-12);
  });

  it('gives a circle its true area', () => {
    for (const r of [0.8, 3, 15, 60]) {
      const poly = polygonArea(tessellateLoop([['C', 2, -1, r]]));
      expect(rel(poly, Math.PI * r * r)).toBeLessThan(1e-12);
    }
  });
});

describe('reference specifications from desktop AstraCAD', () => {
  it('cylinder: 17671.4587 mm3', () => {
    const spec: PartSpec = {
      language: 2,
      name: 'cylinder',
      units: 'mm',
      features: [
        { $op: 'sketch.circle', id: 'disc', sketched_on: 'front', args: { radius: 15, x: 0, y: 0 } },
        { $op: 'feature.extrude', id: 'body', args: { depth: 25 } },
      ],
    };
    const out = kernel.build(spec);
    expect(rel(out.props.volume, Math.PI * 225 * 25)).toBeLessThan(1e-9);
    expect(expectVolume(spec).volume).toBeCloseTo(17671.4587, 3);
  });

  it('prism with a through hole: 46429.2037 mm3', () => {
    const spec: PartSpec = {
      language: 2,
      name: 'prism_hole',
      units: 'mm',
      features: [
        { $op: 'sketch.rectangle', id: 'outline', sketched_on: 'front', args: { width: 60, height: 40 } },
        { $op: 'feature.extrude', id: 'body', args: { depth: 20 } },
        { $op: 'feature.hole', id: 'bore', sketched_on: 'front', args: { diameter: 10, through_all: true, center: [30, 20] } },
      ],
    };
    const out = kernel.build(spec);
    const hand = 48000 - Math.PI * 25 * 20;
    expect(rel(out.props.volume, hand)).toBeLessThan(1e-9);
    expect(rel(expectVolume(spec).volume as number, hand)).toBeLessThan(1e-12);
    expect(out.props.genus).toBe(1);
  });

  it('counterbore and countersink match cylinders and cones', () => {
    const base = (hole: Record<string, unknown>): PartSpec => ({
      language: 2,
      name: 'plate',
      units: 'mm',
      features: [
        { $op: 'sketch.rectangle', id: 'o', sketched_on: 'top', args: { width: 50, height: 30, x: -25, y: -15 } },
        { $op: 'feature.extrude', id: 'b', args: { depth: 12 } },
        { $op: 'ref.plane', id: 'deck', args: { base: 'top', offset: 12 } },
        { $op: 'feature.hole', id: 'h', sketched_on: 'deck', args: hole },
      ],
    });
    const cbore = base({ diameter: 5.5, depth: 12, direction: 'reverse', type: 'counterbore', cbore_diameter: 10, cbore_depth: 5, centers: [[0, 0]] });
    const handCb = 50 * 30 * 12 - Math.PI * 2.75 ** 2 * 12 - Math.PI * (25 - 2.75 ** 2) * 5;
    expect(rel(kernel.build(cbore).props.volume, handCb)).toBeLessThan(1e-9);
    expect(rel(expectVolume(cbore).volume as number, handCb)).toBeLessThan(1e-12);

    const csk = base({ diameter: 5, depth: 12, direction: 'reverse', type: 'countersink', csk_diameter: 10, csk_angle: 90, centers: [[4, 2]] });
    const h = 2.5;
    const handCsk = 50 * 30 * 12 - Math.PI * 2.5 ** 2 * 12 - ((Math.PI * h * (25 + 12.5 + 6.25)) / 3 - Math.PI * 6.25 * h);
    expect(rel(kernel.build(csk).props.volume, handCsk)).toBeLessThan(1e-9);
    expect(rel(expectVolume(csk).volume as number, handCsk)).toBeLessThan(1e-12);
  });
});

describe('every job passes the truth gate', () => {
  for (const job of JOBS) {
    it(`${job.id}: default and 25 random parameter sets`, () => {
      const rand = rng(job.id.length * 7919 + 17);
      let worst = 0;
      for (let k = 0; k < 26; k++) {
        const raw = defaultParams(job);
        if (k > 0) {
          for (const d of job.params) {
            raw[d.id] = d.min + rand() * (d.max - d.min);
          }
        }
        const { params } = job.clamp(raw);
        const spec = job.spec(params);
        const out = kernel.build(spec);
        const gate = runGate({
          props: out.props,
          generic: expectVolume(spec),
          jobVolume: job.volume(params),
          jobBox: job.box(params),
          jobGenus: job.genus(params),
        });
        const failed = gate.checks.filter((c) => c.status === 'fail');
        expect(failed, `${job.id} ${JSON.stringify(params)} -> ${JSON.stringify(failed)}`).toEqual([]);
        expect(gate.verdict).toBe('verified');
        for (const c of gate.checks) {
          if (c.id === 'job-formula' || c.id === 'closed-form') {
            worst = Math.max(worst, c.delta ?? 0);
          }
        }
      }
      console.log(`${job.id}: worst relative volume difference ${worst.toExponential(2)}`);
      expect(worst).toBeLessThan(1e-6);
    });
  }
});

describe('the language is strict', () => {
  const ok: PartSpec = {
    language: 2,
    name: 'p',
    units: 'mm',
    features: [
      { $op: 'sketch.rectangle', id: 's', sketched_on: 'front', args: { width: 10, height: 10 } },
      { $op: 'feature.extrude', id: 'b', args: { depth: 5 } },
    ],
  };
  it('refuses an unknown operation, an unknown argument and desktop-only operations by name', () => {
    const bad = (f: PartSpec['features'][number]): PartSpec => ({ ...ok, features: [...ok.features, f] });
    expect(() => kernel.build(bad({ $op: 'feature.magic', id: 'm', args: {} }))).toThrow(/unknown operation/);
    expect(() =>
      kernel.build({ ...ok, features: [ok.features[0], { $op: 'feature.extrude', id: 'b', args: { depth: 5, taper: 3 } }] }),
    ).toThrow(/unknown argument "taper"/);
    expect(() => kernel.build(bad({ $op: 'feature.fillet', id: 'f', args: { radius: 2 } }))).toThrow(/desktop B-rep/);
  });
  it('refuses a sketch that is never used', () => {
    expect(() =>
      kernel.build({ ...ok, features: [...ok.features, { $op: 'sketch.circle', id: 'c', sketched_on: 'front', args: { radius: 1 } }] }),
    ).toThrow(/never used/);
  });
  it('rolls back to an earlier feature', () => {
    const job = JOBS.find((j) => j.id === 'flange-plate')!;
    const spec = job.spec(defaultParams(job));
    const full = kernel.build(spec);
    const plateOnly = kernel.build(spec, 2);
    expect(plateOnly.applied).toEqual(['disc', 'plate']);
    expect(plateOnly.props.volume).toBeGreaterThan(full.props.volume);
    expect(plateOnly.props.genus).toBe(1);
  });
});
