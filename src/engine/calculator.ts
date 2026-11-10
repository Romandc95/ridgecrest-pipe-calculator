// Keypad state machine. Pure: press(state, key, prefs) -> new state. No UI code here.
//
// Entering vs solving: a project key (Offset, Run, Travel, Angle/Slope, …) STORES a value when a number has
// just been typed or calculated (entry active, or a fresh result from = or a function). With no new value,
// the key SOLVES/RECALLS; pressing it again cycles through related results.
import { Q, CalcError, num, fromUnit, LEN_TO_IN, lenToIn, LenUnit, Unit, deg2rad, rad2deg, LB_PER_FT3_WATER, DENS_TO_PCF, DensUnit, FLOW_TO_CFS, VEL_TO_FPS, PRESS_TO_PSI } from './units';
import { FormatPrefs, DEFAULT_PREFS } from './format';
import { evaluate, Tok, Op } from './expr';
import { sqrtQ, powQ, negate, add } from './arith';
import { solveRollingOffset, solveSimpleOffset, parallelCutback, angleFromSlopePerFt, angleFromGrade } from './layout';
import { elbowTakeout, ElbowType, ELBOW_ORDER, arcs, steelOD, B169 } from './fittings';
import { Material, MATERIAL_ORDER, MATERIALS, typesFor, defaultType, pipeProps, npsLabel, sizesFor } from './pipedata';
import { pressureLoss, circle, LossMethod } from './hydraulics';

export type Key =
  | 'angle' | 'offset' | 'run' | 'travel' | 'material'
  | 'pow' | 'sin' | 'cos' | 'tan' | 'size'
  | '(' | ')' | 'circle' | 'sq' | 'sqrt'
  | 'mm' | 'ft' | 'in' | 'frac' | 'bksp'
  | 'conv' | '7' | '8' | '9' | 'div'
  | 'store' | '4' | '5' | '6' | 'mul'
  | 'recall' | '1' | '2' | '3' | 'sub'
  | 'mplus' | '0' | '.' | 'eq' | 'add'
  | 'C' | 'AC' | 'MC';

export type Fn =
  | Key | 'takeout' | 'gap' | 'cutback' | 'roll' | 'ptype' | 'root' | 'asin' | 'acos' | 'atan' | 'elbow'
  | 'recip' | 'neg' | 'pi' | 'pct' | 'dms' | 'm' | 'flow' | 'vel' | 'press' | 'force'
  | 'gal' | 'L' | 'lb' | 'kg' | 'wtvol' | 'F' | 'C°' | 'area' | 'cost' | 'tape'
  | 'gpm' | 'lps' | 'cfm' | 'cfs' | 'mminus' | 'unitcost' | 'prefs';

/** Secondary (Conv) functions and their key labels. */
export const CONV_MAP: Partial<Record<Key, { fn: Fn; label: string }>> = {
  angle: { fn: 'takeout', label: 'T.O./Arc' }, offset: { fn: 'gap', label: 'Gap' }, run: { fn: 'cutback', label: 'Cutback' },
  travel: { fn: 'roll', label: 'Roll' }, material: { fn: 'ptype', label: 'Pipe Type' },
  pow: { fn: 'root', label: 'ʸ√x' }, sin: { fn: 'asin', label: 'sin⁻¹' }, cos: { fn: 'acos', label: 'cos⁻¹' }, tan: { fn: 'atan', label: 'tan⁻¹' },
  size: { fn: 'elbow', label: 'Elbow' }, '(': { fn: 'recip', label: '1/x' }, ')': { fn: 'neg', label: '+/−' },
  circle: { fn: 'pi', label: 'π' }, sq: { fn: 'pct', label: '%' }, sqrt: { fn: 'dms', label: 'D:M:S' },
  mm: { fn: 'm', label: 'm' }, ft: { fn: 'flow', label: 'Flow' }, in: { fn: 'vel', label: 'Veloc' },
  frac: { fn: 'press', label: 'Press' }, bksp: { fn: 'force', label: 'Force' },
  '7': { fn: 'gal', label: 'gal' }, '8': { fn: 'L', label: 'L' }, '9': { fn: 'lb', label: 'lb' }, div: { fn: 'kg', label: 'kg' },
  store: { fn: 'wtvol', label: 'Wt/Vol' }, '4': { fn: 'F', label: '°F' }, '5': { fn: 'C°', label: '°C' }, '6': { fn: 'area', label: 'Area' },
  mul: { fn: 'cost', label: 'Cost' }, recall: { fn: 'tape', label: 'Tape' }, '1': { fn: 'gpm', label: 'gpm' }, '2': { fn: 'lps', label: 'L/s' },
  '3': { fn: 'cfm', label: 'cfm' }, sub: { fn: 'cfs', label: 'cfs' }, mplus: { fn: 'mminus', label: 'M−' },
  '0': { fn: 'unitcost', label: 'Unit $' }, '.': { fn: 'prefs', label: 'Prefs' },
};

interface Part { v: number; base: 'ft' | 'in' | 'mm' | 'm'; pow: number; text: string }
export interface Entry { cur: string; den: boolean; numStr: string; parts: Part[]; tag: Unit | null; neg: boolean }

export interface Display {
  label: string; q?: Q; text?: string; note?: string;
  tag: 'entered' | 'solved' | 'value' | 'info' | 'error';
}

type GeoKey = 'O' | 'A' | 'L' | 'theta';
export interface Regs {
  O?: number; A?: number; L?: number; theta?: number; roll?: number;
  geoOrder: GeoKey[]; lenUnit: LenUnit;
  gap: number; takeout?: number;
  material: Material; ptype: string; nps?: string; elbow: ElbowType;
  flow?: number; vel?: number; press?: number; force?: number; area?: number;
  densityPcf: number; densUnit: DensUnit; unitCost?: number;
}

export interface Cycle { key: string; i: number; items: Display[] }

export interface CalcState {
  entry: Entry | null;
  tokens: Tok[];
  x: Q | null; // current value
  xInTokens: boolean; // x is the last token (after ')')
  fresh: boolean; // x may be entered into a project key
  display: Display;
  conv: boolean;
  pending: 'store' | 'recall' | null;
  cycle: Cycle | null;
  regs: Regs;
  mem: { sum: Q | null; count: number };
  M: Array<Q | null>;
  tape: string[][]; // groups of lines; formatted lazily by UI via Q list
  tapeQ: Array<{ op: string; q: Q }>;
  lastKey: string | null;
  lastCKey: boolean;
  lastEval: { id: number; tokens: Tok[]; result: Q } | null;
  error: string | null;
  openPrefs: number; // increments when Prefs is requested
}

export const DEFAULT_REGS = (): Regs => ({
  geoOrder: [], lenUnit: 'infrac', gap: 0.125, material: 'steel', ptype: 'Std', elbow: 'BW-L',
  densityPcf: LB_PER_FT3_WATER, densUnit: 'pcf',
});

export function initialState(): CalcState {
  return {
    entry: null, tokens: [], x: null, xInTokens: false, fresh: false,
    display: { label: '', q: num(0), tag: 'value' }, conv: false, pending: null, cycle: null,
    regs: DEFAULT_REGS(), mem: { sum: null, count: 0 }, M: Array(9).fill(null), tape: [], tapeQ: [],
    lastKey: null, lastCKey: false, lastEval: null, error: null, openPrefs: 0,
  };
}

export interface CalcOptions { chain: boolean; prefs: FormatPrefs; lossMethod?: LossMethod }
const DEF_OPTS: CalcOptions = { chain: false, prefs: DEFAULT_PREFS };

