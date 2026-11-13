/**
 * A three-view engineering drawing on an A4 sheet, as SVG: front, top and
 * right views (third-angle projection), overall dimensions, a callout for
 * every round through-hole seen in a view, and a title block.
 *
 * The views are the kernel's silhouettes (src/engine/kernel.ts views), so the
 * drawing shows what goes right through in each direction; blind pockets and
 * hidden edges are not drawn. Hole diameters come from the hole polygon's
 * area: the kernel's circle facets are equal-area, so the diameter is exact.
 */

import type { DrawingViews } from './kernel.js';
import type { Vec2 } from './types.js';

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
}

export interface HoleCallout {
  view: keyof DrawingViews;
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
export function findHoles(loops: Vec2[][], view: keyof DrawingViews): HoleCallout[] {
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
  const axes: Record<keyof DrawingViews, [number, number]> = { front: [0, 1], top: [0, 2], right: [2, 1] };
  const label = (v: keyof DrawingViews, k: 0 | 1, measured: number): string => {
    const e = info.exact?.[axes[v][k]];
    // Use the exact size when the silhouette agrees with it to within the facet bulge.
    return f(e !== undefined && Math.abs(e - measured) < Math.max(0.05, 0.002 * e) ? e : measured);
  };
  const toSheet = (v: keyof DrawingViews, [x, y]: Vec2): Vec2 => {
    const p = place[v];
    return [p.ox + (x - p.b.min[0]) * s, p.oy + (p.b.max[1] - y) * s];
  };
  for (const v of ['front', 'top', 'right'] as const) {
    const d = views[v]
      .map((l) => `M${l.map((q) => toSheet(v, q).map((n) => n.toFixed(2)).join(' ')).join('L')}Z`)
      .join('');
    out.push(`<path d="${d}" fill="#e8eef8" stroke="#10182c" stroke-width="0.45" fill-rule="evenodd"/>`);
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
    }
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
  out.push(`<rect x="${tbx}" y="${tby}" width="118" height="40" fill="#fff" stroke="#10182c" stroke-width="0.5"/>`);
  rows.forEach(([k, v], i) => {
    const y = tby + 6 + i * 6.2;
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
<style>text{font-family:Arial,Helvetica,sans-serif;fill:#10182c}.num{font-size:3.2px;text-anchor:middle}.lbl{font-size:3px;text-anchor:middle;letter-spacing:.4px;fill:#55607a}.note{font-size:2.8px}.key{font-size:2.4px;fill:#55607a;letter-spacing:.3px}.val{font-size:3px;font-weight:700}.dim{stroke:#10182c;stroke-width:.2;fill:none}.ext{stroke:#10182c;stroke-width:.15}</style></defs>
<rect width="${SHEET_W}" height="${SHEET_H}" fill="#fff"/>
<rect x="5" y="5" width="${SHEET_W - 10}" height="${SHEET_H - 10}" fill="none" stroke="#10182c" stroke-width="0.6"/>
${out.join('\n')}
</svg>`;
  return { svg, scale: s, holes };
}
