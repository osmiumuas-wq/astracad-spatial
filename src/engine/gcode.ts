/**
 * G-code for an FDM printer, from the kernel's exact layer sections.
 *
 * The kernel (Kernel.toolpaths) slices the solid, offsets each section inward
 * for the perimeters (Clipper2 inside Manifold) and splits the inside into
 * solid skin (near the top and bottom) and sparse fill. This module does the
 * rest, independent of the kernel so it can be tested on its own:
 *
 *  - hatch: scan-line clipping of a region (even-odd) into parallel segments,
 *    joined boustrophedon to keep travel short;
 *  - extrusion: E = line width x layer height x length / filament area, the
 *    standard volumetric rule;
 *  - time: path length over feed rate, plus travel; filament length and mass.
 *
 * Output is Marlin-flavour G-code (absolute XYZ, relative E), which Prusa,
 * Creality, Anycubic, Bambu (in its G-code mode), Klipper and most others
 * accept. It is a plain, honest slicer: no supports, no bridging rules.
 */

import type { Vec2 } from './types.js';

export interface PrinterSettings {
  /** Bed size, mm. */
  bed: [number, number];
  nozzle: number;
  filament: number;
  /** Line width and layer height, mm. */
  line: number;
  layer: number;
  walls: number;
  /** Solid layers at the top and the bottom. */
  skins: number;
  /** Sparse infill density, 0..1. */
  infill: number;
  nozzleTemp: number;
  bedTemp: number;
  /** Feed rates, mm/s. */
  wallSpeed: number;
  infillSpeed: number;
  firstLayerSpeed: number;
  travelSpeed: number;
  retract: number;
  /** Filament density, g/cm^3. */
  density: number;
}

export const DEFAULT_PRINTER: PrinterSettings = {
  bed: [220, 220],
  nozzle: 0.4,
  filament: 1.75,
  line: 0.45,
  layer: 0.2,
  walls: 2,
  skins: 4,
  infill: 0.2,
  nozzleTemp: 210,
  bedTemp: 60,
  wallSpeed: 40,
  infillSpeed: 60,
  firstLayerSpeed: 20,
  travelSpeed: 150,
  retract: 0.8,
  density: 1.24,
};

export type PathKind = 'wall' | 'skin' | 'infill';

export interface Path {
  kind: PathKind;
  pts: Vec2[];
  closed: boolean;
}

export interface Layer {
  z: number;
  paths: Path[];
}

