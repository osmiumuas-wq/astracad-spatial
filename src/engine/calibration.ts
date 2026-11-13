/**
 * Measurement calibration against an object of known size.
 *
 * A bank card's long edge is 85.60 mm (ISO/IEC 7810 ID-1), and almost everyone
 * has one. The user measures it three times or more; the mean error is this
 * person's bias for that method (finger span or two-hand tape) on this
 * headset, and the scatter is their repeatability. Later readings are
 * corrected by the bias and reported with a measured uncertainty, instead of
 * a fixed "+/- 0.2 mm" that nobody measured.
 */

/** Long edge of an ISO/IEC 7810 ID-1 card (bank card, ID card), mm. */
export const CARD_MM = 85.6;
export const CALIBRATION_READINGS = 3;

export interface Calibration {
  /** Mean reading minus the true size, mm. */
  bias: number;
  /** Standard deviation of the readings, mm. */
  sd: number;
  n: number;
  date: string;
}

export function calibrate(readings: number[], truth = CARD_MM, date = new Date().toISOString().slice(0, 10)): Calibration {
  const n = readings.length;
  if (n < 2) throw new Error('Calibration needs at least two readings.');
  const mean = readings.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(readings.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  return { bias: mean - truth, sd, n, date };
}

/**
 * Correct a reading by the calibrated bias. The uncertainty is two standard
 * deviations of: the person's repeatability, the reading's own sample spread,
 * and the uncertainty of the bias itself (sd / sqrt(n)).
 */
export function correct(value: number, spread: number, cal: Calibration): { value: number; uncertainty: number } {
  const u = 2 * Math.sqrt(cal.sd ** 2 + spread ** 2 + cal.sd ** 2 / cal.n);
  return { value: value - cal.bias, uncertainty: u };
}
