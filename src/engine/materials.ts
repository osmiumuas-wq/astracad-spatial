/**
 * Material data for the stress preview and the mass / cost estimate.
 *
 * These are typical handbook and datasheet values, not certified properties.
 * A printed part is weaker across its layers than the figure here, so every
 * safety factor the app shows is labelled as a preview. Prices are editable
 * assumptions, never quotes.
 */

import { Material } from './types.js';

export const MATERIALS: readonly Material[] = [
  {
    id: 'pla',
    name: 'PLA',
    E: 3500,
    nu: 0.36,
    yield: 50,
    density: 1.24,
    usdPerKg: 22,
    process: 'fdm',
    note: 'Typical datasheet values for moulded PLA; printed parts vary with layer direction.',
  },
  {
    id: 'petg',
    name: 'PETG',
    E: 2100,
    nu: 0.38,
    yield: 50,
    density: 1.27,
    usdPerKg: 24,
    process: 'fdm',
    note: 'Typical datasheet values; tougher than PLA, lower stiffness.',
  },
  {
    id: 'abs',
    name: 'ABS',
    E: 2200,
    nu: 0.35,
    yield: 40,
    density: 1.04,
    usdPerKg: 24,
    process: 'fdm',
    note: 'Typical datasheet values.',
  },
  {
    id: 'al6061',
    name: 'Aluminium 6061-T6',
    E: 68900,
    nu: 0.33,
    yield: 276,
    density: 2.7,
    usdPerKg: 6,
    process: 'cnc',
    note: 'Typical handbook values for 6061-T6 plate.',
  },
  {
    id: 'ti64',
    name: 'Titanium Ti-6Al-4V',
    E: 113800,
    nu: 0.342,
    yield: 880,
    density: 4.43,
    usdPerKg: 30,
    process: 'cnc',
    note: 'Typical handbook values for annealed Ti-6Al-4V (Grade 5).',
  },
  {
    id: 'ss304',
    name: 'Stainless 304',
    E: 193000,
    nu: 0.29,
    yield: 215,
    density: 8.0,
    usdPerKg: 5,
    process: 'cnc',
    note: 'Typical handbook values for annealed 304.',
  },
];

export const materialById = (id: string): Material =>
  MATERIALS.find((m) => m.id === id) ?? MATERIALS[0];

/**
 * Metric screw data used by the standards agent.
 * - clearance: ISO 273 clearance hole, fine / medium / coarse series, mm.
 * - headDia, headHeight: ISO 4762 socket head cap screw head, mm.
 * - cbore: DIN 974-1 series 1 counterbore diameter for that head, mm.
 */
export interface ScrewSize {
  name: string;
  d: number;
  clearance: { fine: number; medium: number; coarse: number };
  headDia: number;
  headHeight: number;
  cbore: number;
}

export const SCREWS: readonly ScrewSize[] = [
  { name: 'M3', d: 3, clearance: { fine: 3.2, medium: 3.4, coarse: 3.6 }, headDia: 5.5, headHeight: 3, cbore: 6.5 },
  { name: 'M4', d: 4, clearance: { fine: 4.3, medium: 4.5, coarse: 4.8 }, headDia: 7, headHeight: 4, cbore: 8 },
  { name: 'M5', d: 5, clearance: { fine: 5.3, medium: 5.5, coarse: 5.8 }, headDia: 8.5, headHeight: 5, cbore: 10 },
  { name: 'M6', d: 6, clearance: { fine: 6.4, medium: 6.6, coarse: 7 }, headDia: 10, headHeight: 6, cbore: 11 },
  { name: 'M8', d: 8, clearance: { fine: 8.4, medium: 9, coarse: 10 }, headDia: 13, headHeight: 8, cbore: 15 },
  { name: 'M10', d: 10, clearance: { fine: 10.5, medium: 11, coarse: 12 }, headDia: 16, headHeight: 10, cbore: 18 },
];

/** The screw whose ISO 273 medium clearance hole is nearest to a drilled diameter. */
export function nearestScrew(holeDiameter: number): ScrewSize {
  let best = SCREWS[0];
  for (const s of SCREWS) {
    if (Math.abs(s.clearance.medium - holeDiameter) < Math.abs(best.clearance.medium - holeDiameter)) {
      best = s;
    }
  }
  return best;
}
