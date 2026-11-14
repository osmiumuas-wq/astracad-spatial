/**
 * Engine worker: the Part Language kernel, the truth gate, the stress solver,
 * the structural agent's closed loop and the topology optimiser.
 *
 * The page runs two of these: one answers builds while a handle is dragged,
 * the other carries long analysis jobs and can be terminated to cancel them.
 */

import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { autoReinforce, estimateCost, rankOrientations, StressSummary } from './agents.js';
import { buildRecord, toBinaryStl } from './exporters.js';
import { expectVolume } from './expect.js';
import { FeaResult, solveFea } from './fea.js';
import { solveFlow } from './flow.js';
import { solveModes } from './modal.js';
import { Job, jobById, Params } from './jobs.js';
import { initKernel, Kernel } from './kernel.js';
import { materialById } from './materials.js';
import { LoadSpec, Request, Response, SolveOutcome } from './protocol.js';
import { fieldSampler, optimise } from './topo.js';
import { insideDistance, latticeField, latticeFor, maxDepth } from './lattice.js';
import { describeHoles, mountingNormal, templateOf } from './template.js';
import { DEFAULT_PRINTER, hatch, Layer, Path, PrinterSettings, toGcode } from './gcode.js';
import { runGate } from './truth.js';
import { BuildOutput, MeshData, SpecError, Vec3 } from './types.js';

const scope = self as unknown as {
  postMessage(message: Response, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<Request>) => void) | null;
};

const kernelReady = initKernel(() => wasmUrl);

/** A free design has no hand formula or exact box: those checks are left out rather than faked. */
const finiteOr = (v: number): number | undefined => (Number.isFinite(v) ? v : undefined);
const boxOr = <T extends { tol: number }>(b: T): T | undefined => (Number.isFinite(b.tol) ? b : undefined);

let cache: { key: string; out: BuildOutput } | null = null;
let grown: { key: string; mesh: MeshData; volume: number } | null = null;

function build(kernel: Kernel, job: Job, params: Params): BuildOutput {
  const key = `${job.id}|${JSON.stringify(params)}`;
  if (cache?.key !== key) {
    cache = { key, out: kernel.build(job.spec(params)) };
  }
  return cache.out;
}

const meshBuffers = (m: MeshData): Transferable[] => [
  m.positions.buffer,
  m.normals.buffer,
  m.indices.buffer,
  m.edges.buffer,
];

const copyMesh = (m: MeshData): MeshData => ({
  positions: m.positions.slice(),
  normals: m.normals.slice(),
  indices: m.indices.slice(),
  edges: m.edges.slice(),
});

function loadOf(job: Job, params: Params, custom?: LoadSpec): { fixtureLabel: string; load: LoadSpec; fixture: ReturnType<Job['loadCase']>['fixture'] } {
  const lc = job.loadCase(params);
  return {
    fixtureLabel: lc.fixtureLabel,
    fixture: lc.fixture,
    load: custom ?? { region: lc.region, dir: lc.dir, newtons: lc.newtons, label: lc.loadLabel },
  };
}

function outcome(res: FeaResult, loadLabel: string, fixtureLabel: string): SolveOutcome {
  return {
    newtons: res.newtons,
    stressP99: res.stressP99,
    stressMax: res.stressMax,
    maxDisp: res.maxDisp,
    elements: res.stats.elements,
    cell: res.cell,
    vertexDisp: res.vertexDisp,
    vertexStress: res.vertexStress,
    loadLabel,
    fixtureLabel,
    iterations: res.stats.iterations,
    converged: res.stats.converged,
    ms: res.ms,
  };
}

