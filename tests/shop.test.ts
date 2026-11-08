import { describe, it, expect } from 'vitest';
import { miter, cope, thermalExpansion } from '../src/engine/shop';
import { runLength, newDrawing, nodePositions, nodeKind, cutList, iso, IsoDrawing, Run, describeRun, project, unproject, ISO_VIEW, displayPositions, deleteSubtree, splitRun, itemLength, runSegments, shownLength, mergeAt, runRef, runSizes, weldList, materials, setOffsetAngle, offsetAt, specFor, endTakeoff, flangeFit } from '../src/engine/iso';
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
  it('a 10 ft line with a flanged valve in the middle shows two spools, each named by what it measures to', () => {
    const d = base(); d.runs = [{ ...run(0, 120, 0, 0), sketch: true, meas: [120, 0, 0], items: [{ id: 'v', type: 'gate', t: 0.5, conn: 'flg' }] }];
    const v = valveFaceToFace(150, 'gate', '4')!;
    const sg = runSegments(d, 0)!;
    expect(sg.length).toBe(2);
    expect(sg[0].kind).toBe('E-F'); expect(sg[1].kind).toBe('F-E'); // open pipe ends each side of a flanged valve
    const e = { ...d, runs: [{ ...run(0, 24, 0, 0) }, d.runs[0] ], } as IsoDrawing; e.runs[1] = { ...d.runs[0], from: 1 }; e.runs.push(run(2, 0, 24, 0));
    expect(runSegments(e, 1)![0].kind).toBe('E-F');  // straight joint at the start: pipe end
    expect(runSegments(e, 1)![1].kind).toBe('F-C');  // elbow at the end: center
    expect(sg[0].len).toBeCloseTo(60 - v / 2, 9); expect(sg[1].len).toBeCloseTo(60 - v / 2, 9);
    d.runs[0].items![0].at = 40; // valve center moved to 3'-4" from the start
    expect(runSegments(d, 0)![0].len).toBeCloseTo(40 - v / 2, 9);
  });
  it('a valve breaks the line like a tee: two lines measured to the valve faces, cut between them, and it can be merged back', () => {
    const d = base(); d.runs = [{ ...run(0, 120, 0, 0), sketch: true, meas: [120, 0, 0] }, run(1, 0, 48, 0)];
    const sp = splitRun(d, 0, 0.5, 'b'); const e = sp.d; const M = sp.node; // valve point
    e.inl = { [M]: { id: 'v', type: 'gate', t: 0.5, conn: 'flg' } };
    const v = valveFaceToFace(150, 'gate', '4')!, y = flange(150, '4').yWN;
    // run 2 (start → valve) and run 0 (valve → elbow)
    expect(shownLength(e, 2)).toBeCloseTo(60 - v / 2, 9); expect(runRef(e, 2)).toBe('E-F');
    expect(shownLength(e, 0)).toBeCloseTo(60 - v / 2, 9); expect(runRef(e, 0)).toBe('F-C');
    const c = cutList(e);
    expect(c[2].cut).toBeCloseTo(60 - v / 2 - (0.125 + y + 0.125), 9);
    expect(c[0].cut).toBeCloseTo(60 - v / 2 - (0.125 + y + 0.125) - 6 - 0.125, 9); // LR elbow + gap at the far end
    const m = mergeAt(e, M);
    expect(m.runs.length).toBe(2);
    expect(m.runs.map((r) => Math.round(runLength(r))).sort((a, b) => a - b)).toEqual([48, 120]);
    expect(nodePositions(m).some((p) => p[0] === 120 && p[1] === 48)).toBe(true); expect(m.inl).toEqual({});
    expect(cutList(m).every((c) => !c.note.some((n) => n.includes('gate')))).toBe(true);
  });
  it('a reducer with a size changes the line size after it; take-outs follow the size', () => {
    const d = base(); d.runs = [{ ...run(0, 60, 0, 0), sketch: true, meas: [60, 0, 0] }, { ...run(1, 48, 0, 0), sketch: true, meas: [48, 0, 0] }, run(2, 0, 36, 0)];
    d.inl = { 1: { id: 'r', type: 'reducer', t: 0.5, size: '2' } };
    expect(runSizes(d)).toEqual(['4', '2', '2']);
    const c = cutList(d);
    expect(c[1].to2).toBe(3); // 2" LR elbow at the far end of the 2" line
    expect(c[0].to2).toBeCloseTo(4 / 2 + 0.125, 9); // half a 4" B16.9 reducer (H = 4") + root gap
    // reducing tee branch takes the branch size
    const t2 = base(); t2.runs = [run(0, 60, 0, 0), run(1, 60, 0, 0), run(1, 0, 0, 36)]; t2.fits = { 1: 'redtee' }; t2.fitSize = { 1: '2' };
    expect(runSizes(t2)).toEqual(['4', '4', '2']);
  });
  it('a reducer at an elbow: the line in deducts the reducer + the smaller elbow; the line out is the small size', () => {
    const d = base(); d.runs = [{ ...run(0, 60, 0, 0) }, { ...run(1, 0, 48, 0) }];
    d.inl = { 1: { id: 'r', type: 'reducer', t: 0.5, size: '2' } };
    expect(runSizes(d)).toEqual(['4', '2']);
    const c = cutList(d);
    expect(c[0].to2).toBeCloseTo(3 + 4 + 0.125, 9);  // 2" LR elbow 3 + 4" reducer H 4 + weld gap between them
    expect(c[1].to1).toBe(3);                          // 2" LR elbow on the line out
  });
});

