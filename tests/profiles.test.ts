import { describe, expect, it } from 'vitest';
import { draftScale, draftVolume, gearOutline, gearRadii, polygonOutline, shoelace, slotOutline, threadRadius, threadSection } from '../src/engine/profiles.js';

describe('production profiles', () => {
  it('builds an involute gear that reaches the tip and root circles with the right tooth count', () => {
    const g = { module: 2, teeth: 20 };
    const o = gearOutline(g);
    const { tip, root, pitch } = gearRadii(g);
    expect(pitch).toBe(20);
    const r = o.map(([x, y]) => Math.hypot(x, y));
    expect(Math.max(...r)).toBeCloseTo(tip, 6);
    expect(Math.min(...r)).toBeCloseTo(root, 6);
    // Tooth count: crossings of the pitch circle going outward.
    let up = 0;
    for (let i = 0; i < r.length; i++) if (r[i] < pitch && r[(i + 1) % r.length] >= pitch) up++;
    expect(up).toBe(20);
    // Counter-clockwise, area between the root and tip discs.
    const A = shoelace(o);
    expect(A).toBeGreaterThan(Math.PI * root * root);
    expect(A).toBeLessThan(Math.PI * tip * tip);
  });

  it('gives the ISO 68-1 basic thread: major and minor diameters', () => {
    const t = { major: 8, pitch: 1.25 };
    const rs = Array.from({ length: 1000 }, (_, k) => threadRadius(t, (1.25 * k) / 1000));
    expect(Math.max(...rs) * 2).toBeCloseTo(8, 9);
    // d1 = d - 1.0825 P (basic minor diameter).
    expect(Math.min(...rs) * 2).toBeCloseTo(8 - 1.0825318 * 1.25, 5);
    expect(threadSection(t).length).toBe(96);
  });

  it('makes sketch shapes and the draft volume formula', () => {
    expect(shoelace(slotOutline(30, 10, 64))).toBeCloseTo(20 * 10 + Math.PI * 25, 0);
    // A hexagon 13 across flats: area = (sqrt 3 / 2) af^2.
    expect(shoelace(polygonOutline(6, 13))).toBeCloseTo((Math.sqrt(3) / 2) * 169, 9);
    // A uniform scale to s: the frustum A h (1 + s + s^2) / 3.
    const s = 0.8;
    expect(draftVolume(100, 10, s, s)).toBeCloseTo((100 * 10 * (1 + s + s * s)) / 3, 9);
    const [sx, sy] = draftScale(40, 20, 10, 3);
    expect(sx).toBeCloseTo((40 - 20 * Math.tan(Math.PI / 60)) / 40, 12);
    expect(sy).toBeLessThan(sx);
  });
});
