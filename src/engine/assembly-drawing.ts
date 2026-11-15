/**
 * An assembly drawing on an A4 sheet, as SVG: the assembly in isometric view
 * with hidden lines removed (src/engine/hidden-lines.ts), a numbered balloon
 * on each item with a leader to a visible edge of it, the bill of materials
 * as a table, and a title block.
 */

import { VIEW_AXES, viewLines } from './hidden-lines.js';

export interface AssemblyPart {
  /** The BOM item number of this instance. */
  item: number;
  /** World millimetres (the instance where it sits in the assembly). */
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

export interface BomRow {
  item: number;
  name: string;
  part: string;
  material: string;
  qty: number;
  massG: number;
}

const SHEET_W = 297;
const SHEET_H = 210;
const esc = (s: string): string => s.replace(/[&<>"]/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export function assemblyDrawingSvg(parts: AssemblyPart[], bom: BomRow[], title: string, date: string): { svg: string; balloons: number; scale: number } {
  const lines = viewLines(parts, VIEW_AXES.iso);
  // The view fills the left of the sheet: x 12..190, y 14..196 (the table and title block sit to the right).
  const areaX = 12;
  const areaY = 22;
  const areaW = 168;
  const areaH = 150;
  const w = lines.max[0] - lines.min[0] || 1;
  const h = lines.max[1] - lines.min[1] || 1;
  const scale = Math.min(areaW / w, areaH / h);
  const ox = areaX + (areaW - w * scale) / 2;
  const oy = areaY + (areaH - h * scale) / 2;
  const toSheet = (x: number, y: number): [number, number] => [ox + (x - lines.min[0]) * scale, oy + (lines.max[1] - y) * scale];
  let d = '';
  for (let i = 0; i < lines.visible.length; i += 4) {
    const [x1, y1] = toSheet(lines.visible[i], lines.visible[i + 1]);
    const [x2, y2] = toSheet(lines.visible[i + 2], lines.visible[i + 3]);
    d += `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  const out: string[] = [`<path d="${d}" class="vis"/>`];
  // Balloons: one per item, on the first instance of it that shows, at its visible edge nearest its middle.
  const cx = ox + (w * scale) / 2;
  const cy = oy + (h * scale) / 2;
  const anchors: { item: number; at: [number, number]; angle: number }[] = [];
  const done = new Set<number>();
  parts.forEach((part, bi) => {
    if (done.has(part.item)) return;
    let sx = 0;
    let sy = 0;
    let n = 0;
    const segs: [number, number][] = [];
    for (let k = 0; k < lines.visibleBody.length; k++) {
      if (lines.visibleBody[k] !== bi) continue;
      const i = k * 4;
      const m = toSheet((lines.visible[i] + lines.visible[i + 2]) / 2, (lines.visible[i + 1] + lines.visible[i + 3]) / 2);
      segs.push(m);
      sx += m[0];
      sy += m[1];
      n++;
    }
    if (!n) return;
    const mid: [number, number] = [sx / n, sy / n];
    let best = segs[0];
    for (const s of segs) if (Math.hypot(s[0] - mid[0], s[1] - mid[1]) < Math.hypot(best[0] - mid[0], best[1] - mid[1])) best = s;
    done.add(part.item);
    anchors.push({ item: part.item, at: best, angle: Math.atan2(best[1] - cy, best[0] - cx) });
  });
  // Round the view, in angle order, at least 16 degrees apart.
  anchors.sort((a, b) => a.angle - b.angle);
  for (let k = 1; k < anchors.length; k++) anchors[k].angle = Math.max(anchors[k].angle, anchors[k - 1].angle + (16 * Math.PI) / 180);
  const R = Math.max(w * scale, h * scale) / 2 + 9;
  for (const a of anchors) {
    const bx = Math.max(areaX + 5, Math.min(areaX + areaW + 8, cx + Math.cos(a.angle) * R));
    const by = Math.max(14, Math.min(SHEET_H - 14, cy + Math.sin(a.angle) * R));
    const len = Math.hypot(bx - a.at[0], by - a.at[1]) || 1;
    const ex = bx - ((bx - a.at[0]) / len) * 4.2;
    const ey = by - ((by - a.at[1]) / len) * 4.2;
    out.push(
      `<circle cx="${a.at[0].toFixed(2)}" cy="${a.at[1].toFixed(2)}" r="0.6" fill="#10182c"/>`,
      `<line x1="${a.at[0].toFixed(2)}" y1="${a.at[1].toFixed(2)}" x2="${ex.toFixed(2)}" y2="${ey.toFixed(2)}" class="lead"/>`,
      `<circle cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="4.2" class="ball"/>`,
      `<text x="${bx.toFixed(2)}" y="${(by + 1.3).toFixed(2)}" class="bn">${a.item}</text>`,
    );
  }
  // The bill of materials, top right.
  const tx = 196;
  const ty = 14;
  const cols: [string, number][] = [['ITEM', 9], ['NAME', 26], ['PART', 24], ['MAT', 12], ['QTY', 9], ['MASS g', 11]];
  const rowH = 5.2;
  const tw = cols.reduce((s, c) => s + c[1], 0);
  out.push(`<rect x="${tx}" y="${ty}" width="${tw}" height="${rowH * (bom.length + 1)}" fill="#fff" stroke="#10182c" stroke-width="0.4"/>`);
  let x = tx;
  for (const [name, cw] of cols) {
    out.push(`<text x="${x + 1.2}" y="${ty + 3.6}" class="key">${name}</text>`);
    x += cw;
    out.push(`<line x1="${x}" y1="${ty}" x2="${x}" y2="${ty + rowH * (bom.length + 1)}" class="grid"/>`);
  }
  bom.forEach((r, i) => {
    const y = ty + rowH * (i + 1);
    out.push(`<line x1="${tx}" y1="${y}" x2="${tx + tw}" y2="${y}" class="grid"/>`);
    const cells = [String(r.item), r.name, r.part, r.material, String(r.qty), r.massG.toFixed(1)];
    let cx2 = tx;
    cells.forEach((c, k) => {
      const max = Math.floor(cols[k][1] / 1.6);
      out.push(`<text x="${cx2 + 1.2}" y="${y + 3.7}" class="cell">${esc(c.length > max ? `${c.slice(0, max - 1)}.` : c)}</text>`);
      cx2 += cols[k][1];
    });
  });
  // Title block, bottom right.
  const total = bom.reduce((s, r) => s + r.qty, 0);
  const mass = bom.reduce((s, r) => s + r.qty * r.massG, 0);
  const bx0 = SHEET_W - 10 - 91;
  const by0 = SHEET_H - 10 - 31;
  const rows: [string, string][] = [
    ['ASSEMBLY', title],
    ['PARTS', `${total} (${bom.length} different)`],
    ['MASS', `${mass.toFixed(1)} g`],
    ['VIEW', 'ISOMETRIC, HIDDEN LINES REMOVED, NOT TO SCALE'],
    ['DATE', `${date}   AstraCAD Spatial`],
  ];
  out.push(`<rect x="${bx0}" y="${by0}" width="91" height="31" fill="#fff" stroke="#10182c" stroke-width="0.5"/>`);
  rows.forEach(([k, v], i) => out.push(`<text x="${bx0 + 3}" y="${by0 + 6 + i * 5.6}" class="key">${k}</text><text x="${bx0 + 22}" y="${by0 + 6 + i * 5.6}" class="val">${esc(v)}</text>`));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}mm" height="${SHEET_H}mm" viewBox="0 0 ${SHEET_W} ${SHEET_H}">
<title>${esc(title)} assembly drawing</title>
<defs><style>text{font-family:Arial,Helvetica,sans-serif;fill:#10182c}.vis{stroke:#10182c;stroke-width:.3;fill:none;stroke-linecap:round}.lead{stroke:#10182c;stroke-width:.2}.ball{fill:#fff;stroke:#10182c;stroke-width:.35}.bn{font-size:3.6px;font-weight:700;text-anchor:middle}.key{font-size:2.3px;fill:#55607a;letter-spacing:.3px}.val{font-size:2.6px;font-weight:700}.cell{font-size:2.5px}.grid{stroke:#10182c;stroke-width:.15}</style></defs>
<rect width="${SHEET_W}" height="${SHEET_H}" fill="#fff"/>
<rect x="5" y="5" width="${SHEET_W - 10}" height="${SHEET_H - 10}" fill="none" stroke="#10182c" stroke-width="0.6"/>
${out.join('\n')}
</svg>`;
  return { svg, balloons: anchors.length, scale };
}
