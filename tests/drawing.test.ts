import { beforeAll, describe, expect, it } from 'vitest';
import { chooseScale, drawingSvg } from '../src/engine/drawing.js';
import { defaultParams, jobById } from '../src/engine/jobs.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

const info = { title: 'Test', name: 'test', material: 'PLA', massG: 1, volume: 1000, verdict: 'Verified', date: '2026-11-13', params: [] };

describe('engineering drawing', () => {
  it('views match the part box and the drawing reads the holes exactly', () => {
    const job = jobById('flange-plate');
    const params = job.clamp(defaultParams(job)).params;
    const spec = job.spec(params);
    const views = kernel.views(spec);
    const box = kernel.build(spec).props.bbox;
    const { svg, holes } = drawingSvg(views, info);
    const ext = (loops: [number, number][][], a: 0 | 1) => {
      const v = loops.flat().map((p) => p[a]);
      return Math.max(...v) - Math.min(...v);
    };
    // Front: X by Y; top: X by Z; right: Z by Y.
    expect(ext(views.front, 0)).toBeCloseTo(box.max[0] - box.min[0], 3);
    expect(ext(views.front, 1)).toBeCloseTo(box.max[1] - box.min[1], 3);
    expect(ext(views.top, 1)).toBeCloseTo(box.max[2] - box.min[2], 3);
    expect(ext(views.right, 0)).toBeCloseTo(box.max[2] - box.min[2], 3);
    // The flange's bolt holes go through along Y: they show in the top view only.
    const top = holes.filter((h) => h.view === 'top');
    expect(top.length).toBeGreaterThan(0);
    expect(svg).toContain('THRU');
    expect(svg.startsWith('<svg')).toBe(true);
  });

  it('picks the largest standard scale that fits', () => {
    expect(chooseScale(40, 20, 10)).toBe(2);
    // (400 + 100) x 0.25 + 28 is over the 150 mm the views may use, so 1:5.
    expect(chooseScale(400, 100, 100)).toBe(0.2);
  });
});

describe('hidden lines', () => {
  it('draws a blind pocket: solid in the top view, dashed in the front view', async () => {
    const { addFeature, designJob, designSpec, OPS } = await import('../src/engine/design.js');
    let p = addFeature({ nf: 0 }, OPS.BOX, { a: 60, b: 40, c: 20 });
    // A 20 x 10 pocket 5 deep in the top (y = 15 to 20), centred.
    p = addFeature(p, OPS.CUTBOX, { a: 20, b: 10, c: 5, f: 15 });
    const views = kernel.views(designSpec(designJob.clamp(p).params));
    const lines = views.lines!;
    const near = (a: number[], x1: number, y1: number, x2: number, y2: number): boolean => {
      for (let i = 0; i < a.length; i += 4) {
        const fwd = Math.hypot(a[i] - x1, a[i + 1] - y1) < 0.01 && Math.hypot(a[i + 2] - x2, a[i + 3] - y2) < 0.01;
        const back = Math.hypot(a[i] - x2, a[i + 1] - y2) < 0.01 && Math.hypot(a[i + 2] - x1, a[i + 3] - y1) < 0.01;
        if (fwd || back) return true;
      }
      return false;
    };
    const along = (a: number[], test: (x: number, y: number) => boolean): number => {
      let L = 0;
      for (let i = 0; i < a.length; i += 4) if (test((a[i] + a[i + 2]) / 2, (a[i + 1] + a[i + 3]) / 2)) L += Math.hypot(a[i + 2] - a[i], a[i + 3] - a[i + 1]);
      return L;
    };
    // Front view (x, y): the pocket floor at y = 15 between x = -10 and 10 is hidden, not visible.
    expect(along(lines.front.hidden, (x, y) => Math.abs(y - 15) < 0.01 && Math.abs(x) < 10)).toBeCloseTo(40, 1); // its front and back edges, one over the other
    expect(along(lines.front.visible, (x, y) => Math.abs(y - 15) < 0.01 && Math.abs(x) < 10)).toBe(0);
    // Top view (x, -z): the pocket's rim and floor edges are in plain sight.
    expect(along(lines.top.visible, (x, y) => Math.abs(Math.abs(y) - 5) < 0.01 && Math.abs(x) < 10)).toBeGreaterThan(39);
    expect(near(lines.top.hidden, -10, 5, 10, 5)).toBe(false);
    // The sheet draws both kinds.
    const { svg } = drawingSvg(views, { title: 'Pocket', name: 'pocket', material: 'PLA', massG: 1, volume: 1, verdict: 'verified', date: '2026-11-15', params: [] });
    expect(svg).toContain('class="hid"');
    expect(svg).toContain('class="vis"');
  });
});

