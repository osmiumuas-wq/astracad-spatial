/**
 * Part Language v2 compiler for the headset.
 *
 * Reads the same typed JSON as desktop AstraCAD (JSON, never code; an unknown
 * operation or argument is an error, never ignored) and builds a watertight
 * triangle solid with the Manifold kernel. Fillets (of an extrusion's
 * outline), shells (of an extrusion), lofts (ruled, through parallel profiles)
 * and sweeps (along a polyline with bends) are built exactly and checked in
 * closed form (src/engine/advanced.ts). Operations that still need a B-rep
 * (fillets of arbitrary edges, chamfers, mirrors, general booleans) are refused
 * by name so the user is told to build them on the desktop pipeline instead of
 * getting a wrong part.
 */

import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import {
  circlePolygon,
  circleSegments,
  cross,
  equalAreaScale,
  Frame,
  isSketchOp,
  NAMED_FRAMES,
  norm,
  numArg,
  resolvePlane,
  sketchLoops,
  tessellateLoop,
} from './sketch.js';
import { crossSection as edgeSection, edgeFaces } from './edges.js';
import { circleOf, edgeChain, segmentsOf } from './round.js';
import { draftScale, threadSection } from './profiles.js';

const dot3k = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Keep only the solid pieces worth keeping: films under 0.01 mm^3 left by a cutting tool are dropped. */
function dropSlivers(body: Manifold, keep: <T extends Disposable>(o: T) => T): Manifold {
  const parts = body.decompose();
  if (parts.length <= 1) {
    for (const p of parts) p.delete();
    return body;
  }
  let out: Manifold | null = null;
  for (const p of parts) {
    keep(p);
    if (p.volume() > 0.01 || p.volume() < -0.01) out = out ? keep(out.add(p)) : p;
  }
  return out ?? body;
}
import { surfaceMesh, surfacePatchOf } from './surface.js';
import { BladeSpec, generate, GeneratedKind } from './generated.js';
import { textBars } from './strokefont.js';
import { knurlSection } from './profiles.js';
import { VIEW_AXES, viewLines, ViewLines } from './hidden-lines.js';
import { chamferLoops, extrudeModifiers, filletLoops, loftPlan, offsetLoops, outerIndex, shellRange, sweepPlan, sweepRings } from './advanced.js';
import {
  BuildOutput,
  Feature,
  KernelProps,
  MeshData,
  PartSpec,
  Seg,
  SpecError,
  Vec2,
  Vec3,
} from './types.js';

type Mat4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

interface Disposable {
  delete(): void;
}

interface Tool {
  solid: Manifold;
  op: 'add' | 'sub';
}

/** Imported solids (from STEP), by id, for feature.mesh: registered in each worker by the page. */
const MESHES = new Map<string, { positions: Float32Array; indices: Uint32Array }>();

export function registerMesh(id: string, positions: Float32Array, indices: Uint32Array): void {
  MESHES.set(id, { positions, indices });
}

const ARG_SETS: Record<string, readonly string[]> = {
  'feature.mesh': ['mesh'],
  'feature.surface': ['origin', 'sx', 'sz', 'n', 'heights', 'thickness'],
  'feature.generated': ['kind', 'spec'],
  'feature.knurl': ['origin', 'axis', 'diameter', 'length', 'pitch', 'diamond'],
  'feature.strip': ['origin', 'm', 'y', 'dir', 'poly', 'width', 'ss', 'se'],
  'feature.text': ['origin', 'normal', 'x_dir', 'text', 'height', 'depth', 'cut'],
  'ref.plane': ['origin', 'normal', 'x_dir', 'base', 'offset'],
  'sketch.rectangle': ['width', 'height', 'x', 'y'],
  'sketch.circle': ['radius', 'diameter', 'x', 'y'],
  'sketch.loops': ['loops'],
  'sketch.profile': ['points'],
  'feature.extrude': ['depth', 'direction', 'sketch', 'draft'],
  'feature.cut': ['depth', 'through_all', 'direction', 'sketch'],
  'feature.revolve': ['angle', 'axis', 'direction', 'sketch'],
  'feature.hole': [
    'diameter', 'depth', 'through_all', 'centers', 'center', 'type',
    'cbore_diameter', 'cbore_depth', 'csk_diameter', 'csk_angle',
    'direction', 'thread',
  ],
  'feature.pattern.linear': [
    'feature', 'features', 'count', 'spacing', 'direction',
    'count2', 'spacing2', 'direction2',
  ],
  'feature.pattern.circular': ['feature', 'features', 'count', 'angle', 'axis', 'center'],
  'feature.fillet': ['radius', 'feature', 'edges'],
  'feature.chamfer': ['distance', 'feature', 'edges'],
  'feature.mirror': ['plane', 'offset'],
  'feature.edge_fillet': ['from', 'to', 'radius', 'kind'],
  'feature.round': ['at', 'radius', 'all', 'kind'],
  'feature.thread': ['origin', 'axis', 'major', 'pitch', 'length', 'internal'],
  'feature.shell': ['thickness', 'feature', 'open'],
  'feature.loft': ['sketches'],
  'feature.sweep': ['sketch', 'path', 'bend_radius'],
  'doc.note': ['text'],
};

/** Operations that exist in the language but need the desktop B-rep kernels. */
const DESKTOP_ONLY = new Set([
  'feature.cut_revolve',
  'body.boolean',
  'feature.parameter',
]);

const AXES: Record<string, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

/** How far a cutting tool is lengthened into empty space, mm. */
const VOID_PROBE = 0.5;

function frameMatrix(f: Frame): Mat4 {
  return [
    f.x[0], f.x[1], f.x[2], 0,
    f.y[0], f.y[1], f.y[2], 0,
    f.n[0], f.n[1], f.n[2], 0,
    f.o[0], f.o[1], f.o[2], 1,
  ];
}

/** Rotation by `deg` about the line through `origin` along unit `axis` (column-major). */
function axisAngleMatrix(origin: Vec3, axis: Vec3, deg: number): Mat4 {
  const [x, y, z] = axis;
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  const r = [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
  const tx = origin[0] - (r[0] * origin[0] + r[1] * origin[1] + r[2] * origin[2]);
  const ty = origin[1] - (r[3] * origin[0] + r[4] * origin[1] + r[5] * origin[2]);
  const tz = origin[2] - (r[6] * origin[0] + r[7] * origin[1] + r[8] * origin[2]);
  return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, tx, ty, tz, 1];
}

function direction(v: unknown, featureId: string): Vec3 {
  if (typeof v === 'string') {
    const d = AXES[v];
    if (!d) {
      throw new SpecError(`unknown direction "${v}"`, featureId);
    }
    return d;
  }
  return norm(v as Vec3);
}

function featureIds(a: Record<string, unknown>, id: string): string[] {
  if (typeof a.feature === 'string') {
    return [a.feature];
  }
  if (Array.isArray(a.features) && a.features.length > 0) {
    return a.features as string[];
  }
  throw new SpecError('pattern needs "feature" or "features"', id);
}

function zRange(
  dir: unknown,
  depth: number,
  fallback: 'normal' | 'both',
  id: string,
): [number, number] {
  const d = dir === undefined ? fallback : dir;
  if (d === 'normal') {
    return [0, depth];
  }
  if (d === 'reverse') {
    return [-depth, 0];
  }
  if (d === 'both') {
    return [-depth, depth];
  }
  throw new SpecError(`unknown direction "${String(d)}"`, id);
}

export class Kernel {
  private readonly m: ManifoldToplevel;

  constructor(toplevel: ManifoldToplevel) {
    this.m = toplevel;
  }

  /** Validate operation names and argument lists without building anything. */
  static validate(spec: PartSpec): void {
    if (spec.units !== 'mm') {
      throw new SpecError('units must be "mm"');
    }
    const seen = new Set<string>();
    for (const f of spec.features) {
      if (!f.id || seen.has(f.id)) {
        throw new SpecError(`missing or duplicate feature id "${f.id}"`);
      }
      seen.add(f.id);
      if (DESKTOP_ONLY.has(f.$op)) {
        throw new SpecError(
          `"${f.$op}" needs the desktop B-rep kernels; the spatial kernel refuses it rather than approximate it`,
          f.id,
        );
      }
      const allowed = ARG_SETS[f.$op];
      if (!allowed) {
        throw new SpecError(`unknown operation "${f.$op}"`, f.id);
      }
      for (const key of Object.keys(f.args ?? {})) {
        if (!allowed.includes(key)) {
          throw new SpecError(`unknown argument "${key}" for ${f.$op}`, f.id);
        }
      }
    }
  }

  /**
   * Build the part. `upTo` applies only the first `upTo` features (the
   * history rail uses this to roll the model back).
   */
  build(spec: PartSpec, upTo = spec.features.length): BuildOutput {
    const t0 = performance.now();
    const arena: Disposable[] = [];
    const keep = <T extends Disposable>(o: T): T => {
      arena.push(o);
      return o;
    };
    try {
      const { solid, applied } = this.construct(spec, upTo, keep);
      const out = this.extract(solid, keep);
      return { ...out, applied, ms: performance.now() - t0 };
    } finally {
      release(arena);
    }
  }

