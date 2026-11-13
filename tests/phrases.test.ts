/**
 * Phrase corpus: sentences people might say or type at the bench, each with
 * the result the command engine should give. The test reports the hit rate
 * and lists every miss, then requires all of them to pass.
 */

import { describe, expect, it } from 'vitest';
import { Command, parseCommand } from '../src/engine/commands.js';
import { defaultParams, jobById, Params } from '../src/engine/jobs.js';

type Expect =
  | { kind: 'edit'; changes: Params }
  | { kind: 'action'; action: string }
  | { kind: 'material'; material: string }
  | { kind: 'describe' }
  | { kind: 'unknown' };

const P = (job: string, over: Params = {}): Params => ({ ...defaultParams(jobById(job)), ...over });

// [job, parameter overrides, sentence, expected]
const CORPUS: [string, Params, string, Expect][] = [
  // wall bracket: arm 80, height 60?, t 4 (overrides make the arithmetic explicit)
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'make the arm 20 mm longer', { kind: 'edit', changes: { arm: 100 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'arm 20 longer', { kind: 'edit', changes: { arm: 100 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'lengthen the arm by ten', { kind: 'edit', changes: { arm: 90 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'shorten the arm by 15 mm', { kind: 'edit', changes: { arm: 65 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'set the arm to 120', { kind: 'edit', changes: { arm: 120 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'arm length one hundred and ten', { kind: 'edit', changes: { arm: 110 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'make it longer by 5', { kind: 'edit', changes: { arm: 85 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'double the thickness', { kind: 'edit', changes: { t: 8 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'half the thickness', { kind: 'edit', changes: { t: 2 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'make it 1 mm thicker', { kind: 'edit', changes: { t: 5 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'thicker by 2 millimetres', { kind: 'edit', changes: { t: 6 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'two point five millimetres thinner', { kind: 'edit', changes: { t: 1.5 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'make it twenty five percent thicker', { kind: 'edit', changes: { t: 5 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'wall 3', { kind: 'edit', changes: { t: 3 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'width 40', { kind: 'edit', changes: { w: 40 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'make it 10 mm wider', { kind: 'edit', changes: { w: 35 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'narrower by five', { kind: 'edit', changes: { w: 20 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'make it taller by 20', { kind: 'edit', changes: { height: 80 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'plate height 90', { kind: 'edit', changes: { height: 90 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'gusset 20', { kind: 'edit', changes: { g: 20 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'bigger gusset by 6', { kind: 'edit', changes: { g: 20 } }],
  ['wall-bracket', { arm: 80, height: 60, t: 4, w: 25, g: 14 }, 'screw hole 5.5', { kind: 'edit', changes: { d: 5.5 } }],
  // flange plate
  ['flange-plate', { D: 70, B: 22, th: 8, N: 4, bcd: 50, d: 5.2 }, 'bore 8', { kind: 'edit', changes: { B: 8 } }],
  ['flange-plate', { D: 70, B: 22, th: 8, N: 4, bcd: 50, d: 5.2 }, 'make the bore 30 mm', { kind: 'edit', changes: { B: 30 } }],
  ['flange-plate', { D: 70, B: 22, th: 8, N: 4, bcd: 50, d: 5.2 }, 'bore twenty five millimetres', { kind: 'edit', changes: { B: 25 } }],
  ['flange-plate', { D: 70, B: 22, th: 8, N: 4, bcd: 50, d: 5.2 }, 'bigger bore by 4', { kind: 'edit', changes: { B: 26 } }],
  ['flange-plate', { D: 70, B: 22, th: 8, N: 4, bcd: 50, d: 5.2 }, 'two more bolts', { kind: 'edit', changes: { N: 6 } }],
  ['flange-plate', { D: 70, B: 22, th: 8, N: 4, bcd: 50, d: 5.2 }, 'one fewer hole', { kind: 'edit', changes: { N: 3 } }],
  ['flange-plate', { D: 70, B: 22, th: 8, N: 4, bcd: 50, d: 5.2 }, '6 bolts', { kind: 'edit', changes: { N: 6 } }],
  ['flange-plate', { D: 70, B: 22, th: 8, N: 4, bcd: 50, d: 5.2 }, 'eight holes', { kind: 'edit', changes: { N: 8 } }],
  ['flange-plate', { D: 70, B: 22, th: 8, N: 4, bcd: 50, d: 5.2 }, 'outer diameter 90', { kind: 'edit', changes: { D: 90 } }],
  ['flange-plate', { D: 70, B: 22, th: 8, N: 4, bcd: 50, d: 5.2 }, 'diameter 100', { kind: 'edit', changes: { D: 100 } }],
  ['flange-plate', { D: 70, B: 22, th: 8, N: 4, bcd: 50, d: 5.2 }, 'thickness 10', { kind: 'edit', changes: { th: 10 } }],
  ['flange-plate', { D: 70, B: 22, th: 8, N: 4, bcd: 50, d: 5.2 }, 'make it 2 mm thicker', { kind: 'edit', changes: { th: 10 } }],
  ['flange-plate', { D: 70, B: 22, th: 8, N: 4, bcd: 50, d: 5.2 }, 'bolt circle 60', { kind: 'edit', changes: { bcd: 60 } }],
  ['flange-plate', { D: 70, B: 22, th: 8, N: 4, bcd: 50, d: 5.2 }, 'pcd 55', { kind: 'edit', changes: { bcd: 55 } }],
  ['flange-plate', { D: 70, B: 22, th: 8, N: 4, bcd: 50, d: 5.2 }, 'bolt hole 6.6', { kind: 'edit', changes: { d: 6.6 } }],
  ['flange-plate', { D: 70, B: 22, th: 8, N: 4, bcd: 50, d: 5.2 }, 'counterbore 11', { kind: 'edit', changes: { cb: 11 } }],
  // knob
  ['knob', { bore: 6, depth: 12, D: 30, H: 20, c: 2 }, 'shaft 8', { kind: 'edit', changes: { bore: 8 } }],
  ['knob', { bore: 6, depth: 12, D: 30, H: 20, c: 2 }, 'make the shaft bore 6.35', { kind: 'edit', changes: { bore: 6.35 } }],
  ['knob', { bore: 6, depth: 12, D: 30, H: 20, c: 2 }, 'grip diameter 40', { kind: 'edit', changes: { D: 40 } }],
  ['knob', { bore: 6, depth: 12, D: 30, H: 20, c: 2 }, 'make it 5 mm taller', { kind: 'edit', changes: { H: 25 } }],
  ['knob', { bore: 6, depth: 12, D: 30, H: 20, c: 2 }, 'height 30', { kind: 'edit', changes: { H: 30 } }],
  ['knob', { bore: 6, depth: 12, D: 30, H: 20, c: 2 }, 'bore depth 15', { kind: 'edit', changes: { depth: 15 } }],
  ['knob', { bore: 6, depth: 12, D: 30, H: 20, c: 2 }, 'chamfer 3', { kind: 'edit', changes: { c: 3 } }],
  // cradle
  ['cradle', { L: 75, W: 40, H: 12, clr: 0.4, t: 2, floor: 2 }, 'length 80', { kind: 'edit', changes: { L: 80 } }],
  ['cradle', { L: 75, W: 40, H: 12, clr: 0.4, t: 2, floor: 2 }, 'make it 5 mm longer', { kind: 'edit', changes: { L: 80 } }],
  ['cradle', { L: 75, W: 40, H: 12, clr: 0.4, t: 2, floor: 2 }, 'width 45', { kind: 'edit', changes: { W: 45 } }],
  ['cradle', { L: 75, W: 40, H: 12, clr: 0.4, t: 2, floor: 2 }, 'clearance 0.6', { kind: 'edit', changes: { clr: 0.6 } }],
  ['cradle', { L: 75, W: 40, H: 12, clr: 0.4, t: 2, floor: 2 }, 'more clearance by 0.2', { kind: 'edit', changes: { clr: 0.6 } }],
  ['cradle', { L: 75, W: 40, H: 12, clr: 0.4, t: 2, floor: 2 }, 'wall 3', { kind: 'edit', changes: { t: 3 } }],
  ['cradle', { L: 75, W: 40, H: 12, clr: 0.4, t: 2, floor: 2 }, 'floor 4', { kind: 'edit', changes: { floor: 4 } }],
  ['cradle', { L: 75, W: 40, H: 12, clr: 0.4, t: 2, floor: 2 }, 'object height 15', { kind: 'edit', changes: { H: 15 } }],
  // fit clip
  ['fit-clip', { gap: 20, reach: 30, t: 3, w: 15, r: 2, lip: 1 }, 'opening 22', { kind: 'edit', changes: { gap: 22 } }],
  ['fit-clip', { gap: 20, reach: 30, t: 3, w: 15, r: 2, lip: 1 }, 'grip opening 25 mm', { kind: 'edit', changes: { gap: 25 } }],
  ['fit-clip', { gap: 20, reach: 30, t: 3, w: 15, r: 2, lip: 1 }, 'arm length 40', { kind: 'edit', changes: { reach: 40 } }],
  ['fit-clip', { gap: 20, reach: 30, t: 3, w: 15, r: 2, lip: 1 }, 'width 20', { kind: 'edit', changes: { w: 20 } }],
  ['fit-clip', { gap: 20, reach: 30, t: 3, w: 15, r: 2, lip: 1 }, 'snap lip 2', { kind: 'edit', changes: { lip: 2 } }],
  ['fit-clip', { gap: 20, reach: 30, t: 3, w: 15, r: 2, lip: 1 }, 'corner radius 3', { kind: 'edit', changes: { r: 3 } }],
  // phone stand
  ['phone-stand', { slot: 10, tilt: 15, H: 60, w: 70, lipH: 12, front: 10, floor: 5, back: 5 }, 'slot 12', { kind: 'edit', changes: { slot: 12 } }],
  ['phone-stand', { slot: 10, tilt: 15, H: 60, w: 70, lipH: 12, front: 10, floor: 5, back: 5 }, 'angle 20 degrees', { kind: 'edit', changes: { tilt: 20 } }],
  ['phone-stand', { slot: 10, tilt: 15, H: 60, w: 70, lipH: 12, front: 10, floor: 5, back: 5 }, 'lean it back by five degrees', { kind: 'edit', changes: { tilt: 20 } }],
  ['phone-stand', { slot: 10, tilt: 15, H: 60, w: 70, lipH: 12, front: 10, floor: 5, back: 5 }, 'back height 80', { kind: 'edit', changes: { H: 80 } }],
  ['phone-stand', { slot: 10, tilt: 15, H: 60, w: 70, lipH: 12, front: 10, floor: 5, back: 5 }, 'width 90', { kind: 'edit', changes: { w: 90 } }],
  // hinge
  ['hinge', { L: 48, W: 24, t: 4, c: 0.4 }, 'hinge length 60', { kind: 'edit', changes: { L: 60 } }],
  ['hinge', { L: 48, W: 24, t: 4, c: 0.4 }, 'clearance 0.3', { kind: 'edit', changes: { c: 0.3 } }],
  ['hinge', { L: 48, W: 24, t: 4, c: 0.4 }, 'leaf width 30', { kind: 'edit', changes: { W: 30 } }],
  ['hinge', { L: 48, W: 24, t: 4, c: 0.4 }, 'make it thicker by one', { kind: 'edit', changes: { t: 5 } }],
  // air sketch / captured part
  ['sketch', {}, 'height 30', { kind: 'edit', changes: { h: 30 } }],
  ['sketch', {}, 'make it 10 mm taller', { kind: 'edit', changes: { h: 20 } }],
  ['sketch', {}, 'double the height', { kind: 'edit', changes: { h: 20 } }],
  // actions
  ['wall-bracket', {}, 'undo', { kind: 'action', action: 'undo' }],
  ['wall-bracket', {}, 'undo that', { kind: 'action', action: 'undo' }],
  ['wall-bracket', {}, 'go back', { kind: 'action', action: 'undo' }],
  ['wall-bracket', {}, 'redo', { kind: 'action', action: 'redo' }],
  ['wall-bracket', {}, 'test it', { kind: 'action', action: 'test' }],
  ['wall-bracket', {}, 'run the load test', { kind: 'action', action: 'test' }],
  ['wall-bracket', {}, 'will it hold', { kind: 'action', action: 'test' }],
  ['wall-bracket', {}, 'is it strong enough', { kind: 'action', action: 'test' }],
  ['wall-bracket', {}, 'make it stronger', { kind: 'action', action: 'stronger' }],
  ['wall-bracket', {}, 'reinforce it', { kind: 'action', action: 'stronger' }],
  ['wall-bracket', {}, 'fix it', { kind: 'action', action: 'stronger' }],
  ['wall-bracket', {}, 'make it lighter', { kind: 'action', action: 'grow' }],
  ['wall-bracket', {}, 'grow the bone structure', { kind: 'action', action: 'grow' }],
  ['wall-bracket', {}, 'back to solid', { kind: 'action', action: 'solid' }],
  ['wall-bracket', {}, 'show the air flow', { kind: 'action', action: 'flow' }],
  ['wall-bracket', {}, 'wind tunnel', { kind: 'action', action: 'flow' }],
  ['wall-bracket', {}, 'what are the natural frequencies', { kind: 'action', action: 'vibration' }],
  ['wall-bracket', {}, 'show vibration modes', { kind: 'action', action: 'vibration' }],
  ['wall-bracket', {}, 'show me the drawing', { kind: 'action', action: 'drawing' }],
  ['wall-bracket', {}, 'make a blueprint', { kind: 'action', action: 'drawing' }],
  ['wall-bracket', {}, 'print preview', { kind: 'action', action: 'print' }],
  ['wall-bracket', {}, 'how long to print', { kind: 'action', action: 'print' }],
  ['wall-bracket', {}, 'save it', { kind: 'action', action: 'save' }],
  ['wall-bracket', {}, 'share', { kind: 'action', action: 'share' }],
  ['wall-bracket', {}, 'measure', { kind: 'action', action: 'measure' }],
  ['wall-bracket', {}, 'laser tape', { kind: 'action', action: 'laser' }],
  ['wall-bracket', {}, 'capture an object', { kind: 'action', action: 'capture' }],
  ['wall-bracket', {}, 'scan this', { kind: 'action', action: 'capture' }],
  ['wall-bracket', {}, 'next part', { kind: 'action', action: 'next' }],
  ['hinge', {}, 'swing the hinge', { kind: 'action', action: 'swing' }],
  ['hinge', {}, 'pull it apart', { kind: 'action', action: 'explode' }],
  ['hinge', {}, 'exploded view', { kind: 'action', action: 'explode' }],
  ['wall-bracket', {}, 'make it editable', { kind: 'action', action: 'editable' }],
  ['wall-bracket', {}, 'help', { kind: 'action', action: 'help' }],
  ['wall-bracket', {}, 'what can I say', { kind: 'action', action: 'help' }],
  // materials
  ['wall-bracket', {}, 'in aluminium', { kind: 'material', material: 'al6061' }],
  ['wall-bracket', {}, 'make it in aluminum', { kind: 'material', material: 'al6061' }],
  ['wall-bracket', {}, 'use PETG', { kind: 'material', material: 'petg' }],
  ['wall-bracket', {}, 'switch to ABS', { kind: 'material', material: 'abs' }],
  ['wall-bracket', {}, 'titanium please', { kind: 'material', material: 'ti64' }],
  ['wall-bracket', {}, 'stainless steel', { kind: 'material', material: 'ss304' }],
  ['wall-bracket', {}, 'back to PLA', { kind: 'material', material: 'pla' }],
  // new parts
  ['wall-bracket', {}, 'a flange 90 diameter with a 30 bore', { kind: 'describe' }],
  ['wall-bracket', {}, 'knob for a 6 mm shaft', { kind: 'describe' }],
  ['wall-bracket', {}, 'cradle for a 75 by 40 by 12 phone', { kind: 'describe' }],
  ['wall-bracket', {}, 'I need a block 60 x 40 x 20', { kind: 'describe' }],
  ['wall-bracket', {}, 'disc fifty across, six thick', { kind: 'describe' }],
  ['flange-plate', {}, 'new wall bracket 120 arm', { kind: 'describe' }],
  ['wall-bracket', {}, 'a clip for a 20 mm pipe', { kind: 'describe' }],
  ['wall-bracket', {}, 'phone stand for a tablet', { kind: 'describe' }],
  ['wall-bracket', {}, 'print in place hinge 60 long', { kind: 'describe' }],
  ['wall-bracket', {}, 'cylinder 30 diameter 50 tall', { kind: 'describe' }],
  // should not be understood
  ['wall-bracket', {}, 'hello there', { kind: 'unknown' }],
  ['wall-bracket', {}, 'what time is it', { kind: 'unknown' }],
  ['wall-bracket', {}, 'tell me a joke', { kind: 'unknown' }],
  ['wall-bracket', {}, 'um', { kind: 'unknown' }],
  ['wall-bracket', {}, 'thanks', { kind: 'unknown' }],
  ['wall-bracket', {}, 'that looks nice', { kind: 'unknown' }],
  ['wall-bracket', {}, 'who made this', { kind: 'unknown' }],
  ['wall-bracket', {}, 'play some music', { kind: 'unknown' }],
  ['wall-bracket', {}, 'okay', { kind: 'unknown' }],
  ['wall-bracket', {}, 'never mind', { kind: 'unknown' }],
];

function matches(got: Command, want: Expect): boolean {
  if (got.kind !== want.kind) return false;
  if (want.kind === 'edit' && got.kind === 'edit') {
    return Object.entries(want.changes).every(([k, v]) => Math.abs((got.changes[k] ?? NaN) - v) < 1e-6) &&
      Object.keys(got.changes).length === Object.keys(want.changes).length;
  }
  if (want.kind === 'action' && got.kind === 'action') return got.action === want.action;
  if (want.kind === 'material' && got.kind === 'material') return got.material === want.material;
  return true;
}

describe('phrase corpus', () => {
  it(`understands every sentence (${CORPUS.length} sentences)`, () => {
    const misses: string[] = [];
    for (const [job, over, text, want] of CORPUS) {
      const j = jobById(job);
      const got = parseCommand(text, j, P(job, over));
      if (!matches(got, want)) misses.push(`${job}: "${text}" -> ${JSON.stringify(got)} (wanted ${JSON.stringify(want)})`);
    }
    const rate = ((CORPUS.length - misses.length) / CORPUS.length) * 100;
    // eslint-disable-next-line no-console
    console.log(`PHRASES ${CORPUS.length - misses.length}/${CORPUS.length} (${rate.toFixed(1)} %)\n${misses.join('\n')}`);
    expect(misses).toEqual([]);
  });
});
