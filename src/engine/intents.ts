/**
 * What a free-form sentence can mean, for the on-device language model.
 *
 * The word rules (commands.ts, describe.ts) understand sentences that use the
 * app's own words. For everything else ("something to stop my table
 * wobbling", "is it strong enough"), a small sentence-embedding transformer
 * (all-MiniLM-L6-v2, run on the device) compares the sentence with the
 * phrasings below and picks the closest intent. It only chooses *what* is
 * meant; every number still comes from the user's own words through the word
 * rules, so the model can never invent a dimension. When two intents are
 * nearly tied, the app asks instead of guessing.
 */

import { Action } from './commands.js';

export interface Intent {
  /** A job id, or "act:<action>". */
  key: string;
  /** How the app names it back to the user. */
  label: string;
  /** For a part: the words the description rules recognise, put in front of the sentence. */
  noun?: string;
  phrases: string[];
}

export const INTENTS: Intent[] = [
  { key: 'wall-bracket', label: 'a wall bracket', noun: 'bracket', phrases: ['a bracket to hold up a shelf', 'shelf support on the wall', 'something that sticks out of the wall to carry weight', 'an L bracket', 'hang something heavy on the wall'] },
  { key: 'flange-plate', label: 'a flange plate', noun: 'flange', phrases: ['a flange with bolt holes', 'a round plate that bolts onto a pipe', 'mounting plate with a bolt circle'] },
  { key: 'knob', label: 'a knob', noun: 'knob', phrases: ['a knob for a shaft', 'a dial cap for a potentiometer', 'a handle that twists on a spindle', 'replacement cap for a volume control'] },
  { key: 'cradle', label: 'a cradle', noun: 'cradle', phrases: ['a holder that something sits in', 'a tray shaped to an object', 'a dock or nest for a device', 'a place for something to rest'] },
  { key: 'fit-clip', label: 'a clip', noun: 'clip', phrases: ['a clip that snaps onto a pipe or edge', 'a cable clip', 'something that grips the edge of a desk', 'hold a wire in place'] },
  { key: 'phone-stand', label: 'a phone stand', noun: 'phone stand', phrases: ['a stand for my phone', 'something to prop up a tablet', 'a phone holder for the desk', 'lean my phone so I can watch it'] },
  { key: 'hinge', label: 'a hinge', noun: 'hinge', phrases: ['a hinge', 'two leaves that pivot', 'a door that swings open on a pin', 'a lid that flips open'] },
  { key: 'project-box', label: 'a project box', noun: 'project box', phrases: ['an enclosure for electronics', 'a box to keep a circuit board in', 'a case for a gadget', 'an open box with walls', 'housing for a microcontroller board'] },
  { key: 'pull-handle', label: 'a pull handle', noun: 'pull handle', phrases: ['a drawer handle', 'a pull for a cabinet door', 'a grab bar to pull', 'something to open a drawer with'] },
  { key: 'tapered-foot', label: 'a tapered foot', noun: 'tapered foot', phrases: ['a foot for a table leg', 'something under furniture so it stands level', 'a leg tip that is wider at the floor', 'stop furniture from wobbling', 'a pad under a chair leg'] },
  { key: 'act:test', label: 'a load test', phrases: ['test it', 'is it strong enough', 'will it break under load', 'check the strength', 'push on it and see if it holds'] },
  { key: 'act:measure', label: 'measuring', phrases: ['measure something', 'take a measurement of a real object', 'how big is this thing', 'measure my phone with my fingers'] },
  { key: 'act:drawing', label: 'the drawing', phrases: ['show the drawing', 'make a technical drawing', 'show me the plans', 'blueprint with dimensions'] },
  { key: 'act:save', label: 'saving', phrases: ['save it', 'keep this part', 'put it on my shelf', 'keep it for later'] },
  { key: 'act:undo', label: 'undo', phrases: ['undo that', 'go back', 'revert the last change', 'take that back'] },
  { key: 'act:flow', label: 'the air-flow preview', phrases: ['show the air flow', 'how does wind go around it', 'what happens when air blows on it'] },
  { key: 'act:vibration', label: 'vibration modes', phrases: ['how does it vibrate', 'show the vibration modes', 'natural frequency', 'will it rattle or resonate'] },
  { key: 'act:grow', label: 'growing bone (lighter shape)', phrases: ['make it lighter', 'optimise the shape', 'grow bone', 'remove material where it is not needed', 'use less plastic'] },
  { key: 'act:stronger', label: 'making it stronger', phrases: ['make it stronger', 'reinforce it', 'it is too weak', 'beef it up'] },
  { key: 'act:print', label: 'the print preview', phrases: ['how will it print', 'show the print preview', 'how long to print'] },
  { key: 'act:share', label: 'sharing', phrases: ['share it with a friend', 'send this part to my phone', 'get a link'] },
];

/** Below this cosine similarity nothing is a match. */
export const MATCH_FLOOR = 0.33;
/** Two intents closer than this are a tie: ask rather than guess. */
export const TIE_MARGIN = 0.03;
/**
 * An intent that changes or replaces the part (a new part, make it stronger, grow bone, undo) needs this
 * similarity to act; below it the app asks first. Measured on the shipped model: right paraphrases of these
 * intents score 0.36-0.49 or above 0.5, and wrong single words land in the same 0.40-0.45 band ("slice" ->
 * stronger 0.44, "make it blue" -> grow 0.44, "make a gear" -> knob 0.40), so below 0.5 a guess could
 * silently change the part.
 */
export const CONFIRM_FLOOR = 0.5;
/** Intents that change or replace the part, so a doubtful match asks before acting. */
const CHANGES_PART = new Set(['act:stronger', 'act:grow', 'act:undo']);

export type Understood =
  | { kind: 'none' }
  | { kind: 'tie'; a: Intent; b: Intent }
  | { kind: 'confirm'; intent: Intent; score: number }
  | { kind: 'part'; intent: Intent; score: number }
  | { kind: 'action'; intent: Intent; action: Action; score: number };

/** Decide from per-intent best similarities (any order). */
export function decide(scores: { key: string; score: number }[]): Understood {
  const ranked = [...scores].sort((x, y) => y.score - x.score);
  const top = ranked[0];
  if (!top || top.score < MATCH_FLOOR) return { kind: 'none' };
  const intent = INTENTS.find((i) => i.key === top.key);
  if (!intent) return { kind: 'none' };
  const second = ranked[1];
  if (second && top.score - second.score < TIE_MARGIN) {
    const other = INTENTS.find((i) => i.key === second.key);
    if (other) return { kind: 'tie', a: intent, b: other };
  }
  const changes = !intent.key.startsWith('act:') || CHANGES_PART.has(intent.key);
  if (changes && top.score < CONFIRM_FLOOR) return { kind: 'confirm', intent, score: top.score };
  if (intent.key.startsWith('act:')) return { kind: 'action', intent, action: intent.key.slice(4) as Action, score: top.score };
  return { kind: 'part', intent, score: top.score };
}

/** Every phrase with its intent key, in a fixed order (embedded once). */
export function catalogue(): { key: string; text: string }[] {
  return INTENTS.flatMap((i) => i.phrases.map((text) => ({ key: i.key, text })));
}
