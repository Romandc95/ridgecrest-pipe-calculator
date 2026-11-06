// Parser for typed measurements: 5' 7 3/8", 7-3/8", 7.375 in, 150 mm, 1.2 m, 11 sq ft, 45°, 23°42'39", 2.5%, 40 gpm…
import { Q, CalcError, fromUnit, num, Unit, LenUnit } from './units';

const UNIT_ALIASES: Array<[RegExp, string]> = [
  [/^(sq\.?\s*ft|sqft|ft2|ft²|square\s*feet|square\s*foot)/i, 'sqft'],
  [/^(sq\.?\s*in|sqin|in2|in²|square\s*inch(es)?)/i, 'sqin'],
  [/^(sq\.?\s*m|sqm|m2|m²|square\s*met(er|re)s?)/i, 'sqm'],
  [/^(cu\.?\s*ft|cuft|ft3|ft³|cubic\s*f(oo|ee)t)/i, 'cuft'],
  [/^(cu\.?\s*in|cuin|in3|in³|cubic\s*inch(es)?)/i, 'cuin'],
  [/^(cu\.?\s*m|cum|m3\/s|m3|m³\/s|m³|cubic\s*met(er|re)s?)/i, 'CUM_OR_FLOW'],
  [/^(gpm|gal\/min)/i, 'gpm'], [/^(cfm|ft3\/min)/i, 'cfm'], [/^(cfs|ft3\/s)/i, 'cfs'], [/^(l\/s|lps)/i, 'lps'],
  [/^(ft\/s|fps)/i, 'fps'], [/^(ft\/min|fpm)/i, 'fpm'], [/^(m\/s|mps)/i, 'mps'],
  [/^(psi)/i, 'psi'], [/^(psf)/i, 'psf'], [/^(inhg|in\s*hg)/i, 'inHg'], [/^(ft\s*(of\s*)?(head|h2o|water)|fth2o)/i, 'ftH2O'],
  [/^(kpa)/i, 'kPa'], [/^(bar)/i, 'bar'], [/^(lbf)/i, 'lbf'], [/^(newtons?|N)(?![a-z])/, 'N'],
  [/^(lb\/ft3|pcf|lb\/cu\s*ft)/i, 'pcf'], [/^(lb\/gal|ppg)/i, 'ppg'], [/^(kg\/m3|kg\/m³)/i, 'kgm3'], [/^(kg\/l)/i, 'kgL'],
  [/^(gallons?|gal)/i, 'gal'], [/^(liters?|litres?|L)(?![a-z])/, 'L'],
  [/^(pounds?|lbs?)/i, 'lb'], [/^(kilograms?|kg)/i, 'kg'],
  [/^(°\s*F|degF|deg\s*F)(?![a-z])/i, 'F'], [/^(°\s*C|degC|deg\s*C)(?![a-z])/i, 'C'],
  [/^(mm|millimet(er|re)s?)/i, 'mm'], [/^(cm|centimet(er|re)s?)/i, 'cm'],
  [/^(met(er|re)s?|m)(?![a-z])/i, 'm'], [/^(yards?|yd)/i, 'yd'],
  [/^(feet|foot|ft|')/i, 'ft'], [/^(inches|inch|in|"|'')/i, 'in'],
  [/^(degrees?|deg|°)/i, 'deg'], [/^(minutes?|min)/i, "'"], [/^%/, '%'], [/^\$/, '$'],
];

interface Tok { t: 'n'; v: number }
interface UTok { t: 'u'; u: string }
type T = Tok | UTok;

function tokenize(src: string): T[] {
  let s = src.trim().replace(/[″”“]/g, '"').replace(/[′’‘]/g, "'").replace(/−/g, '-').replace(/,/g, '');
  const out: T[] = [];
  let neg = false;
  if (/^-/.test(s)) { neg = true; s = s.slice(1); }
  while (s.length) {
    s = s.replace(/^\s+/, '');
    if (!s.length) break;
    // mixed number with dash: 7-3/8
    let m = s.match(/^(\d+(?:\.\d+)?)-(\d+)\/(\d+)/);
    if (m) {
      if (+m[3] === 0) throw new CalcError('ENT', 'A fraction cannot have a zero denominator.');
      out.push({ t: 'n', v: +m[1] + +m[2] / +m[3] }); s = s.slice(m[0].length); continue;
    }
    m = s.match(/^(\d+)\/(\d+)/);
    if (m) {
      if (+m[2] === 0) throw new CalcError('ENT', 'A fraction cannot have a zero denominator.');
      const prev = out[out.length - 1];
      const f = +m[1] / +m[2];
      // "7 3/8" -> 7.375 when previous token is a bare whole number
      if (prev && prev.t === 'n' && Number.isInteger(prev.v) && (prev as Tok & { whole?: boolean }).whole) prev.v += f;
      else out.push({ t: 'n', v: f });
      s = s.slice(m[0].length); continue;
    }
    m = s.match(/^(\d+\.?\d*|\.\d+)/);
    if (m) { const tok: Tok & { whole?: boolean } = { t: 'n', v: +m[1], whole: /^\d+$/.test(m[1]) }; out.push(tok); s = s.slice(m[0].length); continue; }
    let matched = false;
    for (const [re, u] of UNIT_ALIASES) {
      const um = s.match(re);
      if (um) { out.push({ t: 'u', u }); s = s.slice(um[0].length); matched = true; break; }
    }
    if (!matched) throw new CalcError('ENT', `Didn't understand "${s.slice(0, 12)}". Try forms like 5' 7 3/8", 7.375 in, 150 mm.`);
  }
  if (neg) out.unshift({ t: 'u', u: 'NEG' });
  return out;
}

const LENGTH_UNITS = new Set(['ft', 'in', 'mm', 'cm', 'm', 'yd']);

/** Parse a typed measurement or number. Throws CalcError with a readable message. */
export function parseMeasurement(src: string): Q {
  if (!src || !src.trim()) throw new CalcError('ENT', 'Enter a value.');
  const toks = tokenize(src);
  let sign = 1;
  if (toks[0] && toks[0].t === 'u' && toks[0].u === 'NEG') { sign = -1; toks.shift(); }

  // pair numbers with following unit
  const comps: Array<{ v: number; u: string | null }> = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'n') {
      const nx = toks[i + 1];
      if (nx && nx.t === 'u') { comps.push({ v: t.v, u: nx.u }); i++; } else comps.push({ v: t.v, u: null });
    } else {
      throw new CalcError('ENT', `Unit "${t.u}" needs a number in front of it.`);
    }
  }
  if (!comps.length) throw new CalcError('ENT', 'No number found.');

  // degrees-minutes-seconds: 23°42'39"
  if (comps[0].u === 'deg' && comps.length > 1) {
    const d = comps[0].v, mi = comps[1]?.v ?? 0, se = comps[2]?.v ?? 0;
    if (comps.length > 3) throw new CalcError('ENT', 'Too many parts for degrees-minutes-seconds.');
    return num(sign * (d + mi / 60 + se / 3600), 'dms');
  }

  const isLen = comps.some((c) => c.u && LENGTH_UNITS.has(c.u));
  if (isLen) {
    let total = 0;
    let largest: string | null = null;
    let prevUnit: string | null = null;
    for (const c of comps) {
      let u = c.u;
      if (u === null) {
        if (prevUnit === 'ft' || prevUnit === 'in') u = 'in';
        else throw new CalcError('ENT', 'A number without a unit must follow a feet value (e.g. 5\' 7").');
      }
      if (!LENGTH_UNITS.has(u)) throw new CalcError('DIM', `Can't mix ${u} with a length.`);
      total += fromUnit(c.v, u as Unit).v;
      if (!largest) largest = u;
      prevUnit = u;
    }
    const unit: LenUnit = largest === 'ft' || largest === 'yd' ? 'ftin' : largest === 'in' ? 'infrac' : largest === 'mm' ? 'mm' : 'm';
    return { v: sign * total, kind: 'len', dim: 1, unit };
  }

  if (comps.length > 1) {
    throw new CalcError('ENT', 'Only lengths can have several parts. Separate other values into their own fields.');
  }
  const { v, u } = comps[0];
  if (u === null) return num(sign * v);
  if (u === 'deg') return num(sign * v, 'deg');
  if (u === '%') return num((sign * v) / 100, 'pct');
  if (u === '$') return { v: sign * v, kind: 'money', dim: 0, unit: 'usd' };
  if (u === "'") throw new CalcError('ENT', 'Minutes need a degree value first.');
  if (u === 'CUM_OR_FLOW') return src.match(/\/s/) ? fromUnit(sign * v, 'm3s') : fromUnit(sign * v, 'cum');
  return fromUnit(sign * v, u as Unit);
}

/** Parse requiring a length (unitless numbers are taken as inches). */
export function parseLength(src: string): number {
  const q = parseMeasurement(src);
  if (q.kind === 'num' && q.unit === 'none') return q.v;
  if (q.kind !== 'len' || q.dim !== 1) throw new CalcError('DIM', 'Enter a length, e.g. 24", 2\' 0", 610 mm.');
  return q.v;
}

/** Parse an angle in degrees. Accepts 45, 45°, 23°42'39". */
export function parseAngle(src: string): number {
  const q = parseMeasurement(src);
  if (q.kind !== 'num' || q.unit === 'pct') throw new CalcError('DIM', 'Enter an angle in degrees, e.g. 45 or 22°30\'.');
  return q.v;
}

export function tryParse<T>(fn: (s: string) => T, s: string): { ok: true; v: T } | { ok: false; err: string } | null {
  if (!s || !s.trim()) return null;
  try { return { ok: true, v: fn(s) }; } catch (e) { return { ok: false, err: (e as Error).message }; }
}
