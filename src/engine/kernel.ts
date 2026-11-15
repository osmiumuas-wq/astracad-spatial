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
import { extrudeModifiers, filletLoops, loftPlan, offsetLoops, outerIndex, shellRange, sweepPlan, sweepRings } from './advanced.js';
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

const ARG_SETS: Record<string, readonly string[]> = {
  'ref.plane': ['origin', 'normal', 'x_dir', 'base', 'offset'],
  'sketch.rectangle': ['width', 'height', 'x', 'y'],
  'sketch.circle': ['radius', 'diameter', 'x', 'y'],
  'sketch.loops': ['loops'],
  'sketch.profile': ['points'],
  'feature.extrude': ['depth', 'direction', 'sketch'],
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
  'feature.shell': ['thickness', 'feature', 'open'],
  'feature.loft': ['sketches'],
  'feature.sweep': ['sketch', 'path', 'bend_radius'],
  'doc.note': ['text'],
};

/** Operations that exist in the language but need the desktop B-rep kernels. */
const DESKTOP_ONLY = new Set([
  'feature.cut_revolve',
  'feature.chamfer',
  'feature.mirror',
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

      const apply = (tool: Tool, id: string): void => {
        if (tool.op === 'add') {
          body = body ? keep(body.add(tool.solid)) : tool.solid;
        } else {
          if (!body) {
            throw new SpecError('nothing to cut: no solid exists yet', id);
          }
          body = keep(body.subtract(tool.solid));
        }
      };

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
            const loops = mod?.fillet ? filletLoops(sk.loops, mod.fillet) : sk.loops;
            const cs = section(loops);
            let z = zRange(a.direction, depth, isCut ? 'both' : 'normal', f.id);
            if (isCut) {
              z = [
                isVoid(cs, [z[0] - VOID_PROBE, z[0]], sk.frame) ? z[0] - VOID_PROBE : z[0],
                isVoid(cs, [z[1], z[1] + VOID_PROBE], sk.frame) ? z[1] + VOID_PROBE : z[1],
              ];
            }
            let solid = prism(cs, z, sk.frame);
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
          } else if (f.$op === 'feature.fillet' || f.$op === 'feature.shell') {
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

    // Shading normals: split along sharp edges, smooth across curved faces.
    let positions: Float32Array;
    let normals: Float32Array;
    let indices: Uint32Array;
    const withN = keep(solid.calculateNormals(0, 28)).getMesh();
    if (withN.numProp >= 6) {
      const np = withN.numProp;
      const count = withN.vertProperties.length / np;
      positions = new Float32Array(count * 3);
      normals = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = withN.vertProperties[i * np];
        positions[i * 3 + 1] = withN.vertProperties[i * np + 1];
        positions[i * 3 + 2] = withN.vertProperties[i * np + 2];
        normals[i * 3] = withN.vertProperties[i * np + 3];
        normals[i * 3 + 1] = withN.vertProperties[i * np + 4];
        normals[i * 3 + 2] = withN.vertProperties[i * np + 5];
      }
      indices = new Uint32Array(withN.triVerts);
    } else {
      // Fallback: flat shading, one vertex per triangle corner.
      positions = new Float32Array(nTri * 9);
      normals = new Float32Array(nTri * 9);
      indices = new Uint32Array(nTri * 3);
      for (let t = 0; t < nTri; t++) {
        for (let e = 0; e < 3; e++) {
          const src = tv[t * 3 + e] * sn;
          const dst = (t * 3 + e) * 3;
          positions[dst] = sp[src];
          positions[dst + 1] = sp[src + 1];
          positions[dst + 2] = sp[src + 2];
          normals[dst] = faceN[t * 3];
          normals[dst + 1] = faceN[t * 3 + 1];
          normals[dst + 2] = faceN[t * 3 + 2];
          indices[t * 3 + e] = t * 3 + e;
        }
      }
    }

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
  views(spec: PartSpec): DrawingViews {
    const arena: Disposable[] = [];
    const keep = <T extends Disposable>(o: T): T => {
      arena.push(o);
      return o;
    };
    try {
      const { solid } = this.construct(spec, spec.features.length, keep);
      const polys = (m: Manifold): Vec2[][] => keep(m.project()).toPolygons().map((p) => p.map((q): Vec2 => [q[0], q[1]]));
      return {
        front: polys(solid),
        top: polys(keep(solid.rotate([90, 0, 0]))),
        right: polys(keep(solid.rotate([0, -90, 0]))),
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
