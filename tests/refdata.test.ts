// Spot checks of the reference library against the values published in the cited sources.
import { describe, it, expect } from 'vitest';
import {
  flange, flangeSizes, FLANGE_CLASSES, heavyHexAcrossFlats, tensileStressArea, boltTorque, tighteningSequence, boltYieldPsi, NUT_FACTORS,
  spiralGasket, bwFitting, socketWeld, threadedFitting, nptMakeup, valveFaceToFace, weldolet, SUPPORT_SPAN,
  pipeVolume, pipeSurface, pipeSpacing,
} from '../src/engine/refdata';
import { B169 } from '../src/engine/fittings';

// Engineering ToolBox (independent of the primary flange source): [class, nps, OD, BC, nBolts, boltDia]
const ETB: Array<[number, string, number, number, number, number]> = [
  [150, '1/2', 3.5, 2.375, 4, 0.5], [150, '4', 9, 7.5, 8, 0.625], [150, '24', 32, 29.5, 20, 1.25],
  [300, '2', 6.5, 5, 8, 0.625], [300, '6', 12.5, 10.625, 12, 0.75], [300, '24', 36, 32, 24, 1.5],
  [400, '4', 10, 7.875, 8, 0.875], [400, '24', 36, 32, 24, 1.75],
  [600, '4', 10.75, 8.5, 8, 0.875], [600, '12', 22, 19.25, 20, 1.25], [600, '24', 37, 33, 24, 1.875],
  [900, '3', 9.5, 7.5, 8, 0.875], [900, '2-1/2', 9.625, 7.5, 8, 1], [900, '24', 41, 35.5, 20, 2.5],
  [1500, '2', 8.5, 6.5, 8, 0.875], [1500, '10', 23, 19, 12, 1.875], [1500, '24', 46, 39, 16, 3.5],
  [2500, '1/2', 5.25, 3.5, 4, 0.75], [2500, '6', 19, 14.5, 8, 2], [2500, '12', 30, 24.375, 12, 2.75],
];

describe('flanges (B16.5)', () => {
  for (const [c, n, od, bc, nb, bd] of ETB) {
    it(`Class ${c} NPS ${n}: OD ${od}, BC ${bc}, ${nb} × ${bd}" bolts`, () => {
      const f = flange(c as 150, n);
      expect(f.od).toBeCloseTo(od, 1); expect(f.boltCircle).toBeCloseTo(bc, 1); expect(f.nBolts).toBe(nb); expect(f.boltDia).toBe(bd);
    });
  }
  it('Class 150 4" weld neck hub length 2.94, thickness 0.88, RF 6.19', () => { const f = flange(150, '4'); expect(f.yWN).toBe(2.94); expect(f.tf).toBe(0.88); expect(f.rfDia).toBe(6.19); });
  it('4" stud lengths by class match Texas Flange 4" table', () => {
    expect(flange(150, '4').studRF).toBe(3.5); expect(flange(300, '4').studRF).toBe(4.5); expect(flange(600, '4').studRF).toBe(5.75);
    expect(flange(900, '4').studRF).toBe(6.75); expect(flange(1500, '4').studRF).toBe(7.75); expect(flange(2500, '4').studRF).toBe(10);
  });
  it('every class covers its sizes; 2500 stops at 12', () => { for (const c of FLANGE_CLASSES) expect(flangeSizes(c).length).toBeGreaterThan(13); expect(flangeSizes(2500).includes('14')).toBe(false); });
  it('hole = bolt + 1/8 everywhere', () => { for (const c of FLANGE_CLASSES) for (const n of flangeSizes(c)) { const f = flange(c, n); expect(f.holeDia - f.boltDia).toBeCloseTo(0.125, 1); } });
  it('raised face height 1/16 for 150/300, 1/4 for 400+', () => { expect(flange(300, '2').rfHeight).toBe(0.06); expect(flange(600, '2').rfHeight).toBe(0.25); });
  it('ring numbers (Class 300–600): 4" R-37, 2" R-23', () => { expect(flange(600, '4').ring).toBe('R-37'); expect(flange(300, '2').ring).toBe('R-23'); expect(flange(150, '2').ring).toBeNull(); });
  it('no slip-on length for Class 1500 above 2-1/2', () => expect(flange(1500, '4').ySO).toBeNull());
  it('missing size is reported', () => expect(() => flange(2500, '16')).toThrow('not listed'));
});

