import { describe as suite, expect, it } from 'vitest';
import { answer, describe, Described } from '../src/engine/describe.js';
import { jobById } from '../src/engine/jobs.js';

const ok = (text: string): Described => {
  const r = describe(text);
  if ('error' in r) throw new Error(r.error);
  return r;
};

suite('describe it', () => {
  it('reads a wall bracket with named dimensions, a screw size and a material', () => {
    const r = ok('Wall bracket, 100 mm arm, 80 high, 30 wide, 4 mm thick, M5 screws, PETG');
    expect(r.job).toBe('wall-bracket');
    expect(r.params).toMatchObject({ arm: 100, height: 80, w: 30, t: 4, d: 5.5 });
    expect(r.material).toBe('petg');
    expect(r.ask).toEqual([]);
  });

  it('reads a flange with bolt count, pitch circle and bore', () => {
    const r = ok('flange 90 mm diameter with a 30 bore, 6 x M6 on a 70 pcd, 10 thick');
    expect(r.job).toBe('flange-plate');
    expect(r.params).toMatchObject({ D: 90, B: 30, N: 6, bcd: 70, d: 6.6, th: 10 });
  });

  it('fills a cradle from L x W x H and asks nothing more', () => {
    const r = ok('cradle for a 75 x 40 x 12 phone');
    expect(r.params).toMatchObject({ L: 75, W: 40, H: 12 });
    expect(r.ask).toEqual([]);
  });

  it('asks for every key dimension it was not given', () => {
    const r = ok('a cradle please');
    expect(r.ask.map((q) => q.id)).toEqual(['L', 'W', 'H']);
    const p = answer(r, { L: 90, W: 50, H: 15 });
    expect(p).toMatchObject({ L: 90, W: 50, H: 15 });
  });

  it('makes a block and a disc from the sketch part', () => {
    const b = ok('block 60x40x20 in aluminium');
    expect(b.job).toBe('sketch');
    expect(b.material).toBe('al6061');
    const clamped = jobById('sketch').clamp(b.params).params;
    expect(clamped.x1 - clamped.x0).toBe(60);
    expect(clamped.y2 - clamped.y1).toBe(40);
    expect(clamped.h).toBe(20);
    const d = ok('disc 50 diameter, 6 thick');
    expect(d.params).toMatchObject({ kind: 1, r: 25, h: 6 });
  });

  it('reads a knob for a shaft and a hinge from L x W x t', () => {
    expect(ok('knob for a 6 mm shaft, 30 mm diameter').params).toMatchObject({ bore: 6, D: 30 });
    expect(ok('hinge 60 x 25 x 4').params).toMatchObject({ L: 60, W: 25, t: 4 });
  });

  it('says so when it cannot tell the part', () => {
    expect(describe('something nice')).toHaveProperty('error');
  });
});