// ---------------------------------------------------------------- entry helpers
const newEntry = (): Entry => ({ cur: '', den: false, numStr: '', parts: [], tag: null, neg: false });

function pendingValue(e: Entry, prefs: FormatPrefs): number | null {
  if (e.den) {
    const n = parseFloat(e.numStr);
    const d = e.cur === '' ? prefs.fracDen : parseFloat(e.cur);
    if (!d) throw new CalcError('ENT', 'A fraction cannot have a zero denominator.');
    return n / d;
  }
  if (e.cur === '' || e.cur === '.') return null;
  if ((e.cur.match(/\./g) || []).length > 1) return null; // D.M.S
  return parseFloat(e.cur);
}

function isDMS(e: Entry) { return !e.den && (e.cur.match(/\./g) || []).length === 2; }
function dmsValue(s: string) { const [d, m, sec] = s.split('.').map((x) => parseFloat(x || '0')); return d + m / 60 + sec / 3600; }

export function entryText(e: Entry): string {
  const sym = { ft: "'", in: '"', mm: ' mm', m: ' m' } as const;
  const pw = (p: number) => (p === 2 ? '²' : p === 3 ? '³' : '');
  let s = e.parts.map((p) => `${p.text}${sym[p.base]}${pw(p.pow)}`).join(' ');
  const tail = e.den ? `${e.numStr}/${e.cur || '_'}` : e.cur;
  if (tail) s += (s ? ' ' : '') + tail;
  if (e.tag) s += ' ' + e.tag;
  return (e.neg ? '−' : '') + (s || '0');
}

function entryToQ(e: Entry, prefs: FormatPrefs): Q {
  const sign = e.neg ? -1 : 1;
  if (isDMS(e)) {
    if (e.parts.length) throw new CalcError('ENT', 'D.M.S entry cannot be mixed with units.');
    return num(sign * dmsValue(e.cur), 'dms');
  }
  const pv = pendingValue(e, prefs);
  if (!e.parts.length) {
    if (pv === null) throw new CalcError('ENT', 'Nothing entered.');
    if (e.tag) return fromUnit(sign * pv, e.tag);
    return num(sign * pv);
  }
  const maxPow = Math.max(...e.parts.map((p) => p.pow));
  if (maxPow > 1) {
    if (e.parts.length > 1 || pv !== null) throw new CalcError('ENT', 'Area or volume entries take a single number, e.g. 11 Feet Feet.');
    const p = e.parts[0];
    if (p.base === 'mm') throw new CalcError('ENT', 'Use meters (Conv mm) for metric area or volume.');
    const k = Math.pow(LEN_TO_IN[p.base], p.pow);
    const unit = (p.pow === 2 ? { ft: 'sqft', in: 'sqin', m: 'sqm' } : { ft: 'cuft', in: 'cuin', m: 'cum' })[p.base as 'ft' | 'in' | 'm'] as Unit;
    return { v: sign * p.v * k, kind: 'len', dim: p.pow, unit };
  }
  let total = e.parts.reduce((s, p) => s + lenToIn(p.v, p.base), 0);
  const last = e.parts[e.parts.length - 1].base;
  if (pv !== null) {
    if (last === 'ft' || last === 'in') total += pv; // trailing number/fraction after feet or inches = inches
    else throw new CalcError('ENT', 'Add a unit to the last number.');
  }
  const first = e.parts[0].base;
  const unit: LenUnit = first === 'ft' ? 'ftin' : first === 'in' ? 'infrac' : first;
  return { v: sign * total, kind: 'len', dim: 1, unit };
}

