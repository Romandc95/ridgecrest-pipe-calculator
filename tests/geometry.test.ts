import { describe, it, expect } from 'vitest';
import { solveSimpleOffset, solveRollingOffset, parallelCutback, combinationOffset, slopeFromAngle, angleFromSlopePerFt } from '../src/engine/layout';
import { idealTakeout, arcs, elbowTakeout, cutLength, trimElbow } from '../src/engine/fittings';
import { solveFittingToFitting } from '../src/engine/fit2fit';

describe('simple offset', () => {
  it('3" offset, 4" run → 5" travel, 36.8699°', () => {
    const r = solveSimpleOffset({ O: 3, A: 4 });
    expect(r.L).toBeCloseTo(5, 12); expect(r.theta).toBeCloseTo(36.8699, 4);
  });
  it('offset + angle: L = O/sinθ, A = O/tanθ', () => {
    const r = solveSimpleOffset({ O: 24, theta: 45 });
    expect(r.L).toBeCloseTo(33.941125, 6); expect(r.A).toBeCloseTo(24, 9);
  });
  it('every valid pair gives the same triangle', () => {
    const ref = solveSimpleOffset({ O: 10, A: 12 });
    for (const inp of [{ O: 10, L: ref.L }, { A: 12, L: ref.L }, { O: 10, theta: ref.theta }, { A: 12, theta: ref.theta }, { L: ref.L, theta: ref.theta }]) {
      const r = solveSimpleOffset(inp);
      expect(r.O).toBeCloseTo(10, 9); expect(r.A).toBeCloseTo(12, 9);
    }
  });
  it('insufficient input detected', () => expect(() => solveSimpleOffset({ O: 3 })).toThrow('Need two'));
  it('conflicting input detected', () => expect(() => solveSimpleOffset({ O: 3, A: 4, L: 6 })).toThrow('Conflicting'));
  it('consistent extra input accepted', () => expect(solveSimpleOffset({ O: 3, A: 4, L: 5 }).theta).toBeCloseTo(36.8699, 4));
  it('travel shorter than offset rejected', () => expect(() => solveSimpleOffset({ O: 10, L: 5 })).toThrow('impossible'));
  it('angle near 1°', () => { const r = solveSimpleOffset({ O: 1, theta: 1 }); expect(r.L).toBeCloseTo(1 / Math.sin(Math.PI / 180), 9); });
  it('angle 90°: run = 0, travel = offset', () => { const r = solveSimpleOffset({ O: 6, theta: 90 }); expect(r.A).toBe(0); expect(r.L).toBeCloseTo(6, 12); });
  it('angle near 90° (89.99)', () => { const r = solveSimpleOffset({ O: 6, theta: 89.99 }); expect(r.A).toBeCloseTo(6 / Math.tan(89.99 * Math.PI / 180), 12); });
  it('angle 0 rejected', () => expect(() => solveSimpleOffset({ O: 6, theta: 0 })).toThrow());
  it('run + 90° rejected (undefined)', () => expect(() => solveSimpleOffset({ A: 6, theta: 90 })).toThrow());
});

describe('rolling offset', () => {
  it('H=3, V=4, A=12 → O=5, L=13, θ≈22.6199°', () => {
    const r = solveRollingOffset({ H: 3, V: 4, A: 12 });
    expect(r.Ores).toBeCloseTo(5, 12); expect(r.L).toBeCloseTo(13, 12); expect(r.theta).toBeCloseTo(22.6199, 4);
    expect(r.phi).toBeCloseTo(53.1301, 4);
  });
  it('direction preserved: H=−3, V=−4 → φ = −126.87°', () => expect(solveRollingOffset({ H: -3, V: -4, A: 12 }).phi).toBeCloseTo(-126.8699, 4));
  it('O & φ input equals H & V input', () => {
    const r = solveRollingOffset({ Ores: 5, phi: 53.130102354, A: 12 });
    expect(r.H).toBeCloseTo(3, 6); expect(r.V).toBeCloseTo(4, 6); expect(r.L).toBeCloseTo(13, 9);
  });
  it('H, V and travel', () => expect(solveRollingOffset({ H: 3, V: 4, L: 13 }).A).toBeCloseTo(12, 9));
  it('H, V and angle', () => expect(solveRollingOffset({ H: 3, V: 4, theta: 22.619864948 }).A).toBeCloseTo(12, 6));
  it('conflict between O and H,V detected', () => expect(() => solveRollingOffset({ H: 3, V: 4, Ores: 6, A: 12 })).toThrow('Conflicting'));
});

