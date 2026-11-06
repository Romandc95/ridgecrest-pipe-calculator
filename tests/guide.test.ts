// Worked examples from the reference calculator's user's guide, entered as key sequences.
import { describe, it, expect } from 'vitest';
import { run, shown, val } from './helpers';
import { press } from '../src/engine/calculator';
import { DEFAULT_PREFS } from '../src/engine/format';
import { pipeProps } from '../src/engine/pipedata';
import { pressureLoss } from '../src/engine/hydraulics';

const P32 = { ...DEFAULT_PREFS, fracDen: 32 as const };

describe('guide: dimensional math', () => {
  it('add/subtract string of dimensions', () => {
    let s = run('6 ft 2 in 1 frac 2 add 11 ft 5 in 1 frac 4 add 18.25 in eq');
    expect(shown(s)).toBe(`= 19' 2"`);
    s = run('sub 2 in 1 frac 8 eq', {}, s);
    expect(shown(s)).toBe(`= 18' 11-7/8"`);
  });
  it("5'3\" × 11'6-1/2\" = 60.59375 sq ft", () => expect(shown(run('5 ft 3 in mul 11 ft 6 in 1 frac 2 eq'))).toBe('= 60.59375 sq ft'));
  it("30'4\" ÷ 7\" = 52", () => expect(shown(run('30 ft 4 in div 7 in eq'))).toBe('= 52'));
  it("20'3\" ÷ 9 = 2'3\"", () => expect(shown(run('20 ft 3 in div 9 eq'))).toBe(`= 2' 3"`));
  it("2' 3\" + 9\" = 3' (key sequence)", () => expect(shown(run('2 ft 3 in add 9 in eq'))).toBe(`= 3' 0"`));
  it('order of operations 10 + 4 × 5 = 30', () => expect(val(run('10 add 4 mul 5 eq'))).toBe(30));
  it('chain mode 10 + 4 × 5 = 70', () => expect(val(run('10 add 4 mul 5 eq', { chain: true }))).toBe(70));
  it('parentheses (10 + 4) × 5 = 70', () => expect(val(run('( 10 add 4 ) mul 5 eq'))).toBe(70));
  it('powers: 2 xʸ 10 = 1024, root: 27 ʸ√ 3 = 3', () => { expect(val(run('2 pow 10 eq'))).toBe(1024); expect(val(run('27 c:pow 3 eq'))).toBeCloseTo(3, 12); });
  it('reciprocal 8 → 0.125, sign change', () => { expect(val(run('8 c:('))).toBe(0.125); expect(val(run('5 c:) add 2 eq'))).toBe(-3); });
  it('x² of a length gives area; √ gives length back', () => { expect(shown(run('3 ft sq'))).toBe('x² 9 sq ft'); expect(shown(run('9 ft ft sqrt'))).toBe(`√ 3' 0"`); });
  it('dimension error is explained', () => { const s = run('2 ft add 3 eq'); expect(s.display.label).toBe('DIM Error'); expect(s.display.text!).toMatch("Can't add"); });
  it('divide by zero', () => expect(run('5 div 0 eq').display.label).toBe('MATH Error'));
  it('mixed-unit entry: 1 ft + 150 mm', () => expect(val(run('1 ft add 150 mm eq'))).toBeCloseTo(12 + 150 / 25.4, 12));
  it('fraction default denominator: 3 / Inch = 3/16"', () => expect(val(run('3 frac in eq'))).toBe(3 / 16));
  it('repeated Feet toggles decimal feet; Inch, mm, m convert', () => {
    let s = run('10 ft 6 in eq ft'); expect(shown(s)).toBe('10.5 ft');
    s = run('in', {}, s); expect(shown(s)).toBe('126 in');
    s = run('mm', {}, s); expect(shown(s)).toBe('3200.4 mm');
    s = run('c:mm', {}, s); expect(shown(s)).toBe('3.200 m');
  });
  it('percent: 18% of 500 ft, −20%, +10%', () => {
    expect(shown(run('500 ft mul 18 c:sq'))).toBe(`= 90' 0"`);
    expect(shown(run('286 ft 6 in sub 20 c:sq'))).toBe(`= 229' 2-3/8"`);
    expect(shown(run('275 ft add 10 c:sq'))).toBe(`= 302' 6"`);
  });
});

