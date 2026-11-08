import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Field, Msg, Select, Segmented, Card, Grid, useApp } from './components';
import { usePersistent, uid, shareText } from './store';
import { parseLength, tryParse } from '../engine/parse';
import { formatFtIn, formatFracIn, formatNumber } from '../engine/format';
import {
  IsoDrawing, Run, Inline, INLINE_LABEL, EndType, END_LABEL, DIRS, Vec3, newDrawing, nodeKind, nodeLegs, cutList,
  runLength, runVec, describeRun, isMeasured, sketchVec, View, ISO_VIEW, VIEW_PRESETS, project, unproject, displayPositions, deleteSubtree,
} from '../engine/iso';
import { B169 } from '../engine/fittings';

type Prefs = ReturnType<typeof useApp>['settings']['prefs'];
interface IsoStore { drawings: IsoDrawing[]; current: string | null }
type Sel = { kind: 'node'; id: number } | { kind: 'run'; id: number } | null;
type Mode = 'draw' | 'orbit' | 'pan';
type Plane = 'EN' | 'EU' | 'NU';
interface Opts { dims: boolean; welds: boolean; labels: boolean; scaled: boolean; view: View; mode: Mode; plane: Plane }
type ArtOpts = Pick<Opts, 'dims' | 'welds' | 'labels'>;

const PLANES: Record<Plane, { n: Vec3; a: Vec3; b: Vec3; label: string }> = {
  EN: { n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0], label: 'Flat' },
  EU: { n: [0, 1, 0], a: [1, 0, 0], b: [0, 0, 1], label: 'E–W wall' },
  NU: { n: [1, 0, 0], a: [0, 1, 0], b: [0, 0, 1], label: 'N–S wall' },
};
const GRID = 12; // one grid square = 12 drawing units (1 ft when drawn to scale)
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

