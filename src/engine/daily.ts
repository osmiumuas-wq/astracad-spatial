/**
 * The daily job: one small engineering brief per calendar day, the same for
 * everyone on that date. Met when the saved part passed the truth gate, was
 * load-tested at the brief's load with a safety factor of at least 2, and
 * weighs no more than the brief allows.
 */

import { jobById, Job } from './jobs.js';

export interface DailyBrief {
  date: string;
  job: Job;
  material: string;
  loadN: number;
  maxGrams: number;
  text: string;
}

const BRIEFS: { job: string; material: string; loadN: number; maxGrams: number; text: string }[] = [
  { job: 'wall-bracket', material: 'petg', loadN: 80, maxGrams: 16, text: 'Shelf bracket: hold 80 N in PETG under 16 g.' },
  { job: 'fit-clip', material: 'pla', loadN: 15, maxGrams: 6, text: 'Desk clip: take 15 N at the tip in PLA under 6 g.' },
  { job: 'phone-stand', material: 'pla', loadN: 12, maxGrams: 40, text: 'Phone stand: carry 12 N on the back in PLA under 40 g.' },
  { job: 'flange-plate', material: 'al6061', loadN: 2000, maxGrams: 60, text: 'Flange: 2 kN axial in aluminium under 60 g.' },
  { job: 'cradle', material: 'petg', loadN: 40, maxGrams: 30, text: 'Cradle: 40 N on the rim in PETG under 30 g.' },
  { job: 'knob', material: 'abs', loadN: 30, maxGrams: 12, text: 'Knob: 30 N side load in ABS under 12 g.' },
];

export function dailyBrief(date: string): DailyBrief {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  const b = BRIEFS[((day % BRIEFS.length) + BRIEFS.length) % BRIEFS.length];
  return { date, job: jobById(b.job), material: b.material, loadN: b.loadN, maxGrams: b.maxGrams, text: b.text };
}

export function dailyMet(
  brief: DailyBrief,
  part: { job: string; material: string; grams: number; verified: boolean; factorAtLoad: number | null; testedLoad: number },
): { met: boolean; reason: string } {
  if (part.job !== brief.job.id) return { met: false, reason: `Today's job is the ${brief.job.title.toLowerCase()}.` };
  if (part.material !== brief.material) return { met: false, reason: 'Wrong material for today.' };
  if (!part.verified) return { met: false, reason: 'The part must pass the truth gate.' };
  if (part.factorAtLoad === null || part.testedLoad < brief.loadN - 1e-6) {
    return { met: false, reason: `Test it at ${brief.loadN} N first.` };
  }
  if (part.factorAtLoad < 2) return { met: false, reason: `Safety factor ${part.factorAtLoad.toFixed(2)} is under 2.` };
  if (part.grams > brief.maxGrams) {
    return { met: false, reason: `${part.grams.toFixed(1)} g is over ${brief.maxGrams} g.` };
  }
  return { met: true, reason: 'Daily job met.' };
}
