/**
 * Sheet metal, as in SOLIDWORKS' sheet-metal tools: a base flange (an
 * outline at a sheet thickness), edge flanges (a bend of inside radius R
 * through an angle, then a straight flange), corner relief where two flanges
 * meet, and the flat pattern: each bend unrolled by its bend allowance
 * BA = angle x (R + K t) (K the K-factor), written as DXF and SVG with the
 * bend lines.
 */

export interface SheetEdge {
  a: [number, number];
  b: [number, number];
  /** Unit direction along the edge and the outward normal, in the sketch plane. */
  dir: [number, number];
  out: [number, number];
  length: number;
}

/** The outline's edges, anticlockwise, with outward normals. */
export function sheetEdges(pts: [number, number][]): SheetEdge[] {
  let area = 0;
  for (let i = 0; i < pts.length; i++) area += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
  const ccw = area > 0;
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const dir: [number, number] = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    // Outward: right of travel for an anticlockwise outline.
    const out: [number, number] = ccw ? [dir[1], -dir[0]] : [-dir[1], dir[0]];
    return { a, b, dir, out, length: L };
  });
}

/** Bend allowance (mm): the length of the neutral fibre through the bend. */
export function bendAllowance(angleDeg: number, R: number, t: number, K: number): number {
  return ((angleDeg * Math.PI) / 180) * (R + K * t);
}

export type Seg = ['L', number, number, number, number] | ['A', number, number, number, number, number, number, 1 | -1];

/**
 * A flange's section in (m, y): m outwards from the edge, y up, the sheet between y0 and y0 + t. The bend
 * turns up (or down) through `angle` about an axis at inside radius R, then the flange runs L straight on.
 */
export function flangeSection(y0: number, t: number, R: number, angleDeg: number, L: number, up: boolean): Seg[] {
  const th = (angleDeg * Math.PI) / 180;
  // Up: the axis is above the top face; down: below the bottom face (mirrored).
  const s = up ? 1 : -1;
  const ay = up ? y0 + t + R : y0 - R;
  const P = (r: number, phi: number): [number, number] => [r * Math.sin(phi), ay - s * r * Math.cos(phi)];
  const tan: [number, number] = [Math.cos(th), s * Math.sin(th)];
  const o0 = P(R + t, 0);
  const o1 = P(R + t, th);
  const i1 = P(R, th);
  const i0 = P(R, 0);
  const o2: [number, number] = [o1[0] + tan[0] * L, o1[1] + tan[1] * L];
  const i2: [number, number] = [i1[0] + tan[0] * L, i1[1] + tan[1] * L];
  // Up: the outer arc runs anticlockwise from o0 to o1; down it runs clockwise.
  const dirOut: 1 | -1 = up ? 1 : -1;
  const segs: Seg[] = [['A', 0, ay, o0[0], o0[1], o1[0], o1[1], dirOut]];
  if (L > 0) segs.push(['L', o1[0], o1[1], o2[0], o2[1]], ['L', o2[0], o2[1], i2[0], i2[1]], ['L', i2[0], i2[1], i1[0], i1[1]]);
  else segs.push(['L', o1[0], o1[1], i1[0], i1[1]]);
  segs.push(['A', 0, ay, i1[0], i1[1], i0[0], i0[1], (-dirOut) as 1 | -1], ['L', i0[0], i0[1], o0[0], o0[1]]);
  return segs;
}

/** The section's exact area: the annular bend sector and the flange. */
export function flangeArea(t: number, R: number, angleDeg: number, L: number): number {
  return ((angleDeg * Math.PI) / 180 / 2) * ((R + t) ** 2 - R ** 2) + L * t;
}

export interface FlangeSpec {
  edge: number;
  length: number;
  angle: number;
  up: boolean;
  /** Set back from each end (corner relief), mm. */
  inset: [number, number];
}

