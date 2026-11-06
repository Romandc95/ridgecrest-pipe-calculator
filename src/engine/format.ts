// Display formatting. Rounding happens ONLY here; stored values keep full precision.
import { Q, LenUnit, UNIT_LABEL, inDisplayUnit, LEN_TO_IN, lenUnitBase } from './units';

export type FracDen = 2 | 4 | 8 | 16 | 32 | 64;

export interface FormatPrefs {
  fracDen: FracDen; // fractional resolution, default 16
  fracMode: 'std' | 'const'; // std = reduce fractions, const = always show in set denominator
  meterDecimals: 'fixed3' | 'float';
  degDecimals: 'fixed2' | 'float';
  areaPref: 'std' | 'sqft' | 'sqin' | 'sqm';
  volPref: 'std' | 'cuft' | 'cum';
}

export const DEFAULT_PREFS: FormatPrefs = {
  fracDen: 16, fracMode: 'std', meterDecimals: 'fixed3', degDecimals: 'fixed2', areaPref: 'std', volPref: 'std',
};

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Round a non-negative inch value to the nearest 1/den. Returns integer count of 1/den units. */
export function roundToDen(inchesAbs: number, den: number): number {
  // small epsilon guards against binary representation of exact halves (e.g. 0.5/16 boundaries)
  return Math.round(inchesAbs * den + 1e-9);
}

export interface FtInParts {
  neg: boolean; feet: number; inch: number; num: number; den: number; exact: boolean;
}

/** Split inches into feet / whole inches / reduced fraction at the given resolution, carrying correctly. */
export function splitFtIn(totalIn: number, den: number, withFeet: boolean, reduce = true): FtInParts {
  const neg = totalIn < 0;
  const units = roundToDen(Math.abs(totalIn), den);
  const exact = Math.abs(units / den - Math.abs(totalIn)) < 1e-9;
  const perFoot = 12 * den;
  const feet = withFeet ? Math.floor(units / perFoot) : 0;
  const rem = units - feet * perFoot;
  const inch = Math.floor(rem / den);
  let n = rem - inch * den;
  let d = den;
  if (n !== 0 && reduce) { const g = gcd(n, d); n /= g; d /= g; }
  const isZero = feet === 0 && inch === 0 && n === 0;
  return { neg: neg && !isZero, feet, inch, num: n, den: d, exact };
}

export function fracInchText(p: FtInParts): string {
  if (p.num === 0) return `${p.inch}`;
  if (p.inch === 0) return `${p.num}/${p.den}`;
  return `${p.inch}-${p.num}/${p.den}`;
}

export function formatFtIn(totalIn: number, prefs: FormatPrefs): string {
  const p = splitFtIn(totalIn, prefs.fracDen, true, prefs.fracMode === 'std');
  return `${p.neg ? '−' : ''}${p.feet}' ${fracInchText(p)}"`;
}

export function formatFracIn(totalIn: number, prefs: FormatPrefs): string {
  const p = splitFtIn(totalIn, prefs.fracDen, false, prefs.fracMode === 'std');
  return `${p.neg ? '−' : ''}${fracInchText(p)}"`;
}

/** Display number formatting: 7 significant digits, at most `maxDecimals` decimals, zeros trimmed
 * (matches an 8-digit calculator display). Full precision is kept internally. */
export function formatNumber(v: number, maxDecimals = 6, sig = 7): string {
  if (!isFinite(v)) return 'Error';
  if (v === 0 || Object.is(v, -0)) return '0';
  const a = Math.abs(v);
  if (a >= 1e11 || a < 5e-7) return v.toExponential(4).replace('e', '×10^');
  const intDigits = Math.max(1, Math.floor(Math.log10(a)) + 1);
  const dec = Math.max(0, Math.min(maxDecimals, sig - intDigits));
  let s = v.toFixed(dec);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s.replace('-', '−');
}

export function formatAngle(deg: number, prefs: FormatPrefs): string {
  return (prefs.degDecimals === 'fixed2' ? deg.toFixed(2).replace('-', '−') : formatNumber(deg)) + '°';
}

export function toDMS(deg: number): { neg: boolean; d: number; m: number; s: number } {
  const neg = deg < 0;
  let totalSec = Math.round(Math.abs(deg) * 3600 * 100) / 100;
  const d = Math.floor(totalSec / 3600); totalSec -= d * 3600;
  const m = Math.floor(totalSec / 60); totalSec -= m * 60;
  return { neg, d, m, s: Math.round(totalSec * 100) / 100 };
}
export function formatDMS(deg: number): string {
  const x = toDMS(deg);
  return `${x.neg ? '−' : ''}${x.d}° ${x.m}′ ${formatNumber(x.s, 2)}″`;
}

/** Primary display text for a quantity in its current display unit. */
export function formatQ(q: Q, prefs: FormatPrefs): string {
  if (q.kind === 'len' && q.dim === 1) {
    switch (q.unit as LenUnit) {
      case 'ftin': return formatFtIn(q.v, prefs);
      case 'infrac': return formatFracIn(q.v, prefs);
      case 'ftdec': return `${formatNumber(q.v / 12)} ft`;
      case 'indec': return `${formatNumber(q.v)} in`;
      case 'mm': return `${formatNumber(q.v * 25.4, 3, 10)} mm`;
      case 'm': {
        const m = q.v * 0.0254;
        return `${prefs.meterDecimals === 'fixed3' ? m.toFixed(3).replace('-', '−') : formatNumber(m)} m`;
      }
    }
  }
  if (q.kind === 'num') {
    if (q.unit === 'deg') return formatAngle(q.v, prefs);
    if (q.unit === 'dms') return formatDMS(q.v);
    if (q.unit === 'pct') return `${formatNumber(q.v * 100)}%`;
    return formatNumber(q.v);
  }
  if (q.kind === 'money') return `$${(Math.round(q.v * 100) / 100).toFixed(2)}`;
  const v = inDisplayUnit(q);
  return `${formatNumber(v)} ${UNIT_LABEL[q.unit] ?? ''}`.trim();
}

/** Secondary text: exact decimal equivalents shown under a rounded fractional result. */
export function secondaryText(q: Q, prefs: FormatPrefs): string | null {
  if (q.kind !== 'len' || q.dim !== 1) return null;
  const parts = [`${formatNumber(q.v, 6, 10)} in`, `${formatNumber(q.v / 12, 6, 10)} ft`, `${formatNumber(q.v * 25.4, 2, 10)} mm`];
  if (q.unit === 'ftin' || q.unit === 'infrac') {
    const p = splitFtIn(q.v, prefs.fracDen, false);
    if (!p.exact) parts.unshift('rounded to 1/' + prefs.fracDen);
  }
  return parts.join(' · ');
}

export function lengthInUnits(inchesVal: number, base: 'in' | 'ft' | 'mm' | 'm'): number {
  return inchesVal / LEN_TO_IN[base];
}
export { lenUnitBase };
