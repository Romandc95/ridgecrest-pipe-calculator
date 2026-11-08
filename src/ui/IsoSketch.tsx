import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Field, Msg, Select, Segmented, Card, Grid, useApp } from './components';
import { usePersistent, uid, shareText } from './store';
import { parseLength, parseAngle, tryParse } from '../engine/parse';
import { formatFtIn, formatFracIn, formatNumber } from '../engine/format';
import {
  IsoDrawing, Run, Inline, INLINE_LABEL, EndType, END_LABEL, DIRS, Vec3, newDrawing, nodeKind, nodeLegs, cutList,
  runLength, runVec, describeRun, isMeasured, sketchVec, View, ISO_VIEW, VIEW_PRESETS, project, unproject, viewBasis, displayPositions, deleteSubtree, splitRun, stemDir, itemLength, endTakeoff, runSegments, itemPos, runRef, inlineAt, faceAdj, shownLength, mergeAt, sidesOf, runSizes, isReducer, weldList, materials, Weld, WeldInfo,
  CATALOG, CATALOG_GROUPS, catalogItem, runItems, CatalogItem, Conn, CONN_LABEL, CONN_ORDER, connAt,
} from '../engine/iso';
import { lineSymbol, nodeSymbol, endSymbol, PaletteIcon, jointMark, JointIcon, legJoint } from './isoSymbols';
import { B169, npsNumber } from '../engine/fittings';
import { FLANGE_CLASSES, FlangeClass } from '../engine/refdata';
const npsVal = (n: string) => npsNumber(n) ?? 0;

type Prefs = ReturnType<typeof useApp>['settings']['prefs'];
interface IsoStore { drawings: IsoDrawing[]; current: string | null }
type Sel = { kind: 'node'; id: number } | { kind: 'run'; id: number } | { kind: 'item'; run: number; id: string } | { kind: 'dim'; run: number } | { kind: 'weld'; key: string } | { kind: 'text'; id: string } | null;
type Mode = 'draw' | 'orbit' | 'pan';
type Plane = 'EN' | 'EU' | 'NU';
interface Opts { dims: boolean; welds: boolean; labels: boolean; scaled: boolean; weldmap?: boolean; view: View; mode: Mode; plane: Plane; conn: Conn }
type ArtOpts = Pick<Opts, 'dims' | 'welds' | 'labels' | 'weldmap'> & { textEdit?: boolean };

const PLANES: Record<Plane, { n: Vec3; a: Vec3; b: Vec3; label: string }> = {
  EN: { n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0], label: 'Flat' },
  EU: { n: [0, 1, 0], a: [1, 0, 0], b: [0, 0, 1], label: 'E–W wall' },
  NU: { n: [1, 0, 0], a: [0, 1, 0], b: [0, 0, 1], label: 'N–S wall' },
};
const GRID = 12; // one grid square = 12 drawing units (1 ft when drawn to scale)
/** Fraction along a run where a split lands: on a whole grid square of the drawn line, never at its ends. */
const snapSplitT = (r: Run, t: number) => {
  const L = Math.hypot(r.dx, r.dy, r.dz);
  if (L < GRID * 2) return 0.5;
  const n = Math.max(1, Math.min(Math.floor((L - 1e-6) / GRID), Math.round((t * L) / GRID)));
  return (n * GRID) / L;
};
const AXIS_NAMES: Array<[string, string]> = [['East', 'West'], ['North', 'South'], ['Up', 'Down']];
const DIR_ORDER = ['W', 'U', 'N', 'S', 'D', 'E'] as const;
const DIR_SHORT: Record<string, string> = { N: 'N', S: 'S', E: 'E', W: 'W', U: 'Up', D: 'Down' };

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const nz = (x: number) => Math.abs(x) > 1e-9;
const clampEl = (e: number) => Math.max(-90, Math.min(90, e));
const normAz = (a: number) => ((a + 180) % 360 + 360) % 360 - 180;
/** Next compass step (ISO orientations every 90°) from an azimuth, turning in direction dir (+1 / −1). */
const stepAz = (az: number, dir: number) => { const k = (az - ISO_VIEW.az) / 90; return normAz(ISO_VIEW.az + 90 * (dir > 0 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1)); };