// ---------------------------------------------------------------- main reducer
export function press(s0: CalcState, key: Key, opts: CalcOptions = DEF_OPTS): CalcState {
  const s: CalcState = { ...s0, regs: { ...s0.regs, geoOrder: [...s0.regs.geoOrder] }, mem: { ...s0.mem }, M: [...s0.M] };
  const prefs = opts.prefs;

  if (key === 'C') return clearKey(s);
  if (key === 'AC') return clearAll(s);
  if (key === 'MC') { s.mem = { sum: null, count: 0 }; s.display = { label: 'MEM', text: 'Memory cleared', tag: 'info' }; return s; }
  if (s.error) {
    if (key === 'bksp') return clearKey(s);
    return s; // like the hardware: press C to clear an error
  }
  if (key === 'conv') { s.conv = !s.conv; return s; }

  let fn: Fn = key;
  if (s.conv) {
    s.conv = false;
    const c = CONV_MAP[key];
    if (c) fn = c.fn;
  }
  s.lastCKey = false;

  try {
    // Store / Recall prefixes
    if (s.pending) {
      const p = s.pending;
      s.pending = null;
      if (/^[1-9]$/.test(fn)) {
        const i = +fn - 1;
        if (p === 'store') {
          const q = currentValue(s, prefs);
          s.M[i] = q; s.display = { label: `M${i + 1}`, q, tag: 'entered' };
        } else {
          const q = s.M[i];
          s.display = { label: `M${i + 1}`, q: q ?? num(0), tag: 'value' };
          setX(s, q ?? num(0), true);
        }
        s.lastKey = fn;
        return s;
      }
      if (p === 'recall' && fn === 'mplus') return finish(s, fn, memCycle(s, true));
      if (p === 'recall' && ['offset', 'run', 'travel', 'angle', 'gap', 'takeout', 'roll'].includes(fn)) {
        return finish(s, fn, recallReg(s, fn));
      }
      // otherwise fall through and process normally
    }

    switch (fn) {
      case 'store': commitEntry(s, prefs); s.pending = 'store'; s.display = { ...s.display, note: 'STO — press 1–9' }; return s;
      case 'recall': s.pending = 'recall'; s.display = { ...s.display, note: 'RCL — press 1–9, M+, or a project key' }; return s;
      case 'prefs': s.openPrefs++; return s;
      case 'tape': s.display = { label: 'TAPE', text: `${s.tapeQ.length} entries`, tag: 'info' }; return finish(s, fn);
    }

    if (/^[0-9]$/.test(fn) || fn === '.') return finish(s, fn, digit(s, fn));
    switch (fn) {
      case 'frac': return finish(s, fn, fracKey(s));
      case 'bksp': return finish(s, fn, backspace(s));
      case 'ft': case 'in': case 'mm': case 'm': return finish(s, fn, lengthUnitKey(s, fn, prefs));
      case 'gal': case 'L': case 'lb': case 'kg': case 'F': case 'C°': case 'gpm': case 'lps': case 'cfm': case 'cfs':
        return finish(s, fn, otherUnitKey(s, fn, prefs));
      case 'add': case 'sub': case 'mul': case 'div': case 'pow': case 'root':
        return finish(s, fn, binary(s, ({ add: '+', sub: '-', mul: '*', div: '/', pow: '^', root: 'root' } as const)[fn], opts));
      case '(': return finish(s, fn, openParen(s));
      case ')': return finish(s, fn, closeParen(s, opts));
      case 'eq': return finish(s, fn, equals(s, opts));
      case 'pct': return finish(s, fn, percent(s, opts));
      case 'sq': case 'sqrt': case 'sin': case 'cos': case 'tan': case 'asin': case 'acos': case 'atan':
      case 'recip': case 'neg': case 'pi': case 'dms':
        return finish(s, fn, unary(s, fn, prefs));
      case 'circle': return finish(s, fn, circleKey(s, prefs));
      case 'mplus': case 'mminus': return finish(s, fn, mplus(s, fn === 'mminus', prefs));
      default: return finish(s, fn, projectKey(s, fn, opts));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = e instanceof CalcError ? e.code : 'ERR';
    s.error = msg; s.entry = null; s.cycle = null;
    s.display = { label: `${code} Error`, text: msg, tag: 'error' };
    s.lastKey = fn;
    return s;
  }
}

function finish(s: CalcState, fn: string, _r?: unknown): CalcState { s.lastKey = fn; return s; }

function setX(s: CalcState, q: Q, fresh: boolean) { s.x = q; s.fresh = fresh; s.xInTokens = false; }

function currentValue(s: CalcState, prefs: FormatPrefs): Q {
  if (s.entry) { commitEntry(s, prefs); }
  return s.x ?? num(0);
}

function commitEntry(s: CalcState, prefs: FormatPrefs) {
  if (!s.entry) return;
  const q = entryToQ(s.entry, prefs);
  s.entry = null;
  setX(s, q, true);
}

function showX(s: CalcState, label = '', tag: Display['tag'] = 'value') {
  s.display = { label, q: s.x ?? num(0), tag };
}

function startEntry(s: CalcState) {
  if (!s.entry) {
    if (s.xInTokens) throw new CalcError('ENT', 'Press an operator after ")" before typing a number.');
    s.entry = newEntry(); s.cycle = null;
  }
  return s.entry;
}

function showEntry(s: CalcState) { s.display = { label: '', text: entryText(s.entry!), tag: 'value' }; }

function digit(s: CalcState, d: string) {
  const e = startEntry(s);
  if (d === '.') {
    if (e.den) return;
    const dots = (e.cur.match(/\./g) || []).length;
    if (dots >= 2) return;
    e.cur += e.cur === '' ? '0.' : '.';
  } else {
    if (e.cur.replace(/\D/g, '').length >= 12) return;
    e.cur += d;
  }
  showEntry(s);
}

function fracKey(s: CalcState) {
  const e = s.entry;
  if (!e || e.den || e.cur === '' || e.cur.includes('.')) throw new CalcError('ENT', 'Type the numerator (top number) first, then press Fraction.');
  e.numStr = e.cur; e.cur = ''; e.den = true;
  showEntry(s);
}

function backspace(s: CalcState) {
  const e = s.entry;
  if (!e) { s.display = { label: '', q: num(0), tag: 'value' }; s.x = null; s.fresh = false; return; }
  if (e.tag) e.tag = null;
  else if (e.cur.length) e.cur = e.cur.slice(0, -1);
  else if (e.den) { e.den = false; e.cur = e.numStr; e.numStr = ''; }
  else if (e.parts.length) { const p = e.parts.pop()!; if (p.pow > 1) { p.pow--; e.parts.push(p); } else e.cur = p.text; }
  if (!e.cur && !e.den && !e.parts.length && !e.tag) { s.entry = null; s.display = { label: '', q: num(0), tag: 'value' }; return; }
  showEntry(s);
}

function lengthUnitKey(s: CalcState, u: 'ft' | 'in' | 'mm' | 'm', prefs: FormatPrefs) {
  const e = s.entry;
  if (e && e.tag) commitEntry(s, prefs); // e.g. 5 gal then ft: convert instead of attaching
  else if (e) {
    if (isDMS(e)) throw new CalcError('ENT', 'D.M.S values are angles, not lengths.');
    const pv = pendingValue(e, prefs);
    if (pv === null) {
      const last = e.parts[e.parts.length - 1];
      if (last && last.base === u && s.lastKey === u) {
        if (last.pow >= 3) throw new CalcError('DIM', 'Cubic is the highest power.');
        last.pow++;
        showEntry(s); return;
      }
      throw new CalcError('ENT', `Type a number before pressing ${u}.`);
    }
    const text = e.den ? `${e.numStr}/${e.cur || prefs.fracDen}` : e.cur;
    const last = e.parts[e.parts.length - 1];
    if (last && last.base === u && e.den) { last.v += pv; last.text += ` ${text}`; }
    else {
      if (last && last.pow > 1) throw new CalcError('ENT', 'Area/volume entries take a single number.');
      e.parts.push({ v: pv, base: u, pow: 1, text });
    }
    e.cur = ''; e.den = false; e.numStr = '';
    showEntry(s);
    return;
  }
  // convert current value
  const x = s.x;
  if (!x) throw new CalcError('ENT', 'Nothing to convert.');
  let q: Q;
  if (x.kind === 'num' && x.unit === 'none') {
    // unitless: tag it in that unit (lets results such as 52 become 52 inches)
    q = fromUnit(x.v, u === 'ft' ? 'ft' as Unit : u === 'in' ? 'in' as Unit : u);
  } else if (x.kind !== 'len') throw new CalcError('DIM', `Can't convert ${x.kind === 'num' ? 'an angle' : 'this value'} to ${u}.`);
  else if (x.dim === 1) {
    let unit: LenUnit;
    // repeated presses toggle fractional/decimal; converting from a decimal unit stays decimal
    if (u === 'ft') unit = x.unit === 'ftin' ? 'ftdec' : x.unit === 'ftdec' || x.unit === 'infrac' ? 'ftin' : 'ftdec';
    else if (u === 'in') unit = x.unit === 'infrac' ? 'indec' : x.unit === 'indec' || x.unit === 'ftin' ? 'infrac' : 'indec';
    else unit = u;
    q = { ...x, unit };
  } else {
    if (u === 'mm') throw new CalcError('DIM', 'Use m for metric area or volume.');
    const map = x.dim === 2 ? { ft: 'sqft', in: 'sqin', m: 'sqm' } : { ft: 'cuft', in: 'cuin', m: 'cum' };
    q = { ...x, unit: map[u] as Unit };
  }
  replaceX(s, q);
}

function replaceX(s: CalcState, q: Q) {
  if (s.xInTokens) { s.tokens = [...s.tokens.slice(0, -1), { t: 'v', q }]; s.x = q; }
  else setX(s, q, true);
  s.cycle = null;
  showX(s);
}

const VOL_UNITS: Record<string, Unit> = { gal: 'gal', L: 'L' };
function otherUnitKey(s: CalcState, fn: string, prefs: FormatPrefs) {
  const unit: Unit = (fn === 'C°' ? 'C' : fn) as Unit;
  const e = s.entry;
  if (e && !e.parts.length && !e.tag) {
    if (isDMS(e)) throw new CalcError('ENT', 'D.M.S values are angles.');
    e.tag = unit;
    showEntry(s); return;
  }
  if (e) commitEntry(s, prefs); // value already has a unit: convert it
  const x = s.x;
  if (!x) throw new CalcError('ENT', 'Nothing to convert.');
  let q: Q;
  const dens = s.regs.densityPcf;
  if (fn in VOL_UNITS) {
    if (x.kind === 'len' && x.dim === 3) q = { ...x, unit: unit };
    else if (x.kind === 'weight') q = { v: (x.v / dens) * 1728, kind: 'len', dim: 3, unit };
    else if (x.kind === 'num' && x.unit === 'none') q = fromUnit(x.v, unit);
    else throw new CalcError('DIM', `Can't convert this value to ${fn}.`);
  } else if (fn === 'lb' || fn === 'kg') {
    if (x.kind === 'weight') q = { ...x, unit };
    else if (x.kind === 'len' && x.dim === 3) q = { v: (x.v / 1728) * dens, kind: 'weight', dim: 0, unit };
    else if (x.kind === 'num' && x.unit === 'none') q = fromUnit(x.v, unit);
    else throw new CalcError('DIM', `Can't convert this value to ${fn}. Weight conversions need a volume or weight.`);
  } else if (fn === 'F' || fn === 'C°') {
    if (x.kind === 'temp') q = { ...x, unit };
    else if (x.kind === 'num' && x.unit === 'none') q = fromUnit(x.v, unit);
    else throw new CalcError('DIM', 'Only temperatures convert to °F/°C.');
  } else {
    if (x.kind === 'flow') q = { ...x, unit };
    else if (x.kind === 'num' && x.unit === 'none') q = fromUnit(x.v, unit);
    else throw new CalcError('DIM', 'Only flow rates convert to flow units.');
  }
  replaceX(s, q);
}

function operandForOp(s: CalcState, prefs: FormatPrefs) {
  if (s.entry) { commitEntry(s, prefs); s.tokens.push({ t: 'v', q: s.x! }); return; }
  if (s.xInTokens) return;
  const last = s.tokens[s.tokens.length - 1];
  if (last && last.t === 'op') { s.tokens.pop(); return; } // replace operator
  s.tokens.push({ t: 'v', q: s.x ?? num(0) });
}

function binary(s: CalcState, op: Op, opts: CalcOptions) {
  operandForOp(s, opts.prefs);
  s.tokens.push({ t: 'op', op });
  s.xInTokens = false; s.cycle = null;
  if (opts.chain) {
    const r = evaluate(s.tokens.slice(0, -1), true, opts.prefs);
    s.x = r; showX(s);
  } else showX(s);
  s.fresh = true;
}

function openParen(s: CalcState) {
  const last = s.tokens[s.tokens.length - 1];
  if (s.entry || s.xInTokens || (last && last.t === 'v')) throw new CalcError('ENT', 'Press an operator before "(".');
  if (depth(s.tokens) >= 21) throw new CalcError('ENT', 'Maximum 21 open parentheses.');
  s.tokens.push({ t: '(' });
  s.display = { ...s.display, note: `( ×${depth(s.tokens)}` };
}
const depth = (t: Tok[]) => t.filter((x) => x.t === '(').length - t.filter((x) => x.t === ')').length;

function closeParen(s: CalcState, opts: CalcOptions) {
  if (depth(s.tokens) <= 0) throw new CalcError('ENT', 'No open parenthesis to close.');
  operandForOp(s, opts.prefs);
  // evaluate innermost group
  const i = s.tokens.map((t) => t.t).lastIndexOf('(');
  const inner = s.tokens.slice(i + 1);
  const r = evaluate(inner, opts.chain, opts.prefs);
  s.tokens = [...s.tokens.slice(0, i), { t: 'v', q: r }];
  s.x = r; s.xInTokens = true; s.fresh = true;
  showX(s);
}

function equals(s: CalcState, opts: CalcOptions) {
  if (!s.tokens.length && !s.entry) { if (s.x) { s.fresh = true; showX(s, '='); } return; }
  operandForOp(s, opts.prefs);
  const toks = [...s.tokens];
  while (depth(toks) > 0) toks.push({ t: ')' });
  const r = evaluate(toks, opts.chain, opts.prefs);
  const lines: Array<{ op: string; q: Q }> = [];
  let lastOp = '';
  for (const t of toks) {
    if (t.t === 'op') lastOp = ({ '+': '+', '-': '−', '*': '×', '/': '÷', '^': '^', root: 'ʸ√' } as Record<string, string>)[t.op];
    else if (t.t === 'v') { lines.push({ op: lastOp, q: t.q }); lastOp = ''; }
  }
  s.tapeQ = [...s.tapeQ, ...lines, { op: '=', q: r }].slice(-30);
  s.lastEval = { id: (s.lastEval?.id ?? 0) + 1, tokens: toks, result: r };
  s.tokens = [];
  setX(s, r, true);
  s.cycle = null;
  showX(s, '=');
}

function percent(s: CalcState, opts: CalcOptions) {
  const val = currentValue(s, opts.prefs);
  if (val.kind !== 'num') throw new CalcError('DIM', 'Percent needs a plain number, e.g. 18 %.');
  const p = val.v / 100;
  const lastOp = [...s.tokens].reverse().find((t) => t.t === 'op') as { t: 'op'; op: Op } | undefined;
  const trailing = s.tokens[s.tokens.length - 1];
  if (!trailing || trailing.t !== 'op' || !lastOp) {
    setX(s, num(p, 'pct'), true); showX(s); return;
  }
  let right: Q;
  if (trailing.op === '+' || trailing.op === '-') {
    const base = evaluate(s.tokens.slice(0, -1), opts.chain, opts.prefs);
    right = { ...base, v: base.v * p };
  } else right = num(p);
  s.tokens.push({ t: 'v', q: right });
  s.xInTokens = true; s.entry = null;
  equals(s, opts);
}

function unary(s: CalcState, fn: string, prefs: FormatPrefs) {
  if (fn === 'neg' && s.entry) { s.entry.neg = !s.entry.neg; showEntry(s); return; }
  if (fn === 'pi') { s.entry = null; setX(s, num(Math.PI), true); showX(s, 'π'); return; }
  let x: Q;
  if (s.entry) { commitEntry(s, prefs); x = s.x!; }
  else if (s.xInTokens) { x = s.x!; s.tokens = s.tokens.slice(0, -1); }
  else x = s.x ?? num(0);
  let r: Q; let label = '';
  const plain = (q: Q, what: string) => {
    if (q.kind !== 'num') throw new CalcError('DIM', `${what} needs a plain number or angle, not a dimensioned value.`);
    return q.v;
  };
  switch (fn) {
    case 'sq': r = powQ(x, 2, prefs); label = 'x²'; break;
    case 'sqrt': r = sqrtQ(x, prefs); label = '√'; break;
    case 'sin': r = num(Math.sin(deg2rad(plain(x, 'Sine')))); label = 'sin'; break;
    case 'cos': r = num(Math.cos(deg2rad(plain(x, 'Cosine')))); label = 'cos'; break;
    case 'tan': {
      const a = plain(x, 'Tangent');
      if (Math.abs((((a % 180) + 180) % 180) - 90) < 1e-12) throw new CalcError('MATH', 'tan 90° is undefined.');
      r = num(Math.tan(deg2rad(a))); label = 'tan'; break;
    }
    case 'asin': case 'acos': {
      const v = plain(x, 'Inverse trig');
      if (v < -1 || v > 1) throw new CalcError('MATH', `${fn === 'asin' ? 'sin⁻¹' : 'cos⁻¹'} needs a value from −1 to 1.`);
      r = num(rad2deg(fn === 'asin' ? Math.asin(v) : Math.acos(v)), 'deg'); label = fn === 'asin' ? 'sin⁻¹' : 'cos⁻¹'; break;
    }
    case 'atan': r = num(rad2deg(Math.atan(plain(x, 'Arctangent'))), 'deg'); label = 'tan⁻¹'; break;
    case 'recip': {
      if (x.v === 0) throw new CalcError('MATH', 'Division by zero.');
      if (x.kind !== 'num') throw new CalcError('DIM', `1/x of ${x.kind === 'len' ? 'a length' : 'this value'} has no supported unit.`);
      r = num(1 / x.v); label = '1/x'; break;
    }
    case 'neg': r = negate(x); label = '±'; break;
    case 'dms': {
      if (x.kind !== 'num') throw new CalcError('DIM', 'D:M:S converts angles (plain numbers).');
      r = num(x.v, x.unit === 'dms' ? 'deg' : 'dms'); label = x.unit === 'dms' ? 'DEG' : 'DMS'; break;
    }
    default: throw new CalcError('ENT', 'Unknown function.');
  }
  setX(s, r, true); s.cycle = null;
  showX(s, label);
}

function circleKey(s: CalcState, prefs: FormatPrefs) {
  if (s.cycle?.key === 'circle' && !s.entry) return advance(s);
  let d = currentValue(s, prefs);
  if (d.kind === 'num' && d.unit === 'none') d = { v: d.v, kind: 'len', dim: 1, unit: 'infrac' };
  if (d.kind !== 'len' || d.dim !== 1) throw new CalcError('DIM', 'Circle needs a diameter (a length).');
  if (d.v <= 0) throw new CalcError('INPUT', 'Diameter must be greater than zero.');
  const c = circle(d.v);
  const fam = d.unit === 'ftin' || d.unit === 'ftdec' ? 'sqft' : d.unit === 'mm' || d.unit === 'm' ? 'sqm' : 'sqin';
  startCycle(s, 'circle', [
    { label: 'DIA', q: d, tag: 'entered' },
    { label: 'AREA', q: { v: c.area, kind: 'len', dim: 2, unit: fam as Unit }, tag: 'solved' },
    { label: 'CIRC', q: { v: c.circumference, kind: 'len', dim: 1, unit: d.unit }, tag: 'solved' },
  ]);
}

function mplus(s: CalcState, minus: boolean, prefs: FormatPrefs) {
  if (!minus && s.cycle?.key === 'mem' && !s.entry) return memCycle(s, false);
  const q = currentValue(s, prefs);
  const signed = minus ? negate(q) : q;
  s.mem.sum = s.mem.sum ? add(s.mem.sum, signed, 1, prefs) : signed;
  s.mem.count++;
  s.display = { label: minus ? 'M−' : 'M+', q, tag: 'info', note: 'M' };
  s.fresh = false;
}

function memCycle(s: CalcState, start: boolean) {
  if (!s.mem.sum) { s.display = { label: 'M', q: num(0), tag: 'info' }; return; }
  if (start) {
    const items: Display[] = [
      { label: 'TTL', q: s.mem.sum, tag: 'value' },
      { label: 'AVG', q: { ...s.mem.sum, v: s.mem.sum.v / s.mem.count }, tag: 'value' },
      { label: 'CNT', q: num(s.mem.count), tag: 'value' },
    ];
    startCycle(s, 'mem', items);
  } else advance(s);
}

function startCycle(s: CalcState, key: string, items: Display[]) {
  s.cycle = { key, i: 0, items };
  showItem(s);
}
function advance(s: CalcState) {
  const c = s.cycle!;
  s.cycle = { ...c, i: (c.i + 1) % c.items.length };
  showItem(s);
}
function showItem(s: CalcState) {
  const it = s.cycle!.items[s.cycle!.i];
  s.display = { ...it, note: s.cycle!.items.length > 1 ? `${s.cycle!.i + 1}/${s.cycle!.items.length}` : undefined };
  if (it.q) { s.x = it.q; s.xInTokens = false; s.fresh = false; }
}

function clearKey(s: CalcState): CalcState {
  const second = s0IsC(s);
  const n: CalcState = { ...s, entry: null, error: null, cycle: null, pending: null, conv: false, x: null, fresh: false, xInTokens: false };
  n.display = { label: '', q: num(0), tag: 'value' };
  if (second) {
    n.tokens = [];
    const r = n.regs;
    n.regs = { ...r, O: undefined, A: undefined, L: undefined, theta: undefined, roll: undefined, geoOrder: [], takeout: undefined, flow: undefined, vel: undefined, press: undefined, force: undefined, area: undefined };
    n.display = { label: 'CLEAR', text: 'Entries and project values cleared', tag: 'info' };
  }
  n.lastCKey = !second;
  n.lastKey = 'C';
  return n;
}
function s0IsC(s: CalcState) { return s.lastCKey; }

function clearAll(s: CalcState): CalcState {
  const n = initialState();
  n.M = s.M; n.openPrefs = s.openPrefs; n.lastEval = s.lastEval;
  n.display = { label: 'ALL CLEARED', text: 'Defaults restored: Steel · Std · BW-L · gap 1/8" · water 62.428 lb/ft³', tag: 'info' };
  return n;
}

// ---------------------------------------------------------------- project keys
function hasInput(s: CalcState) { return !!s.entry || (s.fresh && !!s.x); }

function takeInput(s: CalcState, opts: CalcOptions): Q | null {
  if (!s.entry && !(s.fresh && s.x)) return null;
  if (s.tokens.length) {
    // finish the pending arithmetic first: "12 + 3 Offset" enters 15
    const last = s.tokens[s.tokens.length - 1];
    if (last.t === 'op' && !s.entry) s.tokens.pop();
    equals(s, opts);
  } else commitEntry(s, opts.prefs);
  const q = s.x!;
  s.fresh = false; s.xInTokens = false;
  return q;
}

function asLength(q: Q, what: string): { v: number; unit: LenUnit } {
  if (q.kind === 'num' && (q.unit === 'none')) return { v: q.v, unit: 'infrac' };
  if (q.kind === 'len' && q.dim === 1) return { v: q.v, unit: q.unit as LenUnit };
  throw new CalcError('DIM', `${what} must be a length (e.g. 24 Inch).`);
}

const GEO_LABEL: Record<GeoKey, string> = { O: 'OFST', A: 'RUN', L: 'TRAV', theta: '∠' };

function setGeo(s: CalcState, k: GeoKey, v: number): string | null {
  const r = s.regs;
  r[k] = v;
  r.geoOrder = r.geoOrder.filter((x) => x !== k);
  r.geoOrder.push(k);
  let dropped: string | null = null;
  while (r.geoOrder.length > 2) {
    const old = r.geoOrder.shift()!;
    r[old] = undefined;
    dropped = GEO_LABEL[old];
  }
  return dropped;
}

interface Geo { O: number; A: number; L: number; theta: number; Ores: number; rolling: boolean }
function solveGeo(r: Regs): Geo {
  const pick = (k: GeoKey) => (r.geoOrder.includes(k) ? r[k] : undefined);
  if (r.roll !== undefined) {
    const R = solveRollingOffset({ H: pick('O'), V: r.roll, A: pick('A'), L: pick('L'), theta: pick('theta') });
    return { O: R.H, A: R.A, L: R.L, theta: R.theta, Ores: R.Ores, rolling: true };
  }
  const S = solveSimpleOffset({ O: pick('O'), A: pick('A'), L: pick('L'), theta: pick('theta') });
  return { O: S.O, A: S.A, L: S.L, theta: S.theta, Ores: S.O, rolling: false };
}

function pipeFor(r: Regs) {
  if (!r.nps) return null;
  return pipeProps(r.material, r.ptype, r.nps, r.densityPcf);
}

function takeoutFor(r: Regs, theta: number) {
  if (r.takeout !== undefined) return { to: r.takeout, arcs: null as ReturnType<typeof arcs> | null, note: 'Known take-out (entered)' };
  if (!r.nps) return null;
  if (!['steel', 'stainless', 'aluminum'].includes(r.material) || !B169[r.nps]) return null;
  const t = elbowTakeout(r.nps, theta, r.elbow);
  return { to: t.takeout, arcs: t.arcs, note: t.note };
}

function lenQ(v: number, unit: LenUnit): Q { return { v, kind: 'len', dim: 1, unit }; }

function travelItems(s: CalcState): Display[] {
  const r = s.regs;
  const g = solveGeo(r);
  const u = r.lenUnit;
  const items: Display[] = [{ label: g.rolling ? 'LNTH' : 'TRAV', q: lenQ(g.L, u), tag: 'solved', note: undefined }];
  const t = g.theta > 0 && g.theta <= 90 ? takeoutFor(r, g.theta) : null;
  if (t) {
    const cut = g.L - 2 * t.to - 2 * r.gap;
    items.push(cut < 0
      ? { label: 'CUT', text: `Impossible: fittings + gaps exceed travel by ${(-cut).toFixed(4)}"`, tag: 'error' }
      : { label: 'CUT', q: lenQ(cut, u), tag: 'solved', text: undefined });
    items.push({ label: 'TO', q: lenQ(t.to, u), tag: 'solved', note: t.note });
    items.push({ label: 'GAP', q: lenQ(r.gap, 'infrac'), tag: 'entered' });
  }
  items.push({ label: 'FIT°', q: num(g.theta, 'deg'), tag: r.geoOrder.includes('theta') ? 'entered' : 'solved' });
  if (t && t.arcs) {
    items.push({ label: 'IARC', q: lenQ(t.arcs.inside, u), tag: 'solved' });
    items.push({ label: 'CARC', q: lenQ(t.arcs.center, u), tag: 'solved' });
    items.push({ label: 'OARC', q: lenQ(t.arcs.outside, u), tag: 'solved' });
  }
  items.push({ label: 'RUN', q: lenQ(g.A, u), tag: r.geoOrder.includes('A') ? 'entered' : 'solved' });
  items.push({ label: 'OFST', q: lenQ(g.O, u), tag: r.geoOrder.includes('O') ? 'entered' : 'solved' });
  if (g.rolling) {
    items.push({ label: 'ROLL', q: lenQ(r.roll!, u), tag: 'entered' });
    items.push({ label: 'TRUE OFST', q: lenQ(g.Ores, u), tag: 'solved' });
  }
  return items;
}

function recallReg(s: CalcState, fn: string) {
  const r = s.regs;
  const map: Record<string, [string, number | undefined, boolean]> = {
    offset: ['OFST', r.O, true], run: ['RUN', r.A, true], travel: ['TRAV', r.L, true], angle: ['∠', r.theta, false],
    gap: ['GAP', r.gap, true], takeout: ['TO', r.takeout, true], roll: ['ROLL', r.roll, true],
  };
  const [label, v, isLen] = map[fn];
  if (v === undefined) { s.display = { label, text: 'not set', tag: 'info' }; return; }
  const q = isLen ? lenQ(v, r.lenUnit) : num(v, 'deg');
  s.display = { label, q, tag: 'entered' };
  setX(s, q, true);
}

function projectKey(s: CalcState, fn: Fn, opts: CalcOptions) {
  const r = s.regs;
  const cyc = s.cycle?.key;
  const hadTokens = s.tokens.length > 0;
  const input = hasInput(s) ? takeInput(s, opts) : null;

  switch (fn) {
    case 'offset': case 'run': case 'travel': {
      const k: GeoKey = fn === 'offset' ? 'O' : fn === 'run' ? 'A' : 'L';
      if (input) {
        const l = asLength(input, GEO_LABEL[k]);
        if (l.v < 0) throw new CalcError('INPUT', 'Enter a positive dimension.');
        r.lenUnit = l.unit;
        const dropped = setGeo(s, k, l.v);
        s.cycle = null;
        s.display = { label: GEO_LABEL[k], q: lenQ(l.v, l.unit), tag: 'entered', note: dropped ? `replaces ${dropped}` : undefined };
        return;
      }
      if (fn === 'travel') {
        if (cyc === 'travel') return advance(s);
        return startCycle(s, 'travel', travelItems(s));
      }
      const g = solveGeo(r);
      const v = k === 'O' ? g.O : g.A;
      s.cycle = null;
      s.display = { label: GEO_LABEL[k], q: lenQ(v, r.lenUnit), tag: r.geoOrder.includes(k) ? 'entered' : 'solved' };
      s.x = s.display.q!; s.fresh = false;
      return;
    }
    case 'angle': {
      if (input) {
        let th: number; let note = '';
        if (input.kind === 'num' && input.unit === 'pct') { th = angleFromGrade(input.v); note = 'from % grade'; }
        else if (input.kind === 'num') th = input.v;
        else if (input.kind === 'len' && input.dim === 1) { th = angleFromSlopePerFt(input.v); note = 'from slope per foot'; }
        else throw new CalcError('DIM', 'Angle/Slope takes an angle, a slope (inches per foot) or a % grade.');
        if (!(th > 0) || th > 90) throw new CalcError('GEOM', 'Angle must be greater than 0° and at most 90°.');
        const dropped = setGeo(s, 'theta', th);
        s.cycle = null;
        s.display = { label: '∠', q: num(th, 'deg'), tag: 'entered', note: [note, dropped ? `replaces ${dropped}` : ''].filter(Boolean).join(' · ') || undefined };
        return;
      }
      if (cyc === 'takeout') return advance(s);
      if (cyc === 'angle') return advance(s);
      const g = solveGeo(r);
      const tag = r.geoOrder.includes('theta') ? 'entered' : 'solved';
      const tanv = Math.tan(deg2rad(g.theta));
      const items: Display[] = [{ label: '∠', q: num(g.theta, 'deg'), tag }];
      if (g.theta < 90) {
        items.push({ label: 'SLP', q: lenQ(tanv * 12, 'infrac'), tag, note: 'per foot of run' });
        items.push({ label: '% GRD', q: num(tanv * 100), tag });
        items.push({ label: 'GRD', q: num(tanv), tag });
      }
      return startCycle(s, 'angle', items);
    }
    case 'roll': {
      if (input) {
        const l = asLength(input, 'Roll');
        r.roll = Math.abs(l.v);
        r.lenUnit = l.unit;
      }
      if (r.roll === undefined) throw new CalcError('INPUT', 'Enter the roll (the second offset component), then press Roll.');
      if (!input && cyc === 'travel') return advance(s);
      return startCycle(s, 'travel', travelItems(s));
    }
    case 'takeout': {
      if (input) {
        const l = asLength(input, 'Take-out');
        if (l.v < 0) throw new CalcError('INPUT', 'Take-out must not be negative.');
        r.takeout = l.v; s.cycle = null;
        s.display = { label: 'TO', q: lenQ(l.v, 'infrac'), tag: 'entered', note: 'known take-out' };
        return;
      }
      if (cyc === 'takeout') return advance(s);
      const theta = r.theta ?? solveGeo(r).theta;
      if (r.takeout !== undefined) return startCycle(s, 'takeout', [{ label: 'TO', q: lenQ(r.takeout, 'infrac'), tag: 'entered' }]);
      if (!r.nps) throw new CalcError('DATA', 'Enter a pipe size (Pipe Size key) or a known take-out first.');
      if (!['steel', 'stainless', 'aluminum'].includes(r.material)) throw new CalcError('DATA', `No butt-weld elbow data for ${MATERIALS[r.material].label}. Enter a known take-out.`);
      const t = elbowTakeout(r.nps, theta, r.elbow);
      return startCycle(s, 'takeout', [
        { label: 'TO', q: lenQ(t.takeout, 'infrac'), tag: 'solved', note: t.note },
        { label: 'IARC', q: lenQ(t.arcs!.inside, 'infrac'), tag: 'solved' },
        { label: 'CARC', q: lenQ(t.arcs!.center, 'infrac'), tag: 'solved' },
        { label: 'OARC', q: lenQ(t.arcs!.outside, 'infrac'), tag: 'solved' },
      ]);
    }
    case 'gap': {
      if (input) {
        const l = asLength(input, 'Gap');
        if (l.v < 0) throw new CalcError('INPUT', 'Gap must be zero or positive.');
        r.gap = l.v;
      }
      s.cycle = null;
      s.display = { label: 'GAP', q: lenQ(r.gap, 'infrac'), tag: 'entered', note: 'deducted at each of the two joints' };
      return;
    }
    case 'cutback': {
      if (input) throw new CalcError('ENT', 'Cutback is calculated: enter the bend angle (Angle) and the spacing between pipes (Offset) first.');
      if (r.theta === undefined || r.O === undefined) throw new CalcError('INPUT', 'Cutback needs the bend angle (Angle/Slope) and the pipe spacing (Offset).');
      const c = parallelCutback(r.O, r.theta);
      s.cycle = null;
      s.display = { label: 'CUT', q: lenQ(c, r.lenUnit), tag: 'solved', note: 'spacing × tan(θ/2)' };
      s.x = s.display.q!;
      return;
    }
    case 'material': {
      if (input) throw new CalcError('ENT', 'Pipe Material cycles with each press; no number needed.');
      if (s.lastKey === 'material') {
        const i = MATERIAL_ORDER.indexOf(r.material);
        r.material = MATERIAL_ORDER[(i + 1) % MATERIAL_ORDER.length];
        r.ptype = defaultType(r.material);
        if (r.nps && !sizesFor(r.material, r.ptype).includes(r.nps)) r.nps = undefined;
      }
      s.cycle = null;
      s.display = { label: 'MATL', text: MATERIALS[r.material].label, tag: 'info', note: MATERIALS[r.material].datasets.length ? undefined : 'no bundled dimensions' };
      return;
    }
    case 'ptype': {
      const types = typesFor(r.material);
      if (!types.length) throw new CalcError('DATA', MATERIALS[r.material].coverage);
      if (input) {
        if (input.kind !== 'num') throw new CalcError('ENT', 'Enter a schedule number, e.g. 80.');
        const n = String(input.v);
        const t = types.find((x) => x === n) ?? types.find((x) => x === `${n}S`) ?? types.find((x) => x === `SDR ${n}`);
        if (!t) throw new CalcError('DATA', `Type ${n} is not available for ${MATERIALS[r.material].label}. Available: ${types.join(', ')}.`);
        r.ptype = t;
      } else if (s.lastKey === 'ptype') {
        r.ptype = types[(types.indexOf(r.ptype) + 1) % types.length];
      }
      if (r.nps && !sizesFor(r.material, r.ptype).includes(r.nps)) r.nps = undefined;
      s.cycle = null;
      s.display = { label: 'TYPE', text: `${r.ptype} · ${MATERIALS[r.material].label}`, tag: 'info' };
      return;
    }
    case 'size': {
      if (input) {
        let v: number;
        if (input.kind === 'num' && input.unit === 'none') v = input.v;
        else if (input.kind === 'len' && input.dim === 1 && (input.unit === 'infrac' || input.unit === 'indec')) v = input.v;
        else throw new CalcError('DIM', 'Enter the nominal size in inches, e.g. 6 Inch or 1 Inch 1/2.');
        const lab = npsLabel(v);
        if (!lab) throw new CalcError('DATA', `${v}" is not a standard nominal size.`);
        const sizes = sizesFor(r.material, r.ptype);
        if (!MATERIALS[r.material].datasets.length) throw new CalcError('DATA', MATERIALS[r.material].coverage);
        if (!sizes.includes(lab)) throw new CalcError('DATA', `NPS ${lab} is not listed for ${MATERIALS[r.material].label} type ${r.ptype}.`);
        r.nps = lab;
      } else if (cyc === 'size') return advance(s);
      if (!r.nps) throw new CalcError('INPUT', 'Enter a nominal size, then press Pipe Size.');
      const p = pipeFor(r)!;
      const items: Display[] = [
        { label: 'SIZE', text: `${r.nps}" NPS · ${r.ptype}`, tag: 'entered', note: 'nominal size (not the OD)' },
        { label: 'OD', q: lenQ(p.od, 'indec'), tag: 'value' },
        { label: 'ID', q: lenQ(p.id, 'indec'), tag: 'value' },
        { label: 'THK', q: lenQ(p.wall, 'indec'), tag: 'value' },
        { label: 'MATL', text: MATERIALS[r.material].label, tag: 'info' },
      ];
      if (p.weightPerFt !== null) items.push({ label: 'PIPE', q: { v: p.weightPerFt, kind: 'weight', dim: 0, unit: 'lb' }, tag: 'value', note: 'per foot, empty' });
      if (p.filledPerFt !== null) items.push({ label: 'FILL', q: { v: p.filledPerFt, kind: 'weight', dim: 0, unit: 'lb' }, tag: 'value', note: 'per foot, filled (Wt/Vol fluid)' });
      items.push({ label: 'AREA', q: { v: p.area, kind: 'len', dim: 2, unit: 'sqin' }, tag: 'value', note: 'internal' });
      return startCycle(s, 'size', items);
    }
    case 'elbow': {
      if (s.lastKey === 'elbow') r.elbow = ELBOW_ORDER[(ELBOW_ORDER.indexOf(r.elbow) + 1) % ELBOW_ORDER.length];
      s.cycle = null;
      s.display = { label: 'EL. TYPE', text: r.elbow, tag: 'info' };
      return;
    }
    case 'flow': case 'vel': case 'press': case 'force': case 'area':
      return hydraulicKey(s, fn, input, cyc, opts.lossMethod ?? 'standard');
    case 'wtvol': {
      if (input) {
        if (input.kind !== 'num') throw new CalcError('DIM', 'Enter the density as a plain number in the unit shown.');
        r.densityPcf = input.v * DENS_TO_PCF[r.densUnit];
      } else if (s.lastKey === 'wtvol') {
        const order: DensUnit[] = ['pcf', 'pci', 'ppg', 'kgm3', 'kgL'];
        r.densUnit = order[(order.indexOf(r.densUnit) + 1) % order.length];
      }
      s.cycle = null;
      s.display = { label: 'WT/VOL', q: { v: r.densityPcf, kind: 'dens', dim: 0, unit: r.densUnit }, tag: input ? 'entered' : 'info' };
      return;
    }
    case 'unitcost': {
      if (!input || input.kind !== 'num') throw new CalcError('ENT', 'Type the unit cost, then Conv 0 (Unit $).');
      r.unitCost = input.v;
      s.display = { label: 'COST PER', q: { v: input.v, kind: 'money', dim: 0, unit: 'usd' }, tag: 'entered' };
      return;
    }
    case 'cost': {
      if (hadTokens) {
        // the pending expression (e.g. 17 × 2.89) was evaluated by takeInput; show it as a cost
        const t = input ?? s.x!;
        if (t.kind !== 'num') throw new CalcError('DIM', 'Cost needs a plain number.');
        s.display = { label: 'TTL$', q: { v: t.v, kind: 'money', dim: 0, unit: 'usd' }, tag: 'solved' };
        return;
      }
      const qty = input ?? s.x;
      if (!qty || qty.kind !== 'num') throw new CalcError('ENT', 'Enter a quantity, then Cost.');
      if (r.unitCost === undefined) throw new CalcError('INPUT', 'Store a unit cost first (value, Conv 0).');
      s.display = { label: 'TTL$', q: { v: qty.v * r.unitCost, kind: 'money', dim: 0, unit: 'usd' }, tag: 'solved' };
      return;
    }
  }
  throw new CalcError('ENT', `Key ${fn} is not available.`);
}

function hydraulicKey(s: CalcState, fn: 'flow' | 'vel' | 'press' | 'force' | 'area', input: Q | null, cyc: string | undefined, lossMethod: LossMethod = 'standard') {
  const r = s.regs;
  if (input) {
    switch (fn) {
      case 'flow': r.flow = input.kind === 'flow' ? input.v : asPlain(input, 'Flow') * FLOW_TO_CFS.gpm;
        s.display = { label: 'FLOW', q: { v: r.flow, kind: 'flow', dim: 0, unit: input.kind === 'flow' ? input.unit : 'gpm' }, tag: 'entered' }; break;
      case 'vel': r.vel = input.kind === 'vel' ? input.v : asPlain(input, 'Velocity') * VEL_TO_FPS.fps;
        s.display = { label: 'VEL', q: { v: r.vel, kind: 'vel', dim: 0, unit: 'fps' }, tag: 'entered' }; break;
      case 'press': r.press = input.kind === 'press' ? input.v : asPlain(input, 'Pressure') * PRESS_TO_PSI.psi;
        s.display = { label: 'PRESS', q: { v: r.press, kind: 'press', dim: 0, unit: 'psi' }, tag: 'entered' }; break;
      case 'force': r.force = input.kind === 'force' ? input.v : asPlain(input, 'Force');
        s.display = { label: 'FORCE', q: { v: r.force, kind: 'force', dim: 0, unit: 'lbf' }, tag: 'entered' }; break;
      case 'area':
        if (input.kind === 'len' && input.dim === 2) r.area = input.v; else r.area = asPlain(input, 'Area');
        s.display = { label: 'AREA', q: { v: r.area, kind: 'len', dim: 2, unit: 'sqin' }, tag: 'entered' }; break;
    }
    s.cycle = null;
    return;
  }
  if (cyc === fn) return advance(s);
  const pipe = r.nps ? pipeFor(r) : null;
  const area = r.area ?? pipe?.area;
  const needArea = () => { if (area === undefined) throw new CalcError('INPUT', 'Enter an Area, or select a pipe size so its internal area can be used.'); return area; };
  switch (fn) {
    case 'flow': {
      let q: number;
      if (r.vel !== undefined && (area !== undefined)) q = r.vel * (needArea() / 144);
      else if (r.flow !== undefined) q = r.flow;
      else throw new CalcError('INPUT', 'Flow needs Velocity and Area (or a pipe size).');
      return startCycle(s, 'flow', (['gpm', 'cfm', 'cfs', 'lps', 'm3s'] as const).map((u) => ({ label: u.toUpperCase().replace('LPS', 'L/S').replace('M3S', 'M³/S'), q: { v: q, kind: 'flow', dim: 0, unit: u }, tag: 'solved' as const })));
    }
    case 'vel': {
      let v: number;
      if (r.flow !== undefined && area !== undefined) { if (needArea() <= 0) throw new CalcError('MATH', 'Area is zero.'); v = r.flow / (needArea() / 144); }
      else if (r.vel !== undefined) v = r.vel;
      else throw new CalcError('INPUT', 'Velocity needs Flow and Area (or a pipe size).');
      return startCycle(s, 'vel', (['fps', 'fpm', 'mps'] as const).map((u) => ({ label: u.toUpperCase(), q: { v, kind: 'vel', dim: 0, unit: u }, tag: 'solved' as const })));
    }
    case 'area': {
      let a: number; let note: string;
      if (r.force !== undefined && r.press !== undefined) { if (r.press === 0) throw new CalcError('MATH', 'Pressure is zero — division by zero.'); a = r.force / r.press; note = 'Force ÷ Pressure'; }
      else if (r.flow !== undefined && r.vel !== undefined) { if (r.vel === 0) throw new CalcError('MATH', 'Velocity is zero — division by zero.'); a = (r.flow / r.vel) * 144; note = 'Flow ÷ Velocity'; }
      else if (pipe) { a = pipe.area; note = `internal area, NPS ${r.nps} ${r.ptype}`; }
      else throw new CalcError('INPUT', 'Area needs Force & Pressure, Flow & Velocity, or a pipe size.');
      s.cycle = null;
      s.display = { label: 'AREA', q: { v: a, kind: 'len', dim: 2, unit: 'sqin' }, tag: 'solved', note };
      s.x = s.display.q!; s.fresh = false;
      return;
    }
    case 'force': {
      if (r.press === undefined) throw new CalcError('INPUT', 'Force needs Pressure and Area.');
      const f = r.press * needArea();
      return startCycle(s, 'force', [
        { label: 'LBF', q: { v: f, kind: 'force', dim: 0, unit: 'lbf' }, tag: 'solved' },
        { label: 'NEWT', q: { v: f, kind: 'force', dim: 0, unit: 'N' }, tag: 'solved' },
      ]);
    }
    case 'press': {
      const pu = ['psi', 'psf', 'inHg', 'ftH2O', 'bar', 'kPa'] as const;
      if (r.force !== undefined) {
        const a = needArea();
        if (a === 0) throw new CalcError('MATH', 'Area is zero — division by zero.');
        const p = r.force / a;
        return startCycle(s, 'press', pu.map((u) => ({ label: u.toUpperCase(), q: { v: p, kind: 'press', dim: 0, unit: u }, tag: 'solved' as const })));
      }
      if (!pipe) throw new CalcError('DATA', 'Pressure loss needs a pipe size (for the inside diameter) and a Flow or Velocity. For P = F/A enter Force and Area.');
      let q: number;
      if (r.flow !== undefined) q = r.flow;
      else if (r.vel !== undefined) q = r.vel * (pipe.area / 144);
      else throw new CalcError('INPUT', 'Enter a Flow or Velocity for the pressure-loss calculation.');
      const lenFt = r.A !== undefined && r.geoOrder.includes('A') ? r.A / 12 : null;
      const pl = pressureLoss(pipe.id, q, lossMethod === 'reference' ? MATERIALS[r.material].roughnessFt : MATERIALS[r.material].roughnessStdFt, lenFt, lossMethod);
      const per = pl.perFoot ? ' PER FT' : '';
      const items: Display[] = [
        { label: 'PSI' + per, q: { v: pl.psi, kind: 'press', dim: 0, unit: 'psi' }, tag: 'solved', note: pl.method },
        { label: 'REY', q: num(pl.Re), tag: 'solved', note: `f = ${pl.f.toFixed(6)}` },
        ...(['psf', 'inHg', 'ftH2O', 'bar', 'kPa'] as const).map((u) => ({ label: (u === 'ftH2O' ? 'HEAD' : u.toUpperCase()) + per, q: { v: pl.psi, kind: 'press' as const, dim: 0, unit: u }, tag: 'solved' as const })),
      ];
      return startCycle(s, 'press', items);
    }
  }
}

function asPlain(q: Q, what: string) {
  if (q.kind !== 'num') throw new CalcError('DIM', `${what}: enter a plain number (default unit) or a value with the matching unit.`);
  return q.v;
}

export { steelOD };
