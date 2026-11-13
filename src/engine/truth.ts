/**
 * Truth gate: a part is "verified" only when independent routes to the same
 * number agree. A check that cannot be made is reported as not verifiable; it
 * is never counted as passed. A failed check refuses the model and records why.
 */

import { Expectation } from './expect.js';
import { Box3, KernelProps } from './types.js';

/** Acceptance tolerance on relative volume error (exact-geometry class). */
export const VOLUME_TOL = 1e-5;

export type CheckStatus = 'pass' | 'fail' | 'na';

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  /** Short human-readable evidence: the numbers compared. */
  detail: string;
  /** Relative or absolute difference, when one was measured. */
  delta?: number;
  tol?: number;
}

export type Verdict = 'verified' | 'kernel-only' | 'refused';

export interface GateResult {
  verdict: Verdict;
  checks: Check[];
  /** First failing reason, for the refusal banner. */
  reason?: string;
}

export interface GateInput {
  props: KernelProps;
  /** Generic closed-form expectation derived from the specification. */
  generic: Expectation;
  /** Closed-form volume written by hand for this job, if it has one. */
  jobVolume?: number;
  /** Closed-form bounding box and the tessellation allowance on it, mm. */
  jobBox?: { box: Box3; tol: number };
  jobGenus?: number;
}

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
const sci = (v: number): string => (v === 0 ? '0' : v.toExponential(1));
const mm3 = (v: number): string => v.toFixed(3);

export function runGate(input: GateInput): GateResult {
  const { props, generic } = input;
  const checks: Check[] = [];

  const sound =
    props.status === 'NoError' && props.components === 1 && props.volume > 0;
  checks.push({
    id: 'solid',
    label: 'Watertight single solid',
    status: sound ? 'pass' : 'fail',
    detail: sound
      ? `1 body, ${props.triangles} triangles, kernel status ${props.status}`
      : `status ${props.status}, ${props.components} bodies, volume ${mm3(props.volume)}`,
  });

  const second = rel(props.volumeCheck, props.volume);
  checks.push({
    id: 'reintegrate',
    label: 'Volume re-integrated from triangles',
    status: second <= VOLUME_TOL ? 'pass' : 'fail',
    detail: `kernel ${mm3(props.volume)} vs own integral ${mm3(props.volumeCheck)} mm3`,
    delta: second,
    tol: VOLUME_TOL,
  });

  if (generic.volume !== null) {
    const d = rel(props.volume, generic.volume);
    checks.push({
      id: 'closed-form',
      label: 'Closed form (Green, Pappus, cylinders)',
      status: d <= VOLUME_TOL ? 'pass' : 'fail',
      detail: `expected ${mm3(generic.volume)} vs kernel ${mm3(props.volume)} mm3, diff ${sci(d)}`,
      delta: d,
      tol: VOLUME_TOL,
    });
  } else {
    checks.push({
      id: 'closed-form',
      label: 'Closed form (Green, Pappus, cylinders)',
      status: 'na',
      detail: generic.reason ?? 'no closed form',
    });
  }

  if (input.jobVolume !== undefined) {
    const d = rel(props.volume, input.jobVolume);
    checks.push({
      id: 'job-formula',
      label: 'Hand-derived formula for this part',
      status: d <= VOLUME_TOL ? 'pass' : 'fail',
      detail: `expected ${mm3(input.jobVolume)} vs kernel ${mm3(props.volume)} mm3, diff ${sci(d)}`,
      delta: d,
      tol: VOLUME_TOL,
    });
  }

  if (input.jobBox) {
    const { box, tol } = input.jobBox;
    let worst = 0;
    for (let i = 0; i < 3; i++) {
      worst = Math.max(
        worst,
        Math.abs(props.bbox.min[i] - box.min[i]),
        Math.abs(props.bbox.max[i] - box.max[i]),
      );
    }
    checks.push({
      id: 'bbox',
      label: 'Bounding box',
      status: worst <= tol ? 'pass' : 'fail',
      detail: `largest face offset ${worst.toFixed(4)} mm, allowance ${tol.toFixed(4)} mm`,
      delta: worst,
      tol,
    });
  } else {
    checks.push({
      id: 'bbox',
      label: 'Bounding box',
      status: 'na',
      detail: 'no closed-form box for this part',
    });
  }

  if (input.jobGenus !== undefined) {
    checks.push({
      id: 'genus',
      label: 'Through-openings (genus)',
      status: props.genus === input.jobGenus ? 'pass' : 'fail',
      detail: `expected ${input.jobGenus}, kernel ${props.genus}`,
    });
  }

  const failed = checks.find((c) => c.status === 'fail');
  if (failed) {
    return { verdict: 'refused', checks, reason: `${failed.label}: ${failed.detail}` };
  }
  const provedByForm = checks.some(
    (c) => (c.id === 'closed-form' || c.id === 'job-formula') && c.status === 'pass',
  );
  return { verdict: provedByForm ? 'verified' : 'kernel-only', checks };
}