export function IsoSketch() {
  const { settings, toast } = useApp();
  const prefs = settings.prefs;
  const [store, setStore] = usePersistent<IsoStore>('iso', { drawings: [], current: null });
  const [opts, setOptsRaw] = usePersistent<Opts>('isoview', { dims: true, welds: true, labels: false, scaled: false, view: ISO_VIEW, mode: 'draw', plane: 'EN', conn: 'bw' });
  const setOpts = (p: Partial<Opts>) => setOptsRaw((o) => ({ ...o, ...p }));
  const [sel, setSel] = useState<Sel>(null);
  const [cursor, setCursor] = useState(0);
  const [lenText, setLenText] = useState('');
  const [panel, setPanel] = useState<'cut' | 'setup' | 'library'>('cut');
  const [full, setFull] = useState(false);
  const [hide, setHide] = useState(false);
  const [land, setLand] = useState(true);
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [fitTick, setFitTick] = useState(0);
  const apiFull = useRef(false);
  const [armed, setArmed] = useState<string | null>(null); // catalog key "kind:id" waiting to be placed
  const canvasApi = useRef<CanvasApi | null>(null);
  const [more, setMore] = useState(false); // show the full point / line panel under the drawing
  const [offOpen, setOffOpen] = useState(false); // offset tab on the drawing
  const [dots, setDots] = useState(false); // ⋮ menu
  const [modal, setModal] = useState<null | 'name' | 'complete' | 'drawings'>(null);
  useEffect(() => setMore(false), [JSON.stringify(sel)]);
  const history = useRef<{ id: string; snaps: IsoDrawing[]; redo: IsoDrawing[]; last: number; key: string }>({ id: '', snaps: [], redo: [], last: 0, key: '' });
  const [, setHistTick] = useState(0);

  useEffect(() => {
    const onR = () => setWin({ w: window.innerWidth, h: window.innerHeight });
    const onFs = () => { if (!document.fullscreenElement && apiFull.current) { apiFull.current = false; setFull(false); setHide(false); } };
    window.addEventListener('resize', onR); document.addEventListener('fullscreenchange', onFs);
    return () => { window.removeEventListener('resize', onR); document.removeEventListener('fullscreenchange', onFs); };
  }, []);

  useEffect(() => {
    if (!store.drawings.length) {
      const d = newDrawing('Iso 1', uid());
      setStore({ drawings: [d], current: d.id });
    } else if (!store.drawings.find((d) => d.id === store.current)) setStore((s) => ({ ...s, current: s.drawings[0].id }));
  }, [store.drawings.length]);
  const d = store.drawings.find((x) => x.id === store.current) ?? store.drawings[0];
  const disp = useMemo(() => (d ? displayPositions(d, opts.scaled) : { P: [[0, 0, 0]] as Vec3[], k: 1, vecs: [] as Vec3[] }), [d, opts.scaled]);
  if (!d) return null;

  if (history.current.id !== d.id) history.current = { id: d.id, snaps: [], redo: [], last: 0, key: '' };
  const update = (f: (d: IsoDrawing) => IsoDrawing, mergeKey = '') => {
    // remember the drawing before each change for Undo; keystrokes in the same field count as one change
    const h = history.current, now = Date.now();
    const merge = mergeKey && mergeKey === h.key && now - h.last < 4000 && h.snaps.length;
    if (!merge) { h.snaps.push(d); if (h.snaps.length > 100) h.snaps.shift(); setHistTick((t) => t + 1); }
    h.last = now; h.key = mergeKey;
    if (h.redo.length) { h.redo = []; setHistTick((t) => t + 1); } // a new change ends the Forward trail
    setStore((s) => ({ ...s, drawings: s.drawings.map((x) => (x.id === d.id ? { ...f(x), updated: Date.now() } : x)) }));
  };
  const cur = Math.min(cursor, d.runs.length);
  const isTurn = (node: number) => nodeKind(d, node).kind === 'elbow';
  const addRun = (r: Omit<Run, 'id' | 'from'>, from = cur) => {
    if (!r.move && isTurn(from)) { toast("Lines can't start from a turn (elbow or offset). Start from a line end, a tee or the middle of a straight line."); return; }
    const n = d.runs.length;
    update((x) => ({ ...x, runs: [...x.runs, { ...r, id: uid(), from }] }));
    setCursor(n + 1); setSel(null);
  };
  const addDir = (k: string) => {
    const v = DIRS[k].v;
    const p = tryParse(parseLength, lenText);
    if (p && !p.ok) { toast(p.err); return; }
    if (p && p.ok && p.v > 0) addRun({ dx: v[0] * p.v, dy: v[1] * p.v, dz: v[2] * p.v, inline: 'none', sketch: true, meas: mul(v, p.v) });
    else addRun({ dx: v[0] * GRID * 2, dy: v[1] * GRID * 2, dz: v[2] * GRID * 2, inline: 'none', sketch: true });
  };
  const drawTo = (vec: Vec3 | null, from: number, split?: { run: number; t: number }) => {
    if (!vec) { toast('This drawing plane is edge-on in this view — turn the view or pick another plane'); return; }
    const s = mul(vec, 1 / (disp.k || 1));
    if (split) {
      // branch off the middle of a line: split it there (a tee) and run the new line from the split
      const end = d.runs.length + 2;
      update((x) => { const sp = splitRun(x, split.run, split.t, uid()); return { ...sp.d, runs: [...sp.d.runs, { id: uid(), from: sp.node, dx: s[0], dy: s[1], dz: s[2], inline: 'none', sketch: true }] }; });
      setCursor(end); setSel(null);
      return;
    }
    addRun({ dx: s[0], dy: s[1], dz: s[2], inline: 'none', sketch: true }, Math.min(from, d.runs.length));
  };
  /** Put a catalog item on a line or point. Returns false (with a message) if it doesn't fit there. */
  const place = (key: string, target0: Sel, t = 0.5): boolean => {
    const [kind, id] = key.split(':');
    const item = catalogItem(id, kind as CatalogItem['kind']);
    const target: Sel = target0?.kind === 'item' ? { kind: 'run', id: target0.run } : target0;
    if (!item || !target) return false;
    if (item.kind === 'branch') return placeBranch(item, target, t);
    if (item.kind === 'end' && item.id === 'reducer') return place('line:reducer', target, t);
    if (item.kind === 'line') {
      const newIt = { id: uid(), type: item.id, t: 0.5, conn: opts.conn };
      if (target.kind === 'node') {
        // on an existing straight joint: the fitting sits right there; a reducer can also go on the end of a line
        const nk = nodeKind(d, target.id).kind;
        const endOk = isReducer(item.id) && (nk === 'end' || nk === 'start-end') && target.id > 0;
        if ((nk !== 'straight' && !endOk) || inlineAt(d, target.id)) { toast(isReducer(item.id) ? 'Drop the reducer on a line or a line end' : `Drop the ${item.label.toLowerCase()} on a straight line`); return false; }
        update((x) => ({ ...x, inl: { ...(x.inl ?? {}), [target.id]: newIt } }));
        setSel({ kind: 'node', id: target.id });
      } else {
        // on a line: break it there (like a tee) — two lines, each measured to the fitting
        const r = d.runs[target.id];
        if (r.move) { toast('That dotted link is not a pipe'); return false; }
        let tt = snapSplitT(r, t);
        if (isMeasured(r)) { const L = runLength(r); tt = Math.max(1, Math.min(L - 1, Math.round(t * L))) / L; } // center on a whole inch
        const node = d.runs.length + 1;
        update((x) => {
          // give a short sketched line room for two dimensions (sketch only)
          const q = x.runs[target.id]; const sl = Math.hypot(q.dx, q.dy, q.dz), want = GRID * 6;
          const grow = q.sketch && sl > 0 && sl < want ? want / sl : 1;
          const x2 = grow === 1 ? x : { ...x, runs: x.runs.map((z, k) => (k === target.id ? { ...z, dx: z.dx * grow, dy: z.dy * grow, dz: z.dz * grow } : z)) };
          const sp = splitRun(x2, target.id, tt, uid());
          return { ...sp.d, inl: { ...(sp.d.inl ?? {}), [sp.node]: newIt } };
        });
        setSel({ kind: 'node', id: node });
      }
    } else {
      if (target.kind !== 'node') { toast(`Drop the ${item.label.toLowerCase()} on a ${item.kind === 'end' ? 'line end' : item.kind === 'elbow' ? 'turn' : 'tee point'}`); return false; }
      const nk = nodeKind(d, target.id).kind;
      const ok = item.kind === 'end' ? nk === 'end' || nk === 'start-end' : item.kind === 'elbow' ? nk === 'elbow' : nk === 'tee' || nk === 'cross';
      if (!ok) { toast(item.kind === 'end' ? 'That point is not the end of a line' : item.kind === 'elbow' ? 'That point is not a turn (elbow)' : 'That point is not a branch (tee)'); return false; }
      if (item.kind === 'end') update((x) => ({ ...x, ends: { ...x.ends, [target.id]: item.id }, nodeConn: { ...(x.nodeConn ?? {}), [target.id]: opts.conn } }));
      else update((x) => ({ ...x, fits: { ...(x.fits ?? {}), [target.id]: item.id }, nodeConn: { ...(x.nodeConn ?? {}), [target.id]: opts.conn } }));
      setSel({ kind: 'node', id: target.id });
    }
    toast(`${CONN_LABEL[opts.conn]} ${item.label.toLowerCase()} placed`);
    return true;
  };
  const canUndo = history.current.snaps.length > 0;
  const canRedo = history.current.redo.length > 0;
  const restore = (to: IsoDrawing) => {
    history.current.last = 0; history.current.key = ''; setHistTick((t) => t + 1);
    setStore((s) => ({ ...s, drawings: s.drawings.map((x) => (x.id === to.id ? to : x)) }));
    setSel(null); setArmed(null); setCursor(to.runs.length);
  };
  /** Back: step to the drawing before the last change. Forward: re-apply what Back took away. */
  const undo = () => { const prev = history.current.snaps.pop(); if (!prev) return; history.current.redo.push(d); restore(prev); };
  const redo = () => { const next = history.current.redo.pop(); if (!next) return; history.current.snaps.push(d); restore(next); };
  /** Incoming direction at the current point, used as the default heading for an offset. */
  const heading = (() => {
    const r = d.runs[cur - 1];
    if (!r || cur === 0 || r.move) return 'E';
    const v = sketchVec(r); const L = len3(v);
    return (Object.keys(DIRS).find((k) => dot3(DIRS[k].v, v) > L * 0.999) ?? 'E');
  })();
  const addOffset = (o: OffsetSpec) => {
    const h = DIRS[o.heading].v, a = DIRS[o.toward].v, b = o.roll ? DIRS[o.roll].v : null;
    const measured = o.offset !== null && (!b || o.rollAmt !== null);
    const O = o.offset ?? GRID * 2, R = b ? (o.rollAmt ?? GRID * 2) : 0;
    const setting = Math.hypot(O, R) / Math.tan((o.angle * Math.PI) / 180);
    const v = add(add(mul(h, setting), mul(a, O)), b ? mul(b, R) : [0, 0, 0]);
    addRun({ dx: v[0], dy: v[1], dz: v[2], inline: 'none', sketch: true, ...(measured ? { meas: v } : {}) });
    toast(`${b ? 'Rolling offset' : 'Offset'} added`);
  };
  /** A direction square to a run (for a new branch): Up off a level line, East (or North) off a vertical one. */
  const perpTo = (v: Vec3): Vec3 => {
    const L = len3(v) || 1;
    if (Math.abs(v[2]) / L < 0.01) return [0, 0, 1];
    return Math.abs(v[0]) / L < 0.01 ? [1, 0, 0] : [0, 1, 0];
  };
  /**
   * Branch fittings: on a tee point they just set the fitting. Dropped on a line, the line is split there and a short
   * branch (2 squares, to be dimensioned) is added; on a straight joint or an elbow a branch is added at that point.
   */
  const placeBranch = (item: CatalogItem, target: Sel, t: number): boolean => {
    const conn = opts.conn;
    const stub = (x: IsoDrawing, node: number, dir: Vec3): IsoDrawing => ({
      ...x,
      runs: [...x.runs, { id: uid(), from: node, dx: dir[0] * GRID * 2, dy: dir[1] * GRID * 2, dz: dir[2] * GRID * 2, inline: 'none', sketch: true }],
      fits: { ...(x.fits ?? {}), [node]: item.id }, nodeConn: { ...(x.nodeConn ?? {}), [node]: conn },
    });
    if (target?.kind === 'run') {
      const r = d.runs[target.id];
      if (r.move) { toast('That dotted link is not a pipe'); return false; }
      const sv = sketchVec(r);
      const tt = snapSplitT(r, t);
      const node = d.runs.length + 1;
      update((x) => { const sp = splitRun(x, target.id, tt, uid()); return stub(sp.d, sp.node, perpTo(sv)); });
      setCursor(node + 1); setSel({ kind: 'node', id: node });
      toast(`${CONN_LABEL[conn]} ${item.label.toLowerCase()} placed — branch added`);
      return true;
    }
    if (target?.kind !== 'node') return false;
    const nk = nodeKind(d, target.id);
    if (nk.kind === 'tee' || nk.kind === 'cross') {
      update((x) => ({ ...x, fits: { ...(x.fits ?? {}), [target.id]: item.id }, nodeConn: { ...(x.nodeConn ?? {}), [target.id]: conn } }));
    } else if (nk.kind === 'elbow') {
      toast('Branch fittings go on a straight line or a tee, not on a turn'); return false;
    } else if (nk.kind === 'straight') {
      const legs = nodeLegs(d, target.id);
      const dir = perpTo(legs[0].dir);
      update((x) => stub(x, target.id, dir));
      setCursor(d.runs.length + 1);
    } else { toast('Drop a branch fitting on a line (or on a tee point)'); return false; }
    setSel({ kind: 'node', id: target.id });
    toast(`${CONN_LABEL[conn]} ${item.label.toLowerCase()} placed`);
    return true;
  };
  /** Change / move / delete a fitting that sits on a line. */
  const setItem = (run: number, id: string, f: (it: ReturnType<typeof runItems>[number]) => ReturnType<typeof runItems>[number] | null, mergeKey?: string) =>
    update((x) => ({ ...x, runs: x.runs.map((q, k) => (k === run ? { ...q, inline: 'none', items: runItems(q).map(f).filter(Boolean) as ReturnType<typeof runItems> } : q)) }), mergeKey);
  const moveItemTo = (fromRun: number, id: string, toRun: number, t: number) => {
    const it = runItems(d.runs[fromRun]).find((q) => q.id === id); if (!it) return;
    if (d.runs[toRun]?.move) { toast('That dotted link is not a pipe'); return; }
    update((x) => ({ ...x, runs: x.runs.map((q, k) => {
      let items = runItems(q);
      if (k === fromRun) items = items.filter((z) => z.id !== id);
      if (k === toRun) items = [...items, { ...it, t }].sort((a, b) => a.t - b.t);
      return k === fromRun || k === toRun ? { ...q, inline: 'none', items } : q;
    }) }));
    setSel({ kind: 'item', run: toRun, id });
    toast('Moved');
  };
  const branchRunOf = (x: IsoDrawing, n: number) => {
    const legs = nodeLegs(x, n);
    const b = legs.find((l) => !legs.some((m) => m !== l && dot3(l.dir, m.dir) < -0.9999));
    return b && x.runs[b.run].from === n ? b.run : -1;
  };
  /** Move a valve / inline fitting to another line (tapped at t): join its line back, break the new one. */
  const moveInline = (n: number, targetRun: number, t: number) => update((x) => {
    const it = x.inl?.[n]; if (!it) return x;
    const tgtId = x.runs[targetRun]?.id; if (!tgtId || x.runs[targetRun].move) return x;
    let y: IsoDrawing, tgt = tgtId, tJ = t;
    const sd = sidesOf(x, n);
    if (sd && nodeKind(x, n).kind === 'straight') {
      const A = x.runs[sd[0]], B = x.runs[sd[1]];
      const la = Math.hypot(A.dx, A.dy, A.dz), lb = Math.hypot(B.dx, B.dy, B.dz);
      if (tgtId === A.id) tJ = (t * la) / (la + lb); else if (tgtId === B.id) { tJ = (la + t * lb) / (la + lb); tgt = A.id; }
      y = mergeAt(x, n);
    } else { const inl = { ...(x.inl ?? {}) }; delete inl[n]; y = { ...x, inl }; }
    const k = y.runs.findIndex((r) => r.id === tgt); if (k < 0) return x;
    { // room for two dimensions on a short sketched line (sketch only)
      const q = y.runs[k]; const sl = Math.hypot(q.dx, q.dy, q.dz), want = GRID * 6;
      if (q.sketch && sl > 0 && sl < want) { const g2 = want / sl; y = { ...y, runs: y.runs.map((z, j) => (j === k ? { ...z, dx: z.dx * g2, dy: z.dy * g2, dz: z.dz * g2 } : z)) }; }
    }
    const r = y.runs[k];
    let tt = snapSplitT(r, tJ);
    if (isMeasured(r)) { const L = runLength(r); tt = Math.max(1, Math.min(L - 1, Math.round(tJ * L))) / L; }
    const sp = splitRun(y, k, tt, uid());
    return { ...sp.d, inl: { ...(sp.d.inl ?? {}), [sp.node]: it } };
  });
  /** Move a tee (its branch) to another line: break that line, hang the branch there, join the old header back. */
  const moveTee = (n: number, targetRun: number, t: number): boolean => {
    const b = branchRunOf(d, n);
    if (b < 0) { toast('This tee is drawn from its branch — redraw it to move it'); return false; }
    if (targetRun === b || d.runs[targetRun]?.move) { toast('Tap the line the tee should go on'); return false; }
    update((x) => {
      const hId = x.runs[n - 1]?.id;
      const r = x.runs[targetRun];
      let tt = snapSplitT(r, t);
      if (isMeasured(r)) { const L = runLength(r); tt = Math.max(1, Math.min(L - 1, Math.round(t * L))) / L; }
      const sp = splitRun(x, targetRun, tt, uid());
      const M = sp.node;
      let y: IsoDrawing = { ...sp.d, runs: sp.d.runs.map((q, k) => (k === b ? { ...q, from: M } : q)),
        fits: { ...(sp.d.fits ?? {}), ...(x.fits?.[n] ? { [M]: x.fits[n] } : {}) }, fitSize: { ...(sp.d.fitSize ?? {}), ...(x.fitSize?.[n] ? { [M]: x.fitSize[n] } : {}) },
        nodeConn: { ...(sp.d.nodeConn ?? {}), ...(x.nodeConn?.[n] ? { [M]: x.nodeConn[n] } : {}) } };
      const hi = y.runs.findIndex((q) => q.id === hId);
      if (hi >= 0 && nodeKind(y, hi + 1).kind === 'straight') y = mergeAt(y, hi + 1);
      return y;
    });
    return true;
  };
  /** Delete a tee: remove its branch and join the header back into one line. */
  const deleteTee = (n: number) => {
    const b = branchRunOf(d, n);
    if (b < 0) { toast('This tee is drawn from its branch — delete the lines instead'); return; }
    update((x) => {
      const hId = x.runs[n - 1]?.id;
      let y = deleteSubtree(x, b);
      const hi = y.runs.findIndex((q) => q.id === hId);
      if (hi >= 0 && nodeKind(y, hi + 1).kind === 'straight') y = mergeAt(y, hi + 1);
      return y;
    });
    setSel(null);
  };
  const moveEnd = (n: number, m: number) => update((x) => {
    const ends = { ...x.ends }, nc = { ...(x.nodeConn ?? {}) }, el = { ...(x.endLen ?? {}) };
    ends[m] = ends[n]; ends[n] = 'open';
    if (nc[n]) { nc[m] = nc[n]; delete nc[n]; }
    if (el[n] != null) { el[m] = el[n]; delete el[n]; }
    return { ...x, ends, nodeConn: nc, endLen: el };
  });
  /** New start point: an invisible jump from the current point to where the paper was tapped. */
  const startAt = (v: Vec3 | null) => {
    setArmed(null);
    if (!v) { toast('Tap the paper away from the current point'); return; }
    const s0 = mul(v, 1 / (disp.k || 1));
    addRun({ dx: s0[0], dy: s0[1], dz: s0[2], inline: 'none', sketch: true, move: true });
    toast('New start point — drag from it to draw');
  };
  const onTap = (t: Sel, at?: number) => {
    if (armed === 'notes') { setSel(t?.kind === 'text' ? t : null); return; }
    if (armed === 'text') return;
    if (armed === 'start') { if (t?.kind === 'node') { setArmed(null); setCursor(t.id); setSel(t); toast(`Drawing from point ${t.id}`); } return; }
    if (armed?.startsWith('mv:')) {
      const n = Number(armed.slice(3));
      setArmed(null);
      const pk = pointKind(d, n);
      const tr = t?.kind === 'run' ? t.id : t?.kind === 'item' ? t.run : t?.kind === 'dim' ? t.run : null;
      if (pk === 'inline') { if (tr !== null) { moveInline(n, tr, at ?? 0.5); toast('Moved'); } else toast('Tap a line to move it there'); }
      else if (pk === 'tee') { if (tr !== null) { if (moveTee(n, tr, at ?? 0.5)) toast('Tee moved'); } else toast('Tap a line to move the tee there'); }
      else if (pk === 'end') {
        const nk = t?.kind === 'node' ? nodeKind(d, t.id).kind : null;
        if (t?.kind === 'node' && (nk === 'end' || nk === 'start-end') && t.id !== n) { moveEnd(n, t.id); toast('Moved'); } else toast('Tap the end of a line to move it there');
      }
      return;
    }
    if (armed?.startsWith('move:')) {
      const [, fr, iid] = armed.split(':');
      setArmed(null);
      if (t && (t.kind === 'run' || t.kind === 'item')) moveItemTo(Number(fr), iid, t.kind === 'run' ? t.id : t.run, at ?? 0.5);
      else toast('Tap a line to move it there');
      return;
    }
    if (armed) { if (t) { if (place(armed, t, at)) setArmed(null); } else setArmed(null); return; }
    setSel(t);
    if (t?.kind === 'node' && !inlineAt(d, t.id) && nodeKind(d, t.id).kind !== 'elbow') setCursor(t.id);
    if (t?.kind === 'run') setCursor(t.id + 1);
  };
  const itemSel = sel?.kind === 'item' && d.runs[sel.run] && runItems(d.runs[sel.run]).some((q) => q.id === sel.id) ? sel : null;

  const placeText = (node: number, off: Vec3) => {
    const id = uid();
    update((x) => ({ ...x, texts: [...(x.texts ?? []), { id, node, off, text: '' }] }));
    setArmed('notes'); setSel({ kind: 'text', id });
  };
  const moveText = (id: string, node: number, off: Vec3) => update((x) => ({ ...x, texts: (x.texts ?? []).map((t) => (t.id === id ? { ...t, node, off } : t)) }), 'tmove' + id);
  const setText = (id: string, text: string | null) => update((x) => ({ ...x, texts: (x.texts ?? []).flatMap((t) => (t.id !== id ? [t] : text === null ? [] : [{ ...t, text }])) }), text === null ? '' : 'ttext' + id);
  const closeText = (id: string) => { const t = d.texts?.find((q) => q.id === id); if (t && !t.text.trim()) setText(id, null); setSel(null); };
  const openDrawing = (id: string) => { setStore((s) => ({ ...s, current: id })); setSel(null); setArmed(null); setCursor(0); setOffOpen(false); setFitTick((t) => t + 1); };
  const newDrawingNow = () => { const nd = newDrawing(`Iso ${store.drawings.length + 1}`, uid()); setStore((s) => ({ drawings: [nd, ...s.drawings], current: nd.id })); openDrawing(nd.id); toast('New drawing'); };
  const welds = opts.weldmap ? weldList(d) : [];
  const weldSel = sel?.kind === 'weld' ? welds.findIndex((w) => w.key === sel.key) : -1;
  const textSel = sel?.kind === 'text' ? d.texts?.find((t) => t.id === sel.id) ?? null : null;

  const enterFull = () => {
    setFull(true); setLand(true); setFitTick((t) => t + 1);
    const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
    try {
      el.requestFullscreen?.().then(() => {
        apiFull.current = true;
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        o?.lock?.('landscape').catch(() => {});
      }).catch(() => {});
    } catch { /* not available: the overlay still fills the window */ }
  };
  const exitFull = () => {
    setFull(false); setHide(false); setFitTick((t) => t + 1);
    try { if (document.fullscreenElement) { apiFull.current = false; document.exitFullscreen(); } } catch { /* ignore */ }
  };

  const portrait = win.h > win.w;
  const rot = full && land && portrait;
  const wide = full && (rot || !portrait);
  const selRun = sel?.kind === 'run' && d.runs[sel.id] ? sel.id : null;
  const selNode = sel?.kind === 'node' && sel.id <= d.runs.length ? sel.id : null;
  const cuts = cutList(d);
  const missing = d.runs.filter((r) => !r.move && !isMeasured(r)).length;

  const editor = selRun !== null
    ? <RunEditor key={d.runs[selRun].id} d={d} i={selRun} prefs={prefs} cut={cuts[selRun]} update={update} onClose={() => setSel(null)}
        onDelete={() => { update((x) => deleteSubtree(x, selRun)); setSel(null); setCursor(d.runs[selRun].from); }} />
    : selNode !== null && pointKind(d, selNode) && !more ? null
    : selNode !== null ? (inlineAt(d, selNode) ? <InlineEditor key={'i' + selNode} d={d} node={selNode} update={update} onClose={() => setSel(null)} prefs={prefs} /> : <NodeEditor key={selNode} d={d} node={selNode} update={update} onClose={() => setSel(null)} prefs={prefs} />) : null;

  const tools = (
    <DrawTools opts={opts} setOpts={setOpts} lenText={lenText} setLenText={setLenText} addDir={addDir} undo={undo} canUndo={canUndo} redo={redo} canRedo={canRedo} heading={heading} addOffset={addOffset}
      cur={cur} isBranch={cur !== d.runs.length} missing={missing} compact={full} prefs={prefs} startPoint={() => setArmed(armed === 'start' ? null : 'start')} placingStart={armed === 'start'} />
  );
  const palette = <Palette conn={opts.conn} setConn={(c) => setOpts({ conn: c })} armed={armed} setArmed={setArmed} drop={(key, cx, cy) => { const h = canvasApi.current?.hitAt(cx, cy); if (!h) { toast('Drop it on a line or a point of the drawing'); return; } place(key, h.sel, h.t); }} compact={full} />;

  const stage = (
    <IsoCanvas d={d} disp={disp} opts={opts} prefs={prefs} cursor={cur} sel={sel} rot={rot} fitTick={fitTick} armed={armed} apiRef={canvasApi} onPick={startAt}
      onInlDrag={() => {}}
      onItemDrag={(run, id, t) => setItem(run, id, (q) => (q.id === id ? { ...q, t, at: undefined } : q), 'drag' + id)}
      menu={weldSel >= 0 ? { at: disp.P[welds[weldSel].node], node: <WeldPop key={'wp' + welds[weldSel].key} d={d} w={welds[weldSel]} num={weldSel + 1} update={update} onClose={() => setSel(null)} /> }
        : textSel && disp.P[textSel.node] ? { at: add(disp.P[textSel.node], mul(textSel.off, disp.k || 1)), node: <TextPop key={'tp' + textSel.id} text={textSel.text} onText={(v) => setText(textSel.id, v)} onDelete={() => { setText(textSel.id, null); setSel(null); }} onClose={() => closeText(textSel.id)} /> }
        : selNode !== null && pointKind(d, selNode) && !more ? { at: disp.P[selNode], node: <PointMenu key={'pm' + selNode} d={d} n={selNode} prefs={prefs}
          act={{
            close: () => setSel(null), more: () => setMore(true),
            joint: (c) => inlineAt(d, selNode) ? update((x) => ({ ...x, inl: { ...(x.inl ?? {}), [selNode]: { ...x.inl![selNode], conn: c } } })) : update((x) => ({ ...x, nodeConn: { ...(x.nodeConn ?? {}), [selNode]: c } })),
            change: (id) => { const pk = pointKind(d, selNode); update((x) => pk === 'inline' ? { ...x, inl: { ...(x.inl ?? {}), [selNode]: { ...x.inl![selNode], type: id } } } : pk === 'end' ? { ...x, ends: { ...x.ends, [selNode]: id } } : { ...x, fits: { ...(x.fits ?? {}), [selNode]: id } }); },
            len: (v) => inlineAt(d, selNode) ? update((x) => ({ ...x, inl: { ...(x.inl ?? {}), [selNode]: { ...x.inl![selNode], len: v } } }), 'plen' + selNode)
              : update((x) => { const e = { ...(x.endLen ?? {}) }; if (v == null) delete e[selNode]; else e[selNode] = v; return { ...x, endLen: e }; }, 'plen' + selNode),
            size: (z) => inlineAt(d, selNode) ? update((x) => ({ ...x, inl: { ...(x.inl ?? {}), [selNode]: { ...x.inl![selNode], size: z } } }))
              : update((x) => { const f = { ...(x.fitSize ?? {}) }; if (z) f[selNode] = z; else delete f[selNode]; return { ...x, fitSize: f }; }),
            move: () => { setArmed('mv:' + selNode); setSel(null); },
            del: () => { const pk = pointKind(d, selNode);
              if (pk === 'inline') { update((x) => inlineAt(x, selNode) && nodeKind(x, selNode).kind === 'straight' ? mergeAt(x, selNode) : { ...x, inl: Object.fromEntries(Object.entries(x.inl ?? {}).filter(([k]) => Number(k) !== selNode)) }); setSel(null); }
              else if (pk === 'tee') deleteTee(selNode);
              else if (pk === 'elbow') { update((x) => { const f = { ...(x.fits ?? {}) }; delete f[selNode]; return { ...x, fits: f }; }); setSel(null); }
              else { update((x) => ({ ...x, ends: { ...x.ends, [selNode]: 'open' } })); setSel(null); } },
          }} /> }
        : sel?.kind === 'dim' && d.runs[sel.run] ? { at: add(disp.P[d.runs[sel.run].from], mul(disp.vecs[sel.run], 0.5)), node: <LengthPop key={'lp' + d.runs[sel.run].id} d={d} i={sel.run} prefs={prefs} update={update} onClose={() => setSel(null)} onMore={() => setSel({ kind: 'run', id: sel.run })} /> }
        : itemSel ? { at: add(disp.P[d.runs[itemSel.run].from], mul(disp.vecs[itemSel.run], runItems(d.runs[itemSel.run]).find((q) => q.id === itemSel.id)!.t)),
        node: <ItemMenu key={itemSel.id} d={d} prefs={prefs} item={runItems(d.runs[itemSel.run]).find((q) => q.id === itemSel.id)!} onClose={() => setSel(null)}
          onLen={(v) => setItem(itemSel.run, itemSel.id, (q) => (q.id === itemSel.id ? { ...q, len: v } : q), 'len' + itemSel.id)}
          onAt={(v) => setItem(itemSel.run, itemSel.id, (q) => (q.id === itemSel.id ? { ...q, at: v } : q), 'at' + itemSel.id)}
          onMove={() => { setArmed(`move:${itemSel.run}:${itemSel.id}`); setSel(null); }}
          onChange={(type) => setItem(itemSel.run, itemSel.id, (q) => (q.id === itemSel.id ? { ...q, type } : q))}
          onConn={(c) => setItem(itemSel.run, itemSel.id, (q) => (q.id === itemSel.id ? { ...q, conn: c } : q))}
          onDelete={() => { setItem(itemSel.run, itemSel.id, (q) => (q.id === itemSel.id ? null : q)); setSel(null); }} /> } : null}
      startOn={armed === 'start'} onStartBtn={() => setArmed(armed === 'start' ? null : 'start')} onNotice={toast}
      offsetOn={offOpen} onOffsetBtn={() => { setOffOpen(!offOpen); setSel(null); }} onPlaceText={placeText} onTextMove={moveText}
      onView={(v) => setOpts({ view: v })} onTap={onTap} onDraw={drawTo}>
      <div className="isohist">
        <button className="ibtn" onClick={undo} disabled={!canUndo} aria-label="Back" title="Step back one change">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg><span>Back</span>
        </button>
        {canRedo && <button className="ibtn" onClick={redo} aria-label="Forward" title="Put back what Back removed">
          <span>Forward</span><svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>}
      </div>
      <div className="isobtns">
        {full && <button className="ibtn" onClick={() => setHide(!hide)}>{hide ? 'Show tools' : 'Hide tools'}</button>}
        {full && portrait && <button className="ibtn" onClick={() => { setLand(!land); setFitTick((t) => t + 1); }}>{land ? 'Portrait' : 'Landscape'}</button>}
        <button className="ibtn" onClick={full ? exitFull : enterFull} aria-label={full ? 'Exit full screen' : 'Full screen'}>
          {full ? '✕ Close' : <svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}
        </button>
      </div>
      {armed && <div className="isoarmed"><span className="armtxt">{armed === 'start' ? 'Tap the paper for the new start point' : armed === 'text' ? 'Tap the drawing where the note goes' : armed === 'notes' ? 'Drag a note to move · tap to edit' : armed.startsWith('mv:') ? 'Tap where it should go' : armed.startsWith('move:') ? 'Tap a line where it should go' : `Tap where the ${CONN_LABEL[opts.conn].toLowerCase()} ${catalogItem(armed.split(':')[1], armed.split(':')[0] as CatalogItem['kind'])?.label.toLowerCase()} goes`}</span><button className="linkbtn" onClick={() => { setArmed(null); if (sel?.kind === 'text') closeText(sel.id); }}>{armed === 'notes' ? 'done' : 'cancel'}</button></div>}
      {offOpen && <div className="isodock" onPointerDown={(e) => e.stopPropagation()}>
        <OffsetPanel key={heading + cur} heading={heading} prefs={prefs} from={cur} onAdd={(o) => { addOffset(o); setOffOpen(false); }} onClose={() => setOffOpen(false)} />
      </div>}
    </IsoCanvas>
  );

  if (full) {
    return (
      <div className={'isofull' + (rot ? ' rot' : '') + (wide ? ' wide' : '') + (hide ? ' hidetools' : '')}>
        {stage}
        {!hide && <div className="isoside">{editor}{palette}{tools}</div>}
      </div>
    );
  }

  const dotItem = (label: string, f: () => void, dis = false) => <button className="dotitem" disabled={dis} onClick={() => { setDots(false); f(); }}>{label}</button>;
  const head = (
    <div className="isohead">
      {d.done ? <b className="isoname ro">{d.name}</b>
        : <input className="isoname" value={d.name} aria-label="Drawing name" onChange={(e) => update((x) => ({ ...x, name: e.target.value }), 'name')} />}
      <span className="muted">{d.nps}" · {d.runs.filter((r) => !r.move).length} lines</span>
      {d.done
        ? <button className="chip" onClick={() => { update((x) => ({ ...x, done: false })); toast('Editing — tap Complete when done'); }}>✎ Edit</button>
        : <button className="chip done" onClick={() => setModal('complete')} disabled={!d.runs.some((r) => !r.move)}>✓ Complete</button>}
      <div className="isomore">
        <button className="ibtn dots" aria-label="Drawing menu" aria-expanded={dots} onClick={() => setDots(!dots)}>
          <svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="5" r="2" fill="currentColor" /><circle cx="12" cy="12" r="2" fill="currentColor" /><circle cx="12" cy="19" r="2" fill="currentColor" /></svg>
        </button>
        {dots && <>
          <div className="dotback" onClick={() => setDots(false)} />
          <div className="dotmenu" role="menu">
            {dotItem('My Drawings', () => setModal('drawings'))}
            {dotItem('New Drawing', newDrawingNow)}
            {dotItem('Name Drawing', () => setModal('name'))}
            {dotItem('Add text note', () => { setArmed('text'); setSel(null); setOffOpen(false); }, !!d.done)}
            {dotItem(armed === 'notes' ? 'Done editing notes' : 'Edit / move notes', () => { setArmed(armed === 'notes' ? null : 'notes'); setSel(null); if (!d.texts?.length) toast('No text notes yet — use Add text note'); }, !!d.done || (!d.texts?.length && armed !== 'notes'))}
          </div>
        </>}
      </div>
    </div>
  );
  const modals = <>
    {modal === 'drawings' && <IsoModal title="My Drawings" onClose={() => setModal(null)}><Library store={store} setStore={setStore} onOpen={(id) => { openDrawing(id); setModal(null); }} /></IsoModal>}
    {modal === 'name' && <NameModal title="Name drawing" name={d.name} action="Save name" onClose={() => setModal(null)} onSave={(n) => { update((x) => ({ ...x, name: n })); setModal(null); toast('Renamed'); }} />}
    {modal === 'complete' && <NameModal title="Complete drawing" name={d.name} action="Save & complete" note="The drawing is saved and shown as an 11×17 iso sheet with its material breakdown, cut list and weld log. Confirm the name:"
      onClose={() => setModal(null)} onSave={(n) => { update((x) => ({ ...x, name: n, done: true, doneAt: Date.now() })); setModal(null); setSel(null); setArmed(null); setOffOpen(false); toast('Saved — drawing complete'); }} />}
  </>;

  if (d.done) {
    return (
      <div className="tool iso">
        {head}
        <SheetView d={d} opts={opts} prefs={prefs} toast={toast} />
        {modals}
      </div>
    );
  }

  return (
    <div className="tool iso">
      {head}
      {modals}
      {stage}
      {editor}
      {palette}
      {tools}
      <Segmented value={panel} onChange={setPanel} options={[['cut', 'Cut list'], ['setup', 'Setup'], ['library', 'Library']]} />
      {panel === 'cut' && <CutPanel d={d} cuts={cuts} prefs={prefs} onShare={async (t) => { const m = await shareText(t); if (m) toast(m); }} />}
      {panel === 'setup' && <SetupPanel d={d} disp={disp} opts={opts} prefs={prefs} update={update} toast={toast} />}
      {panel === 'library' && <Library store={store} setStore={setStore} onOpen={openDrawing} />}
    </div>
  );
}