/**
 * The flat pattern: the base outline, and each flange unrolled outwards from its edge (the bend allowance,
 * then its straight length), with the bend lines where each bend starts and ends.
 */
export function flatPattern(
  base: [number, number][],
  flanges: FlangeSpec[],
  t: number,
  R: number,
  K: number,
): { outline: [number, number][][]; bends: [number, number][][]; size: [number, number] } {
  const edges = sheetEdges(base);
  const bends: [number, number][][] = [];
  // One cut contour: the base outline with each flanged edge replaced by a detour round its unrolled flange.
  const contour: [number, number][] = [];
  edges.forEach((e, i) => {
    contour.push(e.a);
    const f = flanges.find((x) => x.edge === i);
    if (!f) return;
    const BA = bendAllowance(f.angle, R, t, K);
    const a: [number, number] = [e.a[0] + e.dir[0] * f.inset[0], e.a[1] + e.dir[1] * f.inset[0]];
    const b: [number, number] = [e.b[0] - e.dir[0] * f.inset[1], e.b[1] - e.dir[1] * f.inset[1]];
    const push = (q: [number, number], d: number): [number, number] => [q[0] + e.out[0] * d, q[1] + e.out[1] * d];
    if (f.inset[0] > 0) contour.push(a);
    contour.push(push(a, BA + f.length), push(b, BA + f.length));
    if (f.inset[1] > 0) contour.push(b);
    bends.push([a, b], [push(a, BA), push(b, BA)]);
  });
  const outline = [contour];
  const xs = outline.flat().map((p) => p[0]);
  const ys = outline.flat().map((p) => p[1]);
  return { outline, bends, size: [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] };
}

/** The flat pattern as DXF (R12 LINE entities): cut outline on layer CUT, bend lines on layer BEND. */
export function flatPatternDxf(fp: ReturnType<typeof flatPattern>): string {
  const out: string[] = ['0', 'SECTION', '2', 'ENTITIES'];
  const line = (a: [number, number], b: [number, number], layer: string): void => {
    out.push('0', 'LINE', '8', layer, '10', a[0].toFixed(4), '20', a[1].toFixed(4), '30', '0', '11', b[0].toFixed(4), '21', b[1].toFixed(4), '31', '0');
  };
  for (const poly of fp.outline) for (let i = 0; i < poly.length; i++) line(poly[i], poly[(i + 1) % poly.length], 'CUT');
  for (const [a, b] of fp.bends) line(a, b, 'BEND');
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n') + '\n';
}

/** The flat pattern as an SVG sheet at 1:1 (cut outline solid, bend lines dashed). */
export function flatPatternSvg(fp: ReturnType<typeof flatPattern>, title: string): string {
  const all = [...fp.outline.flat(), ...fp.bends.flat()];
  const minX = Math.min(...all.map((p) => p[0])) - 10;
  const maxY = Math.max(...all.map((p) => p[1])) + 10;
  const W = fp.size[0] + 20;
  const H = fp.size[1] + 30;
  const tx = (p: [number, number]): string => `${(p[0] - minX).toFixed(2)} ${(maxY - p[1]).toFixed(2)}`;
  const cut = fp.outline.map((poly) => `M${poly.map(tx).join('L')}Z`).join('');
  const bend = fp.bends.map(([a, b]) => `M${tx(a)}L${tx(b)}`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">
<title>${title} flat pattern</title>
<rect width="${W}" height="${H}" fill="#fff"/>
<path d="${cut}" fill="none" stroke="#10182c" stroke-width="0.3"/>
<path d="${bend}" fill="none" stroke="#c0392b" stroke-width="0.25" stroke-dasharray="2 1.2"/>
<text x="4" y="${H - 6}" font-family="Arial" font-size="3.5" fill="#10182c">${title}: flat ${fp.size[0].toFixed(1)} x ${fp.size[1].toFixed(1)} mm, bend lines dashed</text>
</svg>`;
}
