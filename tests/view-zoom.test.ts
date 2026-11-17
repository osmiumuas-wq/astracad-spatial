import { describe, expect, it } from 'vitest';
import { clampZoom, nextZoom, parseZoom, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, zoomReply } from '../src/app/view-zoom.js';

describe('view zoom by voice and hand', () => {
  it('true size in every phrasing', () => {
    for (const s of ['true size', 'show it at actual size', 'life size please', 'one to one', 'zoom 1:1', 'reset zoom', 'Full size']) {
      expect(parseZoom(s), s).toEqual({ abs: 1 });
    }
  });

  it('steps, explicit zooms and the ribbon toggle', () => {
    expect(parseZoom('zoom in')).toEqual({ factor: ZOOM_STEP });
    expect(parseZoom('zoom out')).toEqual({ factor: 1 / ZOOM_STEP });
    expect(parseZoom('zoom 2 times')).toEqual({ abs: 2 });
    expect(parseZoom('zoom two times')).toEqual({ abs: 2 });
    expect(parseZoom('zoom to 3x')).toEqual({ abs: 3 });
    expect(parseZoom('zoom 150 percent')).toEqual({ abs: 1.5 });
    expect(parseZoom('toggle zoom')).toEqual({ toggle: true });
  });

  it('leaves part edits and other commands alone', () => {
    for (const s of ['add a box 40 by 30 by 10', 'make it 2 times thicker', 'scale 2', 'size 20', 'drill a 5 mm hole here', 'flange 25 at 45', 'test it', 'zoom']) {
      expect(parseZoom(s), s).toBeNull();
    }
  });

  it('clamps to the view range and toggles between true size and double', () => {
    expect(clampZoom(10)).toBe(ZOOM_MAX);
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(nextZoom(1, { factor: ZOOM_STEP })).toBeCloseTo(1.5, 12);
    expect(nextZoom(3.5, { factor: ZOOM_STEP })).toBe(ZOOM_MAX);
    expect(nextZoom(2.7, { abs: 1 })).toBe(1);
    expect(nextZoom(1, { toggle: true })).toBe(2);
    expect(nextZoom(2, { toggle: true })).toBe(1);
    expect(nextZoom(0.6, { toggle: true })).toBe(1);
  });

  it('says what it did, and that the dimensions are unchanged', () => {
    expect(zoomReply(1)).toMatch(/^True size: 1 mm on the bench is 1 mm in your room\./u);
    expect(zoomReply(2)).toMatch(/2 times larger than true size; the part's dimensions are unchanged/u);
    expect(zoomReply(0.5)).toMatch(/2 times smaller than true size/u);
  });
});
