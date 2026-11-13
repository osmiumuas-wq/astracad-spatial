/**
 * A part as a link. The job id, material and parameter values go into the URL
 * fragment, so the QR code on the bench opens the same part on a phone or PC
 * with no server involved: the page rebuilds it and runs the truth gate again.
 */

import { Job, jobById, JOBS, Params } from './jobs.js';
import { materialById, MATERIALS } from './materials.js';

export interface SharedPart {
  job: Job;
  material: string;
  params: Params;
}

const trim = (v: number): string => String(Math.round(v * 1000) / 1000);

/** Fragment (without the leading #) for a part. */
export function encodeShare(part: { job: string; material: string; params: Params }): string {
  const job = jobById(part.job);
  const values = job.params.map((d) => trim(part.params[d.id] ?? d.value)).join('_');
  return `p=${job.id}.${part.material}.${values}`;
}

/** Read a fragment. Unknown jobs or malformed values give null, never a guessed part. */
export function decodeShare(fragment: string): SharedPart | null {
  const m = /(?:^|[#&])p=([a-z0-9-]+)\.([a-z0-9]+)\.([0-9._-]+)/iu.exec(fragment);
  if (!m) {
    return null;
  }
  const job = JOBS.find((j) => j.id === m[1]);
  if (!job || !MATERIALS.some((x) => x.id === m[2])) {
    return null;
  }
  const raw = m[3].split('_').map(Number);
  if (raw.length !== job.params.length || raw.some((v) => !Number.isFinite(v))) {
    return null;
  }
  const params: Params = {};
  job.params.forEach((d, i) => {
    params[d.id] = raw[i];
  });
  return { job, material: materialById(m[2]).id, params: job.clamp(params).params };
}
