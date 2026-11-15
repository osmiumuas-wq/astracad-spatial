/**
 * Closed-form expectation: the volume a specification must have, derived
 * without building any geometry (Green's theorem for sketch areas with exact
 * arcs, Pappus for revolves, cylinders and cones for holes).
 *
 * The checker answers only where the answer is exact. If a feature's
 * intersection with the material is not known in closed form (a hole that
 * breaks through a wall, a cut on a tilted plane, a second overlapping boss)
 * it returns `volume: null` with the reason, and the truth gate reports
 * "not verifiable in closed form" instead of guessing.
 */

import { surfaceBox, surfacePatchOf, surfaceVolume } from './surface.js';
import { draftScale, draftVolume } from './profiles.js';
import {
  Frame,
  isSketchOp,
  NAMED_FRAMES,
  numArg,
  resolvePlane,
  sketchIntegrals,
  sketchLoops,
  tessellateLoop,
} from './sketch.js';
import {
  extrudeModifiers,
  ExtrudeMods,
  filletLoops,
  chamferLoops,
  loftPlan,
  loftVolume,
  momentAboutLine,
  offsetLoops,
  shellRange,
  sweepPlan,
} from './advanced.js';
import { Feature, PartSpec, Seg, Vec2, Vec3 } from './types.js';

export interface Expectation {
  /** Exact volume in mm3, or null when no closed form applies. */
  volume: number | null;
  /** Why there is no closed form (set when volume is null). */
  reason?: string;
  /** One line per term, so the number can be audited by hand. */
  terms: string[];
}

/** Clearance a removed region must keep from walls and from other removals, mm. */
const MARGIN = 0.05;

interface Prism {
  frame: Frame;
  polys: Vec2[][];
  z0: number;
  z1: number;
}

interface Removal {
  /** Circle in the prism's (u, v) plane. */
  u: number;
  v: number;
  r: number;
  z0: number;
  z1: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function pointSegDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function insidePolys(p: Vec2, polys: Vec2[][]): boolean {
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function wallDistance(p: Vec2, polys: Vec2[][]): number {
  let d = Infinity;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      d = Math.min(d, pointSegDist(p, poly[i], poly[(i + 1) % poly.length]));
    }
  }
  return d;
}

/** An axis-aligned box that holds a body (conservative: the body lies inside it). */
interface Box {
  min: Vec3;
  max: Vec3;
}

function boxOf(pts: Vec3[], grow = 0): Box {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k] - grow);
      max[k] = Math.max(max[k], p[k] + grow);
    }
  }
  return { min, max };
}

/** True when two boxes share volume (touching faces do not count). */
function overlaps(a: Box, b: Box): boolean {
  for (let k = 0; k < 3; k++) if (Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]) <= 1e-7) return false;
  return true;
}

/** A sketch point at height z along the frame, in model space. */
function onFrame(fr: Frame, q: Vec2, z: number): Vec3 {
  return [
    fr.o[0] + q[0] * fr.x[0] + q[1] * fr.y[0] + z * fr.n[0],
    fr.o[1] + q[0] * fr.x[1] + q[1] * fr.y[1] + z * fr.n[1],
    fr.o[2] + q[0] * fr.x[2] + q[1] * fr.y[2] + z * fr.n[2],
  ];
}

/** The box of a prism: its outline (facets bulge outwards, so this holds the exact one too) at both ends. */
function prismBox(fr: Frame, polys: Vec2[][], z0: number, z1: number): Box {
  const pts: Vec3[] = [];
  for (const poly of polys) for (const q of poly) pts.push(onFrame(fr, q, z0), onFrame(fr, q, z1));
  return boxOf(pts);
}

function unknown(reason: string, terms: string[]): Expectation {
  return { volume: null, reason, terms };
}

const fmt = (v: number): string => v.toFixed(6);

