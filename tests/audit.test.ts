// Engineering audit (Nov 2026): independent checks of the calculation engines.
// Each test derives the expected value a different way from the code it checks (3-D construction,
// closed-form identities, round trips, published table values) so a wrong formula cannot grade itself.
import { describe, it, expect } from 'vitest';
import { solveSimpleOffset, solveRollingOffset, combinationOffset, parallelCutback } from '../src/engine/layout';
import { B169, NPS_SORTED, elbowTakeout, steelOD, cutLength, trimElbow } from '../src/engine/fittings';
import { fitFit, offsetOf, solveTheta } from '../src/engine/fitfit';
import { rolled90, rolled90Angle, rolled90Shortcut, dms } from '../src/engine/rolled90';
import { miter, cope } from '../src/engine/shop';
import { formatFtIn, formatFracIn, DEFAULT_PREFS } from '../src/engine/format';
import { parseLength } from '../src/engine/parse';
import { DATASETS, pipeProps } from '../src/engine/pipedata';
import { FLANGE_CLASSES, flangeSizes, flange, boltTorque, tighteningSequence, SUPPORT_SPAN } from '../src/engine/refdata';

const D = Math.PI / 180;
const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))).toBe(true);

describe('audit: simple offset, every input pair, 1°–90°, 1/2" to 200 ft', () => {
  it('any two of O, A, L, θ give back the other two', () => {
    for (const th of [1, 5, 11.25, 22.5, 30, 45, 60, 72, 89, 90]) for (const O of [0.5, 7.3125, 120, 2400]) {
      const L = O / Math.sin(th * D), A = th === 90 ? 0 : O / Math.tan(th * D);
      const pairs: object[] = [{ O, theta: th }, { O, L }, { L, theta: th }];
      if (th < 90) pairs.push({ O, A }, { A, theta: th }, { A, L });
      for (const p of pairs) {
        const r = solveSimpleOffset(p);
        close(r.O, O, 1e-7); close(r.L, L, 1e-7); close(r.theta, th, 1e-6); expect(Math.abs(r.A - A) < 1e-6).toBe(true);
      }
    }
  });
  it('rejects negative, zero-angle, >90°, impossible and conflicting input', () => {
    expect(() => solveSimpleOffset({ O: -1, A: 3 })).toThrow(/negative/);
    expect(() => solveSimpleOffset({ O: 3, theta: 0 })).toThrow(/greater than 0/);
    expect(() => solveSimpleOffset({ O: 3, theta: 91 })).toThrow(/no more than 90/);
    expect(() => solveSimpleOffset({ O: 10, L: 9 })).toThrow(/shorter than the offset/);
    expect(() => solveSimpleOffset({ O: 0, A: 0 })).toThrow(/no pipe/);
    expect(() => solveSimpleOffset({ O: 10, theta: 45, L: 14.125 })).toThrow(/Conflicting/);
    expect(() => solveSimpleOffset({ A: 3 })).toThrow(/Need two/);
  });
});

describe('audit: rolling and combination offsets', () => {
  it('3-4-5 roll: true offset 20, travel √(A² + H² + V²)', () => {
    const r = solveRollingOffset({ H: 12, V: 16, A: 30 });
    close(r.Ores, 20); close(r.L, Math.hypot(30, 12, 16)); close(r.theta, Math.atan2(20, 30) / D);
  });
  it('combination offset equals the vector length and the angles between legs', () => {
    const c = combinationOffset([12, 16, 30], [1, 0, 0], [1, 0, 0]);
    close(c.L, Math.hypot(12, 16, 30)); close(c.entry, Math.acos(12 / c.L) / D); close(c.exit, c.entry);
  });
  it('parallel cutback = spacing · tan(θ/2)', () => { close(parallelCutback(10, 90), 10); close(parallelCutback(10, 45), 10 * Math.tan(22.5 * D)); });
});