// ------------------------------------------------------------------ point menu (tap a valve, tee, elbow or end fitting)
type PKind = 'inline' | 'tee' | 'elbow' | 'end';
function pointKind(d: IsoDrawing, n: number): PKind | null {
  if (inlineAt(d, n)) return 'inline';
  const k = nodeKind(d, n).kind;
  if (k === 'tee' || k === 'cross') return 'tee';
  if (k === 'elbow') return 'elbow';
  if ((k === 'end' || k === 'start-end') && d.ends[n] && d.ends[n] !== 'open') return 'end';
  return null;
}
const SIZED = ['redtee', 'weldolet', 'sockolet', 'threadolet', 'stubin', 'lateral'];
interface PointActs { close: () => void; more: () => void; joint: (c: Conn) => void; change: (id: string) => void; len: (v: number | undefined) => void; size: (s: string | undefined) => void; move: () => void; del: () => void }
function PointMenu({ d, n, prefs, act }: { d: IsoDrawing; n: number; prefs: Prefs; act: PointActs }) {
  const [pane, setPane] = useState<'main' | 'joint' | 'change' | 'len' | 'size'>('main');
  const [armedDel, setArmedDel] = useState(false);
  const pk = pointKind(d, n)!;
  const it = inlineAt(d, n);
  const sizes = runSizes(d);
  const lineSize = sizes[n - 1] ?? d.nps;
  const cur = pk === 'inline' ? it!.type : pk === 'end' ? d.ends[n] : pk === 'elbow' ? d.fits?.[n] ?? 'lr' : d.fits?.[n] ?? 'tee';
  const kind = pk === 'inline' ? 'line' : pk === 'end' ? 'end' : pk === 'elbow' ? 'elbow' : 'branch';
  const c = catalogItem(cur, kind as CatalogItem['kind']);
  const conn = pk === 'inline' ? it!.conn ?? 'bw' : connAt(d, n);
  const hasSize = (pk === 'inline' && isReducer(it!.type)) || (pk === 'tee' && SIZED.includes(cur));
  const curSize = pk === 'inline' ? it!.size : d.fitSize?.[n];
  const hasLen = pk === 'inline' || pk === 'end';
  const std = pk === 'inline' ? itemLength({ ...d, nps: lineSize }, { ...it!, len: undefined }) : endTakeoff({ ...d, endLen: {} }, n);
  const own = pk === 'inline' ? it!.len : d.endLen?.[n];
  const [lenT, setLenT] = useState(own != null ? formatFracIn(own, prefs) : '');
  const canMove = pk !== 'elbow';
  const delLabel = pk === 'tee' ? 'Delete tee + branch' : pk === 'elbow' ? 'Reset to LR elbow' : pk === 'end' ? 'Remove (open end)' : 'Delete, join line';
  const sizeOpts = Object.keys(B169).filter((z) => z !== lineSize && (pk === 'inline' || npsVal(z) < npsVal(lineSize)));
  return (
    <div className="itemmenu-in">
      <div className="row-between"><b>{c && <PaletteIcon item={c} />}{c?.label ?? cur}<span className="muted small"> · {CONN_LABEL[conn]}{hasSize && curSize ? ` · ${lineSize}"×${curSize}"` : ''}</span></b><button className="chip" aria-label="Close" onClick={act.close}>✕</button></div>
      {pane === 'main' && (
        <>
          <div className="menubtns">
            <button className="btn" onClick={() => setPane('joint')}><JointIcon conn={conn} /> Joint</button>
            {canMove && <button className="btn" onClick={act.move}>✥ Move</button>}
            <button className="btn" onClick={() => setPane('change')}>⇄ Change</button>
            {hasLen && <button className="btn" onClick={() => setPane('len')}>↔ Length</button>}
            {hasSize && <button className="btn" onClick={() => setPane('size')}>⌀ Size</button>}
            {armedDel ? <button className="btn danger" onClick={act.del}>Sure?</button> : <button className="btn danger" onClick={() => setArmedDel(true)}>✕ Delete</button>}
          </div>
          {armedDel && <p className="fhint">Tap Sure? to {delLabel.toLowerCase()}.</p>}
          <button className="linkbtn small" onClick={act.more}>More options & notes…</button>
        </>
      )}
      {pane === 'joint' && (
        <>
          <div className="chiprow">{CONN_ORDER.map((k) => <button key={k} className={'chip conn' + (k === conn ? ' on' : '')} onClick={() => { act.joint(k); setPane('main'); }}><JointIcon conn={k} />{CONN_LABEL[k]}</button>)}</div>
          <button className="chip" onClick={() => setPane('main')}>‹ Back</button>
        </>
      )}
      {pane === 'change' && (
        <>
          <div className="menugrid">
            {CATALOG.filter((x) => x.kind === kind && !(kind === 'end' && x.id === 'reducer')).map((x) => (
              <button key={x.id} className={'palitem' + (x.id === cur ? ' on' : '')} onClick={() => { act.change(x.id); setPane('main'); }}><PaletteIcon item={x} /><span>{x.label}</span></button>
            ))}
          </div>
          <button className="chip" onClick={() => setPane('main')}>‹ Back</button>
        </>
      )}
      {pane === 'len' && (
        <div className="menufields">
          <Field label={pk === 'inline' ? `Length (${conn === 'flg' ? 'face to face' : 'end to end'})` : 'End take-off'} value={lenT} parse={parseLength}
            placeholder={std && std.len != null ? formatFracIn(std.len, prefs) : 'enter length'}
            onChange={(v) => { setLenT(v); const r = tryParse(parseLength, v); if (!v.trim()) act.len(undefined); else if (r && r.ok && r.v >= 0) act.len(r.v); }} />
          <p className="fhint">{own != null ? 'Your length — clear it to use the standard one.' : std && std.len != null ? std.src : 'No standard length — enter your manufacturer’s.'}</p>
          <button className="chip" onClick={() => setPane('main')}>‹ Back</button>
        </div>
      )}
      {pane === 'size' && (
        <div className="menufields">
          <Select label={`${pk === 'inline' ? 'Reduces' : 'Branch'} to (line is ${lineSize}")`} value={curSize ?? ''} options={[['', 'Not set'], ...sizeOpts.map((z) => [z, `${lineSize}" × ${z}"`] as [string, string])]} onChange={(v) => act.size(v || undefined)} />
          <p className="fhint">The {pk === 'inline' ? 'lines after the reducer' : 'branch'} change to this size — their fittings and take-offs follow.</p>
          <button className="chip" onClick={() => setPane('main')}>‹ Back</button>
        </div>
      )}
    </div>
  );
}

/** Tap a measurement on the drawing: type the new length right there. */
function LengthPop({ d, i, prefs, update, onClose, onMore }: { d: IsoDrawing; i: number; prefs: Prefs; update: (f: (d: IsoDrawing) => IsoDrawing, mergeKey?: string) => void; onClose: () => void; onMore: () => void }) {
  const r = d.runs[i];
  const sv = sketchVec(r);
  const axes = [0, 1, 2].filter((k) => nz(sv[k]));
  const adj = faceAdj(d, i);
  const ref = runRef(d, i);
  const [txt, setTxt] = useState(isMeasured(r) ? formatFtIn(shownLength(d, i), prefs) : '');
  const [err, setErr] = useState<string | null>(null);
  const set = (v: string) => {
    setTxt(v); setErr(null);
    const p = tryParse(parseLength, v);
    if (!p) return;
    if (!p.ok || !(p.v > 0)) { setErr(p.ok ? 'Enter a length' : p.err); return; }
    const base = isMeasured(r) ? runVec(r) : sv; const L = len3(base) || 1;
    const m = mul(base, (p.v + adj) / L);
    update((x) => ({ ...x, runs: x.runs.map((q, k) => (k === i ? { ...q, meas: m, sketch: true } : q)) }), 'dimpop' + r.id);
  };
  return (
    <div className="itemmenu-in">
      <div className="row-between"><b>Line {i + 1} · {describeRun(r)}</b><button className="chip" aria-label="Close" onClick={onClose}>✕</button></div>
      <Field label={`${axes.length > 1 ? 'Travel' : 'Length'} (${ref})`} value={txt} onChange={set} parse={parseLength} placeholder="e.g. 4' 6" />
      {err && <p className="fhint">{err}</p>}
      <div className="menubtns two"><button className="btn primary" onClick={onClose}>Done</button><button className="btn" onClick={onMore}>More…</button></div>
    </div>
  );
}

