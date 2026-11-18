// Flaws found by a feature sweep in the XR emulator (16-17 Nov 2026), each pinned so it cannot come back.
import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/engine/commands.js';
import { designJob, parseDesign } from '../src/engine/design.js';
import { CONFIRM_FLOOR, decide, MATCH_FLOOR } from '../src/engine/intents.js';
import { defaultParams, jobById } from '../src/engine/jobs.js';

describe('the intent model asks before a change it is not sure of', () => {
  it('a doubtful match for an intent that changes the part asks instead of acting', () => {
    // Measured scores of the misfires: "slice" -> stronger 0.44, "make it blue" -> grow 0.44,
    // "explode it" -> stronger 0.45, "make a gear" -> knob 0.40, "start over" -> undo 0.43.
    for (const [key, score] of [['act:stronger', 0.44], ['act:grow', 0.44], ['act:stronger', 0.45], ['knob', 0.4], ['act:undo', 0.43]] as const) {
      const u = decide([{ key, score }, { key: 'act:drawing', score: 0.2 }]);
      expect(u.kind, `${key} ${score}`).toBe('confirm');
    }
  });

  it('a clear match still acts, and a harmless action needs only the match floor', () => {
    expect(decide([{ key: 'act:stronger', score: CONFIRM_FLOOR + 0.01 }, { key: 'knob', score: 0.2 }]).kind).toBe('action');
    expect(decide([{ key: 'knob', score: 0.7 }, { key: 'hinge', score: 0.3 }]).kind).toBe('part');
    expect(decide([{ key: 'act:drawing', score: MATCH_FLOOR + 0.02 }, { key: 'knob', score: 0.2 }]).kind).toBe('action');
  });
});

describe('fillet and chamfer this edge need an edge where you point', () => {
  const p0 = designJob.clamp({ nf: 1, o0: 1, a0: 80, b0: 60, c0: 20 }).params;
  const noEdge = (): null => null;
  const anEdge = () => ({ a: [0, 20, 30] as [number, number, number], b: [10, 20, 30] as [number, number, number] });

  it('says so, and adds nothing, when no sharp edge is near the point', () => {
    for (const s of ['fillet this edge 2', 'chamfer this edge 1']) {
      const e = parseDesign(s, p0, [10, 20, 8], noEdge)!;
      expect(e.params.nf, s).toBe(p0.nf);
      expect(e.reply, s).toMatch(/^No sharp edge where you pointed/u);
    }
  });

  it('adds the feature when there is an edge, and asks the kernel the same reach (max 6, 2r)', () => {
    let reach = -1;
    const e = parseDesign('fillet this edge 5', p0, [10, 20, 30], (_at, r) => {
      reach = r ?? -1;
      return anEdge();
    })!;
    expect(e.params.nf).toBe(p0.nf + 1);
    expect(reach).toBe(10);
  });
});

describe('words the sweep found missing', () => {
  const job = jobById('design');
  const p = defaultParams(job);
  it('"slice" is the print preview; "slice it for my printer" is G-code', () => {
    expect(parseCommand('slice', job, p)).toMatchObject({ kind: 'action', action: 'print' });
    expect(parseCommand('slice it', job, p)).toMatchObject({ kind: 'action', action: 'print' });
    expect(parseCommand('slice it for my printer', job, p)).toMatchObject({ kind: 'action', action: 'gcode' });
    expect(parseCommand('make the g code', job, p)).toMatchObject({ kind: 'action', action: 'gcode' });
  });
  it('"share" is an action', () => {
    expect(parseCommand('share', job, p)).toMatchObject({ kind: 'action', action: 'share' });
  });
});

describe('"2 times thicker" scales the block instead of making a pattern', () => {
  const p0 = designJob.clamp({ nf: 1, o0: 1, a0: 80, b0: 60, c0: 20 }).params;
  it('scales the matching size of the base block', () => {
    expect(parseDesign('make it 2 times thicker', p0)).toMatchObject({ params: { nf: 1, a0: 80, b0: 60, c0: 40 } });
    expect(parseDesign('make it 1.5 times longer', p0)).toMatchObject({ params: { a0: 120, b0: 60, c0: 20 } });
    expect(parseDesign('make it twice as wide', p0)).toMatchObject({ params: { a0: 80, b0: 120, c0: 20 } });
    expect(parseDesign('make it 2 times thinner', p0)).toMatchObject({ params: { c0: 10 } });
    expect(parseDesign('make it 2 times bigger', p0)).toMatchObject({ params: { a0: 160, b0: 120, c0: 40 } });
  });
  it('a pattern is still a pattern', () => {
    expect(parseDesign('pattern 3 times 20 apart', p0)!.params.nf).toBe(2);
  });
});

describe('"two more bolts" only changes a count of bolts', () => {
  it('the cradle has no bolts: its held-height ratio is left alone', () => {
    const cradle = jobById('cradle');
    const u = parseCommand('two more bolts', cradle, defaultParams(cradle));
    expect(u.kind === 'edit' && 'hold' in u.changes).toBe(false);
  });
  it('the flange plate still gets two more bolts', () => {
    const flange = jobById('flange-plate');
    const p = { ...defaultParams(flange), N: 4 };
    expect(parseCommand('two more bolts', flange, p)).toMatchObject({ kind: 'edit', changes: { N: 6 } });
  });
});