describe('ISO weld map and materials', () => {
  const run = (from: number, dx: number, dy: number, dz: number, id: string): Run => ({ id, from, dx, dy, dz, inline: 'none' });
  const base = (): IsoDrawing => ({ ...newDrawing('t', 'x'), nps: '4', gap: 0.125 });
  it('two butt-weld elbows and a flanged end → 5 welds, keys stable', () => {
    const d = base(); d.runs = [run(0, 60, 0, 0, 'a'), run(1, 0, 48, 0, 'b'), run(2, 0, 0, 36, 'c')]; d.ends = { 3: 'flange' };
    const w = weldList(d);
    expect(w.length).toBe(5);
    expect(w.map((x) => x.key)).toEqual(['a:b', 'b:a', 'b:b', 'c:a', 'c:b']);
  });
  it('threaded drawing has no welds; field welds counted apart', () => {
    const d = base(); d.runs = [run(0, 60, 0, 0, 'a'), run(1, 0, 48, 0, 'b')]; d.conn = 'thd';
    expect(weldList(d).length).toBe(0);
    d.conn = 'bw'; d.welds = { 'a:b': { field: true, stencil: 'RC1' } };
    const m = materials(d);
    expect(m.find((r) => r.item === 'Butt weld' && r.spec === 'field')!.qty).toBe(1);
    expect(m.find((r) => r.item === 'Butt weld' && r.spec === 'shop')!.qty).toBe(1);
    expect(m.find((r) => r.item.startsWith('LR elbow 90'))!.qty).toBe(1);
    expect(m.find((r) => r.item === 'Pipe')!.unit).toBe('ft');
  });
  it('flanged valve: two WN flange welds, 2 flanges, 2 gaskets, 2 bolt sets', () => {
    const d = base(); d.runs = [run(0, 60, 0, 0, 'a'), run(1, 60, 0, 0, 'b')]; d.inl = { 1: { id: 'v', type: 'gate', t: 0.5, conn: 'flg' } };
    expect(weldList(d).filter((w) => w.node === 1).length).toBe(2);
    const m = materials(d);
    expect(m.find((r) => r.item === 'WN flange')!.qty).toBe(2);
    expect(m.find((r) => r.item === 'Gasket')!.qty).toBe(2);
    expect(m.find((r) => r.item === 'Gate valve')!.qty).toBe(1);
  });
  it('socket-weld flange pair (2"): pipe stops Y − socket + 1/16" from each face, no root gap, socket welds, SW flanges', () => {
    const d = { ...base(), nps: '2' }; d.runs = [run(0, 60, 0, 0, 'a'), run(1, 60, 0, 0, 'b')];
    d.inl = { 1: { id: 'f', type: 'flange', t: 0.5, ft: 'SW', conn: 'sw' } };
    const f = flange(150, '2'); const toPipe = f.ySO! - f.socketDepth! + 1 / 16;
    expect(itemLength(d, d.inl[1]).len).toBeCloseTo(2 * toPipe + 0.125, 9);
    const c = cutList(d);
    expect(c[0].cut).toBeCloseTo(60 - toPipe - 0.0625, 9); // start is an open end: no take-off, no gap
    const w = weldList(d).filter((x) => x.node === 1);
    expect(w.length).toBe(2); expect(w.every((x) => x.conn === 'sw')).toBe(true);
    const m = materials(d);
    expect(m.find((r) => r.item === 'SW flange')!.qty).toBe(2); expect(m.some((r) => r.item === 'WN flange')).toBe(false);
    // the same pair as weld neck: root gap and WN hub
    d.inl = { 1: { id: 'f', type: 'flange', t: 0.5, ft: 'WN' } };
    expect(cutList(d)[0].cut).toBeCloseTo(60 - f.yWN - 0.0625 - 0.125, 9);
  });
  it('socket-weld flange end: take-off to pipe end; falls back to weld neck where B16.5 has no SW flange', () => {
    const d = { ...base(), nps: '2' }; d.runs = [run(0, 60, 0, 0, 'a')]; d.ends = { 1: 'flange' }; d.endFt = { 1: 'SW' };
    const f = flange(150, '2');
    expect(endTakeoff(d, 1)!.len).toBeCloseTo(f.ySO! - f.socketDepth! + 1 / 16, 9);
    expect(cutList(d)[0].cut).toBeCloseTo(60 - (f.ySO! - f.socketDepth! + 1 / 16), 9);
    expect(materials(d).some((r) => r.item === 'SW flange')).toBe(true);
    expect(flangeFit({ ...d, nps: '6' }, 'SW')!.ft).toBe('WN'); // no 6" socket-weld flange
    expect(flangeFit({ ...d, nps: '6' }, 'SW')!.note).toMatch(/weld neck used/);
  });
  it('blind flange end lists WN + blind + gasket + bolts', () => {
    const d = base(); d.runs = [run(0, 60, 0, 0, 'a')]; d.ends = { 1: 'blind' };
    const m = materials(d).map((r) => r.item);
    expect(m.includes('WN flange') && m.includes('Blind flange') && m.includes('Gasket') && m.includes('Stud bolt set')).toBe(true);
  });
});