describe('bolting', () => {
  it('heavy hex across flats: 5/8 → 1-1/16, 7/8 → 1-7/16, 1-1/4 → 2', () => { expect(heavyHexAcrossFlats(0.625)).toBe(1.0625); expect(heavyHexAcrossFlats(0.875)).toBe(1.4375); expect(heavyHexAcrossFlats(1.25)).toBe(2); });
  it('tensile stress area: 3/4-10 UNC 0.334 in², 1-8 0.606 in², 1-1/4-8 1.000 in²', () => {
    expect(tensileStressArea(0.75)).toBeCloseTo(0.3345, 3); expect(tensileStressArea(1)).toBeCloseTo(0.6057, 3); expect(tensileStressArea(1.25)).toBeCloseTo(1.0000, 3);
  });
  it('torque T = K·D·F: 7/8" at 50 ksi, K 0.17 → ≈ 285 ft·lb', () => {
    const r = boltTorque(0.875, 50000, 0.17);
    expect(r.preload).toBeCloseTo(50000 * 0.4617, -1); expect(r.torqueFtLb).toBeCloseTo((0.17 * 0.875 * r.preload) / 12, 9);
    expect(r.passes.find((p) => p.pct === 30)!.ftlb).toBeCloseTo(r.torqueFtLb * 0.3, 9);
  });
  it('stud yield by grade and size (ASTM A193 Table 2)', () => {
    expect(boltYieldPsi('B7', 0.875)).toBe(105000); expect(boltYieldPsi('B7', 2.5)).toBe(105000); expect(boltYieldPsi('B7', 3)).toBe(95000); expect(boltYieldPsi('B7', 5)).toBe(75000);
    expect(boltYieldPsi('B8C2', 0.75)).toBe(100000); expect(boltYieldPsi('B8C2', 0.875)).toBe(80000); expect(boltYieldPsi('B8C2', 1.5)).toBe(50000); expect(boltYieldPsi('B8C2', 1.625)).toBeNull();
    expect(boltYieldPsi('B8C1', 3)).toBe(30000); expect(boltYieldPsi('nope', 1)).toBeNull();
  });
  it('dry needs more torque than lubricated for the same preload', () => {
    const k = (id: string) => NUT_FACTORS.find((n) => n.id === id)!.k;
    expect(boltTorque(0.75, 52500, k('dry')).torqueFtLb).toBeGreaterThan(boltTorque(0.75, 52500, k('oilgraph')).torqueFtLb);
  });
  it('cross pattern: 8 → 1,5,3,7,2,6,4,8; 12 → 1,7,4,10,2,8,5,11,3,9,6,12', () => {
    expect(tighteningSequence(8)).toEqual([1, 5, 3, 7, 2, 6, 4, 8]);
    expect(tighteningSequence(12)).toEqual([1, 7, 4, 10, 2, 8, 5, 11, 3, 9, 6, 12]);
  });
  it('every bolt appears exactly once (4–24)', () => {
    for (const n of [4, 8, 12, 16, 20, 24]) expect([...tighteningSequence(n)].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
  });
});

describe('gaskets (B16.20 spiral wound)', () => {
  it('Class 150 1/2": winding 0.75 × 1.25, ring 1.88, inner ring 0.56', () => {
    const g = spiralGasket(150, '1/2');
    expect(g.windingID!).toBeCloseTo(0.75, 2); expect(g.windingOD!).toBeCloseTo(1.25, 2); expect(g.ringOD!).toBeCloseTo(1.88, 2); expect(g.innerRingID).toBe(0.56);
  });
  it('centering ring OD: Class 300 4" 7.13, Class 600 4" 7.63, Class 150 24" 28.25', () => {
    expect(spiralGasket(300, '4').ringOD!).toBeCloseTo(7.13, 2); expect(spiralGasket(600, '4').ringOD!).toBeCloseTo(7.63, 2); expect(spiralGasket(150, '24').ringOD!).toBeCloseTo(28.25, 2);
  });
  it('centering ring is located by the bolts (ring OD ≤ BC − bolt dia)', () => {
    for (const c of [150, 300, 600, 1500] as const) for (const n of ['1', '4', '8', '12']) { const f = flange(c, n); expect(spiralGasket(c, n).ringOD!).toBeLessThan(f.boltCircle - f.boltDia + 0.03); }
  });
  it('3-1/2 not in source', () => expect(() => spiralGasket(150, '3-1/2')).toThrow());
});

describe('fittings', () => {
  it('B16.9 tees (mm source 25, 64, 143, 254, 432)', () => {
    for (const [n, mm] of [['1/2', 25], ['2', 64], ['6', 143], ['12', 254], ['24', 432]] as const) expect(bwFitting(n).teeC! * 25.4).toBeCloseTo(mm, -0.5);
  });
  it('B16.9 reducers H (38.1 … 508 mm)', () => {
    for (const [n, mm] of [['3/4', 38.1], ['6', 140], ['14', 330], ['20', 508]] as const) expect(Math.abs(bwFitting(n).reducerH! * 25.4 - mm)).toBeLessThan(1);
  });
  it('180° returns: LR O = 2 × LR 90 radius', () => { for (const n of ['1', '2', '6', '12', '24']) expect(bwFitting(n).lrO).toBeCloseTo(2 * B169[n].lr90, 1); });
  it('3/4 LR return omitted (sources disagree)', () => expect(bwFitting('3/4').lrO).toBeNull());
  it('stub end G equals the flange raised-face diameter', () => { for (const n of ['1', '4', '12', '24']) expect(bwFitting(n).stubG).toBe(flange(150, n).rfDia); });
  it('socket weld 3000 2": A 1.50, J 0.63, take-out A − (J − 1/16)', () => {
    const s = socketWeld('2', 3000);
    expect(s.a90!).toBeCloseTo(1.5, 1); expect(s.depth).toBeCloseTo(0.63, 2); expect(s.takeout90!).toBeCloseTo(s.a90! - (s.depth - 0.0625), 12);
  });
  it('socket weld 6000 above 2" not available', () => expect(() => socketWeld('3', 6000)).toThrow('6000'));
  it('NPT makeup = L1 + L3: 1" 0.6609, 2" 0.6969', () => { expect(nptMakeup('1').makeup).toBeCloseTo(0.6609, 4); expect(nptMakeup('2').makeup).toBeCloseTo(0.6969, 4); });
  it('150# malleable 1" 90°: A 1.50, take-out ≈ 0.84', () => { const t = threadedFitting('B16.3-150', '1'); expect(t.a90).toBe(1.5); expect(t.takeout90).toBeCloseTo(1.5 - 0.6609, 4); });
});

describe('valves (B16.10)', () => {
  it('Class 150 gate: 2" 7.00, 4" 9.00, 12" 14.00', () => { expect(valveFaceToFace(150, 'gate', '2')).toBe(7); expect(valveFaceToFace(150, 'gate', '4')).toBe(9); expect(valveFaceToFace(150, 'gate', '12')).toBe(14); });
  it('Class 300 gate 8" 16.50, 14" 30.00', () => { expect(valveFaceToFace(300, 'gate', '8')).toBe(16.5); expect(valveFaceToFace(300, 'gate', '14')).toBe(30); });
  it('Class 600 2" 11.50', () => expect(valveFaceToFace(600, 'gate', '2')).toBe(11.5));
  it('Class 150 swing check 6" differs from globe (14.00 vs 16.00)', () => { expect(valveFaceToFace(150, 'swing', '6')).toBe(14); expect(valveFaceToFace(150, 'globe', '6')).toBe(16); });
  it('values not in B16.10 return null', () => expect(valveFaceToFace(150, 'globe', '24')).toBeNull());
});

describe('outlets, supports, pipe extras', () => {
  it('Weldolet 2" branch A 1-1/2; on 6" run → 3.3125 + 1.5', () => { const w = weldolet('2', 6.625); expect(w.A).toBe(1.5); expect(w.centerToEnd).toBeCloseTo(4.8125, 9); });
  it('B31.1 span 4": water 14 ft, steam 17 ft', () => expect(SUPPORT_SPAN['4']).toEqual([14, 17]));
  it('volume: 6" Std, 20 ft → 30.0159 US gal, 4.0125 cu ft', () => {
    const id = 6.625 - 2 * 0.28; const v = pipeVolume(id, 240);
    expect(v.usgal).toBeCloseTo(30.01586, 3); expect(v.ft3).toBeCloseTo(4.012536, 5); expect(v.bbl).toBeCloseTo(30.01586 / 42, 4);
  });
  it('surface area π·D·L', () => expect(pipeSurface(6.625, 6.065, 12).outside).toBeCloseTo(Math.PI * 6.625 * 12, 9));
  it('spacing uses the larger of pipe+insulation and half flange OD', () => {
    expect(pipeSpacing({ od: 6.625, insul: 0 }, { od: 4.5, insul: 0 }, 1).spacing).toBeCloseTo(3.3125 + 2.25 + 1, 9);
    expect(pipeSpacing({ od: 6.625, insul: 0, flangeOD: 11 }, { od: 4.5, insul: 1 }, 1).spacing).toBeCloseTo(5.5 + 3.25 + 1, 9);
  });
});