describe('audit: elbow take-outs and arcs, every B16.9 size', () => {
  it('B16.9 LR 90° take-out is the table A, SR is the table A, other angles R·tan(θ/2)', () => {
    for (const nps of NPS_SORTED) {
      const e = B169[nps];
      expect(elbowTakeout(nps, 90, 'BW-L').takeout).toBe(e.lr90);
      expect(elbowTakeout(nps, 45, 'BW-L').takeout).toBe(e.lr45);
      if (e.sr90) expect(elbowTakeout(nps, 90, 'BW-S').takeout).toBe(e.sr90);
      for (const a of [11.25, 22.5, 30, 60]) close(elbowTakeout(nps, a, 'FC-L').takeout, e.lr90 * Math.tan(a / 2 * D));
      const arcs = elbowTakeout(nps, 90, 'BW-L').arcs!;
      expect(arcs.inside).toBeGreaterThan(0); close(arcs.outside - arcs.inside, steelOD(nps) * Math.PI / 2);
    }
  });
  it('published B16.9 values (spot check): 6" LR 9, LR45 3-3/4, SR 6; 3/4" LR 1-1/8; 24" LR 36', () => {
    expect(B169['6']).toEqual({ lr90: 9, lr45: 3.75, sr90: 6 }); expect(B169['3/4'].lr90).toBe(1.12); expect(B169['24'].lr90).toBe(36);
  });
  it('sizes with no B16.9 data say so instead of guessing (22", 26"–78")', () => {
    for (const n of ['22', '26', '36', '48', '60', '78']) expect(() => elbowTakeout(n, 90, 'BW-L')).toThrow(/No ASME B16.9/);
    expect(() => elbowTakeout('1/2', 90, 'BW-S')).toThrow(/no short-radius/);
  });
  it('cut length = travel − take-outs − gaps; impossible arrangements are flagged, negatives rejected', () => {
    close(cutLength({ travel: 24, to1: 9, to2: 9, gap1: 0.125, gap2: 0.125 }).cut, 5.75);
    expect(cutLength({ travel: 10, to1: 9, to2: 9, gap1: 0, gap2: 0 }).ok).toBe(false);
    expect(() => cutLength({ travel: -1, to1: 0, to2: 0, gap1: 0, gap2: 0 })).toThrow(/non-negative/);
  });
  it('trim: kept + removed arcs make the full 90°', () => {
    const t = trimElbow(9, 6.625, 30);
    close(t.keepArcs.center + t.removeArcs.center, 9 * Math.PI / 2); close(t.takeout, 9 * Math.tan(15 * D));
  });
});

describe('audit: Fit-Fit against the PI (tangent-intersection) geometry', () => {
  it('every size, gaps 0–1/8: solved angle reproduces the offset; travel·sinθ = offset', () => {
    for (const nps of NPS_SORTED) {
      const R = B169[nps].lr90, od = steelOD(nps);
      for (const g of [0, 0.0625, 0.125]) for (const f of [0.05, 0.3, 0.7, 0.99]) {
        const O = f * (2 * R + g), s = fitFit({ R, od, O, g, mode: 'f2f' }).sol!;
        close(offsetOf(R, g, s.theta), O); const T = 2 * R * Math.tan(s.theta / 2 * D) + g;
        close(s.T, T); close(T * Math.sin(s.theta * D), O); close(s.ccRun, T * Math.cos(s.theta * D));
      }
    }
  });
  it('pipe-length mode inverts angle mode', () => {
    const R = 9, od = 6.625, O = 49;
    for (const a of [22.5, 45, 60]) { const p = fitFit({ R, od, O, g: 0.125, mode: 'pipeAng', angle: a }).sol!.pipe; close(fitFit({ R, od, O, g: 0.125, mode: 'pipeLen', pipeLen: p }).sol!.theta, a, 1e-7); }
  });
  it('offset beyond two 90s is refused with the pipe needed', () => {
    const r = fitFit({ R: 9, od: 6.625, O: 19, g: 0, mode: 'f2f' }); expect(r.sol).toBeNull(); expect(r.W[0].tooMuch!.p90).toBeCloseTo(1, 9);
    expect(Number.isNaN(solveTheta(9, 0, 40))).toBe(true);
  });
});

