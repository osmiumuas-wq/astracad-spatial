import { beforeAll, describe, expect, it } from 'vitest';
import {
  autoReinforce,
  estimateCost,
  rankOrientations,
  runAgents,
  safetyFactor,
  StressSummary,
  TARGET_SF,
} from '../src/engine/agents.js';
import { buildRecord, stlVolume, toBinaryStl } from '../src/engine/exporters.js';
import { expectVolume } from '../src/engine/expect.js';
import { solveFea } from '../src/engine/fea.js';
import { defaultParams, jobById, JOBS, Params } from '../src/engine/jobs.js';
import { initKernel, Kernel } from '../src/engine/kernel.js';
import { materialById } from '../src/engine/materials.js';
import { decodeShare, encodeShare } from '../src/engine/share.js';
import { fieldSampler, optimise } from '../src/engine/topo.js';
import { runGate } from '../src/engine/truth.js';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await initKernel();
});

const pla = materialById('pla');

function evaluate(jobId: string, params: Params, target = 3500) {
  const job = jobById(jobId);
  const out = kernel.build(job.spec(params));
  const lc = job.loadCase(params);
  const res = solveFea({
    positions: out.mesh.positions,
    indices: out.mesh.indices,
    volume: out.props.volume,
    E: pla.E,
    nu: pla.nu,
    fixture: lc.fixture,
    load: { region: lc.region, dir: lc.dir, newtons: lc.newtons },
    wallHint: job.roles.wall ? params[job.roles.wall] : undefined,
    targetElements: target,
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
  return { out, res, stress, lc };
}

describe('Viktor: standards', () => {
  it('moves a 4.2 mm screw hole to the ISO 273 clearance for M4', () => {
    const job = jobById('wall-bracket');
    const params = defaultParams(job);
    const out = kernel.build(job.spec(params));
    const findings = runAgents({ job, params, props: out.props, material: pla, loadN: 50 });
    const hole = findings.find((f) => f.agent === 'viktor' && f.id === 'clearance');
    expect(hole?.severity).toBe('warn');
    expect(hole?.fix?.changes).toEqual({ d: 4.5 });
    const fixed = job.clamp({ ...params, ...hole?.fix?.changes }).params;
    const again = runAgents({ job, params: fixed, props: kernel.build(job.spec(fixed)).props, material: pla, loadN: 50 });
    expect(again.find((f) => f.id === 'clearance')?.severity).toBe('ok');
  });

  it('sizes a counterbore for the socket head once the hole is standard', () => {
    const job = jobById('flange-plate');
    let params = defaultParams(job);
    let findings = runAgents({ job, params, props: kernel.build(job.spec(params)).props, material: pla, loadN: 200 });
    const hole = findings.find((f) => f.id === 'clearance');
    expect(hole?.fix?.changes).toEqual({ d: 5.5 });
    params = job.clamp({ ...params, ...hole?.fix?.changes }).params;
    findings = runAgents({ job, params, props: kernel.build(job.spec(params)).props, material: pla, loadN: 200 });
    const cb = findings.find((f) => f.id === 'counterbore');
    expect(cb?.severity).toBe('warn');
    expect(cb?.fix?.changes).toEqual({ cb: 10, cbd: 5.4 });
    params = job.clamp({ ...params, ...cb?.fix?.changes }).params;
    const out = kernel.build(job.spec(params));
    findings = runAgents({ job, params, props: out.props, material: pla, loadN: 200 });
    expect(findings.find((f) => f.id === 'counterbore')?.severity).toBe('ok');
    // The agent's edit must still pass the truth gate.
    const gate = runGate({
      props: out.props,
      generic: expectVolume(job.spec(params)),
      jobVolume: job.volume(params),
      jobBox: job.box(params),
      jobGenus: job.genus(params),
      jobBodies: job.bodies,
    });
    expect(gate.verdict).toBe('verified');
  });

  it('states mass and cost with their assumptions', () => {
    const job = jobById('fit-clip');
    const params = defaultParams(job);
    const props = kernel.build(job.spec(params)).props;
    const cost = estimateCost(props, pla);
    expect(cost.massSolid).toBeCloseTo((props.volume / 1000) * 1.24, 6);
    expect(cost.massUsed).toBeLessThanOrEqual(cost.massSolid + 1e-9);
    expect(cost.assumptions).toMatch(/infill/);
  });
});

describe('Elena: manufacturing', () => {
  it('finds a support-free print direction for every job', () => {
    for (const job of JOBS) {
      const params = defaultParams(job);
      const out = kernel.build(job.spec(params));
      const ranked = rankOrientations(out.mesh.positions, out.mesh.indices);
      console.log(`${job.id}: best "${ranked[0].label}" overhang ${ranked[0].overhang.toFixed(1)} mm2; as shown ${ranked.find((o) => o.label === 'as shown')?.overhang.toFixed(1)} mm2`);
      expect(ranked[0].overhang).toBeGreaterThanOrEqual(0);
    }
    const bracket = jobById('wall-bracket');
    const out = kernel.build(bracket.spec(defaultParams(bracket)));
    const ranked = rankOrientations(out.mesh.positions, out.mesh.indices);
    // Wall plate on the bed, arm standing up, screw holes vertical: nothing overhangs.
    expect(ranked[0].label).toBe('left end down');
    expect(ranked[0].overhang).toBeLessThan(1);
  });

  it('flags a wall under three nozzle passes and proposes 1.2 mm', () => {
    const job = jobById('fit-clip');
    const params = job.clamp({ ...defaultParams(job), t: 0.7 }).params;
    const out = kernel.build(job.spec(params));
    const findings = runAgents({ job, params, props: out.props, material: pla, loadN: 10, positions: out.mesh.positions, indices: out.mesh.indices });
    const wall = findings.find((f) => f.agent === 'elena' && f.id === 'wall');
    expect(wall?.severity).toBe('fail');
    expect(wall?.fix?.changes.t).toBeCloseTo(1.2, 6);
  });
});

describe('Marcus: structure', () => {
  it('says "not tested" until there is a solve', () => {
    const job = jobById('wall-bracket');
    const params = defaultParams(job);
    const findings = runAgents({ job, params, props: kernel.build(job.spec(params)).props, material: pla, loadN: 50 });
    expect(findings.find((f) => f.agent === 'marcus')?.id).toBe('untested');
  });

  it('reinforces an overloaded bracket and proves it by re-testing', () => {
    const job = jobById('wall-bracket');
    const start = defaultParams(job);
    const loadN = 120;
    const result = autoReinforce(job, start, pla, loadN, (p) => {
      const { out, stress } = evaluate('wall-bracket', p);
      return { props: out.props, stress };
    });
    for (const s of result.steps) {
      console.log(`step ${s.step}: factor ${s.factor.toFixed(2)} ${s.change ? `after ${s.change}` : '(start)'}`);
    }
    expect(result.steps[0].factor).toBeLessThan(TARGET_SF);
    expect(result.reached).toBe(true);
    expect(result.steps[result.steps.length - 1].factor).toBeGreaterThanOrEqual(TARGET_SF);
  });

  it('scales stress linearly with load', () => {
    const { stress } = evaluate('wall-bracket', defaultParams(jobById('wall-bracket')));
    expect(safetyFactor(pla, stress, 100) * 2).toBeCloseTo(safetyFactor(pla, stress, 50), 9);
  });
});

describe('living bone', () => {
  it('keeps about the requested material and gets stiffer than the uniform start', () => {
    const job = jobById('wall-bracket');
    const params = defaultParams(job);
    const spec = job.spec(params);
    const out = kernel.build(spec);
    const lc = job.loadCase(params);
    let reports = 0;
    const res = optimise({
      positions: out.mesh.positions,
      indices: out.mesh.indices,
      volume: out.props.volume,
      E: pla.E,
      nu: pla.nu,
      fixture: lc.fixture,
      load: { region: lc.region, dir: lc.dir, newtons: lc.newtons },
      wallHint: params.t,
      keep: 0.55,
      iterations: 20,
      targetElements: 2500,
      onIteration: () => {
        reports++;
      },
    });
    expect(reports).toBe(res.iterations);
    expect(res.compliance).toBeLessThan(res.complianceStart);
    const g = res.field.grid;
    const carved = kernel.carve(
      spec,
      fieldSampler(res.field),
      {
        min: [g.origin[0] - g.h, g.origin[1] - g.h, g.origin[2] - g.h],
        max: [g.origin[0] + (g.nx + 1) * g.h, g.origin[1] + (g.ny + 1) * g.h, g.origin[2] + (g.nz + 1) * g.h],
      },
      g.h * 0.8,
    );
    const kept = carved.props.volume / out.props.volume;
    console.log(
      `living bone: ${res.elements} cells, ${res.iterations} iterations, ${res.ms.toFixed(0)} ms, compliance ${res.complianceStart.toFixed(2)} -> ${res.compliance.toFixed(2)} N mm, kept ${(kept * 100).toFixed(1)} % of the volume, ${carved.props.triangles} triangles`,
    );
    expect(kept).toBeGreaterThan(0.35);
    expect(kept).toBeLessThan(0.8);
    expect(carved.props.status).toBe('NoError');
  });
});

describe('take-away files', () => {
  it('STL carries the kernel volume and the record carries the proof', async () => {
    const job = jobById('flange-plate');
    const params = defaultParams(job);
    const spec = job.spec(params);
    const out = kernel.build(spec);
    const stl = toBinaryStl(out.mesh.positions, out.mesh.indices, spec.name);
    expect(stl.length).toBe(84 + out.props.triangles * 50);
    expect(Math.abs(stlVolume(stl) - out.props.volume) / out.props.volume).toBeLessThan(1e-5);
    const gate = runGate({ props: out.props, generic: expectVolume(spec), jobVolume: job.volume(params), jobBox: job.box(params), jobGenus: job.genus(params) });
    const record = await buildRecord({ job: job.id, material: 'pla', parameters: params, measurements: [], spec, kernel: out.props, truthGate: gate });
    expect(record.specSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(record.truthGate.verdict).toBe('verified');
  });

  it('a share link round-trips and refuses garbage', () => {
    for (const job of JOBS) {
      const params = job.clamp({ ...defaultParams(job), [job.params[0].id]: job.params[0].min + 1.35 }).params;
      const link = encodeShare({ job: job.id, material: 'petg', params });
      const back = decodeShare(`#${link}`);
      expect(back?.job.id).toBe(job.id);
      expect(back?.material).toBe('petg');
      for (const d of job.params) {
        expect(back?.params[d.id]).toBeCloseTo(params[d.id], 6);
      }
    }
    expect(decodeShare('#p=nope.pla.1_2')).toBeNull();
    expect(decodeShare('#p=fit-clip.pla.1_2')).toBeNull();
    expect(decodeShare('')).toBeNull();
  });
});
