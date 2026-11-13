import { beforeAll, describe, expect, it } from 'vitest';
import { expectVolume } from '../src/engine/expect.js';
import { jobById, Params } from '../src/engine/jobs.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { cleanStroke } from '../src/engine/sketcher.js';
import { runGate } from '../src/engine/truth.js';
import { Vec2 } from '../src/engine/types.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

/** Deterministic wobble, like a hand drawing in the air. */
function wobble(seed: number): () => number {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 4294967296 - 0.5) * 2;
  };
}

function shaky(points: Vec2[], step: number, amp: number, seed = 7): Vec2[] {
  const r = wobble(seed);
  const out: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([a[0] + (b[0] - a[0]) * t + r() * amp, a[1] + (b[1] - a[1]) * t + r() * amp]);
    }
  }
  return out;
}

function paramsFor(outline: NonNullable<ReturnType<typeof cleanStroke>['outline']>, h: number): Params {
  if (outline.kind === 'circle') return { h, kind: 1, cx: outline.cx, cy: outline.cy, r: outline.r };
  const p: Params = { h, kind: 0, n: outline.points.length };
  outline.points.forEach(([x, y], i) => {
    p[`x${i}`] = x;
    p[`y${i}`] = y;
  });
  return p;
}

describe('air sketch', () => {
  it('turns a shaky rectangle into a square-cornered one', () => {
    const res = cleanStroke(shaky([[0, 0], [60, 0], [60, 30], [0, 30]], 2, 1.2));
    expect(res.outline?.kind).toBe('polygon');
    const pts = res.outline?.kind === 'polygon' ? res.outline.points : [];
    expect(pts.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
    }
  });

  it('restores the corner a trace started on', () => {
    // Start exactly on a corner, then trim the first and last samples as the systems do.
    const full = shaky([[0, 0], [70, 0], [70, 40], [0, 40]], 2, 0.8, 11);
    const res = cleanStroke(full.slice(5, -5));
    const pts = res.outline?.kind === 'polygon' ? res.outline.points : [];
    expect(pts.length).toBe(4);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(67);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(37);
  });

  it('recognises a circle', () => {
    const ring: Vec2[] = Array.from({ length: 80 }, (_, i) => [20 * Math.cos((i / 80) * 2 * Math.PI), 20 * Math.sin((i / 80) * 2 * Math.PI)]);
    const res = cleanStroke(shaky(ring, 3, 0.8, 3));
    expect(res.outline?.kind).toBe('circle');
    if (res.outline?.kind === 'circle') expect(Math.abs(res.outline.r - 20)).toBeLessThan(1.5);
  });

  it('refuses a figure eight', () => {
    const res = cleanStroke(shaky([[0, 0], [40, 30], [40, 0], [0, 30]], 2, 0.3));
    expect(res.outline).toBeNull();
    expect(res.reason).toMatch(/crosses itself/);
  });

  it('a sketched L-shape and a sketched disc pass the truth gate', () => {
    const job = jobById('sketch');
    const ell = cleanStroke(shaky([[0, 0], [50, 0], [50, 15], [15, 15], [15, 40], [0, 40]], 2, 1));
    const disc = cleanStroke(Array.from({ length: 90 }, (_, i): Vec2 => [5 + 18 * Math.cos(i / 14), -3 + 18 * Math.sin(i / 14)]));
    for (const res of [ell, disc]) {
      expect(res.outline).not.toBeNull();
      const params = job.clamp(paramsFor(res.outline!, 12)).params;
      const spec = job.spec(params);
      const out = kernel.build(spec);
      const gate = runGate({ props: out.props, generic: expectVolume(spec), jobVolume: job.volume(params), jobBox: job.box(params), jobGenus: job.genus(params) });
      expect(gate.checks.filter((c) => c.status === 'fail')).toEqual([]);
      expect(gate.verdict).toBe('verified');
    }
  });
});
