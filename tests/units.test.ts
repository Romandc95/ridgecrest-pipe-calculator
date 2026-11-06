import { describe, it, expect } from 'vitest';
import { parseMeasurement, parseLength } from '../src/engine/parse';
import { formatFtIn, formatFracIn, splitFtIn, DEFAULT_PREFS, formatQ, formatDMS, FracDen } from '../src/engine/format';
import { add, mul, div, sqrtQ } from '../src/engine/arith';
import { fromUnit, MM_PER_IN, inDisplayUnit } from '../src/engine/units';

const P = (d: FracDen) => ({ ...DEFAULT_PREFS, fracDen: d });

describe('unit parsing', () => {
  it("5' 7 3/8\" = 67.375 in", () => expect(parseLength(`5' 7 3/8"`)).toBe(67.375));
  it('7 3/8" = 7.375 in', () => expect(parseLength('7 3/8"')).toBe(7.375));
  it('7-3/8" = 7.375 in', () => expect(parseLength('7-3/8"')).toBe(7.375));
  it('7.375 in', () => expect(parseLength('7.375 in')).toBe(7.375));
  it('150 mm', () => expect(parseLength('150 mm')).toBeCloseTo(150 / 25.4, 12));
  it('1.2 m', () => expect(parseLength('1.2 m')).toBeCloseTo(1200 / 25.4, 12));
  it('2.5 ft decimal feet', () => expect(parseLength('2.5 ft')).toBe(30));
  it("mixed units 1' 150 mm", () => expect(parseLength("1' 150 mm")).toBeCloseTo(12 + 150 / 25.4, 12));
  it("5' 7 (trailing number after feet = inches)", () => expect(parseLength("5' 7")).toBe(67));
  it('negative length', () => expect(parseLength('-3/4"')).toBe(-0.75));
  it('typographic quotes ′ ″', () => expect(parseLength('2′ 3″')).toBe(27));
  it('unitless = number', () => expect(parseMeasurement('42').kind).toBe('num'));
  it('degrees-minutes-seconds', () => expect(parseMeasurement(`23°42'39"`).v).toBeCloseTo(23.710833, 5));
  it('percent', () => expect(parseMeasurement('7.5%').v).toBe(0.075));
  it('rejects garbage', () => expect(() => parseMeasurement('abc')).toThrow());
  it('rejects zero denominator', () => expect(() => parseMeasurement('3/0"')).toThrow('zero denominator'));
  it('area entry 11 sq ft', () => { const q = parseMeasurement('11 sq ft'); expect(q.dim).toBe(2); expect(q.v).toBe(11 * 144); });
  it('flow 40 gpm', () => expect(parseMeasurement('40 gpm').kind).toBe('flow'));
});

describe('exact conversions', () => {
  it('1 inch = exactly 25.4 mm', () => { expect(MM_PER_IN).toBe(25.4); expect(inDisplayUnit({ ...fromUnit(1, 'in'), unit: 'mm' })).toBe(25.4); expect(parseLength('25.4 mm')).toBe(1); });
  it("10' 6\" → 10.5 ft, 126 in, 3200.4 mm, 3.200 m", () => {
    const q = parseMeasurement(`10' 6"`);
    expect(formatQ({ ...q, unit: 'ftdec' }, DEFAULT_PREFS)).toBe('10.5 ft');
    expect(formatQ({ ...q, unit: 'indec' }, DEFAULT_PREFS)).toBe('126 in');
    expect(formatQ({ ...q, unit: 'mm' }, DEFAULT_PREFS)).toBe('3200.4 mm');
    expect(formatQ({ ...q, unit: 'm' }, DEFAULT_PREFS)).toBe('3.200 m');
  });
  it('8.5 gal → 32.176 L', () => expect(inDisplayUnit({ ...fromUnit(8.5, 'gal'), unit: 'L' })).toBeCloseTo(32.1760, 3));
  it('20 lb → 9.071847 kg', () => expect(inDisplayUnit({ ...fromUnit(20, 'lb'), unit: 'kg' })).toBeCloseTo(9.071847, 6));
  it('78 °F → 25.55556 °C', () => expect(inDisplayUnit({ ...fromUnit(78, 'F'), unit: 'C' })).toBeCloseTo(25.555556, 5));
  it('11 °C → 51.8 °F', () => expect(inDisplayUnit({ ...fromUnit(11, 'C'), unit: 'F' })).toBeCloseTo(51.8, 9));
  it('47 cfs → 1330.892 L/s, 2820 cfm, 21095.07 gpm', () => {
    const q = fromUnit(47, 'cfs');
    expect(inDisplayUnit({ ...q, unit: 'lps' })).toBeCloseTo(1330.892, 3);
    expect(inDisplayUnit({ ...q, unit: 'cfm' })).toBeCloseTo(2820, 6);
    // exact: 47 × 448.8311688 = 21095.065 (reference display shows 21095.07)
    expect(inDisplayUnit({ ...q, unit: 'gpm' })).toBeCloseTo(21095.0649, 3);
  });
  it('5 gpm → 0.668403 cfm, 0.315451 L/s', () => {
    const q = fromUnit(5, 'gpm');
    expect(inDisplayUnit({ ...q, unit: 'cfm' })).toBeCloseTo(0.668403, 6);
    expect(inDisplayUnit({ ...q, unit: 'lps' })).toBeCloseTo(0.315451, 6);
  });
  it('5 fps → 300 fpm, 1.524 m/s', () => {
    const q = fromUnit(5, 'fps');
    expect(inDisplayUnit({ ...q, unit: 'fpm' })).toBeCloseTo(300, 9);
    expect(inDisplayUnit({ ...q, unit: 'mps' })).toBeCloseTo(1.524, 9);
  });
});