describe('assembly drawing', () => {
  it('draws the assembly in isometric with one balloon per item and the parts list', async () => {
    const { addFeature, designJob, designSpec, OPS } = await import('../src/engine/design.js');
    const { assemblyDrawingSvg } = await import('../src/engine/assembly-drawing.js');
    const base = kernel.build(designSpec(designJob.clamp(addFeature({ nf: 0 }, OPS.BOX, { a: 80, b: 40, c: 10 })).params)).mesh;
    const pin = kernel.build(designSpec(designJob.clamp(addFeature({ nf: 0 }, OPS.CYL, { a: 10, c: 30 })).params)).mesh;
    const moved = (m: typeof pin, dx: number, dy: number): Float32Array => {
      const q = new Float32Array(m.positions.length);
      for (let i = 0; i < q.length; i += 3) {
        q[i] = m.positions[i] + dx;
        q[i + 1] = m.positions[i + 1] + dy;
        q[i + 2] = m.positions[i + 2];
      }
      return q;
    };
    const parts = [
      { item: 1, positions: base.positions, indices: base.indices },
      { item: 2, positions: moved(pin, -25, 10), indices: pin.indices },
      { item: 2, positions: moved(pin, 25, 10), indices: pin.indices },
    ];
    const bom = [
      { item: 1, name: 'Base', part: 'Free design', material: 'PLA', qty: 1, massG: 39.7 },
      { item: 2, name: 'Pin', part: 'Free design', material: 'PETG', qty: 2, massG: 3.0 },
    ];
    const d = assemblyDrawingSvg(parts, bom, 'Pin plate', '2026-11-15');
    expect(d.balloons).toBe(2);
    expect(d.svg).toContain('>Base<');
    expect(d.svg).toContain('>Pin<');
    expect(d.svg).toContain('3 (2 different)');
    expect((d.svg.match(/class="ball"/gu) ?? []).length).toBe(2);
  });
});

describe('geometric tolerancing', () => {
  it('puts datums A, B, C, a position frame on each hole, flatness and perpendicularity, and ISO 2768 in the title block', async () => {
    const { addFeature, designJob, designSpec, OPS } = await import('../src/engine/design.js');
    const { DEFAULT_GDT } = await import('../src/engine/drawing.js');
    let p = addFeature({ nf: 0 }, OPS.BOX, { a: 80, b: 50, c: 12 });
    p = addFeature(p, OPS.HOLE, { a: 8, b: 0, d: 20, e: 0, f: 12 });
    const views = kernel.views(designSpec(designJob.clamp(p).params));
    const { svg } = drawingSvg(views, { title: 'Plate', name: 'plate', material: 'PLA', massG: 1, volume: 1, verdict: 'verified', date: '2026-11-15', params: [], gdt: { ...DEFAULT_GDT, position: 0.05 } });
    for (const letter of ['A', 'B', 'C']) expect(svg).toContain(`class="fct">${letter}</text>`);
    expect(svg).toContain('⌖');
    expect(svg).toContain('⌀0.05');
    expect(svg).toContain('⏥');
    expect(svg).toContain('⊥');
    expect(svg).toContain('ISO 2768-mK');
    const plain = drawingSvg(views, { title: 'Plate', name: 'plate', material: 'PLA', massG: 1, volume: 1, verdict: 'verified', date: '2026-11-15', params: [], gdt: null }).svg;
    expect(plain).not.toContain('⌖');
  });
});

