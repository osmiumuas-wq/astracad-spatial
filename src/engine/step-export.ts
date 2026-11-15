/**
 * STEP export (ISO 10303-21, AP214 automotive_design): each body a
 * MANIFOLD_SOLID_BREP rebuilt from its mesh by step-brep.ts: flat faces as
 * planes, holes, shafts and straight-edge fillets as true cylinders, edges as
 * lines and circles. Desktop CAD (SOLIDWORKS, CATIA, Creo, Fusion, FreeCAD)
 * opens it as a solid in millimetres.
 */

import type { Vec3 } from './types.js';
import { buildBrep, squareTo } from './step-brep.js';

export interface StepBody {
  name: string;
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

const fmt = (v: number): string => {
  const s = (Math.abs(v) < 1e-12 ? 0 : v).toPrecision(12);
  return /[.eE]/u.test(s) ? s.replace(/(\.\d*?)0+(e|$)/u, '$1$2').replace(/\.(e|$)/u, '.0$1') : `${s}.`;
};

/** Merge coplanar, edge-connected triangles into faces; each face's boundary loops (outer first). */
export function planarFaces(positions: ArrayLike<number>, indices: ArrayLike<number>, tol = 1e-5): { loops: number[][]; normal: Vec3 }[] {
  // Weld vertices (the mesh may split them along sharp edges for shading).
  const key = (i: number): string => `${Math.round(positions[i * 3] / tol)},${Math.round(positions[i * 3 + 1] / tol)},${Math.round(positions[i * 3 + 2] / tol)}`;
  const weld = new Map<string, number>();
  const vid = new Int32Array(positions.length / 3);
  for (let i = 0; i < vid.length; i++) {
    const k = key(i);
    let w = weld.get(k);
    if (w === undefined) {
      w = i;
      weld.set(k, w);
    }
    vid[i] = w;
  }
  const nTri = indices.length / 3;
  const tri = (t: number): [number, number, number] => [vid[indices[t * 3]], vid[indices[t * 3 + 1]], vid[indices[t * 3 + 2]]];
  const P = (i: number): Vec3 => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  const normals: Vec3[] = [];
  const offsets: number[] = [];
  for (let t = 0; t < nTri; t++) {
    const [a, b, c] = tri(t).map(P);
    const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const nn: Vec3 = [n[0] / l, n[1] / l, n[2] / l];
    normals.push(nn);
    offsets.push(nn[0] * a[0] + nn[1] * a[1] + nn[2] * a[2]);
  }
  // Edge -> triangles.
  const edgeTris = new Map<string, number[]>();
  const ek = (p: number, q: number): string => (p < q ? `${p}_${q}` : `${q}_${p}`);
  for (let t = 0; t < nTri; t++) {
    const v = tri(t);
    for (let e = 0; e < 3; e++) {
      const k = ek(v[e], v[(e + 1) % 3]);
      const list = edgeTris.get(k);
      if (list) list.push(t);
      else edgeTris.set(k, [t]);
    }
  }
  const same = (s: number, t: number): boolean =>
    normals[s][0] * normals[t][0] + normals[s][1] * normals[t][1] + normals[s][2] * normals[t][2] > 1 - 1e-9 && Math.abs(offsets[s] - offsets[t]) < 1e-6;
  const group = new Int32Array(nTri).fill(-1);
  const faces: { loops: number[][]; normal: Vec3 }[] = [];
  for (let s = 0; s < nTri; s++) {
    if (group[s] >= 0) continue;
    const g = faces.length;
    const members: number[] = [];
    const stack = [s];
    group[s] = g;
    while (stack.length) {
      const t = stack.pop()!;
      members.push(t);
      const v = tri(t);
      for (let e = 0; e < 3; e++) {
        for (const o of edgeTris.get(ek(v[e], v[(e + 1) % 3])) ?? []) {
          if (group[o] < 0 && same(s, o)) {
            group[o] = g;
            stack.push(o);
          }
        }
      }
    }
    // Boundary: directed edges whose reverse is not in the group.
    const directed = new Map<number, number[]>();
    const inside = new Set<string>();
    for (const t of members) {
      const v = tri(t);
      for (let e = 0; e < 3; e++) inside.add(`${v[e]}>${v[(e + 1) % 3]}`);
    }
    for (const t of members) {
      const v = tri(t);
      for (let e = 0; e < 3; e++) {
        const p = v[e];
        const q = v[(e + 1) % 3];
        if (inside.has(`${q}>${p}`)) continue;
        const list = directed.get(p);
        if (list) list.push(q);
        else directed.set(p, [q]);
      }
    }
    const loops: number[][] = [];
    for (const [startV] of directed) {
      while ((directed.get(startV)?.length ?? 0) > 0) {
        const loop = [startV];
        let cur = directed.get(startV)!.pop()!;
        let guard = 0;
        while (cur !== startV && guard++ < 1e6) {
          loop.push(cur);
          const nx = directed.get(cur);
          if (!nx || !nx.length) break;
          cur = nx.pop()!;
        }
        if (loop.length >= 3) loops.push(loop);
      }
    }
    // Outer loop first: the largest area (projected on the face normal).
    const area = (loop: number[]): number => {
      let s2: Vec3 = [0, 0, 0];
      for (let i = 0; i < loop.length; i++) {
        const a = P(loop[i]);
        const b = P(loop[(i + 1) % loop.length]);
        s2 = [s2[0] + a[1] * b[2] - a[2] * b[1], s2[1] + a[2] * b[0] - a[0] * b[2], s2[2] + a[0] * b[1] - a[1] * b[0]];
      }
      return Math.abs(s2[0] * normals[s][0] + s2[1] * normals[s][1] + s2[2] * normals[s][2]);
    };
    loops.sort((x, y) => area(y) - area(x));
    faces.push({ loops, normal: normals[s] });
  }
  return faces;
}

/**
 * A STEP file of the bodies, in millimetres: AP214 (automotive_design), each
 * body a MANIFOLD_SOLID_BREP of ADVANCED_FACEs on planes and cylinders,
 * bounded by shared line and circle edges.
 */
export function writeStep(bodies: StepBody[], fileName = 'part.step', when = new Date()): string {
  const lines: string[] = [];
  let n = 0;
  const add = (text: string): number => {
    n++;
    lines.push(`#${n}=${text};`);
    return n;
  };
  const vec = (v: number[]): string => `(${v.map(fmt).join(',')})`;
  const ctx = add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${ctx})`);
  const pctx = add(`PRODUCT_CONTEXT('',#${ctx},'mechanical')`);
  const dctx = add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${ctx},'design')`);
  const len = add('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))');
  const ang = add('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
  const sol = add('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
  const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#${len},'distance_accuracy_value','confusion accuracy')`);
  const geo = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${len},#${ang},#${sol}))REPRESENTATION_CONTEXT('Context3D','3D Context with UNIT and UNCERTAINTY'))`);
  const o = add("CARTESIAN_POINT('',(0.,0.,0.))");
  const dz = add("DIRECTION('',(0.,0.,1.))");
  const dx = add("DIRECTION('',(1.,0.,0.))");
  const items: number[] = [add(`AXIS2_PLACEMENT_3D('',#${o},#${dz},#${dx})`)];
  for (const body of bodies) {
    const brep = buildBrep(body.positions, body.indices);
    const P = brep.P;
    const point = (p: Vec3): number => add(`CARTESIAN_POINT('',${vec(p)})`);
    const dir = (d: Vec3): number => add(`DIRECTION('',${vec(d)})`);
    const placement = (o: Vec3, z: Vec3, x: Vec3): number => add(`AXIS2_PLACEMENT_3D('',#${point(o)},#${dir(z)},#${dir(x)})`);
    const vertexId = new Map<number, number>();
    const vertex = (i: number): number => {
      let id = vertexId.get(i);
      if (id === undefined) {
        id = add(`VERTEX_POINT('',#${point(P(i))})`);
        vertexId.set(i, id);
      }
      return id;
    };
    const line = (a: number, b: number): number => {
      const pa = P(a);
      const d: Vec3 = [P(b)[0] - pa[0], P(b)[1] - pa[1], P(b)[2] - pa[2]];
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      const ln = add(`LINE('',#${point(pa)},#${add(`VECTOR('',#${dir([d[0] / l, d[1] / l, d[2] / l])},${fmt(l)})`)})`);
      return add(`EDGE_CURVE('',#${vertex(a)},#${vertex(b)},#${ln},.T.)`);
    };
    // Each chain's edges, start to end, made the first time a face uses it.
    const chainEdges = new Map<number, number[]>();
    const edgesOf = (k: number): number[] => {
      let ids = chainEdges.get(k);
      if (ids) return ids;
      const ch = brep.chains[k];
      const first = ch.pts[0];
      const last = ch.pts[ch.pts.length - 1];
      if (ch.curve.kind === 'line') ids = [line(first, last)];
      else if (ch.curve.kind === 'circle') {
        const { c, n, r } = ch.curve;
        const p0 = P(first);
        const rd: Vec3 = [p0[0] - c[0], p0[1] - c[1], p0[2] - c[2]];
        const along = rd[0] * n[0] + rd[1] * n[1] + rd[2] * n[2];
        const x: Vec3 = [rd[0] - n[0] * along, rd[1] - n[1] * along, rd[2] - n[2] * along];
        const xl = Math.hypot(x[0], x[1], x[2]) || 1;
        const circ = add(`CIRCLE('',#${placement(c, n, [x[0] / xl, x[1] / xl, x[2] / xl])},${fmt(r)})`);
        const v0 = ch.closed && ch.anchor ? add(`VERTEX_POINT('',#${point(ch.anchor)})`) : vertex(first);
        ids = [add(`EDGE_CURVE('',#${v0},#${ch.closed ? v0 : vertex(last)},#${circ},.T.)`)];
      } else {
        ids = [];
        for (let i = 0; i + 1 < ch.pts.length; i++) ids.push(line(ch.pts[i], ch.pts[i + 1]));
      }
      chainEdges.set(k, ids);
      return ids;
    };
    const faceIds: number[] = [];
    for (const f of brep.faces) {
      if (!f.loops.length) continue;
      const bounds = f.loops.map((loop, k) => {
        const oe: number[] = [];
        for (const { chain, same } of loop) {
          const ids = edgesOf(chain);
          const seq = same ? ids : [...ids].reverse();
          for (const e of seq) oe.push(add(`ORIENTED_EDGE('',*,*,#${e},${same ? '.T.' : '.F.'})`));
        }
        const el = add(`EDGE_LOOP('',(${oe.map((e) => `#${e}`).join(',')}))`);
        return add(`${k === 0 && f.kind === 'plane' ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'}('',#${el},.T.)`);
      });
      const list = bounds.map((b) => `#${b}`).join(',');
      if (f.kind === 'cylinder' && f.cyl) {
        const { o, a, r, convex } = f.cyl;
        const surf = add(`CYLINDRICAL_SURFACE('',#${placement(o, a, squareTo(a))},${fmt(r)})`);
        faceIds.push(add(`ADVANCED_FACE('',(${list}),#${surf},${convex ? '.T.' : '.F.'})`));
      } else {
        const first = P(brep.chains[f.loops[0][0].chain].pts[0]);
        const plane = add(`PLANE('',#${placement(first, f.normal, squareTo(f.normal))})`);
        faceIds.push(add(`ADVANCED_FACE('',(${list}),#${plane},.T.)`));
      }
    }
    const shell = add(`CLOSED_SHELL('',(${faceIds.map((f) => `#${f}`).join(',')}))`);
    items.push(add(`MANIFOLD_SOLID_BREP('${body.name.replace(/'/gu, '')}',#${shell})`));
  }
  const rep = add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(${items.map((i) => `#${i}`).join(',')}),#${geo})`);
  const prod = add(`PRODUCT('${fileName}','${fileName}','',(#${pctx}))`);
  add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(#${prod}))`);
  const form = add(`PRODUCT_DEFINITION_FORMATION('','',#${prod})`);
  const pdef = add(`PRODUCT_DEFINITION('design','',#${form},#${dctx})`);
  const pds = add(`PRODUCT_DEFINITION_SHAPE('','',#${pdef})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(#${pds},#${rep})`);
  const stamp = when.toISOString().slice(0, 19);
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('AstraCAD Spatial part'),'2;1');",
    `FILE_NAME('${fileName}','${stamp}',(''),(''),'AstraCAD Spatial','AstraCAD Spatial','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}
