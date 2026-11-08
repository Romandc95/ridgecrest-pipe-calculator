import { describe, it, expect } from 'vitest';
import { miter, cope, thermalExpansion } from '../src/engine/shop';
import { newDrawing, nodePositions, nodeKind, cutList, iso, IsoDrawing, Run, describeRun, project, unproject, ISO_VIEW, displayPositions, deleteSubtree, splitRun, itemLength } from '../src/engine/iso';
import { flange, valveFaceToFace, nptMakeup } from '../src/engine/refdata';

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
  it('ISO view projection equals the isometric drawing projection', () => {
    for (const p of [[10, 0, 0], [0, 10, 0], [0, 0, 10], [3, -7, 5]] as Array<[number, number, number]>) {
      const a = project(p, ISO_VIEW), b = iso(p);
      expect(a[0]).toBeCloseTo(b[0], 9); expect(a[1]).toBeCloseTo(b[1], 9);
    }
  });
  it('unproject finds the tapped point on the drawing plane, in any view', () => {
    for (const v of [ISO_VIEW, { az: 20, el: 60 }, { az: -130, el: 15 }]) {
      const p: [number, number, number] = [36, -24, 12];
      const [sx, sy] = project(p, v);
      const q = unproject(sx, sy, v, [0, 0, 12], [0, 0, 1])!;
      expect(q[0]).toBeCloseTo(36, 6); expect(q[1]).toBeCloseTo(-24, 6); expect(q[2]).toBeCloseTo(12, 6);
    }
    expect(unproject(5, 5, { az: 0, el: 0 }, [0, 0, 0], [0, 0, 1])).toBeNull(); // horizontal plane seen edge-on
  });
  it('sketched runs need a dimension before they get a cut length; measured runs use the measurement', () => {
    const d = base();
    d.runs = [{ ...run(0, 24, 0, 0), sketch: true, meas: [60, 0, 0] }, { ...run(1, 0, 24, 0), sketch: true }];
    const c = cutList(d);
    expect(c[0].cut).toBeCloseTo(60 - 6 - 0.125, 9);
    expect(c[1].ok).toBe(false); expect(c[1].note[0]).toBe('no dimension yet');
    // scaled view: measured run at true size, the other at the same ratio (60/24)
    const { P } = displayPositions(d, true);
    expect(P[1]).toEqual([60, 0, 0]); expect(P[2][1]).toBeCloseTo(60, 9);
    expect(displayPositions(d, false).P[1]).toEqual([24, 0, 0]);
  });
  it('deleting a run removes everything that continues from it and renumbers', () => {
    const d = base(); d.runs = [run(0, 10, 0, 0), run(1, 0, 10, 0), run(2, 0, 0, 10), run(1, 0, 0, -10)];
    d.ends = { 3: 'cap', 4: 'flange' }; d.notes = [{ id: 'n', node: 4, text: 'x' }];
    const e = deleteSubtree(d, 1);
    expect(e.runs.length).toBe(2); expect(e.runs[1].from).toBe(1); expect(e.runs[1].dz).toBe(-10);
    expect(e.ends).toEqual({ 2: 'flange' }); expect(e.notes[0].node).toBe(2);
  });
  it('fitting choices change the take-out: SR elbow, 3R bend, weldolet header straight through', () => {
    const d = base(); d.runs = [run(0, 60, 0, 0), run(1, 0, 48, 0)];
    d.fits = { 1: 'sr' }; expect(cutList(d)[0].to2).toBe(4);
    d.fits = { 1: 'r3' }; expect(cutList(d)[0].to2).toBeCloseTo(12, 9);
    const t = base(); t.runs = [run(0, 60, 0, 0), run(1, 60, 0, 0), run(1, 0, 0, 30)]; t.fits = { 1: 'weldolet' };
    const c = cutList(t);
    expect(c[0].to2).toBe(0); expect(c[0].gaps).toBe(0); // header: open start, continuous through the olet
    expect(c[2].to1).toBe(0); expect(c[2].note.join(' ')).toContain('weldolet');
  });
  it('several items on one line break it into spools; old single inline item still read', () => {
    const d = base(); d.runs = [{ ...run(0, 60, 0, 0), items: [{ id: 'a', type: 'gate', t: 0.3 }, { id: 'b', type: 'flange', t: 0.6 }] }, { ...run(1, 0, 48, 0), inline: 'check' }];
    const c = cutList(d);
    expect(c[0].pieces!.length).toBe(3);
    expect(c[0].note.join(' ')).toContain('enter the gate valve length');      // butt-weld gate: no standard length
    expect(c[1].note.join(' ')).toContain('enter the swing check length');      // legacy single item
  });
  it('a new start point (move) draws no pipe and makes a separate end', () => {
    const d = base(); d.runs = [run(0, 60, 0, 0), { ...run(1, 0, 48, 0), move: true }, run(2, 36, 0, 0)];
    const c = cutList(d);
    expect(c[1].skip).toBe(true);
    expect(nodeKind(d, 1).kind).toBe('end');          // the jump doesn't make an elbow
    expect(nodeKind(d, 2).kind).toBe('start-end');
    expect(c[2].to1).toBe(0); expect(c[2].gaps).toBe(0); // open start of the new line
  });
  it('threaded / flanged joints: no B16.9 take-out and no weld gap, with a note', () => {
    const d = base(); d.runs = [run(0, 60, 0, 0), run(1, 0, 48, 0)];
    d.conn = 'thd';
    const c = cutList(d);
    expect(c[0].to2).toBe(0); expect(c[0].gaps).toBe(0);
    expect(c[0].note.join(' ')).toContain('thread makeup');
    d.conn = 'bw'; d.nodeConn = { 1: 'flg' };
    expect(cutList(d)[0].note.join(' ')).toContain('flanged elbow');
  });
  it('splitting a line keeps what hangs off its end attached, shares out the measurement, and a branch makes a tee', () => {
    const d = base(); d.runs = [{ ...run(0, 96, 0, 0), meas: [96, 0, 0], items: [{ id: 'v', type: 'gate', t: 0.75 }] }, run(1, 0, 48, 0)];
    const { d: e, node } = splitRun(d, 0, 0.25, 'new');
    expect(node).toBe(3);
    const P = nodePositions(e), D = displayPositions(e, true).P;
    expect(P[3]).toEqual([24, 0, 0]); expect(P[1]).toEqual([96, 0, 0]); expect(P[2]).toEqual([96, 48, 0]);
    expect(D[1]).toEqual([96, 0, 0]);
    expect(e.runs[0].meas![0]).toBeCloseTo(72, 9); expect(e.runs[2].meas![0]).toBeCloseTo(24, 9);
    expect(e.runs[0].items![0].t).toBeCloseTo(2 / 3, 9); expect(e.runs[2].items!.length).toBe(0);
    expect(nodeKind(e, 3).kind).toBe('straight');
    e.runs.push({ ...run(3, 0, 0, 24) });
    expect(nodeKind(e, 3).kind).toBe('tee');
    expect(cutList(e)[0].to1).toBeCloseTo(4.12, 2); // tee C on the run side
  });
  it('a flanged valve on a line: B16.10 face-to-face, WN flanges + gasket, two spools; your length overrides', () => {
    const d = base(); d.runs = [{ ...run(0, 60, 0, 0), items: [{ id: 'v', type: 'gate', t: 0.5, conn: 'flg' }] }];
    const v = valveFaceToFace(150, 'gate', '4')!, y = flange(150, '4').yWN;
    const c = cutList(d)[0];
    const piece = 30 - v / 2 - (0.125 + y + 0.125); // open ends: no take-off, no gap at the ends
    expect(c.pieces![0].cut).toBeCloseTo(piece, 9); expect(c.pieces![1].cut).toBeCloseTo(piece, 9);
    d.runs[0].items![0].len = 10;
    expect(itemLength(d, d.runs[0].items![0]).len).toBe(10);
    expect(cutList(d)[0].pieces![0].cut).toBeCloseTo(30 - 5 - (0.25 + y), 9);
  });
  it('threaded valve: pipe gains thread makeup each side; cap end deducts cap E; your end take-off overrides', () => {
    const d = base(); d.runs = [{ ...run(0, 60, 0, 0), items: [{ id: 'v', type: 'ball', t: 0.5, conn: 'thd', len: 4 }] }];
    const mk = nptMakeup('4').makeup;
    expect(cutList(d)[0].pieces![0].cut).toBeCloseTo(30 - 2 + mk, 9);
    d.ends = { 1: 'cap' };
    expect(cutList(d)[0].to2).toBe(2.5); // B16.9 cap E, 4"
    d.endLen = { 1: 3 };
    expect(cutList(d)[0].to2).toBe(3);
  });
});
