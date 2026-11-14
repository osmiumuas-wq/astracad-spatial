// The three parts built with fillet + shell, sweep and loft can be described in a sentence.
import { describe as suite, expect, it } from 'vitest';
import { describe } from '../src/engine/describe.js';

suite('describing the new parts', () => {
  it('a project box', () => {
    const d = describe('a project box 80 wide, 50 deep, 30 high with a 2 mm wall');
    expect('error' in d ? d.error : d.job).toBe('project-box');
    if (!('error' in d)) expect([d.params.W, d.params.D, d.params.H, d.params.t]).toEqual([80, 50, 30, 2]);
  });
  it('a drawer handle', () => {
    const d = describe('drawer handle with 128 mm spacing, 12 mm bar');
    expect('error' in d ? d.error : d.job).toBe('pull-handle');
    if (!('error' in d)) expect([d.params.S, d.params.d]).toEqual([128, 12]);
  });
  it('sizes written with "by"', () => {
    const d = describe('a project box 90 by 65 by 30');
    expect('error' in d ? d.error : [d.params.W, d.params.D, d.params.H]).toEqual([90, 65, 30]);
  });
  it('a tapered foot', () => {
    const d = describe('tapered foot, base 50, top 32, 25 tall');
    expect('error' in d ? d.error : d.job).toBe('tapered-foot');
    if (!('error' in d)) expect([d.params.D, d.params.d, d.params.H]).toEqual([50, 32, 25]);
  });
});
