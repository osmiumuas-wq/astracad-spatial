/**
 * "Describe it": a plain-language part request becomes a part.
 *
 * Deterministic rules, no language model: keywords choose the part, numbers
 * attach to the dimension named next to them ("80 mm arm", "bore 22",
 * "thickness 4"), "60 x 40 x 20" fills a part's main sizes in order, an
 * M-size screw gives the medium clearance hole, and a material name sets the
 * material. Every key dimension the text did not give becomes a question
 * with a default, so nothing is silently invented.
 */

import { defaultParams, jobById, Params } from './jobs.js';
import { SCREWS } from './materials.js';

export interface Question {
  id: string;
  label: string;
  unit: string;
  value: number;
}

export interface Described {
  job: string;
  /** Parameters for the job (for 'sketch': the outline and height). */
  params: Params;
  material?: string;
  /** What was understood, in words, for the user to check. */
  understood: string[];
  /** Key dimensions the text did not give, with defaults. */
  ask: Question[];
  /** Shape for the sketch job: a block or a disc. */
  shape?: 'block' | 'disc';
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;

/** Split a request into clauses: "100 mm arm, 80 high with M5 screws" -> three. */
function clauses(text: string): string[] {
  return text
    .split(/,|;|\band\b|\bwith\b|\bon an?\b|\bfor an?\b|\busing\b/u)
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * The number in the same clause as one of the words, nearest to it ("80 mm
 * arm" and "arm of 80" both give 80). Screw sizes (M6) and A x B x C sizes
 * are not dimensions of their own and are skipped.
 */
function near(parts: string[], words: string[]): number | undefined {
  for (const w of words) {
    const re = new RegExp(String.raw`(?:^|[^a-z])(?:${w})s?(?![a-z])`, 'u');
    for (const c of parts) {
      const m = re.exec(c);
      if (!m) continue;
      const nums = [...c.matchAll(/(?<![a-z\d.])(\d+(?:\.\d+)?)/gu)].filter((n) => {
        const i = n.index ?? 0;
        // A size like "80 x 50": the x must stand alone, not end a word ("box 80").
        return !/^\s*(?:mm)?\s*(?:[x×*]|by)(?![a-z])/u.test(c.slice(i + n[0].length)) && !/(?:^|[^a-z])(?:[x×*]|by)\s*$/u.test(c.slice(0, i));
      });
      if (!nums.length) continue;
      nums.sort((a, b) => Math.abs((a.index ?? 0) - m.index) - Math.abs((b.index ?? 0) - m.index));
      return Number(nums[0][1]);
    }
  }
  return undefined;
}

function triple(text: string): number[] | undefined {
  const m = new RegExp(String.raw`${NUM}\s*(?:mm)?\s*(?:[x×*]|by)\s*${NUM}\s*(?:mm)?(?:\s*(?:[x×*]|by)\s*${NUM})?`, 'u').exec(text);
  if (!m) return undefined;
  return [m[1], m[2], m[3]].filter((v) => v !== undefined).map(Number);
}

function screw(text: string): { name: string; clearance: number } | undefined {
  const m = /\bm(\d+)\b/u.exec(text);
  if (!m) return undefined;
  const s = SCREWS.find((x) => x.d === Number(m[1]));
  return s ? { name: s.name, clearance: s.clearance.medium } : undefined;
}

export const MATERIAL_WORDS: [RegExp, string][] = [
  [/\bpla\b/u, 'pla'],
  [/\bpetg\b/u, 'petg'],
  [/\babs\b/u, 'abs'],
  [/\balumin(?:i)?um\b|\b6061\b/u, 'al6061'],
  [/\btitanium\b|\bti-?6al-?4v\b|\bti64\b|grade 5/u, 'ti64'],
  [/\bstainless\b|\bsteel\b|\b304\b/u, 'ss304'],
];

export const JOB_WORDS: [RegExp, string][] = [
  [/\bhinge\b/u, 'hinge'],
  [/\bproject box\b|\benclosure\b|\b(?:box|case)\b.*\b(?:hollow|open|rounded|walls?)\b/u, 'project-box'],
  [/\b(?:pull|drawer|door|cabinet) handle\b|\bhandle\b|\bpull\b/u, 'pull-handle'],
  [/\bfoot\b|\bfeet\b|\bleg tip\b|\btapered\b/u, 'tapered-foot'],
  [/\bknob\b|\bdial cap\b/u, 'knob'],
  [/\bflange\b|\bbolt circle\b|\bpcd\b/u, 'flange-plate'],
  [/\b(?:phone|tablet)\b.*\bstand\b|\bstand\b.*\b(?:phone|tablet)\b/u, 'phone-stand'],
  [/\bcradle\b|\bholder\b|\btray\b|\bnest\b|\bdock\b/u, 'cradle'],
  [/\bclip\b/u, 'fit-clip'],
  [/\bbracket\b|\bshelf support\b/u, 'wall-bracket'],
  [/\bcylinder\b|\bdis[ck]\b|\bpuck\b|\brod\b|\bround\b/u, 'sketch:disc'],
  [/\bblock\b|\bbox\b|\bplate\b|\bbar\b|\bslab\b|\bcube\b|\bspacer\b/u, 'sketch:block'],
];

/** Per job: dimension words for each parameter, the order "A x B x C" fills, and what to ask if missing. */
export const RULES: Record<string, { words: Record<string, string[]>; triple?: string[]; key: string[] }> = {
  cradle: {
    words: { L: ['length', 'long'], W: ['width', 'wide'], H: ['height', 'high', 'tall', 'thick(?:ness)?'], clr: ['clearance', 'gap'], t: ['wall'], floor: ['floor', 'base'] },
    triple: ['L', 'W', 'H'],
    key: ['L', 'W', 'H'],
  },
  'fit-clip': {
    words: { gap: ['opening', 'grip', 'gap', 'pipe', 'tube', 'cable', 'dia(?:meter)?'], reach: ['arm', 'reach', 'length', 'long'], t: ['wall', 'thick(?:ness)?'], w: ['width', 'wide'] },
    key: ['gap'],
  },
  'phone-stand': {
    words: { slot: ['slot', 'phone thickness', 'thick(?:ness)?'], tilt: ['angle', 'tilt', 'lean', 'deg(?:rees?)?'], H: ['height', 'high', 'tall', 'back'], w: ['width', 'wide'] },
    key: ['slot'],
  },
  'wall-bracket': {
    words: { arm: ['arm', 'reach', 'depth', 'deep', 'length', 'long', 'shelf'], height: ['height', 'high', 'tall', 'plate'], w: ['width', 'wide'], t: ['thick(?:ness)?', 'wall'], g: ['gusset', 'rib'] },
    triple: ['arm', 'height', 'w'],
    key: ['arm', 'height'],
  },
  'flange-plate': {
    words: { D: ['outer diameter', 'od', 'dia(?:meter)?', 'across', 'ø', '⌀'], B: ['bore', 'centre hole', 'center hole', 'id', 'middle hole'], th: ['thick(?:ness)?', 'thick'], N: ['holes', 'bolts', 'screws', 'x m\\d+'], bcd: ['bolt circle', 'pcd', 'pitch circle'] },
    key: ['D', 'B'],
  },
  knob: {
    words: { bore: ['shaft', 'bore', 'spindle'], D: ['dia(?:meter)?', 'grip', 'across', 'ø', '⌀'], H: ['height', 'high', 'tall'], depth: ['depth', 'deep'] },
    key: ['bore', 'D'],
  },
  hinge: {
    words: { L: ['length', 'long'], W: ['width', 'wide', 'leaf'], t: ['thick(?:ness)?'], c: ['clearance', 'gap'] },
    triple: ['L', 'W', 't'],
    key: ['L'],
  },
  'project-box': {
    words: { W: ['width', 'wide', 'long', 'length'], D: ['depth', 'deep'], H: ['height', 'high', 'tall'], t: ['wall', 'thick(?:ness)?'], r: ['corners?', 'radius', 'round(?:ed)?'] },
    triple: ['W', 'D', 'H'],
    key: ['W', 'D', 'H'],
  },
  'pull-handle': {
    words: { S: ['spacing', 'centres', 'centers', 'between', 'apart', 'holes', 'screws', 'long', 'length'], h: ['stand-?off', 'clearance', 'deep', 'depth', 'out'], d: ['bar', 'dia(?:meter)?', 'thick(?:ness)?', 'rod'], R: ['bend', 'radius'] },
    key: ['S'],
  },
  'tapered-foot': {
    words: { D: ['base', 'bottom', 'floor'], d: ['top', 'leg'], H: ['height', 'high', 'tall'] },
    key: ['D', 'd', 'H'],
  },
};

export function describe(input: string): Described | { error: string } {
  // Commas stay: they separate the clauses the numbers belong to.
  const text = ` ${input.toLowerCase().replace(/\s+/gu, ' ')} `;
  const parts = clauses(text);
  const hit = JOB_WORDS.find(([re]) => re.test(text));
  if (!hit) {
    return { error: 'Which part? Try: bracket, flange, knob, cradle, clip, phone stand, hinge, project box, pull handle, foot, block or disc.' };
  }
  const understood: string[] = [];
  const material = MATERIAL_WORDS.find(([re]) => re.test(text))?.[1];
  const s = screw(text);

  if (hit[1].startsWith('sketch:')) {
    const shape = hit[1] === 'sketch:disc' ? 'disc' : 'block';
    const t3 = triple(text);
    const ask: Question[] = [];
    const params: Params = {};
    if (shape === 'block') {
      let [x, y, h]: (number | undefined)[] = t3 ?? [];
      x ??= near(parts, ['length', 'long']);
      y ??= near(parts, ['width', 'wide']);
      h ??= near(parts, ['height', 'high', 'tall', 'thick(?:ness)?']);
      if (x === undefined) ask.push({ id: 'x', label: 'Length', unit: 'mm', value: 60 });
      if (y === undefined) ask.push({ id: 'y', label: 'Width', unit: 'mm', value: 40 });
      if (h === undefined) ask.push({ id: 'h', label: 'Height', unit: 'mm', value: 10 });
      Object.assign(params, blockParams(x ?? 60, y ?? 40), { h: h ?? 10 });
      if (x !== undefined && y !== undefined) understood.push(`Block ${x} x ${y} mm`);
      if (h !== undefined) understood.push(`Height ${h} mm`);
    } else {
      let d = near(parts, ['dia(?:meter)?', 'across', 'ø', '⌀']);
      const r = near(parts, ['radius']);
      if (d === undefined && r !== undefined) d = 2 * r;
      const h = near(parts, ['height', 'high', 'tall', 'thick(?:ness)?', 'long', 'length']);
      if (d === undefined) ask.push({ id: 'd', label: 'Diameter', unit: 'mm', value: 40 });
      if (h === undefined) ask.push({ id: 'h', label: 'Height', unit: 'mm', value: 10 });
      Object.assign(params, { kind: 1, cx: 0, cy: 0, r: (d ?? 40) / 2, h: h ?? 10 });
      if (d !== undefined) understood.push(`Diameter ${d} mm`);
      if (h !== undefined) understood.push(`Height ${h} mm`);
    }
    if (material) understood.push(`Material ${material}`);
    return { job: 'sketch', params, material, understood, ask, shape };
  }

  const jobId = hit[1];
  const job = jobById(jobId);
  const rule = RULES[jobId];
  const params: Params = { ...defaultParams(job) };
  const given = new Set<string>();
  const t3 = rule.triple ? triple(text) : undefined;
  if (t3 && rule.triple) {
    t3.forEach((v, i) => {
      const id = rule.triple?.[i];
      if (id) {
        params[id] = v;
        given.add(id);
      }
    });
  }
  for (const [id, words] of Object.entries(rule.words)) {
    if (given.has(id)) continue;
    const v = near(parts, words);
    if (v !== undefined) {
      params[id] = v;
      given.add(id);
    }
  }
  // Screw size: the clearance hole on parts that have one.
  if (s) {
    const holeId = jobId === 'flange-plate' || jobId === 'wall-bracket' ? 'd' : undefined;
    if (holeId) {
      params[holeId] = s.clearance;
      given.add(holeId);
      understood.push(`${s.name} screws: ${s.clearance} mm clearance hole`);
    }
    // "6 x M6" counts bolts on a flange.
    const count = new RegExp(String.raw`(\d+)\s*[x×]\s*m\d+`, 'u').exec(text);
    if (count && jobId === 'flange-plate') {
      params.N = Number(count[1]);
      given.add('N');
    }
  }
  for (const id of given) {
    const def = job.params.find((d) => d.id === id);
    if (def && !(s && id === 'd')) understood.push(`${def.label} ${params[id]}${def.unit ? ` ${def.unit}` : ''}`);
  }
  if (material) understood.push(`Material ${material}`);
  const ask = rule.key
    .filter((id) => !given.has(id))
    .map((id) => {
      const def = job.params.find((d) => d.id === id);
      return { id, label: def?.label ?? id, unit: def?.unit ?? 'mm', value: params[id] };
    });
  return { job: jobId, params, material, understood, ask };
}

/** A centred rectangle outline for the sketch job. */
export function blockParams(x: number, y: number): Params {
  return { kind: 0, n: 4, x0: -x / 2, y0: -y / 2, x1: x / 2, y1: -y / 2, x2: x / 2, y2: y / 2, x3: -x / 2, y3: y / 2 };
}

/** Put the answers to the questions into the parameters. */
export function answer(d: Described, answers: Record<string, number>): Params {
  const p: Params = { ...d.params };
  if (d.job === 'sketch' && d.shape === 'block') {
    const x = answers.x ?? Math.abs(p.x1 - p.x0);
    const y = answers.y ?? Math.abs(p.y2 - p.y1);
    Object.assign(p, blockParams(x, y));
    if (answers.h !== undefined) p.h = answers.h;
    return p;
  }
  if (d.job === 'sketch' && d.shape === 'disc') {
    if (answers.d !== undefined) p.r = answers.d / 2;
    if (answers.h !== undefined) p.h = answers.h;
    return p;
  }
  return { ...p, ...answers };
}
