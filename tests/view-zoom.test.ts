import { describe, expect, it } from 'vitest';
import { clampZoom, fitReply, fitZoom, nextZoom, parseZoom, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, zoomReply } from '../src/app/view-zoom.js';

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

  it('fits the part footprint to the bench span within the supported zoom range', () => {
    expect(parseZoom('fit view')).toEqual({ fit: true });
    expect(parseZoom('zoom to fit')).toEqual({ fit: true });
    expect(fitZoom(100, 80, 60)).toBeCloseTo(208 / Math.hypot(100, 60), 12);
    expect(fitZoom(400, 300, 200)).toBeCloseTo(208 / Math.hypot(400, 200), 12);
    expect(fitZoom(1000, 700, 400)).toBe(ZOOM_MIN);
    expect(fitZoom(20, 1000, 20)).toBe(4);
    expect(fitZoom(0, 0, 0)).toBe(1);
    expect(fitZoom(Number.NaN, 20, 10)).toBe(1);
    expect(fitZoom(-10, 20, 10)).toBe(1);
    expect(fitReply(100, 80, 60, fitZoom(100, 80, 60))).toContain('dimensions are unchanged');
    expect(fitReply(1000, 700, 400, ZOOM_MIN)).toContain('may extend beyond the bench');
    expect(fitReply(100, Number.NaN, 60, 1)).toContain('may extend beyond the bench');
  });

  it('leaves part edits and other commands alone', () => {
    for (const s of ['add a box 40 by 30 by 10', 'make it 2 times thicker', 'scale 2', 'size 20', 'drill a 5 mm hole here', 'flange 25 at 45', 'test it', 'zoom', 'make a part that fits the phone']) {
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