/** Map a point given in `from`'s sketch coordinates into `to`'s (u, v, z). */
function mapPoint(from: Frame, c: Vec2, to: Frame): Vec3 {
  const world: Vec3 = [
    from.o[0] + c[0] * from.x[0] + c[1] * from.y[0],
    from.o[1] + c[0] * from.x[1] + c[1] * from.y[1],
    from.o[2] + c[0] * from.x[2] + c[1] * from.y[2],
  ];
  const rel = sub(world, to.o);
  return [dot3(rel, to.x), dot3(rel, to.y), dot3(rel, to.n)];
}

function range(dir: unknown, depth: number, fallback: 'normal' | 'both'): [number, number] {
  const d = dir === undefined ? fallback : dir;
  return d === 'normal' ? [0, depth] : d === 'reverse' ? [-depth, 0] : [-depth, depth];
}

export function expectVolume(spec: PartSpec): Expectation {
  const terms: string[] = [];
  const frames = new Map<string, Frame>(Object.entries(NAMED_FRAMES));
  const sketches = new Map<string, { frame: Frame; loops: Seg[][] }>();
  let pending: string | null = null;
  let volume = 0;
  let prism: Prism | null = null;
  let revolved = false;
  /** Boxes of the bodies so far: a new body whose box only touches theirs adds its volume exactly. */
  const bodies: Box[] = [];
  let mirrored = false;
  /** A new body: refused when its box shares volume with an earlier body's (then the union has no closed form). */
  const addBody = (box: Box | Box[], id: string): string | null => {
    const list = Array.isArray(box) ? box : [box];
    for (const b of bodies) for (const nb of list) if (overlaps(b, nb)) return `"${id}": this body may overlap an earlier one; their union has no closed form here`;
    bodies.push(...list);
    return null;
  };
  /** A removal (hole, cut) must stay in the first body: its box may not share volume with any later body. */
  const clearOfOthers = (box: Box, id: string): string | null => {
    if (mirrored) return `"${id}": a cut after a mirror is not derived here`;
    for (let k = 1; k < bodies.length; k++) if (overlaps(bodies[k], box)) return `"${id}": the cut reaches a later body`;
    return null;
  };
  const removals: Removal[] = [];
  /** Volume removed by each hole feature, per instance, for patterns. */
  const holeSeeds = new Map<string, { circles: Removal[]; perInstance: number[] }>();
  let mods: Map<string, ExtrudeMods>;
  try {
    mods = extrudeModifiers(spec.features, spec.features.length);
  } catch (e) {
    return unknown(e instanceof Error ? e.message : String(e), terms);
  }

  const takeSketch = (f: Feature) => {
    const key: string | null = typeof f.args.sketch === 'string' ? f.args.sketch : pending;
    const sk = key ? sketches.get(key) : undefined;
    if (key === pending) {
      pending = null;
    }
    return sk;
  };

  /** Check one cylindrical removal against the prism and earlier removals; null = fine. */
  const blocked = (c: Removal): string | null => {
    if (!prism) {
      return 'no prismatic body';
    }
    const p: Vec2 = [c.u, c.v];
    if (!insidePolys(p, prism.polys)) {
      return 'a hole centre is outside the material';
    }
    if (wallDistance(p, prism.polys) < c.r + MARGIN) {
      return 'a hole meets or comes within 0.05 mm of a wall';
    }
    for (const o of removals) {
      const overlapZ = Math.min(c.z1, o.z1) - Math.max(c.z0, o.z0) > 0;
      if (overlapZ && Math.hypot(c.u - o.u, c.v - o.v) < c.r + o.r + MARGIN) {
        return 'two removed regions overlap or nearly touch';
      }
    }
    return null;
  };

  for (const f of spec.features) {
    const a = f.args ?? {};
    if (f.$op === 'doc.note') {
      continue;
    }
    if (f.$op === 'ref.plane') {
      frames.set(f.id, resolvePlane(f, frames));
      continue;
    }
    if (isSketchOp(f.$op)) {
      const frame = frames.get(f.sketched_on ?? '');
      if (!frame) {
        return unknown(`unknown plane "${f.sketched_on}"`, terms);
      }
      sketches.set(f.id, { frame, loops: sketchLoops(f) });
      pending = f.id;
      continue;
    }

    if (f.$op === 'feature.extrude') {
      const sk = takeSketch(f);
      if (!sk) {
        return unknown('no sketch to extrude', terms);
      }
      const second = bodies.length > 0;
      const before = volume;
      const depth = numArg(a.depth, 'depth');
      const [z0, z1] = range(a.direction, depth, 'normal');
      const mod = mods.get(f.id);
      if (second && mod?.shell) return unknown(`"${f.id}": a shelled second body is not derived here`, terms);
      let loops = sk.loops;
      let inner: Seg[][] | null = null;
      let cavity: [number, number] | null = null;
      try {
        if (mod?.fillet) loops = filletLoops(sk.loops, mod.fillet);
        else if (mod?.chamfer) loops = chamferLoops(sk.loops, mod.chamfer);
        if (mod?.shell) {
          inner = offsetLoops(loops, mod.shell.t);
          cavity = shellRange([z0, z1], a.direction, mod.shell.t, mod.shell.open, 0).solid;
        }
      } catch (e) {
        return unknown(`"${f.id}": ${e instanceof Error ? e.message : String(e)}`, terms);
      }
      const area = sketchIntegrals(loops).area;
      volume = area * (z1 - z0);
      const dr = a.draft === undefined ? 0 : Number(a.draft);
      if (dr > 0 && !mod?.shell) {
        // Draft: the outline scales linearly to (sx, sy) at the top (src/engine/profiles.ts).
        const xs = loops.flat().flatMap((s) => (s[0] === 'C' ? [s[1] - s[3], s[1] + s[3]] : [s[1], s[3]]));
        const ys = loops.flat().flatMap((s) => (s[0] === 'C' ? [s[2] - s[3], s[2] + s[3]] : [s[2], s[4]]));
        const [sx, sy] = draftScale(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), z1 - z0, dr);
        volume = draftVolume(area, z1 - z0, sx, sy);
        terms.push(`${f.id}: drafted ${fmt(dr)} deg, top scaled ${fmt(sx)} x ${fmt(sy)}`);
      }
      terms.push(
        `${f.id}: area ${fmt(area)}${mod?.fillet ? ` (corners rounded r ${fmt(mod.fillet)})` : ''} x height ${fmt(z1 - z0)} = ${fmt(volume)}`,
      );
      if (inner && cavity) {
        const innerArea = sketchIntegrals(inner).area;
        const removed = innerArea * (cavity[1] - cavity[0]);
        volume -= removed;
        terms.push(`${f.id}: shell ${fmt(mod!.shell!.t)} mm, cavity area ${fmt(innerArea)} x ${fmt(cavity[1] - cavity[0])} = -${fmt(removed)}`);
        // A hollow body: later holes may break into the cavity, which this checker does not derive.
        revolved = true;
        continue;
      }
      const polysNow = loops.map(tessellateLoop);
      const why = addBody(prismBox(sk.frame, polysNow, z0, z1), f.id);
      if (why) return unknown(why, terms);
      if (second) {
        volume += before;
        terms.push(`${f.id}: a separate body, touching the others: volumes add`);
      } else {
        prism = { frame: sk.frame, polys: polysNow, z0, z1 };
      }
      continue;
    }

    if (f.$op === 'feature.edge_fillet' || f.$op === 'feature.round' || f.$op === 'feature.thread') {
      return unknown(`"${f.id}": an edge fillet's volume is checked by its own closed form in the tests, not here`, terms);
    }
    if (f.$op === 'feature.surface') {
      // The sampled freeform solid: exact for its grid (src/engine/surface.ts), a body of its own.
      let sp;
      try {
        sp = surfacePatchOf(a);
      } catch (e) {
        return unknown(`"${f.id}": ${e instanceof Error ? e.message : String(e)}`, terms);
      }
      const why = addBody(surfaceBox(sp), f.id);
      if (why) return unknown(why, terms);
      const sv = surfaceVolume(sp);
      volume = bodies.length > 1 ? volume + sv : sv;
      terms.push(`${f.id}: freeform patch ${fmt(sp.sx)} x ${fmt(sp.sz)}, ${sp.thickness > 0 ? `sheet ${fmt(sp.thickness)} thick` : 'filled to its base'}: ${fmt(sv)}`);
      if (bodies.length === 1) revolved = true;
      continue;
    }
    if (f.$op === 'feature.mesh') {
      return unknown(`"${f.id}": an imported body is measured by the kernel from its STEP geometry, not a formula`, terms);
    }
    if (f.$op === 'feature.mirror') {
      // The copy only touches the original (it lies wholly on the far side of the plane): the volume doubles.
      const axis = String(a.plane ?? 'X').toUpperCase();
      const k: number = axis === 'X' ? 0 : axis === 'Y' ? 1 : axis === 'Z' ? 2 : -1;
      const off = a.offset === undefined ? 0 : Number(a.offset);
      if (k < 0 || !bodies.length) return unknown(`"${f.id}": a mirrored copy may overlap the original`, terms);
      const all = boxOf(bodies.flatMap((b) => [b.min, b.max]));
      const flip = (b: Box): Box => {
        const min: Vec3 = [...b.min] as Vec3;
        const max: Vec3 = [...b.max] as Vec3;
        min[k] = 2 * off - b.max[k];
        max[k] = 2 * off - b.min[k];
        return { min, max };
      };
      if (overlaps(all, flip(all))) return unknown(`"${f.id}": the mirror plane passes through the part, so the copy overlaps it`, terms);
      bodies.push(...bodies.map(flip));
      volume *= 2;
      mirrored = true;
      terms.push(`${f.id}: mirrored across ${axis} = ${fmt(off)}, touching the original: volume doubles to ${fmt(volume)}`);
      continue;
    }
    if (f.$op === 'feature.fillet' || f.$op === 'feature.shell' || f.$op === 'feature.chamfer') {
      continue; // folded into the extrusion it names
    }

    if (f.$op === 'feature.loft') {
      const ids = Array.isArray(a.sketches) ? (a.sketches as string[]) : [];
      const sections = ids.map((k) => sketches.get(k));
      if (sections.length < 2 || sections.some((x) => !x)) {
        return unknown(`"${f.id}": the loft needs at least two known sketches`, terms);
      }
      let lv: { volume: number | null; terms: string[] };
      try {
        lv = loftVolume(loftPlan(sections as { frame: Frame; loops: Seg[][] }[]));
      } catch (e) {
        return unknown(`"${f.id}": ${e instanceof Error ? e.message : String(e)}`, terms);
      }
      if (lv.volume === null) {
        return unknown(`"${f.id}": profiles of different kinds or corner counts are resampled; that loft has no closed form`, terms);
      }
      terms.push(...lv.terms.map((t) => `${f.id}: ${t}`));
      {
        const pts: Vec3[] = [];
        for (const s of sections as { frame: Frame; loops: Seg[][] }[]) for (const poly of s.loops.map(tessellateLoop)) for (const q of poly) pts.push(onFrame(s.frame, q, 0));
        const why = addBody(boxOf(pts), f.id);
        if (why) return unknown(why, terms);
      }
      volume += lv.volume;
      revolved = true;
      continue;
    }

    if (f.$op === 'feature.sweep') {
      const sk = takeSketch(f);
      if (!sk) {
        return unknown('no sketch to sweep', terms);
      }
      let plan: ReturnType<typeof sweepPlan>;
      try {
        plan = sweepPlan(sk.frame, sk.loops, a.path as Vec3[], a.bend_radius === undefined ? undefined : numArg(a.bend_radius, 'bend_radius'));
      } catch (e) {
        return unknown(`"${f.id}": ${e instanceof Error ? e.message : String(e)}`, terms);
      }
      const integ = sketchIntegrals(plan.loops);
      let straight = 0;
      for (const r of plan.runs) straight += r.length;
      let sv = integ.area * straight;
      terms.push(`${f.id}: profile area ${fmt(integ.area)} x straight length ${fmt(straight)} = ${fmt(sv)}`);
      for (const b of plan.bends) {
        const moment = momentAboutLine(integ, b.p0, b.ax);
        const part = ((b.angle * Math.PI) / 180) * moment;
        sv += part;
        terms.push(`${f.id}: bend, Pappus ${fmt((b.angle * Math.PI) / 180)} rad x first moment ${fmt(moment)} = ${fmt(part)}`);
      }
      {
        // The tube lies within the profile's reach of the path (bends cut inside the corners).
        const path = a.path as Vec3[];
        let reach = 0;
        for (const poly of sk.loops.map(tessellateLoop)) for (const q of poly) {
          const w = onFrame(sk.frame, q, 0);
          reach = Math.max(reach, Math.hypot(w[0] - path[0][0], w[1] - path[0][1], w[2] - path[0][2]));
        }
        // One box per run: the profile's reach across it, and along it only past a bend (a free end is flat).
        const boxes = path.slice(0, -1).map((p0, i) => {
          const p1 = path[i + 1];
          const b = boxOf([p0, p1], reach);
          const d: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
          const k = d.findIndex((x, j) => Math.abs(x) > 1e-9 && d.every((y, m) => m === j || Math.abs(y) < 1e-9));
          if (k >= 0) {
            const lo = Math.min(p0[k], p1[k]);
            const hi = Math.max(p0[k], p1[k]);
            const startLo = p0[k] <= p1[k];
            if (i === 0) {
              if (startLo) b.min[k] = lo;
              else b.max[k] = hi;
            }
            if (i === path.length - 2) {
              if (startLo) b.max[k] = hi;
              else b.min[k] = lo;
            }
          }
          return b;
        });
        const why = addBody(boxes, f.id);
        if (why) return unknown(why, terms);
      }
      volume += sv;
      revolved = true;
      continue;
    }

    if (f.$op === 'feature.revolve') {
      const sk = takeSketch(f);
      if (!sk) {
        return unknown('no sketch to revolve', terms);
      }
      if (prism || revolved) {
        return unknown(`"${f.id}": a second boss may overlap the first`, terms);
      }
      const angle = (numArg(a.angle, 'angle', 360) * Math.PI) / 180;
      const integ = sketchIntegrals(sk.loops);
      let moment: number;
      if (a.axis === undefined || a.axis === 'u') {
        moment = Math.abs(integ.mv);
      } else if (a.axis === 'v') {
        moment = Math.abs(integ.mu);
      } else {
        const line = (a.axis as { line: [Vec2, Vec2] }).line;
        const l = Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]);
        const nx = -(line[1][1] - line[0][1]) / l;
        const ny = (line[1][0] - line[0][0]) / l;
        // First moment about the line: integral of the signed distance to it.
        moment = Math.abs(
          nx * (integ.mu - line[0][0] * integ.area) + ny * (integ.mv - line[0][1] * integ.area),
        );
      }
      volume = angle * moment;
      terms.push(`${f.id}: Pappus, angle ${fmt(angle)} rad x first moment ${fmt(moment)} = ${fmt(volume)}`);
      revolved = true;
      continue;
    }

    if (f.$op === 'feature.hole') {
      if (!prism) {
        return unknown(`"${f.id}": holes are derived only in a prismatic body`, terms);
      }
      const frame = frames.get(f.sketched_on ?? '');
      if (!frame) {
        return unknown(`unknown plane "${f.sketched_on}"`, terms);
      }
      const along = dot3(frame.n, prism.frame.n);
      if (Math.abs(Math.abs(along) - 1) > 1e-9) {
        return unknown(`"${f.id}": the hole axis is not parallel to the extrusion`, terms);
      }
      const d = numArg(a.diameter, 'diameter');
      const r = d / 2;
      const type = a.type === undefined ? 'simple' : String(a.type);
      const centers: Vec2[] = Array.isArray(a.centers)
        ? (a.centers as Vec2[])
        : Array.isArray(a.center)
          ? [a.center as Vec2]
          : [];
      const through = a.through_all === true;
      const depth = through ? Infinity : numArg(a.depth, 'depth');
      const local = range(a.direction, depth, 'both');
      const sign = a.direction === 'reverse' ? -1 : 1;
      const perInstance: number[] = [];
      const circles: Removal[] = [];
      for (const c of centers) {
        const p = mapPoint(frame, c, prism.frame);
        // The hole frame may point with or against the prism axis.
        const zs = [p[2] + along * local[0], p[2] + along * local[1]].sort((x, y) => x - y);
        const z0 = Math.max(prism.z0, zs[0]);
        const z1 = Math.min(prism.z1, zs[1]);
        if (!(z1 > z0)) {
          return unknown(`"${f.id}": the hole does not enter the material`, terms);
        }
        let removed = Math.PI * r * r * (z1 - z0);
        let rMax = r;
        if (type === 'counterbore' || type === 'countersink') {
          const entry = p[2];
          const onFace = Math.abs(entry - prism.z0) < 1e-9 || Math.abs(entry - prism.z1) < 1e-9;
          const inward = along * sign > 0 ? Math.abs(entry - prism.z0) < 1e-9 : Math.abs(entry - prism.z1) < 1e-9;
          if (!onFace || !inward) {
            return unknown(`"${f.id}": the counterbore / countersink does not start on a face, going in`, terms);
          }
          if (type === 'counterbore') {
            const R = numArg(a.cbore_diameter, 'cbore_diameter') / 2;
            const cd = numArg(a.cbore_depth, 'cbore_depth');
            if (cd > z1 - z0 + 1e-9) {
              return unknown(`"${f.id}": the counterbore is deeper than the hole`, terms);
            }
            removed += Math.PI * (R * R - r * r) * cd;
            rMax = R;
          } else {
            const R = numArg(a.csk_diameter, 'csk_diameter') / 2;
            const ang = numArg(a.csk_angle, 'csk_angle', 90);
            const h = (R - r) / Math.tan((ang * Math.PI) / 360);
            if (h > z1 - z0 + 1e-9) {
              return unknown(`"${f.id}": the countersink is deeper than the hole`, terms);
            }
            removed += (Math.PI * h * (R * R + R * r + r * r)) / 3 - Math.PI * r * r * h;
            rMax = R;
          }
        }
        const circle: Removal = { u: p[0], v: p[1], r: rMax, z0, z1 };
        {
          const zt = [p[2] + along * local[0], p[2] + along * local[1]].map((z) => Math.max(-1e6, Math.min(1e6, z)));
          const pf = prism.frame;
          const corners: Vec3[] = [];
          for (const du of [-rMax, rMax]) for (const dv of [-rMax, rMax]) for (const z of zt) corners.push(onFrame(pf, [p[0] + du, p[1] + dv], z));
          const clash = clearOfOthers(boxOf(corners), f.id);
          if (clash) return unknown(clash, terms);
        }
        const why = blocked(circle);
        if (why) {
          return unknown(`"${f.id}": ${why}`, terms);
        }
        removals.push(circle);
        circles.push(circle);
        perInstance.push(removed);
        volume -= removed;
      }
      holeSeeds.set(f.id, { circles, perInstance });
      const total = perInstance.reduce((s, v) => s + v, 0);
      terms.push(`${f.id}: ${centers.length} hole(s), removed ${fmt(total)}`);
      continue;
    }

    if (f.$op === 'feature.cut') {
      const sk = takeSketch(f);
      if (!prism || !sk) {
        return unknown(`"${f.id}": cuts are derived only in a prismatic body`, terms);
      }
      const along = dot3(sk.frame.n, prism.frame.n);
      if (Math.abs(Math.abs(along) - 1) > 1e-9) {
        return unknown(`"${f.id}": the cut is not parallel to the extrusion`, terms);
      }
      const depth = a.through_all === true ? Infinity : numArg(a.depth, 'depth');
      const local = range(a.direction, depth, 'both');
      const polys = sk.loops.map(tessellateLoop);
      let zEntry = 0;
      let minWall = Infinity;
      for (const poly of polys) {
        for (const q of poly) {
          const p = mapPoint(sk.frame, q, prism.frame);
          zEntry = p[2];
          if (!insidePolys([p[0], p[1]], prism.polys)) {
            return unknown(`"${f.id}": the cut profile leaves the material`, terms);
          }
          minWall = Math.min(minWall, wallDistance([p[0], p[1]], prism.polys));
          for (const o of removals) {
            if (Math.hypot(p[0] - o.u, p[1] - o.v) < o.r + MARGIN) {
              return unknown(`"${f.id}": the cut overlaps an earlier removal`, terms);
            }
          }
        }
      }
      if (minWall < MARGIN) {
        return unknown(`"${f.id}": the cut meets or comes within 0.05 mm of a wall`, terms);
      }
      const zs = [zEntry + along * local[0], zEntry + along * local[1]].sort((x, y) => x - y);
      {
        const corners: Vec3[] = [];
        for (const poly of polys) for (const q of poly) {
          const m = mapPoint(sk.frame, q, prism.frame);
          for (const z of zs) corners.push(onFrame(prism.frame, [m[0], m[1]], Math.max(-1e6, Math.min(1e6, z))));
        }
        const clash = clearOfOthers(boxOf(corners), f.id);
        if (clash) return unknown(clash, terms);
      }
      const z0 = Math.max(prism.z0, zs[0]);
      const z1 = Math.min(prism.z1, zs[1]);
      if (!(z1 > z0)) {
        return unknown(`"${f.id}": the cut does not enter the material`, terms);
      }
      const area = sketchIntegrals(sk.loops).area;
      const removed = area * (z1 - z0);
      volume -= removed;
      // Later holes must stay clear of this pocket: its outline becomes a wall.
      for (const poly of polys) {
        prism.polys.push(
          poly.map((q) => {
            const p = mapPoint(sk.frame, q, (prism as Prism).frame);
            return [p[0], p[1]] as Vec2;
          }),
        );
      }
      if (z0 > prism.z0 + 1e-9 || z1 < prism.z1 - 1e-9) {
        // A blind pocket: a later hole inside its outline would be shorter than
        // the checker assumes. Marking the outline as a wall above keeps holes out.
      }
      terms.push(`${f.id}: cut area ${fmt(area)} x depth ${fmt(z1 - z0)} = ${fmt(removed)}`);
      continue;
    }

    if (f.$op === 'feature.pattern.circular' || f.$op === 'feature.pattern.linear') {
      if (bodies.length > 1) return unknown(`"${f.id}": patterns in a part of several bodies are not derived here`, terms);
      if (!prism) {
        return unknown(`"${f.id}": patterns are derived only in a prismatic body`, terms);
      }
      const ids = typeof a.feature === 'string' ? [a.feature] : ((a.features as string[]) ?? []);
      const moves: ((c: Vec3) => Vec3)[] = [];
      if (f.$op === 'feature.pattern.linear') {
        const n1 = numArg(a.count, 'count');
        const n2 = numArg(a.count2, 'count2', 1);
        const axes: Record<string, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
        const d1 = typeof a.direction === 'string' ? axes[a.direction] : (a.direction as Vec3);
        const d2 = n2 > 1 ? (typeof a.direction2 === 'string' ? axes[a.direction2] : (a.direction2 as Vec3)) : [0, 0, 0];
        const s1 = numArg(a.spacing, 'spacing');
        const s2 = n2 > 1 ? numArg(a.spacing2, 'spacing2') : 0;
        const l1 = Math.hypot(d1[0], d1[1], d1[2]) || 1;
        const l2 = Math.hypot(d2[0], d2[1], d2[2]) || 1;
        for (let p = 0; p < n1; p++) {
          for (let q = 0; q < n2; q++) {
            if (p === 0 && q === 0) {
              continue;
            }
            const t: Vec3 = [
              (d1[0] / l1) * s1 * p + (d2[0] / l2) * s2 * q,
              (d1[1] / l1) * s1 * p + (d2[1] / l2) * s2 * q,
              (d1[2] / l1) * s1 * p + (d2[2] / l2) * s2 * q,
            ];
            moves.push((c) => [c[0] + t[0], c[1] + t[1], c[2] + t[2]]);
          }
        }
      } else {
        const n = numArg(a.count, 'count');
        const total = numArg(a.angle, 'angle', 360);
        const step = Math.abs(total) >= 360 ? 360 / n : total / (n - 1);
        const axes: Record<string, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
        let origin: Vec3 = (a.center as Vec3) ?? [0, 0, 0];
        let axis: Vec3;
        if (typeof a.axis === 'string') {
          axis = axes[a.axis];
        } else {
          const ax = a.axis as { origin: Vec3; direction: Vec3 };
          origin = ax.origin;
          const l = Math.hypot(...ax.direction);
          axis = [ax.direction[0] / l, ax.direction[1] / l, ax.direction[2] / l];
        }
        if (Math.abs(Math.abs(dot3(axis, prism.frame.n)) - 1) > 1e-9) {
          return unknown(`"${f.id}": the pattern axis is not parallel to the extrusion`, terms);
        }
        for (let k = 1; k < n; k++) {
          const ang = (step * k * Math.PI) / 180;
          const c0 = Math.cos(ang);
          const s0 = Math.sin(ang);
          moves.push((c) => {
            const r = sub(c, origin);
            const ad = dot3(axis, r);
            const cr: Vec3 = [
              axis[1] * r[2] - axis[2] * r[1],
              axis[2] * r[0] - axis[0] * r[2],
              axis[0] * r[1] - axis[1] * r[0],
            ];
            // Rodrigues rotation.
            return [
              origin[0] + r[0] * c0 + cr[0] * s0 + axis[0] * ad * (1 - c0),
              origin[1] + r[1] * c0 + cr[1] * s0 + axis[1] * ad * (1 - c0),
              origin[2] + r[2] * c0 + cr[2] * s0 + axis[2] * ad * (1 - c0),
            ];
          });
        }
      }
      let removedTotal = 0;
      for (const id of ids) {
        const seed = holeSeeds.get(id);
        if (!seed) {
          return unknown(`"${f.id}": only patterns of holes are derived in closed form`, terms);
        }
        const pf = prism.frame;
        for (const move of moves) {
          for (let i = 0; i < seed.circles.length; i++) {
            const c = seed.circles[i];
            // Seed centre on the prism's z = 0 plane, in model space, then moved.
            const world: Vec3 = [
              pf.o[0] + c.u * pf.x[0] + c.v * pf.y[0],
              pf.o[1] + c.u * pf.x[1] + c.v * pf.y[1],
              pf.o[2] + c.u * pf.x[2] + c.v * pf.y[2],
            ];
            const moved = sub(move(world), pf.o);
            const shift = dot3(moved, pf.n);
            if (Math.abs(shift) > 1e-9) {
              return unknown(`"${f.id}": the pattern moves a hole along its own axis`, terms);
            }
            const circle: Removal = {
              u: dot3(moved, pf.x),
              v: dot3(moved, pf.y),
              r: c.r,
              z0: c.z0,
              z1: c.z1,
            };
            const why = blocked(circle);
            if (why) {
              return unknown(`"${f.id}": ${why}`, terms);
            }
            removals.push(circle);
            volume -= seed.perInstance[i];
            removedTotal += seed.perInstance[i];
          }
        }
      }
      terms.push(`${f.id}: ${moves.length} more instance(s), removed ${fmt(removedTotal)}`);
      continue;
    }

    return unknown(`"${f.id}": ${f.$op} has no closed form in this checker`, terms);
  }

  if (!prism && !revolved) {
    return unknown('the specification has no solid feature', terms);
  }
  terms.push(`total: ${fmt(volume)} mm3`);
  return { volume, terms };
}
