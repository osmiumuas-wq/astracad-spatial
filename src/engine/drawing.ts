/**
 * A three-view engineering drawing on an A4 sheet, as SVG: front, top and
 * right views (third-angle projection), overall dimensions, a callout for
 * every round through-hole seen in a view, and a title block.
 *
 * Each view is the kernel's silhouette (src/engine/kernel.ts views) with the
 * part's edges over it (src/engine/hidden-lines.ts): visible edges as solid
 * lines, hidden edges dashed, so blind pockets, counterbores, steps and the
 * walls of holes show as on a drawing from desktop CAD. Through-hole diameters
 * come from the hole polygon's area: the kernel's circle facets are
 * equal-area, so the diameter is exact.
 */

import type { DrawingViews } from './kernel.js';
import type { Vec2 } from './types.js';

type ViewName = 'front' | 'top' | 'right';

export interface DrawingInfo {
  title: string;
  name: string;
  material: string;
  massG: number;
  volume: number;
  verdict: string;
  date: string;
  /** Lines of key dimensions, e.g. "L = 75.00 mm". */
  params: string[];
  /**
   * The part's exact extents (X, Y, Z) from its closed-form box, when known.
   * Overall dimensions use these: the kernel's circle facets bulge slightly
   * (they keep the true area), so a 70 mm disc's silhouette spans 70.02.
   */
  exact?: [number, number, number];
  /** Geometric tolerancing (ISO 1101): datums A, B, C, and the tolerances in the feature control frames. */
  gdt?: GdtScheme | null;
}

export interface GdtScheme {
  /** Position of through holes relative to A, B, C (a diameter zone, mm). */
  position: number;
  /** Flatness of the top face (mm). */
  flatness: number;
  /** Perpendicularity of datum face B to A (mm). */
  perpendicularity: number;
  /** ISO 2768 general tolerance class: f, m, c or v. */
  general: 'f' | 'm' | 'c' | 'v';
}

export const DEFAULT_GDT: GdtScheme = { position: 0.1, flatness: 0.05, perpendicularity: 0.05, general: 'm' };

/** A feature control frame: cells left to right (the first a geometric symbol), at (x, y) top left, as SVG. */
export function controlFrame(x: number, y: number, cells: string[]): { svg: string; width: number } {
  const h = 4.2;
  const widths = cells.map((c, i) => (i === 0 ? 5 : Math.max(5, c.length * 1.75 + 2)));
  let cx = x;
  const parts: string[] = [];
  cells.forEach((c, i) => {
    parts.push(`<rect x="${cx.toFixed(2)}" y="${y.toFixed(2)}" width="${widths[i].toFixed(2)}" height="${h}" class="fcf"/>`);
    parts.push(`<text x="${(cx + widths[i] / 2).toFixed(2)}" y="${(y + 3.1).toFixed(2)}" class="${i === 0 ? 'sym' : 'fct'}">${esc(c)}</text>`);
    cx += widths[i];
  });
  return { svg: parts.join(''), width: cx - x };
}

/** A datum feature symbol: a filled triangle on the face at (x, y), a leader, and the letter in a box. */
function datum(x: number, y: number, dx: number, dy: number, letter: string): string {
  // The triangle sits on the face, pointing out along (dx, dy); the box is 7 mm out.
  const nx = -dy;
  const ny = dx;
  const t1 = [x + nx * 1.4, y + ny * 1.4];
  const t2 = [x - nx * 1.4, y - ny * 1.4];
  const tip = [x + dx * 2, y + dy * 2];
  const bx = x + dx * 7;
  const by = y + dy * 7;
  return `<path d="M${t1[0].toFixed(2)} ${t1[1].toFixed(2)}L${t2[0].toFixed(2)} ${t2[1].toFixed(2)}L${tip[0].toFixed(2)} ${tip[1].toFixed(2)}Z" fill="#10182c"/>` +
    `<line x1="${tip[0].toFixed(2)}" y1="${tip[1].toFixed(2)}" x2="${bx.toFixed(2)}" y2="${by.toFixed(2)}" class="dim"/>` +
    `<rect x="${(bx - 2.4).toFixed(2)}" y="${(by - 2.4).toFixed(2)}" width="4.8" height="4.8" class="fcf"/>` +
    `<text x="${bx.toFixed(2)}" y="${(by + 1.2).toFixed(2)}" class="fct">${letter}</text>`;
}

export interface HoleCallout {
  view: ViewName;
  diameter: number;
  count: number;
  at: Vec2;
}