// ------------------------------------------------------------------ fitting menu (tap a fitting on a line)
function ItemMenu({ item, d, prefs, onClose, onMove, onChange, onConn, onDelete, onLen, onAt }: {
  item: ReturnType<typeof runItems>[number]; d: IsoDrawing; prefs: Prefs; onClose: () => void; onMove: () => void; onChange: (type: string) => void; onConn: (c: Conn) => void; onDelete: () => void;
  onLen: (v: number | undefined) => void; onAt: (v: number | undefined) => void;
}) {
  const std = itemLength(d, { ...item, len: undefined });
  const [lenT, setLenT] = useState(item.len != null ? formatFracIn(item.len, prefs) : '');
  const [atT, setAtT] = useState(item.at != null ? formatFtIn(item.at, prefs) : '');
  const setL = (v: string) => { setLenT(v); const r = tryParse(parseLength, v); if (!v.trim()) onLen(undefined); else if (r && r.ok && r.v >= 0) onLen(r.v); };
  const setA = (v: string) => { setAtT(v); const r = tryParse(parseLength, v); if (!v.trim()) onAt(undefined); else if (r && r.ok && r.v >= 0) onAt(r.v); };
  const [pane, setPane] = useState<'main' | 'change' | 'joint' | 'len'>('main');
  const [armedDel, setArmedDel] = useState(false);
  const c = catalogItem(item.type, 'line');
  const conn = item.conn ?? 'bw';
  return (
    <div className="itemmenu-in">
      <div className="row-between"><b>{c && <PaletteIcon item={c} />}{c?.label ?? item.type}<span className="muted small"> · {CONN_LABEL[conn]}</span></b><button className="chip" aria-label="Close" onClick={onClose}>✕</button></div>
      {pane === 'main' && (
        <div className="menubtns">
          <button className="btn" onClick={onMove}>✥ Move</button>
          <button className="btn" onClick={() => setPane('change')}>⇄ Change</button>
          <button className="btn" onClick={() => setPane('joint')}><JointIcon conn={conn} /> Joint</button>
          <button className="btn" onClick={() => setPane('len')}>↔ Length</button>
          {armedDel ? <button className="btn danger" onClick={onDelete}>Delete for good</button> : <button className="btn danger" onClick={() => setArmedDel(true)}>✕ Delete</button>}
        </div>
      )}
      {pane === 'main' && <p className="fhint">{item.len != null ? `Length ${formatFracIn(item.len, prefs)} (yours)` : std.len != null ? `Length ${formatFracIn(std.len, prefs)} (standard)` : 'Length not set — tap Length'} · drag it along the line to slide it.</p>}
      {pane === 'len' && (
        <div className="menufields">
          <Field label="Length (face to face)" value={lenT} onChange={setL} parse={parseLength} placeholder={std.len != null ? formatFracIn(std.len, prefs) : 'enter length'} />
          <p className="fhint">{item.len != null ? 'Your length — clear it to use the standard one.' : std.len != null ? std.src : 'No standard length for this one — enter your manufacturer’s.'}</p>
          <Field label="Center from line start (optional)" value={atT} onChange={setA} parse={parseLength} placeholder="as drawn" />
          <button className="chip" onClick={() => setPane('main')}>‹ Back</button>
        </div>
      )}
      {pane === 'change' && (
        <>
          <div className="menugrid">
            {CATALOG.filter((x) => x.kind === 'line').map((x) => (
              <button key={x.id} className={'palitem' + (x.id === item.type ? ' on' : '')} onClick={() => { onChange(x.id); setPane('main'); }}><PaletteIcon item={x} /><span>{x.label}</span></button>
            ))}
          </div>
          <button className="chip" onClick={() => setPane('main')}>‹ Back</button>
        </>
      )}
      {pane === 'joint' && (
        <>
          <div className="chiprow">
            {CONN_ORDER.map((k) => <button key={k} className={'chip conn' + (k === conn ? ' on' : '')} onClick={() => { onConn(k); setPane('main'); }}><JointIcon conn={k} />{CONN_LABEL[k]}</button>)}
          </div>
          <button className="chip" onClick={() => setPane('main')}>‹ Back</button>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ fittings palette
function Palette({ conn, setConn, armed, setArmed, drop, compact }: { conn: Conn; setConn: (c: Conn) => void; armed: string | null; setArmed: (k: string | null) => void; drop: (key: string, cx: number, cy: number) => void; compact: boolean }) {
  const [group, setGroup] = usePersistent<string>('isopalette', 'Valves');
  const [open, setOpen] = usePersistent<boolean>('isopaletteopen', true);
  const [drag, setDrag] = useState<{ key: string; x: number; y: number; on: boolean } | null>(null);
  const start = useRef<{ key: string; x: number; y: number } | null>(null);
  const items = CATALOG.filter((c) => c.group === group);
  return (
    <Card className={'palette' + (compact ? ' compact' : '')}>
      <button className="palhead" onClick={() => setOpen(!open)} aria-expanded={open}><b>Fittings &amp; valves</b><span className="muted small">{open ? 'drag onto the drawing, or tap one then tap the spot  ▴' : 'show  ▾'}</span></button>
      {open && <>
      <div className="connrow" role="radiogroup" aria-label="Connection">
        <span className="flabel">Connect with</span>
        <div className="chiprow">
          {CONN_ORDER.map((c) => (
            <button key={c} role="radio" aria-checked={conn === c} className={'chip conn' + (conn === c ? ' on' : '')} onClick={() => setConn(c)}><JointIcon conn={c} />{CONN_LABEL[c]}</button>
          ))}
        </div>
      </div>
      <div className="chiprow">
        {CATALOG_GROUPS.map((g) => <button key={g} className={'chip' + (g === group ? ' on' : '')} onClick={() => setGroup(g)}>{g}</button>)}
      </div>
      <div className="palgrid">
        {items.map((c) => {
          const key = c.kind + ':' + c.id;
          return (
            <button key={key} className={'palitem' + (armed === key ? ' on' : '')} title={c.label}
              onPointerDown={(e) => { e.preventDefault(); start.current = { key, x: e.clientX, y: e.clientY }; try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ } }}
              onPointerMove={(e) => {
                const s0 = start.current; if (!s0) return;
                if (drag?.on || Math.hypot(e.clientX - s0.x, e.clientY - s0.y) > 8) setDrag({ key, x: e.clientX, y: e.clientY, on: true });
              }}
              onPointerUp={(e) => {
                const s0 = start.current; start.current = null;
                if (drag?.on) { setDrag(null); drop(key, e.clientX, e.clientY); return; }
                if (s0) setArmed(armed === key ? null : key);
              }}
              onPointerCancel={() => { start.current = null; setDrag(null); }}>
              <PaletteIcon item={c} />
              <span>{c.label}</span>
            </button>
          );
        })}
      </div>
      </>}
      {drag?.on && createPortal(
        <div className="palghost" style={{ left: drag.x, top: drag.y }}><PaletteIcon item={catalogItem(drag.key.split(':')[1], drag.key.split(':')[0] as CatalogItem['kind'])!} /></div>,
        document.body)}
    </Card>
  );
}

// ------------------------------------------------------------------ tools
interface OffsetSpec { heading: string; toward: string; offset: number | null; roll: string | null; rollAmt: number | null; angle: number }
const OPP: Record<string, string> = { N: 'S', S: 'N', E: 'W', W: 'E', U: 'D', D: 'U' };
const AXIS_OF: Record<string, number> = { E: 0, W: 0, N: 1, S: 1, U: 2, D: 2 };
const ALL_DIRS = ['N', 'S', 'E', 'W', 'U', 'D'];

function OffsetPanel({ heading, prefs, onAdd, onClose, from }: { heading: string; prefs: Prefs; onAdd: (o: OffsetSpec) => void; onClose: () => void; from?: number }) {
  const [h, setH] = useState(heading);
  const perp = ALL_DIRS.filter((k) => AXIS_OF[k] !== AXIS_OF[h]);
  const [to, setTo] = useState(perp.includes('U') ? 'U' : perp[0]);
  const [off, setOff] = useState('');
  const [roll, setRoll] = useState('none');
  const [rollAmt, setRollAmt] = useState('');
  const [ang, setAng] = useState('45');
  const toward = perp.includes(to) ? to : perp[0];
  const rollDirs = ALL_DIRS.filter((k) => AXIS_OF[k] !== AXIS_OF[h] && AXIS_OF[k] !== AXIS_OF[toward]);
  const rollDir = roll !== 'none' && rollDirs.includes(roll) ? roll : null;
  const O = tryParse(parseLength, off), R = tryParse(parseLength, rollAmt), A = tryParse(parseAngle, ang);
  const angle = A && A.ok ? A.v : NaN;
  const bad = !(angle > 0 && angle < 90) ? 'Fitting angle must be between 0° and 90°' : (O && !O.ok) ? O.err : (R && !R.ok) ? R.err : null;
  const o = O && O.ok ? O.v : null, r = R && R.ok ? R.v : null;
  const known = o !== null && (!rollDir || r !== null);
  const tot = known ? Math.hypot(o!, rollDir ? r! : 0) : NaN;
  const set = tot / Math.tan((angle * Math.PI) / 180), trav = tot / Math.sin((angle * Math.PI) / 180);
  const label = (k: string) => DIRS[k].label;
  return (
    <div className="offpanel">
      <div className="row-between"><b>Add offset from point {from ?? ''}</b><button className="chip" onClick={onClose}>Close</button></div>
      <Grid>
        <Select label="Heading (run)" value={h} options={ALL_DIRS.map((k) => [k, label(k)])} onChange={(v) => { setH(v); setRoll('none'); }} />
        <Field label="Fitting angle (°)" value={ang} onChange={setAng} placeholder="45" />
        <Select label="Offset toward" value={toward} options={perp.map((k) => [k, label(k)])} onChange={(v) => { setTo(v); setRoll('none'); }} />
        <Field label="Offset (optional)" value={off} onChange={setOff} parse={parseLength} placeholder="sketch only" />
        <Select label="Roll toward" value={rollDir ?? 'none'} options={[['none', 'No roll'], ...rollDirs.map((k) => [k, label(k)] as [string, string])]} onChange={setRoll} />
        {rollDir && <Field label="Roll (optional)" value={rollAmt} onChange={setRollAmt} parse={parseLength} placeholder="sketch only" />}
      </Grid>
      <div className="chiprow">{['11.25', '22.5', '30', '45', '60'].map((a) => <button key={a} className={'chip' + (ang === a ? ' on' : '')} onClick={() => setAng(a)}>{a}°</button>)}</div>
      {bad ? <Msg kind="warn">{bad}</Msg> : known
        ? <p className="fhint">{rollDir ? `True offset ${formatFracIn(tot, prefs)} · ` : ''}Travel {formatFtIn(trav, prefs)} · Run (setback) {formatFtIn(set, prefs)}</p>
        : <p className="fhint">Leave the amounts empty to sketch it now and dimension it later.</p>}
      <button className="btn primary" disabled={!!bad} onClick={() => onAdd({ heading: h, toward, offset: o, roll: rollDir, rollAmt: rollDir ? r : null, angle })}>Add {rollDir ? 'rolling offset' : 'offset'}</button>
    </div>
  );
}

function DrawTools({ opts, setOpts, lenText, setLenText, addDir, undo, canUndo, redo, canRedo, heading, addOffset, prefs, cur, isBranch, missing, compact, startPoint, placingStart }: {
  opts: Opts; setOpts: (p: Partial<Opts>) => void; lenText: string; setLenText: (s: string) => void; addDir: (k: string) => void;
  undo: () => void; canUndo: boolean; redo: () => void; canRedo: boolean; heading: string; addOffset: (o: OffsetSpec) => void; prefs: Prefs;
  cur: number; isBranch: boolean; missing: number; compact: boolean; startPoint: () => void; placingStart: boolean;
}) {
  const presetOn = VIEW_PRESETS.find((p) => Math.abs(normAz(p.v.az - opts.view.az)) < 0.5 && Math.abs(p.v.el - opts.view.el) < 0.5)?.id ?? '';
  return (
    <Card className={'isotools' + (compact ? ' compact' : '')}>
      <Segmented small value={opts.mode} onChange={(m) => setOpts({ mode: m as Mode })} options={[['draw', '✎ Draw'], ['orbit', '⟳ Rotate 3D'], ['pan', '✥ Move']]} />
      {opts.mode === 'draw' && (
        <>
          <p className="fhint">Drag from a point to draw a line — it follows the 30° / 150° / vertical paper lines. Start on any point except a turn (or the middle of a line) to branch off it; from empty space it continues from point {cur}{isBranch ? ', making a tee' : ''}. Use the offset tab on the drawing for angled runs. Tap a line or point to edit it. Two fingers: pinch to zoom, slide to move. Spin arrows (or the compass) turn the drawing.</p>
        </>
      )}
      {opts.mode === 'orbit' && <p className="fhint">Drag the drawing to tilt and turn it in 3D. The spin arrows under the compass turn it to the next compass direction.</p>}
      {opts.mode === 'pan' && <p className="fhint">Drag to move, pinch or scroll to zoom. Tap lines and points to edit them.</p>}
      <div className="isorow">
        <span className="flabel">View</span>
        <div className="chiprow">
          {VIEW_PRESETS.map((p) => <button key={p.id} className={'chip' + (presetOn === p.id ? ' on' : '')} onClick={() => setOpts({ view: { ...p.v } })}>{p.label}</button>)}
          <button className="chip" onClick={() => setOpts({ view: { ...opts.view, az: normAz(opts.view.az + 90) } })} title="Turn North 90°">N ⟳ 90°</button>
        </div>
      </div>
      <div className="dirbar">
        <Field label="Length (optional)" value={lenText} onChange={setLenText} parse={parseLength} placeholder="e.g. 5' 6" />
        <div className="dirpad">
          {DIR_ORDER.map((k) => <button key={k} className="btn dir" aria-label={DIRS[k].label} onClick={() => addDir(k)}>{DIR_SHORT[k]}</button>)}
        </div>
      </div>
      <div className="isotoggles">
        {(['dims', 'welds', 'labels', 'scaled', 'weldmap'] as const).map((k) => (
          <label key={k} className={'chip' + (k === 'weldmap' && opts.weldmap ? ' on' : '')}><input type="checkbox" checked={!!opts[k]} onChange={(e) => setOpts({ [k]: e.target.checked })} /> {({ dims: 'Dimensions', welds: 'Joints', labels: 'Point #', scaled: 'To scale', weldmap: 'Weld map' })[k]}</label>
        ))}
        <button className="chip" onClick={undo} disabled={!canUndo}>‹ Back</button>
        {canRedo && <button className="chip" onClick={redo}>Forward ›</button>}
      </div>
      {opts.weldmap && <p className="fhint">Weld map: every weld is numbered (W1, W2 … field welds FW). Tap a weld number for the welder stencil, shop / field and notes.</p>}
      {opts.scaled && missing > 0 && <p className="fhint">{missing} line{missing > 1 ? 's' : ''} without a dimension {missing > 1 ? 'are' : 'is'} drawn at the drawing's average scale.</p>}
    </Card>
  );
}

// ------------------------------------------------------------------ canvas
type Cam = { s: number; tx: number; ty: number };
export interface CanvasApi { hitAt: (clientX: number, clientY: number) => { sel: Sel; t: number } | null }
function IsoCanvas({ d, disp, opts, prefs, cursor, sel, rot, fitTick, armed, apiRef, onPick, onItemDrag, onInlDrag, menu, startOn, onStartBtn, onNotice, onView, onTap, onDraw, offsetOn, onOffsetBtn, onPlaceText, onTextMove, children }: {
  d: IsoDrawing; disp: { P: Vec3[]; k: number; vecs: Vec3[] }; opts: Opts; prefs: Prefs; cursor: number; sel: Sel; rot: boolean; fitTick: number;
  armed: string | null; apiRef: React.MutableRefObject<CanvasApi | null>; onPick: (v: Vec3 | null) => void;
  onItemDrag: (run: number, id: string, t: number) => void; onInlDrag: (node: number, t: number) => void; menu: { at: Vec3; node: React.ReactNode } | null;
  startOn: boolean; onStartBtn: () => void; onNotice: (m: string) => void;
  offsetOn: boolean; onOffsetBtn: () => void; onPlaceText: (node: number, off: Vec3) => void; onTextMove: (id: string, node: number, off: Vec3) => void;
  onView: (v: View) => void; onTap: (s: Sel, t?: number) => void; onDraw: (v: Vec3 | null, from: number, split?: { run: number; t: number }) => void; children?: React.ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 360, h: 300 });
  const { w: W, h: H } = size;
  const view = opts.view;
  const P = disp.P;
  const [cam, setCam] = useState<Cam>({ s: 2, tx: 180, ty: 150 });
  const camRef = useRef(cam); camRef.current = cam;
  const [ghost, setGhost] = useState<{ from: number; v: Vec3; origin?: Vec3 } | null>(null);
  const homing = useRef(false);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(100, el.clientWidth), h: Math.max(100, el.clientHeight) }));
    ro.observe(el);
    // iOS Safari: stop its own pinch-to-zoom of the page while fingers are on the drawing
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener('gesturestart', stop); el.addEventListener('gesturechange', stop);
    return () => { ro.disconnect(); el.removeEventListener('gesturestart', stop); el.removeEventListener('gesturechange', stop); };
  }, []);

  const fitCam = (): Cam => {
    const pts = P.map((p) => project(p, view));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const minSpan = GRID * 8 * (disp.k || 1);
    if (x1 - x0 < minSpan) { const c = (x0 + x1) / 2; x0 = c - minSpan / 2; x1 = c + minSpan / 2; }
    if (y1 - y0 < minSpan) { const c = (y0 + y1) / 2; y0 = c - minSpan / 2; y1 = c + minSpan / 2; }
    const s = Math.min((W - 70) / (x1 - x0), (H - 90) / (y1 - y0));
    return { s, tx: W / 2 - ((x0 + x1) / 2) * s, ty: H / 2 + 8 - ((y0 + y1) / 2) * s };
  };
  // fit on open, on resize, on scale change; when the drawing grows, only if a point leaves the screen
  useEffect(() => { setCam(fitCam()); }, [d.id, W, H, opts.scaled, fitTick]);
  useEffect(() => {
    const c = camRef.current;
    const out = P.some((p) => { const q = project(p, view); const x = q[0] * c.s + c.tx, y = q[1] * c.s + c.ty; return x < 30 || x > W - 30 || y < 50 || y > H - 50; });
    if (out) setCam(fitCam());
  }, [P.length, JSON.stringify(P[P.length - 1])]);
  // keep the drawing centred on screen when the view turns (presets, compass, orbit); Home refits
  const prevView = useRef(view);
  useEffect(() => {
    const pv = prevView.current; prevView.current = view;
    if (homing.current) { homing.current = false; setCam(fitCam()); return; }
    if (gestureTurn.current) { gestureTurn.current = false; return; }
    if (pv.az === view.az && pv.el === view.el) return;
    // a whole step (compass, presets) refits the drawing; small orbit drags keep it centred where it is
    if (Math.abs(normAz(pv.az - view.az)) > 60 || Math.abs(pv.el - view.el) > 20) { setCam(fitCam()); return; }
    const C = P.reduce((a, p) => add(a, p), [0, 0, 0] as Vec3).map((v) => v / P.length) as Vec3;
    const a = project(C, pv), b = project(C, view);
    setCam((c) => ({ ...c, tx: c.tx + (a[0] - b[0]) * c.s, ty: c.ty + (a[1] - b[1]) * c.s }));
  }, [view.az, view.el]);
  const goHome = () => {
    if (Math.abs(view.az - ISO_VIEW.az) < 1e-6 && Math.abs(view.el - ISO_VIEW.el) < 1e-6) { setCam(fitCam()); return; }
    homing.current = true; onView({ ...ISO_VIEW });
  };

  const T3 = (p: Vec3): [number, number] => { const q = project(p, view); return [q[0] * cam.s + cam.tx, q[1] * cam.s + cam.ty]; };
  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    if (rot) return { x: ((e.clientY - r.top) / r.height) * W, y: ((r.right - e.clientX) / r.width) * H };
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const g = GRID * (disp.k || 1);
  /** Drag snapping: the line follows whichever paper direction (E–W, N–S or vertical) is closest to the drag, in whole grid squares. */
  const snap = (pt: { x: number; y: number }, from: number, origin?: Vec3): Vec3 | null | 'edge' => {
    const o = origin ?? P[from] ?? [0, 0, 0];
    const p0 = T3(o);
    const dx = pt.x - p0[0], dy = pt.y - p0[1];
    let best: { ax: Vec3; t: number; perp: number } | null = null;
    for (const ax of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]) {
      const q = T3(add(o, mul(ax, g)));
      const ex = q[0] - p0[0], ey = q[1] - p0[1], L2 = ex * ex + ey * ey;
      if (L2 < 4) continue; // seen end-on in this view
      const t = (dx * ex + dy * ey) / L2, perp = Math.abs(dx * ey - dy * ex) / Math.sqrt(L2);
      if (!best || perp < best.perp) best = { ax, t, perp };
    }
    if (!best) return null;
    const n = Math.round(best.t);
    return n ? mul(best.ax, n * g) : null;
  };
  /** Where on the paper a tap lands: on the axis plane through the current point that faces the viewer most, snapped to the grid. */
  const pickPoint = (pt: { x: number; y: number }): Vec3 | null => {
    const o = P[cursor] ?? [0, 0, 0];
    const { C } = viewBasis(view);
    const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const n = axes.reduce((b, a) => (Math.abs(dot3(a, C)) > Math.abs(dot3(b, C)) ? a : b), axes[2]);
    const q = unproject((pt.x - cam.tx) / cam.s, (pt.y - cam.ty) / cam.s, view, o, n);
    if (!q) return null;
    const v = [0, 1, 2].map((k) => Math.round((q[k] - o[k]) / g) * g) as Vec3;
    return len3(v) > 0 ? v : null;
  };
  /** A point on the paper (no grid snap) on the axis plane through o that faces the viewer most. */
  const pickAbs = (pt: { x: number; y: number }, o: Vec3): Vec3 | null => {
    const { C } = viewBasis(view);
    const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const n = axes.reduce((b, a) => (Math.abs(dot3(a, C)) > Math.abs(dot3(b, C)) ? a : b), axes[2]);
    return unproject((pt.x - cam.tx) / cam.s, (pt.y - cam.ty) / cam.s, view, o, n);
  };
  const kk = disp.k || 1;
  const textAt = (pt: { x: number; y: number }): { node: number; off: Vec3 } | null => {
    // anchor a note to the nearest point on screen, so it follows the drawing
    let node = 0, nd = Infinity;
    P.forEach((p, n) => { if (n > d.runs.length) return; const q = T3(p); const dd = Math.hypot(pt.x - q[0], pt.y - q[1]); if (dd < nd) { nd = dd; node = n; } });
    const q = pickAbs(pt, P[node]); if (!q) return null;
    return { node, off: mul([q[0] - P[node][0], q[1] - P[node][1], q[2] - P[node][2]], 1 / kk) };
  };
  const runT = (i: number, loc: { x: number; y: number }) => {
    const r = d.runs[i]; const a = T3(P[r.from]), b = T3(P[i + 1]);
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
    return Math.max(0.12, Math.min(0.88, ((loc.x - a[0]) * dx + (loc.y - a[1]) * dy) / L2));
  };
  const targetOf = (el: Element | null): Sel | 'compass' | 'none' => {
    const t = el?.closest('[data-weld],[data-text],[data-item],[data-dim],[data-node],[data-run],[data-compass]');
    if (!t) return 'none';
    if (t.hasAttribute('data-compass')) return 'compass';
    if (t.hasAttribute('data-weld')) return { kind: 'weld', key: t.getAttribute('data-weld')! };
    if (t.hasAttribute('data-text')) return { kind: 'text', id: t.getAttribute('data-text')! };
    if (t.hasAttribute('data-dim')) return { kind: 'dim', run: Number(t.getAttribute('data-dim')) };
    if (t.hasAttribute('data-item')) return { kind: 'item', run: Number(t.getAttribute('data-run')), id: t.getAttribute('data-item')! };
    return t.hasAttribute('data-node') ? { kind: 'node', id: Number(t.getAttribute('data-node')) } : { kind: 'run', id: Number(t.getAttribute('data-run')) };
  };
  // lets the palette drop a fitting onto the drawing
  apiRef.current = {
    hitAt: (cx, cy) => {
      const el = document.elementFromPoint(cx, cy);
      if (!el || !svg.current?.contains(el)) return null;
      const t = targetOf(el);
      if (t === 'none' || t === 'compass' || !t) return null;
      const runIdx = t.kind === 'run' ? t.id : t.kind === 'item' || t.kind === 'dim' ? t.run : -1;
      return { sel: t, t: runIdx >= 0 ? runT(runIdx, toLocal({ clientX: cx, clientY: cy })) : 0.5 };
    },
  };

  // pointer handling. Draw mode: drag from a point (or anywhere, from the current point) to draw a line.
  // Rotate mode: drag turns the view. Move mode: drag pans. Two fingers always pan / zoom. Taps select.
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const st = useRef<{ cam: Cam; view: View; mid: { x: number; y: number }; dist: number; moved: boolean; target: Sel | 'compass' | 'none'; cAng: number; drawFrom: number | null; ang?: number; twist?: boolean; itemDrag?: boolean; split?: { run: number; t: number; origin: Vec3 }; blocked?: boolean; inlDrag?: number | null; textDrag?: { id: string; node: number; dx: number; dy: number } | null } | null>(null);
  const gestureTurn = useRef(false); // a two-finger twist moves the camera itself; skip the re-centring below
  const CMP = { x: 40, y: 40 };
  const onDown = (e: React.PointerEvent) => {
    try { svg.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const loc = toLocal(e);
    ptrs.current.set(e.pointerId, loc);
    const ps = [...ptrs.current.values()];
    const target = ps.length > 1 ? 'none' : targetOf(e.target as Element);
    let drawFrom: number | null = null;
    const itemDrag = false; // fittings don't slide — move them from their menu
    const inlDrag: number | null = null;
    let split: { run: number; t: number; origin: Vec3 } | undefined;
    let blocked = false;
    if (ps.length === 1 && opts.mode === 'draw' && !armed && target !== 'compass' && !itemDrag) {
      // the nearest point within a fingertip of the touch wins (turns, tees, ends), so a slightly-off touch still starts there
      let near = -1, nd = 30;
      P.forEach((p, n) => { if (n > d.runs.length) return; const q = T3(p); const dd = Math.hypot(loc.x - q[0], loc.y - q[1]); if (dd < nd) { nd = dd; near = n; } });
      if (target !== 'none' && target.kind === 'node') drawFrom = target.id;
      else if (near >= 0) drawFrom = near;
      else if (target !== 'none' && target.kind === 'run' && !d.runs[target.id].move) {
        // touched the middle of a line: branch off it right there
        const r = d.runs[target.id];
        const tt = snapSplitT(r, runT(target.id, loc));
        split = { run: target.id, t: tt, origin: add(P[r.from], mul(disp.vecs[target.id], tt)) };
        drawFrom = r.from;
      } else drawFrom = cursor;
      const inlF = drawFrom !== null ? inlineAt(d, drawFrom) : null;
      const endRed = !!inlF && isReducer(inlF.type) && nodeKind(d, drawFrom!).kind !== 'straight';
      if (drawFrom !== null && !split && (nodeKind(d, drawFrom).kind === 'elbow' || (inlF && !endRed))) { drawFrom = null; blocked = true; } // no lines off a turn or a valve (a reducer on an end is fine)
    }
    let textDrag: { id: string; node: number; dx: number; dy: number } | null = null;
    if (ps.length === 1 && armed === 'notes' && target !== 'none' && target !== 'compass' && target?.kind === 'text') {
      const tn = d.texts?.find((q) => q.id === target.id);
      if (tn && P[tn.node]) { const q = T3(add(P[tn.node], mul(tn.off, kk))); textDrag = { id: tn.id, node: tn.node, dx: q[0] - loc.x, dy: q[1] - loc.y }; }
    }
    const mid = ps.length === 2 ? { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 } : loc;
    st.current = { textDrag, cam, view, mid, dist: ps.length === 2 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0, moved: ps.length > 1, target, cAng: Math.atan2(loc.y - CMP.y, loc.x - CMP.x), drawFrom: inlDrag !== null ? null : drawFrom, itemDrag, split, blocked: inlDrag !== null ? false : blocked, inlDrag,
      ang: ps.length === 2 ? Math.atan2(ps[1].y - ps[0].y, ps[1].x - ps[0].x) : undefined, twist: false };
    setGhost(null);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId)) return;
    const loc = toLocal(e);
    ptrs.current.set(e.pointerId, loc);
    const s = st.current; if (!s) return;
    const ps = [...ptrs.current.values()];
    if (ps.length === 2 && s.dist > 0) {
      // two fingers: pinch = zoom, move = pan
      const dist = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      const mid = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
      const ns = Math.max(0.02, Math.min(400, s.cam.s * (dist / s.dist))), kk = ns / s.cam.s;
      // (two fingers only zoom and move — turning is done with the compass / spin arrows)
      setCam({ s: ns, tx: mid.x - (s.mid.x - s.cam.tx) * kk, ty: mid.y - (s.mid.y - s.cam.ty) * kk });
      s.moved = true; return;
    }
    if (ps.length !== 1) return;
    const dx = loc.x - s.mid.x, dy = loc.y - s.mid.y;
    if (!s.moved && Math.hypot(dx, dy) > 6) s.moved = true;
    if (!s.moved) return;
    if (s.target === 'compass') {
      // the compass swings North in 90° steps (the four ISO orientations)
      const a = Math.atan2(loc.y - CMP.y, loc.x - CMP.x);
      const raw = s.view.az + ((a - s.cAng) * 180) / Math.PI;
      const az = normAz(ISO_VIEW.az + 90 * Math.round((raw - ISO_VIEW.az) / 90));
      if (Math.abs(normAz(az - view.az)) > 1e-6) onView({ az, el: s.view.el });
    } else if (s.textDrag) {
      // move a text note (re-anchored to the nearest point)
      const at = textAt({ x: loc.x + s.textDrag.dx, y: loc.y + s.textDrag.dy });
      if (at) onTextMove(s.textDrag.id, at.node, at.off);
    } else if (s.inlDrag != null) {
      // slide a valve along its line: the two lines either side trade length, the total stays put
      const sd = sidesOf(d, s.inlDrag);
      if (sd) {
        const A = d.runs[sd[0]]; const a0 = T3(P[A.from]), b0 = T3(P[sd[1] + 1]);
        const dx2 = b0[0] - a0[0], dy2 = b0[1] - a0[1], L2 = dx2 * dx2 + dy2 * dy2 || 1;
        onInlDrag(s.inlDrag, Math.max(0.05, Math.min(0.95, ((loc.x - a0[0]) * dx2 + (loc.y - a0[1]) * dy2) / L2)));
      }
    } else if (s.itemDrag && s.target !== 'none' && s.target !== 'compass' && s.target?.kind === 'item') {
      onItemDrag(s.target.run, s.target.id, runT(s.target.run, loc)); // slide the fitting along its line
    } else if (s.drawFrom !== null) {
      const v = snap(loc, s.drawFrom, s.split?.origin);
      setGhost(v && v !== 'edge' ? { from: s.drawFrom, v, origin: s.split?.origin } : null);
    } else if (s.blocked) {
      // started on a turn: nothing to draw
    } else if (opts.mode === 'orbit') {
      onView({ az: normAz(s.view.az - dx * 0.45), el: clampEl(s.view.el + dy * 0.45) });
    } else {
      setCam({ ...s.cam, tx: s.cam.tx + dx, ty: s.cam.ty + dy });
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const s = st.current;
    const loc = toLocal(e);
    const cancelled = e.type === 'pointercancel';
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size > 0) { const ps = [...ptrs.current.values()]; st.current = { ...(s ?? { view, cAng: 0, target: 'none' as const }), cam: camRef.current, mid: ps[0], dist: 0, moved: true, drawFrom: null }; setGhost(null); return; }
    st.current = null;
    setGhost(null);
    if (!s || cancelled) return;
    if (s.moved) {
      if (s.blocked && s.dist === 0) { onNotice("Lines can't start from a turn (elbow or offset). Start from a line end, a tee or the middle of a straight line."); return; }
      if (s.drawFrom !== null && s.target !== 'compass' && s.dist === 0) {
        const v = snap(loc, s.drawFrom, s.split?.origin);
        if (v === 'edge') onDraw(null, s.drawFrom); else if (v) onDraw(v, s.drawFrom, s.split ? { run: s.split.run, t: s.split.t } : undefined);
      }
      return;
    }
    if (s.target === 'compass') { onView({ az: stepAz(view.az, 1), el: view.el }); return; }
    if (armed === 'start' && (s.target === 'none' || s.target.kind !== 'node')) { onPick(pickPoint(loc)); return; }
    if (armed === 'text') { const at = textAt(loc); if (at) onPlaceText(at.node, at.off); else onNotice('Turn the view a little to place the note'); return; }
    if (s.target !== 'none' && s.target) { onTap(s.target, s.target.kind === 'run' ? runT(s.target.id, loc) : s.target.kind === 'item' || s.target.kind === 'dim' ? runT(s.target.run, loc) : undefined); return; }
    onTap(null);
  };
  const onWheel = (e: React.WheelEvent) => {
    const p = toLocal(e); const k = Math.exp(-e.deltaY * 0.0015);
    const ns = Math.max(0.02, Math.min(400, cam.s * k)), kk = ns / cam.s;
    setCam({ s: ns, tx: p.x - (p.x - cam.tx) * kk, ty: p.y - (p.y - cam.ty) * kk });
  };
  const zoom = (k: number) => setCam((c) => ({ s: c.s * k, tx: W / 2 - (W / 2 - c.tx) * k, ty: H / 2 - (H / 2 - c.ty) * k }));
  const gridFrom = ghost ? ghost.from : cursor;
  const AX = ['E', 'N', 'Up'], AXN = ['W', 'S', 'Dn'];

  return (
    <div className={'isostage mode-' + opts.mode + (armed ? ' armed' : '')} ref={wrap}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width={W} height={H} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onWheel={onWheel} role="img" aria-label={`Isometric sketch ${d.name}`}>
        <HatchDefs />
        <IsoPaper W={W} H={H} T3={T3} g={g} />
        {opts.mode === 'draw' && !armed && <PlaneGrid W={W} H={H} T3={T3} o={ghost?.origin ?? P[gridFrom] ?? [0, 0, 0]} g={g} />}
        <IsoArt d={d} disp={disp} T3={T3} sel={sel} cursor={cursor} opts={{ ...opts, textEdit: armed === 'notes' }} prefs={prefs} />
        {ghost && (() => {
          const o3 = ghost.origin ?? P[ghost.from];
          const a = T3(o3), b = T3(add(o3, ghost.v));
          const txt = [0, 1, 2].filter((k) => nz(ghost.v[k])).map((k) => `${Math.round(Math.abs(ghost.v[k]) / g)} ${ghost.v[k] > 0 ? AX[k] : AXN[k]}`).join(' · ');
          return (
            <g className="iso-ghostg">
              <line className="iso-ghost" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
              <circle className="iso-ghostpt" cx={b[0]} cy={b[1]} r={5} />
              <text className="iso-ghosttxt" x={b[0] + 9} y={b[1] - 9}>{txt}</text>
            </g>
          );
        })()}
        <Compass x={CMP.x} y={CMP.y} view={view} interactive />
      </svg>
      <div className="spinrow">
        <button className="ibtn spin" aria-label="Spin left" title="Turn the drawing 90° counter-clockwise" onClick={() => onView({ az: stepAz(view.az, -1), el: view.el })}>
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M7.5 8.5A7 7 0 1 1 5 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /><path d="M3.5 4.5v5h5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button className="ibtn spin" aria-label="Spin right" title="Turn the drawing 90° clockwise" onClick={() => onView({ az: stepAz(view.az, 1), el: view.el })}>
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M16.5 8.5A7 7 0 1 0 19 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /><path d="M20.5 4.5v5h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <button className="ibtn home" aria-label="Home view" title="Reset to the standard ISO view" onClick={goHome}>
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h5v-5.5h3V20h5V9.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>
      </button>
      <button className={'ibtn startpt' + (startOn ? ' on' : '')} aria-label="New start point" title="New start point — then tap the paper" onClick={onStartBtn}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M11 21.5c-.3 0-.6-.1-.8-.4C7.6 18 4.5 14.3 4.5 10.7a6.5 6.5 0 0 1 9.7-5.7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /><path d="M17.3 10.4c.1.1.2.2.2.3 0 3.6-3.1 7.3-5.7 10.4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="11" cy="10.7" r="1.9" fill="currentColor" /><path d="M18 2.5v6M15 5.5h6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
      </button>
      <button className={'ibtn offtab' + (offsetOn ? ' on' : '')} aria-label="Add offset" title="Add an offset (angled run) from the current point" onClick={onOffsetBtn}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M3 18h6l6-12h6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /><path d="M9 18l6-12" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" /></svg>
        <span>Offset</span>
      </button>
      {menu && (() => {
        const [x, y] = T3(menu.at);
        const left = Math.max(6, Math.min(W - 236, x - 115));
        const roomBelow = H - (y + 18) - 6, roomAbove = y - 18 - 6;
        const style: React.CSSProperties = roomBelow >= roomAbove
          ? { left, top: Math.min(H - 60, y + 18), maxHeight: Math.max(120, roomBelow) }
          : { left, bottom: Math.max(6, H - y + 18), maxHeight: Math.max(120, roomAbove) };
        return <div className="itemmenu" style={style} onPointerDown={(e) => e.stopPropagation()}>{menu.node}</div>;
      })()}
      {children}
      <div className="isozoom">
        <button className="ibtn" aria-label="Zoom in" onClick={() => zoom(1.3)}>+</button>
        <button className="ibtn" aria-label="Zoom out" onClick={() => zoom(1 / 1.3)}>−</button>
        <button className="ibtn" onClick={() => setCam(fitCam())}>Fit</button>
      </div>
    </div>
  );
}