  private construct(
    spec: PartSpec,
    upTo: number,
    keep: <T extends Disposable>(o: T) => T,
  ): { solid: Manifold; applied: string[] } {
    Kernel.validate(spec);
    {
      const { CrossSection: CS } = this.m;
      const frames = new Map<string, Frame>(Object.entries(NAMED_FRAMES));
      /** Rounds already built as part of a fillet set. */
      const roundDone = new Set<string>();
      const sketches = new Map<string, { frame: Frame; loops: Seg[][]; used: boolean }>();
      const tools = new Map<string, Tool[]>();
      let pending: string | null = null;
      let body: Manifold | null = null;
      const applied: string[] = [];
      const count = Math.max(0, Math.min(upTo, spec.features.length));
      const mods = extrudeModifiers(spec.features, count);

      const takeNamed = (key: string, f: Feature) => {
        const sk = sketches.get(key);
        if (!sk) {
          throw new SpecError(`unknown sketch "${key}"`, f.id);
        }
        if (sk.used) {
          throw new SpecError('sketch was already used by another feature', f.id);
        }
        sk.used = true;
        if (key === pending) {
          pending = null;
        }
        return sk;
      };

      const takeSketch = (f: Feature) => {
        const key = typeof f.args.sketch === 'string' ? f.args.sketch : pending;
        const sk = key ? sketches.get(key) : undefined;
        if (!sk) {
          throw new SpecError('no sketch to consume', f.id);
        }
        if (sk.used) {
          throw new SpecError('sketch was already used by another feature', f.id);
        }
        sk.used = true;
        if (key === pending) {
          pending = null;
        }
        return sk;
      };

      const section = (loops: Seg[][]): CrossSection =>
        keep(new CS(loops.map(tessellateLoop), 'EvenOdd'));

      const prism = (cs: CrossSection, z: [number, number], frame: Frame): Manifold => {
        const raw = keep(cs.extrude(z[1] - z[0]));
        const moved = keep(raw.translate(0, 0, z[0]));
        return keep(moved.transform(frameMatrix(frame)));
      };

      /**
       * True when the slab `z` over footprint `cs` holds no material. A cutting
       * tool is lengthened into such a slab, so its end face never lies on a
       * face of the body: sketch coordinates are snapped to a fixed grid by the
       * 2D clipper (about 1e-9 mm), and a tool that stops exactly on a face can
       * otherwise leave a film that thin and close a through hole.
       */
      const isVoid = (cs: CrossSection, z: [number, number], frame: Frame): boolean => {
        const current = body as Manifold | null;
        if (!current) {
          return false;
        }
        const slab = prism(cs, z, frame);
        const hit = keep(current.intersect(slab));
        return hit.volume() <= 1e-6 * slab.volume();
      };

      // Cuts in a row (a hundred holes) are queued and subtracted as one union: one boolean instead of many.
      let cutQueue: Manifold[] = [];
      const flush = (): void => {
        if (!cutQueue.length || !body) return;
        const all = cutQueue.length === 1 ? cutQueue[0] : keep(this.m.Manifold.union(cutQueue));
        body = keep(body.subtract(all));
        cutQueue = [];
      };
      const apply = (tool: Tool, id: string): void => {
        if (tool.op === 'add') {
          flush();
          body = body ? keep(body.add(tool.solid)) : tool.solid;
        } else {
          if (!body) {
            throw new SpecError('nothing to cut: no solid exists yet', id);
          }
          cutQueue.push(tool.solid);
        }
      };
      /** Operations that only add cuts (or nothing to the body) and may leave the queue waiting. */
      const queueSafe = (op: string): boolean => op === 'doc.note' || op === 'ref.plane' || isSketchOp(op) || op === 'feature.cut' || op === 'feature.hole';

      /** Long enough to pass through anything built so far. */
      const reach = (): number => {
        if (!body) {
          return 1000;
        }
        const b = body.boundingBox();
        const far = Math.max(
          ...b.min.map((v) => Math.abs(v)),
          ...b.max.map((v) => Math.abs(v)),
        );
        return 2 * far * Math.SQRT2 * 1.75 + 10;
      };

      for (let i = 0; i < count; i++) {
        const f = spec.features[i];
        const a = f.args ?? {};
        if (!queueSafe(f.$op)) flush();
        try {
          if (f.$op === 'doc.note') {
            // carries text only
          } else if (f.$op === 'ref.plane') {
            frames.set(f.id, resolvePlane(f, frames));
          } else if (isSketchOp(f.$op)) {
            const frame = frames.get(f.sketched_on ?? '');
            if (!frame) {
              throw new SpecError(`unknown plane "${f.sketched_on}"`);
            }
            sketches.set(f.id, { frame, loops: sketchLoops(f), used: false });
            pending = f.id;
          } else if (f.$op === 'feature.extrude' || f.$op === 'feature.cut') {
            const sk = takeSketch(f);
            const isCut = f.$op === 'feature.cut';
            let depth: number;
            if (a.through_all === true) {
              if (!isCut) {
                throw new SpecError('through_all is for cuts only');
              }
              depth = reach();
            } else {
              depth = numArg(a.depth, 'depth');
              if (!(depth > 0)) {
                throw new SpecError('depth must be positive');
              }
            }
            const mod = isCut ? undefined : mods.get(f.id);
            const loops = mod?.fillet ? filletLoops(sk.loops, mod.fillet) : mod?.chamfer ? chamferLoops(sk.loops, mod.chamfer) : sk.loops;
            const cs = section(loops);
            let z = zRange(a.direction, depth, isCut ? 'both' : 'normal', f.id);
            if (isCut) {
              z = [
                isVoid(cs, [z[0] - VOID_PROBE, z[0]], sk.frame) ? z[0] - VOID_PROBE : z[0],
                isVoid(cs, [z[1], z[1] + VOID_PROBE], sk.frame) ? z[1] + VOID_PROBE : z[1],
              ];
            }
            let solid = prism(cs, z, sk.frame);
            // Draft: the outline scales towards its middle up the boss (exact for rectangles and circles).
            const draft = !isCut && a.draft !== undefined ? numArg(a.draft, 'draft') : 0;
            if (draft > 0) {
              if (draft >= 45) throw new SpecError('draft must be under 45 degrees', f.id);
              const b = cs.bounds();
              const w = b.max[0] - b.min[0];
              const d = b.max[1] - b.min[1];
              const h = z[1] - z[0];
              const [sx, sy] = draftScale(w, d, h, draft);
              const cx = (b.min[0] + b.max[0]) / 2;
              const cy = (b.min[1] + b.max[1]) / 2;
              const centred = keep(cs.translate([-cx, -cy]));
              const raw = keep(keep(centred.extrude(h, 0, 0, [sx, sy])).translate([cx, cy, z[0]]));
              solid = keep(raw.transform(frameMatrix(sk.frame)));
            }
            if (mod?.shell) {
              const { cut } = shellRange(z, a.direction, mod.shell.t, mod.shell.open, VOID_PROBE);
              const cavity = prism(section(offsetLoops(loops, mod.shell.t)), cut, sk.frame);
              solid = keep(solid.subtract(cavity));
            }
            const tool: Tool = {
              solid,
              op: isCut ? 'sub' : 'add',
            };
            tools.set(f.id, [tool]);
            apply(tool, f.id);
          } else if (f.$op === 'feature.thread') {
            // An ISO metric thread: the section at one height extruded with a twist of a turn per pitch (src/engine/profiles.ts).
            const o = a.origin as Vec3;
            const ax = norm(a.axis as Vec3);
            const major = numArg(a.major, 'major');
            const pitch = numArg(a.pitch, 'pitch');
            const length = numArg(a.length, 'length');
            if (!(major > 0 && pitch > 0 && length > 0)) throw new SpecError('thread sizes must be positive', f.id);
            const internal = a.internal === true;
            const sec = threadSection({ major, pitch, clearance: internal ? 0.2 : 0 }, 48);
            const cs = keep(new this.m.CrossSection([sec], 'EvenOdd'));
            const turns = length / pitch;
            const raw = keep(cs.extrude(length, Math.max(4, Math.ceil(turns * 36)), -360 * turns));
            const zx: Vec3 = Math.abs(ax[0]) < 0.9 ? norm(cross(ax, [1, 0, 0])) : norm(cross(ax, [0, 1, 0]));
            const zy = cross(ax, zx);
            const tool = keep(raw.transform([zx[0], zx[1], zx[2], 0, zy[0], zy[1], zy[2], 0, ax[0], ax[1], ax[2], 0, o[0], o[1], o[2], 1] as Mat4));
            if (internal) {
              if (!body) throw new SpecError('nothing to tap yet: drill the hole first', f.id);
              body = keep(body.subtract(tool));
            } else {
              body = body ? keep(body.add(tool)) : tool;
            }
            tools.set(f.id, [{ solid: tool, op: internal ? 'sub' : 'add' }]);
          } else if (f.$op === 'feature.round') {
            // Rolling-ball fillets (src/engine/round.ts). Consecutive rounds of one radius form a fillet set: their
            // edge chains are all found on the body as it was before the set, and rounded together, so corners
            // where they meet blend into sphere patches. A lone straight edge or circle takes its exact cutter.
            if (roundDone.has(f.id)) {
              // already built as part of a set
            } else {
              if (!body) throw new SpecError('nothing to round yet', f.id);
              const r = numArg(a.radius, 'radius');
              if (!(r > 0)) throw new SpecError('radius must be positive', f.id);
              const { Manifold: M } = this.m;
              const ball = keep(M.sphere(r, 32));
              const open = (s: Manifold): Manifold => keep(keep(s.minkowskiDifference(ball)).minkowskiSum(ball));
              const close = (s: Manifold): Manifold => keep(keep(s.minkowskiSum(ball)).minkowskiDifference(ball));
              if (a.all === true) {
                const o = open(body);
                if (o.isEmpty()) throw new SpecError(`a ${r} mm round is bigger than the part`, f.id);
                body = o;
              } else {
                // The set: this round and the ones straight after it with the same radius (fillets only).
                const kind = a.kind === 'chamfer' ? 'chamfer' : 'fillet';
                const set: Feature[] = [f];
                for (let k = i + 1; k < count && kind === 'fillet'; k++) {
                  const g = spec.features[k];
                  if (g.$op !== 'feature.round' || g.args?.all === true || g.args?.kind === 'chamfer' || Number(g.args?.radius) !== r) break;
                  set.push(g);
                }
                const mesh = this.extract(body, keep).mesh;
                const segs = segmentsOf(mesh.edges);
                const chains = set.map((g) => {
                  const at = g.args?.at as Vec3;
                  if (!Array.isArray(at) || at.length !== 3) throw new SpecError('"at" must be a point [x, y, z] on the edge', g.id);
                  const ch = edgeChain(segs, at, Math.max(6, 2 * r));
                  if (!ch) throw new SpecError('there is no sharp edge near that point', g.id);
                  return ch;
                });
                for (const g of set) roundDone.add(g.id);
                const one = chains.length === 1 ? chains[0] : null;
                const circ = one ? circleOf(one) : null;
                const straight = one
                  ? one.every(([p, q]) => {
                      const u0 = norm([one[0][1][0] - one[0][0][0], one[0][1][1] - one[0][0][1], one[0][1][2] - one[0][0][2]]);
                      const u = norm([q[0] - p[0], q[1] - p[1], q[2] - p[2]]);
                      return Math.abs(dot3k(u, u0)) > 1 - 1e-6;
                    })
                  : false;
                const [c0, c1] = (one ?? chains[0])[0];
                const efc = edgeFaces(mesh.positions, mesh.indices, c0, c1, 2e-3);
                if (one && circ && efc) {
                  // A circular edge (a hole's or a boss's rim): the exact fillet section revolved round the axis.
                  const flatIs1 = Math.abs(dot3k(efc.n1, circ.n)) > Math.abs(dot3k(efc.n2, circ.n));
                  const nFlat = flatIs1 ? efc.n1 : efc.n2;
                  const tFlat = flatIs1 ? efc.t1 : efc.t2;
                  const tWall = flatIs1 ? efc.t2 : efc.t1;
                  const axis = dot3k(nFlat, circ.n) > 0 ? circ.n : ([-circ.n[0], -circ.n[1], -circ.n[2]] as Vec3);
                  const mid: Vec3 = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2, (c0[2] + c1[2]) / 2];
                  const radial = norm([mid[0] - circ.c[0], mid[1] - circ.c[1], mid[2] - circ.c[2]]);
                  const sRho = dot3k(tFlat, radial) > 0 ? 1 : -1;
                  const sH = dot3k(tWall, axis) > 0 ? 1 : -1;
                  const sec = edgeSection({ ...efc, t1: tFlat, t2: tWall, phi: Math.PI / 2 }, r, kind);
                  const poly: Vec2[] = sec.map(([x, y]) => [circ.r + sRho * x, sH * y]);
                  if (poly.some(([rho]) => rho < 0)) throw new SpecError(`a ${r} mm round does not fit inside that ${(2 * circ.r).toFixed(1)} mm circle`, f.id);
                  const ring = keep(keep(new this.m.CrossSection([poly], 'EvenOdd')).revolve(96));
                  const zx: Vec3 = Math.abs(axis[0]) < 0.9 ? norm(cross(axis, [1, 0, 0])) : norm(cross(axis, [0, 1, 0]));
                  const zy = cross(axis, zx);
                  const tool = keep(ring.transform([zx[0], zx[1], zx[2], 0, zy[0], zy[1], zy[2], 0, axis[0], axis[1], axis[2], 0, circ.c[0], circ.c[1], circ.c[2], 1] as Mat4));
                  body = keep(efc.convex ? body.subtract(tool) : body.add(tool));
                } else if (one && straight && efc && efc.phi < Math.PI - 1e-3) {
                  // A lone straight edge: the exact prism cutter.
                  const ends: Vec3[] = [one[0][0], one[one.length - 1][1]];
                  const poly = edgeSection(efc, r, kind);
                  const L = Math.hypot(ends[1][0] - ends[0][0], ends[1][1] - ends[0][1], ends[1][2] - ends[0][2]);
                  const u = norm([ends[1][0] - ends[0][0], ends[1][1] - ends[0][1], ends[1][2] - ends[0][2]]);
                  const x = efc.t1;
                  const y = norm([efc.t2[0] - x[0] * Math.cos(efc.phi), efc.t2[1] - x[1] * Math.cos(efc.phi), efc.t2[2] - x[2] * Math.cos(efc.phi)]);
                  const zc = cross(x, y);
                  const along: Vec3 = dot3k(zc, u) > 0 ? u : [-u[0], -u[1], -u[2]];
                  const start: Vec3 = along === u ? ends[0] : ends[1];
                  const prism = keep(keep(keep(new this.m.CrossSection([poly], 'EvenOdd')).extrude(L + 0.04)).translate(0, 0, -0.02));
                  const tool = keep(prism.transform([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, along[0], along[1], along[2], 0, start[0], start[1], start[2], 1] as Mat4));
                  body = keep(efc.convex ? body.subtract(tool) : body.add(tool));
                } else if (kind === 'chamfer') {
                  // Any other edge (a slot's rim, a spline, a sweep's edge): the chamfer's section swept along
                  // the chain, one wedge per segment between the sections at its two ends, so the wedges meet
                  // face to face and the bevel is one continuous surface.
                  const ch = chains[0];
                  const d3 = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
                  const closedChain = ch.length > 2 && d3(ch[0][0], ch[ch.length - 1][1]) < 1e-3;
                  const faces = ch.map(([p, q]) => edgeFaces(mesh.positions, mesh.indices, p, q, 2e-3));
                  if (faces.some((e) => !e)) throw new SpecError('the faces along that edge could not be found', f.id);
                  // Keep face 1 on the same side all along the chain.
                  const ef = faces as NonNullable<(typeof faces)[number]>[];
                  for (let i = 1; i < ef.length; i++) {
                    const a = ef[i - 1];
                    const b = ef[i];
                    if (dot3k(a.n1, b.n1) + dot3k(a.t1, b.t1) < dot3k(a.n1, b.n2) + dot3k(a.t1, b.t2)) ef[i] = { ...b, n1: b.n2, n2: b.n1, t1: b.t2, t2: b.t1 };
                  }
                  if (ef.some((e) => e.convex !== ef[0].convex)) throw new SpecError('that edge turns from convex to concave; chamfer each part on its own', f.id);
                  const pts: Vec3[] = closedChain ? ch.map((s) => s[0]) : [...ch.map((s) => s[0]), ch[ch.length - 1][1]];
                  const eps = 0.05 * r + 0.02;
                  const section = (j: number): Vec3[] => {
                    const near = closedChain ? [ef[(j - 1 + ef.length) % ef.length], ef[j % ef.length]] : [ef[j - 1], ef[j]].filter(Boolean);
                    const t1 = norm(near.reduce<Vec3>((s, e) => [s[0] + e.t1[0], s[1] + e.t1[1], s[2] + e.t1[2]], [0, 0, 0]));
                    const t2 = norm(near.reduce<Vec3>((s, e) => [s[0] + e.t2[0], s[1] + e.t2[1], s[2] + e.t2[2]], [0, 0, 0]));
                    let e = pts[j];
                    // Open ends reach a little past the edge, so no film is left at a corner.
                    if (!closedChain && (j === 0 || j === pts.length - 1)) {
                      const tan = norm(j === 0 ? [pts[0][0] - pts[1][0], pts[0][1] - pts[1][1], pts[0][2] - pts[1][2]] : [e[0] - pts[j - 1][0], e[1] - pts[j - 1][1], e[2] - pts[j - 1][2]]);
                      e = [e[0] + tan[0] * 0.02, e[1] + tan[1] * 0.02, e[2] + tan[2] * 0.02];
                    }
                    const bis = norm([t1[0] + t2[0], t1[1] + t2[1], t1[2] + t2[2]]);
                    return [
                      [e[0] + t1[0] * r, e[1] + t1[1] * r, e[2] + t1[2] * r],
                      [e[0] + t2[0] * r, e[1] + t2[1] * r, e[2] + t2[2] * r],
                      [e[0] - bis[0] * eps, e[1] - bis[1] * eps, e[2] - bis[2] * eps],
                    ];
                  };
                  const secs = pts.map((_, j) => section(j));
                  const wedges: Manifold[] = [];
                  for (let j = 0; j < (closedChain ? pts.length : pts.length - 1); j++) {
                    wedges.push(keep(M.hull([...secs[j], ...secs[(j + 1) % pts.length]])));
                  }
                  const tool = keep(M.union(wedges));
                  body = keep(ef[0].convex ? body.subtract(tool) : body.add(tool));
                } else {
                  // The rolling ball on the part near every chain of the set, kept within tubes round them.
                  const R = r * 2.5;
                  let tube: Manifold | null = null;
                  for (const ch of chains) {
                    for (const [p, q] of ch) {
                      const cap = keep(M.hull([keep(M.sphere(R, 16).translate(p)), keep(M.sphere(R, 16).translate(q))]));
                      tube = tube ? keep(tube.add(cap)) : cap;
                    }
                  }
                  const tb = tube!.boundingBox();
                  const m = 2 * r;
                  const clip = keep(M.cube([tb.max[0] - tb.min[0] + 2 * m, tb.max[1] - tb.min[1] + 2 * m, tb.max[2] - tb.min[2] + 2 * m]).translate([tb.min[0] - m, tb.min[1] - m, tb.min[2] - m]));
                  const piece = keep(body.intersect(clip));
                  const removed = keep(keep(piece.subtract(open(piece))).intersect(tube!));
                  body = keep(body.subtract(removed));
                  if (efc && !efc.convex) {
                    const added = keep(keep(close(piece).subtract(piece)).intersect(tube!));
                    body = keep(body.add(added));
                  }
                }
                // Hair-thin films left where a polyhedral tool grazes a face are dropped.
                body = dropSlivers(body, keep);
              }
            }
            tools.set(f.id, []);
          } else if (f.$op === 'feature.edge_fillet') {
            // A fillet or chamfer of any straight edge between two flat faces of the body so far.
            if (!body) throw new SpecError('nothing to round yet', f.id);
            const A = a.from as Vec3;
            const B = a.to as Vec3;
            if (!Array.isArray(A) || !Array.isArray(B) || A.length !== 3 || B.length !== 3) throw new SpecError('"from" and "to" must be points [x, y, z]', f.id);
            const size = numArg(a.radius, 'radius');
            if (!(size > 0)) throw new SpecError('radius must be positive', f.id);
            const kind = a.kind === 'chamfer' ? 'chamfer' : 'fillet';
            const mesh = body.getMesh();
            const np = mesh.numProp;
            const pos = new Float32Array((mesh.vertProperties.length / np) * 3);
            for (let i = 0, j = 0; i < mesh.vertProperties.length; i += np, j += 3) {
              pos[j] = mesh.vertProperties[i];
              pos[j + 1] = mesh.vertProperties[i + 1];
              pos[j + 2] = mesh.vertProperties[i + 2];
            }
            const ef = edgeFaces(pos, mesh.triVerts, A, B, 2e-3);
            if (!ef) throw new SpecError('that edge is not a sharp straight edge between two flat faces', f.id);
            if (ef.phi > Math.PI - 1e-3) throw new SpecError('the faces at that edge are flat to each other', f.id);
            const poly = edgeSection(ef, size, kind);
            const u = norm([B[0] - A[0], B[1] - A[1], B[2] - A[2]]);
            const L = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
            const x = ef.t1;
            const yRaw: Vec3 = [ef.t2[0] - x[0] * Math.cos(ef.phi), ef.t2[1] - x[1] * Math.cos(ef.phi), ef.t2[2] - x[2] * Math.cos(ef.phi)];
            const y = norm(yRaw);
            // Right-handed (x, y, along): flip the run direction if needed.
            const zc = cross(x, y);
            const along: Vec3 = zc[0] * u[0] + zc[1] * u[1] + zc[2] * u[2] > 0 ? u : [-u[0], -u[1], -u[2]];
            const start: Vec3 = along === u ? A : B;
            const cs = keep(new this.m.CrossSection([poly], 'EvenOdd'));
            const prismed = keep(keep(cs.extrude(L + 0.04)).translate(0, 0, -0.02));
            const m: Mat4 = [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, along[0], along[1], along[2], 0, start[0], start[1], start[2], 1];
            const tool = keep(prismed.transform(m));
            body = keep(ef.convex ? body.subtract(tool) : body.add(tool));
            tools.set(f.id, []);
          } else if (f.$op === 'feature.mirror') {
            // Mirror everything built so far across a plane x, y or z = offset, and join the copy.
            if (!body) throw new SpecError('nothing to mirror yet', f.id);
            const axis = String(a.plane ?? 'X').toUpperCase();
            if (axis !== 'X' && axis !== 'Y' && axis !== 'Z') throw new SpecError('mirror plane must be X, Y or Z (the plane normal to that axis)', f.id);
            const k: 0 | 1 | 2 = axis === 'X' ? 0 : axis === 'Y' ? 1 : 2;
            const off = numArg(a.offset, 'offset', 0);
            const n: Vec3 = [0, 0, 0];
            n[k] = 1;
            const shift: Vec3 = [0, 0, 0];
            shift[k] = off;
            const copy = keep(keep(keep(body.translate([-shift[0], -shift[1], -shift[2]])).mirror(n)).translate(shift));
            body = keep(body.add(copy));
            tools.set(f.id, []);
          } else if (f.$op === 'feature.fillet' || f.$op === 'feature.shell' || f.$op === 'feature.chamfer') {
            // Applied to the named extrusion when it was built (see extrudeModifiers).
          } else if (f.$op === 'feature.loft') {
            const ids = a.sketches;
            if (!Array.isArray(ids) || ids.length < 2 || ids.some((k) => typeof k !== 'string')) {
              throw new SpecError('"sketches" must list at least two sketch ids');
            }
            const plan = loftPlan((ids as string[]).map((k) => takeNamed(k, f)));
            const tool: Tool = { solid: this.loftSolid(plan, keep), op: 'add' };
            tools.set(f.id, [tool]);
            apply(tool, f.id);
          } else if (f.$op === 'feature.strip') {
            // A sheet-metal section (in m, y) along an edge: z from -m ss to width + m se (mitred ends shear it).
            const poly = a.poly as [number, number][];
            const W = numArg(a.width, 'width');
            let ss = Number(a.ss ?? 0);
            let se = Number(a.se ?? 0);
            const M = a.m as Vec3;
            const Y = a.y as Vec3;
            let Dd = a.dir as Vec3;
            let o = a.origin as Vec3;
            // Keep the frame right-handed: run the other way from the far end if needed.
            if (dot3k(cross(M, Y), Dd) < 0) {
              o = [o[0] + Dd[0] * W, o[1] + Dd[1] * W, o[2] + Dd[2] * W];
              Dd = [-Dd[0], -Dd[1], -Dd[2]];
              [ss, se] = [se, ss];
            }
            const cs = keep(new this.m.CrossSection([poly], 'EvenOdd'));
            const raw = keep(cs.extrude(1));
            const warped = keep(raw.warp((v: Vec3) => {
              v[2] = v[2] < 0.5 ? -v[0] * ss : W + v[0] * se;
            }));
            const tool: Tool = { solid: keep(warped.transform([M[0], M[1], M[2], 0, Y[0], Y[1], Y[2], 0, Dd[0], Dd[1], Dd[2], 0, o[0], o[1], o[2], 1] as Mat4)), op: 'add' };
            tools.set(f.id, [tool]);
            apply(tool, f.id);
          } else if (f.$op === 'feature.knurl') {
            // A knurled band: a serrated section, extruded straight, or twisted both ways and intersected (diamond).
            const ax = norm(a.axis as Vec3);
            const D = numArg(a.diameter, 'diameter');
            const L = numArg(a.length, 'length');
            const pitch = numArg(a.pitch, 'pitch');
            const star = knurlSection(D, pitch);
            const cs = keep(new this.m.CrossSection([star], 'EvenOdd'));
            let band: Manifold;
            if (a.diamond === true) {
              const twist = ((L * Math.tan(Math.PI / 6)) / (Math.PI * D)) * 360;
              const steps = Math.max(8, Math.ceil(L / (pitch / 2)));
              band = keep(keep(cs.extrude(L, steps, twist)).intersect(keep(cs.extrude(L, steps, -twist))));
            } else band = keep(cs.extrude(L));
            const zx: Vec3 = Math.abs(ax[1]) < 0.9 ? norm(cross([0, 1, 0], ax)) : norm(cross([1, 0, 0], ax));
            const zy = cross(ax, zx);
            const o = a.origin as Vec3;
            const tool: Tool = { solid: keep(band.transform([zx[0], zx[1], zx[2], 0, zy[0], zy[1], zy[2], 0, ax[0], ax[1], ax[2], 0, o[0], o[1], o[2], 1] as Mat4)), op: 'add' };
            tools.set(f.id, [tool]);
            apply(tool, f.id);
          } else if (f.$op === 'feature.text') {
            // Engraved (cut) or embossed text from the stroke font, on a face.
            const bars = textBars(String(a.text ?? ''), numArg(a.height, 'height'));
            if (!bars.length) throw new SpecError('there are no letters the font can draw in that text', f.id);
            const depth = numArg(a.depth, 'depth');
            const cut = a.cut === true;
            const cs = keep(new this.m.CrossSection(bars, 'NonZero'));
            const n = norm(a.normal as Vec3);
            const x = norm(a.x_dir as Vec3);
            const y = cross(n, x);
            const o = a.origin as Vec3;
            const prism = keep(keep(cs.extrude(depth + (cut ? 0.02 : 0))).translate([0, 0, cut ? -depth : 0]));
            const placed = keep(prism.transform([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, n[0], n[1], n[2], 0, o[0], o[1], o[2], 1] as Mat4));
            const tool: Tool = { solid: placed, op: cut ? 'sub' : 'add' };
            tools.set(f.id, [tool]);
            apply(tool, f.id);
          } else if (f.$op === 'feature.generated') {
            // Springs, SubD shapes and blades: closed meshes from src/engine/generated.ts.
            const kind = String(a.kind) as GeneratedKind;
            const gm = generate(kind, a.spec);
            const mesh = new this.m.Mesh({ numProp: 3, vertProperties: new Float32Array(gm.positions), triVerts: new Uint32Array(gm.indices) });
            mesh.merge();
            let solid: Manifold;
            try {
              solid = keep(new this.m.Manifold(mesh));
            } catch {
              throw new SpecError(`that ${kind === 'subd' ? 'shape folds through itself; move its cage points less far' : kind} is not a closed solid`, f.id);
            }
            const bs = a.spec as BladeSpec;
            if (kind === 'blade' && bs.hubR > 0) {
              // The hub: a cylinder on the axis, joined to the blades.
              const ax = bs.axis;
              const zx: Vec3 = Math.abs(ax[1]) < 0.9 ? norm(cross([0, 1, 0], ax)) : norm(cross([1, 0, 0], ax));
              const zy = cross(ax, zx);
              const hub = keep(keep(this.m.Manifold.cylinder(bs.hubH, bs.hubR, bs.hubR, 64)).transform([zx[0], zx[1], zx[2], 0, zy[0], zy[1], zy[2], 0, ax[0], ax[1], ax[2], 0, bs.origin[0], bs.origin[1], bs.origin[2], 1] as Mat4));
              solid = keep(solid.add(hub));
            }
            const tool: Tool = { solid, op: 'add' };
            tools.set(f.id, [tool]);
            apply(tool, f.id);
          } else if (f.$op === 'feature.surface') {
            // A freeform B-spline patch, thickened or filled to its base (src/engine/surface.ts).
            const sp = surfacePatchOf(a);
            const sm = surfaceMesh(sp);
            const mesh = new this.m.Mesh({ numProp: 3, vertProperties: sm.positions, triVerts: sm.indices });
            mesh.merge();
            let solid: Manifold;
            try {
              solid = keep(new this.m.Manifold(mesh));
            } catch {
              throw new SpecError('that surface folds through itself; pull its control points less steeply', f.id);
            }
            const tool: Tool = { solid, op: 'add' };
            tools.set(f.id, [tool]);
            apply(tool, f.id);
          } else if (f.$op === 'feature.mesh') {
            // An imported solid as a body: free-design features then cut, add and round on it.
            const src = MESHES.get(String(a.mesh));
            if (!src) throw new SpecError('the imported body is not loaded in this session; import its STEP file again', f.id);
            const mesh = new this.m.Mesh({ numProp: 3, vertProperties: src.positions, triVerts: src.indices });
            mesh.merge();
            let solid: Manifold;
            try {
              solid = keep(new this.m.Manifold(mesh));
            } catch {
              throw new SpecError('the imported model is not one closed solid, so it can only be a reference', f.id);
            }
            const tool: Tool = { solid, op: 'add' };
            tools.set(f.id, [tool]);
            apply(tool, f.id);
          } else if (f.$op === 'feature.sweep') {
            const sk = takeSketch(f);
            const radius = a.bend_radius === undefined ? undefined : numArg(a.bend_radius, 'bend_radius');
            const plan = sweepPlan(sk.frame, sk.loops, a.path as Vec3[], radius);
            if (plan.steps.length === 0) throw new SpecError('the sweep path has no length');
            const tool: Tool = { solid: this.sweepSolid(plan, keep), op: 'add' };
            tools.set(f.id, [tool]);
            apply(tool, f.id);
          } else if (f.$op === 'feature.revolve') {
            const sk = takeSketch(f);
            const tool: Tool = { solid: this.revolve(sk, a, keep), op: 'add' };
            tools.set(f.id, [tool]);
            apply(tool, f.id);
          } else if (f.$op === 'feature.hole') {
            const frame = frames.get(f.sketched_on ?? '');
            if (!frame) {
              throw new SpecError(`unknown plane "${f.sketched_on}"`);
            }
            const tool: Tool = {
              solid: this.holeTool(a, frame, reach(), keep, isVoid),
              op: 'sub',
            };
            tools.set(f.id, [tool]);
            apply(tool, f.id);
          } else if (f.$op === 'feature.pattern.linear') {
            const n1 = numArg(a.count, 'count');
            const n2 = numArg(a.count2, 'count2', 1);
            if (n1 < 2 || n1 > 1000 || !Number.isInteger(n1) || !Number.isInteger(n2)) {
              throw new SpecError('pattern count must be an integer from 2 to 1000');
            }
            const d1 = direction(a.direction, f.id);
            const s1 = numArg(a.spacing, 'spacing');
            const d2 = n2 > 1 ? direction(a.direction2, f.id) : ([0, 0, 0] as Vec3);
            const s2 = n2 > 1 ? numArg(a.spacing2, 'spacing2') : 0;
            const made: Tool[] = [];
            for (const seedId of featureIds(a, f.id)) {
              const seeds = tools.get(seedId);
              if (!seeds) {
                throw new SpecError(`pattern seed "${seedId}" is not an earlier solid feature`);
              }
              for (const seed of seeds) {
                for (let p = 0; p < n1; p++) {
                  for (let q = 0; q < n2; q++) {
                    if (p === 0 && q === 0) {
                      continue;
                    }
                    const copy: Tool = {
                      solid: keep(
                        seed.solid.translate(
                          d1[0] * s1 * p + d2[0] * s2 * q,
                          d1[1] * s1 * p + d2[1] * s2 * q,
                          d1[2] * s1 * p + d2[2] * s2 * q,
                        ),
                      ),
                      op: seed.op,
                    };
                    made.push(copy);
                    apply(copy, f.id);
                  }
                }
              }
            }
            tools.set(f.id, made);
          } else if (f.$op === 'feature.pattern.circular') {
            const n = numArg(a.count, 'count');
            if (n < 2 || n > 1000 || !Number.isInteger(n)) {
              throw new SpecError('pattern count must be an integer from 2 to 1000');
            }
            const total = numArg(a.angle, 'angle', 360);
            const step = Math.abs(total) >= 360 ? 360 / n : total / (n - 1);
            let origin: Vec3 = (a.center as Vec3) ?? [0, 0, 0];
            let axis: Vec3;
            if (typeof a.axis === 'string') {
              axis = direction(a.axis, f.id);
            } else if (a.axis && typeof a.axis === 'object') {
              const ax = a.axis as { origin: Vec3; direction: Vec3 };
              origin = ax.origin;
              axis = norm(ax.direction);
            } else {
              throw new SpecError('circular pattern needs an axis');
            }
            const made: Tool[] = [];
            for (const seedId of featureIds(a, f.id)) {
              const seeds = tools.get(seedId);
              if (!seeds) {
                throw new SpecError(`pattern seed "${seedId}" is not an earlier solid feature`);
              }
              for (const seed of seeds) {
                for (let k = 1; k < n; k++) {
                  const copy: Tool = {
                    solid: keep(seed.solid.transform(axisAngleMatrix(origin, axis, step * k))),
                    op: seed.op,
                  };
                  made.push(copy);
                  apply(copy, f.id);
                }
              }
            }
            tools.set(f.id, made);
          }
        } catch (e) {
          if (e instanceof SpecError && e.featureId === undefined) {
            throw new SpecError(e.message, f.id);
          }
          throw e;
        }
        applied.push(f.id);
      }

      flush();
      if (count === spec.features.length) {
        for (const [id, sk] of sketches) {
          if (!sk.used) {
            throw new SpecError('sketch is never used', id);
          }
        }
      }
      const solid = body as Manifold | null;
      if (!solid || solid.isEmpty()) {
        throw new SpecError('the specification produces no solid');
      }
      return { solid, applied };
    }
  }

  /**
   * A sweep as one closed mesh through its rings (see sweepRings): one surface,
   * so straight runs and bends join without seams.
   */
  private sweepSolid(plan: ReturnType<typeof sweepPlan>, keep: <T extends Disposable>(o: T) => T): Manifold {
    const { Manifold: M, Mesh, triangulate } = this.m;
    // Outside loop counter-clockwise about the path, openings clockwise, so every face points out of the material.
    const outer = outerIndex(plan.loops);
    const polys = plan.loops.map((loop, i) => {
      const p = tessellateLoop(loop);
      let a = 0;
      for (let k = 0; k < p.length; k++) {
        const q = p[(k + 1) % p.length];
        a += p[k][0] * q[1] - q[0] * p[k][1];
      }
      return (i === outer) === a > 0 ? p : [...p].reverse();
    });
    const stations = sweepRings(plan, polys);
    const per = polys.reduce((s, p) => s + p.length, 0);
    const verts: number[] = [];
    for (const st of stations) for (const loop of st) for (const p of loop) verts.push(p[0], p[1], p[2]);
    const tris: number[] = [];
    for (let k = 0; k + 1 < stations.length; k++) {
      let base = 0;
      for (const poly of polys) {
        const n = poly.length;
        for (let j = 0; j < n; j++) {
          const a = k * per + base + j;
          const b = k * per + base + ((j + 1) % n);
          const c = (k + 1) * per + base + ((j + 1) % n);
          const d = (k + 1) * per + base + j;
          const m = verts.length / 3;
          for (let q = 0; q < 3; q++) verts.push((verts[a * 3 + q] + verts[b * 3 + q] + verts[c * 3 + q] + verts[d * 3 + q]) / 4);
          tris.push(m, a, b, m, b, c, m, c, d, m, d, a);
        }
        base += n;
      }
    }
    const caps = triangulate(polys);
    const last = (stations.length - 1) * per;
    for (const t of caps) {
      tris.push(t[0], t[2], t[1]);
      tris.push(last + t[0], last + t[1], last + t[2]);
    }
    const mesh = new Mesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris) });
    const solid = keep(new M(mesh));
    const status = solid.status();
    if (status !== 'NoError') {
      throw new SpecError(`the sweep is not a valid solid (${status}); the path may run into itself`);
    }
    return solid;
  }

  /** A ruled solid through the loft's rings: side quads split into four triangles about their centre. */
  private loftSolid(plan: ReturnType<typeof loftPlan>, keep: <T extends Disposable>(o: T) => T): Manifold {
    const { Manifold: M, Mesh, triangulate } = this.m;
    const rings = plan.rings;
    const k = rings.length;
    const n = rings[0].length;
    const verts: number[] = [];
    for (const ring of rings) for (const p of ring) verts.push(p[0], p[1], p[2]);
    const tris: number[] = [];
    // Quad centres: the average of the corners makes the four triangles enclose the bilinear patch's volume exactly.
    for (let i = 0; i + 1 < k; i++) {
      for (let j = 0; j < n; j++) {
        const a = i * n + j;
        const b = i * n + ((j + 1) % n);
        const c = (i + 1) * n + ((j + 1) % n);
        const d = (i + 1) * n + j;
        const m = verts.length / 3;
        for (let q = 0; q < 3; q++) verts.push((verts[a * 3 + q] + verts[b * 3 + q] + verts[c * 3 + q] + verts[d * 3 + q]) / 4);
        tris.push(m, a, b, m, b, c, m, c, d, m, d, a);
      }
    }
    // End caps, from the 2D outlines (counter-clockwise about the loft axis).
    const first = triangulate([plan.flat[0]]);
    for (const t of first) tris.push(t[0], t[2], t[1]);
    const last = triangulate([plan.flat[k - 1]]);
    const off = (k - 1) * n;
    for (const t of last) tris.push(off + t[0], off + t[1], off + t[2]);
    const mesh = new Mesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris) });
    const solid = keep(new M(mesh));
    const status = solid.status();
    if (status !== 'NoError') {
      throw new SpecError(`the loft is not a valid solid (${status}); profiles may twist through each other`);
    }
    return solid;
  }

  private revolve(
    sk: { frame: Frame; loops: Seg[][] },
    a: Record<string, unknown>,
    keep: <T extends Disposable>(o: T) => T,
  ): Manifold {
    const { Manifold: M } = this.m;
    const angle = numArg(a.angle, 'angle', 360);
    if (!(angle > 0 && angle <= 360)) {
      throw new SpecError('revolve angle must be in (0, 360]');
    }
    // Axis in sketch coordinates: point p0, unit direction ax.
    let p0: Vec2 = [0, 0];
    let ax: Vec2 = [1, 0];
    if (a.axis === 'v') {
      ax = [0, 1];
    } else if (a.axis && typeof a.axis === 'object') {
      const line = (a.axis as { line: [Vec2, Vec2] }).line;
      p0 = line[0];
      const l = Math.hypot(line[1][0] - p0[0], line[1][1] - p0[1]);
      if (l < 1e-9) {
        throw new SpecError('revolve axis line has zero length');
      }
      ax = [(line[1][0] - p0[0]) / l, (line[1][1] - p0[1]) / l];
    } else if (a.axis !== undefined && a.axis !== 'u') {
      throw new SpecError(`unknown revolve axis "${String(a.axis)}"`);
    }
    let perp: Vec2 = [-ax[1], ax[0]];
    const polys = sk.loops.map(tessellateLoop);
    // The profile must lie on one side of the axis (touching allowed).
    let lo = Infinity;
    let hi = -Infinity;
    for (const poly of polys) {
      for (const p of poly) {
        const s = (p[0] - p0[0]) * perp[0] + (p[1] - p0[1]) * perp[1];
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      }
    }
    if (lo < -1e-7 && hi > 1e-7) {
      throw new SpecError('revolve profile crosses the axis');
    }
    if (hi <= 1e-7) {
      perp = [-perp[0], -perp[1]];
    }
    const segs = circleSegments(Math.max(Math.abs(lo), Math.abs(hi)));
    const n = angle >= 360 ? segs : Math.max(2, Math.ceil((segs * angle) / 360));
    const k = equalAreaScale((angle * Math.PI) / 180 / n);
    const mapped = polys.map((poly) =>
      poly.map((p): Vec2 => {
        const du = p[0] - p0[0];
        const dv = p[1] - p0[1];
        const s = Math.max(0, du * perp[0] + dv * perp[1]);
        return [s * k, du * ax[0] + dv * ax[1]];
      }),
    );
    const cs = keep(new this.m.CrossSection(mapped, 'EvenOdd'));
    const raw = keep(M.revolve(cs, n, angle));
    // Kernel result: Z along the axis, X the profile's radial direction.
    const f = sk.frame;
    const lift = (c: Vec2): Vec3 => [
      c[0] * f.x[0] + c[1] * f.y[0],
      c[0] * f.x[1] + c[1] * f.y[1],
      c[0] * f.x[2] + c[1] * f.y[2],
    ];
    const A = lift(ax);
    let P = lift(perp);
    let Q = cross(A, P);
    const start =
      a.direction === 'reverse' ? -angle : a.direction === 'both' ? -angle / 2 : 0;
    if (angle < 360 && start !== 0) {
      const r = (start * Math.PI) / 180;
      const c = Math.cos(r);
      const s = Math.sin(r);
      const P2: Vec3 = [c * P[0] + s * Q[0], c * P[1] + s * Q[1], c * P[2] + s * Q[2]];
      const Q2: Vec3 = [-s * P[0] + c * Q[0], -s * P[1] + c * Q[1], -s * P[2] + c * Q[2]];
      P = P2;
      Q = Q2;
    }
    const O: Vec3 = [
      f.o[0] + p0[0] * f.x[0] + p0[1] * f.y[0],
      f.o[1] + p0[0] * f.x[1] + p0[1] * f.y[1],
      f.o[2] + p0[0] * f.x[2] + p0[1] * f.y[2],
    ];
    const mat: Mat4 = [
      P[0], P[1], P[2], 0,
      Q[0], Q[1], Q[2], 0,
      A[0], A[1], A[2], 0,
      O[0], O[1], O[2], 1,
    ];
    return keep(raw.transform(mat));
  }

  private holeTool(
    a: Record<string, unknown>,
    frame: Frame,
    through: number,
    keep: <T extends Disposable>(o: T) => T,
    isVoid: (cs: CrossSection, z: [number, number], frame: Frame) => boolean,
  ): Manifold {
    const { Manifold: M, CrossSection: CS } = this.m;
    const d = numArg(a.diameter, 'diameter');
    if (!(d > 0)) {
      throw new SpecError('hole diameter must be positive');
    }
    const centers: Vec2[] = Array.isArray(a.centers)
      ? (a.centers as Vec2[])
      : Array.isArray(a.center)
        ? [a.center as Vec2]
        : [];
    if (centers.length === 0) {
      throw new SpecError('hole needs "centers"');
    }
    const type = a.type === undefined ? 'simple' : String(a.type);
    if (!['simple', 'counterbore', 'countersink'].includes(type)) {
      throw new SpecError(`unknown hole type "${type}"`);
    }
    if (type !== 'simple' && a.direction !== 'normal' && a.direction !== 'reverse') {
      throw new SpecError('a counterbore or countersink needs direction "normal" or "reverse"');
    }
    const depth = a.through_all === true ? through : numArg(a.depth, 'depth');
    if (!(depth > 0)) {
      throw new SpecError('hole depth must be positive');
    }
    const z = zRange(a.direction, depth, 'both', 'hole');
    const bigD =
      type === 'counterbore'
        ? numArg(a.cbore_diameter, 'cbore_diameter')
        : type === 'countersink'
          ? numArg(a.csk_diameter, 'csk_diameter')
          : d;
    if (bigD < d) {
      throw new SpecError('counterbore / countersink diameter must not be smaller than the drill');
    }
    // One facet count for every part of the hole, so the pieces nest exactly.
    const segs = circleSegments(bigD / 2);
    const footprint = (dia: number): CrossSection =>
      keep(new CS(centers.map((c) => circlePolygon(c[0], c[1], dia / 2, segs)), 'NonZero'));
    const drillFoot = footprint(d);
    const bigFoot = type === 'simple' ? drillFoot : footprint(bigD);
    // The entry (where a counterbore or countersink sits) is the sketch plane.
    const entryLow = type !== 'simple' && a.direction === 'normal';
    const entryHigh = type !== 'simple' && a.direction === 'reverse';
    const extLow = isVoid(entryLow ? bigFoot : drillFoot, [z[0] - VOID_PROBE, z[0]], frame)
      ? VOID_PROBE
      : 0;
    const extHigh = isVoid(entryHigh ? bigFoot : drillFoot, [z[1], z[1] + VOID_PROBE], frame)
      ? VOID_PROBE
      : 0;
    const column = (cs: CrossSection, lo: number, hi: number): Manifold =>
      keep(keep(cs.extrude(hi - lo)).translate(0, 0, lo));

    const parts: Manifold[] = [
      column(drillFoot, z[0] - (entryLow ? 0 : extLow), z[1] + (entryHigh ? 0 : extHigh)),
    ];
    if (type === 'counterbore') {
      const cd = numArg(a.cbore_depth, 'cbore_depth');
      if (!(cd > 0)) {
        throw new SpecError('cbore_depth must be positive');
      }
      parts.push(entryLow ? column(bigFoot, -extLow, cd) : column(bigFoot, -cd, extHigh));
    } else if (type === 'countersink') {
      const ang = numArg(a.csk_angle, 'csk_angle', 90);
      if (!(ang > 0 && ang < 180)) {
        throw new SpecError('csk_angle must be between 0 and 180');
      }
      const h = (bigD - d) / 2 / Math.tan((ang * Math.PI) / 360);
      if (h > 1e-9) {
        const ratio = d / bigD;
        for (const c of centers) {
          // Cone built about the origin so the top scale is about its own axis.
          const cone = keep(
            keep(new CS([circlePolygon(0, 0, bigD / 2, segs)], 'EvenOdd')).extrude(
              h, 0, 0, [ratio, ratio],
            ),
          );
          const oriented = entryLow ? cone : keep(cone.mirror([0, 0, 1]));
          parts.push(keep(oriented.translate(c[0], c[1], 0)));
        }
        if (entryLow && extLow > 0) {
          parts.push(column(bigFoot, -extLow, 0));
        } else if (entryHigh && extHigh > 0) {
          parts.push(column(bigFoot, 0, extHigh));
        }
      }
    }
    const all = parts.length === 1 ? parts[0] : keep(M.union(parts));
    return keep(all.transform(frameMatrix(frame)));
  }

  /** Mesh, normals, sharp edges and properties of a finished solid. */
  private extract(
    solid: Manifold,
    keep: <T extends Disposable>(o: T) => T,
  ): { mesh: MeshData; props: KernelProps } {
    const shared = solid.getMesh();
    const nTri = shared.triVerts.length / 3;
    const sp = shared.vertProperties;
    const sn = shared.numProp;
    const tv = shared.triVerts;

    // Face normals, own volume / area integration, and sharp edges.
    const faceN = new Float32Array(nTri * 3);
    let vol6 = 0;
    let area2 = 0;
    for (let t = 0; t < nTri; t++) {
      const i0 = tv[t * 3] * sn;
      const i1 = tv[t * 3 + 1] * sn;
      const i2 = tv[t * 3 + 2] * sn;
      const ax = sp[i0], ay = sp[i0 + 1], az = sp[i0 + 2];
      const bx = sp[i1], by = sp[i1 + 1], bz = sp[i1 + 2];
      const cx = sp[i2], cy = sp[i2 + 1], cz = sp[i2 + 2];
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      area2 += l;
      vol6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
      const inv = l > 0 ? 1 / l : 0;
      faceN[t * 3] = nx * inv;
      faceN[t * 3 + 1] = ny * inv;
      faceN[t * 3 + 2] = nz * inv;
    }
    const nVert = sp.length / sn;
    const edgeFace = new Map<number, number>();
    const edgeList: number[] = [];
    const cosSharp = Math.cos((28 * Math.PI) / 180);
    for (let t = 0; t < nTri; t++) {
      for (let e = 0; e < 3; e++) {
        const p = tv[t * 3 + e];
        const q = tv[t * 3 + ((e + 1) % 3)];
        const key = p < q ? p * nVert + q : q * nVert + p;
        const other = edgeFace.get(key);
        if (other === undefined) {
          edgeFace.set(key, t);
          continue;
        }
        const d =
          faceN[t * 3] * faceN[other * 3] +
          faceN[t * 3 + 1] * faceN[other * 3 + 1] +
          faceN[t * 3 + 2] * faceN[other * 3 + 2];
        if (d < cosSharp) {
          edgeList.push(
            sp[p * sn], sp[p * sn + 1], sp[p * sn + 2],
            sp[q * sn], sp[q * sn + 1], sp[q * sn + 2],
          );
        }
      }
    }

    // Shading normals: split along sharp edges, smooth across curved faces. Each triangle corner takes the
    // area-weighted mean of the faces round its vertex that lie within 28 degrees of its own face; corners
    // with the same vertex and normal share one output vertex. (Linear time; Manifold's calculateNormals
    // took tens of seconds on helical threads.)
    const triArea = new Float32Array(nTri);
    for (let t = 0; t < nTri; t++) {
      const i0 = tv[t * 3] * sn, i1 = tv[t * 3 + 1] * sn, i2 = tv[t * 3 + 2] * sn;
      const ux = sp[i1] - sp[i0], uy = sp[i1 + 1] - sp[i0 + 1], uz = sp[i1 + 2] - sp[i0 + 2];
      const vx = sp[i2] - sp[i0], vy = sp[i2 + 1] - sp[i0 + 1], vz = sp[i2 + 2] - sp[i0 + 2];
      triArea[t] = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    }
    const start = new Uint32Array(nVert + 1);
    for (let i = 0; i < tv.length; i++) start[tv[i] + 1]++;
    for (let v = 0; v < nVert; v++) start[v + 1] += start[v];
    const fill = start.slice(0, nVert);
    const around = new Uint32Array(tv.length);
    for (let t = 0; t < nTri; t++) for (let e = 0; e < 3; e++) around[fill[tv[t * 3 + e]]++] = t;
    const outPos: number[] = [];
    const outNrm: number[] = [];
    const indices = new Uint32Array(nTri * 3);
    const seen = new Map<string, number>();
    for (let t = 0; t < nTri; t++) {
      for (let e = 0; e < 3; e++) {
        const v = tv[t * 3 + e];
        let nx = 0, ny = 0, nz = 0;
        for (let k = start[v]; k < start[v + 1]; k++) {
          const u = around[k];
          const d = faceN[u * 3] * faceN[t * 3] + faceN[u * 3 + 1] * faceN[t * 3 + 1] + faceN[u * 3 + 2] * faceN[t * 3 + 2];
          if (d < cosSharp) continue;
          nx += faceN[u * 3] * triArea[u];
          ny += faceN[u * 3 + 1] * triArea[u];
          nz += faceN[u * 3 + 2] * triArea[u];
        }
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        const key = `${v}|${Math.round(nx * 1000)}|${Math.round(ny * 1000)}|${Math.round(nz * 1000)}`;
        let idx = seen.get(key);
        if (idx === undefined) {
          idx = outPos.length / 3;
          seen.set(key, idx);
          outPos.push(sp[v * sn], sp[v * sn + 1], sp[v * sn + 2]);
          outNrm.push(nx, ny, nz);
        }
        indices[t * 3 + e] = idx;
      }
    }
    const positions = new Float32Array(outPos);
    const normals = new Float32Array(outNrm);

    const box = solid.boundingBox();
    const pieces = solid.decompose();
    // A sealed cavity (a shell closed on every side) is a separate inward-facing surface:
    // it has negative volume and is part of its body, not a body of its own.
    let components = 0;
    let cavities = 0;
    for (const p of pieces) {
      if (p.volume() > 0) components++;
      else cavities++;
      p.delete();
    }
    const props: KernelProps = {
      volume: solid.volume(),
      surfaceArea: solid.surfaceArea(),
      bbox: {
        min: [box.min[0], box.min[1], box.min[2]],
        max: [box.max[0], box.max[1], box.max[2]],
      },
      genus: solid.genus(),
      triangles: nTri,
      volumeCheck: vol6 / 6,
      areaCheck: area2 / 2,
      status: String(solid.status()),
      components,
      cavities,
    };
    return {
      mesh: { positions, normals, indices, edges: new Float32Array(edgeList) },
      props,
    };
  }

  /**
   * Slice the part into layers along `up` (a unit axis). Every `shown`-th
   * layer is returned as outlines, enough to animate a print on the desk; the
   * true layer count at `layerHeight` is reported alongside.
   */
  slice(spec: PartSpec, up: Vec3, layerHeight = 0.2, shownEvery = 1): Layers {
    const arena: Disposable[] = [];
    const keep = <T extends Disposable>(o: T): T => {
      arena.push(o);
      return o;
    };
    try {
      const { solid } = this.construct(spec, spec.features.length, keep);
      // Rotation taking `up` to +Z (columns: x', y', z' = up).
      const z = norm(up);
      const helper: Vec3 = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const x = norm(cross(helper, z));
      const y = cross(z, x);
      const toLocal: Mat4 = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, 0, 0, 0, 1];
      const turned = keep(solid.transform(toLocal));
      const box = turned.boundingBox();
      const height = box.max[2] - box.min[2];
      const printLayers = Math.max(1, Math.round(height / layerHeight));
      const segs: number[] = [];
      const starts: number[] = [];
      const step = layerHeight * shownEvery;
      for (let h = box.min[2] + step / 2; h < box.max[2]; h += step) {
        starts.push(segs.length);
        const cs = keep(turned.slice(h));
        for (const poly of cs.toPolygons()) {
          for (let i = 0; i < poly.length; i++) {
            const a = poly[i];
            const b = poly[(i + 1) % poly.length];
            // Back to part coordinates: p = x * u + y * v + z * h.
            for (const q of [a, b]) {
              segs.push(x[0] * q[0] + y[0] * q[1] + z[0] * h, x[1] * q[0] + y[1] * q[1] + z[1] * h, x[2] * q[0] + y[2] * q[1] + z[2] * h);
            }
          }
        }
      }
      return { segments: new Float32Array(segs), starts: Uint32Array.from(starts), height, printLayers, layerHeight };
    } finally {
      release(arena);
    }
  }

  /**
   * Where placed parts run into each other: every pair's common volume (mm^3)
   * and its mesh, from the exact solids. `poses` are column-major 4 x 4
   * matrices from part to assembly space.
   */
  interference(specs: PartSpec[], poses: Mat4[]): { i: number; j: number; volume: number; mesh: MeshData }[] {
    const arena: Disposable[] = [];
    const keep = <T extends Disposable>(x: T): T => {
      arena.push(x);
      return x;
    };
    try {
      const solids = specs.map((s, k) => keep(this.construct(s, s.features.length, keep).solid.transform(poses[k])));
      const out: { i: number; j: number; volume: number; mesh: MeshData }[] = [];
      for (let i = 0; i < solids.length; i++) {
        for (let j = i + 1; j < solids.length; j++) {
          const both = keep(solids[i].intersect(solids[j]));
          const volume = both.isEmpty() ? 0 : both.volume();
          // Under 0.05 mm3 is faces touching (tessellation), not a clash.
          if (volume > 0.05) out.push({ i, j, volume, mesh: this.extract(both, keep).mesh });
        }
      }
      return out;
    } finally {
      release(arena);
    }
  }

  /**
   * Toolpath regions for FDM printing with `up` as the build direction: per
   * layer, the perimeter loops (the section offset inward by half a line, then
   * a line at a time) and the inside split into solid skin (where the layers
   * `skins` above or below are not both material) and sparse fill. The part is
   * centred on a bed of `bed` mm with its lowest point at z = 0. Loops are
   * returned as plain polygons; hatching is done by src/engine/gcode.ts.
   */
  toolpaths(
    spec: PartSpec,
    up: Vec3,
    o: { layer: number; line: number; walls: number; skins: number; bed: [number, number] },
  ): { layers: { z: number; walls: Vec2[][]; skin: Vec2[][]; sparse: Vec2[][] }[]; toPart: (u: number, v: number, w: number) => Vec3 } {
    const arena: Disposable[] = [];
    const keep = <T extends Disposable>(x: T): T => {
      arena.push(x);
      return x;
    };
    try {
      const { solid } = this.construct(spec, spec.features.length, keep);
      const z = norm(up);
      const helper: Vec3 = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const x = norm(cross(helper, z));
      const y = cross(z, x);
      const toLocal: Mat4 = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, 0, 0, 0, 1];
      const turned = keep(solid.transform(toLocal));
      const b = turned.boundingBox();
      // Onto the bed: centred, lowest point at z = 0.
      const shift: Vec3 = [o.bed[0] / 2 - (b.min[0] + b.max[0]) / 2, o.bed[1] / 2 - (b.min[1] + b.max[1]) / 2, -b.min[2]];
      const placed = keep(turned.translate(shift));
      // Bed coordinates back to part coordinates (for showing the toolpaths on the bench).
      const toPart = (u: number, v: number, w: number): Vec3 => {
        const a = u - shift[0];
        const c = v - shift[1];
        const d = w - shift[2];
        return [x[0] * a + y[0] * c + z[0] * d, x[1] * a + y[1] * c + z[1] * d, x[2] * a + y[2] * c + z[2] * d];
      };
      const height = b.max[2] - b.min[2];
      const n = Math.max(1, Math.round(height / o.layer));
      const sections: CrossSection[] = [];
      for (let i = 0; i < n; i++) sections.push(keep(placed.slice((i + 0.5) * o.layer)));
      // An empty section: a slice below the part.
      const empty = keep(placed.slice(-1));
      const at = (i: number): CrossSection => (i < 0 || i >= n ? empty : sections[i]);
      const polys = (cs: CrossSection): Vec2[][] => cs.toPolygons().map((p) => p.map((q): Vec2 => [q[0], q[1]]));
      const out: { z: number; walls: Vec2[][]; skin: Vec2[][]; sparse: Vec2[][] }[] = [];
      for (let i = 0; i < n; i++) {
        const cs = sections[i];
        const walls: Vec2[][] = [];
        for (let w = 0; w < o.walls; w++) {
          walls.push(...polys(keep(keep(cs.offset(-(o.line / 2 + w * o.line), 'Miter')).simplify(0.01))));
        }
        const inner = keep(cs.offset(-(o.walls * o.line) + o.line * 0.15, 'Miter'));
        // Material in every layer within `skins` above and below: sparse; the rest of the inside: solid skin.
        let covered = inner;
        for (let k = 1; k <= o.skins; k++) covered = keep(keep(covered.intersect(at(i + k))).intersect(at(i - k)));
        const sparse = keep(covered.offset(-o.line * 0.5, 'Miter'));
        const skin = keep(inner.subtract(sparse));
        out.push({ z: (i + 1) * o.layer, walls, skin: polys(skin), sparse: polys(sparse) });
      }
      return { layers: out, toPart };
    } finally {
      release(arena);
    }
  }

  /**
   * The section of the part `depth` mm inside its face that looks along
   * `normal` (a unit axis): outer loops and holes, in the face's own 2D frame
   * (x, y in mm; `x` and `y` are those axes in part coordinates). Used for a
   * life-size drilling template of a mounting face.
   */
  section(spec: PartSpec, normal: Vec3, depth: number): { loops: Vec2[][]; x: Vec3; y: Vec3; z: Vec3; at: number } {
    const arena: Disposable[] = [];
    const keep = <T extends Disposable>(o: T): T => {
      arena.push(o);
      return o;
    };
    try {
      const { solid } = this.construct(spec, spec.features.length, keep);
      const z = norm(normal);
      const helper: Vec3 = Math.abs(z[1]) < 0.9 ? [0, 1, 0] : [0, 0, -1];
      // y' as close to the helper (part up) as the plane allows, x' completing a right-handed frame.
      const x = norm(cross(helper, z));
      const y = cross(z, x);
      const toLocal: Mat4 = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, 0, 0, 0, 1];
      const turned = keep(solid.transform(toLocal));
      const at = turned.boundingBox().max[2] - depth;
      const loops = keep(turned.slice(at)).toPolygons().map((p) => p.map((q): Vec2 => [q[0], q[1]]));
      return { loops, x, y, z, at };
    } finally {
      release(arena);
    }
  }

  /**
   * Silhouettes for a three-view drawing (third-angle, mm): each view is the
   * solid's shadow along the viewing direction, as outer loops and holes.
   * front: looking along -Z (sheet x = X, y = Y); top: looking down -Y
   * (x = X, y = -Z); right: looking along -X (x = -Z, y = Y). A hole shows
   * only where it goes right through in that direction.
   */
  /**
   * A two-part mould for the part: a block `margin` mm round it, less the part grown by `shrink` (a fraction, for
   * the material's shrinkage), split square to `pull` at `level` (along the pull, part mm) into the cavity (the
   * half the pull points into) and the core.
   */
  mould(spec: PartSpec, pull: Vec3, margin: number, shrink: number, level: number): { cavity: MeshData; core: MeshData; cavityVolume: number; coreVolume: number } {
    const arena: Disposable[] = [];
    const keep = <T extends Disposable>(o: T): T => {
      arena.push(o);
      return o;
    };
    try {
      const { solid } = this.construct(spec, spec.features.length, keep);
      const bb = solid.boundingBox();
      const c: Vec3 = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
      const k = 1 + shrink;
      const grown = keep(keep(keep(solid.translate([-c[0], -c[1], -c[2]])).scale(k)).translate(c));
      const size: Vec3 = [(bb.max[0] - bb.min[0]) * k + 2 * margin, (bb.max[1] - bb.min[1]) * k + 2 * margin, (bb.max[2] - bb.min[2]) * k + 2 * margin];
      const block = keep(this.m.Manifold.cube(size, true).translate(c));
      keep(block);
      const shell = keep(block.subtract(grown));
      const u = norm(pull);
      // The level moves with the shrinkage scaling about the centre.
      const cl = dot3k(c, u);
      const lv = cl + (level - cl) * k;
      const [hi, lo] = shell.splitByPlane(u, lv);
      keep(hi);
      keep(lo);
      return { cavity: this.extract(hi, keep).mesh, core: this.extract(lo, keep).mesh, cavityVolume: hi.volume(), coreVolume: lo.volume() };
    } finally {
      release(arena);
    }
  }

  views(spec: PartSpec): DrawingViews {
    const arena: Disposable[] = [];
    const keep = <T extends Disposable>(o: T): T => {
      arena.push(o);
      return o;
    };
    try {
      const { solid } = this.construct(spec, spec.features.length, keep);
      const polys = (m: Manifold): Vec2[][] => keep(m.project()).toPolygons().map((p) => p.map((q): Vec2 => [q[0], q[1]]));
      // Visible and hidden edges per view, in the same view coordinates as the silhouettes.
      const gl = solid.getMesh();
      const np = gl.numProp;
      const pos = new Float32Array((gl.vertProperties.length / np) * 3);
      for (let i = 0, j = 0; i < gl.vertProperties.length; i += np, j += 3) {
        pos[j] = gl.vertProperties[i];
        pos[j + 1] = gl.vertProperties[i + 1];
        pos[j + 2] = gl.vertProperties[i + 2];
      }
      const mesh = [{ positions: pos, indices: gl.triVerts }];
      return {
        front: polys(solid),
        top: polys(keep(solid.rotate([90, 0, 0]))),
        right: polys(keep(solid.rotate([0, -90, 0]))),
        lines: { front: viewLines(mesh, VIEW_AXES.front), top: viewLines(mesh, VIEW_AXES.top), right: viewLines(mesh, VIEW_AXES.right) },
      };
    } finally {
      release(arena);
    }
  }

  /**
   * Carve a solid with a scalar field (used by the topology optimiser): keeps
   * the part of `spec`'s solid where `field` is above `level`. The outer faces
   * stay the exact CAD faces; only the carved surfaces are new.
   */
  carve(
    spec: PartSpec,
    field: (p: Vec3) => number,
    bounds: { min: Vec3; max: Vec3 },
    edge: number,
  ): { mesh: MeshData; props: KernelProps } {
    const arena: Disposable[] = [];
    const keep = <T extends Disposable>(o: T): T => {
      arena.push(o);
      return o;
    };
    try {
      const { solid } = this.construct(spec, spec.features.length, keep);
      const iso = keep(this.m.Manifold.levelSet(field, bounds, edge, 0));
      const cut = keep(solid.intersect(iso));
      if (cut.isEmpty()) {
        throw new SpecError('the carved solid is empty');
      }
      return this.extract(cut, keep);
    } finally {
      release(arena);
    }
  }
}