describe('ISO offset angle', () => {
  const run = (from: number, v: [number, number, number], id: string): Run => ({ id, from, dx: v[0] / 4, dy: v[1] / 4, dz: v[2] / 4, inline: 'none', sketch: true, meas: v });
  it('45° offset of 12" set becomes 30°: run along = 12/tan30, set unchanged, next line follows', () => {
    const d: IsoDrawing = { ...newDrawing('t', 'x'), runs: [run(0, [48, 0, 0], 'a'), run(1, [12, 0, 12], 'b'), run(2, [48, 0, 0], 'c')] };
    expect(offsetAt(d, 1)!.run).toBe(1);
    const e = setOffsetAngle(d, 1, 30)!;
    const m = e.runs[1].meas!;
    expect(Math.abs(m[2] - 12) < 1e-9).toBe(true);
    expect(Math.abs(m[0] - 12 / Math.tan(Math.PI / 6)) < 1e-9).toBe(true);
    expect(Math.abs(Math.hypot(m[0], m[2]) - 24) < 1e-9).toBe(true); // travel = set / sin 30
    const at2 = setOffsetAngle(d, 2, 60)!; // tapping the other elbow edits the same offset
    expect(Math.abs(at2.runs[1].meas![0] - 12 / Math.tan(Math.PI / 3)) < 1e-9).toBe(true);
    expect(setOffsetAngle(d, 1, 90)).toBe(null);
  });
});

describe('ISO per-size settings', () => {
  const run = (from: number, v: [number, number, number], id: string): Run => ({ id, from, dx: v[0] / 4, dy: v[1] / 4, dz: v[2] / 4, inline: 'none', sketch: true, meas: v });
  it('the size after a reducer uses its own gap, class and schedule; unset = main', () => {
    const d: IsoDrawing = { ...newDrawing('t', 'x'), nps: '4', gap: 0.125, runs: [run(0, [60, 0, 0], 'a'), run(1, [60, 0, 0], 'b'), run(2, [0, 60, 0], 'c')], inl: { 1: { id: 'r', type: 'reducer', t: 0.5, size: '2' } } };
    expect(specFor(d, '2').gap).toBe(0.125);
    const before = cutList(d)[2].cut;
    d.sizeSpec = { '2': { gap: 0.0625, sch: '80', cls: 300 } };
    expect(Math.abs(cutList(d)[2].cut - before - 0.0625) < 1e-9).toBe(true); // one butt weld at the elbow end of line 3 (the other end is open)
    expect(materials(d).find((m) => m.item === 'Pipe' && m.size === '2')!.spec).toBe('Sch 80');
    expect(materials(d).find((m) => m.item === 'Pipe' && m.size === '4')!.spec).toBe('Sch 40');
  });
});