export function IsoSketch() {
  const { settings, toast } = useApp();
  const prefs = settings.prefs;
  const [store, setStore] = usePersistent<IsoStore>('iso', { drawings: [], current: null });
  const [opts, setOptsRaw] = usePersistent<Opts>('isoview', { dims: true, welds: true, labels: false, scaled: false, view: ISO_VIEW, mode: 'draw', plane: 'EN' });
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

  const update = (f: (d: IsoDrawing) => IsoDrawing) => setStore((s) => ({ ...s, drawings: s.drawings.map((x) => (x.id === d.id ? { ...f(x), updated: Date.now() } : x)) }));
  const cur = Math.min(cursor, d.runs.length);
  const addRun = (r: Omit<Run, 'id' | 'from'>) => {
    const n = d.runs.length;
    update((x) => ({ ...x, runs: [...x.runs, { ...r, id: uid(), from: cur }] }));
    setCursor(n + 1); setSel(null);
  };
  const addDir = (k: string) => {
    const v = DIRS[k].v;
    const p = tryParse(parseLength, lenText);
    if (p && !p.ok) { toast(p.err); return; }
    if (p && p.ok && p.v > 0) addRun({ dx: v[0] * p.v, dy: v[1] * p.v, dz: v[2] * p.v, inline: 'none', sketch: true, meas: mul(v, p.v) });
    else addRun({ dx: v[0] * GRID * 2, dy: v[1] * GRID * 2, dz: v[2] * GRID * 2, inline: 'none', sketch: true });
  };
  const drawTo = (vec: Vec3 | null) => {
    if (!vec) { toast('This drawing plane is edge-on in this view — turn the view or pick another plane'); return; }
    const s = mul(vec, 1 / (disp.k || 1));
    addRun({ dx: s[0], dy: s[1], dz: s[2], inline: 'none', sketch: true });
  };
  const undo = () => { if (d.runs.length) { update((x) => deleteSubtree(x, x.runs.length - 1)); setSel(null); setCursor(d.runs.length - 1 >= 0 ? d.runs[d.runs.length - 1].from : 0); } };
  const onTap = (t: Sel) => {
    setSel(t);
    if (t?.kind === 'node') setCursor(t.id);
    if (t?.kind === 'run') setCursor(t.id + 1);
  };

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
  const missing = d.runs.filter((r) => !isMeasured(r)).length;

  const editor = selRun !== null
    ? <RunEditor key={d.runs[selRun].id} d={d} i={selRun} prefs={prefs} cut={cuts[selRun]} update={update} onClose={() => setSel(null)}
        onDelete={() => { update((x) => deleteSubtree(x, selRun)); setSel(null); setCursor(d.runs[selRun].from); }} />
    : selNode !== null ? <NodeEditor d={d} node={selNode} update={update} onClose={() => setSel(null)} /> : null;

  const tools = (
    <DrawTools opts={opts} setOpts={setOpts} lenText={lenText} setLenText={setLenText} addDir={addDir} undo={undo} canUndo={d.runs.length > 0}
      cur={cur} isBranch={cur !== d.runs.length} missing={missing} compact={full} />
  );

  const stage = (
    <IsoCanvas d={d} disp={disp} opts={opts} prefs={prefs} cursor={cur} sel={sel} rot={rot} fitTick={fitTick}
      onView={(v) => setOpts({ view: v })} onTap={onTap} onDraw={drawTo}>
      <div className="isobtns">
        {full && <button className="ibtn" onClick={() => setHide(!hide)}>{hide ? 'Show tools' : 'Hide tools'}</button>}
        {full && portrait && <button className="ibtn" onClick={() => { setLand(!land); setFitTick((t) => t + 1); }}>{land ? 'Portrait' : 'Landscape'}</button>}
        <button className="ibtn" onClick={full ? exitFull : enterFull} aria-label={full ? 'Exit full screen' : 'Full screen'}>
          {full ? '✕ Close' : <svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}
        </button>
      </div>
    </IsoCanvas>
  );

  if (full) {
    return (
      <div className={'isofull' + (rot ? ' rot' : '') + (wide ? ' wide' : '') + (hide ? ' hidetools' : '')}>
        {stage}
        {!hide && <div className="isoside">{editor}{tools}</div>}
      </div>
    );
  }

  return (
    <div className="tool iso">
      <div className="isohead">
        <input className="isoname" value={d.name} aria-label="Drawing name" onChange={(e) => update((x) => ({ ...x, name: e.target.value }))} />
        <span className="muted">{d.nps}" · {d.runs.length} lines</span>
      </div>
      {stage}
      {editor}
      {tools}
      <Segmented value={panel} onChange={setPanel} options={[['cut', 'Cut list'], ['setup', 'Setup'], ['library', 'Library']]} />
      {panel === 'cut' && <CutPanel d={d} cuts={cuts} prefs={prefs} onShare={async (t) => { const m = await shareText(t); if (m) toast(m); }} />}
      {panel === 'setup' && <SetupPanel d={d} disp={disp} opts={opts} prefs={prefs} update={update} toast={toast} />}
      {panel === 'library' && <Library store={store} setStore={setStore} onOpen={(id) => { setStore((s) => ({ ...s, current: id })); setSel(null); setCursor(0); setFitTick((t) => t + 1); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ tools
function DrawTools({ opts, setOpts, lenText, setLenText, addDir, undo, canUndo, cur, isBranch, missing, compact }: {
  opts: Opts; setOpts: (p: Partial<Opts>) => void; lenText: string; setLenText: (s: string) => void; addDir: (k: string) => void;
  undo: () => void; canUndo: boolean; cur: number; isBranch: boolean; missing: number; compact: boolean;
}) {
  const presetOn = VIEW_PRESETS.find((p) => Math.abs(normAz(p.v.az - opts.view.az)) < 0.5 && Math.abs(p.v.el - opts.view.el) < 0.5)?.id ?? '';
  return (
    <Card className={'isotools' + (compact ? ' compact' : '')}>
      <Segmented small value={opts.mode} onChange={(m) => setOpts({ mode: m as Mode })} options={[['draw', '✎ Draw'], ['orbit', '⟳ Rotate 3D'], ['pan', '✥ Move']]} />
      {opts.mode === 'draw' && (
        <>
          <div className="isorow">
            <span className="flabel">Draw on</span>
            <Segmented small value={opts.plane} onChange={(p) => setOpts({ plane: p as Plane })} options={(Object.keys(PLANES) as Plane[]).map((k) => [k, PLANES[k].label])} />
          </div>
          <p className="fhint">Tap the grid to run a line from point {cur}{isBranch ? ' (branch → tee)' : ''}. Tap a point to draw from it, tap a line to edit it.</p>
        </>
      )}
      {opts.mode === 'orbit' && <p className="fhint">Drag the drawing to turn it in 3D. Drag the compass to swing North; tap it to turn 90°.</p>}
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
        {(['dims', 'welds', 'labels', 'scaled'] as const).map((k) => (
          <label key={k} className="chip"><input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ [k]: e.target.checked })} /> {({ dims: 'Dimensions', welds: 'Weld dots', labels: 'Point #', scaled: 'To scale' })[k]}</label>
        ))}
        <button className="chip" onClick={undo} disabled={!canUndo}>↶ Undo</button>
      </div>
      {opts.scaled && missing > 0 && <p className="fhint">{missing} line{missing > 1 ? 's' : ''} without a dimension {missing > 1 ? 'are' : 'is'} drawn at the drawing's average scale.</p>}
    </Card>
  );
}

// ------------------------------------------------------------------ canvas
type Cam = { s: number; tx: number; ty: number };
function IsoCanvas({ d, disp, opts, prefs, cursor, sel, rot, fitTick, onView, onTap, onDraw, children }: {
  d: IsoDrawing; disp: { P: Vec3[]; k: number; vecs: Vec3[] }; opts: Opts; prefs: Prefs; cursor: number; sel: Sel; rot: boolean; fitTick: number;
  onView: (v: View) => void; onTap: (s: Sel) => void; onDraw: (v: Vec3 | null) => void; children?: React.ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 360, h: 300 });
  const { w: W, h: H } = size;
  const view = opts.view;
  const P = disp.P;
  const [cam, setCam] = useState<Cam>({ s: 2, tx: 180, ty: 150 });
  const camRef = useRef(cam); camRef.current = cam;
  const [ghost, setGhost] = useState<Vec3 | null>(null);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(100, el.clientWidth), h: Math.max(100, el.clientHeight) }));
    ro.observe(el); return () => ro.disconnect();
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
  // keep the drawing centred on screen when the view turns (presets, compass, orbit)
  const prevView = useRef(view);
  useEffect(() => {
    const pv = prevView.current; prevView.current = view;
    if (pv.az === view.az && pv.el === view.el) return;
    const C = P.reduce((a, p) => add(a, p), [0, 0, 0] as Vec3).map((v) => v / P.length) as Vec3;
    const a = project(C, pv), b = project(C, view);
    setCam((c) => ({ ...c, tx: c.tx + (a[0] - b[0]) * c.s, ty: c.ty + (a[1] - b[1]) * c.s }));
  }, [view.az, view.el]);

  const T3 = (p: Vec3): [number, number] => { const q = project(p, view); return [q[0] * cam.s + cam.tx, q[1] * cam.s + cam.ty]; };
  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    if (rot) return { x: ((e.clientY - r.top) / r.height) * W, y: ((r.right - e.clientX) / r.width) * H };
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const snap = (pt: { x: number; y: number }): Vec3 | null | 'edge' => {
    const pl = PLANES[opts.plane];
    const o = P[cursor] ?? [0, 0, 0];
    const q = unproject((pt.x - cam.tx) / cam.s, (pt.y - cam.ty) / cam.s, view, o, pl.n);
    if (!q) return 'edge';
    const g = GRID * (disp.k || 1);
    const rel: Vec3 = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
    let ra = dot3(rel, pl.a), rb = dot3(rel, pl.b);
    // within ~12° of a grid axis → straight along that axis
    if (Math.abs(rb) < Math.abs(ra) * 0.21) rb = 0; else if (Math.abs(ra) < Math.abs(rb) * 0.21) ra = 0;
    const ca = Math.round(ra / g) * g, cb = Math.round(rb / g) * g;
    if (!ca && !cb) return null;
    return add(mul(pl.a, ca), mul(pl.b, cb));
  };

  // pointer handling: tap = select / draw, drag = rotate / pan, pinch = zoom
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const st = useRef<{ cam: Cam; view: View; mid: { x: number; y: number }; dist: number; moved: boolean; target: Sel | 'compass' | 'none'; cAng: number } | null>(null);
  const CMP = { x: 40, y: 40 };
  const onDown = (e: React.PointerEvent) => {
    try { svg.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const loc = toLocal(e);
    ptrs.current.set(e.pointerId, loc);
    const ps = [...ptrs.current.values()];
    const el = (e.target as Element).closest('[data-node],[data-run],[data-compass]');
    const target: Sel | 'compass' | 'none' = !el ? 'none' : el.hasAttribute('data-compass') ? 'compass'
      : el.hasAttribute('data-node') ? { kind: 'node', id: Number(el.getAttribute('data-node')) } : { kind: 'run', id: Number(el.getAttribute('data-run')) };
    const mid = ps.length === 2 ? { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 } : loc;
    st.current = { cam, view, mid, dist: ps.length === 2 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0, moved: ps.length > 1, target: ps.length > 1 ? 'none' : target, cAng: Math.atan2(loc.y - CMP.y, loc.x - CMP.x) };
    setGhost(null);
  };
  const onMove = (e: React.PointerEvent) => {
    const loc = toLocal(e);
    if (!ptrs.current.has(e.pointerId)) {
      if (e.pointerType === 'mouse' && opts.mode === 'draw') { const v = snap(loc); setGhost(v && v !== 'edge' ? v : null); }
      return;
    }
    ptrs.current.set(e.pointerId, loc);
    const s = st.current; if (!s) return;
    const ps = [...ptrs.current.values()];
    if (ps.length === 2 && s.dist > 0) {
      const dist = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      const mid = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
      const ns = Math.max(0.02, Math.min(400, s.cam.s * (dist / s.dist))), kk = ns / s.cam.s;
      setCam({ s: ns, tx: mid.x - (s.mid.x - s.cam.tx) * kk, ty: mid.y - (s.mid.y - s.cam.ty) * kk });
      s.moved = true; return;
    }
    if (ps.length !== 1) return;
    const dx = loc.x - s.mid.x, dy = loc.y - s.mid.y;
    if (!s.moved && Math.hypot(dx, dy) > 6) s.moved = true;
    if (!s.moved) return;
    if (s.target === 'compass') {
      const a = Math.atan2(loc.y - CMP.y, loc.x - CMP.x);
      onView({ az: normAz(s.view.az + ((a - s.cAng) * 180) / Math.PI), el: s.view.el });
    } else if (opts.mode === 'orbit') {
      onView({ az: normAz(s.view.az - dx * 0.45), el: clampEl(s.view.el + dy * 0.45) });
    } else {
      setCam({ ...s.cam, tx: s.cam.tx + dx, ty: s.cam.ty + dy });
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const s = st.current;
    const loc = toLocal(e);
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size > 0) { const ps = [...ptrs.current.values()]; st.current = { ...(s ?? { view, cAng: 0, target: 'none' as const }), cam: camRef.current, mid: ps[0], dist: 0, moved: true }; return; }
    st.current = null;
    if (!s || s.moved) return;
    if (s.target === 'compass') { onView({ az: normAz(view.az + 90), el: view.el }); return; }
    if (s.target !== 'none' && s.target) { onTap(s.target); return; }
    if (opts.mode === 'draw') { const v = snap(loc); if (v === 'edge') onDraw(null); else if (v) onDraw(v); }
    else onTap(null);
  };
  const onWheel = (e: React.WheelEvent) => {
    const p = toLocal(e); const k = Math.exp(-e.deltaY * 0.0015);
    const ns = Math.max(0.02, Math.min(400, cam.s * k)), kk = ns / cam.s;
    setCam({ s: ns, tx: p.x - (p.x - cam.tx) * kk, ty: p.y - (p.y - cam.ty) * kk });
  };
  const zoom = (k: number) => setCam((c) => ({ s: c.s * k, tx: W / 2 - (W / 2 - c.tx) * k, ty: H / 2 - (H / 2 - c.ty) * k }));

  return (
    <div className={'isostage mode-' + opts.mode} ref={wrap}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width={W} height={H} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onPointerLeave={() => setGhost(null)} onWheel={onWheel} role="img" aria-label={`Isometric sketch ${d.name}`}>
        <HatchDefs />
        {opts.mode === 'draw' && <PlaneGrid T3={T3} o={P[cursor] ?? [0, 0, 0]} plane={opts.plane} g={GRID * (disp.k || 1)} />}
        <IsoArt d={d} disp={disp} T3={T3} sel={sel} cursor={cursor} opts={opts} prefs={prefs} />
        {ghost && (() => { const a = T3(P[cursor]), b = T3(add(P[cursor], ghost)); return <g className="iso-ghostg"><line className="iso-ghost" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} /><circle className="iso-ghostpt" cx={b[0]} cy={b[1]} r={4} /></g>; })()}
        <Compass x={CMP.x} y={CMP.y} view={view} interactive />
      </svg>
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

function PlaneGrid({ T3, o, plane, g }: { T3: (p: Vec3) => [number, number]; o: Vec3; plane: Plane; g: number }) {
  const { a, b } = PLANES[plane];
  const N = 10;
  const lines: React.ReactNode[] = [];
  for (let i = -N; i <= N; i++) {
    for (const [u, v, key] of [[a, b, 'a'], [b, a, 'b']] as Array<[Vec3, Vec3, string]>) {
      const p1 = T3(add(o, add(mul(u, i * g), mul(v, -N * g)))), p2 = T3(add(o, add(mul(u, i * g), mul(v, N * g))));
      lines.push(<line key={key + i} className={i === 0 ? 'ax' : ''} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} />);
    }
  }
  return <g className="isogrid2">{lines}</g>;
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
    els.push(<line key={'r' + i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={'iso-pipe' + (selected ? ' sel' : '')} />);

    // inline symbol at the middle
    const m: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const sz = Math.min(9, L / 4);
    const along = (t: number, n: number): string => `${(m[0] + ux * t + nx * n).toFixed(1)},${(m[1] + uy * t + ny * n).toFixed(1)}`;
    if (['gate', 'globe', 'check', 'ball', 'butterfly'].includes(r.inline)) {
      els.push(<polygon key={'v' + i} className="iso-sym" points={`${along(-sz, -sz * 0.8)} ${along(sz, sz * 0.8)} ${along(sz, -sz * 0.8)} ${along(-sz, sz * 0.8)}`} />);
      if (r.inline === 'globe' || r.inline === 'ball') els.push(<circle key={'vc' + i} className="iso-symfill" cx={m[0]} cy={m[1]} r={sz * 0.35} />);
      if (r.inline === 'check') els.push(<line key={'vk' + i} className="iso-sym" x1={m[0] + nx * sz * 1.2} y1={m[1] + ny * sz * 1.2} x2={m[0] - nx * sz * 1.2} y2={m[1] - ny * sz * 1.2} />);
      if (r.inline === 'butterfly') els.push(<line key={'vb' + i} className="iso-sym" x1={m[0] - ux * sz} y1={m[1] - uy * sz} x2={m[0] + ux * sz} y2={m[1] + uy * sz} />);
      if (r.inline !== 'check' && r.inline !== 'butterfly') els.push(<line key={'vs' + i} className="iso-sym" x1={m[0]} y1={m[1]} x2={m[0] + nx * sz * 1.4} y2={m[1] + ny * sz * 1.4} />);
    } else if (r.inline === 'flange') {
      for (const t of [-2, 2]) els.push(<line key={'f' + i + t} className="iso-sym thick" x1={m[0] + ux * t + nx * sz} y1={m[1] + uy * t + ny * sz} x2={m[0] + ux * t - nx * sz} y2={m[1] + uy * t - ny * sz} />);
    } else if (r.inline === 'reducer') {
      els.push(<polygon key={'rd' + i} className="iso-sym" points={`${along(-sz, -sz)} ${along(sz, -sz * 0.5)} ${along(sz, sz * 0.5)} ${along(-sz, sz)}`} />);
    } else if (r.inline === 'union') {
      for (const t of [-3, 0, 3]) els.push(<line key={'u' + i + t} className="iso-sym" x1={m[0] + ux * t + nx * sz * 0.8} y1={m[1] + uy * t + ny * sz * 0.8} x2={m[0] + ux * t - nx * sz * 0.8} y2={m[1] + uy * t - ny * sz * 0.8} />);
    } else if (r.inline === 'spool') {
      for (const t of [-3, 3]) els.push(<line key={'sp' + i + t} className="iso-sym" x1={m[0] + ux * t + nx * sz - ux * 2} y1={m[1] + uy * t + ny * sz - uy * 2} x2={m[0] + ux * t - nx * sz + ux * 2} y2={m[1] + uy * t - ny * sz + uy * 2} />);
    }
    // travel dimension on the pipe, or a "needs dimension" marker
    if (opts.dims) {
      if (measured) {
        const txt = formatFtIn(runLength(r), prefs) + (axes.length > 1 ? ' TRAV' : '');
        const lb = label('d' + i, a, b, txt, 'iso-dim', r.inline !== 'none' ? 16 : 11);
        if (lb) els.push(lb);
      } else if (!exportMode && L > 22) {
        const off = r.inline !== 'none' ? 14 : 0;
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
      if (opts.welds) legScreen.forEach(([ux, uy], j) => els.push(<circle key={`w${n}-${j}`} className="iso-weld" cx={p[0] + ux * 7} cy={p[1] + uy * 7} r={2.2} />));
      if (k.kind !== 'elbow') els.push(<circle key={'t' + n} className="iso-symfill" cx={p[0]} cy={p[1]} r={3} />);
      if (k.kind === 'elbow' && Math.abs(k.angle - 90) > 0.05) els.push(<text key={'ea' + n} className="iso-note" x={p[0] + 7} y={p[1] + 15}>{formatNumber(k.angle, 1)}°</text>);
    } else if (k.kind === 'straight') {
      if (opts.welds) els.push(<circle key={'sw' + n} className="iso-weld" cx={p[0]} cy={p[1]} r={2.2} />);
    } else {
      const end = d.ends[n] ?? 'open';
      const [ux, uy] = legScreen[0] ?? [1, 0];
      const nx = -uy, ny = ux;
      if (end === 'cap') els.push(<path key={'c' + n} className="iso-sym" d={`M${p[0] + nx * 6},${p[1] + ny * 6} Q${p[0] - ux * 7},${p[1] - uy * 7} ${p[0] - nx * 6},${p[1] - ny * 6}`} />);
      if (end === 'flange' || end === 'blind') els.push(<line key={'fe' + n} className="iso-sym thick" x1={p[0] + nx * 8} y1={p[1] + ny * 8} x2={p[0] - nx * 8} y2={p[1] - ny * 8} />);
      if (end === 'blind') els.push(<line key={'fb' + n} className="iso-sym thick" x1={p[0] - ux * 3 + nx * 8} y1={p[1] - uy * 3 + ny * 8} x2={p[0] - ux * 3 - nx * 8} y2={p[1] - uy * 3 - ny * 8} />);
      if (end === 'plug') els.push(<rect key={'pl' + n} className="iso-symfill" x={p[0] - 3} y={p[1] - 3} width={6} height={6} />);
      if (end === 'weld') els.push(<g key={'fw' + n}><circle className="iso-weld" cx={p[0]} cy={p[1]} r={3} /><text className="iso-note" x={p[0] + 6} y={p[1] - 6}>FW</text></g>);
      if (end === 'open' && !exportMode) els.push(<circle key={'oe' + n} className="iso-endpt" cx={p[0]} cy={p[1]} r={2.6} />);
    }
    if (!exportMode) {
      const isCursor = n === cursor, isSel = sel?.kind === 'node' && sel.id === n;
      els.push(<circle key={'hn' + n} data-node={n} cx={p[0]} cy={p[1]} r={13} className={'iso-nodehit' + (isCursor ? ' cursor' : '') + (isSel ? ' sel' : '')} />);
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
  d: IsoDrawing; i: number; prefs: Prefs; cut: ReturnType<typeof cutList>[number]; update: (f: (d: IsoDrawing) => IsoDrawing) => void; onClose: () => void; onDelete: () => void;
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
  const setRun = (f: (r: Run) => Run) => update((x) => ({ ...x, runs: x.runs.map((q, k) => (k === i ? f(q) : q)) }));
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
    if (m && len3(m) > 0) setRun((q) => ({ ...q, meas: m, sketch: true }));
    else if (!known.length && T === null) setRun((q) => { const { meas: _m, ...rest } = q; return { ...rest, sketch: true }; });
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
      <Select label="On this line" value={r.inline} options={(Object.keys(INLINE_LABEL) as Inline[]).map((k) => [k, INLINE_LABEL[k]])} onChange={(v) => setRun((q) => ({ ...q, inline: v as Inline }))} />
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
  if (!d.runs.length) return <Card><p className="lead">Draw some lines to see the cut list.</p></Card>;
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
      <Msg kind="info">Dimensions are centerline, fitting center to fitting center. Take-outs assume ASME B16.9 long-radius butt-weld elbows and straight tees in {d.nps}". Valves, flanges and other inline items must be subtracted by hand — they are noted above.</Msg>
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
const EXPORT_CSS = `.iso-pipe{stroke:#111;stroke-width:2.6;stroke-linecap:round}.iso-hit{stroke:none}.iso-sym{fill:#fff;stroke:#111;stroke-width:1.3}.iso-sym.thick{stroke-width:2.4}.iso-symfill{fill:#111}.iso-weld{fill:#111}.iso-dim{font:600 9px sans-serif;fill:#1f7f7a}.iso-legdim{font:600 8px sans-serif;fill:#555}.iso-note{font:600 8px sans-serif;fill:#111}.iso-node{font:600 7px sans-serif;fill:#666}.iso-leader{stroke:#666;stroke-width:.6}.iso-off{fill:none;stroke:#777;stroke-width:.9;stroke-dasharray:4 3}.iso-hatch{stroke:none}.iso-hatchline{stroke:#999;stroke-width:.8}.cmp-ring{fill:#fff;stroke:#bbb}.cmp-n{stroke:#1f7f7a;stroke-width:2.2}.cmp-head{fill:#1f7f7a}.cmp-dir{stroke:#999;stroke-width:1.2}.cmp-up{stroke:#bbb;stroke-width:1;stroke-dasharray:2 2}.cmp-t{font:700 9px sans-serif;fill:#777}.cmp-t.n{fill:#1f7f7a}`;

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
