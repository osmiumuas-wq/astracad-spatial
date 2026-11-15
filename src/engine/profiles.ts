/**
 * Exact 2D profiles for production parts.
 *
 *  - Involute spur gear (ISO 53 basic rack: 20 degree pressure angle, addendum
 *    m, dedendum 1.25 m): each flank is the involute of the base circle,
 *    sampled finely, from the root circle to the tip circle, the tooth
 *    1/2 pitch thick on the pitch circle.
 *  - ISO metric thread (ISO 68-1 basic profile): the section of the helical
 *    thread at one height. On a screw the radius at angle theta equals the
 *    axial profile at u = P theta / 2 pi, so extruding this section with a
 *    twist of 360 degrees per pitch makes the true helix.
 *  - Sketch shapes: rectangle, slot (two half circles), regular polygon.
 *  - Draft: an extrusion whose outline scales linearly to (sx, sy) at the top
 *    has volume A h (1 + (a + b) / 2 + a b / 3), a = sx - 1, b = sy - 1.
 */

import type { Vec2 } from './types.js';

export interface GearSpec {
  module: number;
  teeth: number;
  pressureDeg?: number;
}

export function gearRadii(g: GearSpec): { pitch: number; base: number; tip: number; root: number } {
  const pa = ((g.pressureDeg ?? 20) * Math.PI) / 180;
  const pitch = (g.module * g.teeth) / 2;
  return { pitch, base: pitch * Math.cos(pa), tip: pitch + g.module, root: pitch - 1.25 * g.module };
}

/** Involute of the base circle rb at roll angle t: the point and its polar angle. */
function involute(rb: number, t: number): Vec2 {
  return [rb * (Math.cos(t) + t * Math.sin(t)), rb * (Math.sin(t) - t * Math.cos(t))];
}

/** The gear outline (counter-clockwise), `samples` points per flank. */
export function gearOutline(g: GearSpec, samples = 10): Vec2[] {
  const { pitch, base, tip, root } = gearRadii(g);
  const pa = ((g.pressureDeg ?? 20) * Math.PI) / 180;
  const z = g.teeth;
  // Half the tooth's angular thickness at the pitch circle, and the involute's polar angle there.
  const inv = (a: number): number => Math.tan(a) - a;
  const halfPitch = Math.PI / (2 * z);
  // The flank's polar angle offset so the tooth is centred on angle 0.
  const off = halfPitch + inv(pa);
  const rStart = Math.max(base, root);
  const tAt = (r: number): number => Math.sqrt(Math.max(0, (r / base) ** 2 - 1));
  const t0 = tAt(rStart);
  const t1 = tAt(tip);
  const flank: Vec2[] = [];
  for (let k = 0; k <= samples; k++) {
    const t = t0 + ((t1 - t0) * k) / samples;
    const [x, y] = involute(base, t);
    flank.push([Math.hypot(x, y), Math.atan2(y, x)]);
  }
  const out: Vec2[] = [];
  const polar = (r: number, a: number): Vec2 => [r * Math.cos(a), r * Math.sin(a)];
  for (let i = 0; i < z; i++) {
    const c = (2 * Math.PI * i) / z;
    // Root before the tooth (from the gap's middle), the right flank up, the tip, the left flank down.
    const gapMid = c - Math.PI / z;
    out.push(polar(root, gapMid));
    if (root < base) out.push(polar(root, c - off));
    for (const [r, a] of flank) out.push(polar(r, c - off + a));
    for (let k = flank.length - 1; k >= 0; k--) {
      const [r, a] = flank[k];
      out.push(polar(r, c + off - a));
    }
    if (root < base) out.push(polar(root, c + off));
  }
  return out;
}

export interface ThreadSpec {
  major: number;
  pitch: number;
  /** Diametral clearance added all round (an internal thread's cutter), mm. */
  clearance?: number;
}

/** ISO 68-1 basic profile: radius at axial position u (0 <= u < P) on a thread of major diameter d. */
export function threadRadius(t: ThreadSpec, u: number): number {
  const P = t.pitch;
  const H = (Math.sqrt(3) / 2) * P;
  const rMaj = t.major / 2 + (t.clearance ?? 0) / 2;
  // Basic minor diameter d1 = d - 2 x 5H/8.
  const rMin = rMaj - (5 * H) / 8;
  const crest = P / 8;
  const rootW = P / 4;
  const flank = (P - crest - rootW) / 2;
  const v = ((u % P) + P) % P;
  if (v < rootW / 2) return rMin;
  if (v < rootW / 2 + flank) return rMin + ((v - rootW / 2) / flank) * (rMaj - rMin);
  if (v < rootW / 2 + flank + crest) return rMaj;
  if (v < rootW / 2 + 2 * flank + crest) return rMaj - ((v - rootW / 2 - flank - crest) / flank) * (rMaj - rMin);
  return rMin;
}

/** The thread's section at one height: radius threadRadius(P theta / 2 pi) at angle theta. */
export function threadSection(t: ThreadSpec, samples = 96): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k < samples; k++) {
    const th = (2 * Math.PI * k) / samples;
    const r = threadRadius(t, (t.pitch * k) / samples);
    out.push([r * Math.cos(th), r * Math.sin(th)]);
  }
  return out;
}

export function rectOutline(w: number, h: number): Vec2[] {
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
}

/** A slot: length L overall (end to end), width W, along x. */
export function slotOutline(L: number, W: number, segs = 16): Vec2[] {
  const r = W / 2;
  const c = Math.max(0, L / 2 - r);
  const out: Vec2[] = [];
  for (let k = 0; k <= segs; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / segs;
    out.push([c + r * Math.cos(a), r * Math.sin(a)]);
  }
  for (let k = 0; k <= segs; k++) {
    const a = Math.PI / 2 + (Math.PI * k) / segs;
    out.push([-c + r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}

/** A regular polygon with n sides across flats `af` (a hex nut's spanner size), a flat at the bottom. */
export function polygonOutline(n: number, af: number): Vec2[] {
  const R = af / 2 / Math.cos(Math.PI / n);
  const out: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + Math.PI / n + (2 * Math.PI * k) / n;
    out.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return out;
}

export function shoelace(p: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/** Volume of an extrusion of area A and height h whose outline scales to (sx, sy) at the top. */
export function draftVolume(A: number, h: number, sx: number, sy: number): number {
  const a = sx - 1;
  const b = sy - 1;
  return A * h * (1 + (a + b) / 2 + (a * b) / 3);
}

/** Top scale factors for a draft angle on an outline with bounding size w x d, height h (inward draft). */
export function draftScale(w: number, d: number, h: number, deg: number): [number, number] {
  const t = Math.tan((deg * Math.PI) / 180);
  return [Math.max(0.01, (w - 2 * h * t) / w), Math.max(0.01, (d - 2 * h * t) / d)];
}