describe('audit: Rolled 90 against a 3-D construction', () => {
  it('drop and horizontal match the second PI built in 3-D; the inverse and the closed form agree', () => {
    for (const nps of NPS_SORTED) {
      const A = B169[nps].lr90;
      for (const g of [0, 0.125]) for (const deg of [5, 15, 30, 45, 60, 89]) {
        const r = rolled90(A, A, g, deg), th = deg * D, L = A + g + A * Math.tan(th / 2);
        close(r.D, L * Math.sin(th)); close(r.H, L * Math.cos(th));
        expect(Math.abs(rolled90Angle(A, A, g, r.D).deg - deg) < 1e-6).toBe(true);
        if (g === 0) expect(Math.abs(rolled90Shortcut(A, r.D) - deg) < 1e-9).toBe(true);
      }
    }
  });
  it('degrees-minutes-seconds carries 60″ and 60′', () => { expect(dms(45.999999)).toBe('46° 0′ 0″'); expect(dms(22.5)).toBe('22° 30′ 0″'); });
});

describe('audit: miters and copes', () => {
  it('the segmented centerline closes on the bend: start and end tangent points are take-out from the PI', () => {
    for (const n of [1, 2, 3, 4, 5]) for (const B of [30, 45, 90]) {
      const R = 18, m = miter(B, n, R, 12.75), a = (B / (2 * n)) * D;
      const segs = [R * Math.tan(a), ...Array(n - 1).fill(2 * R * Math.tan(a)), R * Math.tan(a)];
      let x = 0, y = 0, dir = 0;
      segs.forEach((L, i) => { x += L * Math.cos(dir); y += L * Math.sin(dir); if (i < n) dir += (B / n) * D; });
      const to = R * Math.tan((B / 2) * D);
      close(m.takeout, to); close(x, to + to * Math.cos(B * D)); close(y, to * Math.sin(B * D));
    }
  });
  it('cope depth: equal-size square tee = branch radius; reducing = R − √(R² − r²)', () => {
    close(cope(6.625, 6.625, 90).depth, 3.3125, 1e-6);
    close(cope(12.75, 6.625, 90).depth, 6.375 - Math.sqrt(6.375 ** 2 - 3.3125 ** 2), 1e-6);
  });
});

describe('audit: fractions, rounding and parsing', () => {
  it('every 1/16" from 0 to 100 ft formats and parses back exactly', () => {
    for (let n = 0; n <= 1200 * 16; n++) { const v = n / 16; expect(parseLength(formatFtIn(v, DEFAULT_PREFS).replace('−', '-'))).toBe(v); }
  });
  it('every 1/64" to 12" at 1/64 resolution parses back exactly', () => {
    const p = { ...DEFAULT_PREFS, fracDen: 64 as const };
    for (let n = 1; n <= 64 * 12; n++) expect(parseLength(formatFracIn(n / 64, p))).toBe(n / 64);
  });
  it('rounds halves up and carries into inches and feet; tiny negatives show as zero', () => {
    expect(formatFracIn(1 / 32, DEFAULT_PREFS)).toBe('1/16"');
    expect(formatFtIn(11.99, DEFAULT_PREFS)).toBe(`1' 0"`);
    expect(formatFtIn(143.97, DEFAULT_PREFS)).toBe(`12' 0"`);
    expect(formatFtIn(-0.01, DEFAULT_PREFS)).toBe(`0' 0"`);
    expect(formatFtIn(-5.5, DEFAULT_PREFS)).toBe(`−0' 5-1/2"`);
  });
  it('accepts the usual ways of writing a length', () => {
    for (const [s, v] of [[`5' 7 3/8"`, 67.375], [`5'-7 5/8"`, 67.625], ['7-3/8', 7.375], ['7 3/8', 7.375], [`1.5'`, 18], ['12 ft 6 in', 150], [`5′ 7″`, 67], ['0\' 0 1/2"', 0.5], ['-3/8', -0.375]] as const) expect(parseLength(s)).toBe(v);
    close(parseLength('150 mm'), 150 / 25.4); expect(() => parseLength('3/0')).toThrow(/zero denominator/);
  });
});

