// Dimension-aware arithmetic on quantities.
import { Q, CalcError, LenUnit, AreaUnit, VolUnit, num, lenUnitBase } from './units';
import { FormatPrefs, DEFAULT_PREFS } from './format';

type Family = 'ft' | 'in' | 'metric';

function family(q: Q): Family {
  const u = q.unit as string;
  if (q.dim === 1) { const b = lenUnitBase(u as LenUnit); return b === 'ft' ? 'ft' : b === 'in' ? 'in' : 'metric'; }
  if (u === 'sqft' || u === 'cuft' || u === 'gal') return 'ft';
  if (u === 'sqin' || u === 'cuin') return 'in';
  return 'metric';
}

const kindName: Record<string, string> = {
  num: 'a plain number', weight: 'a weight', flow: 'a flow rate', vel: 'a velocity', press: 'a pressure',
  force: 'a force', temp: 'a temperature', dens: 'a density', money: 'a cost',
};
export function describe(q: Q): string {
  if (q.kind === 'len') return q.dim === 1 ? 'a length' : q.dim === 2 ? 'an area' : 'a volume';
  return kindName[q.kind];
}

export function unitForDim(dim: number, fams: Family[], prefs: FormatPrefs, prefer?: Q): Q['unit'] {
  const all = (f: Family) => fams.every((x) => x === f);
  if (dim === 1) {
    if (prefer && prefer.dim === 1) {
      // keep feet-inch if any operand used feet
      if (fams.includes('ft')) return prefer.unit === 'ftdec' ? 'ftdec' : 'ftin';
      return prefer.unit as LenUnit;
    }
    return fams.includes('ft') ? 'ftin' : all('metric') ? 'm' : 'infrac';
  }
  if (dim === 2) {
    if (prefs.areaPref !== 'std') return prefs.areaPref as AreaUnit;
    return all('in') ? 'sqin' : all('metric') ? 'sqm' : 'sqft';
  }
  if (prefs.volPref !== 'std') return prefs.volPref as VolUnit;
  return all('in') ? 'cuin' : all('metric') ? 'cum' : 'cuft';
}

function lenQ(v: number, dim: number, unit: Q['unit']): Q {
  if (dim === 0) return num(v);
  if (dim > 3) throw new CalcError('DIM', 'That result would be beyond cubic units (length⁴), which has no meaning here.');
  if (dim < 0) throw new CalcError('DIM', 'Dividing by a larger dimension gives an inverse length, which is not supported.');
  return { v, kind: 'len', dim, unit };
}

export function add(a: Q, b: Q, sign: 1 | -1, prefs: FormatPrefs = DEFAULT_PREFS): Q {
  if (a.kind === 'num' && b.kind === 'num') return num(a.v + sign * b.v, a.unit === 'deg' || b.unit === 'deg' ? 'deg' : a.unit === 'dms' || b.unit === 'dms' ? 'dms' : 'none');
  if (a.kind !== b.kind || a.dim !== b.dim) {
    throw new CalcError('DIM', `Can't ${sign > 0 ? 'add' : 'subtract'} ${describe(b)} ${sign > 0 ? 'to' : 'from'} ${describe(a)}. Give both values the same kind of unit (e.g. press Inch or Feet after the number).`);
  }
  if (a.kind === 'temp') throw new CalcError('DIM', 'Adding temperatures is ambiguous (absolute vs. difference). Use the °F/°C keys to convert instead.');
  const v = a.v + sign * b.v;
  if (a.kind === 'len') {
    const unit = a.dim === 1 ? unitForDim(1, [family(a), family(b)], prefs, a) : a.unit;
    return lenQ(v, a.dim, unit);
  }
  return { ...a, v };
}

export function mul(a: Q, b: Q, prefs: FormatPrefs = DEFAULT_PREFS): Q {
  if (a.kind === 'num' && b.kind === 'num') return num(a.v * b.v);
  if (a.kind === 'num') return scale(b, a.v);
  if (b.kind === 'num') return scale(a, b.v);
  if (a.kind === 'len' && b.kind === 'len') {
    const dim = a.dim + b.dim;
    if (dim > 3) throw new CalcError('DIM', `Multiplying ${describe(a)} by ${describe(b)} gives length⁴, which is not a valid result.`);
    return lenQ(a.v * b.v, dim, unitForDim(dim, [family(a), family(b)], prefs));
  }
  throw new CalcError('DIM', `Can't multiply ${describe(a)} by ${describe(b)}. Use the Flow, Pressure, Force or Area keys for those relationships.`);
}

export function scale(a: Q, k: number): Q {
  if (a.kind === 'temp') throw new CalcError('DIM', 'Scaling a temperature is not meaningful. Convert to the unit you need instead.');
  return { ...a, v: a.v * k };
}

export function div(a: Q, b: Q, prefs: FormatPrefs = DEFAULT_PREFS): Q {
  if (b.v === 0) throw new CalcError('MATH', 'Division by zero.');
  if (b.kind === 'num') return a.kind === 'num' ? num(a.v / b.v) : scale(a, 1 / b.v);
  if (a.kind === 'len' && b.kind === 'len') {
    const dim = a.dim - b.dim;
    return lenQ(a.v / b.v, dim, dim > 0 ? unitForDim(dim, [family(a)], prefs, dim === 1 ? (a.dim === 1 ? a : undefined) : undefined) : 'none');
  }
  if (a.kind === b.kind && a.kind !== 'temp') return num(a.v / b.v);
  throw new CalcError('DIM', `Can't divide ${describe(a)} by ${describe(b)}.`);
}

export function powQ(a: Q, e: number, prefs: FormatPrefs = DEFAULT_PREFS): Q {
  if (a.kind === 'num') {
    const r = Math.pow(a.v, e);
    if (!isFinite(r) || isNaN(r)) throw new CalcError('MATH', 'That power has no real result.');
    return num(r);
  }
  if (a.kind !== 'len') throw new CalcError('DIM', `Can't raise ${describe(a)} to a power.`);
  const dim = a.dim * e;
  if (!Number.isInteger(dim)) throw new CalcError('DIM', `Raising ${describe(a)} to the ${e} power gives a fractional dimension.`);
  if (dim === 0) return num(1);
  const r = Math.pow(a.v, e);
  if (isNaN(r)) throw new CalcError('MATH', 'That root has no real result.');
  return lenQ(r, dim, unitForDim(dim, [family(a)], prefs, dim === 1 && a.dim === 1 ? a : undefined));
}

export function sqrtQ(a: Q, prefs: FormatPrefs = DEFAULT_PREFS): Q {
  if (a.v < 0) throw new CalcError('MATH', 'Square root of a negative value has no real result.');
  if (a.kind === 'len' && a.dim % 2 !== 0) throw new CalcError('DIM', `The square root of ${describe(a)} is not a length or number.`);
  if (a.kind === 'len') {
    const fam = family(a);
    const unit: LenUnit = fam === 'ft' ? 'ftin' : fam === 'in' ? 'infrac' : 'm';
    return { v: Math.sqrt(a.v), kind: 'len', dim: a.dim / 2, unit };
  }
  return powQ(a, 0.5, prefs);
}

export function negate(a: Q): Q { return { ...a, v: a.kind === 'temp' ? a.v : -a.v }; }

export { family };
