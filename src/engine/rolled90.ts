// Rolled 90 + cut-down elbow: a full 90° elbow rolled θ below level, welded straight to an elbow cut down to θ,
// which brings the outlet back to level. All lengths in inches.
//   t = B·tan(θ/2)            take-off of the cut-down elbow (radius B)
//   L = A + t + g             travel between the two intersection points (A = full 90 radius, g = root gap)
//   D = L·sin θ, H = L·cos θ  drop and horizontal projection
import { CalcError } from './units';

const D2R = Math.PI / 180;

export interface Rolled90 { deg: number; rad: number; t: number; L: number; D: number; H: number }
export function rolled90(A: number, B: number, g: number, deg: number): Rolled90 {
  const rad = deg * D2R;
  const t = B * Math.tan(rad / 2);
  const L = A + t + g;
  return { deg, rad, t, L, D: L * Math.sin(rad), H: L * Math.cos(rad) };
}

/** Range of drops the pair can make over 1°–90° (max = A + B + g at 90°). */
export const rolled90Range = (A: number, B: number, g: number) => ({ dmin: rolled90(A, B, g, 1).D, dmax: rolled90(A, B, g, 90).D });

/** The roll angle that gives drop D. D(θ) = [A + B·tan(θ/2) + g]·sin θ rises steadily on 1°–90°, so bisection finds it. */
export function rolled90Angle(A: number, B: number, g: number, D: number): { deg: number; iterations: number; dmin: number; dmax: number } {
  const { dmin, dmax } = rolled90Range(A, B, g);
  if (D < dmin) throw new CalcError('GEOM', `That drop needs a roll of less than 1°. The smallest drop in range (θ = 1°) is ${dmin.toFixed(4)}".`);
  if (D > dmax) throw new CalcError('GEOM', `That drop is more than this pair can make. At θ = 90° the most it can drop is A + B + g = ${dmax.toFixed(4)}". Add straight pipe or use larger-radius fittings.`);
  let lo = 1, hi = 90, it = 0;
  while (hi - lo > 1e-12 && it < 200) { const m = (lo + hi) / 2; if (rolled90(A, B, g, m).D < D) lo = m; else hi = m; it++; }
  return { deg: (lo + hi) / 2, iterations: it, dmin, dmax };
}

/** Closed-form check when A = B = R and g = 0: θ = 45° − asin[(R − D)/(R√2)]. */
export function rolled90Shortcut(R: number, D: number): number {
  const x = (R - D) / (R * Math.SQRT2);
  if (x < -1 || x > 1) return NaN;
  return 45 - Math.asin(x) / D2R;
}

/** Marks for cutting the elbow down to θ: arc lengths from the factory end along the throat, centerline and heel. */
export function cutDownMarks(B: number, od: number, deg: number) {
  const r = deg * D2R, ri = B - od / 2, ro = B + od / 2;
  return { ri, ro, throat: ri * r, center: B * r, heel: ro * r };
}

/** Degrees as d° m′ s″. */
export function dms(deg: number): string {
  let d = Math.floor(deg), m = Math.floor((deg - d) * 60), s = Math.round(((deg - d) * 60 - m) * 60);
  if (s === 60) { s = 0; m++; } if (m === 60) { m = 0; d++; }
  return `${d}° ${m}′ ${s}″`;
}