async function handle(req: Request): Promise<void> {
  const kernel = await kernelReady;
  const job = jobById(req.job);
  const params = job.clamp(req.params).params;

  if (req.type === 'build') {
    const spec = job.spec(params);
    const full = spec.features.length;
    const upTo = req.upTo ?? full;
    const out = upTo >= full ? build(kernel, job, params) : kernel.build(spec, upTo);
    // The gate judges the finished part only; a rolled-back view is a preview.
    const gate =
      upTo >= full
        ? runGate({
            props: out.props,
            generic: expectVolume(spec),
            jobVolume: finiteOr(job.volume(params)),
            jobBox: boxOr(job.box(params)),
            jobGenus: job.genus(params) >= 0 ? job.genus(params) : undefined,
            jobBodies: job.bodies,
          })
        : { verdict: 'kernel-only' as const, checks: [] };
    const mesh = copyMesh(out.mesh);
    scope.postMessage(
      {
        id: req.id,
        type: 'built',
        mesh,
        props: out.props,
        gate,
        features: spec.features.map((f) => ({ id: f.id, op: f.$op })),
        applied: out.applied.length,
        ms: out.ms,
      },
      meshBuffers(mesh),
    );
    return;
  }

  if (req.type === 'views') {
    scope.postMessage({ id: req.id, type: 'viewed', views: kernel.views(job.spec(params)) });
    return;
  }

  if (req.type === 'flow') {
    const out = build(kernel, job, params);
    const res = solveFlow(out.mesh.positions, out.mesh.indices, req.wind);
    scope.postMessage(
      { id: req.id, type: 'flowed', points: res.points, speeds: res.speeds, starts: res.starts, h: res.h, cells: res.cells, iterations: res.iterations, ms: res.ms, wind: req.wind },
      [res.points.buffer, res.speeds.buffer, res.starts.buffer],
    );
    return;
  }

  if (req.type === 'slice') {
    const out = build(kernel, job, params);
    const best = rankOrientations(out.mesh.positions, out.mesh.indices)[0];
    const shownEvery = Math.max(1, Math.round(best.height / 0.2 / 120));
    const layers = kernel.slice(job.spec(params), best.up, 0.2, shownEvery);
    const cost = estimateCost(out.props, materialById('pla'));
    scope.postMessage(
      { id: req.id, type: 'sliced', ...layers, up: best.up, upLabel: best.label, minutes: cost.minutes ?? 0 },
      [layers.segments.buffer, layers.starts.buffer],
    );
    return;
  }

  if (req.type === 'gcode') {
    const mat = materialById(req.material);
    if (mat.process !== 'fdm') {
      throw new SpecError(`${mat.name} is machined, not printed; G-code here is for FDM plastics (PLA, PETG, ABS).`);
    }
    const out = build(kernel, job, params);
    const best = rankOrientations(out.mesh.positions, out.mesh.indices)[0];
    const temps: Record<string, [number, number]> = { pla: [210, 60], petg: [240, 80], abs: [250, 100] };
    const [nozzleTemp, bedTemp] = temps[mat.id] ?? [210, 60];
    const s: PrinterSettings = { ...DEFAULT_PRINTER, nozzleTemp, bedTemp, density: mat.density };
    const tp = kernel.toolpaths(job.spec(params), best.up, { layer: s.layer, line: s.line, walls: s.walls, skins: s.skins, bed: s.bed });
    const layers: Layer[] = tp.layers.map((L, i) => {
      const paths: Path[] = L.walls.map((pts) => ({ kind: 'wall' as const, pts, closed: true }));
      const angle = i % 2 ? -Math.PI / 4 : Math.PI / 4;
      for (const seg of hatch(L.skin, angle, s.line)) paths.push({ kind: 'skin', pts: seg, closed: false });
      for (const seg of hatch(L.sparse, angle, s.line / s.infill)) paths.push({ kind: 'infill', pts: seg, closed: false });
      return { z: L.z, paths };
    });
    const g = toGcode(layers, s, job.title);
    // Preview: every path as line segments in part millimetres, coloured by kind.
    const col: Record<string, [number, number, number]> = { wall: [1, 0.69, 0.13], skin: [0.24, 0.86, 0.52], infill: [0.21, 0.82, 1] };
    const segs: number[] = [];
    const cols: number[] = [];
    const starts: number[] = [];
    for (const L of layers) {
      starts.push(segs.length / 6);
      for (const p of L.paths) {
        const c = col[p.kind];
        const n = p.closed ? p.pts.length : p.pts.length - 1;
        for (let k = 0; k < n; k++) {
          const a = tp.toPart(p.pts[k][0], p.pts[k][1], L.z - s.layer / 2);
          const q = p.pts[(k + 1) % p.pts.length];
          const bb = tp.toPart(q[0], q[1], L.z - s.layer / 2);
          segs.push(...a, ...bb);
          cols.push(...c, ...c);
        }
      }
    }
    const segments = new Float32Array(segs);
    const colors = new Float32Array(cols);
    const startArr = Uint32Array.from(starts);
    scope.postMessage(
      { id: req.id, type: 'gcoded', gcode: g.gcode, name: `${job.id}-${mat.id}`, grams: g.grams, filamentMm: g.filamentMm, seconds: g.seconds, layers: g.layers, upLabel: best.label, segments, colors, starts: startArr },
      [segments.buffer, colors.buffer, startArr.buffer],
    );
    return;
  }

  if (req.type === 'template') {
    const out = build(kernel, job, params);
    const lc = job.loadCase(params);
    const normal = mountingNormal(lc.fixture, out.props.bbox);
    if (!normal || !/screw|bolt/iu.test(lc.fixtureLabel)) {
      throw new SpecError(`This part is ${lc.fixtureLabel.toLowerCase()}; a drilling template is for parts that are screwed or bolted on.`);
    }
    const sec = kernel.section(job.spec(params), normal, 0.4);
    const t = templateOf(sec.loops);
    scope.postMessage({ id: req.id, type: 'templated', loops: sec.loops, holes: t.holes, outline: t.outline, normal, label: describeHoles(t.holes) });
    return;
  }

  if (req.type === 'lattice') {
    const t0 = performance.now();
    const spec = job.spec(params);
    const out = build(kernel, job, params);
    const b = out.props.bbox;
    const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const ls = latticeFor(size);
    // Grid and mesh resolution: fine enough for the sheets, coarse enough for a headset (and the WebAssembly heap).
    const h = Math.max(0.6, size / 110);
    const grid = insideDistance(out.mesh.positions, out.mesh.indices, h);
    // A core needs the skin on both sides and room for a sheet between.
    // A core worth having: past the skin there must be room for most of a cell.
    const need = ls.skin + ls.cell * 0.4;
    if (maxDepth(grid) < need) {
      throw new SpecError(`Too thin for a lattice core: its thickest section is ${(2 * maxDepth(grid)).toFixed(1)} mm; a gyroid core needs about ${(2 * need).toFixed(0)} mm. Lattices suit chunky parts.`);
    }
    const res = kernel.carve(spec, latticeField(grid, ls), { min: [b.min[0] - 1, b.min[1] - 1, b.min[2] - 1], max: [b.max[0] + 1, b.max[1] + 1, b.max[2] + 1] }, h * 1.1);
    scope.postMessage(
      { id: req.id, type: 'latticed', mesh: res.mesh, props: res.props, before: out.props.volume, cell: ls.cell, wall: ls.wall, skin: ls.skin, ms: performance.now() - t0 },
      meshBuffers(res.mesh),
    );
    return;
  }

  const material = materialById(req.material);
  const wallHint = job.roles.wall ? params[job.roles.wall] : undefined;

  if (req.type === 'modes') {
    const { fixture, fixtureLabel, load } = loadOf(job, params, undefined);
    const out = build(kernel, job, params);
    const res = solveModes({
      positions: out.mesh.positions,
      indices: out.mesh.indices,
      volume: out.props.volume,
      E: material.E,
      nu: material.nu,
      density: material.density,
      fixture,
      load,
      // No thin-wall refinement here: frequencies need far fewer cells than peak stress,
      // and the finer grid made this take most of a minute.
      targetElements: 2500,
      modes: 3,
      onProgress: (mode, iteration) => scope.postMessage({ id: req.id, type: 'mode-progress', mode, iteration }),
    });
    scope.postMessage(
      { id: req.id, type: 'moded', frequencies: res.frequencies, shapes: res.shapes, cell: res.cell, elements: res.elements, ms: res.ms, fixtureLabel },
      res.shapes.map((s) => s.buffer),
    );
    return;
  }

  if (req.type === 'solve') {
    const { fixture, fixtureLabel, load } = loadOf(job, params, req.load);
    const useGrown = req.grown && grown?.key === `${job.id}|${JSON.stringify(params)}`;
    const out = build(kernel, job, params);
    const mesh = useGrown && grown ? grown.mesh : out.mesh;
    const res = solveFea({
      positions: mesh.positions,
      indices: mesh.indices,
      volume: useGrown && grown ? grown.volume : out.props.volume,
      E: material.E,
      nu: material.nu,
      fixture,
      load,
      wallHint,
      targetElements: req.target ?? 3500,
      tol: 1e-4,
      onProgress: (iteration, residual) =>
        scope.postMessage({ id: req.id, type: 'progress', iteration, residual }),
    });
    const o = outcome(res, load.label, fixtureLabel);
    scope.postMessage({ id: req.id, type: 'solved', outcome: o }, [
      o.vertexDisp.buffer,
      o.vertexStress.buffer,
    ]);
    return;
  }

  if (req.type === 'reinforce') {
    const result = autoReinforce(
      job,
      params,
      material,
      req.loadN,
      (p) => {
        const out = build(kernel, job, p);
        const { fixture, load } = loadOf(job, p, req.load);
        const res = solveFea({
          positions: out.mesh.positions,
          indices: out.mesh.indices,
          volume: out.props.volume,
          E: material.E,
          nu: material.nu,
          fixture,
          load,
          wallHint: job.roles.wall ? p[job.roles.wall] : undefined,
          targetElements: 3000,
          tol: 1e-4,
        });
        const stress: StressSummary = {
          newtons: res.newtons,
          stressP99: res.stressP99,
          stressMax: res.stressMax,
          maxDisp: res.maxDisp,
          elements: res.stats.elements,
          cell: res.cell,
        };
        return { props: out.props, stress };
      },
      (step) => scope.postMessage({ id: req.id, type: 'reinforce-step', step }),
    );
    scope.postMessage({ id: req.id, type: 'reinforced', steps: result.steps, reached: result.reached });
    return;
  }

  if (req.type === 'grow') {
    const t0 = performance.now();
    const spec = job.spec(params);
    const out = build(kernel, job, params);
    const { fixture, fixtureLabel, load } = loadOf(job, params, req.load);
    const total = 18;
    const carve = (field: Parameters<typeof fieldSampler>[0], final = false) => {
      const g = field.grid;
      const min: Vec3 = [g.origin[0] - g.h, g.origin[1] - g.h, g.origin[2] - g.h];
      const max: Vec3 = [
        g.origin[0] + (g.nx + 1) * g.h,
        g.origin[1] + (g.ny + 1) * g.h,
        g.origin[2] + (g.nz + 1) * g.h,
      ];
      return kernel.carve(spec, fieldSampler(field), { min, max }, g.h * (final ? 0.85 : 1.3));
    };
    const res = optimise({
      positions: out.mesh.positions,
      indices: out.mesh.indices,
      volume: out.props.volume,
      E: material.E,
      nu: material.nu,
      fixture,
      load,
      // The optimiser works on a coarse grid; it does not need cells sized to the wall.
      wallHint: undefined,
      keep: req.keep,
      iterations: total,
      targetElements: 1600,
      onIteration: (info) => {
        if (info.iteration % 3 === 0) {
          try {
            const frame = carve(info.field);
            scope.postMessage(
              { id: req.id, type: 'grow-frame', iteration: info.iteration, of: total, mesh: frame.mesh, props: frame.props },
              meshBuffers(frame.mesh),
            );
          } catch {
            // A frame that cannot be meshed is skipped; the final one is checked below.
          }
        }
      },
    });
    const final = carve(res.field, true);
    grown = {
      key: `${job.id}|${JSON.stringify(params)}`,
      mesh: copyMesh(final.mesh),
      volume: final.props.volume,
    };
    // Prove the grown shape: solve it again from its own mesh.
    const check = solveFea({
      positions: final.mesh.positions,
      indices: final.mesh.indices,
      volume: final.props.volume,
      E: material.E,
      nu: material.nu,
      fixture,
      load,
      wallHint,
      targetElements: 3000,
      tol: 1e-4,
    });
    const o = outcome(check, load.label, fixtureLabel);
    scope.postMessage(
      {
        id: req.id,
        type: 'grown',
        mesh: final.mesh,
        props: final.props,
        outcome: o,
        kept: final.props.volume / out.props.volume,
        iterations: res.iterations,
        ms: performance.now() - t0,
      },
      [...meshBuffers(final.mesh), o.vertexDisp.buffer, o.vertexStress.buffer],
    );
    return;
  }

  if (req.type === 'export') {
    const spec = job.spec(params);
    const out = build(kernel, job, params);
    const gate = runGate({
      props: out.props,
      generic: expectVolume(spec),
      jobVolume: finiteOr(job.volume(params)),
      jobBox: boxOr(job.box(params)),
      jobGenus: job.genus(params) >= 0 ? job.genus(params) : undefined,
      jobBodies: job.bodies,
    });
    const source = req.grownMesh ?? out.mesh;
    const stl = toBinaryStl(source.positions, source.indices, `${spec.name} ${gate.verdict}`);
    const record = await buildRecord({
      job: job.id,
      material: material.id,
      parameters: params,
      measurements: req.measurements,
      spec,
      kernel: out.props,
      truthGate: gate,
    });
    scope.postMessage(
      { id: req.id, type: 'exported', stl, record, name: req.grownMesh ? `${spec.name}_grown` : spec.name },
      [stl.buffer],
    );
  }
}

scope.onmessage = (event) => {
  const req = event.data;
  handle(req).catch((error: unknown) => {
    scope.postMessage({
      id: req.id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      featureId: error instanceof SpecError ? error.featureId : undefined,
    });
  });
};

kernelReady.then(
  () => scope.postMessage({ id: 0, type: 'ready' }),
  (error: unknown) =>
    scope.postMessage({
      id: 0,
      type: 'error',
      message: `The geometry kernel failed to load: ${error instanceof Error ? error.message : String(error)}`,
    }),
);