function HatchDefs() {
  return (
    <defs>
      <pattern id="isoHatchA" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" className="iso-hatchline" /></pattern>
      <pattern id="isoHatchB" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="6" className="iso-hatchline" /></pattern>
      <marker id="isoarr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" className="cmp-head" /></marker>
    </defs>
  );
}

/**
 * Isometric paper: three families of lines along the projected East, North and Up directions (30°, 150° and
 * vertical in the ISO view), drawn across the whole canvas at any zoom. When zoomed far out the spacing steps up
 * (×2, ×5, ×10 …) so the paper stays readable; every fifth line is darker.
 */
function IsoPaper({ W, H, T3, g }: { W: number; H: number; T3: (p: Vec3) => [number, number]; g: number }) {
  const o = T3([0, 0, 0]);
  const sv = (v: Vec3): [number, number] => { const q = T3(mul(v, g)); return [q[0] - o[0], q[1] - o[1]]; };
  const E = sv([1, 0, 0]), N = sv([0, 1, 0]), U = sv([0, 0, 1]);
  const fams: Array<{ d: [number, number]; step: [number, number]; key: string }> = [
    { d: E, step: N, key: 'e' }, { d: N, step: E, key: 'n' }, { d: U, step: Math.hypot(...E) >= Math.hypot(...N) ? E : N, key: 'u' },
  ];
  const maxLen = Math.max(...fams.map((f) => Math.hypot(...f.d)));
  const usable = fams.map((f) => {
    const L = Math.hypot(...f.d);
    if (L < maxLen * 0.12) return null; // direction seen end-on (e.g. Up in plan view)
    const du: [number, number] = [f.d[0] / L, f.d[1] / L];
    const nn: [number, number] = [-du[1], du[0]];
    const sp = f.step[0] * nn[0] + f.step[1] * nn[1];
    if (Math.abs(sp) < 0.5) return null;
    return { ...f, du, nn, sp };
  }).filter(Boolean) as Array<{ d: [number, number]; step: [number, number]; key: string; du: [number, number]; nn: [number, number]; sp: number }>;
  if (!usable.length) return null;
  const minSp = Math.min(...usable.map((f) => Math.abs(f.sp)));
  const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  const m = STEPS.find((k) => minSp * k >= 9) ?? 1000;
  const corners: Array<[number, number]> = [[0, 0], [W, 0], [0, H], [W, H]];
  const cx = W / 2, cy = H / 2, D = W + H;
  const minor: string[] = [], major: string[] = [];
  for (const f of usable) {
    const ks = corners.map((c) => ((c[0] - o[0]) * f.nn[0] + (c[1] - o[1]) * f.nn[1]) / (f.sp * m));
    const k0 = Math.floor(Math.min(...ks)), k1 = Math.ceil(Math.max(...ks));
    if (k1 - k0 > 600) continue;
    for (let k = k0; k <= k1; k++) {
      const px = o[0] + f.step[0] * k * m, py = o[1] + f.step[1] * k * m;
      const t = (cx - px) * f.du[0] + (cy - py) * f.du[1];
      const qx = px + f.du[0] * t, qy = py + f.du[1] * t;
      const seg = `M${(qx - f.du[0] * D).toFixed(1)} ${(qy - f.du[1] * D).toFixed(1)}L${(qx + f.du[0] * D).toFixed(1)} ${(qy + f.du[1] * D).toFixed(1)}`;
      ((k * m) % (5 * m) === 0 ? major : minor).push(seg);
    }
  }
  return (
    <g className="isopaper">
      <path className="minor" d={minor.join('')} />
      <path className="major" d={major.join('')} />
    </g>
  );
}

/** The three paper directions through the point being drawn from. */
function PlaneGrid({ W, H, T3, o, g }: { W: number; H: number; T3: (p: Vec3) => [number, number]; o: Vec3; g: number }) {
  const p0 = T3(o);
  const D = W + H;
  return (
    <g className="isogrid2">
      {([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).map((v, j) => {
        const q = T3(add(o, mul(v, g))); const dx = q[0] - p0[0], dy = q[1] - p0[1], L = Math.hypot(dx, dy);
        if (L < 0.5) return null;
        const ux = dx / L, uy = dy / L;
        return <line key={j} className="ax" x1={p0[0] - ux * D} y1={p0[1] - uy * D} x2={p0[0] + ux * D} y2={p0[1] + uy * D} />;
      })}
    </g>
  );
}

/** Compass: the four horizontal directions as seen in the current view. */
function Compass({ x, y, view, interactive }: { x: number; y: number; view: View; interactive?: boolean }) {
  const R = 24;
  const dirs: Array<[string, Vec3]> = [['N', [0, 1, 0]], ['E', [1, 0, 0]], ['S', [0, -1, 0]], ['W', [-1, 0, 0]]];
  const pr = dirs.map(([k, v]) => { const p = project(v, view); return [k, p[0], p[1]] as const; });
  const m = Math.max(...pr.map((p) => Math.hypot(p[1], p[2])), 1e-6);
  const up = project([0, 0, 1], view);
  return (
    <g className="compass" data-compass={interactive ? '1' : undefined} transform={`translate(${x} ${y})`}>
      <circle r={R + 6} className="cmp-ring" />
      <line x1={0} y1={0} x2={(up[0] / 1.25) * R * 0.55} y2={(up[1] / 1.25) * R * 0.55} className="cmp-up" />
      {pr.map(([k, px, py]) => {
        const ex = (px / m) * R, ey = (py / m) * R, show = Math.hypot(px, py) / m > 0.2;
        return (
          <g key={k}>
            <line x1={0} y1={0} x2={ex * 0.82} y2={ey * 0.82} className={k === 'N' ? 'cmp-n' : 'cmp-dir'} markerEnd={k === 'N' ? 'url(#isoarr)' : undefined} />
            {show && <text x={ex * 1.12} y={ey * 1.12 + 3} textAnchor="middle" className={'cmp-t' + (k === 'N' ? ' n' : '')}>{k}</text>}
          </g>
        );
      })}
    </g>
  );
}

/** Drawing content in screen coordinates. Shared by the canvas and the image export. */
export function IsoArt({ d, disp, T3, sel, cursor, opts, prefs, exportMode }: {
  d: IsoDrawing; disp: { P: Vec3[]; vecs: Vec3[]; k?: number }; T3: (p: Vec3) => [number, number]; sel: Sel; cursor: number; opts: ArtOpts; prefs: Prefs; exportMode?: boolean;
}) {
  const { P, vecs } = disp;
  const S = P.map(T3);
  const under: React.ReactNode[] = [];
  const els: React.ReactNode[] = [];
  const unit = (a: [number, number], b: [number, number]) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L, L] as const; };
  const sizes = runSizes(d);
  const label = (key: string, a: [number, number], b: [number, number], text: string, cls: string, off = 11, dim?: number) => {
    const [ux, uy, L] = unit(a, b);
    if (L < 12) return null;
    let nx = -uy, ny = ux;
    if (ny > 0 || (Math.abs(ny) < 1e-6 && nx > 0)) { nx = -nx; ny = -ny; } // keep labels above / left of the line
    const lx = (a[0] + b[0]) / 2 + nx * off, ly = (a[1] + b[1]) / 2 + ny * off;
    let ang = (Math.atan2(uy, ux) * 180) / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    return <text key={key} className={cls + (dim != null && !exportMode ? ' tap' : '')} data-dim={dim != null && !exportMode ? dim : undefined} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${ang.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})`}>{text}</text>;
  };

  d.runs.forEach((r, i) => {
    const A3 = P[r.from], v = vecs[i];
    const a = S[r.from], b = S[i + 1];
    if (!A3 || !v || !a || !b) return;
    const [ux, uy, L] = unit(a, b);
    const nx = -uy, ny = ux;
    const selected = sel?.kind === 'run' && sel.id === i;
    const measured = isMeasured(r);
    const tv = runVec(r);
    if (r.move) { // new start point: faint dotted link, no pipe
      if (!exportMode) els.push(<line key={'mv' + i} data-run={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={'iso-move' + (selected ? ' sel' : '')} />);
      return;
    }
    const axes = [0, 1, 2].filter((k) => nz(v[k]));

    // offsets: dashed component legs + hatched triangle(s), each leg dimensioned
    if (axes.length >= 2) {
      const comp = (k: number): Vec3 => { const c: Vec3 = [0, 0, 0]; c[k] = v[k]; return c; };
      if (axes.length === 2) {
        const C3 = add(A3, comp(axes[0])), c = T3(C3);
        const hatch = axes.includes(2) ? 'isoHatchB' : 'isoHatchA';
        under.push(<polygon key={'h' + i} points={`${a.join(',')} ${c.join(',')} ${b.join(',')}`} fill={`url(#${hatch})`} className="iso-hatch" />);
        under.push(<polyline key={'o' + i} points={`${a.join(',')} ${c.join(',')} ${b.join(',')}`} className="iso-off" />);
        if (opts.dims && measured) {
          under.push(label('l1' + i, a, c, `${formatFtIn(Math.abs(tv[axes[0]]), prefs)} ${runRef(d, i)}`, 'iso-legdim', 9));
          under.push(label('l2' + i, c, b, `${formatFtIn(Math.abs(tv[axes[1]]), prefs)} ${runRef(d, i)}`, 'iso-legdim', 9));
        }
      } else {
        const C1 = add(A3, comp(0)), Hh = add(C1, comp(1));
        const c1 = T3(C1), h = T3(Hh);
        under.push(<polygon key={'h1' + i} points={`${a.join(',')} ${c1.join(',')} ${h.join(',')}`} fill="url(#isoHatchA)" className="iso-hatch" />);
        under.push(<polygon key={'h2' + i} points={`${a.join(',')} ${h.join(',')} ${b.join(',')}`} fill="url(#isoHatchB)" className="iso-hatch" />);
        under.push(<polyline key={'o' + i} points={`${a.join(',')} ${c1.join(',')} ${h.join(',')} ${b.join(',')}`} className="iso-off" />);
        under.push(<line key={'oh' + i} x1={a[0]} y1={a[1]} x2={h[0]} y2={h[1]} className="iso-off" />);
        if (opts.dims && measured) {
          under.push(label('l1' + i, a, c1, `${formatFtIn(Math.abs(tv[0]), prefs)} ${runRef(d, i)}`, 'iso-legdim', 9));
          under.push(label('l2' + i, c1, h, `${formatFtIn(Math.abs(tv[1]), prefs)} ${runRef(d, i)}`, 'iso-legdim', 9));
          under.push(label('l3' + i, h, b, `${formatFtIn(Math.abs(tv[2]), prefs)} ${runRef(d, i)}`, 'iso-legdim', 9));
        }
      }
    }

    if (!exportMode) els.push(<line key={'hit' + i} data-run={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="iso-hit" />);
    els.push(<line key={'r' + i} data-run={exportMode ? undefined : i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={'iso-pipe' + (selected ? ' sel' : '')} />);

    // fittings and valves on the line
    const items = runItems(r);
    // valve stems point the same real-world way whatever the view (up off level pipe)
    const sw = stemDir(tv), sp0 = T3(A3), sp1 = T3(add(A3, mul(sw, 12)));
    const sl = Math.hypot(sp1[0] - sp0[0], sp1[1] - sp0[1]);
    const stemScreen: [number, number] | undefined = sl > 0.5 ? [(sp1[0] - sp0[0]) / sl, (sp1[1] - sp0[1]) / sl] : undefined;
    items.forEach((it) => {
      const ft = measured && it.at != null ? Math.max(0.02, Math.min(0.98, it.at / (runLength(r) || 1))) : it.t; // a set center position wins
      const c: [number, number] = [a[0] + (b[0] - a[0]) * ft, a[1] + (b[1] - a[1]) * ft];
      const sz = Math.max(4, Math.min(8, L / (3 * Math.max(1, items.length))));
      const isSelItem = sel?.kind === 'item' && sel.id === it.id;
      if (isSelItem && !exportMode) els.push(<circle key={'ih' + it.id} className="iso-itemsel" cx={c[0]} cy={c[1]} r={sz * 1.9} />);
      els.push(<g key={'it' + it.id} className="iso-item" data-run={exportMode ? undefined : i} data-item={exportMode ? undefined : it.id}>
        {!exportMode && <circle className="iso-itemhit" cx={c[0]} cy={c[1]} r={Math.max(12, sz * 1.8)} />}
        {lineSymbol(it.type, c, [ux, uy], sz, 'it' + it.id, stemScreen)}
      </g>);
      if (opts.welds && !['spool', 'flange', 'orifice', 'spectacle', 'union', 'coupling', 'dielectric', 'swage'].includes(it.type)) {
        const off = sz * 1.15 + 4;
        for (const sgn of [-1, 1]) els.push(...jointMark(it.conn ?? 'bw', [c[0] + ux * off * sgn, c[1] + uy * off * sgn], [ux, uy], `jm${it.id}${sgn}`));
      }
    });
    const m: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // travel dimension on the pipe, or a "needs dimension" marker
    if (opts.dims) {
      const segs = measured ? runSegments(d, i) : null;
      if (segs) {
        // the line is broken into spools by its fittings: dimension each piece (C-F, F-F, F-C) and show the overall C-C on the other side
        const tr = runLength(r) || 1;
        const at = (x: number): [number, number] => [a[0] + (b[0] - a[0]) * (x / tr), a[1] + (b[1] - a[1]) * (x / tr)];
        segs.forEach((g, k) => {
          const p1 = at(g.a), p2 = at(g.b);
          const lb = label('sg' + i + '-' + k, p1, p2, `${g.known ? '' : '≈'}${formatFtIn(Math.max(0, g.len), prefs)} ${g.kind}`, 'iso-dim seg' + (g.known ? '' : ' unk'), 19);
          if (lb) els.push(lb);
        });
        const lb = label('d' + i, a, b, `${formatFtIn(runLength(r), prefs)} ${axes.length > 1 ? 'TRAV ' : ''}${runRef(d, i)}`, 'iso-dimsub', -13);
        if (lb) els.push(lb);
      } else if (measured) {
        const txt = `${formatFtIn(shownLength(d, i), prefs)} ${axes.length > 1 ? 'TRAV ' : ''}${runRef(d, i)}`;
        const lb = label('d' + i, a, b, txt, 'iso-dim', items.length ? 20 : 11, i);
        if (lb) els.push(lb);
      } else if (!exportMode && L > 22) {
        const off = items.length ? 16 : 0;
        els.push(<g key={'q' + i} data-dim={i}><circle className="iso-qbg" cx={m[0] + nx * off} cy={m[1] + ny * off} r={7} /><text className="iso-q" x={m[0] + nx * off} y={m[1] + ny * off + 3.5} textAnchor="middle">?</text></g>);
      }
    }
    if (opts.labels) els.push(<text key={'rl' + i} className="iso-node" x={m[0] - nx * 12} y={m[1] - ny * 12 + 3} textAnchor="middle">L{i + 1}</text>);
  });

  // nodes
  const nNodes = d.runs.length + 1;
  for (let n = 0; n < nNodes; n++) {
    const p = S[n]; if (!p) continue;
    const k = nodeKind(d, n);
    const legs = nodeLegs(d, n);
    const legScreen = legs.map((l) => { const r = d.runs[l.run]; const other = r.from === n ? S[l.run + 1] : S[r.from]; const [ux, uy] = unit(p, other); return [ux, uy] as const; });
    if (k.kind === 'elbow' || k.kind === 'tee' || k.kind === 'cross') {
      const fit = d.fits?.[n];
      if (opts.welds) legScreen.forEach(([ux, uy], j) => {
        const jm = legJoint(fit, legScreen, j, connAt(d, n));
        if (jm) els.push(...jointMark(jm.conn, [p[0] + ux * jm.off, p[1] + uy * jm.off], [ux, uy], `w${n}-${j}`));
      });
      const fs = d.fitSize?.[n];
      els.push(...nodeSymbol(fit, k.kind, p, legScreen, 'ns' + n, undefined, fs ? (fit === 'redtee' ? `${d.nps}"×${fs}"` : `${fs}"`) : undefined));
      const er = k.kind === 'elbow' ? inlineAt(d, n) : null;
      const li = legs.findIndex((l) => l.run === n - 1);
      if (er && li >= 0) {
        // reducer welded onto the elbow, drawn on the line coming in
        const ui = legScreen[li]; const c: [number, number] = [p[0] + ui[0] * 15, p[1] + ui[1] * 15];
        if (sel?.kind === 'node' && sel.id === n && !exportMode) els.push(<circle key={'ih' + n} className="iso-itemsel" cx={c[0]} cy={c[1]} r={12} />);
        els.push(...lineSymbol(er.type, c, [-ui[0], -ui[1]], 6, 'er' + n));
        if (er.size && opts.dims) els.push(<text key={'ers' + n} className="iso-fit" x={c[0] - ui[1] * 14} y={c[1] + ui[0] * 14 + 3} textAnchor="middle">{`${sizes[n - 1] ?? d.nps}"×${er.size}"`}</text>);
      }
      if (k.kind === 'elbow' && Math.abs(k.angle - 90) > 0.05) els.push(<text key={'ea' + n} className="iso-note" x={p[0] + 7} y={p[1] + 15}>{formatNumber(k.angle, 1)}°</text>);
    } else if (k.kind === 'straight') {
      const it = inlineAt(d, n);
      if (it && legScreen.length === 2) {
        const u = legScreen[1];
        const sz = 7;
        // stem points the same real-world way whatever the view
        const rv = runVec(d.runs[legs[0].run]);
        const sw = stemDir(rv), q0 = T3(P[n]), q1 = T3(add(P[n], mul(sw, 12)));
        const sl = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
        const stemS: [number, number] | undefined = sl > 0.5 ? [(q1[0] - q0[0]) / sl, (q1[1] - q0[1]) / sl] : undefined;
        const isSelN = sel?.kind === 'node' && sel.id === n;
        if (isSelN && !exportMode) els.push(<circle key={'ih' + n} className="iso-itemsel" cx={p[0]} cy={p[1]} r={sz * 1.9} />);
        els.push(<g key={'inl' + n} className="iso-item">{lineSymbol(it.type, p, u, sz, 'inl' + n, stemS)}</g>);
        if (isReducer(it.type) && it.size && opts.dims) els.push(<text key={'rs' + n} className="iso-fit" x={p[0] + (stemS?.[0] ?? 0) * 16} y={p[1] + (stemS?.[1] ?? -1) * 16 + 3} textAnchor="middle">{`${sizes[n - 1] ?? d.nps}"×${it.size}"`}</text>);
        if (opts.welds && !['spool', 'flange', 'orifice', 'spectacle', 'union', 'coupling', 'dielectric', 'swage'].includes(it.type)) {
          const off = sz * 1.15 + 4;
          for (const sgn of [-1, 1]) els.push(...jointMark(it.conn ?? 'bw', [p[0] + u[0] * off * sgn, p[1] + u[1] * off * sgn], u, `ij${n}${sgn}`));
        }
      } else if (opts.welds) els.push(...jointMark(connAt(d, n), p, legScreen[0] ?? [1, 0], 'sw' + n));
    } else {
      const endT = d.ends[n] ?? 'open';
      const er = inlineAt(d, n);
      if (er && legScreen[0]) {
        // reducer on the end of a line
        if (sel?.kind === 'node' && sel.id === n && !exportMode) els.push(<circle key={'ih' + n} className="iso-itemsel" cx={p[0] - legScreen[0][0] * 7} cy={p[1] - legScreen[0][1] * 7} r={12} />);
        els.push(...endSymbol(er.type === 'eccreducer' ? 'eccreducer' : 'reducer', p, legScreen[0], 'er' + n));
        if (er.size && opts.dims) els.push(<text key={'ers' + n} className="iso-fit" x={p[0] - legScreen[0][0] * 22} y={p[1] - legScreen[0][1] * 22 + 3} textAnchor="middle">{`${sizes[n - 1] ?? d.nps}"×${er.size}"`}</text>);
        if (opts.welds) els.push(...jointMark(er.conn ?? 'bw', p, legScreen[0], 'erj' + n));
      } else els.push(...endSymbol(endT, p, legScreen[0] ?? [1, 0], 'e' + n, exportMode, connAt(d, n)));
      // the joint between the pipe and the end fitting, shown with the chosen connection's mark
      // (a flange end shows how the flange is joined to the pipe: weld dot = weld neck, tick = threaded …; the nozzle draws its own)
      const ec = connAt(d, n);
      if (opts.welds && legScreen[0] && !['open', 'weld', 'nozzle'].includes(endT) && !(['flange', 'blind'].includes(endT) && ec === 'flg'))
        els.push(...jointMark(ec, [p[0] + legScreen[0][0] * (['flange', 'blind'].includes(endT) ? 6 : 3), p[1] + legScreen[0][1] * (['flange', 'blind'].includes(endT) ? 6 : 3)], legScreen[0], 'ej' + n));
    }
    if (!exportMode) {
      const isCursor = n === cursor, isSel = sel?.kind === 'node' && sel.id === n;
      els.push(<circle key={'hn' + n} data-node={n} data-inl={inlineAt(d, n) ? '1' : undefined} cx={p[0]} cy={p[1]} r={inlineAt(d, n) ? 16 : 13} className={"iso-nodehit" + (isCursor ? ' cursor' : '') + (isSel ? ' sel' : '')} />);
    }
    if (opts.labels) els.push(<text key={'nl' + n} className="iso-node" x={p[0] + 8} y={p[1] - 8}>{n}</text>);
  }
  // notes
  d.notes.forEach((t, j) => {
    const p = S[t.node]; if (!p) return;
    const lx = p[0] + 22, ly = p[1] - 18 - (j % 3) * 12;
    els.push(<g key={'n' + t.id}><line className="iso-leader" x1={p[0]} y1={p[1]} x2={lx - 2} y2={ly + 2} /><text className="iso-note" x={lx} y={ly}>{t.text}</text></g>);
  });
  // weld map: every weld numbered (W1 …, field welds FW). Tags are placed where they don't sit on a pipe,
  // a dimension or another tag; the stencil, shop / field and notes are in the weld log and the weld's menu.
  const tags: React.ReactNode[] = [];
  if (opts.weldmap) {
    type Seg = [number, number, number, number, number]; // x1 y1 x2 y2 clearance
    const segs: Seg[] = [];
    d.runs.forEach((r, i) => {
      if (r.move) return; const a = S[r.from], b = S[i + 1]; if (!a || !b) return;
      segs.push([a[0], a[1], b[0], b[1], 7]);
      if (opts.dims && isMeasured(r)) {
        // dimension text sits beside the middle of the line
        const [ux, uy, L] = unit(a, b); if (L < 12) return;
        let nx = -uy, ny = ux; if (ny > 0 || (Math.abs(ny) < 1e-6 && nx > 0)) { nx = -nx; ny = -ny; }
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, hw = Math.min(L / 2, 42);
        for (const o of [12, 20, -14]) segs.push([mx + nx * o - ux * hw, my + ny * o - uy * hw, mx + nx * o + ux * hw, my + ny * o + uy * hw, 8]);
      }
    });
    const segDist = (x: number, y: number, g: Seg) => {
      const dx = g[2] - g[0], dy = g[3] - g[1], L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - g[0]) * dx + (y - g[1]) * dy) / L2));
      return Math.hypot(x - g[0] - t * dx, y - g[1] - t * dy);
    };
    const boxes: Array<[number, number, number, number]> = []; // placed tags: cx cy halfW halfH
    weldList(d).forEach((w, j) => {
      const p = S[w.node]; const r = d.runs[w.run]; if (!p || !r) return;
      const other = r.from === w.node ? S[w.run + 1] : S[r.from]; if (!other) return;
      const [ux, uy, L] = unit(p, other);
      const off = Math.min(L * 0.4, w.where === 'fitting' ? 9 : w.where === 'inline' ? 12 : w.where === 'reducer' ? 24 : w.where === 'end' ? 4 : 0);
      const c: [number, number] = [p[0] + ux * off, p[1] + uy * off];
      let nx = -uy, ny = ux; if (ny > 0 || (Math.abs(ny) < 1e-6 && nx > 0)) { nx = -nx; ny = -ny; }
      nx = -nx; ny = -ny; // dimensions go above / left of a line: weld tags start on the other side
      // prefer the side away from the other pipes at that point
      let ox = 0, oy = 0;
      nodeLegs(d, w.node).forEach((l) => { if (l.run === w.run) return; const q = d.runs[l.run]; const o2 = q.from === w.node ? S[l.run + 1] : S[q.from]; if (!o2) return; const [vx, vy] = unit(p, o2); ox += vx; oy += vy; });
      if (nx * ox + ny * oy > 0.2) { nx = -nx; ny = -ny; }
      const info = d.welds?.[w.key];
      const tag = `${info?.field ? 'FW' : 'W'}${j + 1}`;
      const hw = (4 + tag.length * 4.3) / 2, hh = 5;
      // try spots around the weld; keep the first clear one (or the least crowded)
      let best: [number, number] = [c[0] + nx * 13, c[1] + ny * 13], bestScore = Infinity;
      search: for (const dist of [12, 17, 23, 30, 38]) for (const sd of [1, -1]) for (const al of [0, 7, -7, 14, -14]) {
        const x = c[0] + nx * sd * dist + ux * al, y = c[1] + ny * sd * dist + uy * al;
        let score = dist * 0.02 + (sd < 0 ? 0.05 : 0);
        for (const g of segs) { const dd = segDist(x, y, g) - Math.max(hw, hh) * 0.75; if (dd < g[4]) score += (g[4] - dd) * 2; }
        for (const bx of boxes) { const ovx = hw + bx[2] + 2 - Math.abs(x - bx[0]), ovy = hh + bx[3] + 2 - Math.abs(y - bx[1]); if (ovx > 0 && ovy > 0) score += 20 + ovx * ovy; }
        if (score < bestScore) { bestScore = score; best = [x, y]; }
        if (score < 0.5) break search;
      }
      const t = best;
      boxes.push([t[0], t[1], hw, hh]);
      const on = sel?.kind === 'weld' && sel.key === w.key;
      // leader from the weld to the near edge of the tag
      const lx = t[0] - c[0], ly = t[1] - c[1], ll = Math.hypot(lx, ly) || 1;
      const edge = Math.min(hw / Math.max(1e-6, Math.abs(lx / ll)), hh / Math.max(1e-6, Math.abs(ly / ll)));
      tags.push(<g key={'wm' + w.key} className={'iso-wtag' + (info?.field ? ' field' : '') + (on ? ' sel' : '')} data-weld={exportMode ? undefined : w.key}>
        {ll - edge > 2.5 && <line className="iso-wlead" x1={c[0]} y1={c[1]} x2={t[0] - (lx / ll) * edge} y2={t[1] - (ly / ll) * edge} />}
        <circle className="iso-wdot" cx={c[0]} cy={c[1]} r={1.6} />
        {!exportMode && <circle className="iso-whit" cx={t[0]} cy={t[1]} r={12} />}
        <rect className="iso-wbox" x={t[0] - hw} y={t[1] - hh} width={hw * 2} height={hh * 2} rx={info?.field ? hh : 1.5} />
        <text className="iso-wtxt" x={t[0]} y={t[1] + 2.4} textAnchor="middle">{tag}</text>
      </g>);
    });
  }
  // text notes placed on the drawing
  const kk = disp.k || 1;
  (d.texts ?? []).forEach((t) => {
    const base = P[t.node]; if (!base) return;
    const q = T3(add(base, mul(t.off, kk)));
    const lines = (t.text || (exportMode ? '' : 'Note…')).split('\n');
    if (!lines.join('').trim()) return;
    const w = Math.max(...lines.map((x) => x.length)) * 5.3 + 10, h = lines.length * 11 + 6;
    const on = sel?.kind === 'text' && sel.id === t.id;
    tags.push(<g key={'tx' + t.id} className={'iso-textg' + (opts.textEdit ? ' edit' : '') + (on ? ' sel' : '')} data-text={exportMode ? undefined : t.id}>
      {!exportMode && <rect className="iso-textbox" x={q[0] - 5} y={q[1] - 11} width={w} height={h} rx={3} />}
      {lines.map((ln, k) => <text key={k} className={'iso-textnote' + (t.text ? '' : ' ph')} x={q[0]} y={q[1] + k * 11}>{ln}</text>)}
    </g>);
  });
  return <g>{under}{els}{tags}</g>;
}

