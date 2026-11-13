import { describe, expect, it } from 'vitest';
import { parseCommand, wordsToDigits } from '../src/engine/commands.js';
import { defaultParams, jobById } from '../src/engine/jobs.js';

const bracket = jobById('wall-bracket');
const flange = jobById('flange-plate');
const bp = { ...defaultParams(bracket), arm: 80, t: 4 };
const fp = { ...defaultParams(flange), N: 4, B: 22 };

describe('voice and typed commands', () => {
  it('turns spoken numbers into digits', () => {
    expect(wordsToDigits('make it one hundred and twenty five millimeters')).toBe('make it 125 mm');
    expect(wordsToDigits('two point five')).toBe('2.5');
    expect(wordsToDigits('twenty')).toBe('20');
  });

  it('edits a named dimension relatively and absolutely', () => {
    expect(parseCommand('make the arm 20 mm longer', bracket, bp)).toEqual({ kind: 'edit', changes: { arm: 100 }, text: 'make the arm 20 mm longer' });
    expect(parseCommand('arm shorter by 10', bracket, bp)).toMatchObject({ changes: { arm: 70 } });
    expect(parseCommand('set the arm to 120', bracket, bp)).toMatchObject({ changes: { arm: 120 } });
    expect(parseCommand('double the thickness', bracket, bp)).toMatchObject({ changes: { t: 8 } });
    expect(parseCommand('make it ten percent thicker', bracket, bp)).toMatchObject({ changes: { t: 4.4 } });
    expect(parseCommand('bore 8', flange, fp)).toMatchObject({ changes: { B: 8 } });
    expect(parseCommand('Bore twenty five millimetres.', flange, fp)).toMatchObject({ changes: { B: 25 } });
  });

  it('changes counts', () => {
    expect(parseCommand('two more bolts', flange, fp)).toMatchObject({ changes: { N: 6 } });
    expect(parseCommand('one fewer hole', flange, fp)).toMatchObject({ changes: { N: 3 } });
  });

  it('recognises actions, materials and new parts', () => {
    expect(parseCommand('test it', bracket, bp)).toMatchObject({ kind: 'action', action: 'test' });
    expect(parseCommand('will it hold?', bracket, bp)).toMatchObject({ action: 'test' });
    expect(parseCommand('make it stronger', bracket, bp)).toMatchObject({ action: 'stronger' });
    expect(parseCommand('show me the drawing', bracket, bp)).toMatchObject({ action: 'drawing' });
    expect(parseCommand('undo', bracket, bp)).toMatchObject({ action: 'undo' });
    expect(parseCommand('in aluminium please', bracket, bp)).toMatchObject({ kind: 'material', material: 'al6061' });
    expect(parseCommand('a flange ninety diameter with a thirty bore', bracket, bp)).toMatchObject({ kind: 'describe' });
    expect(parseCommand('hello there', bracket, bp)).toMatchObject({ kind: 'unknown' });
    // Naming the part with edit words edits it rather than starting over.
    expect(parseCommand('make the bracket arm 20 longer', bracket, bp)).toMatchObject({ kind: 'edit', changes: { arm: 100 } });
    expect(parseCommand('a flange 90 diameter with a 30 bore', flange, fp)).toMatchObject({ kind: 'describe' });
  });
});