describe('fraction rounding & display', () => {
  it('rounds to 1/16 by default and reduces', () => expect(formatFracIn(33.941, DEFAULT_PREFS)).toBe('33-15/16"'));
  it('reduces 8/16 → 1/2', () => expect(formatFracIn(2.5, DEFAULT_PREFS)).toBe('2-1/2"'));
  it('carries across whole inch: 5.97" → 6" at 1/16', () => expect(formatFracIn(5.97, DEFAULT_PREFS)).toBe('6"'));
  it("carries inches into feet: 11.99\" → 1' 0\"", () => expect(formatFtIn(11.99, DEFAULT_PREFS)).toBe(`1' 0"`));
  it("carries 2' 11-31/32\" → 3' 0\" at 1/16", () => expect(formatFtIn(35 + 31 / 32, DEFAULT_PREFS)).toBe(`3' 0"`));
  it('1/32 resolution keeps 31/32', () => expect(formatFracIn(35 + 31 / 32, P(32))).toBe('35-31/32"'));
  it('1/64 resolution', () => expect(formatFracIn(1 / 64, P(64))).toBe('1/64"'));
  it('1/2 resolution', () => expect(formatFracIn(3.3, P(2))).toBe('3-1/2"'));
  it('1/8 resolution', () => expect(formatFracIn(3.3, P(8))).toBe('3-1/4"'));
  it('constant fraction mode keeps denominator', () => expect(formatFracIn(2.5, { ...DEFAULT_PREFS, fracMode: 'const' })).toBe('2-8/16"'));
  it('negative values', () => expect(formatFtIn(-14.5, DEFAULT_PREFS)).toBe(`−1' 2-1/2"`));
  it('tiny negative rounds to 0 without sign', () => expect(formatFracIn(-0.001, DEFAULT_PREFS)).toBe('0"'));
  it('internal precision preserved', () => { const s = splitFtIn(15.6205, 16, false); expect(s.exact).toBe(false); });
  it('D:M:S formatting 44.29° → 44° 17′ 24″', () => expect(formatDMS(44.29)).toBe('44° 17′ 24″'));
});

describe('dimensional arithmetic', () => {
  it("2' 3\" + 9\" = 3'", () => {
    const r = add(parseMeasurement(`2' 3"`), parseMeasurement('9"'), 1);
    expect(r.v).toBe(36); expect(formatQ(r, DEFAULT_PREFS)).toBe(`3' 0"`);
  });
  it('length × length = area', () => { const r = mul(parseMeasurement('2 ft'), parseMeasurement('3 ft')); expect(r.dim).toBe(2); expect(formatQ(r, DEFAULT_PREFS)).toBe('6 sq ft'); });
  it('area × length = volume', () => { const r = mul(parseMeasurement('6 sq ft'), parseMeasurement('2 ft')); expect(r.dim).toBe(3); expect(formatQ(r, DEFAULT_PREFS)).toBe('12 cu ft'); });
  it('volume × length rejected', () => expect(() => mul(parseMeasurement('1 cu ft'), parseMeasurement('1 ft'))).toThrow('length⁴'));
  it('length + plain number rejected with explanation', () => expect(() => add(parseMeasurement('2 ft'), parseMeasurement('3'), 1)).toThrow("Can't add"));
  it('length + area rejected', () => expect(() => add(parseMeasurement('2 ft'), parseMeasurement('3 sq ft'), 1)).toThrow());
  it('length ÷ length = number', () => { const r = div(parseMeasurement(`30' 4"`), parseMeasurement('7"')); expect(r.kind).toBe('num'); expect(r.v).toBeCloseTo(52, 12); });
  it('division by zero', () => expect(() => div(parseMeasurement('2 ft'), parseMeasurement('0'))).toThrow('zero'));
  it('√ area = length', () => { const r = sqrtQ(parseMeasurement('9 sq in')); expect(r.dim).toBe(1); expect(r.v).toBe(3); });
  it('√ length rejected', () => expect(() => sqrtQ(parseMeasurement('9 in'))).toThrow());
  it('metric + imperial mixes correctly', () => expect(add(parseMeasurement('1 in'), parseMeasurement('25.4 mm'), 1).v).toBe(2));
});