describe('slope, grade, cutback, combination', () => {
  it('1/8" per foot over 25\' → 3-1/8" drop', () => expect(25 * 12 * Math.tan(angleFromSlopePerFt(0.125) * Math.PI / 180)).toBeCloseTo(3.125, 9));
  it('6" in 50\' → 0.57°, 1% grade', () => { const s = slopeFromAngle(Math.atan(6 / 600) * 180 / Math.PI); expect(s.angle).toBeCloseTo(0.5729, 3); expect(s.pctGrade).toBeCloseTo(1, 9); expect(s.slopePerFt).toBeCloseTo(0.12, 9); });
  it('parallel cutback 45°, 10" → 4.142"', () => expect(parallelCutback(10, 45)).toBeCloseTo(4.142136, 6));
  it('combination H→V: entry 43.44°, exit 67.94°, length 39.937"', () => {
    const r = combinationOffset([29, 23, 15], [1, 0, 0], [0, 0, 1]);
    expect(r.L).toBeCloseTo(39.9375, 2); expect(r.entry).toBeCloseTo(43.44, 2); expect(r.exit).toBeCloseTo(67.94, 2);
  });
  it('combination H→H: exit 54.84°', () => expect(combinationOffset([29, 23, 15], [1, 0, 0], [0, 1, 0]).exit).toBeCloseTo(54.84, 2));
});

describe('fittings', () => {
  it('ideal elbow R=6, θ=30 → 1.607695" takeout', () => expect(idealTakeout(6, 30)).toBeCloseTo(1.607695, 6));
  it('arcs = (R ∓ OD/2)·θ', () => {
    const a = arcs(9, 6.625, 39.80557);
    const t = 39.80557 * Math.PI / 180;
    expect(a.center).toBeCloseTo(9 * t, 12); expect(a.inside).toBeCloseTo((9 - 3.3125) * t, 12); expect(a.outside).toBeCloseTo((9 + 3.3125) * t, 12);
  });
  it('factory LR 90 uses B16.9 center-to-end', () => expect(elbowTakeout('6', 90, 'BW-L').takeout).toBe(9));
  it('factory LR 45 uses B16.9 (differs from ideal for small sizes)', () => {
    const t = elbowTakeout('1', 45, 'BW-L');
    expect(t.takeout).toBe(0.88); expect(t.method).toBe('table45');
    expect(elbowTakeout('1', 45, 'FC-L').takeout).toBeCloseTo(1.5 * Math.tan(Math.PI / 8), 9);
  });
  it('short radius 4" 30° field cut', () => expect(elbowTakeout('4', 30, 'FC-S').takeout).toBeCloseTo(4 * Math.tan(Math.PI / 12), 9));
  it('bend 1° and 90° limits', () => { expect(elbowTakeout('6', 1, 'FC-L').takeout).toBeCloseTo(9 * Math.tan(Math.PI / 360), 12); expect(elbowTakeout('6', 90, 'FC-L').takeout).toBeCloseTo(9, 12); });
  it('cut length shows every deduction, zero gap valid', () => {
    const c = cutLength({ travel: 15.6205, to1: 3.2585, to2: 3.2585, gap1: 0, gap2: 0 });
    expect(c.ok).toBe(true); expect(c.deductions.length).toBe(4); expect(c.cut).toBeCloseTo(9.1035, 4);
  });
  it('different takeouts and gaps at each end', () => expect(cutLength({ travel: 20, to1: 3, to2: 2, gap1: 0.125, gap2: 0.0625 }).cut).toBeCloseTo(14.8125, 12));
  it('negative cut length reported as impossible', () => {
    const c = cutLength({ travel: 5, to1: 3, to2: 3, gap1: 0.125, gap2: 0.125 });
    expect(c.ok).toBe(false); expect(c.message!).toMatch('Impossible');
  });
  it('trim 90° to 30°: retained vs removed', () => {
    const t = trimElbow(9, 6.625, 30);
    expect(t.removed).toBe(60); expect(t.keepArcs.center).toBeCloseTo(9 * Math.PI / 6, 12); expect(t.removeArcs.center).toBeCloseTo(9 * Math.PI / 3, 12);
  });
});