const SHEET_W = 297;
const SHEET_H = 210;
const SCALES = [10, 5, 4, 2, 1, 0.5, 0.4, 0.25, 0.2, 0.1, 0.05];

const area = (p: Vec2[]): number => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a / 2;
};

function bounds(loops: Vec2[][]): { min: Vec2; max: Vec2 } {
  const min: Vec2 = [Infinity, Infinity];
  const max: Vec2 = [-Infinity, -Infinity];
  for (const l of loops) {
    for (const [x, y] of l) {
      min[0] = Math.min(min[0], x);
      min[1] = Math.min(min[1], y);
      max[0] = Math.max(max[0], x);
      max[1] = Math.max(max[1], y);
    }
  }
  return { min, max };
}

/** Round holes in a view: loops wound against the outer boundary whose points sit on a circle. */
export function findHoles(loops: Vec2[][], view: ViewName): HoleCallout[] {
  const outerSign = Math.sign(loops.reduce((best, l) => (Math.abs(area(l)) > Math.abs(best) ? area(l) : best), 0));
  const found: { d: number; at: Vec2 }[] = [];
  for (const l of loops) {
    const a = area(l);
    if (l.length < 12 || Math.sign(a) === outerSign) continue;
    const cx = l.reduce((s, p) => s + p[0], 0) / l.length;
    const cy = l.reduce((s, p) => s + p[1], 0) / l.length;
    const radii = l.map(([x, y]) => Math.hypot(x - cx, y - cy));
    const mean = radii.reduce((s, r) => s + r, 0) / radii.length;
    const spread = Math.max(...radii) - Math.min(...radii);
    if (spread > 0.05 * mean) continue;
    found.push({ d: 2 * Math.sqrt(Math.abs(a) / Math.PI), at: [cx, cy] });
  }
  const groups: HoleCallout[] = [];
  for (const h of found) {
    const g = groups.find((x) => Math.abs(x.diameter - h.d) < 0.01);
    if (g) g.count++;
    else groups.push({ view, diameter: h.d, count: 1, at: h.at });
  }
  return groups;
}

