import { describe, expect, it } from 'vitest';
import { resample } from '../src/app/voice.js';

describe('voice audio', () => {
  it('resamples to 16 kHz keeping a tone at its frequency', () => {
    const from = 48000;
    const tone = new Float32Array(from); // one second of 440 Hz
    for (let i = 0; i < tone.length; i++) tone[i] = Math.sin((2 * Math.PI * 440 * i) / from);
    const out = resample([tone.subarray(0, 24000), tone.subarray(24000)], from, 16000);
    expect(out.length).toBe(16000);
    // Count upward zero crossings: 440 per second.
    let crossings = 0;
    for (let i = 1; i < out.length; i++) if (out[i - 1] < 0 && out[i] >= 0) crossings++;
    expect(Math.abs(crossings - 440)).toBeLessThanOrEqual(1);
  });
});
