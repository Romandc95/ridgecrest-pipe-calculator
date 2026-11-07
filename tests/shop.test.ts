import { describe, it, expect } from 'vitest';
import { miter, cope, thermalExpansion } from '../src/engine/shop';
import { newDrawing, nodePositions, nodeKind, cutList, iso, IsoDrawing, Run, describeRun } from '../src/engine/iso';

describe('miter (segmented elbow)', () => {
  it('90° with 3 welds: cut angle 15°, gore = 2R·tan15°', () => {
    const m = miter(90, 3, 9, 6.625);
    expect(m.cutAngle).toBeCloseTo(15, 12); expect(m.gores).toBe(2);
    expect(m.gore!.center).toBeCloseTo(2 * 9 * Math.tan(Math.PI / 12), 12);
    expect(m.gore!.throat).toBeCloseTo(2 * (9 - 3.3125) * Math.tan(Math.PI / 12), 12);
    expect(m.end.heel).toBeCloseTo((9 + 3.3125) * Math.tan(Math.PI / 12), 12);
    expect(m.takeout).toBeCloseTo(9, 12);
  });
  it('two-piece 90° miter: each side cut 45°, template ±OD/2', () => {
    const m = miter(90, 1, 0, 4.5);
    expect(m.cutAngle).toBe(45); expect(m.template[0].offset).toBeCloseTo(2.25, 12); expect(m.template[8].offset).toBeCloseTo(-2.25, 12);
  });
  it('lengths add up: 2 ends + gores = total centerline from tangent to tangent', () => {
    const m = miter(60, 4, 12, 8.625);
    expect(2 * m.end.center + m.gores * m.gore!.center).toBeCloseTo(2 * 4 * 12 * Math.tan((60 / 8) * Math.PI / 180), 12);
  });
  it('radius too tight for multi-weld is rejected', () => expect(() => miter(90, 3, 2, 6.625)).toThrow('half the OD'));
});

describe('coping template', () => {
  it('equal-size 90° tee: cut depth = branch radius; tips at the sides, deepest along the header', () => {
    const c = cope(6.625, 6.625, 90, 0, 16);
    expect(c.depth).toBeCloseTo(3.3125, 6);
    // φ = 0 / 180 lie along the header axis (cut back the most); φ = 90 / 270 are the tips (cut-back 0)
    expect(c.points[0].cutback).toBeCloseTo(3.3125, 6); expect(c.points[4].cutback).toBeCloseTo(0, 9);
  });
  it('2" on 6" at 90°: depth = R − √(R² − r²)', () => {
    const R = 6.625 / 2, r = 2.375 / 2;
    expect(cope(6.625, 2.375, 90).depth).toBeCloseTo(R - Math.sqrt(R * R - r * r), 6);
  });
  it('45° lateral is deeper and asymmetric', () => {
    const c = cope(6.625, 4.5, 45);
    expect(c.depth).toBeGreaterThan(cope(6.625, 4.5, 90).depth);
    expect(Math.abs(c.points[0].cutback - c.points[8].cutback)).toBeGreaterThan(1);
  });
  it('branch larger than header rejected', () => expect(() => cope(4.5, 6.625, 90)).toThrow('wider'));
});

describe('thermal expansion', () => {
  it('100 ft carbon steel, 70→370 °F: 6.5e-6 × 1200 × 300 = 2.34"', () => {
    const t = thermalExpansion('carbon', 1200, 70, 370);
    expect(t.dL).toBeCloseTo(2.34, 9); expect(t.perHundredFt).toBeCloseTo(2.34, 9);
  });
  it('cooling gives negative change', () => expect(thermalExpansion('pvc', 240, 90, 40).dL).toBeLessThan(0));
});

describe('ISO route', () => {
  const run = (from: number, dx: number, dy: number, dz: number): Run => ({ id: String(Math.random()), from, dx, dy, dz, inline: 'none' });
  const base = (): IsoDrawing => ({ ...newDrawing('t', 'x'), nps: '4', gap: 0.125 });
  it('chain E 60, N 48, Up 36 → nodes and two 90° elbows', () => {
    const d = base(); d.runs = [run(0, 60, 0, 0), run(1, 0, 48, 0), run(2, 0, 0, 36)];
    expect(nodePositions(d)[3]).toEqual([60, 48, 36]);
    expect(nodeKind(d, 1)).toEqual({ kind: 'elbow', angle: 90 }); expect(nodeKind(d, 2)).toEqual({ kind: 'elbow', angle: 90 });
    expect(nodeKind(d, 0).kind).toBe('start-end'); expect(nodeKind(d, 3).kind).toBe('end');
  });
  it('cut list: 4" LR 90s take out 6", gap 1/8 at each weld', () => {
    const d = base(); d.runs = [run(0, 60, 0, 0), run(1, 0, 48, 0), run(2, 0, 0, 36)];
    const c = cutList(d);
    expect(c[0].cut).toBeCloseTo(60 - 6 - 0.125, 9); // open start: no gap, elbow end: TO + gap
    expect(c[1].cut).toBeCloseTo(48 - 12 - 0.25, 9);
  });
  it('45° offset is detected and uses the B16.9 45° take-out', () => {
    const d = base(); d.runs = [run(0, 60, 0, 0), run(1, 24, 24, 0), run(2, 60, 0, 0)];
    expect(nodeKind(d, 1).kind).toBe('elbow'); expect((nodeKind(d, 1) as { angle: number }).angle).toBeCloseTo(45, 9);
    expect(cutList(d)[1].to1).toBe(2.5);
  });
  it('branch from node 1 makes a tee with the tee take-out', () => {
    const d = base(); d.runs = [run(0, 60, 0, 0), run(1, 60, 0, 0), run(1, 0, 0, 30)];
    expect(nodeKind(d, 1).kind).toBe('tee'); expect(cutList(d)[2].to1).toBe(4.12);
  });
  it('rolling run described', () => expect(describeRun(run(0, 12, 12, 12))).toBe('Rolling N-E-Up'));
  it('iso projection: up is screen-up, north and east diverge', () => {
    expect(iso([0, 0, 10])[1]).toBe(-10);
    expect(iso([10, 0, 0])[0]).toBeCloseTo(iso([0, 10, 0])[0], 9);
    expect(iso([10, 0, 0])[1]).toBeGreaterThan(0); expect(iso([0, 10, 0])[1]).toBeLessThan(0);
  });
});