// ------------------------------------------------------------------ editors
function RunEditor({ d, i, prefs, cut, update, onClose, onDelete }: {
  d: IsoDrawing; i: number; prefs: Prefs; cut: ReturnType<typeof cutList>[number]; update: (f: (d: IsoDrawing) => IsoDrawing, mergeKey?: string) => void; onClose: () => void; onDelete: () => void;
}) {
  const r = d.runs[i];
  const sv = sketchVec(r);
  const axes = [0, 1, 2].filter((k) => nz(sv[k]));
  const tv = isMeasured(r) ? runVec(r) : null;
  const adj = axes.length === 1 ? faceAdj(d, i) : 0; // a valve at either end: the length is to its face / end
  const [txt, setTxt] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = { t: '' };
    axes.forEach((k) => { o[k] = tv ? formatFtIn(Math.abs(tv[k]) - adj, prefs) : ''; });
    return o;
  });
  const [err, setErr] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const setRun = (f: (r: Run) => Run, mergeKey?: string) => update((x) => ({ ...x, runs: x.runs.map((q, k) => (k === i ? f(q) : q)) }), mergeKey);
  const descendants = useMemo(() => { const e = deleteSubtree(d, i); return d.runs.length - e.runs.length - 1; }, [d, i]);

  const apply = (next: Record<string, string>) => {
    setTxt(next); setErr(null);
    const val = (s: string): number | null | 'bad' => { const p = tryParse(parseLength, s); return !p ? null : p.ok && p.v >= 0 ? p.v : 'bad'; };
    const vals = axes.map((k) => val(next[k] ?? ''));
    const T = axes.length > 1 ? val(next.t) : null;
    if (vals.includes('bad') || T === 'bad') { setErr('Enter lengths like 5\' 6", 66, 1676 mm'); return; }
    const sign = (k: number) => (sv[k] < 0 ? -1 : 1);
    let m: Vec3 | undefined;
    const known = vals.filter((v) => v !== null) as number[];
    if (known.length === axes.length) {
      m = [0, 0, 0]; axes.forEach((k, j) => { m![k] = sign(k) * ((vals[j] as number) + adj); });
    } else if (T !== null && T > 0) {
      const blanks = axes.length - known.length;
      if (blanks === axes.length) { const L = len3(sv); m = mul(sv, T / L); }
      else if (blanks === 1) {
        const rem = T * T - known.reduce((s, v) => s + v * v, 0);
        if (rem < 0) { setErr('The travel is shorter than the legs entered.'); return; }
        m = [0, 0, 0]; axes.forEach((k, j) => { m![k] = sign(k) * (vals[j] === null ? Math.sqrt(rem) : (vals[j] as number)); });
      } else { setErr('Enter all the legs, or the travel and all but one leg.'); }
    } else if (known.length) setErr(axes.length > 1 ? 'Enter every leg (or the travel and all but one leg).' : null);
    if (m && len3(m) > 0) setRun((q) => ({ ...q, meas: m, sketch: true }), 'dim' + r.id);
    else if (!known.length && T === null) setRun((q) => { const { meas: _m, ...rest } = q; return { ...rest, sketch: true }; }, 'dim' + r.id);
  };
  const flip = (k: number) => setRun((q) => {
    const s = sketchVec(q); s[k] = -s[k];
    const mm = q.meas ? ([...q.meas] as Vec3) : !q.sketch ? sketchVec(q) : undefined;
    if (mm) mm[k] = -mm[k];
    return { ...q, dx: s[0], dy: s[1], dz: s[2], ...(mm ? { meas: mm } : {}) };
  });
  const turn = (key: string) => setRun((q) => {
    const v = DIRS[key].v; const L = len3(sketchVec(q)); const M = isMeasured(q) ? runLength(q) : 0;
    return { ...q, dx: v[0] * L, dy: v[1] * L, dz: v[2] * L, ...(M ? { meas: mul(v, M) } : {}) };
  });
  const curDir = axes.length === 1 ? (Object.keys(DIRS).find((k) => { const v = DIRS[k].v; return dot3(v, sv) > 0 && Math.abs(dot3(v, sv) - len3(sv)) < 1e-6; }) ?? 'N') : null;

  if (r.move) return (
    <Card className="isoedit">
      <div className="row-between"><b>Separate start point</b><button className="chip" onClick={onClose}>Done</button></div>
      <p className="fhint">This dotted link only places point {i + 1} — no pipe is drawn or cut for it.</p>
      <button className="btn danger" onClick={onDelete}>{descendants > 0 ? `Delete this start point + the ${descendants} line${descendants > 1 ? 's' : ''} from it` : 'Delete this start point'}</button>
    </Card>
  );
  return (
    <Card className="isoedit">
      <div className="row-between"><b>Line {i + 1}: {describeRun(r)}</b><button className="chip" onClick={onClose}>Done</button></div>
      {axes.length === 1 ? (
        <Grid>
          <Field label={`Length (${runRef(d, i)})`} value={txt[axes[0]] ?? ''} onChange={(v) => apply({ ...txt, [axes[0]]: v })} parse={parseLength} placeholder="add dimension" />
          <Select label="Direction" value={curDir!} options={(['N', 'S', 'E', 'W', 'U', 'D'] as const).map((k) => [k, DIRS[k].label])} onChange={turn} />
        </Grid>
      ) : (
        <>
          <p className="fhint">Offset legs (centerline). Enter every leg, or the travel and all but one leg.</p>
          <Grid>
            {axes.map((k) => (
              <div key={k} className="legfield">
                <Field label={AXIS_NAMES[k][sv[k] < 0 ? 1 : 0]} value={txt[k] ?? ''} onChange={(v) => apply({ ...txt, [k]: v })} parse={parseLength} placeholder="leg" />
                <button className="chip" onClick={() => flip(k)}>⇄ {AXIS_NAMES[k][sv[k] < 0 ? 0 : 1]}</button>
              </div>
            ))}
            <Field label="Travel" value={txt.t} onChange={(v) => apply({ ...txt, t: v })} parse={parseLength} placeholder={tv ? formatFtIn(runLength(r), prefs) : 'optional'} />
          </Grid>
        </>
      )}
      {err && <Msg kind="warn">{err}</Msg>}
      {isMeasured(r) && axes.length > 1 && <p className="fhint">Travel {formatFtIn(runLength(r), prefs)}{axes.length === 2 && tv ? ` · ${formatNumber((Math.atan2(Math.abs(tv[axes[1]]), Math.abs(tv[axes[0]])) * 180) / Math.PI, 2)}° from ${AXIS_NAMES[axes[0]][sv[axes[0]] < 0 ? 1 : 0]}` : ''}</p>}
      {runSegments(d, i) && <SpoolFields d={d} i={i} prefs={prefs} setRun={setRun} />}
      <div className="itemlist">
        <span className="flabel">Fittings &amp; valves on this line</span>
        {!runItems(r).length && <p className="fhint">None yet — drag one from the palette onto the line.</p>}
        {runItems(r).map((it) => {
          const c = catalogItem(it.type, 'line');
          const setItems = (f: (l: ReturnType<typeof runItems>) => ReturnType<typeof runItems>, mk?: string) => setRun((q) => ({ ...q, inline: 'none', items: f(runItems(q)) }), mk);
          return (
            <div key={it.id} className="itemrow">
              {c && <PaletteIcon item={c} />}
              <span className="iname">{c?.label ?? it.type}
                <select className="miniselect" value={it.conn ?? 'bw'} aria-label={`Connection of ${c?.label ?? it.type}`} onChange={(e) => { const cn = e.target.value as Conn; setItems((l) => l.map((q) => (q.id === it.id ? { ...q, conn: cn } : q))); }}>
                  {CONN_ORDER.map((k) => <option key={k} value={k}>{CONN_LABEL[k]}</option>)}
                </select>
              </span>
              <input type="range" min={0.1} max={0.9} step={0.05} value={it.t} aria-label={`Position of ${c?.label ?? it.type}`} onChange={(e) => { const t = Number(e.target.value); setItems((l) => l.map((q) => (q.id === it.id ? { ...q, t, at: undefined } : q)), 'pos' + it.id); }} />
              <button className="chip danger" aria-label={`Remove ${c?.label ?? it.type}`} onClick={() => setItems((l) => l.filter((q) => q.id !== it.id))}>✕</button>
            </div>
          );
        })}
      </div>
      <p className="fhint">{cut.pieces ? `Cut: ${cut.pieces.map((q, k) => `${i + 1}${String.fromCharCode(97 + k)} ${Number.isNaN(q.cut) ? '?' : formatFtIn(q.cut, prefs)}`).join(' · ')}` : cut.ok ? `Cut length ${formatFracIn(cut.cut, prefs)}` : isMeasured(r) ? 'Cut length impossible — fittings longer than the line' : 'Add a dimension to get the cut length.'}{cut.ok && cut.note.length ? ` · ${cut.note.join('; ')}` : ''}</p>
      <div className="actions">
        {isMeasured(r) && r.sketch && <button className="btn" onClick={() => { setTxt({ t: '' }); setRun((q) => { const { meas: _m, ...rest } = q; return { ...rest, sketch: true }; }); }}>Clear dimension</button>}
        {descendants > 0 && !armed
          ? <button className="btn danger" onClick={() => setArmed(true)}>Delete…</button>
          : <button className="btn danger" onClick={onDelete}>{descendants > 0 ? `Delete + ${descendants} after it` : 'Delete line'}</button>}
      </div>
    </Card>
  );
}

/** Spool lengths of a line with fittings on it; typing one moves the fitting so that spool comes out to that length. */
function SpoolFields({ d, i, prefs, setRun }: { d: IsoDrawing; i: number; prefs: Prefs; setRun: (f: (r: Run) => Run, mergeKey?: string) => void }) {
  const r = d.runs[i];
  const segs = runSegments(d, i)!;
  const items = runItems(r).slice().sort((x, y) => itemPos(r, x) - itemPos(r, y));
  const [txt, setTxt] = useState<Record<number, string>>({});
  const L = runLength(r);
  const setSeg = (k: number, v: string) => {
    setTxt((o) => ({ ...o, [k]: v }));
    const p = tryParse(parseLength, v); if (!p || !p.ok || p.v < 0) return;
    // spool k ends at the near face of item k: its center = start of the spool + spool + half its length
    const it = items[k]; const half = (itemLength(d, it).len ?? 0) / 2;
    const at = segs[k].a + p.v + half;
    if (at + half > L) return;
    setRun((q) => ({ ...q, items: runItems(q).map((z) => (z.id === it.id ? { ...z, at, t: Math.max(0.02, Math.min(0.98, at / L)) } : z)) }), 'spool' + i + '-' + k);
  };
  return (
    <div className="spools">
      <span className="flabel">Spools (type one to move the fitting)</span>
      {segs.map((g, k) => (
        <div key={k} className="spoolrow">
          <span className="sname">{i + 1}{String.fromCharCode(97 + k)} · {g.kind}</span>
          {k < items.length
            ? <input className="spoolin" value={txt[k] ?? formatFtIn(Math.max(0, g.len), prefs)} aria-label={`Spool ${k + 1} ${g.kind}`} onChange={(e) => setSeg(k, e.target.value)} onBlur={() => setTxt((o) => { const n = { ...o }; delete n[k]; return n; })} />
            : <b>{formatFtIn(Math.max(0, g.len), prefs)}</b>}
          {!g.known && <span className="muted small">needs fitting length</span>}
        </div>
      ))}
    </div>
  );
}

