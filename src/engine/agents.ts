/**
 * The three engineering agents. Each one watches the live part and reports
 * findings with the numbers behind them and, where a parameter change would
 * help, a fix the user can accept with one pinch.
 *
 * They are deterministic expert systems, not language models: every rule is
 * written here and every statement carries its evidence. A fix is a proposal;
 * the bench rebuilds and re-tests after applying it, and the agent's next
 * report says whether the fix worked.
 */

import { Job, Params, paramDef } from './jobs.js';
import { nearestScrew } from './materials.js';
import { KernelProps, Material, Vec3 } from './types.js';

export type AgentId = 'marcus' | 'elena' | 'viktor';
export type Severity = 'ok' | 'info' | 'warn' | 'fail';

export interface Fix {
  label: string;
  changes: Params;
  /** What the fix is expected to do, stated as an estimate. */
  expect: string;
}

export interface Finding {
  agent: AgentId;
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  evidence: string;
  fix?: Fix;
}

export const AGENTS: Record<AgentId, { name: string; role: string }> = {
  marcus: { name: 'Marcus', role: 'Structure' },
  elena: { name: 'Elena', role: 'Manufacturing' },
  viktor: { name: 'Viktor', role: 'Cost and standards' },
};

/** Stress preview result, as much of it as the agents need. */
export interface StressSummary {
  /** Load the solve was run at, N. */
  newtons: number;
  stressP99: number;
  stressMax: number;
  maxDisp: number;
  elements: number;
  cell: number;
}

export interface PrintAssumptions {
  nozzle: number;
  /** Wall the slicer lays down around the part, mm. */
  shell: number;
  /** Infill fraction, 0 to 1. */
  infill: number;
  /** Volumetric flow, mm3 per second. */
  flow: number;
}

export const DEFAULT_PRINT: PrintAssumptions = { nozzle: 0.4, shell: 1.2, infill: 0.2, flow: 8 };

export interface AgentContext {
  job: Job;
  params: Params;
  props: KernelProps;
  material: Material;
  /** Load to judge the part at, N. */
  loadN: number;
  stress?: StressSummary;
  /** Triangle mesh in part coordinates, for the print-orientation check. */
  positions?: Float32Array;
  indices?: Uint32Array;
  print?: PrintAssumptions;
}

/** Safety factor the structural agent aims for. */
export const TARGET_SF = 2;

const SEVERITY_RANK: Record<Severity, number> = { fail: 3, warn: 2, info: 1, ok: 0 };

const f1 = (v: number): string => v.toFixed(1);
const f2 = (v: number): string => v.toFixed(2);

function roundTo(v: number, step: number, up: boolean): number {
  const q = v / step;
  return (up ? Math.ceil(q - 1e-9) : Math.floor(q + 1e-9)) * step;
}

/** Safety factor against yield at `loadN`, using the reported (99th percentile) stress. */
export function safetyFactor(material: Material, stress: StressSummary, loadN: number): number {
  const sigma = stress.stressP99 * (loadN / stress.newtons);
  return sigma > 0 ? material.yield / sigma : Infinity;
}

// ---------------------------------------------------------------------------
// Marcus: structure
// ---------------------------------------------------------------------------

/** How bending stress falls when a parameter grows: stress ~ value^(-exponent). */
const STIFFEN_EXPONENT: Record<string, number> = {
  t: 2,
  back: 2,
  th: 2,
  floor: 2,
  w: 1,
  g: 1,
  r: 0.5,
  D: 2,
};

