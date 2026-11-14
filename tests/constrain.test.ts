import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { make_gcs_wrapper, type GcsWrapper } from '@salusoft89/planegcs';
import { edgeLength, inferConstraints, nearestEdge, solveOutline } from '../src/engine/constrain.js';
import type { Vec2 } from '../src/engine/types.js';

let gcs: GcsWrapper;
beforeAll(async () => {
  gcs = await make_gcs_wrapper(fileURLToPath(new URL('../node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm', import.meta.url)));
});

const rect: Vec2[] = [[0, 0], [30, 0], [30, 20], [0, 20]];

describe('constraint sketching (FreeCAD planeGCS)', () => {
  it('infers horizontal, vertical and equal edges of a drawn rectangle', () => {
    const c = inferConstraints(rect);
    expect(c.filter((k) => k.kind === 'horizontal').length).toBe(2);
    expect(c.filter((k) => k.kind === 'vertical').length).toBe(2);
    expect(c.some((k) => k.kind === 'equal' && k.a === 0 && k.b === 2)).toBe(true);
  });

  it('sets a spoken side length and keeps the rectangle a rectangle', () => {
    const r = solveOutline(gcs, rect, [{ edge: 0, length: 40 }]);
    expect(r.ok).toBe(true);
    expect(edgeLength(r.pts, 0)).toBeCloseTo(40, 6);
    // The opposite side follows (equal), the other two keep their 20 mm, corners stay square.
    expect(edgeLength(r.pts, 2)).toBeCloseTo(40, 6);
    expect(edgeLength(r.pts, 1)).toBeCloseTo(20, 6);
    expect(r.pts[1][1]).toBeCloseTo(r.pts[0][1], 6);
    expect(r.pts[2][0]).toBeCloseTo(r.pts[1][0], 6);
    // The first corner stays where it was.
    expect(r.pts[0]).toEqual([0, 0]);
  });

  it('finds the edge nearest a pointed spot', () => {
    expect(nearestEdge(rect, [15, 21])).toBe(2);
    expect(nearestEdge(rect, [31, 10])).toBe(1);
  });
});
