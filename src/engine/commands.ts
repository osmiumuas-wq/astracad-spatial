/**
 * Conversational commands: one sentence, typed or spoken, becomes an action.
 *
 *   "make the arm 20 mm longer"   relative edit of a named dimension
 *   "double the thickness"        scale a dimension
 *   "bore 8" / "set width to 30"  absolute edit
 *   "two more bolts"              counts
 *   "in aluminium"                material
 *   "test it", "show the drawing", "make it stronger", "undo" ...  actions
 *   anything naming a part        a new part ("Describe it")
 *
 * Deterministic word rules, no language model. Spoken numbers ("twenty five",
 * "two point five") are turned into digits first.
 */

import { Job, Params } from './jobs.js';
import { MATERIAL_WORDS, RULES } from './describe.js';

export type Action =
  | 'undo' | 'redo' | 'test' | 'stronger' | 'grow' | 'solid' | 'flow' | 'vibration' | 'drawing'
  | 'print' | 'save' | 'share' | 'measure' | 'laser' | 'capture' | 'sketch' | 'shape' | 'next' | 'swing' | 'help'
  | 'editable' | 'explode';

export type Command =
  | { kind: 'action'; action: Action; text: string }
  | { kind: 'material'; material: string; text: string }
  | { kind: 'edit'; changes: Params; text: string }
  | { kind: 'describe'; text: string }
  | { kind: 'unknown'; text: string };

const ACTIONS: [RegExp, Action][] = [
  [/\b(undo|go back|take that back)\b/u, 'undo'],
  [/\beditable\b|\breverse engineer\b/u, 'editable'],
  [/\bexplode\b|\bexploded\b|\bpull (it )?apart\b|\bcollapse\b|\bput (it )?back together\b/u, 'explode'],
  [/\bredo\b/u, 'redo'],
  [/\b(make it|make this) (stronger|hold|safer)\b|\breinforce\b|\bfix it\b/u, 'stronger'],
  [/\b(test|load test|stress test|will it hold|is it strong enough|push it)\b/u, 'test'],
  [/\b(grow|bone|lighter|lightweight|topology)\b/u, 'grow'],
  [/\b(back to solid|solid again)\b/u, 'solid'],
  [/\b(air ?flow|wind|aero)\b/u, 'flow'],
  [/\b(vibrat\w*|frequenc\w*|resonan\w*|modes?)\b/u, 'vibration'],
  [/\b(drawing|blueprint|drafting|three views?)\b/u, 'drawing'],
  [/\b(print preview|slice it|how long to print|print it)\b/u, 'print'],
  [/\bsave\b/u, 'save'],
  [/\bshare\b|\bqr\b/u, 'share'],
  [/\blaser\b/u, 'laser'],
  [/\bmeasure\b/u, 'measure'],
  [/\bcapture\b|\bscan\b/u, 'capture'],
  [/\bsketch\b|\bdraw (a|an|the)\b/u, 'sketch'],
  [/\bswing\b|\bopen the hinge\b/u, 'swing'],
  [/\bnext part\b/u, 'next'],
  [/\bshape mode\b|\bstop measuring\b/u, 'shape'],
  [/\b(help|what can i say)\b/u, 'help'],
];

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** "one hundred and twenty five point five" -> "125.5"; leaves other words alone. */
export function wordsToDigits(text: string): string {
  const tokens = text.toLowerCase().replace(/-/gu, ' ').split(/\s+/u);
  const out: string[] = [];
  let i = 0;
  const isNum = (w: string): boolean => w in UNITS || w in TENS || w === 'hundred' || w === 'thousand';
  while (i < tokens.length) {
    if (!isNum(tokens[i]) || (tokens[i] === 'hundred' || tokens[i] === 'thousand')) {
      out.push(tokens[i]);
      i++;
      continue;
    }
    let total = 0;
    let current = 0;
    while (i < tokens.length && (isNum(tokens[i]) || (tokens[i] === 'and' && i + 1 < tokens.length && isNum(tokens[i + 1])))) {
      const w = tokens[i];
      if (w in UNITS) current += UNITS[w];
      else if (w in TENS) current += TENS[w];
      else if (w === 'hundred') current = (current || 1) * 100;
      else if (w === 'thousand') {
        total += (current || 1) * 1000;
        current = 0;
      }
      i++;
    }
    let value = String(total + current);
    // "point five" / "point two five"
    if (tokens[i] === 'point' && i + 1 < tokens.length && tokens[i + 1] in UNITS) {
      i++;
      let frac = '';
      while (i < tokens.length && tokens[i] in UNITS && UNITS[tokens[i]] < 10) {
        frac += String(UNITS[tokens[i]]);
        i++;
      }
      value += `.${frac}`;
    }
    out.push(value);
  }
  return out.join(' ').replace(/\bmillimet(?:er|re)s?\b/gu, 'mm').replace(/\bdegrees?\b/gu, 'deg');
}

