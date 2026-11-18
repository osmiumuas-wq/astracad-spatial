/**
 * The bench view's zoom, by hand and voice as well as by the desktop wheel. At zoom 1 the part is at its true
 * size (1 mm of the part is 1 mm in the room); the zoom only changes how large it is shown, never its
 * dimensions.
 *
 *   "true size" / "actual size" / "life size" / "one to one" / "1:1"   zoom 1
 *   "zoom in" / "zoom closer"                                          x1.5
 *   "zoom out"                                                         /1.5
 *   "zoom 2 times" / "zoom to 2x" / "zoom 150 percent"                 that zoom
 *   "toggle zoom" (the ribbon button)                                  1 <-> 2
 *   "fit view" / "zoom to fit"                                         fit footprint to the bench
 */

import { wordsToDigits } from '../engine/commands.js';

export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 4;
/** One "zoom in" or "zoom out" step. */
export const ZOOM_STEP = 1.5;

export type ZoomRequest = { abs: number } | { factor: number } | { toggle: true } | { fit: true };

/** Target footprint: 80% of the 260 mm diameter turntable. */
export const FIT_SPAN_MM = 208;

export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** The zoom a sentence asks for, or null when it is not about the view's zoom. */
export function parseZoom(sentence: string): ZoomRequest | null {
  const t = wordsToDigits(sentence).toLowerCase();
  if (/\btoggle (the )?zoom\b/u.test(t)) return { toggle: true };
  if (/\bfit (the )?view\b|\bzoom to fit\b/u.test(t)) return { fit: true };
  if (/\b(true|actual|real|life|full)[ -]?size\b|\bone to one\b|\b1\s*(?::|to)\s*1\b|\b(reset|normal) zoom\b|\bzoom (reset|normal)\b/u.test(t)) {
    return { abs: 1 };
  }
  if (!/\bzoom\b/u.test(t)) return null;
  const pct = t.match(/\bzoom\b.*?(\d+(?:\.\d+)?)\s*(%|percent)/u);
  if (pct) return { abs: parseFloat(pct[1]) / 100 };
  const times = t.match(/\bzoom\b.*?(\d+(?:\.\d+)?)\s*(x|times)\b/u);
  if (times) return { abs: parseFloat(times[1]) };
  if (/\bzoom (in|closer)\b/u.test(t)) return { factor: ZOOM_STEP };
  if (/\bzoom (out|away)\b/u.test(t)) return { factor: 1 / ZOOM_STEP };
  return null;
}

/** The zoom after a request, from the current zoom (clamped to the view's range). */
export function nextZoom(current: number, req: ZoomRequest): number {
  if ('toggle' in req) return Math.abs(current - 1) < 0.01 ? 2 : 1;
  if ('fit' in req) return clampZoom(current);
  return clampZoom('abs' in req ? req.abs : current * req.factor);
}

/** Return a zoom that fits the part's horizontal X/Z footprint within the bench target span. */
function footprintSpan(widthMm: number, heightMm: number, depthMm: number): number {
  if (![widthMm, heightMm, depthMm].every(Number.isFinite) || widthMm < 0 || heightMm < 0 || depthMm < 0) {
    return Number.NaN;
  }
  return Math.hypot(widthMm, depthMm);
}

export function fitZoom(widthMm: number, heightMm: number, depthMm: number): number {
  const span = footprintSpan(widthMm, heightMm, depthMm);
  if (!Number.isFinite(span) || span <= 0) return 1;
  return clampZoom(FIT_SPAN_MM / span);
}

export function fitReply(widthMm: number, heightMm: number, depthMm: number, zoom: number): string {
  const span = footprintSpan(widthMm, heightMm, depthMm);
  const fits = Number.isFinite(span) && span * zoom <= FIT_SPAN_MM + 1e-6;
  return fits
    ? `Fit view: adjusted the part to the bench view (${zoom.toFixed(2)}×). Its dimensions are unchanged.`
    : `Fit view reached the ${zoom.toFixed(2)}× zoom limit; this large part may extend beyond the bench. Its dimensions are unchanged.`;
}

/** What the app says after a zoom. */
export function zoomReply(zoom: number): string {
  if (Math.abs(zoom - 1) < 0.005) return 'True size: 1 mm on the bench is 1 mm in your room.';
  const s = zoom >= 1 ? `${+zoom.toFixed(2)} times larger than true size` : `${+(1 / zoom).toFixed(2)} times smaller than true size`;
  return `Shown ${s}; the part's dimensions are unchanged. Say "true size" to go back.`;
}
