/**
 * Weldments: structural members along a frame sketch's lines, as SOLIDWORKS'
 * Structural Member: square, rectangular and round tube, angle and flat bar,
 * each an exact prism of its section along its line, and a cut list (members
 * grouped by profile and length, with mass).
 *
 * Members run to the ends of their centre lines and are joined where they
 * meet; the joints are not mitred or trimmed, so cut-list lengths are centre-
 * line lengths.
 */

export type ProfileKind = 'square' | 'rect' | 'round' | 'angle' | 'flat';

export interface MemberProfile {
  kind: ProfileKind;
  /** Width (or outside diameter), height, wall (or thickness), mm. */
  w: number;
  h: number;
  t: number;
}

export const PROFILE_CODES: ProfileKind[] = ['square', 'rect', 'round', 'angle', 'flat'];

/** The section as loops of points with arc sweeps (deg), centred on the member's line. */
export function profileLoops(p: MemberProfile): { pts: [number, number][]; sweeps: number[] }[] {
  const rect = (w: number, h: number): { pts: [number, number][]; sweeps: number[] } => ({
    pts: [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]],
    sweeps: [0, 0, 0, 0],
  });
  const circle = (r: number): { pts: [number, number][]; sweeps: number[] } => ({ pts: [[r, 0], [-r, 0]], sweeps: [180, 180] });
  switch (p.kind) {
    case 'square':
      return [rect(p.w, p.w), rect(p.w - 2 * p.t, p.w - 2 * p.t)];
    case 'rect':
      return [rect(p.w, p.h), rect(p.w - 2 * p.t, p.h - 2 * p.t)];
    case 'round':
      return [circle(p.w / 2), circle(p.w / 2 - p.t)];
    case 'angle': {
      const a = p.w;
      const b = p.h || p.w;
      const t = p.t;
      const pts: [number, number][] = [[0, 0], [a, 0], [a, t], [t, t], [t, b], [0, b]];
      return [{ pts: pts.map(([x, y]) => [x - a / 2, y - b / 2] as [number, number]), sweeps: pts.map(() => 0) }];
    }
    case 'flat':
      return [rect(p.w, p.t)];
  }
}

/** The section's area (mm2). */
export function profileArea(p: MemberProfile): number {
  switch (p.kind) {
    case 'square':
      return p.w ** 2 - (p.w - 2 * p.t) ** 2;
    case 'rect':
      return p.w * p.h - (p.w - 2 * p.t) * (p.h - 2 * p.t);
    case 'round':
      return Math.PI * ((p.w / 2) ** 2 - (p.w / 2 - p.t) ** 2);
    case 'angle':
      return p.t * (p.w + (p.h || p.w) - p.t);
    case 'flat':
      return p.w * p.t;
  }
}

export function profileName(p: MemberProfile): string {
  const f = (v: number): string => `${+v.toFixed(2)}`;
  switch (p.kind) {
    case 'square':
      return `Square tube ${f(p.w)} x ${f(p.w)} x ${f(p.t)}`;
    case 'rect':
      return `Rectangular tube ${f(p.w)} x ${f(p.h)} x ${f(p.t)}`;
    case 'round':
      return `Round tube ${f(p.w)} x ${f(p.t)}`;
    case 'angle':
      return `Angle ${f(p.w)} x ${f(p.h || p.w)} x ${f(p.t)}`;
    case 'flat':
      return `Flat bar ${f(p.w)} x ${f(p.t)}`;
  }
}

/** The profile named in words: "square tube 20 by 2", "round tube 25 by 2", "angle 30 by 3", "flat bar 40 by 5". */
export function parseProfile(t: string): MemberProfile | null {
  const n = [...t.matchAll(/(\d+(?:\.\d+)?)/gu)].map((m) => parseFloat(m[1]));
  if (/\b(rect|rectangular)\b/u.test(t)) return { kind: 'rect', w: n[0] ?? 40, h: n[1] ?? 20, t: n[2] ?? 2 };
  if (/\b(round|pipe|tube round|circular)\b/u.test(t)) return { kind: 'round', w: n[0] ?? 25, h: n[0] ?? 25, t: n[1] ?? 2 };
  if (/\b(angle|l section|l-section)\b/u.test(t)) return { kind: 'angle', w: n[0] ?? 30, h: n.length > 2 ? n[1] : n[0] ?? 30, t: n.length > 2 ? n[2] : n[1] ?? 3 };
  if (/\b(flat|bar|strip)\b/u.test(t)) return { kind: 'flat', w: n[0] ?? 40, h: n[1] ?? 5, t: n[1] ?? 5 };
  if (/\b(square|box section|tube|shs)\b/u.test(t)) return { kind: 'square', w: n[0] ?? 20, h: n[0] ?? 20, t: n[1] ?? 2 };
  return null;
}

/** A cut list as CSV: item, profile, length, quantity, mass each (g), grouped by profile and length (0.1 mm). */
export function cutListCsv(members: { profile: MemberProfile; length: number }[], density: number): { csv: string; total: number; count: number } {
  const rows = new Map<string, { profile: MemberProfile; length: number; qty: number }>();
  for (const m of members) {
    const key = `${profileName(m.profile)}|${m.length.toFixed(1)}`;
    const r = rows.get(key);
    if (r) r.qty++;
    else rows.set(key, { profile: m.profile, length: Math.round(m.length * 10) / 10, qty: 1 });
  }
  const lines = ['Item,Profile,Length (mm),Quantity,Mass each (g)'];
  let total = 0;
  [...rows.values()]
    .sort((a, b) => b.length - a.length)
    .forEach((r, i) => {
      const mass = (profileArea(r.profile) * r.length * density) / 1000;
      total += r.length * r.qty;
      lines.push(`${i + 1},"${profileName(r.profile)}",${r.length.toFixed(1)},${r.qty},${mass.toFixed(1)}`);
    });
  return { csv: lines.join('\n') + '\n', total, count: members.length };
}