/** Which parameter of `job` a phrase names: rule words first, then the parameter's own label words. */
function paramNamed(job: Job, phrase: string): string | undefined {
  const rule = RULES[job.id];
  const candidates: [string, string[]][] = [];
  if (rule) for (const [id, words] of Object.entries(rule.words)) candidates.push([id, words]);
  for (const d of job.params) candidates.push([d.id, [d.label.toLowerCase(), ...d.label.toLowerCase().split(' ').filter((w) => w.length > 3)]]);
  if (job.id === 'sketch') candidates.push(['h', ['height', 'tall', 'thick(?:ness)?', 'high']]);
  let best: { id: string; at: number } | undefined;
  for (const [id, words] of candidates) {
    for (const w of words) {
      const m = new RegExp(String.raw`(?:^|[^a-z])(?:${w})s?(?![a-z])`, 'u').exec(phrase);
      if (m && (!best || m.index < best.at)) best = { id, at: m.index };
    }
    if (best?.id === id) break;
  }
  return best?.id;
}

const GROW = /\b(longer|wider|taller|higher|thicker|deeper|bigger|larger|more|increase|add|raise|up)\b/u;
const SHRINK = /\b(shorter|narrower|lower|thinner|shallower|smaller|less|fewer|decrease|reduce|remove|cut|down)\b/u;

/** Turn one sentence into a command for the current job. */
export function parseCommand(input: string, job: Job, params: Params): Command {
  const text = ` ${wordsToDigits(input).replace(/[.,!?]+(\s|$)/gu, ' ').replace(/\s+/gu, ' ').trim()} `;
  // A sentence naming a new part is a description, unless it is clearly an edit of this one.
  const action = ACTIONS.find(([re]) => re.test(text));
  const num = /(\d+(?:\.\d+)?)/u.exec(text);
  // "two more bolts" / "one fewer hole": a count, not a size (checked before sizes,
  // because "hole" also names the bolt-hole diameter).
  const count = job.params.find((d) => d.unit === '');
  if (count && /\b(bolts?|holes?|screws?|spokes?)\b/u.test(text) && num && !/\bmm\b/u.test(text)) {
    const v = Number(num[1]);
    const next = /\bmore\b/u.test(text) ? params[count.id] + v : /\b(fewer|less)\b/u.test(text) ? params[count.id] - v : v;
    return { kind: 'edit', changes: { [count.id]: next }, text: input };
  }
  // A comparative names its dimension when no dimension is named: "thicker" -> thickness.
  const COMPARATIVE: [RegExp, string][] = [
    [/\b(thicker|thinner)\b/u, 'thickness'],
    [/\b(longer|shorter)\b/u, 'length'],
    [/\b(wider|narrower)\b/u, 'width'],
    [/\b(taller|higher|lower)\b/u, 'height'],
    [/\b(deeper|shallower)\b/u, 'depth'],
  ];
  const implied = COMPARATIVE.find(([re]) => re.test(text))?.[1];
  const target = paramNamed(job, text) ?? (implied ? paramNamed(job, ` ${implied} `) : undefined);
  const editWords = GROW.test(text) || SHRINK.test(text) || /\b(set|make|change|double|twice|half|halve|to)\b/u.test(text);

  // Naming a part type without edit words asks for a new part ("a flange 90 diameter with a 30 bore");
  // with them it edits this one ("make the bracket arm 20 longer").
  const PART_NOUN = /\b(bracket|flange|knob|cradle|holder|tray|clip|stand|hinge|block|box|plate|bar|disc|disk|cylinder|puck|rod|spacer|cube)\b/u;
  if (PART_NOUN.test(text) && !editWords) return { kind: 'describe', text: wordsToDigits(input) };
  if (target && (num || /\b(double|twice|half|halve)\b/u.test(text))) {
    const cur = params[target];
    let next: number | undefined;
    if (/\b(double|twice)\b/u.test(text)) next = cur * 2;
    else if (/\b(half|halve)\b/u.test(text)) next = cur / 2;
    else if (num) {
      const v = Number(num[1]);
      const relative = /\bby\b/u.test(text) || GROW.test(text) || SHRINK.test(text);
      const pct = new RegExp(String.raw`${num[1]}\s*(?:%|percent)`, 'u').test(text);
      const delta = pct ? (cur * v) / 100 : v;
      if (relative && !/\bto\b/u.test(text)) next = SHRINK.test(text) ? cur - delta : cur + delta;
      else next = v;
    }
    if (next !== undefined && Number.isFinite(next)) return { kind: 'edit', changes: { [target]: next }, text: input };
  }
  if (action) return { kind: 'action', action: action[1], text: input };
  const mat = MATERIAL_WORDS.find(([re]) => re.test(text));
  if (mat && !/\b(bracket|flange|knob|cradle|clip|stand|hinge|block|box|plate|disc|cylinder)\b/u.test(text)) {
    return { kind: 'material', material: mat[1], text: input };
  }
  if (PART_NOUN.test(text)) return { kind: 'describe', text: wordsToDigits(input) };
  return { kind: 'unknown', text: input };
}

export const HELP =
  'Try: "make the arm 20 mm longer", "double the thickness", "bore 8", "two more bolts", "in aluminium", ' +
  '"test it", "make it stronger", "show the drawing", "air flow", "vibration", "undo", or describe a new part.';