describe('fitting-to-fitting solver', () => {
  const base = { inDir: '+X' as const, outDir: '+Y' as const, targetAxis: '-Z' as const, target: 2, e1Angle: 90, e1CF: 6, gap: 0 };
  it('2" drop, 6" 90° rolled into a trimmed 6"-radius elbow', () => {
    const r = solveFittingToFitting({ ...base, second: { mode: 'trim', R: 6 } });
    expect(r.solutions.length).toBe(1);
    const s = r.solutions[0];
    expect(s.separation).toBeCloseTo(2, 9);
    // closed form for this arrangement: sinρ·(T1 + gap + R·tan(ρ/2)) = drop, β = ρ
    const rho = s.roll * Math.PI / 180;
    expect(Math.sin(rho) * (6 + 6 * Math.tan(rho / 2))).toBeCloseTo(2, 9);
    expect(s.beta).toBeCloseTo(s.roll, 6);
    expect(s.travel).toBeCloseTo(6 + 6 * Math.tan(rho / 2), 9);
    expect(s.travel).not.toBe(6); expect(s.travel).not.toBe(7); expect(s.travel).not.toBe(8.5);
    // endpoint and tangent checks
    expect(s.points.P2[2]).toBeCloseTo(-2, 9); // outlet face at the drop
    expect(s.dirs.d2[1]).toBe(1);
  });
  it('gap is included in travel and changes the roll', () => {
    const a = solveFittingToFitting({ ...base, second: { mode: 'trim', R: 6 } }).solutions[0];
    const b = solveFittingToFitting({ ...base, gap: 0.125, second: { mode: 'trim', R: 6 } }).solutions[0];
    expect(b.roll).toBeLessThan(a.roll);
    expect(b.separation).toBeCloseTo(2, 9);
  });
  it('second fitting radius matters', () => {
    const a = solveFittingToFitting({ ...base, second: { mode: 'trim', R: 6 } }).solutions[0];
    const b = solveFittingToFitting({ ...base, second: { mode: 'trim', R: 9 } }).solutions[0];
    expect(Math.abs(a.beta - b.beta)).toBeGreaterThan(0.1);
  });
  it('too large a drop is reported with the maximum achievable', () => expect(() => solveFittingToFitting({ ...base, target: 20, second: { mode: 'trim', R: 6 } })).toThrow('most these fittings'));
  it('straight-through outlet gives 2 solutions and names the missing constraint', () => {
    const r = solveFittingToFitting({ ...base, outDir: '+X', target: 2, second: { mode: 'trim', R: 6 } });
    expect(r.solutions.length).toBe(2); expect(r.warning!).toMatch('Missing constraint');
  });
  it('outlet parallel to drop axis is undefined', () => expect(() => solveFittingToFitting({ ...base, outDir: '-Z', second: { mode: 'trim', R: 6 } })).toThrow('Missing constraint'));
  it('fixed 45° second fitting over-constrains', () => expect(() => solveFittingToFitting({ ...base, second: { mode: 'fixed', angle: 45, cf: 3.75 } })).toThrow('over-constrained'));
});
