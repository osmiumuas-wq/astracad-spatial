/**
 * Physics-guided style (after MIT CSAIL's PhysiOpt idea: a look from words,
 * then physics keeps it strong). A style word reshapes the part through its
 * own sizes; the structure agent then grows only what the load needs, so the
 * look survives and the part still holds.
 */

import { Job, Params, paramDef } from './jobs.js';

export type Style = 'sleek' | 'rounded' | 'chunky' | 'minimal';

export const STYLE_WORDS: [RegExp, Style][] = [
  [/\b(sleek|slim|slender|elegant|streamlined)\b/u, 'sleek'],
  [/\b(round(ed|er)?|soft(er)?|organic|smooth)\b/u, 'rounded'],
  [/\b(chunky|sturdy|rugged|industrial|beefy|heavy duty)\b/u, 'chunky'],
  [/\b(minimal|minimalist|light(er)?weight|skeletal)\b/u, 'minimal'],
];

export function styleOf(text: string): Style | null {
  const t = text.toLowerCase();
  if (!/\b(style|look|make it|more|less|in a|give it)\b/u.test(t) && !/^\s*(sleek|rounded|chunky|minimal)\b/u.test(t)) return null;
  for (const [re, s] of STYLE_WORDS) if (re.test(t)) return s;
  return null;
}

/** The style's changes to the part's sizes (before the structure agent reinforces). */
export function styleParams(job: Job, params: Params, style: Style): Params {
  const out: Params = {};
  const scale = (id: string | undefined, k: number): void => {
    if (!id || !(id in params) || id in out) return;
    const d = paramDef(job, id);
    if (!d) return;
    out[id] = Math.min(d.max, Math.max(d.min, Math.round((params[id] * k) / d.step) * d.step));
  };
  const radius = job.params.find((d) => /radius/iu.test(d.label))?.id;
  const walls = [job.roles.wall, ...job.roles.stiffen].filter((id) => id !== radius);
  switch (style) {
    case 'sleek':
      walls.forEach((id) => scale(id, 0.7));
      scale(radius, 1.6);
      break;
    case 'rounded':
      scale(radius, 2.2);
      break;
    case 'chunky':
      walls.forEach((id) => scale(id, 1.4));
      scale(radius, 0.5);
      break;
    case 'minimal':
      walls.forEach((id) => scale(id, 0.6));
      break;
  }
  return out;
}