describe('audit: reference data integrity', () => {
  it('every wall is positive and less than half the OD; steel schedules thicken with number', () => {
    for (const ds of Object.values(DATASETS)) for (const r of ds.rows) for (const w of Object.values(r.walls)) expect(w > 0 && 2 * w < r.od).toBe(true);
    for (const r of DATASETS.steel.rows) { let prev = 0; for (const k of ['10', '20', '30', '40', '60', '80', '100', '120', '140', '160']) { const w = r.walls[k]; if (w === undefined) continue; expect(w >= prev).toBe(true); prev = w; } }
  });
  it('calculated plain-end weights agree with B36.10M tabulated weights within 0.3%', () => {
    for (const [nps, sch, w] of [['6', '40', 18.97], ['2', '80', 5.02], ['24', 'Std', 94.62], ['12', '40', 53.53], ['1', '40', 1.68]] as const) {
      const c = pipeProps('steel', sch, nps).weightPerFt!; expect(Math.abs(c / w - 1) < 0.003).toBe(true);
    }
  });
  it('every B16.5 flange: bolt circle inside the OD, holes clear the raised face, bolts in fours, hub longer than the ring', () => {
    for (const cls of FLANGE_CLASSES) for (const nps of flangeSizes(cls)) {
      const f = flange(cls, nps);
      expect(f.od > f.boltCircle && f.boltCircle - f.holeDia > f.rfDia && f.nBolts % 4 === 0 && f.yWN > f.tf).toBe(true);
    }
  });
  it('torque short form: 3/4" B7 at 50% yield, K 0.16 → As 0.3345 in², 175.6 ft·lb', () => {
    const t = boltTorque(0.75, 52500, 0.16); expect(t.As).toBeCloseTo(0.3345, 4); expect(t.torqueFtLb).toBeCloseTo(175.6, 1);
  });
  it('PCC-1 legacy cross pattern for 12 and 16 bolts', () => {
    expect(tighteningSequence(12)).toEqual([1, 7, 4, 10, 2, 8, 5, 11, 3, 9, 6, 12]);
    expect(tighteningSequence(16)).toEqual([1, 9, 5, 13, 3, 11, 7, 15, 2, 10, 6, 14, 4, 12, 8, 16]);
  });
  it('B31.1 Table 121.5 spans (water / steam-gas-air)', () => { expect(SUPPORT_SPAN['6']).toEqual([17, 21]); expect(SUPPORT_SPAN['24']).toEqual([32, 42]); });
});

// C1 (audit): B16.5 tabulates tf and Y without the raised face (para. 6.4.1; 0.06" Class 150/300, 0.25" Class 400+).
// Vendor tables that include the 1/16" face list Class 150 WN Y as 1-7/8, 2-1/2, 3, 3-1/2, 4-1/2 for NPS 1/2, 2, 4, 6, 12.
import { newDrawing, itemLength, endTakeoff, flangeFit } from '../src/engine/iso';
describe('audit C1: flange take-offs include the raised face', () => {
  const dr = (nps: string, cls: number) => ({ ...newDrawing('t', 'x'), nps, cls } as any);
  it('Class 150 Y + RF equals the published RF-included length through hub', () => {
    for (const [nps, withRF] of [['1/2', 1.88], ['2', 2.5], ['4', 3.0], ['6', 3.5], ['12', 4.5]] as const) expect(Math.abs(flangeFit(dr(nps, 150), 'WN')!.toPipe - withRF) <= 0.011).toBe(true); // tables are rounded to 0.01"
  });
  it('4" Class 150 WN flange pair = 2 × (2.94 + 0.06) + 1/8 gasket = 6-1/8"', () => {
    expect(itemLength(dr('4', 150), { id: 'f', type: 'flange', t: 0.5 } as any).len).toBeCloseTo(6.125, 9);
  });
  it('2" Class 600 WN flange pair = 2 × (2.88 + 0.25) + 1/8 = 6.385"; flange end 4" Class 600 = 4.00 + 0.25', () => {
    expect(itemLength(dr('2', 600), { id: 'f', type: 'flange', t: 0.5 } as any).len).toBeCloseTo(6.385, 9);
    const d = dr('4', 600); d.ends = { 1: 'flange' }; d.runs = [{ id: 'a', from: 0, dx: 10, dy: 0, dz: 0, inline: 'none' }];
    expect(endTakeoff(d, 1)!.len).toBeCloseTo(4.25, 9);
  });
  it('4" Class 150 blind end = WN (3.00) + gasket 1/8 + blind RF 0.06 + blind tf 0.88', () => {
    const d = dr('4', 150); d.ends = { 1: 'blind' }; d.runs = [{ id: 'a', from: 0, dx: 10, dy: 0, dz: 0, inline: 'none' }];
    expect(endTakeoff(d, 1)!.len).toBeCloseTo(3.0 + 0.125 + 0.06 + 0.88, 9);
  });
  it('2" Class 150 socket-weld flange: Y 0.94 − socket 0.69 + 1/16 setback + RF 0.06 = 0.3725"', () => {
    expect(flangeFit(dr('2', 150), 'SW')!.toPipe).toBeCloseTo(0.94 - 0.69 + 0.0625 + 0.06, 9);
  });
});