describe('guide: conversions', () => {
  it('8.5 gal → L', () => expect(shown(run('8.5 c:7 c:8'))).toBe('32.176 L'));
  it('5 cu ft water → 312.1398 lb → 141.5842 kg', () => {
    let s = run('5 ft ft ft c:9'); expect(val(s)).toBeCloseTo(312.1398, 4);
    s = run('c:div', {}, s); expect(shown(s)).toMatch('141.5842');
  });
  it('1 m³ of 111 lb/ft³ concrete → 3919.928 lb', () => expect(val(run('111 c:store 1 c:mm c:mm c:mm c:9'))).toBeCloseTo(3919.928, 3));
  it('78 °F → 25.55556 °C', () => expect(shown(run('78 c:4 c:5'))).toBe('25.55556 °C'));
  it('D:M:S 23.42.39 → 23.71°; 44.29 → 44°17′24″', () => {
    expect(shown(run('23.42.39 c:sqrt'))).toBe('DEG 23.71°');
    expect(shown(run('44.29 c:sqrt'))).toBe('DMS 44° 17′ 24″');
  });
  it('trig: sin 30 = 0.5, tan⁻¹ 1 = 45°, tan 90 error', () => {
    expect(val(run('30 sin'))).toBeCloseTo(0.5, 12);
    expect(shown(run('1 c:tan'))).toBe('tan⁻¹ 45.00°');
    expect(run('90 tan').display.label).toBe('MATH Error');
  });
  it('circle Ø25" → area 490.8739 sq in, circ 78-9/16"', () => {
    let s = run('25 in circle'); expect(shown(s)).toBe('DIA 25"');
    s = run('circle', {}, s); expect(val(s)).toBeCloseTo(490.8739, 4);
    s = run('circle', {}, s); expect(shown(s)).toBe('CIRC 78-9/16"');
  });
});

describe('guide: memory & cost', () => {
  it('M+ 355, M+ 255, M− 745 → TTL −135, AVG −45, CNT 3', () => {
    let s = run('355 mplus 255 mplus 745 c:mplus recall mplus');
    expect(val(s)).toBe(-135);
    s = run('mplus', {}, s); expect(val(s)).toBe(-45);
    s = run('mplus', {}, s); expect(val(s)).toBe(3);
  });
  it('store/recall M1', () => { let s = run('175 store 1 C 0'); s = run('recall 1', {}, s); expect(val(s)).toBe(175); });
  it('cost: $3.21 unit, 12 → $38.52; 17 × 2.89 → $49.13', () => {
    expect(shown(run('3.21 c:0 12 c:mul'))).toBe('TTL$ $38.52');
    expect(shown(run('17 mul 2.89 c:mul'))).toBe('TTL$ $49.13');
  });
});