/** Segments of the lines y' = c (in a frame turned by `angle`) inside `loops` (even-odd), spaced `spacing`, joined zig-zag. */
export function hatch(loops: Vec2[][], angle: number, spacing: number, offset = 0): Vec2[][] {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  // Into the hatch frame: rotate by -angle.
  const turned = loops.map((l) => l.map(([x, y]): Vec2 => [x * ca + y * sa, -x * sa + y * ca]));
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const l of turned) for (const [, y] of l) {
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const out: Vec2[][] = [];
  let flip = false;
  const start = Math.floor((y0 - offset) / spacing) * spacing + offset + spacing / 2;
  for (let c = start; c < y1; c += spacing) {
    const xs: number[] = [];
    for (const l of turned) {
      for (let i = 0; i < l.length; i++) {
        const [ax, ay] = l[i];
        const [bx, by] = l[(i + 1) % l.length];
        // Half-open rule so a vertex on the line counts once.
        if ((ay <= c && by > c) || (by <= c && ay > c)) xs.push(ax + ((c - ay) / (by - ay)) * (bx - ax));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    const segs: [number, number][] = [];
    for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > 1e-6) segs.push([xs[k], xs[k + 1]]);
    if (flip) segs.reverse();
    for (const [a, b] of segs) {
      const p0: Vec2 = flip ? [b, c] : [a, c];
      const p1: Vec2 = flip ? [a, c] : [b, c];
      // Back out of the hatch frame.
      out.push([p0, p1].map(([x, y]): Vec2 => [x * ca - y * sa, x * sa + y * ca]));
    }
    flip = !flip;
  }
  return out;
}

export interface GcodeResult {
  gcode: string;
  /** Filament used, mm, and its mass, g. */
  filamentMm: number;
  grams: number;
  /** Estimated print time, s (moves only: no heating, no acceleration limits). */
  seconds: number;
  layers: number;
}

const f3 = (v: number): string => (Math.round(v * 1000) / 1000).toString();

/** G-code for the layers, which are already placed on the bed (mm, z from 0). */
export function toGcode(layers: Layer[], s: PrinterSettings, title = 'part'): GcodeResult {
  const area = Math.PI * (s.filament / 2) ** 2;
  const out: string[] = [];
  let e = 0;
  let t = 0;
  let x = 0;
  let y = 0;
  const travel = (px: number, py: number): void => {
    const d = Math.hypot(px - x, py - y);
    if (d < 1e-6) return;
    if (d > 2) out.push(`G1 E-${f3(s.retract)} F2400`);
    out.push(`G0 X${f3(px)} Y${f3(py)} F${s.travelSpeed * 60}`);
    if (d > 2) out.push(`G1 E${f3(s.retract)} F2400`);
    t += d / s.travelSpeed;
    x = px;
    y = py;
  };
  const extrude = (px: number, py: number, speed: number): void => {
    const d = Math.hypot(px - x, py - y);
    if (d < 1e-6) return;
    const de = (s.line * s.layer * d) / area;
    e += de;
    out.push(`G1 X${f3(px)} Y${f3(py)} E${f3(de)} F${speed * 60}`);
    t += d / speed;
    x = px;
    y = py;
  };
  out.push(
    `; ${title}, sliced by AstraCAD Spatial (Manifold sections, Clipper2 offsets)`,
    `; layer ${s.layer} mm, line ${s.line} mm, ${s.walls} walls, ${s.skins} top/bottom layers, ${Math.round(s.infill * 100)} % infill`,
    'G21 ; mm',
    'G90 ; absolute XYZ',
    'M83 ; relative E',
    `M140 S${s.bedTemp}`,
    `M104 S${s.nozzleTemp}`,
    `M190 S${s.bedTemp}`,
    `M109 S${s.nozzleTemp}`,
    'G28 ; home',
    'G92 E0',
    // A purge line along the front of the bed.
    'G0 X5 Y5 Z0.3 F3000',
    `G1 X5 Y${Math.min(120, s.bed[1] - 10)} E${f3((0.6 * 0.3 * Math.min(115, s.bed[1] - 15)) / area)} F1500`,
  );
  // The purge line counts as filament used.
  e += (0.6 * 0.3 * Math.min(115, s.bed[1] - 15)) / area;
  x = 5;
  y = Math.min(120, s.bed[1] - 10);
  layers.forEach((L, i) => {
    out.push(`;LAYER:${i}`, `G0 Z${f3(L.z)} F600`);
    if (i === 1) out.push('M106 S255 ; fan on');
    for (const p of L.paths) {
      if (!p.pts.length) continue;
      const speed = i === 0 ? s.firstLayerSpeed : p.kind === 'wall' ? s.wallSpeed : s.infillSpeed;
      out.push(`;TYPE:${p.kind}`);
      travel(p.pts[0][0], p.pts[0][1]);
      for (let k = 1; k < p.pts.length; k++) extrude(p.pts[k][0], p.pts[k][1], speed);
      if (p.closed) extrude(p.pts[0][0], p.pts[0][1], speed);
    }
  });
  const top = layers.length ? layers[layers.length - 1].z : 0;
  out.push('M107', `G1 E-${f3(s.retract * 2)} F2400`, `G0 Z${f3(Math.min(top + 10, 200))} F600`, `G0 X0 Y${s.bed[1] - 10} F${s.travelSpeed * 60}`, 'M104 S0', 'M140 S0', 'M84', '; end');
  const grams = ((e * area) / 1000) * s.density;
  return { gcode: out.join('\n') + '\n', filamentMm: e, grams, seconds: t, layers: layers.length };
}