function marcus(ctx: AgentContext): Finding[] {
  const { job, params, material, stress, loadN } = ctx;
  if (!stress) {
    return [
      {
        agent: 'marcus',
        id: 'untested',
        severity: 'info',
        title: 'Not load-tested yet',
        detail: 'Push the part with an open palm, or run the standard load case.',
        evidence: `Standard case: ${job.loadCase(params).loadLabel}, ${loadN} N.`,
      },
    ];
  }
  if (loadN <= 0) {
    return [
      {
        agent: 'marcus',
        id: 'unloaded',
        severity: 'info',
        title: 'No load applied',
        detail: 'Push the part, or run the standard load case.',
        evidence: `Last solve: ${stress.newtons} N.`,
      },
    ];
  }
  const sf = safetyFactor(material, stress, loadN);
  const sigma = stress.stressP99 * (loadN / stress.newtons);
  const defl = stress.maxDisp * (loadN / stress.newtons);
  const evidence =
    `Stress ${f1(sigma)} MPa (99th percentile) against ${material.yield} MPa yield for ${material.name}; ` +
    `${stress.elements} cells of ${f2(stress.cell)} mm.`;
  const out: Finding[] = [];

  const grow = (targetSf: number): Fix | undefined => {
    for (const id of job.roles.stiffen) {
      const def = paramDef(job, id);
      if (!def) {
        continue;
      }
      const exponent = STIFFEN_EXPONENT[id] ?? 1;
      const factor = Math.pow(targetSf / sf, 1 / exponent);
      const wanted = roundTo(Math.max(params[id], def.min) * factor, def.step, true);
      const next = Math.min(def.max, wanted);
      if (next > params[id] + 1e-9) {
        const trial = job.clamp({ ...params, [id]: next }).params;
        if (trial[id] > params[id] + 1e-9) {
          return {
            label: `${def.label} ${f1(params[id])} to ${f1(trial[id])} mm`,
            changes: { [id]: trial[id] },
            expect:
              next < wanted
                ? `Largest allowed value. Estimated factor ${f1(sf * Math.pow(trial[id] / params[id], exponent))}; re-tested after the change.`
                : `Estimated factor ${f1(targetSf)}; re-tested after the change.`,
          };
        }
      }
    }
    return undefined;
  };

  if (sf < 1) {
    out.push({
      agent: 'marcus',
      id: 'yield',
      severity: 'fail',
      title: `Yields at ${f1(loadN)} N`,
      detail: `Safety factor ${f2(sf)}. The part would deform permanently.`,
      evidence,
      fix: grow(TARGET_SF),
    });
  } else if (sf < TARGET_SF) {
    out.push({
      agent: 'marcus',
      id: 'margin',
      severity: 'warn',
      title: `Thin margin, factor ${f2(sf)}`,
      detail: `Holds ${f1(loadN)} N but below the target factor of ${TARGET_SF}.`,
      evidence,
      fix: grow(TARGET_SF),
    });
  } else if (sf > 8) {
    // Over-built: offer to give material back, down to a factor of 3.
    let fix: Fix | undefined;
    for (const id of job.roles.stiffen) {
      const def = paramDef(job, id);
      if (!def) {
        continue;
      }
      const exponent = STIFFEN_EXPONENT[id] ?? 1;
      const wanted = roundTo(params[id] * Math.pow(3 / sf, 1 / exponent), def.step, true);
      // Never thinner than the manufacturing agent accepts for a wall.
      const floor = id === job.roles.wall ? (material.process === 'fdm' ? 3 * DEFAULT_PRINT.nozzle : 1) : def.min;
      const next = Math.max(def.min, floor, wanted);
      const trial = job.clamp({ ...params, [id]: next }).params;
      if (trial[id] < params[id] - 1e-9) {
        fix = {
          label: `${def.label} ${f1(params[id])} to ${f1(trial[id])} mm`,
          changes: { [id]: trial[id] },
          expect: 'Lighter, estimated factor about 3; re-tested after the change.',
        };
        break;
      }
    }
    out.push({
      agent: 'marcus',
      id: 'overbuilt',
      severity: 'info',
      title: `Over-built, factor ${f1(sf)}`,
      detail: 'Strong enough several times over. Material can come out.',
      evidence,
      fix,
    });
  } else {
    out.push({
      agent: 'marcus',
      id: 'holds',
      severity: 'ok',
      title: `Holds, factor ${f1(sf)}`,
      detail: `Carries ${f1(loadN)} N with margin.`,
      evidence,
    });
  }

  const size = Math.max(
    ctx.props.bbox.max[0] - ctx.props.bbox.min[0],
    ctx.props.bbox.max[1] - ctx.props.bbox.min[1],
    ctx.props.bbox.max[2] - ctx.props.bbox.min[2],
  );
  if (defl > 0.03 * size) {
    out.push({
      agent: 'marcus',
      id: 'flex',
      severity: 'warn',
      title: `Flexes ${f1(defl)} mm`,
      detail: `Deflection is ${f1((defl / size) * 100)} % of the part size at ${f1(loadN)} N.`,
      evidence: `Largest displacement ${f2(defl)} mm; part size ${f1(size)} mm. Small-deflection theory is stretched here.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Elena: manufacturing
// ---------------------------------------------------------------------------

export interface Orientation {
  up: Vec3;
  label: string;
  /** Area facing down steeper than 45 degrees and not on the bed, mm2. */
  overhang: number;
  /** Area in contact with the bed, mm2. */
  bed: number;
  height: number;
}

const ORIENTATIONS: { up: Vec3; label: string }[] = [
  { up: [0, 1, 0], label: 'as shown' },
  { up: [0, -1, 0], label: 'upside down' },
  { up: [0, 0, 1], label: 'back side down' },
  { up: [0, 0, -1], label: 'front side down' },
  { up: [1, 0, 0], label: 'left end down' },
  { up: [-1, 0, 0], label: 'right end down' },
];

/** Overhang, bed contact and height for one build direction. */
export function analyseOrientation(
  positions: Float32Array,
  indices: Uint32Array,
  up: Vec3,
  label = '',
): Orientation {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const s = positions[i] * up[0] + positions[i + 1] * up[1] + positions[i + 2] * up[2];
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  const cos45 = Math.SQRT1_2;
  let overhang = 0;
  let bed = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0) {
      continue;
    }
    const area = len / 2;
    const facing = (nx * up[0] + ny * up[1] + nz * up[2]) / len;
    if (facing < -cos45) {
      const sa = positions[a] * up[0] + positions[a + 1] * up[1] + positions[a + 2] * up[2];
      const sb = positions[b] * up[0] + positions[b + 1] * up[1] + positions[b + 2] * up[2];
      const sc = positions[c] * up[0] + positions[c + 1] * up[1] + positions[c + 2] * up[2];
      if (Math.max(sa, sb, sc) - lo < 0.05) {
        bed += area;
      } else {
        overhang += area;
      }
    }
  }
  return { up, label, overhang, bed, height: hi - lo };
}

/** The six axis-aligned build directions, best first (least overhang, then lowest). */
export function rankOrientations(positions: Float32Array, indices: Uint32Array): Orientation[] {
  return ORIENTATIONS.map((o) => analyseOrientation(positions, indices, o.up, o.label)).sort(
    (a, b) => a.overhang - b.overhang || a.height - b.height,
  );
}

function elena(ctx: AgentContext): Finding[] {
  const { job, params, material } = ctx;
  const print = ctx.print ?? DEFAULT_PRINT;
  const out: Finding[] = [];
  const wallId = job.roles.wall;
  const wall = wallId ? params[wallId] : undefined;
  const wallDef = wallId ? paramDef(job, wallId) : undefined;

  if (material.process === 'fdm') {
    const hardMin = 2 * print.nozzle;
    const advised = 3 * print.nozzle;
    if (wall !== undefined && wallDef) {
      if (wall < advised - 1e-9) {
        const target = Math.max(wallDef.min, roundTo(advised, wallDef.fine, true));
        out.push({
          agent: 'elena',
          id: 'wall',
          severity: wall < hardMin - 1e-9 ? 'fail' : 'warn',
          title: `Wall ${f2(wall)} mm is thin`,
          detail:
            wall < hardMin - 1e-9
              ? `Under two passes of a ${print.nozzle} mm nozzle: it will not print solid.`
              : `Under three passes of a ${print.nozzle} mm nozzle: prints, but weak.`,
          evidence: `Rule: at least ${f1(hardMin)} mm (2 passes), ${f1(advised)} mm advised (3 passes).`,
          fix:
            target > wall
              ? { label: `${wallDef.label} to ${f1(target)} mm`, changes: { [wallId as string]: target }, expect: 'Three full passes.' }
              : undefined,
        });
      }
    }
    if (ctx.positions && ctx.indices) {
      const ranked = rankOrientations(ctx.positions, ctx.indices);
      const shown = ranked.find((o) => o.label === 'as shown') as Orientation;
      const best = ranked[0];
      if (best.overhang < 1) {
        out.push({
          agent: 'elena',
          id: 'orientation',
          severity: 'ok',
          title: best.label === 'as shown' ? 'Prints as shown' : `Print ${best.label}`,
          detail: 'No overhang steeper than 45 degrees: no supports needed.',
          evidence: `Bed contact ${f1(best.bed)} mm2, height ${f1(best.height)} mm. As shown: ${f1(shown.overhang)} mm2 of overhang.`,
        });
      } else {
        out.push({
          agent: 'elena',
          id: 'orientation',
          severity: 'warn',
          title: `Needs supports (${f1(best.overhang)} mm2)`,
          detail: `Best of six directions is ${best.label}; some faces still overhang past 45 degrees.`,
          evidence: `Overhang ${f1(best.overhang)} mm2, bed contact ${f1(best.bed)} mm2, height ${f1(best.height)} mm.`,
        });
      }
    }
    const holeId = job.roles.hole;
    if (holeId && params[holeId] < 2) {
      out.push({
        agent: 'elena',
        id: 'small-hole',
        severity: 'warn',
        title: `Hole ${f1(params[holeId])} mm prints closed`,
        detail: 'Printed holes under 2 mm usually need drilling out.',
        evidence: 'Rule of thumb for a 0.4 mm nozzle.',
      });
    }
  } else {
    // Machined from solid.
    if (params.r !== undefined && paramDef(job, 'r') && params.r < 1.5 - 1e-9) {
      out.push({
        agent: 'elena',
        id: 'corner',
        severity: 'warn',
        title: `Inside corner ${f1(params.r)} mm`,
        detail: 'An inside corner cannot be sharper than the cutter that makes it.',
        evidence: 'Rule: inside radius at least 1.5 mm, for a 3 mm end mill.',
        fix: { label: 'Corner radius to 1.5 mm', changes: { r: 1.5 }, expect: 'Cut with a standard 3 mm end mill.' },
      });
    }
    if (wall !== undefined && wallDef && wall < 1) {
      const target = Math.max(wallDef.min, 1);
      out.push({
        agent: 'elena',
        id: 'wall',
        severity: 'warn',
        title: `Wall ${f2(wall)} mm chatters`,
        detail: 'Walls under 1 mm deflect away from the cutter.',
        evidence: 'Rule of thumb for aluminium and steel on a three-axis mill.',
        fix: target > wall ? { label: `${wallDef.label} to ${f1(target)} mm`, changes: { [wallId as string]: target }, expect: 'Stiff enough to machine.' } : undefined,
      });
    }
    if (!out.length) {
      out.push({
        agent: 'elena',
        id: 'machinable',
        severity: 'ok',
        title: 'Machinable in three axes',
        detail: 'No wall or corner breaks the milling rules checked.',
        evidence: 'Checked: wall at least 1 mm, inside corners at least 1.5 mm.',
      });
    }
  }
  if (!out.length) {
    out.push({
      agent: 'elena',
      id: 'printable',
      severity: 'ok',
      title: 'Printable',
      detail: 'No wall or hole breaks the printing rules checked.',
      evidence: `Checked against a ${print.nozzle} mm nozzle.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Viktor: cost and standards
// ---------------------------------------------------------------------------

export interface CostEstimate {
  /** Mass of the finished solid part, g. */
  massSolid: number;
  /** Material actually used, g (print: shells plus infill; machining: the stock block). */
  massUsed: number;
  usd: number;
  /** Print time, minutes (printing only). */
  minutes?: number;
  assumptions: string;
}

export function estimateCost(props: KernelProps, material: Material, print = DEFAULT_PRINT): CostEstimate {
  const massSolid = (props.volume / 1000) * material.density;
  if (material.process === 'fdm') {
    const shellVolume = Math.min(props.volume, props.surfaceArea * print.shell);
    const used = shellVolume + (props.volume - shellVolume) * print.infill;
    const massUsed = (used / 1000) * material.density;
    return {
      massSolid,
      massUsed,
      usd: (massUsed / 1000) * material.usdPerKg,
      minutes: used / print.flow / 60,
      assumptions: `${print.shell} mm shell, ${Math.round(print.infill * 100)} % infill, ${print.flow} mm3/s flow, ${material.usdPerKg} USD/kg. Supports and failed prints not counted.`,
    };
  }
  const b = props.bbox;
  const stock = (b.max[0] - b.min[0] + 2) * (b.max[1] - b.min[1] + 2) * (b.max[2] - b.min[2] + 2);
  const massUsed = (stock / 1000) * material.density;
  return {
    massSolid,
    massUsed,
    usd: (massUsed / 1000) * material.usdPerKg,
    assumptions: `Stock block with 1 mm allowance per face, ${material.usdPerKg} USD/kg. Machine time is not estimated.`,
  };
}

function viktor(ctx: AgentContext): Finding[] {
  const { job, params, props, material } = ctx;
  const out: Finding[] = [];
  const holeId = job.roles.hole;
  if (holeId) {
    const d = params[holeId];
    const screw = nearestScrew(d);
    const target = screw.clearance.medium;
    if (Math.abs(d - target) > 0.011) {
      const trial = job.clamp({ ...params, [holeId]: target }).params;
      out.push({
        agent: 'viktor',
        id: 'clearance',
        severity: 'warn',
        title: `Hole ${f2(d)} mm fits no screw`,
        detail: `Nearest standard is the ${screw.name} clearance hole, ${target} mm.`,
        evidence: 'ISO 273, medium series.',
        fix:
          Math.abs(trial[holeId] - target) < 0.011
            ? { label: `Hole to ${target} mm (${screw.name})`, changes: { [holeId]: target }, expect: `Takes a standard ${screw.name} screw.` }
            : undefined,
      });
    } else {
      out.push({
        agent: 'viktor',
        id: 'clearance',
        severity: 'ok',
        title: `${screw.name} clearance hole`,
        detail: `Hole ${f2(d)} mm takes a standard ${screw.name} screw.`,
        evidence: 'ISO 273, medium series.',
      });
      const cbId = job.roles.cbore;
      const cbdId = job.roles.cboreDepth;
      if (cbId && cbdId && params[cbdId] > 1e-9) {
        const wantDepth = screw.headHeight + 0.4;
        const changes: Params = {};
        if (Math.abs(params[cbId] - screw.cbore) > 0.011) {
          changes[cbId] = screw.cbore;
        }
        if (Math.abs(params[cbdId] - wantDepth) > 0.011) {
          changes[cbdId] = wantDepth;
        }
        if (Object.keys(changes).length) {
          const trial = job.clamp({ ...params, ...changes }).params;
          const reachable = Object.keys(changes).every((k) => Math.abs(trial[k] - changes[k]) < 0.011);
          out.push({
            agent: 'viktor',
            id: 'counterbore',
            severity: 'warn',
            title: 'Counterbore is non-standard',
            detail: `A ${screw.name} socket head needs ${screw.cbore} mm wide and ${f1(wantDepth)} mm deep to sit flush.`,
            evidence: `ISO 4762 head ${screw.headDia} x ${screw.headHeight} mm; DIN 974-1 counterbore ${screw.cbore} mm.`,
            fix: reachable
              ? { label: `Counterbore ${screw.cbore} x ${f1(wantDepth)} mm`, changes, expect: `${screw.name} head sits flush.` }
              : undefined,
          });
        } else {
          out.push({
            agent: 'viktor',
            id: 'counterbore',
            severity: 'ok',
            title: `${screw.name} head sits flush`,
            detail: `Counterbore ${f1(params[cbId])} x ${f1(params[cbdId])} mm matches the socket head.`,
            evidence: `ISO 4762 head ${screw.headDia} x ${screw.headHeight} mm; DIN 974-1 counterbore ${screw.cbore} mm.`,
          });
        }
      }
    }
  }
  const cost = estimateCost(props, material, ctx.print ?? DEFAULT_PRINT);
  out.push({
    agent: 'viktor',
    id: 'cost',
    severity: 'info',
    title:
      material.process === 'fdm'
        ? `${f1(cost.massUsed)} g, about ${Math.max(1, Math.round(cost.minutes ?? 0))} min`
        : `${f1(cost.massSolid)} g from ${f1(cost.massUsed)} g stock`,
    detail: `Material about ${cost.usd.toFixed(2)} USD in ${material.name}. An estimate, not a quote.`,
    evidence: cost.assumptions,
  });
  return out;
}

/** One step of the structural agent's closed loop, reported while it runs. */
export interface ReinforceStep {
  step: number;
  params: Params;
  factor: number;
  /** What was changed to get here (empty for the starting state). */
  change: string;
}

/**
 * The structural agent's closed loop: test, and while the safety factor is
 * below target, apply its own fix, rebuild, and test again. The agent never
 * reports a fix as working on the strength of its estimate; only a re-test
 * counts. Stops when the target is met, when no parameter can grow further,
 * or after `maxSteps` changes.
 */
export function autoReinforce(
  job: Job,
  start: Params,
  material: Material,
  loadN: number,
  evaluate: (params: Params) => { props: KernelProps; stress: StressSummary },
  onStep?: (step: ReinforceStep) => void,
  maxSteps = 5,
): { steps: ReinforceStep[]; reached: boolean } {
  const steps: ReinforceStep[] = [];
  let params = { ...start };
  let change = '';
  for (let i = 0; i <= maxSteps; i++) {
    const { props, stress } = evaluate(params);
    const factor = safetyFactor(material, stress, loadN);
    const step: ReinforceStep = { step: i, params: { ...params }, factor, change };
    steps.push(step);
    onStep?.(step);
    if (factor >= TARGET_SF) {
      return { steps, reached: true };
    }
    const finding = marcus({ job, params, props, material, loadN, stress }).find((f) => f.fix);
    if (!finding?.fix || i === maxSteps) {
      return { steps, reached: false };
    }
    params = job.clamp({ ...params, ...finding.fix.changes }).params;
    change = finding.fix.label;
  }
  return { steps, reached: false };
}

/** Findings of all three agents, most severe first within each agent. */
export function runAgents(ctx: AgentContext): Finding[] {
  const order = (list: Finding[]): Finding[] =>
    list.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return [...order(marcus(ctx)), ...order(elena(ctx)), ...order(viktor(ctx))];
}

/** The most severe finding of one agent (what its chip shows). */
export function headline(findings: Finding[], agent: AgentId): Finding | undefined {
  return findings.find((f) => f.agent === agent);
}
