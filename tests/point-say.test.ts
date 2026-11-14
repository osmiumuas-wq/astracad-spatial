import { describe, expect, it } from 'vitest';
import { deicticEdit } from '../src/engine/commands.js';

describe('point and say', () => {
  it('reads relative and absolute edits about "this"', () => {
    expect(deicticEdit('make this thicker', 10)).toBeCloseTo(12, 9);
    expect(deicticEdit('this a bit thinner', 12)).toBeCloseTo(10, 9);
    expect(deicticEdit('this 5 mm longer', 40)).toBe(45);
    expect(deicticEdit('make that three millimetres shorter', 40)).toBe(37);
    expect(deicticEdit('this 2 cm wider', 40)).toBe(60);
    expect(deicticEdit('make this 12 mm', 40)).toBe(12);
    expect(deicticEdit('double this', 7)).toBe(14);
  });

  it('ignores sentences that are not about the pointed spot', () => {
    expect(deicticEdit('make the arm longer', 40)).toBeNull();
    expect(deicticEdit('this is nice', 40)).toBeNull();
  });
});