describe('ISO fitting with no standard length', () => {
  const run = (from: number, v: [number, number, number], id: string): Run => ({ id, from, dx: v[0] / 4, dy: v[1] / 4, dz: v[2] / 4, inline: 'none', sketch: true, meas: v });
  it('a flanged flow meter with no length: lines measured to its faces still get a cut', () => {
    const d: IsoDrawing = { ...newDrawing('t', 'x'), nps: '3', gap: 0.125, runs: [run(0, [0, 0, -38.375], 'a'), run(1, [0, 0, -23], 'b')], inl: { 1: { id: 'f', type: 'flowmeter', t: 0.5, conn: 'flg' } } };
    const c = cutList(d);
    expect(Number.isNaN(c[0].cut)).toBe(false);
    expect(Number.isNaN(c[1].cut)).toBe(false);
    // 3" Class 150 WN flange Y = 2.69", gasket 1/8", gap 1/8": the pipe stops short of the meter face by Y + gasket + gap
    expect(Math.abs(c[0].cut - (38.375 - (2.69 + 0.125 + 0.125))) < 1e-6).toBe(true);
  });
});

describe('drawing notation in length boxes', () => {
  it("5'-7 5/8\" reads as 67-5/8\"", async () => {
    const { parseLength } = await import('../src/engine/parse');
    expect(parseLength(`5'-7 5/8"`)).toBe(67.625);
    expect(parseLength(`4'-0"`)).toBe(48);
    expect(parseLength('67 5/8')).toBe(67.625);
  });
});

describe('ISO joined line ends', () => {
  const run = (from: number, v: [number, number, number], id: string): Run => ({ id, from, dx: v[0] / 4, dy: v[1] / 4, dz: v[2] / 4, inline: 'none', sketch: true, meas: v });
  it('a loop closed back onto the start point makes it an elbow, counted once', () => {
    const d: IsoDrawing = { ...newDrawing('t', 'x'), runs: [run(0, [48, 0, 0], 'a'), run(1, [0, 48, 0], 'b'), run(2, [-48, 0, 0], 'c'), run(3, [0, -48, 0], 'd')], links: { 4: 0 } };
    expect(nodeKind(d, 0).kind).toBe('elbow');
    expect(nodeKind(d, 4).kind).toBe('elbow');
    expect(weldList(d).length).toBe(8);
    expect(materials(d).find((m) => m.item.startsWith('LR elbow'))!.qty).toBe(4);
    const c = cutList(d);
    expect(Math.abs(c[3].cut - c[0].cut) < 1e-9).toBe(true); // both ends are elbows now
  });
  it('a new line tied into the middle of a line makes a tee there', () => {
    const d: IsoDrawing = { ...newDrawing('t', 'x'), runs: [run(0, [96, 0, 0], 'a'), run(0, [0, 0, 0], 'm'), run(2, [48, 48, 0], 'x')], links: {} };
    d.runs[1] = { ...d.runs[1], move: true, dx: 12, dy: 12, dz: 0, meas: undefined };
    const s = splitRun(d, 0, 0.5, 'n');
    const e: IsoDrawing = { ...s.d, runs: s.d.runs.map((r, i) => (i === 2 ? { ...r, meas: [36, -12, 0] as [number, number, number] } : r)), links: { 3: s.node } };
    expect(nodeKind(e, s.node).kind).toBe('tee');
  });
});

describe('ISO pipe letters follow the pipe', () => {
  it('a valve added later to the first line keeps A, B before the next line', async () => {
    const { pipeOrder } = await import('../src/engine/iso');
    const run = (from: number, v: [number, number, number], id: string): Run => ({ id, from, dx: v[0], dy: v[1], dz: v[2], inline: 'none', sketch: true });
    const d: IsoDrawing = { ...newDrawing('t', 'x'), runs: [run(0, [48, 0, 0], 'a'), run(1, [0, 48, 0], 'b')] };
    const s = splitRun(d, 0, 0.5, 'c'); // split line 1: its first half is appended as run 2
    expect(pipeOrder(s.d)).toEqual([2, 0, 1]);
  });
});
