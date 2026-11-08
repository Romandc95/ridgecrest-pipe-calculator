import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Field, Msg, Select, Segmented, Card, Grid, useApp } from './components';
import { usePersistent, uid, shareText } from './store';
import { parseLength, parseAngle, tryParse } from '../engine/parse';
import { formatFtIn, formatFracIn, formatNumber } from '../engine/format';
import {
  IsoDrawing, Run, Inline, INLINE_LABEL, EndType, END_LABEL, DIRS, Vec3, newDrawing, nodeKind, nodeLegs, cutList,
  runLength, runVec, describeRun, isMeasured, sketchVec, View, ISO_VIEW, VIEW_PRESETS, project, unproject, viewBasis, displayPositions, deleteSubtree, splitRun,
  CATALOG, CATALOG_GROUPS, catalogItem, runItems, CatalogItem, Conn, CONN_LABEL, CONN_ORDER, connAt,
} from '../engine/iso';
import { lineSymbol, nodeSymbol, endSymbol, PaletteIcon, jointMark, JointIcon } from './isoSymbols';
import { B169 } from '../engine/fittings';

type Prefs = ReturnType<typeof useApp>['settings']['prefs'];
interface IsoStore { drawings: IsoDrawing[]; current: string | null }
type Sel = { kind: 'node'; id: number } | { kind: 'run'; id: number } | { kind: 'item'; run: number; id: string } | null;
type Mode = 'draw' | 'orbit' | 'pan';
type Plane = 'EN' | 'EU' | 'NU';
interface Opts { dims: boolean; welds: boolean; labels: boolean; scaled: boolean; view: View; mode: Mode; plane: Plane; conn: Conn }
type ArtOpts = Pick<Opts, 'dims' | 'welds' | 'labels'>;

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
    if (item.kind === 'line') {
      if (target.kind !== 'run') { toast(`Drop the ${item.label.toLowerCase()} on a line`); return false; }
      update((x) => ({ ...x, runs: x.runs.map((q, k) => (k === target.id ? { ...q, inline: 'none', items: [...runItems(q), { id: uid(), type: item.id, t, conn: opts.conn }].sort((a, b) => a.t - b.t) } : q)) }));
      setSel({ kind: 'run', id: target.id });
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
  /** New start point: an invisible jump from the current point to where the paper was tapped. */
  const startAt = (v: Vec3 | null) => {
    setArmed(null);
    if (!v) { toast('Tap the paper away from the current point'); return; }
    const s0 = mul(v, 1 / (disp.k || 1));
    addRun({ dx: s0[0], dy: s0[1], dz: s0[2], inline: 'none', sketch: true, move: true });
    toast('New start point — drag from it to draw');
  };
  const onTap = (t: Sel, at?: number) => {
    if (armed === 'start') { if (t?.kind === 'node') { setArmed(null); setCursor(t.id); setSel(t); toast(`Drawing from point ${t.id}`); } return; }
    if (armed?.startsWith('move:')) {
      const [, fr, iid] = armed.split(':');
      setArmed(null);
      if (t && (t.kind === 'run' || t.kind === 'item')) moveItemTo(Number(fr), iid, t.kind === 'run' ? t.id : t.run, at ?? 0.5);
      else toast('Tap a line to move it there');
      return;
    }
    if (armed) { if (t) { if (place(armed, t, at)) setArmed(null); } else setArmed(null); return; }
    setSel(t);
    if (t?.kind === 'node') setCursor(t.id);
    if (t?.kind === 'run') setCursor(t.id + 1);
  };
  const itemSel = sel?.kind === 'item' && d.runs[sel.run] && runItems(d.runs[sel.run]).some((q) => q.id === sel.id) ? sel : null;

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
    : selNode !== null ? <NodeEditor d={d} node={selNode} update={update} onClose={() => setSel(null)} /> : null;

  const tools = (
    <DrawTools opts={opts} setOpts={setOpts} lenText={lenText} setLenText={setLenText} addDir={addDir} undo={undo} canUndo={canUndo} redo={redo} canRedo={canRedo} heading={heading} addOffset={addOffset}
      cur={cur} isBranch={cur !== d.runs.length} missing={missing} compact={full} prefs={prefs} startPoint={() => setArmed(armed === 'start' ? null : 'start')} placingStart={armed === 'start'} />
  );
  const palette = <Palette conn={opts.conn} setConn={(c) => setOpts({ conn: c })} armed={armed} setArmed={setArmed} drop={(key, cx, cy) => { const h = canvasApi.current?.hitAt(cx, cy); if (!h) { toast('Drop it on a line or a point of the drawing'); return; } place(key, h.sel, h.t); }} compact={full} />;

  const stage = (
    <IsoCanvas d={d} disp={disp} opts={opts} prefs={prefs} cursor={cur} sel={sel} rot={rot} fitTick={fitTick} armed={armed} apiRef={canvasApi} onPick={startAt}
      onItemDrag={(run, id, t) => setItem(run, id, (q) => (q.id === id ? { ...q, t } : q), 'drag' + id)}
      menu={itemSel ? { run: itemSel.run, t: runItems(d.runs[itemSel.run]).find((q) => q.id === itemSel.id)!.t,
        node: <ItemMenu item={runItems(d.runs[itemSel.run]).find((q) => q.id === itemSel.id)!} onClose={() => setSel(null)}
          onMove={() => { setArmed(`move:${itemSel.run}:${itemSel.id}`); setSel(null); }}
          onChange={(type) => setItem(itemSel.run, itemSel.id, (q) => (q.id === itemSel.id ? { ...q, type } : q))}
          onConn={(c) => setItem(itemSel.run, itemSel.id, (q) => (q.id === itemSel.id ? { ...q, conn: c } : q))}
          onDelete={() => { setItem(itemSel.run, itemSel.id, (q) => (q.id === itemSel.id ? null : q)); setSel(null); }} /> } : null}
      startOn={armed === 'start'} onStartBtn={() => setArmed(armed === 'start' ? null : 'start')} onNotice={toast}
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
      {armed && <div className="isoarmed">{armed === 'start' ? 'Tap the paper for the new start point' : armed.startsWith('move:') ? 'Tap a line where it should go' : `Tap where the ${CONN_LABEL[opts.conn].toLowerCase()} ${catalogItem(armed.split(':')[1], armed.split(':')[0] as CatalogItem['kind'])?.label.toLowerCase()} goes`} · <button className="linkbtn" onClick={() => setArmed(null)}>cancel</button></div>}
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

  return (
    <div className="tool iso">
      <div className="isohead">
        <input className="isoname" value={d.name} aria-label="Drawing name" onChange={(e) => update((x) => ({ ...x, name: e.target.value }), 'name')} />
        <span className="muted">{d.nps}" · {d.runs.filter((r) => !r.move).length} lines</span>
      </div>
      {stage}
      {editor}
      {palette}
      {tools}
      <Segmented value={panel} onChange={setPanel} options={[['cut', 'Cut list'], ['setup', 'Setup'], ['library', 'Library']]} />
      {panel === 'cut' && <CutPanel d={d} cuts={cuts} prefs={prefs} onShare={async (t) => { const m = await shareText(t); if (m) toast(m); }} />}
      {panel === 'setup' && <SetupPanel d={d} disp={disp} opts={opts} prefs={prefs} update={update} toast={toast} />}
      {panel === 'library' && <Library store={store} setStore={setStore} onOpen={(id) => { setStore((s) => ({ ...s, current: id })); setSel(null); setCursor(0); setFitTick((t) => t + 1); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ fitting menu (tap a fitting on a line)
function ItemMenu({ item, onClose, onMove, onChange, onConn, onDelete }: {
  item: ReturnType<typeof runItems>[number]; onClose: () => void; onMove: () => void; onChange: (type: string) => void; onConn: (c: Conn) => void; onDelete: () => void;
}) {
  const [pane, setPane] = useState<'main' | 'change' | 'joint'>('main');
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
          {armedDel ? <button className="btn danger" onClick={onDelete}>Delete for good</button> : <button className="btn danger" onClick={() => setArmedDel(true)}>✕ Delete</button>}
        </div>
      )}
      {pane === 'main' && <p className="fhint">Or drag it along the line to slide it.</p>}
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

function OffsetPanel({ heading, prefs, onAdd, onClose }: { heading: string; prefs: Prefs; onAdd: (o: OffsetSpec) => void; onClose: () => void }) {
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
      <div className="row-between"><b>Add offset from this point</b><button className="chip" onClick={onClose}>Close</button></div>
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
  const [offOpen, setOffOpen] = useState(false);
  const presetOn = VIEW_PRESETS.find((p) => Math.abs(normAz(p.v.az - opts.view.az)) < 0.5 && Math.abs(p.v.el - opts.view.el) < 0.5)?.id ?? '';
  return (
    <Card className={'isotools' + (compact ? ' compact' : '')}>
      <Segmented small value={opts.mode} onChange={(m) => setOpts({ mode: m as Mode })} options={[['draw', '✎ Draw'], ['orbit', '⟳ Rotate 3D'], ['pan', '✥ Move']]} />
      {opts.mode === 'draw' && (
        <>
          <p className="fhint">Drag from a point to draw a line — it follows the 30° / 150° / vertical paper lines. Start on any point except a turn (or the middle of a line) to branch off it; from empty space it continues from point {cur}{isBranch ? ', making a tee' : ''}. Use Add offset for angled runs. Tap a line or point to edit it. Two fingers: pinch to zoom, slide to move, twist to turn 90°.</p>
        </>
      )}
      {opts.mode === 'orbit' && <p className="fhint">Drag the drawing to tilt and turn it in 3D. Tap the compass (or twist two fingers) to turn to the next compass direction.</p>}
      {opts.mode === 'pan' && <p className="fhint">Drag to move, pinch or scroll to zoom, twist two fingers to turn 90°. Tap lines and points to edit them.</p>}
      <div className="isorow">
        <span className="flabel">View</span>
        <div className="chiprow">
          {VIEW_PRESETS.map((p) => <button key={p.id} className={'chip' + (presetOn === p.id ? ' on' : '')} onClick={() => setOpts({ view: { ...p.v } })}>{p.label}</button>)}
          <button className="chip" onClick={() => setOpts({ view: { ...opts.view, az: normAz(opts.view.az + 90) } })} title="Turn North 90°">N ⟳ 90°</button>
        </div>
      </div>
      {offOpen
        ? <OffsetPanel key={heading + cur} heading={heading} prefs={prefs} onAdd={(o) => { addOffset(o); setOffOpen(false); }} onClose={() => setOffOpen(false)} />
        : <button className="btn offbtn" onClick={() => setOffOpen(true)}>⟋ Add offset from point {cur}</button>}
      <div className="dirbar">
        <Field label="Length (optional)" value={lenText} onChange={setLenText} parse={parseLength} placeholder="e.g. 5' 6" />
        <div className="dirpad">
          {DIR_ORDER.map((k) => <button key={k} className="btn dir" aria-label={DIRS[k].label} onClick={() => addDir(k)}>{DIR_SHORT[k]}</button>)}
        </div>
      </div>
      <div className="isotoggles">
        {(['dims', 'welds', 'labels', 'scaled'] as const).map((k) => (
          <label key={k} className="chip"><input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ [k]: e.target.checked })} /> {({ dims: 'Dimensions', welds: 'Joints', labels: 'Point #', scaled: 'To scale' })[k]}</label>
        ))}
        <button className="chip" onClick={undo} disabled={!canUndo}>‹ Back</button>
        {canRedo && <button className="chip" onClick={redo}>Forward ›</button>}
      </div>
      {opts.scaled && missing > 0 && <p className="fhint">{missing} line{missing > 1 ? 's' : ''} without a dimension {missing > 1 ? 'are' : 'is'} drawn at the drawing's average scale.</p>}
    </Card>
  );
}

// ------------------------------------------------------------------ canvas
type Cam = { s: number; tx: number; ty: number };
export interface CanvasApi { hitAt: (clientX: number, clientY: number) => { sel: Sel; t: number } | null }
function IsoCanvas({ d, disp, opts, prefs, cursor, sel, rot, fitTick, armed, apiRef, onPick, onItemDrag, menu, startOn, onStartBtn, onNotice, onView, onTap, onDraw, children }: {
  d: IsoDrawing; disp: { P: Vec3[]; k: number; vecs: Vec3[] }; opts: Opts; prefs: Prefs; cursor: number; sel: Sel; rot: boolean; fitTick: number;
  armed: string | null; apiRef: React.MutableRefObject<CanvasApi | null>; onPick: (v: Vec3 | null) => void;
  onItemDrag: (run: number, id: string, t: number) => void; menu: { run: number; t: number; node: React.ReactNode } | null;
  startOn: boolean; onStartBtn: () => void; onNotice: (m: string) => void;
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
  const runT = (i: number, loc: { x: number; y: number }) => {
    const r = d.runs[i]; const a = T3(P[r.from]), b = T3(P[i + 1]);
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
    return Math.max(0.12, Math.min(0.88, ((loc.x - a[0]) * dx + (loc.y - a[1]) * dy) / L2));
  };
  const targetOf = (el: Element | null): Sel | 'compass' | 'none' => {
    const t = el?.closest('[data-item],[data-node],[data-run],[data-compass]');
    if (!t) return 'none';
    if (t.hasAttribute('data-compass')) return 'compass';
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
      const runIdx = t.kind === 'run' ? t.id : t.kind === 'item' ? t.run : -1;
      return { sel: t, t: runIdx >= 0 ? runT(runIdx, toLocal({ clientX: cx, clientY: cy })) : 0.5 };
    },
  };

  // pointer handling. Draw mode: drag from a point (or anywhere, from the current point) to draw a line.
  // Rotate mode: drag turns the view. Move mode: drag pans. Two fingers always pan / zoom. Taps select.
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const st = useRef<{ cam: Cam; view: View; mid: { x: number; y: number }; dist: number; moved: boolean; target: Sel | 'compass' | 'none'; cAng: number; drawFrom: number | null; ang?: number; twist?: boolean; itemDrag?: boolean; split?: { run: number; t: number; origin: Vec3 }; blocked?: boolean } | null>(null);
  const gestureTurn = useRef(false); // a two-finger twist moves the camera itself; skip the re-centring below
  const CMP = { x: 40, y: 40 };
  const onDown = (e: React.PointerEvent) => {
    try { svg.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const loc = toLocal(e);
    ptrs.current.set(e.pointerId, loc);
    const ps = [...ptrs.current.values()];
    const target = ps.length > 1 ? 'none' : targetOf(e.target as Element);
    let drawFrom: number | null = null;
    const itemDrag = ps.length === 1 && !armed && target !== 'none' && target !== 'compass' && target.kind === 'item';
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
      if (drawFrom !== null && !split && nodeKind(d, drawFrom).kind === 'elbow') { drawFrom = null; blocked = true; } // no lines off a turn
    }
    const mid = ps.length === 2 ? { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 } : loc;
    st.current = { cam, view, mid, dist: ps.length === 2 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0, moved: ps.length > 1, target, cAng: Math.atan2(loc.y - CMP.y, loc.x - CMP.x), drawFrom, itemDrag, split, blocked,
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
      // two fingers: pinch = zoom, move = pan, twist = turn the drawing (about the vertical, like the compass)
      const dist = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      const mid = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
      const ns = Math.max(0.02, Math.min(400, s.cam.s * (dist / s.dist))), kk = ns / s.cam.s;
      let dA = Math.atan2(ps[1].y - ps[0].y, ps[1].x - ps[0].x) - (s.ang ?? 0);
      dA = Math.atan2(Math.sin(dA), Math.cos(dA));
      // a deliberate twist turns the drawing one compass step (90°) that way — once per two-finger touch
      if (!s.twist && Math.abs(dA) > (22 * Math.PI) / 180) {
        s.twist = true;
        const nv: View = { az: stepAz(s.view.az, Math.sign(dA)), el: s.view.el };
        const C = P.reduce((acc, p) => add(acc, p), [0, 0, 0] as Vec3).map((v) => v / P.length) as Vec3;
        const p0 = project(C, s.view), p1 = project(C, nv);
        s.cam = { ...s.cam, tx: s.cam.tx + (p0[0] - p1[0]) * s.cam.s, ty: s.cam.ty + (p0[1] - p1[1]) * s.cam.s };
        s.view = nv;
        gestureTurn.current = true;
        onView(nv);
      }
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
    if (s.target !== 'none' && s.target) { onTap(s.target, s.target.kind === 'run' ? runT(s.target.id, loc) : s.target.kind === 'item' ? runT(s.target.run, loc) : undefined); return; }
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
        <IsoArt d={d} disp={disp} T3={T3} sel={sel} cursor={cursor} opts={opts} prefs={prefs} />
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
      <button className="ibtn home" aria-label="Home view" title="Reset to the standard ISO view" onClick={goHome}>
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h5v-5.5h3V20h5V9.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>
      </button>
      <button className={'ibtn startpt' + (startOn ? ' on' : '')} aria-label="New start point" title="New start point — then tap the paper" onClick={onStartBtn}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M11 21.5c-.3 0-.6-.1-.8-.4C7.6 18 4.5 14.3 4.5 10.7a6.5 6.5 0 0 1 9.7-5.7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /><path d="M17.3 10.4c.1.1.2.2.2.3 0 3.6-3.1 7.3-5.7 10.4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="11" cy="10.7" r="1.9" fill="currentColor" /><path d="M18 2.5v6M15 5.5h6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
      </button>
      {menu && (() => {
        const r = d.runs[menu.run]; const a = T3(P[r.from]), b = T3(P[menu.run + 1]);
        const x = a[0] + (b[0] - a[0]) * menu.t, y = a[1] + (b[1] - a[1]) * menu.t;
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
  d: IsoDrawing; disp: { P: Vec3[]; vecs: Vec3[] }; T3: (p: Vec3) => [number, number]; sel: Sel; cursor: number; opts: ArtOpts; prefs: Prefs; exportMode?: boolean;
}) {
  const { P, vecs } = disp;
  const S = P.map(T3);
  const under: React.ReactNode[] = [];
  const els: React.ReactNode[] = [];
  const unit = (a: [number, number], b: [number, number]) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L, L] as const; };
  const label = (key: string, a: [number, number], b: [number, number], text: string, cls: string, off = 11) => {
    const [ux, uy, L] = unit(a, b);
    if (L < 16) return null;
    let nx = -uy, ny = ux;
    if (ny > 0 || (Math.abs(ny) < 1e-6 && nx > 0)) { nx = -nx; ny = -ny; } // keep labels above / left of the line
    const lx = (a[0] + b[0]) / 2 + nx * off, ly = (a[1] + b[1]) / 2 + ny * off;
    let ang = (Math.atan2(uy, ux) * 180) / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    return <text key={key} className={cls} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${ang.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})`}>{text}</text>;
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
          under.push(label('l1' + i, a, c, formatFtIn(Math.abs(tv[axes[0]]), prefs), 'iso-legdim', 9));
          under.push(label('l2' + i, c, b, formatFtIn(Math.abs(tv[axes[1]]), prefs), 'iso-legdim', 9));
        }
      } else {
        const C1 = add(A3, comp(0)), Hh = add(C1, comp(1));
        const c1 = T3(C1), h = T3(Hh);
        under.push(<polygon key={'h1' + i} points={`${a.join(',')} ${c1.join(',')} ${h.join(',')}`} fill="url(#isoHatchA)" className="iso-hatch" />);
        under.push(<polygon key={'h2' + i} points={`${a.join(',')} ${h.join(',')} ${b.join(',')}`} fill="url(#isoHatchB)" className="iso-hatch" />);
        under.push(<polyline key={'o' + i} points={`${a.join(',')} ${c1.join(',')} ${h.join(',')} ${b.join(',')}`} className="iso-off" />);
        under.push(<line key={'oh' + i} x1={a[0]} y1={a[1]} x2={h[0]} y2={h[1]} className="iso-off" />);
        if (opts.dims && measured) {
          under.push(label('l1' + i, a, c1, formatFtIn(Math.abs(tv[0]), prefs), 'iso-legdim', 9));
          under.push(label('l2' + i, c1, h, formatFtIn(Math.abs(tv[1]), prefs), 'iso-legdim', 9));
          under.push(label('l3' + i, h, b, formatFtIn(Math.abs(tv[2]), prefs), 'iso-legdim', 9));
        }
      }
    }

    if (!exportMode) els.push(<line key={'hit' + i} data-run={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="iso-hit" />);
    els.push(<line key={'r' + i} data-run={exportMode ? undefined : i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={'iso-pipe' + (selected ? ' sel' : '')} />);

    // fittings and valves on the line
    const items = runItems(r);
    items.forEach((it) => {
      const c: [number, number] = [a[0] + (b[0] - a[0]) * it.t, a[1] + (b[1] - a[1]) * it.t];
      const sz = Math.max(4, Math.min(8, L / (3 * Math.max(1, items.length))));
      const isSelItem = sel?.kind === 'item' && sel.id === it.id;
      if (isSelItem && !exportMode) els.push(<circle key={'ih' + it.id} className="iso-itemsel" cx={c[0]} cy={c[1]} r={sz * 1.9} />);
      els.push(<g key={'it' + it.id} className="iso-item" data-run={exportMode ? undefined : i} data-item={exportMode ? undefined : it.id}>
        {!exportMode && <circle className="iso-itemhit" cx={c[0]} cy={c[1]} r={Math.max(12, sz * 1.8)} />}
        {lineSymbol(it.type, c, [ux, uy], sz, 'it' + it.id)}
      </g>);
      if (opts.welds && !['spool', 'flange', 'orifice', 'spectacle', 'union', 'coupling', 'dielectric', 'swage'].includes(it.type)) {
        const off = sz * 1.15 + 4;
        for (const sgn of [-1, 1]) els.push(...jointMark(it.conn ?? 'bw', [c[0] + ux * off * sgn, c[1] + uy * off * sgn], [ux, uy], `jm${it.id}${sgn}`));
      }
    });
    const m: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // travel dimension on the pipe, or a "needs dimension" marker
    if (opts.dims) {
      if (measured) {
        const txt = formatFtIn(runLength(r), prefs) + (axes.length > 1 ? ' TRAV' : '');
        const lb = label('d' + i, a, b, txt, 'iso-dim', items.length ? 20 : 11);
        if (lb) els.push(lb);
      } else if (!exportMode && L > 22) {
        const off = items.length ? 16 : 0;
        els.push(<g key={'q' + i} data-run={i}><circle className="iso-qbg" cx={m[0] + nx * off} cy={m[1] + ny * off} r={7} /><text className="iso-q" x={m[0] + nx * off} y={m[1] + ny * off + 3.5} textAnchor="middle">?</text></g>);
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
      const cn = fit === 'thd90' ? 'thd' : connAt(d, n);
      if (opts.welds) legScreen.forEach(([ux, uy], j) => els.push(...jointMark(cn, [p[0] + ux * 8, p[1] + uy * 8], [ux, uy], `w${n}-${j}`)));
      els.push(...nodeSymbol(fit, k.kind, p, legScreen, 'ns' + n));
      if (k.kind === 'elbow' && Math.abs(k.angle - 90) > 0.05) els.push(<text key={'ea' + n} className="iso-note" x={p[0] + 7} y={p[1] + 15}>{formatNumber(k.angle, 1)}°</text>);
    } else if (k.kind === 'straight') {
      if (opts.welds) els.push(...jointMark(connAt(d, n), p, legScreen[0] ?? [1, 0], 'sw' + n));
    } else {
      const endT = d.ends[n] ?? 'open';
      els.push(...endSymbol(endT, p, legScreen[0] ?? [1, 0], 'e' + n, exportMode));
      if (opts.welds && !['open', 'weld', 'flange', 'blind', 'nozzle'].includes(endT) && legScreen[0]) els.push(...jointMark(connAt(d, n), [p[0] + legScreen[0][0] * 3, p[1] + legScreen[0][1] * 3], legScreen[0], 'ej' + n));
    }
    if (!exportMode) {
      const isCursor = n === cursor, isSel = sel?.kind === 'node' && sel.id === n;
      els.push(<circle key={'hn' + n} data-node={n} cx={p[0]} cy={p[1]} r={13} className={"iso-nodehit" + (isCursor ? ' cursor' : '') + (isSel ? ' sel' : '')} />);
    }
    if (opts.labels) els.push(<text key={'nl' + n} className="iso-node" x={p[0] + 8} y={p[1] - 8}>{n}</text>);
  }
  // notes
  d.notes.forEach((t, j) => {
    const p = S[t.node]; if (!p) return;
    const lx = p[0] + 22, ly = p[1] - 18 - (j % 3) * 12;
    els.push(<g key={'n' + t.id}><line className="iso-leader" x1={p[0]} y1={p[1]} x2={lx - 2} y2={ly + 2} /><text className="iso-note" x={lx} y={ly}>{t.text}</text></g>);
  });
  return <g>{under}{els}</g>;
}

// ------------------------------------------------------------------ editors
function RunEditor({ d, i, prefs, cut, update, onClose, onDelete }: {
  d: IsoDrawing; i: number; prefs: Prefs; cut: ReturnType<typeof cutList>[number]; update: (f: (d: IsoDrawing) => IsoDrawing, mergeKey?: string) => void; onClose: () => void; onDelete: () => void;
}) {
  const r = d.runs[i];
  const sv = sketchVec(r);
  const axes = [0, 1, 2].filter((k) => nz(sv[k]));
  const tv = isMeasured(r) ? runVec(r) : null;
  const [txt, setTxt] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = { t: '' };
    axes.forEach((k) => { o[k] = tv ? formatFtIn(Math.abs(tv[k]), prefs) : ''; });
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
      m = [0, 0, 0]; axes.forEach((k, j) => { m![k] = sign(k) * (vals[j] as number); });
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
          <Field label="Length (C-C)" value={txt[axes[0]] ?? ''} onChange={(v) => apply({ ...txt, [axes[0]]: v })} parse={parseLength} placeholder="add dimension" />
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
              <input type="range" min={0.1} max={0.9} step={0.05} value={it.t} aria-label={`Position of ${c?.label ?? it.type}`} onChange={(e) => { const t = Number(e.target.value); setItems((l) => l.map((q) => (q.id === it.id ? { ...q, t } : q)), 'pos' + it.id); }} />
              <button className="chip danger" aria-label={`Remove ${c?.label ?? it.type}`} onClick={() => setItems((l) => l.filter((q) => q.id !== it.id))}>✕</button>
            </div>
          );
        })}
      </div>
      <p className="fhint">{cut.ok ? `Cut length ${formatFracIn(cut.cut, prefs)}` : isMeasured(r) ? 'Cut length impossible — fittings longer than the line' : 'Add a dimension to get the cut length.'}{cut.ok && cut.note.length ? ` · ${cut.note.join('; ')}` : ''}</p>
      <div className="actions">
        {isMeasured(r) && r.sketch && <button className="btn" onClick={() => { setTxt({ t: '' }); setRun((q) => { const { meas: _m, ...rest } = q; return { ...rest, sketch: true }; }); }}>Clear dimension</button>}
        {descendants > 0 && !armed
          ? <button className="btn danger" onClick={() => setArmed(true)}>Delete…</button>
          : <button className="btn danger" onClick={onDelete}>{descendants > 0 ? `Delete + ${descendants} after it` : 'Delete line'}</button>}
      </div>
    </Card>
  );
}

function NodeEditor({ d, node, update, onClose }: { d: IsoDrawing; node: number; update: (f: (d: IsoDrawing) => IsoDrawing) => void; onClose: () => void }) {
  const [noteText, setNoteText] = useState('');
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
      {k.kind !== 'multi' && !(k.kind === 'start-end' && !nodeLegs(d, node).length) && (
        <Select label="Joint here" value={connAt(d, node)} options={CONN_ORDER.map((c) => [c, CONN_LABEL[c]])} onChange={(v) => update((x) => ({ ...x, nodeConn: { ...(x.nodeConn ?? {}), [node]: v as Conn } }))} />
      )}
      {(k.kind === 'end' || k.kind === 'start-end') && (
        <Select label="End" value={d.ends[node] ?? 'open'} options={(Object.keys(END_LABEL) as EndType[]).map((x) => [x, END_LABEL[x]])} onChange={(v) => update((x) => ({ ...x, ends: { ...x.ends, [node]: v as EndType } }))} />
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
  if (!cuts.length) return <Card><p className="lead">Draw some lines to see the cut list.</p></Card>;
  const total = cuts.reduce((s, c) => s + (c.ok ? c.cut : 0), 0);
  const missing = cuts.filter((c) => Number.isNaN(c.travel)).length;
  const text = [`${d.name} — ${d.nps}" pipe, gap ${formatFracIn(d.gap, prefs)}`,
    ...cuts.map((c) => `Line ${c.run + 1} ${describeRun(d.runs[c.run])}: ${Number.isNaN(c.travel) ? 'NO DIMENSION' : `C-C ${formatFtIn(c.travel, prefs)}, CUT ${c.ok ? formatFtIn(c.cut, prefs) : 'IMPOSSIBLE'}`}${c.note.length && !Number.isNaN(c.travel) ? ' (' + c.note.join('; ') + ')' : ''}`),
    `Total pipe ${formatFtIn(total, prefs)}${missing ? ` (+ ${missing} undimensioned)` : ''}`].join('\n');
  return (
    <Card>
      <h4>Cut list · {d.nps}" · gap {formatFracIn(d.gap, prefs)}</h4>
      <div className="tablewrap">
        <table className="dtable">
          <thead><tr><th>Line</th><th>C-C</th><th>Deduct</th><th>Cut</th></tr></thead>
          <tbody>{cuts.map((c) => Number.isNaN(c.travel) ? (
            <tr key={c.run} className="todo"><th>{c.run + 1}<small> {describeRun(d.runs[c.run])}</small></th><td colSpan={3}>needs dimension</td></tr>
          ) : (
            <tr key={c.run} className={c.ok ? '' : 'bad'}><th>{c.run + 1}<small> {describeRun(d.runs[c.run])}</small></th><td>{formatFtIn(c.travel, prefs)}</td><td>{formatFracIn(c.to1 + c.to2 + c.gaps, prefs)}</td><td><b>{c.ok ? formatFtIn(c.cut, prefs) : 'impossible'}</b></td></tr>
          ))}</tbody>
        </table>
      </div>
      {cuts.some((c) => c.note.length && !Number.isNaN(c.travel)) && <ul className="fhint">{cuts.filter((c) => c.note.length && !Number.isNaN(c.travel)).map((c) => <li key={c.run}>Line {c.run + 1}: {c.note.join('; ')}</li>)}</ul>}
      <p><b>Total pipe: {formatFtIn(total, prefs)}</b>{missing ? <span className="muted"> · {missing} line{missing > 1 ? 's' : ''} still need a dimension</span> : null}</p>
      <p className="fhint">Deduct = fitting take-outs + root gaps.</p>
      <Msg kind="info">Dimensions are centerline, fitting center to fitting center. Take-outs use ASME B16.9 butt-weld fittings in {d.nps}" (long-radius elbows and straight tees unless you picked another fitting at a point). Valves, flanges and other items on a line must be subtracted by hand — they are noted above.</Msg>
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
          <div className="ihead"><b>{x.name}</b><span className="muted">{x.runs.length} lines · {new Date(x.updated).toLocaleDateString()}</span></div>
          <div className="iact">
            <button className="chip" onClick={() => onOpen(x.id)}>Open</button>
            <button className="chip" onClick={() => { const c = { ...JSON.parse(JSON.stringify(x)), id: uid(), name: x.name + ' copy', created: Date.now(), updated: Date.now() }; setStore((s) => ({ ...s, drawings: [c, ...s.drawings] })); }}>Duplicate</button>
            {armed === x.id
              ? <><button className="chip danger" onClick={() => { setStore((s) => { const ds = s.drawings.filter((q) => q.id !== x.id); return { drawings: ds, current: s.current === x.id ? ds[0]?.id ?? null : s.current }; }); setArmed(null); }}>Delete for good</button><button className="chip" onClick={() => setArmed(null)}>Cancel</button></>
              : <button className="chip danger" onClick={() => setArmed(x.id)}>Delete</button>}
          </div>
        </div>
      ))}
      <p className="fhint">Drawings are saved on this device. Rename a drawing by tapping its name above the sketch.</p>
    </Card>
  );
}

function SetupPanel({ d, disp, opts, prefs, update, toast }: { d: IsoDrawing; disp: { P: Vec3[]; vecs: Vec3[] }; opts: Opts; prefs: Prefs; update: (f: (d: IsoDrawing) => IsoDrawing) => void; toast: (m: string) => void }) {
  const [gap, setGap] = useState(formatFracIn(d.gap, prefs));
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
const EXPORT_CSS = `.iso-pipe{stroke:#111;stroke-width:2.6;stroke-linecap:round}.iso-hit{stroke:none}.iso-sym{fill:#fff;stroke:#111;stroke-width:1.3}.iso-sym.thick{stroke-width:2.4}.iso-symfill{fill:#111}.iso-weld{fill:#111}.iso-dim{font:600 9px sans-serif;fill:#1f7f7a}.iso-legdim{font:600 8px sans-serif;fill:#555}.iso-note{font:600 8px sans-serif;fill:#111}.iso-node{font:600 7px sans-serif;fill:#666}.iso-leader{stroke:#666;stroke-width:.6}.iso-off{fill:none;stroke:#777;stroke-width:.9;stroke-dasharray:4 3}.iso-hatch{stroke:none}.iso-hatchline{stroke:#999;stroke-width:.8}.cmp-ring{fill:#fff;stroke:#bbb}.cmp-n{stroke:#1f7f7a;stroke-width:2.2}.cmp-head{fill:#1f7f7a}.cmp-dir{stroke:#999;stroke-width:1.2}.cmp-up{stroke:#bbb;stroke-width:1;stroke-dasharray:2 2}.cmp-t{font:700 9px sans-serif;fill:#777}.cmp-t.n{fill:#1f7f7a}.iso-gap{stroke:#fff;stroke-width:6}.nofill{fill:none}.iso-symball{fill:#fff;stroke:#111;stroke-width:1.2}.iso-symtext{font:800 6px sans-serif;fill:#111}.iso-fit{font:800 7.5px sans-serif;fill:#1f7f7a}.iso-equip{fill:#eee;stroke:#111;stroke-width:1.1}`;

async function shareImage(d: IsoDrawing, markup: string, W: number, H: number): Promise<string> {
  const svg = markup.replace(/ style="display: ?none;?"/, '').replace(/^(<svg[^>]*>)/, `$1<style>${EXPORT_CSS}</style>`);
  const blob = await new Promise<Blob | null>((res) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = W * 3; c.height = H * 3; c.getContext('2d')!.drawImage(img, 0, 0, W * 3, H * 3); c.toBlob((b) => res(b), 'image/png'); };
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
