import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { layFlat, Occt, readStep, recognise } from '../src/engine/step-import.js';

const require = createRequire(import.meta.url);

async function occt(): Promise<Occt> {
  const factory = require('occt-import-js') as () => Promise<Occt>;
  return factory();
}

describe('STEP import', () => {
  it('reads a 60 x 40 x 20 block with the exact volume', async () => {
    const o = await occt();
    const bytes = new Uint8Array(readFileSync(new URL('./fixtures/block_60x40x20.step', import.meta.url)));
    const m = readStep(o, bytes, 'block');
    expect(m.closed).toBe(true);
    expect(m.volume).toBeCloseTo(60 * 40 * 20, 3);
    const ext = [0, 1, 2].map((a) => m.box.max[a] - m.box.min[a]).sort((a, b) => a - b);
    expect(ext[0]).toBeCloseTo(20, 4);
    expect(ext[1]).toBeCloseTo(40, 4);
    expect(ext[2]).toBeCloseTo(60, 4);
    const flat = layFlat(m);
    expect(flat.box.max[1] - flat.box.min[1]).toBeCloseTo(20, 4);
    expect(flat.box.min[1]).toBeCloseTo(0, 6);
    expect(flat.volume).toBeCloseTo(m.volume, 3);
  }, 60000);

  it('recognises the block and the shaft as editable shapes', async () => {
    const o = await occt();
    const block = layFlat(readStep(o, new Uint8Array(readFileSync(new URL('./fixtures/block_60x40x20.step', import.meta.url))), 'block'));
    const r1 = recognise(block);
    expect(r1?.shape).toBe('block');
    if (r1?.shape === 'block') {
      expect(r1.x).toBeCloseTo(60, 4);
      expect(r1.y).toBeCloseTo(40, 4);
      expect(r1.h).toBeCloseTo(20, 4);
    }
    const shaft = layFlat(readStep(o, new Uint8Array(readFileSync(new URL('./fixtures/shaft_d25_l100.step', import.meta.url))), 'shaft'));
    const r2 = recognise(shaft);
    expect(r2?.shape).toBe('cylinder');
    if (r2?.shape === 'cylinder') {
      expect(r2.d).toBe(25);
      expect(r2.h).toBeCloseTo(100, 3);
    }
  }, 60000);

  it('reads a shaft (25 mm across, 100 long) close to the exact cylinder', async () => {
    const o = await occt();
    const bytes = new Uint8Array(readFileSync(new URL('./fixtures/shaft_d25_l100.step', import.meta.url)));
    const m = readStep(o, bytes, 'shaft');
    expect(m.closed).toBe(true);
    const exact = Math.PI * 12.5 ** 2 * 100;
    // Chords cut inside the arcs: a little under, never over.
    expect(m.volume).toBeLessThan(exact);
    expect((exact - m.volume) / exact).toBeLessThan(0.005);
  }, 60000);
});