describe('guide: pipe layout key sequences', () => {
  it('simple offset known angle: 24" offset, 45° → 33-15/16"', () => expect(shown(run('24 in offset 45 angle travel'))).toBe('TRAV 33-15/16"'));
  it('simple offset unknown angle: 16" & 27" → 31-3/8", 30.65°', () => {
    let s = run('16 in offset 27 in run travel'); expect(shown(s)).toBe('TRAV 31-3/8"');
    s = run('angle', {}, s); expect(shown(s)).toBe('∠ 30.65°');
  });
  it('simple offset cut length, 6" stainless, gap 0', () => {
    let s = run('material material 6 in size 0 c:offset 10 in offset 12 in run travel');
    expect(s.regs.material).toBe('stainless');
    const seen: string[] = [shown(s)];
    for (let i = 0; i < 7; i++) { s = run('travel', {}, s); seen.push(shown(s)); }
    expect(seen).toEqual(['TRAV 15-5/8"', 'CUT 9-1/8"', 'TO 3-1/4"', 'GAP 0"', 'FIT° 39.81°', 'IARC 3-15/16"', 'CARC 6-1/4"', 'OARC 8-9/16"']);
  });
  it('rolling offset known angle: roll 4", offset 24", 45° → 34-7/16"', () => expect(shown(run('24 offset 45 angle 4 in c:travel'))).toBe('LNTH 34-7/16"'));
  it('rolling offset unknown angle: 17, 28, 6-1/2 → 33-3/8", 33.02°', () => {
    let s = run('17 in offset 28 in run 6 in 1 frac 2 c:travel'); expect(shown(s)).toBe('LNTH 33-3/8"');
    s = run('travel', {}, s); expect(shown(s)).toBe('FIT° 33.02°');
  });
  it('rolling offset cut length, 6" Std, gap 3/32" (1/32 display)', () => {
    let s = run('6 in size 3 frac 32 c:offset 24 in offset 32 in run 13 in c:travel', { prefs: P32 });
    const seen = [shown(s, P32)];
    for (let i = 0; i < 7; i++) { s = run('travel', { prefs: P32 }, s); seen.push(shown(s, P32)); }
    expect(seen).toEqual(['LNTH 42-1/16"', 'CUT 35-1/4"', 'TO 3-5/16"', 'GAP 3/32"', 'FIT° 40.46°', 'IARC 4-1/32"', 'CARC 6-11/32"', 'OARC 8-11/16"']);
    // guide note: at 1/16 resolution IARC = 4" and CARC = 6-3/8"
    const iarc = s.cycle!.items.find((x) => x.label === 'IARC')!.q!;
    expect(shown({ ...s, display: { label: 'IARC', q: iarc, tag: 'solved' } })).toBe('IARC 4"');
  });
  it('concentric bend cutback: 45°, 10" → 4-1/8"', () => expect(shown(run('45 angle 10 in offset c:run'))).toBe('CUT 4-1/8"'));
  it('take-out and cut marks: 12" pipe, 37° → TO 6", 7-1/2", 11-5/8", 15-3/4"', () => {
    let s = run('12 in size 37 angle c:angle'); const seen = [shown(s)];
    for (let i = 0; i < 3; i++) { s = run('angle', {}, s); seen.push(shown(s)); }
    expect(seen).toEqual(['TO 6"', 'IARC 7-1/2"', 'CARC 11-5/8"', 'OARC 15-3/4"']);
  });
  it('cut length with known take-out: 4" PVC Sch 40, 45°, TO 2-3/16", gap 0 → 14-1/8", 9-3/4"', () => {
    let s = run('material material material material material material');
    expect(s.regs.material).toBe('plastic');
    s = run('4 in size 10 in offset 45 angle 2 in 3 frac 16 c:angle 0 c:offset travel', {}, s);
    expect(shown(s)).toBe('TRAV 14-1/8"');
    s = run('travel', {}, s); expect(shown(s)).toBe('CUT 9-3/4"');
    s = run('travel', {}, s); expect(shown(s)).toBe('TO 2-3/16"');
  });
  it('combination rolling offset H→V: 39-15/16", 43.44°, then exit 67.94°', () => {
    let s = run('15 in offset 29 in run 23 in c:travel'); expect(shown(s)).toBe('LNTH 39-15/16"');
    s = run('travel', {}, s); expect(shown(s)).toBe('FIT° 43.44°');
    s = run('39 in 15 frac 16 travel 15 in run angle', {}, s); expect(shown(s)).toBe('∠ 67.94°');
  });
  it('combination H→H exit angle 54.84°', () => {
    let s = run('AC 15 in offset 23 in run 29 in c:travel'); s = run('travel', {}, s);
    expect(shown(s)).toBe('FIT° 54.84°');
  });
  it('calculating drop: 1/8" per ft over 25\' → 3-1/8"', () => expect(shown(run('1 frac 8 in angle 25 ft run offset'))).toBe(`OFST 0' 3-1/8"`));
  it('slope from 6" over 50\': SLP 1/8", 0.57°, 1%, 0.01', () => {
    let s = run('50 ft run 6 in offset angle'); expect(shown(s)).toBe('∠ 0.57°');
    s = run('angle', {}, s); expect(shown(s)).toBe('SLP 1/8"');
    s = run('angle', {}, s); expect(shown(s)).toBe('% GRD 1');
    s = run('angle', {}, s); expect(shown(s)).toBe('GRD 0.01');
  });
  it('entering vs solving: a typed value is stored, a bare press solves', () => {
    const s = run('3 in offset 4 in run');
    expect(s.display.tag).toBe('entered');
    expect(run('travel', {}, s).display.tag).toBe('solved');
  });
  it('a third geometric input replaces the oldest and says so', () => {
    const s = run('3 in offset 4 in run 30 angle');
    expect(s.display.note!).toMatch('replaces OFST');
  });
  it('impossible cut length is shown as an error item', () => {
    let s = run('6 in size 1 in offset 45 angle travel'); s = run('travel', {}, s);
    expect(s.display.tag).toBe('error'); expect(s.display.text!).toMatch('Impossible');
  });
});