// C2 (audit): standard method = Colebrook–White with Moody roughness.
import { colebrook, frictionFactor, pressureLoss } from '../src/engine/hydraulics';
import { MATERIALS } from '../src/engine/pipedata';
describe('audit C2: friction factor and pressure loss', () => {
  it('Colebrook satisfies its own equation to 1e-12 across the Moody chart', () => {
    for (const Re of [4000, 1e4, 1e5, 1e6, 1e7]) for (const rr of [0, 1e-5, 1e-4, 1e-3, 1e-2, 0.05]) {
      const f = colebrook(Re, rr); const rhs = -2 * Math.log10(rr / 3.7 + 2.51 / (Re * Math.sqrt(f)));
      expect(Math.abs(1 / Math.sqrt(f) - rhs) < 1e-12).toBe(true);
    }
  });
  it('matches the explicit Haaland (±2%) and Swamee–Jain (±3%) approximations', () => {
    for (const Re of [5000, 5e4, 5e5, 5e6]) for (const rr of [1e-5, 1e-4, 1e-3, 1e-2]) {
      const f = colebrook(Re, rr);
      const haaland = Math.pow(-1.8 * Math.log10(Math.pow(rr / 3.7, 1.11) + 6.9 / Re), -2);
      const sj = 0.25 / Math.pow(Math.log10(rr / 3.7 + 5.74 / Math.pow(Re, 0.9)), 2);
      expect(Math.abs(f / haaland - 1) < 0.02).toBe(true); expect(Math.abs(f / sj - 1) < 0.03).toBe(true); // Haaland ±2%, Swamee–Jain ±3% at the range corners
    }
  });
  it('fully rough limit: f → (2·log10(3.7/(ε/D)))⁻² (von Kármán)', () => {
    close(colebrook(1e12, 0.01), Math.pow(2 * Math.log10(3.7 / 0.01), -2), 1e-6);
  });
  it('laminar below Re 2 300, transition flagged to 4 000, Colebrook above', () => {
    expect(frictionFactor(2000, 1e-4, 0.05, 0.04).f).toBeCloseTo(0.032, 9);
    expect(frictionFactor(3000, 1e-4, 0.05, 0.06).method).toMatch(/Transition/);
    expect(frictionFactor(1e5, 1e-4, 0.05, 2).method).toMatch(/Colebrook/);
  });
  it('2" Sch 40 steel, 40 gpm, 100 ft: Re 61 201, standard ≈ 1.33 psi (f ≈ 0.0232), reference 1.151 psi', () => {
    const id = 2.067, q = 40 / 448.8311688;
    const std = pressureLoss(id, q, MATERIALS.steel.roughnessStdFt, 100);
    const rr = 0.00015 / (id / 12); close(std.f, colebrook(std.Re, rr)); expect(std.Re).toBeCloseTo(61201, 0);
    expect(std.f).toBeCloseTo(0.0232, 3); expect(std.lossMethod).toBe('standard');
    expect(pressureLoss(id, q, MATERIALS.steel.roughnessFt, 100, 'reference').psi).toBeCloseTo(1.151, 3);
  });
  it('steel uses the Moody commercial-steel roughness 0.00015 ft in the standard method', () => {
    expect(MATERIALS.steel.roughnessStdFt).toBeCloseTo(0.00015, 12); expect(MATERIALS.castiron.roughnessStdFt).toBeCloseTo(0.00085, 12);
  });
});
