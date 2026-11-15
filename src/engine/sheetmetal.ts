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

/** A flange chain on a base edge, for the flat pattern: unrolled length, bend zones, corner set-backs and mitres. */
export interface FlatChain {
  edge: number;
  inset: [number, number];
  /** Unrolled length out from the edge, and each bend zone [from, to] along it. */
  length: number;
  bends: [number, number][];
  /** Mitre slopes at the start and end (0: square). */
  ss: number;
  se: number;
}

/**
 * The flat pattern: one cut contour (the base outline with each flanged edge replaced by a detour round its
 * unrolled chain, mitred ends slanted), and the bend lines where each bend starts and ends.
 */
export function flatPattern(base: [number, number][], chains: FlatChain[]): { outline: [number, number][][]; bends: [number, number][][]; size: [number, number] } {
  const edges = sheetEdges(base);
  const bends: [number, number][][] = [];
  const contour: [number, number][] = [];
  edges.forEach((e, i) => {
    contour.push(e.a);
    const f = chains.find((x) => x.edge === i);
    if (!f) return;
    const a: [number, number] = [e.a[0] + e.dir[0] * f.inset[0], e.a[1] + e.dir[1] * f.inset[0]];
    const b: [number, number] = [e.b[0] - e.dir[0] * f.inset[1], e.b[1] - e.dir[1] * f.inset[1]];
    // A point d out from the edge, slid along it by the mitre (back at the start, on at the end).
    const atA = (d: number): [number, number] => [a[0] + e.out[0] * d - e.dir[0] * d * f.ss, a[1] + e.out[1] * d - e.dir[1] * d * f.ss];
    const atB = (d: number): [number, number] => [b[0] + e.out[0] * d + e.dir[0] * d * f.se, b[1] + e.out[1] * d + e.dir[1] * d * f.se];
    if (f.inset[0] > 0) contour.push(a);
    contour.push(atA(f.length), atB(f.length));
    if (f.inset[1] > 0) contour.push(b);
    for (const [d0, d1] of f.bends) bends.push([atA(d0), atB(d0)], [atA(d1), atB(d1)]);
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

export type StripMove = { bend: number } | { line: number };

/** Arc points from angle a0 by `sweep` (rad) about c, radius r, area-compensated like the kernel's arcs (ends on r). */
function arcPts(c: [number, number], r: number, a0: number, sweep: number): [number, number][] {
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / ((2 * Math.PI) / 72)));
  const step = Math.abs(sweep) / n;
  const theta = Math.abs(sweep);
  const rp = n === 2 ? (r * theta) / (2 * Math.sin(step)) : (r * (-1 + Math.sqrt(1 + ((n - 2) * theta) / Math.sin(step)))) / (n - 2);
  const out: [number, number][] = [];
  for (let i = 1; i < n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push([c[0] + rp * Math.cos(a), c[1] + rp * Math.sin(a)]);
  }
  return out;
}

/**
 * A bent strip of sheet t thick: from its start (the bottom surface at (0, y0), heading along +m) through bends
 * (degrees, + towards +y, inside radius R) and straight runs. Returns its section (anticlockwise) and where its
 * bottom surface ends, with the heading there.
 */
export function bentStrip(y0: number, t: number, R: number, moves: StripMove[]): { poly: [number, number][]; end: [number, number]; heading: number } {
  let p: [number, number] = [0, y0];
  let h = 0;
  const bottom: [number, number][] = [[0, y0]];
  const top: [number, number][] = [[0, y0 + t]];
  for (const mv of moves) {
    const dir: [number, number] = [Math.cos(h), Math.sin(h)];
    const left: [number, number] = [-Math.sin(h), Math.cos(h)];
    if ('line' in mv) {
      if (mv.line <= 0) continue;
      p = [p[0] + dir[0] * mv.line, p[1] + dir[1] * mv.line];
      bottom.push(p);
      top.push([p[0] + left[0] * t, p[1] + left[1] * t]);
      continue;
    }
    const phi = (mv.bend * Math.PI) / 180;
    if (Math.abs(phi) < 1e-9) continue;
    if (phi > 0) {
      // Up: the centre above the top surface; the bottom is the outside (R + t), the top the inside (R).
      const c: [number, number] = [p[0] + left[0] * (R + t), p[1] + left[1] * (R + t)];
      const a0 = h - Math.PI / 2;
      bottom.push(...arcPts(c, R + t, a0, phi));
      top.push(...arcPts(c, R, a0, phi));
      h += phi;
      p = [c[0] + (R + t) * Math.cos(h - Math.PI / 2), c[1] + (R + t) * Math.sin(h - Math.PI / 2)];
    } else {
      // Down: the centre below the bottom surface; the bottom is the inside (R), the top the outside (R + t).
      const c: [number, number] = [p[0] - left[0] * R, p[1] - left[1] * R];
      const a0 = h + Math.PI / 2;
      bottom.push(...arcPts(c, R, a0, phi));
      top.push(...arcPts(c, R + t, a0, phi));
      h += phi;
      p = [c[0] + R * Math.cos(h + Math.PI / 2), c[1] + R * Math.sin(h + Math.PI / 2)];
    }
    bottom.push(p);
    const l2: [number, number] = [-Math.sin(h), Math.cos(h)];
    top.push([p[0] + l2[0] * t, p[1] + l2[1] * t]);
  }
  // Anticlockwise: along the bottom, back along the top.
  const poly = [...bottom, ...top.reverse()];
  let a = 0;
  for (let i = 0; i < poly.length; i++) a += poly[i][0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * poly[i][1];
  return { poly: a >= 0 ? poly : poly.reverse(), end: p, heading: h };
}

/** Area and first moment about m = 0 (the integral of m dA) of a polygon. */
export function polyMoments(poly: [number, number][]): { area: number; mm: number } {
  let A = 0;
  let Mx = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const c = x0 * y1 - x1 * y0;
    A += c / 2;
    Mx += ((x0 + x1) * c) / 6;
  }
  const s = A < 0 ? -1 : 1;
  return { area: A * s, mm: Mx * s };
}

/** The moves of a flange: a plain flange, a hem (folded back flat), or a jog (out, over, and back to parallel). */
export function flangeMoves(kind: 'flange' | 'hem' | 'jog', angle: number, length: number, up: boolean, jogHeight = 0): StripMove[] {
  const s = up ? 1 : -1;
  if (kind === 'hem') return [{ bend: s * 180 }, { line: length }];
  if (kind === 'jog') return [{ bend: s * angle }, { line: jogHeight }, { bend: -s * angle }, { line: length }];
  return [{ bend: s * angle }, { line: length }];
}

/** The flat length of a flange's moves: bend allowances plus straights. */
export function movesFlatLength(moves: StripMove[], R: number, t: number, K: number): { total: number; bends: [number, number][] } {
  let d = 0;
  const bends: [number, number][] = [];
  for (const mv of moves) {
    if ('line' in mv) d += Math.max(0, mv.line);
    else {
      const ba = bendAllowance(Math.abs(mv.bend), R, t, K);
      bends.push([d, d + ba]);
      d += ba;
    }
  }
  return { total: d, bends };
}