describe('guide: pipe data, flow, pressure', () => {
  it('3" Steel Sch 80 data', () => {
    const p = pipeProps('steel', '80', '3');
    expect(p.od).toBe(3.5); expect(p.id).toBeCloseTo(2.9, 12); expect(p.wall).toBe(0.3);
    expect(p.area).toBeCloseTo(6.605199, 6);
    expect(p.filledPerFt! - p.weightPerFt!).toBeCloseTo(13.11634 - 10.2528, 3); // water per foot matches
    expect(p.weightPerFt!).toBeCloseTo(10.26, 2); // ASME B36.10M tabulated 10.26 lb/ft (reference shows 10.2528)
  });
  it('3" Sch 80 via keys: type 80, size 3', () => {
    let s = run('80 c:material 3 in size'); expect(shown(s)).toBe('SIZE 3" NPS · 80');
    s = run('size', {}, s); expect(shown(s)).toBe('OD 3.5 in');
  });
  it('flow from velocity 5 fps and area 1.8 sq in → 28.05195 gpm, 3.75 cfm, 0.0625 cfs, 1.769803 L/s', () => {
    let s = run('5 c:in 1.8 c:6 c:ft'); expect(val(s)).toBeCloseTo(0.0625, 12);
    expect(shown(s)).toBe('GPM 28.05195 gpm');
    s = run('c:ft', {}, s); expect(shown(s)).toBe('CFM 3.75 cfm');
    s = run('c:ft c:ft', {}, s); expect(shown(s)).toMatch('1.769803');
  });
  it('velocity from 5 gpm and 1.8 sq in → 0.891204 fps, 53.47222 fpm, 0.271639 m/s', () => {
    let s = run('5 c:ft 1.8 c:6 c:in'); expect(shown(s)).toMatch('0.891204');
    s = run('c:in', {}, s); expect(shown(s)).toMatch('53.47222');
    s = run('c:in', {}, s); expect(shown(s)).toMatch('0.271639');
  });
  it('pressure from 100 lbf on 2 sq in → 50 psi, 7200 psf, 101.801 inHg, 3.447379 bar, 344.7379 kPa', () => {
    let s = run('100 c:bksp 2 c:6 c:frac'); expect(shown(s)).toBe('PSI 50 psi');
    s = run('c:frac', {}, s); expect(shown(s)).toBe('PSF 7200 psf');
    s = run('c:frac', {}, s); expect(shown(s)).toMatch('101.80'); 
    s = run('c:frac c:frac', {}, s); expect(shown(s)).toMatch('3.447379');
  });
  it('head: 50 psi → 115.33 ft of water (ρ = 1000 kg/m³)', () => {
    let s = run('100 c:bksp 2 c:6 c:frac c:frac c:frac c:frac'); expect(val(s)).toBe(50);
    expect(shown(s)).toMatch('115.332');
  });
  it('area from 85 lbf, 15 psi → 5.666667 sq in', () => expect(val(run('85 c:bksp 15 c:frac c:6'))).toBeCloseTo(5.666667, 6));
  it('force from 100 psi on 2 sq in → 200 lbf, 889.6443 N', () => {
    let s = run('100 c:frac 2 c:6 c:bksp'); expect(val(s)).toBe(200);
    s = run('c:bksp', {}, s); expect(shown(s)).toMatch('889.6443');
  });
  it('pipe capacity: 6" Std area × 20 ft → 4.012536 cu ft → 30.01586 gal', () => {
    let s = run('6 in size c:6'); expect(val(s)).toBeCloseTo(28.89026, 5);
    s = run('mul 20 ft eq', {}, s); expect(shown(s)).toBe('= 4.012536 cu ft');
    s = run('c:7', {}, s); expect(val(s) / 231).toBeCloseTo(30.01586, 4);
  });
  it('filled weight: 10 ft of 6" 5S stainless ≈ 217.14 lb (reference 217.1418)', () => {
    let s = run('material material 5 c:material 6 in size');
    for (let i = 0; i < 6; i++) s = run('size', {}, s);
    expect(s.display.label).toBe('FILL');
    expect(val(s)).toBeCloseTo(21.71418, 2);
    s = run('mul 10 eq', {}, s); expect(val(s)).toBeCloseTo(217.1418, 1);
  });
  it('pressure loss 2" Std steel, 4 gpm per foot: Re 6120.09, 0.000205 psi/ft', () => {
    let s = run('2 in size c:6 4 c:ft c:frac');
    expect(val(s)).toBeCloseTo(0.000205, 6);
    s = run('c:frac', {}, s); expect(val(s)).toBeCloseTo(6120.09, 1);
  });
  it('pressure loss over 50 ft: 0.010232 psi, 1.47346 psf', () => {
    let s = run('2 in size c:6 4 c:ft 50 ft run c:frac'); expect(val(s)).toBeCloseTo(0.010232, 6);
    s = run('c:frac c:frac', {}, s); expect(shown(s)).toMatch('1.47346');
  });
  it('pressure loss at 40 gpm: 0.575408 psi, Re 61200.9', () => {
    const p = pipeProps('steel', 'Std', '2');
    const r = pressureLoss(p.id, 40 / 448.8311688, 221e-6, 50);
    expect(r.psi).toBeCloseTo(0.575408, 5); expect(r.Re).toBeCloseTo(61200.9, 0);
    expect(r.units.kPa).toBeCloseTo(3.9673, 4); expect(r.units.inHg).toBeCloseTo(1.171543, 4);
  });
  it('missing pipe data is reported (brass)', () => {
    const s = run('material material material 2 in size');
    expect(s.display.label).toBe('DATA Error');
  });
  it('pipe material sequence includes all seven', () => {
    let s = run('material'); const seen = [s.display.text];
    for (let i = 0; i < 6; i++) { s = press(s, 'material'); seen.push(s.display.text); }
    expect(seen.length).toBe(7);
  });
});
