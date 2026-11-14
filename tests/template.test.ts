import { describe, expect, it } from 'vitest';
import { describeHoles, loopArea, mountingNormal, templateOf } from '../src/engine/template.js';
import type { Vec2 } from '../src/engine/types.js';

const circle = (cx: number, cy: number, r: number, cw: boolean): Vec2[] =>
  Array.from({ length: 64 }, (_, i) => {
    const a = ((cw ? -1 : 1) * 2 * Math.PI * i) / 64;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Vec2;
  });

describe('drilling template', () => {
  it('finds the outline and two round holes with their spacing', () => {
    const outline: Vec2[] = [[0, 0], [70, 0], [70, 24], [0, 24]];
    const t = templateOf([outline, circle(13, 12, 2.1, true), circle(57, 12, 2.1, true)]);
    expect(t.outline).toBe(outline);
    expect(t.holes).toHaveLength(2);
    // A 64-gon has a little less area than its circle.
    expect(t.holes[0].d).toBeCloseTo(4.2, 1);
    expect(describeHoles(t.holes)).toBe('2 holes, 4.2 mm, 44.0 mm apart');
  });

  it('computes signed area and centroid', () => {
    const { area, c } = loopArea([[0, 0], [10, 0], [10, 4], [0, 4]]);
    expect(area).toBe(40);
    expect(c[0]).toBeCloseTo(5, 9);
    expect(c[1]).toBeCloseTo(2, 9);
  });

  it('takes the mounting face from the side the fixture holds', () => {
    const box = { min: [0, 0, -12] as [number, number, number], max: [70, 70, 12] as [number, number, number] };
    // A thin fixture box along the back (x = 0) face.
    expect(mountingNormal([{ kind: 'box', min: [-1, 0, -13], max: [0.5, 70, 13] }], box)).toEqual([-1, 0, 0]);
    // A thin box on the bottom.
    expect(mountingNormal([{ kind: 'box', min: [0, -1, -13], max: [70, 0.5, 13] }], box)).toEqual([0, -1, 0]);
  });
});
