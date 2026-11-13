import { describe, expect, it } from 'vitest';
import { calibrate, CARD_MM, correct } from '../src/engine/calibration.js';

describe('measurement calibration', () => {
  it('learns the bias and scatter from card readings', () => {
    const cal = calibrate([88.1, 87.4, 88.4]);
    expect(cal.bias).toBeCloseTo(87.9667 - CARD_MM, 3);
    expect(cal.sd).toBeCloseTo(0.5132, 3);
    expect(cal.n).toBe(3);
  });

  it('corrects later readings and widens the uncertainty honestly', () => {
    const cal = calibrate([88.1, 87.4, 88.4]);
    const r = correct(52.0, 0.3, cal);
    expect(r.value).toBeCloseTo(52.0 - cal.bias, 6);
    // 2 * sqrt(sd^2 + spread^2 + sd^2 / n)
    expect(r.uncertainty).toBeCloseTo(2 * Math.sqrt(cal.sd ** 2 + 0.09 + cal.sd ** 2 / 3), 6);
    expect(r.uncertainty).toBeGreaterThan(2 * cal.sd);
  });

  it('refuses a single reading', () => {
    expect(() => calibrate([85])).toThrow();
  });
});