const f = (v: number): string => (Math.abs(v - Math.round(v)) < 0.005 ? v.toFixed(0) : v.toFixed(2));
const esc = (s: string): string => s.replace(/[&<>"]/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** Pick the largest standard scale that fits the three views in the drawing area. */
export function chooseScale(w: number, h: number, d: number, areaW = 150, areaH = 132, gap = 28): number {
  for (const s of SCALES) {
    if ((w + d) * s + gap <= areaW && (h + d) * s + gap <= areaH) return s;
  }
  return SCALES[SCALES.length - 1];
}

const scaleText = (s: number): string => (s >= 1 ? `${s}:1` : `1:${Math.round(1 / s)}`);

export function drawingSvg(views: DrawingViews, info: DrawingInfo): { svg: string; scale: number; holes: HoleCallout[] } {
  const bf = bounds(views.front);
  const bt = bounds(views.top);
  const br = bounds(views.right);
  const W = bf.max[0] - bf.min[0];
  const H = bf.max[1] - bf.min[1];
  const D = br.max[0] - br.min[0];
  const s = chooseScale(W, H, D);
  const gap = 28;
  const left = 30;
  const top = 18;
  const place = {
    top: { b: bt, ox: left, oy: top },
    front: { b: bf, ox: left, oy: top + (bt.max[1] - bt.min[1]) * s + gap },
    right: { b: br, ox: left + W * s + gap, oy: top + (bt.max[1] - bt.min[1]) * s + gap },
  };
  const out: string[] = [];
  const holes: HoleCallout[] = [];
  // Sheet axes per view, as model axes (0 = X, 1 = Y, 2 = Z), for exact dimension text.
  const axes: Record<ViewName, [number, number]> = { front: [0, 1], top: [0, 2], right: [2, 1] };
  const label = (v: ViewName, k: 0 | 1, measured: number): string => {
    const e = info.exact?.[axes[v][k]];
    // Use the exact size when the silhouette agrees with it to within the facet bulge.
    return f(e !== undefined && Math.abs(e - measured) < Math.max(0.05, 0.002 * e) ? e : measured);
  };
  const toSheet = (v: ViewName, [x, y]: Vec2): Vec2 => {
    const p = place[v];
    return [p.ox + (x - p.b.min[0]) * s, p.oy + (p.b.max[1] - y) * s];
  };
  for (const v of ['front', 'top', 'right'] as const) {
    const d = views[v]
      .map((l) => `M${l.map((q) => toSheet(v, q).map((n) => n.toFixed(2)).join(' ')).join('L')}Z`)
      .join('');
    out.push(`<path d="${d}" fill="#e8eef8" stroke="#10182c" stroke-width="0.45" fill-rule="evenodd"/>`);
    const ln = views.lines?.[v];
    if (ln) {
      const segs = (a: number[]): string => {
        let o = '';
        for (let i = 0; i + 3 < a.length; i += 4) {
          const [x1, y1] = toSheet(v, [a[i], a[i + 1]]);
          const [x2, y2] = toSheet(v, [a[i + 2], a[i + 3]]);
          o += `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`;
        }
        return o;
      };
      if (ln.hidden.length) out.push(`<path d="${segs(ln.hidden)}" class="hid"/>`);
      if (ln.visible.length) out.push(`<path d="${segs(ln.visible)}" class="vis"/>`);
    }
    const p = place[v];
    const vw = (p.b.max[0] - p.b.min[0]) * s;
    const vh = (p.b.max[1] - p.b.min[1]) * s;
    out.push(`<text x="${(p.ox + vw / 2).toFixed(1)}" y="${(p.oy - 3).toFixed(1)}" class="lbl">${v.toUpperCase()}</text>`);
    // Overall width under the view, height to its left (front and right), with extension lines and arrows.
    const yDim = p.oy + vh + 8;
    out.push(
      `<line x1="${p.ox}" y1="${p.oy + vh + 1}" x2="${p.ox}" y2="${yDim + 2}" class="ext"/>`,
      `<line x1="${p.ox + vw}" y1="${p.oy + vh + 1}" x2="${p.ox + vw}" y2="${yDim + 2}" class="ext"/>`,
      `<line x1="${p.ox}" y1="${yDim}" x2="${p.ox + vw}" y2="${yDim}" class="dim" marker-start="url(#a)" marker-end="url(#a)"/>`,
      `<text x="${(p.ox + vw / 2).toFixed(1)}" y="${(yDim - 1.2).toFixed(1)}" class="num">${label(v, 0, p.b.max[0] - p.b.min[0])}</text>`,
    );
    if (v !== 'top') {
      const xDim = p.ox - 8;
      out.push(
        `<line x1="${p.ox - 1}" y1="${p.oy}" x2="${xDim - 2}" y2="${p.oy}" class="ext"/>`,
        `<line x1="${p.ox - 1}" y1="${p.oy + vh}" x2="${xDim - 2}" y2="${p.oy + vh}" class="ext"/>`,
        `<line x1="${xDim}" y1="${p.oy}" x2="${xDim}" y2="${p.oy + vh}" class="dim" marker-start="url(#a)" marker-end="url(#a)"/>`,
        `<text transform="translate(${(xDim - 1.2).toFixed(1)} ${(p.oy + vh / 2).toFixed(1)}) rotate(-90)" class="num">${label(v, 1, p.b.max[1] - p.b.min[1])}</text>`,
      );
    }
    for (const h of findHoles(views[v], v)) {
      holes.push(h);
      const [hx, hy] = toSheet(v, h.at);
      const r = (h.diameter / 2) * s;
      const tx = hx + r + 6;
      const ty = hy - r - 5;
      out.push(
        `<line x1="${(hx + r * 0.7).toFixed(2)}" y1="${(hy - r * 0.7).toFixed(2)}" x2="${tx.toFixed(2)}" y2="${ty.toFixed(2)}" class="dim" marker-start="url(#a)"/>`,
        `<text x="${(tx + 0.8).toFixed(2)}" y="${(ty - 0.6).toFixed(2)}" class="note">${h.count > 1 ? `${h.count}x ` : ''}&#216;${f(h.diameter)} THRU</text>`,
      );
      if (info.gdt) out.push(controlFrame(tx + 0.8, ty + 0.4, ['\u2316', `\u2300${info.gdt.position}`, 'A', 'B', 'C']).svg);
    }
  }
  // Geometric tolerancing: datums A (base), B (left face), C (back face); flatness of the top; B square to A.
  if (info.gdt) {
    const g = info.gdt;
    const fr = place.front;
    const fw = (fr.b.max[0] - fr.b.min[0]) * s;
    const fh = (fr.b.max[1] - fr.b.min[1]) * s;
    out.push(datum(fr.ox + fw * 0.3, fr.oy + fh, 0, 1, 'A'));
    out.push(datum(fr.ox, fr.oy + fh * 0.65, -1, 0, 'B'));
    const tp = place.top;
    const tw = (tp.b.max[0] - tp.b.min[0]) * s;
    out.push(datum(tp.ox + tw * 0.7, tp.oy, 0, -1, 'C'));
    // Flatness of the top face: a frame above the front view's top edge with a leader down to it.
    const flat = controlFrame(fr.ox + fw * 0.62, fr.oy - 9.5, ['\u23e5', `${g.flatness}`]);
    out.push(flat.svg, `<line x1="${(fr.ox + fw * 0.62 + 2.5).toFixed(2)}" y1="${(fr.oy - 5.3).toFixed(2)}" x2="${(fr.ox + fw * 0.62 + 2.5).toFixed(2)}" y2="${fr.oy.toFixed(2)}" class="dim" marker-end="url(#a)"/>`);
    // Perpendicularity of B to A, beside B's datum box.
    // Below the front view's width dimension, with a leader up to face B.
    const perp = controlFrame(fr.ox - 3, fr.oy + fh + 13, ['\u22a5', `${g.perpendicularity}`, 'A']);
    out.push(perp.svg, `<line x1="${(fr.ox - 3).toFixed(2)}" y1="${(fr.oy + fh + 15).toFixed(2)}" x2="${(fr.ox - 0.3).toFixed(2)}" y2="${(fr.oy + fh * 0.35).toFixed(2)}" class="dim" marker-end="url(#a)"/>`);
  }
  // Title block, bottom right.
  const tbx = SHEET_W - 10 - 118;
  const tby = SHEET_H - 10 - 40;
  const rows: [string, string][] = [
    ['PART', info.title],
    ['MATERIAL', info.material],
    ['MASS', `${info.massG.toFixed(1)} g  (${(info.volume / 1000).toFixed(2)} cm3)`],
    ['CHECK', info.verdict],
    ['SCALE', `${scaleText(s)}   UNITS mm   THIRD-ANGLE`],
    ['DATE', `${info.date}   AstraCAD Spatial`],
  ];
  if (info.gdt) rows.splice(4, 0, ['TOLERANCES', `ISO 2768-${info.gdt.general}K, GD&T to ISO 1101`]);
  out.push(`<rect x="${tbx}" y="${tby - (rows.length - 6) * 6.2}" width="118" height="${40 + (rows.length - 6) * 6.2}" fill="#fff" stroke="#10182c" stroke-width="0.5"/>`);
  rows.forEach(([k, v], i) => {
    const y = tby - (rows.length - 6) * 6.2 + 6 + i * 6.2;
    out.push(`<text x="${tbx + 3}" y="${y}" class="key">${k}</text><text x="${tbx + 24}" y="${y}" class="val">${esc(v)}</text>`);
  });
  if (info.params.length) {
    // Its own column at the top right, clear of the views (which stay left of x = 210).
    const px = 214;
    const py = 18;
    out.push(`<text x="${px}" y="${py}" class="key">PARAMETERS</text>`);
    info.params.slice(0, 22).forEach((p, i) => out.push(`<text x="${px}" y="${py + 4.4 * (i + 1)}" class="note">${esc(p)}</text>`));
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}mm" height="${SHEET_H}mm" viewBox="0 0 ${SHEET_W} ${SHEET_H}">
<title>${esc(info.name)} drawing</title>
<defs><marker id="a" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L6 3L0 6z" fill="#10182c"/></marker>
<style>text{font-family:Arial,Helvetica,sans-serif;fill:#10182c}.num{font-size:3.2px;text-anchor:middle}.lbl{font-size:3px;text-anchor:middle;letter-spacing:.4px;fill:#55607a}.note{font-size:2.8px}.key{font-size:2.4px;fill:#55607a;letter-spacing:.3px}.val{font-size:3px;font-weight:700}.dim{stroke:#10182c;stroke-width:.2;fill:none}.ext{stroke:#10182c;stroke-width:.15}.fcf{fill:#fff;stroke:#10182c;stroke-width:.25}.sym{font-size:3.4px;text-anchor:middle;font-family:'Segoe UI Symbol','DejaVu Sans',Arial,sans-serif}.fct{font-size:2.8px;text-anchor:middle}.vis{stroke:#10182c;stroke-width:.35;fill:none;stroke-linecap:round}.hid{stroke:#10182c;stroke-width:.2;fill:none;stroke-dasharray:1.2 .8}</style></defs>
<rect width="${SHEET_W}" height="${SHEET_H}" fill="#fff"/>
<rect x="5" y="5" width="${SHEET_W - 10}" height="${SHEET_H - 10}" fill="none" stroke="#10182c" stroke-width="0.6"/>
${out.join('\n')}
</svg>`;
  return { svg, scale: s, holes };
}