/** Silhouette loops (mm, sheet axes) of the three standard views. */
export interface DrawingViews {
  front: Vec2[][];
  top: Vec2[][];
  right: Vec2[][];
  /** Edges seen in each view: visible (solid) and hidden (dashed), x1 y1 x2 y2 ... */
  lines?: Record<'front' | 'top' | 'right', ViewLines>;
}

/** Layer outlines of a part printed with `up` as the build direction. */
export interface Layers {
  /** Line segments (xyz pairs, part millimetres) of every shown layer, concatenated. */
  segments: Float32Array;
  /** Start offset (in floats) of each shown layer inside `segments`. */
  starts: Uint32Array;
  /** Height of the part along `up`, mm. */
  height: number;
  /** Number of layers at the real layer height. */
  printLayers: number;
  layerHeight: number;
}

function release(arena: Disposable[]): void {
  for (const o of arena) {
    try {
      o.delete();
    } catch {
      // already released
    }
  }
}

/** Load the WebAssembly kernel. `locateFile` gives the .wasm URL in a bundled build. */
export async function initKernel(locateFile?: () => string): Promise<Kernel> {
  const { default: Module } = await import('manifold-3d');
  const toplevel = await Module(locateFile ? { locateFile } : undefined);
  toplevel.setup();
  return new Kernel(toplevel);
}