function InlineEditor({ d, node, update, onClose, prefs }: { d: IsoDrawing; node: number; update: (f: (d: IsoDrawing) => IsoDrawing, mergeKey?: string) => void; onClose: () => void; prefs: Prefs }) {
  const it = inlineAt(d, node)!;
  const c = catalogItem(it.type, 'line');
  const std = itemLength(d, { ...it, len: undefined });
  const [lenT, setLenT] = useState(it.len != null ? formatFracIn(it.len, prefs) : '');
  const [armed, setArmed] = useState(false);
  const setIt = (f: (q: typeof it) => typeof it, mk?: string) => update((x) => ({ ...x, inl: { ...(x.inl ?? {}), [node]: f(x.inl![node]) } }), mk);
  const sd = sidesOf(d, node);
  return (
    <Card className="isoedit">
      <div className="row-between"><b>{c && <PaletteIcon item={c} />} {c?.label ?? it.type} · point {node}</b><button className="chip" onClick={onClose}>Done</button></div>
      <p className="fhint">The line is broken here{sd ? ` into line ${sd[0] + 1} and line ${sd[1] + 1}` : ''}. Tap either line to set its length (to this {(c?.label ?? 'fitting').toLowerCase()}'s {it.conn === 'flg' ? 'face' : 'end'}) — or drag the {(c?.label ?? 'fitting').toLowerCase()} along the line.</p>
      <Grid>
        <Select label="Fitting" value={it.type} options={CATALOG.filter((x) => x.kind === 'line').map((x) => [x.id, x.label])} onChange={(v) => setIt((q) => ({ ...q, type: v }))} />
        <Select label="Joint" value={it.conn ?? 'bw'} options={CONN_ORDER.map((k) => [k, CONN_LABEL[k]])} onChange={(v) => setIt((q) => ({ ...q, conn: v as Conn }))} />
      </Grid>
      <Field label={`Length (${it.conn === 'flg' ? 'face to face' : 'end to end'})`} value={lenT} parse={parseLength} placeholder={std.len != null ? formatFracIn(std.len, prefs) : 'enter length'}
        hint={it.len != null ? 'your length — clear it to use the standard one' : std.len != null ? std.src : 'no standard length — enter your manufacturer’s'}
        onChange={(v) => { setLenT(v); const r = tryParse(parseLength, v); if (!v.trim()) setIt((q) => ({ ...q, len: undefined }), 'ilen' + node); else if (r && r.ok && r.v >= 0) setIt((q) => ({ ...q, len: r.v }), 'ilen' + node); }} />
      {armed
        ? <button className="btn danger" onClick={() => { update((x) => mergeAt(x, node)); onClose(); }}>Remove it and join the line back</button>
        : <button className="btn danger" onClick={() => setArmed(true)}>Delete {(c?.label ?? 'fitting').toLowerCase()}…</button>}
    </Card>
  );
}

function NodeEditor({ d, node, update, onClose, prefs }: { d: IsoDrawing; node: number; update: (f: (d: IsoDrawing) => IsoDrawing, mergeKey?: string) => void; onClose: () => void; prefs: Prefs }) {
  const [noteText, setNoteText] = useState('');
  const [endT, setEndT] = useState(d.endLen?.[node] != null ? formatFracIn(d.endLen[node], prefs) : '');
  const std = endTakeoff({ ...d, endLen: {} }, node);
  const k = nodeKind(d, node);
  const e = B169[d.nps];
  const info = k.kind === 'elbow' ? `${formatNumber(k.angle, 2)}° elbow${k.angle > 90.05 ? ' — more than 90°: needs two fittings' : e ? ` · take-out ${formatNumber(Math.abs(k.angle - 90) < 0.05 ? e.lr90 : Math.abs(k.angle - 45) < 0.05 ? e.lr45 : e.lr90 * Math.tan((k.angle * Math.PI) / 360), 3)}"` : ''}`
    : k.kind === 'tee' ? 'Tee' : k.kind === 'cross' ? 'Cross' : k.kind === 'straight' ? 'Straight-through butt weld' : k.kind === 'multi' ? `${k.count} lines meet here` : 'End of line';
  return (
    <Card className="isoedit">
      <div className="row-between"><b>Point {node}</b><button className="chip" onClick={onClose}>Done</button></div>
      <p className="fhint">{info}. New lines start from this point.</p>
      {(k.kind === 'elbow' || k.kind === 'tee' || k.kind === 'cross') && (
        <Select label="Fitting" value={d.fits?.[node] ?? (k.kind === 'elbow' ? 'lr' : 'tee')} options={CATALOG.filter((c) => c.kind === (k.kind === 'elbow' ? 'elbow' : 'branch')).map((c) => [c.id, c.label])}
          onChange={(v) => update((x) => ({ ...x, fits: { ...(x.fits ?? {}), [node]: v } }))} />
      )}
      {(k.kind === 'tee' || k.kind === 'cross') && ['redtee', 'weldolet', 'sockolet', 'threadolet', 'stubin'].includes(d.fits?.[node] ?? '') && (
        <Select label={`Branch size (optional) — run is ${d.nps}"`} value={d.fitSize?.[node] ?? ''}
          options={[['', 'Not set'], ...Object.keys(B169).filter((n) => npsVal(n) < npsVal(d.nps)).map((n) => [n, `${d.nps}" × ${n}"`] as [string, string])]}
          onChange={(v) => update((x) => { const fs = { ...(x.fitSize ?? {}) }; if (v) fs[node] = v; else delete fs[node]; return { ...x, fitSize: fs }; })} />
      )}
      {k.kind !== 'multi' && !(k.kind === 'start-end' && !nodeLegs(d, node).length) && (
        <Select label="Joint here" value={connAt(d, node)} options={CONN_ORDER.map((c) => [c, CONN_LABEL[c]])} onChange={(v) => update((x) => ({ ...x, nodeConn: { ...(x.nodeConn ?? {}), [node]: v as Conn } }))} />
      )}
      {(k.kind === 'end' || k.kind === 'start-end') && (
        <Select label="End" value={d.ends[node] ?? 'open'} options={(Object.keys(END_LABEL) as EndType[]).map((x) => [x, END_LABEL[x]])} onChange={(v) => update((x) => ({ ...x, ends: { ...x.ends, [node]: v as EndType } }))} />
      )}
      {std && (
        <Field label="End take-off (to the end of the fitting)" value={endT} parse={parseLength} placeholder={std.len != null ? formatFracIn(std.len, prefs) : 'none'}
          hint={d.endLen?.[node] != null ? 'your take-off — clear it to use the standard one' : std.len != null ? std.src : 'enter it if the line is dimensioned to the end of this fitting'}
          onChange={(v) => { setEndT(v); const r = tryParse(parseLength, v); update((x) => { const e = { ...(x.endLen ?? {}) }; if (!v.trim()) delete e[node]; else if (r && r.ok && r.v >= 0) e[node] = r.v; return { ...x, endLen: e }; }, 'endlen' + node); }} />
      )}
      <Field label="Note at this point" value={noteText} onChange={setNoteText} placeholder="e.g. TIE-IN TO EXIST. HDR" />
      <button className="btn" disabled={!noteText.trim()} onClick={() => { update((x) => ({ ...x, notes: [...x.notes, { id: uid(), node, text: noteText.trim() }] })); setNoteText(''); }}>Add note</button>
      {d.notes.filter((t) => t.node === node).map((t) => (
        <div key={t.id} className="row-between"><span>{t.text}</span><button className="chip danger" onClick={() => update((x) => ({ ...x, notes: x.notes.filter((q) => q.id !== t.id) }))}>Remove</button></div>
      ))}
    </Card>
  );
}

// ------------------------------------------------------------------ panels
function CutPanel({ d, cuts, prefs, onShare }: { d: IsoDrawing; cuts: ReturnType<typeof cutList>; prefs: Prefs; onShare: (t: string) => void }) {
  cuts = cuts.filter((c) => !c.skip);
  const sizes = runSizes(d);
  const sz = (i: number) => (sizes[i] !== d.nps ? ` · ${sizes[i]}"` : '');
  if (!cuts.length) return <Card><p className="lead">Draw some lines to see the cut list.</p></Card>;
  const total = cuts.reduce((s, c) => s + (c.pieces ? c.pieces.reduce((t, q) => t + (q.ok ? q.cut : 0), 0) : c.ok ? c.cut : 0), 0);
  const L = (i: number) => String.fromCharCode(97 + i);
  const missing = cuts.filter((c) => Number.isNaN(c.travel)).length;
  const text = [`${d.name} — ${d.nps}" pipe, gap ${formatFracIn(d.gap, prefs)}`,
    ...cuts.map((c) => `Line ${c.run + 1} ${describeRun(d.runs[c.run])}${sz(c.run)}: ${Number.isNaN(c.travel) ? 'NO DIMENSION' : `${runRef(d, c.run)} ${formatFtIn(shownLength(d, c.run), prefs)}, ${c.pieces ? c.pieces.map((q, k) => `${c.run + 1}${L(k)} ${q.from}→${q.to} CUT ${Number.isNaN(q.cut) ? '?' : q.ok ? formatFtIn(q.cut, prefs) : 'IMPOSSIBLE'}`).join(', ') : `CUT ${c.ok ? formatFtIn(c.cut, prefs) : 'IMPOSSIBLE'}`}`}${c.note.length && !Number.isNaN(c.travel) ? ' (' + c.note.join('; ') + ')' : ''}`),
    `Total pipe ${formatFtIn(total, prefs)}${missing ? ` (+ ${missing} undimensioned)` : ''}`].join('\n');
  return (
    <Card>
      <h4>Cut list · {d.nps}" · gap {formatFracIn(d.gap, prefs)}</h4>
      <div className="tablewrap">
        <table className="dtable">
          <thead><tr><th>Line</th><th>Length</th><th>Deduct</th><th>Cut</th></tr></thead>
          <tbody>{cuts.map((c) => Number.isNaN(c.travel) ? (
            <tr key={c.run} className="todo"><th>{c.run + 1}<small> {describeRun(d.runs[c.run])}{sz(c.run)}</small></th><td colSpan={3}>needs dimension</td></tr>
          ) : (
            c.pieces ? (
              <React.Fragment key={c.run}>
                <tr><th>{c.run + 1}<small> {describeRun(d.runs[c.run])}{sz(c.run)}</small></th><td>{formatFtIn(c.travel, prefs)} {runRef(d, c.run)}</td><td colSpan={2} className="muted">{c.pieces.length} spools</td></tr>
                {c.pieces.map((q, k) => (
                  <tr key={k} className={'piece' + (Number.isNaN(q.cut) ? ' todo' : q.ok ? '' : ' bad')}><th>{c.run + 1}{L(k)}<small> {q.from} → {q.to}</small></th><td colSpan={2}></td><td><b>{Number.isNaN(q.cut) ? 'need length' : q.ok ? formatFtIn(q.cut, prefs) : 'impossible'}</b></td></tr>
                ))}
              </React.Fragment>
            ) : (
            <tr key={c.run} className={c.ok ? '' : 'bad'}><th>{c.run + 1}<small> {describeRun(d.runs[c.run])}{sz(c.run)}</small></th><td>{formatFtIn(shownLength(d, c.run), prefs)} {runRef(d, c.run)}</td><td>{c.ok ? formatFracIn(shownLength(d, c.run) - c.cut, prefs) : ''}</td><td><b>{c.ok ? formatFtIn(c.cut, prefs) : Number.isNaN(c.cut) ? 'need length' : 'impossible'}</b></td></tr>
            )
          ))}</tbody>
        </table>
      </div>
      {cuts.some((c) => c.note.length && !Number.isNaN(c.travel)) && <ul className="fhint">{cuts.filter((c) => c.note.length && !Number.isNaN(c.travel)).map((c) => <li key={c.run}>Line {c.run + 1}: {c.note.join('; ')}</li>)}</ul>}
      {(() => {
        // pipe to order, by size, when the drawing has more than one size
        const by: Record<string, number> = {};
        cuts.forEach((c) => { const v = c.pieces ? c.pieces.reduce((t, q) => t + (q.ok ? q.cut : 0), 0) : c.ok ? c.cut : 0; by[sizes[c.run]] = (by[sizes[c.run]] ?? 0) + v; });
        const ks = Object.keys(by);
        return ks.length > 1 ? <p className="bysize">{ks.map((k) => <span key={k}><b>{k}"</b> {formatFtIn(by[k], prefs)}</span>)}</p> : null;
      })()}
      <p><b>Total pipe: {formatFtIn(total, prefs)}</b>{missing ? <span className="muted"> · {missing} line{missing > 1 ? 's' : ''} still need a dimension</span> : null}</p>
      <p className="fhint">Deduct = what comes off the length shown: fitting take-outs, root gaps, flanges and gaskets (or what threads / sockets add back).</p>
      <Msg kind="info">Each length says what it measures to: C = fitting center, F = flange face, E = pipe or fitting end. Take-outs use ASME B16.9 butt-weld fittings in {d.nps}" (long-radius elbows and straight tees unless you picked another fitting at a point). Valves and fittings on a line split it into spools: each is cut between the fitting faces, less its length (B16.10 for flanged valves at the flange class in Setup, or your length) and adjusted for the joint — root gap, WN flange + gasket, thread makeup or socket engagement. Tap a fitting to enter your manufacturer's length.</Msg>
      <button className="btn" onClick={() => onShare(text)}>Copy / share cut list</button>
    </Card>
  );
}

function Library({ store, setStore, onOpen }: { store: IsoStore; setStore: (f: (s: IsoStore) => IsoStore) => void; onOpen: (id: string) => void }) {
  const [armed, setArmed] = useState<string | null>(null);
  return (
    <Card>
      <button className="btn primary" onClick={() => { const d = newDrawing(`Iso ${store.drawings.length + 1}`, uid()); setStore((s) => ({ drawings: [d, ...s.drawings], current: d.id })); onOpen(d.id); }}>New drawing</button>
      {store.drawings.map((x) => (
        <div key={x.id} className={'item' + (x.id === store.current ? ' cur' : '')}>
          <div className="ihead"><b>{x.name}{x.done && <span className="badge ok">Complete</span>}</b><span className="muted">{x.runs.length} lines · {new Date(x.updated).toLocaleDateString()}</span></div>
          <div className="iact">
            <button className="chip" onClick={() => onOpen(x.id)}>Open</button>
            <button className="chip" onClick={() => { const c = { ...JSON.parse(JSON.stringify(x)), id: uid(), name: x.name + ' copy', created: Date.now(), updated: Date.now() }; setStore((s) => ({ ...s, drawings: [c, ...s.drawings] })); }}>Duplicate</button>
            {armed === x.id
              ? <><button className="chip danger" onClick={() => { setStore((s) => { const ds = s.drawings.filter((q) => q.id !== x.id); return { drawings: ds, current: s.current === x.id ? ds[0]?.id ?? null : s.current }; }); setArmed(null); }}>Delete for good</button><button className="chip" onClick={() => setArmed(null)}>Cancel</button></>
              : <button className="chip danger" onClick={() => setArmed(x.id)}>Delete</button>}
          </div>
        </div>
      ))}
      <p className="fhint">Drawings are saved on this device as you work. Rename one with ⋮ → Name Drawing; Complete locks it as an 11×17 sheet.</p>
    </Card>
  );
}

function SetupPanel({ d, disp, opts, prefs, update, toast }: { d: IsoDrawing; disp: { P: Vec3[]; vecs: Vec3[] }; opts: Opts; prefs: Prefs; update: (f: (d: IsoDrawing) => IsoDrawing, mergeKey?: string) => void; toast: (m: string) => void }) {
  const [gap, setGap] = useState(formatFracIn(d.gap, prefs));
  const [gk, setGk] = useState(formatFracIn(d.gasket ?? 0.125, prefs));
  useEffect(() => setGap(formatFracIn(d.gap, prefs)), [d.id]);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 480, H = 340;
  const pts = disp.P.map((p) => project(p, opts.view));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = Math.min((W - 120) / Math.max(40, x1 - x0), (H - 100) / Math.max(40, y1 - y0));
  const T3 = (p: Vec3): [number, number] => { const q = project(p, opts.view); return [(q[0] - (x0 + x1) / 2) * s + W / 2 + 20, (q[1] - (y0 + y1) / 2) * s + H / 2 - 4]; };
  return (
    <Card>
      <Grid>
        <Select label="Pipe size (for take-outs)" value={d.nps} options={Object.keys(B169).map((n) => [n, `${n}" NPS`])} onChange={(v) => update((x) => ({ ...x, nps: v }))} />
        <Select label="Default joint (elbows, tees, couplings)" value={d.conn ?? 'bw'} options={CONN_ORDER.map((c) => [c, CONN_LABEL[c]])} onChange={(v) => update((x) => ({ ...x, conn: v as Conn }))} />
        <Select label="Flange class (flanged valves, flanges)" value={String(d.cls ?? 150)} options={FLANGE_CLASSES.map((c) => [String(c), `Class ${c}`])} onChange={(v) => update((x) => ({ ...x, cls: Number(v) as FlangeClass }))} />
        <Field label="Gasket thickness" value={gk} parse={parseLength} onChange={(v) => { setGk(v); const r = tryParse(parseLength, v); if (r && r.ok && r.v >= 0 && r.v < 1) update((x) => ({ ...x, gasket: r.v }), 'gasket'); }} />
        <Field label="Butt-weld root gap" value={gap} parse={parseLength} hint="used at every butt weld in the cut list"
          onChange={(v) => { setGap(v); const r = tryParse(parseLength, v); if (r && r.ok && r.v >= 0 && r.v < 1) update((x) => ({ ...x, gap: r.v })); }} />
      </Grid>
      <p className="fhint">Take-outs use ASME B16.9 long-radius elbows (90°, 45°, other angles cut from a 90°) and straight tees for the selected size. The image uses the current view.</p>
      <button className="btn primary" onClick={() => svgRef.current && shareImage(d, svgRef.current.outerHTML, W, H).then((m) => m && toast(m))}>Share drawing as image</button>
      <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={W * 3} height={H * 3} viewBox={`0 0 ${W} ${H}`} style={{ display: 'none' }}>
        <rect width={W} height={H} fill="#fff" />
        <HatchDefs />
        <IsoArt d={d} disp={disp} T3={T3} sel={null} cursor={-1} opts={opts} prefs={prefs} exportMode />
        <Compass x={36} y={36} view={opts.view} />
        <text x={10} y={H - 10} style={{ font: '700 10px sans-serif', fill: '#111' }}>{d.name} · {d.nps}" NPS · Ridgecrest Pipe Calculator</text>
      </svg>
    </Card>
  );
}
const EXPORT_CSS = `.iso-pipe{stroke:#111;stroke-width:2.6;stroke-linecap:round}.iso-hit{stroke:none}.iso-sym{fill:#fff;stroke:#111;stroke-width:1.3}.iso-sym.thick{stroke-width:2.4}.iso-symfill{fill:#111}.iso-weld{fill:#111}.iso-dim{font:700 10px sans-serif;fill:#0a4f4a;paint-order:stroke;stroke:#fff;stroke-width:3.2px;stroke-linejoin:round}.iso-legdim{font:700 8.5px sans-serif;fill:#333;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}.iso-note{font:600 8px sans-serif;fill:#111}.iso-node{font:600 7px sans-serif;fill:#666}.iso-leader{stroke:#666;stroke-width:.6}.iso-off{fill:none;stroke:#777;stroke-width:.9;stroke-dasharray:4 3}.iso-hatch{stroke:none}.iso-hatchline{stroke:#999;stroke-width:.8}.cmp-ring{fill:#fff;stroke:#bbb}.cmp-n{stroke:#1f7f7a;stroke-width:2.2}.cmp-head{fill:#1f7f7a}.cmp-dir{stroke:#999;stroke-width:1.2}.cmp-up{stroke:#bbb;stroke-width:1;stroke-dasharray:2 2}.cmp-t{font:700 9px sans-serif;fill:#777}.cmp-t.n{fill:#1f7f7a}.iso-gap{stroke:#fff;stroke-width:6}.nofill{fill:none}.iso-symball{fill:#fff;stroke:#111;stroke-width:1.2}.iso-symtext{font:800 6px sans-serif;fill:#111}.iso-fit{font:800 7.5px sans-serif;fill:#1f7f7a}.iso-equip{fill:#eee;stroke:#111;stroke-width:1.1}.iso-olet{fill:#bbb;stroke:#111;stroke-width:1.2}.iso-dimsub{font:700 8.5px sans-serif;fill:#333;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round}.iso-dimtick{stroke:#1f7f7a;stroke-width:.8}.iso-pipe.nofill{fill:none}.iso-wlead{stroke:#b4232a;stroke-width:.6}.iso-wdot{fill:#b4232a}.iso-wbox{fill:#fff;stroke:#b4232a;stroke-width:.8}.iso-wtag.field .iso-wbox{stroke-dasharray:2 1.2}.iso-wtxt{font:800 6.4px sans-serif;fill:#b4232a}.iso-wsten{font:700 6.5px sans-serif;fill:#555}.iso-whit{fill:transparent}.iso-textnote{font:700 9px sans-serif;fill:#111}.iso-textbox{fill:none;stroke:none}`;

async function shareImage(d: IsoDrawing, markup: string, W: number, H: number, scale = 3): Promise<string> {
  const svg = markup.replace(/ style="display: ?none;?"/, '').replace(/^(<svg[^>]*>)/, `$1<style>${EXPORT_CSS}</style>`);
  const blob = await new Promise<Blob | null>((res) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = W * scale; c.height = H * scale; const g2 = c.getContext('2d')!; g2.fillStyle = '#fff'; g2.fillRect(0, 0, c.width, c.height); g2.drawImage(img, 0, 0, W * scale, H * scale); c.toBlob((b) => res(b), 'image/png'); };
    img.onerror = () => res(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  if (!blob) return 'Could not create the image';
  const file = new File([blob], `${d.name.replace(/[^\w-]+/g, '_') || 'iso'}.png`, { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: d.name }); return 'Shared'; }
  } catch (e) { if ((e as Error).name === 'AbortError') return ''; }
  try {
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    return 'Image saved';
  } catch { return 'Sharing images is not available here'; }
}

// ------------------------------------------------------------------ weld map, text notes, dialogs
function WeldPop({ d, w, num, update, onClose }: { d: IsoDrawing; w: Weld; num: number; update: (f: (d: IsoDrawing) => IsoDrawing, mergeKey?: string) => void; onClose: () => void }) {
  const info: WeldInfo = d.welds?.[w.key] ?? {};
  const set = (p: Partial<WeldInfo>, mk?: string) => update((x) => ({ ...x, welds: { ...(x.welds ?? {}), [w.key]: { ...(x.welds?.[w.key] ?? {}), ...p } } }), mk);
  const where = { fitting: 'fitting weld', inline: 'valve / fitting weld', joint: 'pipe-to-pipe weld', end: 'end fitting weld', reducer: 'reducer-to-elbow weld' }[w.where];
  return (
    <div className="itemmenu-in weldpop">
      <div className="row-between"><b>{info.field ? 'FW' : 'W'}{num} · {w.conn === 'sw' ? 'Socket weld' : 'Butt weld'}</b><button className="linkbtn" onClick={onClose}>Done</button></div>
      <span className="fhint">Point {w.node}, line {w.run + 1} — {where}</span>
      <label className="field"><span className="flabel">Welder stencil</span>
        <span className="finput"><input value={info.stencil ?? ''} placeholder="e.g. RC-12" autoCapitalize="characters" autoCorrect="off" spellCheck={false} onChange={(e) => set({ stencil: e.target.value }, 'wst' + w.key)} /></span></label>
      <Segmented small value={info.field ? 'field' : 'shop'} onChange={(v) => set({ field: v === 'field' })} options={[['shop', 'Shop weld'], ['field', 'Field weld']]} />
      <label className="field"><span className="flabel">Notes</span>
        <textarea className="isotext" rows={3} value={info.notes ?? ''} placeholder="Rod, process, inspection, date…" onChange={(e) => set({ notes: e.target.value }, 'wno' + w.key)} /></label>
    </div>
  );
}

function TextPop({ text, onText, onDelete, onClose }: { text: string; onText: (v: string) => void; onDelete: () => void; onClose: () => void }) {
  return (
    <div className="itemmenu-in">
      <div className="row-between"><b>Text note</b><button className="linkbtn" onClick={onClose}>Done</button></div>
      <textarea className="isotext" rows={3} autoFocus value={text} placeholder="Type the note…" onChange={(e) => onText(e.target.value)} />
      <span className="fhint">Drag the note on the drawing to move it.</span>
      <button className="btn danger" onClick={onDelete}>Delete note</button>
    </div>
  );
}

function IsoModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return createPortal(
    <div className="isomodal" onClick={onClose}>
      <div className="isomodal-card" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row-between"><h3>{title}</h3><button className="chip" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>, document.body);
}

function NameModal({ title, name, action, note, onSave, onClose }: { title: string; name: string; action: string; note?: string; onSave: (n: string) => void; onClose: () => void }) {
  const [v, setV] = useState(name);
  const ok = v.trim().length > 0;
  return (
    <IsoModal title={title} onClose={onClose}>
      {note && <p className="fhint">{note}</p>}
      <label className="field"><span className="flabel">Drawing name</span>
        <span className="finput"><input value={v} autoFocus onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ok) onSave(v.trim()); }} /></span></label>
      <button className="btn primary" disabled={!ok} onClick={() => onSave(v.trim())}>{action}</button>
    </IsoModal>
  );
}

