/**
 * Explore: a small, honest design-space study around the current part (the
 * idea behind generative-design studies in desktop CAD, kept to what can be
 * verified on a headset). The two parameters that matter most for strength
 * (the job's structural roles) are varied over a 3 x 2 grid; every variant is
 * then built, verified by the truth gate and stress-solved by the caller.
 * Variants that no other variant beats on both mass and safety factor form the
 * Pareto front: the honest "best trade-offs".
 */

import { Job, Params, paramDef } from './jobs.js';

export interface Variant {
  params: Params;
  /** What changed, for the label: "Gusset 20, Wall 5". */
  label: string;
}

export interface Scored {
  mass: number;
  factor: number;
}

const GRID_A = [0.7, 1, 1.45];
const GRID_B = [0.8, 1.3];

function snap(job: Job, id: string, value: number): number {
  const d = paramDef(job, id);
  if (!d) return value;
  const v = Math.min(d.max, Math.max(d.min, value));
  return Math.round(v / d.step) * d.step;
}

/** The parameters Explore varies: the two most effective structural ones (or one and the wall). */
export function exploreAxes(job: Job): string[] {
  const ids: string[] = [];
  for (const id of [...job.roles.stiffen, job.roles.wall]) {
    if (id && !ids.includes(id) && paramDef(job, id)) ids.push(id);
  }
  return ids.slice(0, 2);
}

/** Up to six distinct variants around the current parameters. */
export function variants(job: Job, params: Params): Variant[] {
  const [a, b] = exploreAxes(job);
  if (!a) return [];
  const out: Variant[] = [];
  const seen = new Set<string>();
  for (const fa of GRID_A) {
    for (const fb of b ? GRID_B : [1]) {
      const p: Params = { ...params, [a]: snap(job, a, params[a] * fa) };
      if (b) p[b] = snap(job, b, params[b] * fb);
      const key = `${p[a]}|${b ? p[b] : ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const fmt = (id: string): string => {
        const d = paramDef(job, id)!;
        return `${d.label} ${+p[id].toFixed(2)}`;
      };
      out.push({ params: p, label: b ? `${fmt(a)}, ${fmt(b)}` : fmt(a) });
    }
  }
  return out;
}

/** Indices of the variants on the Pareto front: lighter is better, a higher safety factor is better. */
export function paretoFront(items: Scored[]): number[] {
  const front: number[] = [];
  items.forEach((p, i) => {
    const dominated = items.some(
      (q, j) => j !== i && q.mass <= p.mass && q.factor >= p.factor && (q.mass < p.mass || q.factor > p.factor),
    );
    if (!dominated) front.push(i);
  });
  return front;
}