// ------------------------------------------------------------------ completed drawing: 11×17 sheet
const SW = 1700, SH = 1100; // 17" × 11" in hundredths of an inch
type TRow = Array<string>;
function svgTable(key: string, x: number, y: number, w: number, hMax: number, title: string, cols: Array<{ h: string; w: number; r?: boolean }>, rows0: TRow[]): React.ReactNode {
  const head = 30;
  let rh = Math.min(24, (hMax - head) / Math.max(1, rows0.length + 1));
  let rows = rows0;
  if (rh < 13) { rh = 13; const fit = Math.floor((hMax - head) / rh) - 2; rows = [...rows0.slice(0, fit), [`… ${rows0.length - fit} more (see shared cut list)`]]; }
  const fs = Math.max(9, rh * 0.6);
  const xs: number[] = []; let acc = x; cols.forEach((c) => { xs.push(acc); acc += c.w * w; });
  const out: React.ReactNode[] = [];
  out.push(<rect key="b" x={x} y={y} width={w} height={head + rh * (rows.length + 1) + 4} fill="#fff" stroke="#111" strokeWidth={1.5} />);
  out.push(<rect key="tb" x={x} y={y} width={w} height={head} fill="#1f3b3a" />);
  out.push(<text key="t" x={x + 10} y={y + head * 0.68} fill="#fff" style={{ font: '800 17px sans-serif', letterSpacing: '1px' }}>{title}</text>);
  const y1 = y + head;
  out.push(<rect key="hb" x={x} y={y1} width={w} height={rh} fill="#e8efee" />);
  cols.forEach((c, k) => out.push(<text key={'h' + k} x={c.r ? xs[k] + c.w * w - 6 : xs[k] + 6} y={y1 + rh * 0.7} textAnchor={c.r ? 'end' : 'start'} style={{ font: `800 ${fs}px sans-serif`, fill: '#333' }}>{c.h}</text>));
  rows.forEach((r, i) => {
    const yy = y1 + rh * (i + 1);
    if (i % 2) out.push(<rect key={'z' + i} x={x} y={yy} width={w} height={rh} fill="#f6f8f8" />);
    out.push(<line key={'l' + i} x1={x} x2={x + w} y1={yy} y2={yy} stroke="#ccd" strokeWidth={0.6} />);
    r.forEach((cell, k) => {
      const c = cols[k] ?? cols[0];
      const maxCh = r.length === 1 ? 200 : Math.floor((c.w * w - 10) / (fs * 0.55));
      const txt = cell.length > maxCh ? cell.slice(0, Math.max(1, maxCh - 1)) + '…' : cell;
      out.push(<text key={'c' + i + '-' + k} x={c.r ? xs[k] + c.w * w - 6 : xs[k] + 6} y={yy + rh * 0.7} textAnchor={c.r ? 'end' : 'start'} style={{ font: `${k === 0 ? 700 : 500} ${fs}px sans-serif`, fill: '#111' }}>{txt}</text>);
    });
  });
  return <g key={key}>{out}</g>;
}

function sheetData(d: IsoDrawing, prefs: Prefs) {
  const sizes = runSizes(d);
  const cuts = cutList(d).filter((c) => !c.skip);
  const L = (i: number) => String.fromCharCode(97 + i);
  const cutRows: TRow[] = [];
  cuts.forEach((c) => {
    const base = `${c.run + 1}`;
    if (Number.isNaN(c.travel)) { cutRows.push([base, `${describeRun(d.runs[c.run])} · ${sizes[c.run]}"`, 'no dimension', '—']); return; }
    if (c.pieces) c.pieces.forEach((q, k) => cutRows.push([base + L(k), `${q.from} → ${q.to} · ${sizes[c.run]}"`, k === 0 ? `${formatFtIn(c.travel, prefs)} ${runRef(d, c.run)}` : '', Number.isNaN(q.cut) ? 'need length' : q.ok ? formatFtIn(q.cut, prefs) : 'IMPOSSIBLE']));
    else cutRows.push([base, `${describeRun(d.runs[c.run])} · ${sizes[c.run]}"`, `${formatFtIn(shownLength(d, c.run), prefs)} ${runRef(d, c.run)}`, c.ok ? formatFtIn(c.cut, prefs) : Number.isNaN(c.cut) ? 'need length' : 'IMPOSSIBLE']);
  });
  const total = cuts.reduce((s, c) => s + (c.pieces ? c.pieces.reduce((t, q) => t + (q.ok ? q.cut : 0), 0) : c.ok ? c.cut : 0), 0);
  const mat = materials(d).map((m): TRow => [m.item, m.size ? (m.size.includes('×') ? m.size.split('×').map((z) => z + '"').join('×') : m.size + '"') : '', m.spec, m.unit === 'ft' ? formatFtIn(m.qty * 12, prefs) : String(m.qty)]);
  const wl = weldList(d);
  const weldRows: TRow[] = wl.map((w, j) => { const i = d.welds?.[w.key]; return [`${i?.field ? 'FW' : 'W'}${j + 1}`, w.conn === 'sw' ? 'SW' : 'BW', i?.field ? 'Field' : 'Shop', i?.stencil ?? '', i?.notes ?? '']; });
  return { cutRows, total, mat, weldRows, wl };
}

function SheetSvg({ d, opts, prefs, svgRef, welds: showWelds = true, vb }: { d: IsoDrawing; opts: Opts; prefs: Prefs; svgRef?: React.Ref<SVGSVGElement>; welds?: boolean; vb?: string }) {
  const view = opts.view;
  const disp = displayPositions(d, opts.scaled);
  const { cutRows, total, mat, weldRows: weldRows0, wl } = sheetData(d, prefs);
  const weldRows = showWelds ? weldRows0 : [];
  const M = 25;
  const RX = 1215, RW = SW - M - 10 - RX; // right column
  const DX = M + 10, DY = M + 10, DW = RX - 10 - DX; // drawing area
  const cutH = Math.min(380, 70 + cutRows.length * 22);
  const DH = SH - M - 10 - DY - cutH - 10;
  const KK = 2.3; // drawing symbols / text scaled up for the sheet
  const pts = [...disp.P, ...(d.texts ?? []).filter((t) => disp.P[t.node]).map((t) => add(disp.P[t.node], mul(t.off, disp.k || 1)))].map((p) => project(p, view));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const aw = DW / KK - 90, ah = DH / KK - 80;
  const sc = Math.min(aw / Math.max(30, x1 - x0), ah / Math.max(30, y1 - y0));
  const T3 = (p: Vec3): [number, number] => { const q = project(p, view); return [(q[0] - (x0 + x1) / 2) * sc + DW / KK / 2, (q[1] - (y0 + y1) / 2) * sc + DH / KK / 2 + 6]; };
  // iso paper (30° / 150° / vertical) behind the drawing
  const grid: React.ReactNode[] = [];
  const gs = 40, t30 = Math.tan(Math.PI / 6);
  for (let x = DX; x <= DX + DW; x += gs / (2 * t30)) grid.push(<line key={'v' + x} x1={x} x2={x} y1={DY} y2={DY + DH} />);
  for (let c = -DW; c <= DH + DW; c += gs) {
    grid.push(<line key={'a' + c} x1={DX} y1={DY + c} x2={DX + DW} y2={DY + c - DW * t30} />);
    grid.push(<line key={'b' + c} x1={DX} y1={DY + c - DW * t30} x2={DX + DW} y2={DY + c} />);
  }
  const shop = wl.filter((w) => !d.welds?.[w.key]?.field).length, field = wl.length - shop;
  const date = new Date(d.doneAt ?? d.updated).toLocaleDateString();
  // right column: material, weld log, title block
  const TB = 190, tbY = SH - M - 10 - TB;
  const matH = Math.min(tbY - DY - 10 - (weldRows.length ? 150 : 0), 34 + (mat.length + 1) * 24 + 4);
  const weldY = DY + matH + 12, weldH = tbY - 12 - weldY;
  // cut list: one or two tables side by side under the drawing
  const cutY = DY + DH + 10;
  const two = cutRows.length > Math.floor((cutH - 34) / 20) - 1 && cutRows.length > 8;
  const half = Math.ceil(cutRows.length / 2);
  const cutCols = [{ h: 'Line', w: 0.11 }, { h: 'Run · size', w: 0.39 }, { h: 'Length', w: 0.27 }, { h: 'Cut', w: 0.23, r: true }];
  return (
    <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={vb ?? `0 0 ${SW} ${SH}`} className="isosheet" role="img" aria-label={`${d.name} iso sheet`}>
      <style>{EXPORT_CSS}</style>
      <rect width={SW} height={SH} fill="#fff" />
      <rect x={M} y={M} width={SW - 2 * M} height={SH - 2 * M} fill="none" stroke="#111" strokeWidth={3} />
      <defs><clipPath id="sheetclip"><rect x={DX} y={DY} width={DW} height={DH} /></clipPath></defs>
      <g clipPath="url(#sheetclip)" stroke="#d3e4e2" strokeWidth={0.8}>{grid}</g>
      <rect x={DX} y={DY} width={DW} height={DH} fill="none" stroke="#111" strokeWidth={1.2} />
      <g clipPath="url(#sheetclip)"><g transform={`translate(${DX} ${DY}) scale(${KK})`}>
        <HatchDefs />
        <IsoArt d={d} disp={disp} T3={T3} sel={null} cursor={-1} opts={{ dims: true, welds: true, labels: false, weldmap: showWelds }} prefs={prefs} exportMode />
        <Compass x={36} y={36} view={view} />
      </g></g>
      <text x={DX + DW - 12} y={DY + 26} textAnchor="end" style={{ font: '800 20px sans-serif', fill: '#1f3b3a', letterSpacing: '2px' }}>ISOMETRIC</text>
      {two
        ? <>{svgTable('cut1', DX, cutY, DW / 2 - 6, cutH, 'CUT LIST', cutCols, cutRows.slice(0, half))}{svgTable('cut2', DX + DW / 2 + 6, cutY, DW / 2 - 6, cutH, `CUT LIST (cont.) · TOTAL ${formatFtIn(total, prefs)}`, cutCols, cutRows.slice(half))}</>
        : svgTable('cut', DX, cutY, DW, cutH, `CUT LIST · TOTAL PIPE ${formatFtIn(total, prefs)}`, cutCols, cutRows)}
      {svgTable('mat', RX, DY, RW, matH, 'MATERIAL', [{ h: 'Item', w: 0.42 }, { h: 'Size', w: 0.17 }, { h: 'Spec', w: 0.27 }, { h: 'Qty', w: 0.14, r: true }], mat.length ? mat : [['No material yet']])}
      {weldRows.length > 0 && svgTable('weld', RX, weldY, RW, weldH, `WELD LOG · ${shop} SHOP / ${field} FIELD`, [{ h: 'Weld', w: 0.13 }, { h: 'Type', w: 0.11 }, { h: 'S/F', w: 0.13 }, { h: 'Stencil', w: 0.2 }, { h: 'Notes', w: 0.43 }], weldRows)}
      <g>
        <rect x={RX} y={tbY} width={RW} height={TB} fill="#fff" stroke="#111" strokeWidth={2} />
        <rect x={RX} y={tbY} width={RW} height={44} fill="#1f3b3a" />
        <text x={RX + 14} y={tbY + 30} style={{ font: '900 23px sans-serif', fill: '#fff', letterSpacing: '1.5px' }}>RIDGECREST INDUSTRIES</text>
        {[['DRAWING', d.name], ['SIZE', `${d.nps}" NPS · Class ${d.cls ?? 150} · gap ${formatFracIn(d.gap, prefs)}`], ['JOINT', CONN_LABEL[d.conn ?? 'bw']], ['DATE', date], ['STATUS', `COMPLETE · ${d.runs.filter((r) => !r.move).length} lines · ${wl.length} welds${showWelds ? '' : ' (map off)'}`]].map(([k, v], i) => (
          <g key={k}>
            <line x1={RX} x2={RX + RW} y1={tbY + 44 + i * 29} y2={tbY + 44 + i * 29} stroke="#ccd" />
            <text x={RX + 12} y={tbY + 64 + i * 29} style={{ font: '800 12px sans-serif', fill: '#666' }}>{k}</text>
            <text x={RX + 100} y={tbY + 64 + i * 29} style={{ font: `${i === 0 ? 800 : 600} ${i === 0 ? 17 : 14}px sans-serif`, fill: i === 4 ? '#1f7f3a' : '#111' }}>{v.length > 44 ? v.slice(0, 43) + '…' : v}</text>
          </g>
        ))}
      </g>
      <text x={M + 4} y={SH - 8} style={{ font: '600 11px sans-serif', fill: '#888' }}>11" × 17" iso sheet · Ridgecrest Pipe Calculator · not to scale unless dimensioned</text>
    </svg>
  );
}

type VB = { x: number; y: number; w: number };
function SheetView({ d, opts, prefs, toast }: { d: IsoDrawing; opts: Opts; prefs: Prefs; toast: (m: string) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [showWelds, setShowWelds] = usePersistent<boolean>('isosheetwelds', true);
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [size, setSize] = useState({ w: 360, h: 233 });
  useEffect(() => { const f = () => setWin({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(1, el.clientWidth), h: Math.max(1, el.clientHeight) }));
    ro.observe(el);
    // iOS: keep Safari's own page zoom out of it while fingers are on the sheet
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener('gesturestart', stop); el.addEventListener('gesturechange', stop);
    return () => { ro.disconnect(); el.removeEventListener('gesturestart', stop); el.removeEventListener('gesturechange', stop); };
  }, [full]);
  // camera = the part of the sheet shown (a viewBox), so it stays sharp at any zoom
  const fit = (): VB => {
    const a = size.h / size.w;
    if (SH / SW > a) { const w = SH / a; return { x: (SW - w) / 2, y: 0, w }; }
    return { x: 0, y: (SH - SW * a) / 2, w: SW };
  };
  const [vb, setVb] = useState<VB>({ x: 0, y: 0, w: SW });
  useEffect(() => setVb(fit()), [size.w, size.h]);
  const clamp = (v: VB): VB => {
    const f = fit(); const w = Math.max(f.w / 12, Math.min(f.w, v.w)), h = (w * size.h) / size.w;
    const cx = (lo: number, hi: number, x: number) => Math.max(Math.min(lo, hi), Math.min(Math.max(lo, hi), x));
    return { w, x: cx(0, SW - w, v.x), y: cx(0, SH - h, v.y) };
  };
  const vbStr = `${vb.x} ${vb.y} ${vb.w} ${(vb.w * size.h) / size.w}`;
  const rot = full && win.h > win.w;
  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    if (rot) return { x: ((e.clientY - r.top) / r.height) * size.w, y: ((r.right - e.clientX) / r.width) * size.h };
    return { x: ((e.clientX - r.left) / r.width) * size.w, y: ((e.clientY - r.top) / r.height) * size.h };
  };
  const zoomAt = (k: number, p: { x: number; y: number }, from: VB = vb) => {
    const sx = from.x + (p.x * from.w) / size.w, sy = from.y + (p.y * from.w) / size.w;
    const w = from.w / k;
    setVb(clamp({ w, x: sx - (p.x * w) / size.w, y: sy - (p.y * w) / size.w }));
  };
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef<{ vb: VB; p: Array<{ x: number; y: number }>; moved: boolean } | null>(null);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const start = () => { const p = [...ptrs.current.values()]; g.current = { vb, p, moved: g.current?.moved ?? false }; };
  const onDown = (e: React.PointerEvent) => { try { box.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ } ptrs.current.set(e.pointerId, local(e)); if (ptrs.current.size === 1) g.current = null; start(); };
  const onMove = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId) || !g.current) return;
    ptrs.current.set(e.pointerId, local(e));
    const s = g.current, p = [...ptrs.current.values()];
    if (p.length >= 2 && s.p.length >= 2) {
      // pinch: zoom about the fingers, and pan with them
      const d0 = Math.hypot(s.p[0].x - s.p[1].x, s.p[0].y - s.p[1].y) || 1, d1 = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const m0 = { x: (s.p[0].x + s.p[1].x) / 2, y: (s.p[0].y + s.p[1].y) / 2 }, m1 = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      const sx = s.vb.x + (m0.x * s.vb.w) / size.w, sy = s.vb.y + (m0.y * s.vb.w) / size.w;
      const w = s.vb.w / (d1 / d0);
      setVb(clamp({ w, x: sx - (m1.x * w) / size.w, y: sy - (m1.y * w) / size.w }));
      s.moved = true;
    } else if (p.length === 1 && s.p.length === 1) {
      const dx = p[0].x - s.p[0].x, dy = p[0].y - s.p[0].y;
      if (Math.hypot(dx, dy) > 4) s.moved = true;
      if (s.moved) setVb(clamp({ w: s.vb.w, x: s.vb.x - (dx * s.vb.w) / size.w, y: s.vb.y - (dy * s.vb.w) / size.w }));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const p = ptrs.current.get(e.pointerId);
    ptrs.current.delete(e.pointerId);
    const wasMoved = g.current?.moved;
    if (ptrs.current.size) { start(); if (g.current) g.current.moved = true; return; }
    g.current = null;
    if (!wasMoved && p && e.type !== 'pointercancel') {
      // double-tap: zoom in there, or back out to the whole sheet
      const now = Date.now(), lt = lastTap.current;
      if (now - lt.t < 320 && Math.hypot(p.x - lt.x, p.y - lt.y) < 30) { if (vb.w < fit().w * 0.95) setVb(fit()); else zoomAt(2.5, p); lastTap.current = { t: 0, x: 0, y: 0 }; }
      else lastTap.current = { t: now, x: p.x, y: p.y };
    }
  };
  const onWheel = (e: React.WheelEvent) => zoomAt(Math.exp(-e.deltaY * 0.0015), local(e));
  const markup = () => (ref.current ? ref.current.outerHTML.replace(/viewBox="[^"]*"/, `viewBox="0 0 ${SW} ${SH}"`).replace('<svg ', `<svg width="${SW}" height="${SH}" `) : '');
  const print = () => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    const doc = f.contentDocument; if (!doc) return;
    doc.open();
    doc.write(`<!doctype html><html><head><title>${d.name.replace(/</g, '')}</title><style>@page{size:17in 11in;margin:0}html,body{margin:0}svg{width:17in;height:11in;display:block}</style></head><body>${markup()}</body></html>`);
    doc.close();
    setTimeout(() => { try { f.contentWindow?.focus(); f.contentWindow?.print(); } catch { toast('Printing is not available here'); } setTimeout(() => f.remove(), 2000); }, 300);
  };
  const share = () => shareImage(d, markup(), SW, SH, 2).then((m) => m && toast(m));
  const mid = { x: size.w / 2, y: size.h / 2 };
  const zoomBar = (
    <div className="sheetbar">
      <button className="ibtn" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.5, mid)}>−</button>
      <button className="ibtn" aria-label="Zoom in" onClick={() => zoomAt(1.5, mid)}>+</button>
      <button className="ibtn" onClick={() => setVb(fit())}>Fit</button>
      {full && <button className="ibtn" onClick={() => setShowWelds(!showWelds)}>{showWelds ? 'Welds: on' : 'Welds: off'}</button>}
      <button className="ibtn" onClick={() => setFull(!full)}>{full ? '✕ Close' : 'Full screen'}</button>
    </div>
  );
  const sheet = (
    <div className="sheetbox" ref={box} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
      <SheetSvg d={d} opts={opts} prefs={prefs} svgRef={ref} welds={showWelds} vb={vbStr} />
      {full && zoomBar}
    </div>
  );
  return (
    <>
      <div className="sheetwrap">{!full && sheet}{!full && zoomBar}</div>
      {full && createPortal(<div className={'sheetfull' + (rot ? ' rot' : '')}><div className="sheetfull-in">{sheet}</div></div>, document.body)}
      <div className="sheetopt">
        <Segmented small value={showWelds ? 'on' : 'off'} onChange={(v) => setShowWelds(v === 'on')} options={[['on', 'Weld map on'], ['off', 'Weld map off']]} />
      </div>
      <div className="chiprow sheetacts">
        <button className="btn primary" onClick={share}>Share as image</button>
        <button className="btn" onClick={print}>Print 11×17</button>
      </div>
      <p className="fhint">Pinch to zoom and drag to move around the sheet; double-tap to zoom in there (double-tap again for the whole sheet). Weld map off hides the weld numbers and the weld log, for a clean drawing to view, share or print. Completed drawings are locked — ✎ Edit (top) reopens it.</p>
    </>
  );
}
