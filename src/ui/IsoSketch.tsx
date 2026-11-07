import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Field, Msg, Select, Segmented, Card, Grid, useApp } from './components';
import { usePersistent, uid, shareText } from './store';
import { parseLength, tryParse } from '../engine/parse';
import { formatFtIn, formatFracIn, formatNumber } from '../engine/format';
import {
  IsoDrawing, Run, Inline, INLINE_LABEL, EndType, END_LABEL, DIRS, Vec3, newDrawing, nodePositions, nodeKind, nodeLegs,
  cutList, iso, runLength, describeRun,
} from '../engine/iso';
import { B169 } from '../engine/fittings';

interface IsoStore { drawings: IsoDrawing[]; current: string | null }
type Sel = { kind: 'node'; id: number } | { kind: 'run'; id: number } | null;
type View = { s: number; tx: number; ty: number };

const ARROW: Record<string, string> = { N: '↗', S: '↙', E: '↘', W: '↖', U: '↑', D: '↓' };

/** Screen-space layout: to scale, or schematic (direction kept, length compressed so short runs stay visible). */
function layout(d: IsoDrawing, scale: boolean): Array<[number, number]> {
  const pts: Array<[number, number]> = [[0, 0]];
  d.runs.forEach((r, i) => {
    const a = pts[r.from] ?? [0, 0];
    const L = runLength(r) || 1;
    const k = scale ? 1 : (28 + 26 * Math.log2(1 + L / 12)) / L;
    const [sx, sy] = iso([r.dx * k, r.dy * k, r.dz * k]);
    pts[i + 1] = [a[0] + sx, a[1] + sy];
  });
  return pts;
}

export function IsoSketch() {
  const { settings, toast } = useApp();
  const prefs = settings.prefs;
  const [store, setStore] = usePersistent<IsoStore>('iso', { drawings: [], current: null });
  const [sel, setSel] = useState<Sel>(null);
  const [cursor, setCursor] = useState(0); // node new runs start from
  const [lenText, setLenText] = useState(`5'`);
  const [inline, setInline] = useState<Inline>('none');
  const [offset, setOffset] = useState({ open: false, e: '', n: '', u: '' });
  const [opts, setOpts] = usePersistent('isoopts', { dims: true, welds: true, scale: false, labels: false });
  const [panel, setPanel] = useState<'build' | 'cut' | 'library' | 'setup'>('build');
  const [noteText, setNoteText] = useState('');

  // ensure a current drawing exists
  useEffect(() => {
    if (!store.drawings.length) {
      const d = { ...newDrawing('Iso 1', uid()), runs: [] };
      setStore({ drawings: [d], current: d.id });
    } else if (!store.drawings.find((d) => d.id === store.current)) setStore((s) => ({ ...s, current: s.drawings[0].id }));
  }, [store.drawings.length]);
  const d = store.drawings.find((x) => x.id === store.current) ?? store.drawings[0];
  const update = (f: (d: IsoDrawing) => IsoDrawing) => setStore((s) => ({ ...s, drawings: s.drawings.map((x) => (x.id === d.id ? { ...f(x), updated: Date.now() } : x)) }));

  const nodes = d ? d.runs.length + 1 : 1;
  const cur = Math.min(cursor, nodes - 1);

  const parsedLen = tryParse(parseLength, lenText);
  const addRun = (v: Vec3) => {
    if (!parsedLen || !parsedLen.ok || !(parsedLen.v > 0)) { toast('Enter a length first'); return; }
    const L = parsedLen.v;
    const r: Run = { id: uid(), from: cur, dx: v[0] * L, dy: v[1] * L, dz: v[2] * L, inline };
    update((x) => ({ ...x, runs: [...x.runs, r] }));
    setCursor(d.runs.length + 1); setSel({ kind: 'run', id: d.runs.length }); setInline('none');
  };
  const addOffset = () => {
    const p = (s: string) => { const r = tryParse(parseLength, s); if (r && !r.ok) throw new Error(r.err); return r ? r.v : 0; };
    try {
      const e = p(offset.e), n = p(offset.n), u = p(offset.u);
      if (!e && !n && !u) { toast('Enter at least one component'); return; }
      const r: Run = { id: uid(), from: cur, dx: e, dy: n, dz: u, inline };
      update((x) => ({ ...x, runs: [...x.runs, r] }));
      setCursor(d.runs.length + 1); setSel({ kind: 'run', id: d.runs.length }); setInline('none');
      setOffset({ open: false, e: '', n: '', u: '' });
    } catch (err) { toast((err as Error).message); }
  };
  const hasChildren = (node: number) => d.runs.some((r) => r.from === node);
  const deleteRun = (i: number) => {
    if (hasChildren(i + 1)) { toast('Delete the runs after this one first'); return; }
    update((x) => {
      const runs = x.runs.filter((_, k) => k !== i).map((r) => ({ ...r, from: r.from > i + 1 ? r.from - 1 : r.from }));
      const remap = (n: number) => (n > i + 1 ? n - 1 : n);
      const ends: Record<number, EndType> = {};
      Object.entries(x.ends).forEach(([k, v]) => { const n = Number(k); if (n !== i + 1) ends[remap(n)] = v; });
      return { ...x, runs, ends, notes: x.notes.filter((t) => t.node !== i + 1).map((t) => ({ ...t, node: remap(t.node) })) };
    });
    setSel(null); setCursor(Math.max(0, i));
  };
  const undo = () => { if (d.runs.length) deleteRun(d.runs.length - 1); };

  if (!d) return null;
  const P = nodePositions(d);
  const pts = layout(d, opts.scale);
  const cuts = cutList(d);
  const selRun = sel?.kind === 'run' ? d.runs[sel.id] : null;
  const selNode = sel?.kind === 'node' ? sel.id : null;

  return (
    <div className="tool iso">
      <div className="isohead">
        <input className="isoname" value={d.name} aria-label="Drawing name" onChange={(e) => update((x) => ({ ...x, name: e.target.value }))} />
        <span className="muted">{d.nps}" · {d.runs.length} runs</span>
      </div>
      <IsoCanvas d={d} pts={pts} P={P} sel={sel} cursor={cur} opts={opts} prefs={prefs}
        onSelect={(s) => { setSel(s); if (s?.kind === 'node') setCursor(s.id); if (s?.kind === 'run') setCursor(s.id + 1); }} />
      <div className="isotoggles">
        {(['dims', 'welds', 'labels', 'scale'] as const).map((k) => (
          <label key={k} className="chip"><input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} /> {({ dims: 'Dimensions', welds: 'Weld dots', labels: 'Node #', scale: 'To scale' })[k]}</label>
        ))}
      </div>
      <Segmented value={panel} onChange={setPanel} options={[['build', 'Build'], ['cut', 'Cut list'], ['setup', 'Setup'], ['library', 'Library']]} />

      {panel === 'build' && (
        <>
          <Card>
            <div className="row-between"><b>Add run from node {cur}</b>{cur !== d.runs.length && <span className="tag tag-entered">branch → tee</span>}</div>
            <Grid>
              <Field label="Length (center to center)" value={lenText} onChange={setLenText} parse={parseLength} />
              <Select label="On this run" value={inline} options={(Object.keys(INLINE_LABEL) as Inline[]).map((k) => [k, INLINE_LABEL[k]])} onChange={(v) => setInline(v as Inline)} />
            </Grid>
            <div className="dirpad">
              {(['W', 'U', 'N', 'S', 'D', 'E'] as const).map((k) => (
                <button key={k} className="btn dir" aria-label={DIRS[k].label} onClick={() => addRun(DIRS[k].v)}><span className="arr">{ARROW[k]}</span>{DIRS[k].label}</button>
              ))}
            </div>
            <button className="btn" onClick={() => setOffset({ ...offset, open: !offset.open })}>{offset.open ? 'Close offset' : 'Offset / rolling run…'}</button>
            {offset.open && (
              <>
                <p className="fhint">Enter each component of the run (negative for W / S / Down). The fitting angles are worked out from the route.</p>
                <Grid>
                  <Field label="East (− West)" value={offset.e} onChange={(v) => setOffset({ ...offset, e: v })} parse={parseLength} />
                  <Field label="North (− South)" value={offset.n} onChange={(v) => setOffset({ ...offset, n: v })} parse={parseLength} />
                  <Field label="Up (− Down)" value={offset.u} onChange={(v) => setOffset({ ...offset, u: v })} parse={parseLength} />
                </Grid>
                <button className="btn primary" onClick={addOffset}>Add offset run</button>
              </>
            )}
            <div className="actions">
              <button className="btn" onClick={undo} disabled={!d.runs.length}>Undo last</button>
              <button className="btn" onClick={() => { setCursor(d.runs.length); setSel({ kind: 'node', id: d.runs.length }); }}>Go to end</button>
            </div>
            <p className="fhint">Tap a point on the drawing to branch from it (makes a tee). Drag to pan, pinch or use the buttons to zoom.</p>
          </Card>

          {selRun && sel?.kind === 'run' && <RunEditor run={selRun} i={sel.id} d={d} prefs={prefs} cut={cuts[sel.id]}
            onChange={(r) => update((x) => ({ ...x, runs: x.runs.map((q, k) => (k === sel.id ? r : q)) }))} onDelete={() => deleteRun(sel.id)} />}

          {selNode !== null && (
            <Card>
              <b>Point {selNode}</b>
              <NodeInfo d={d} node={selNode} />
              {(['end', 'start-end'] as string[]).includes(nodeKind(d, selNode).kind) && (
                <Select label="End" value={d.ends[selNode] ?? 'open'} options={(Object.keys(END_LABEL) as EndType[]).map((k) => [k, END_LABEL[k]])} onChange={(v) => update((x) => ({ ...x, ends: { ...x.ends, [selNode]: v as EndType } }))} />
              )}
              <Grid>
                <Field label="Note at this point" value={noteText} onChange={setNoteText} placeholder="e.g. TIE-IN TO EXIST. 4&quot; HDR" />
              </Grid>
              <button className="btn" disabled={!noteText.trim()} onClick={() => { update((x) => ({ ...x, notes: [...x.notes, { id: uid(), node: selNode, text: noteText.trim() }] })); setNoteText(''); }}>Add note</button>
              {d.notes.filter((t) => t.node === selNode).map((t) => (
                <div key={t.id} className="row-between"><span>{t.text}</span><button className="chip danger" onClick={() => update((x) => ({ ...x, notes: x.notes.filter((q) => q.id !== t.id) }))}>Remove</button></div>
              ))}
            </Card>
          )}
        </>
      )}

      {panel === 'cut' && <CutPanel d={d} cuts={cuts} prefs={prefs} onShare={async (t) => { const m = await shareText(t); if (m) toast(m); }} />}

      {panel === 'setup' && <SetupPanel d={d} pts={pts} opts={opts} prefs={prefs} update={update} toast={toast} />}

      {panel === 'library' && <Library store={store} setStore={setStore} onOpen={(id) => { setStore((s) => ({ ...s, current: id })); setSel(null); setCursor(0); setPanel('build'); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ canvas
function IsoCanvas({ d, pts, P, sel, cursor, opts, prefs, onSelect }: {
  d: IsoDrawing; pts: Array<[number, number]>; P: Vec3[]; sel: Sel; cursor: number;
  opts: { dims: boolean; welds: boolean; scale: boolean; labels: boolean }; prefs: ReturnType<typeof useApp>['settings']['prefs']; onSelect: (s: Sel) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const W = 360, H = 300;
  const bbox = useMemo(() => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }, [pts]);
  const fit = (): View => {
    const w = Math.max(40, bbox.x1 - bbox.x0), h = Math.max(40, bbox.y1 - bbox.y0);
    const s = Math.min((W - 90) / w, (H - 80) / h, opts.scale ? 50 : 2.5);
    return { s, tx: W / 2 - ((bbox.x0 + bbox.x1) / 2) * s, ty: H / 2 - ((bbox.y0 + bbox.y1) / 2) * s };
  };
  const [view, setView] = useState<View>(fit);
  const [autoFit, setAutoFit] = useState(true);
  useEffect(() => { if (autoFit) setView(fit()); }, [pts.length, opts.scale, d.id, JSON.stringify(bbox)]);

  // pan & pinch
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ view: View; dist: number; mid: { x: number; y: number }; moved: boolean } | null>(null);
  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const onDown = (e: React.PointerEvent) => {
    ptrs.current.set(e.pointerId, toLocal(e));
    const ps = [...ptrs.current.values()];
    const mid = ps.length === 2 ? { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 } : ps[0];
    start.current = { view, dist: ps.length === 2 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0, mid, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId) || !start.current) return;
    ptrs.current.set(e.pointerId, toLocal(e));
    const ps = [...ptrs.current.values()];
    const st = start.current;
    if (ps.length === 2 && st.dist > 0) {
      const dist = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      const k = dist / st.dist;
      const mid = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
      const s = Math.max(0.05, Math.min(200, st.view.s * k));
      const kk = s / st.view.s;
      setView({ s, tx: mid.x - (st.mid.x - st.view.tx) * kk, ty: mid.y - (st.mid.y - st.view.ty) * kk });
      st.moved = true; setAutoFit(false);
    } else if (ps.length === 1) {
      const dx = ps[0].x - st.mid.x, dy = ps[0].y - st.mid.y;
      if (Math.hypot(dx, dy) > 4) { st.moved = true; setAutoFit(false); }
      if (st.moved) setView({ ...st.view, tx: st.view.tx + dx, ty: st.view.ty + dy });
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const st = start.current;
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size === 0) {
      if (st && !st.moved) {
        const t = (e.target as Element).closest('[data-node],[data-run]');
        if (t?.getAttribute('data-node')) onSelect({ kind: 'node', id: Number(t.getAttribute('data-node')) });
        else if (t?.getAttribute('data-run')) onSelect({ kind: 'run', id: Number(t.getAttribute('data-run')) });
        else onSelect(null);
      }
      start.current = null;
    } else {
      const ps = [...ptrs.current.values()];
      start.current = { view, dist: 0, mid: ps[0], moved: true };
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    const p = toLocal(e); const k = Math.exp(-e.deltaY * 0.0015);
    const s = Math.max(0.05, Math.min(200, view.s * k)), kk = s / view.s;
    setView({ s, tx: p.x - (p.x - view.tx) * kk, ty: p.y - (p.y - view.ty) * kk }); setAutoFit(false);
  };
  const zoom = (k: number) => { const s = view.s * k; setView({ s, tx: W / 2 - (W / 2 - view.tx) * k, ty: H / 2 - (H / 2 - view.ty) * k }); setAutoFit(false); };

  const T = (p: [number, number]): [number, number] => [p[0] * view.s + view.tx, p[1] * view.s + view.ty];
  return (
    <div className="isocanvas">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel} role="img" aria-label={`Isometric sketch ${d.name}`}>
        <IsoGrid W={W} H={H} />
        <IsoArt d={d} T={T} pts={pts} P={P} sel={sel} cursor={cursor} opts={opts} prefs={prefs} />
        <NorthArrow x={30} y={36} />
      </svg>
      <div className="isozoom">
        <button className="cbtn" aria-label="Zoom in" onClick={() => zoom(1.3)}>+</button>
        <button className="cbtn" aria-label="Zoom out" onClick={() => zoom(1 / 1.3)}>−</button>
        <button className="cbtn" onClick={() => { setAutoFit(true); setView(fit()); }}>Fit</button>
      </div>
    </div>
  );
}

function IsoGrid({ W, H }: { W: number; H: number }) {
  const lines: React.ReactNode[] = [];
  const step = 24, c = Math.tan(Math.PI / 6);
  for (let k = -H; k < W + H; k += step) {
    lines.push(<line key={'a' + k} x1={k} y1={0} x2={k - H / c} y2={H} />);
    lines.push(<line key={'b' + k} x1={k} y1={0} x2={k + H / c} y2={H} />);
  }
  return <g className="isogrid">{lines}</g>;
}

function NorthArrow({ x, y }: { x: number; y: number }) {
  const [nx, ny] = iso([0, 1, 0]);
  const L = 18;
  return (
    <g className="isonorth">
      <line x1={x} y1={y} x2={x + nx * L} y2={y + ny * L} markerEnd="url(#isoarr)" />
      <text x={x + nx * L + 3} y={y + ny * L - 2}>N</text>
      <defs><marker id="isoarr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" /></marker></defs>
    </g>
  );
}

/** Drawing content in screen coordinates. Shared by the canvas and the image export. */
export function IsoArt({ d, T, pts, P, sel, cursor, opts, prefs, exportMode }: {
  d: IsoDrawing; T: (p: [number, number]) => [number, number]; pts: Array<[number, number]>; P: Vec3[]; sel: Sel; cursor: number;
  opts: { dims: boolean; welds: boolean; labels: boolean }; prefs: ReturnType<typeof useApp>['settings']['prefs']; exportMode?: boolean;
}) {
  const S = pts.map(T);
  const els: React.ReactNode[] = [];
  const unit = (a: [number, number], b: [number, number]) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L, L] as const; };
  // runs
  d.runs.forEach((r, i) => {
    const a = S[r.from], b = S[i + 1];
    const [ux, uy, L] = unit(a, b);
    const nx = -uy, ny = ux;
    const selected = sel?.kind === 'run' && sel.id === i;
    els.push(<line key={'hit' + i} data-run={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="iso-hit" />);
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
    // dimension
    if (opts.dims && L > 14) {
      const off = 12;
      const side = ny > 0 || (Math.abs(ny) < 1e-6 && nx < 0) ? -1 : 1; // keep labels above the line
      const lx = m[0] + nx * off * side, ly = m[1] + ny * off * side;
      let ang = (Math.atan2(uy, ux) * 180) / Math.PI;
      if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      const txt = formatFtIn(runLength(r), prefs);
      const axes = [r.dx, r.dy, r.dz].filter((v) => v !== 0).length;
      els.push(<text key={'d' + i} className="iso-dim" x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${ang} ${lx} ${ly})`}>{txt}{axes > 1 ? ' TRAV' : ''}</text>);
    }
    if (opts.labels) els.push(<text key={'rl' + i} className="iso-node" x={m[0] - nx * 10} y={m[1] - ny * 10 + 3} textAnchor="middle">R{i + 1}</text>);
  });
  // nodes
  const nNodes = d.runs.length + 1;
  for (let n = 0; n < nNodes; n++) {
    const p = S[n]; if (!p) continue;
    const k = nodeKind(d, n);
    const legs = nodeLegs(d, n);
    // weld dots a short distance along each leg on screen
    const legScreen = legs.map((l) => { const r = d.runs[l.run]; const other = r.from === n ? S[l.run + 1] : S[r.from]; const [ux, uy] = unit(p, other); return [ux, uy] as const; });
    if (k.kind === 'elbow' || k.kind === 'tee' || k.kind === 'cross') {
      if (opts.welds) legScreen.forEach(([ux, uy], j) => els.push(<circle key={`w${n}-${j}`} className="iso-weld" cx={p[0] + ux * 7} cy={p[1] + uy * 7} r={2.2} />));
      if (k.kind !== 'elbow') els.push(<circle key={'t' + n} className="iso-symfill" cx={p[0]} cy={p[1]} r={3} />);
      if (k.kind === 'elbow' && Math.abs(k.angle - 90) > 0.05) els.push(<text key={'ea' + n} className="iso-note" x={p[0] + 6} y={p[1] + 14}>{formatNumber(k.angle, 1)}°</text>);
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
    }
    const isCursor = n === cursor && !exportMode;
    const isSel = sel?.kind === 'node' && sel.id === n;
    if (!exportMode) els.push(<circle key={'hn' + n} data-node={n} cx={p[0]} cy={p[1]} r={11} className={'iso-nodehit' + (isCursor ? ' cursor' : '') + (isSel ? ' sel' : '')} />);
    if (opts.labels) els.push(<text key={'nl' + n} className="iso-node" x={p[0] + 7} y={p[1] - 7}>{n}</text>);
  }
  // notes
  d.notes.forEach((t, j) => {
    const p = S[t.node]; if (!p) return;
    const lx = p[0] + 22, ly = p[1] - 18 - (j % 3) * 12;
    els.push(<g key={'n' + t.id}><line className="iso-leader" x1={p[0]} y1={p[1]} x2={lx - 2} y2={ly + 2} /><text className="iso-note" x={lx} y={ly}>{t.text}</text></g>);
  });
  return <g>{els}</g>;
}

// ------------------------------------------------------------------ panels
function NodeInfo({ d, node }: { d: IsoDrawing; node: number }) {
  const k = nodeKind(d, node);
  const e = B169[d.nps];
  const txt = k.kind === 'elbow' ? `${formatNumber(k.angle, 2)}° elbow${k.angle > 90.05 ? ' — more than 90°: needs two fittings' : e ? ` · take-out ${formatNumber(Math.abs(k.angle - 90) < 0.05 ? e.lr90 : Math.abs(k.angle - 45) < 0.05 ? e.lr45 : e.lr90 * Math.tan((k.angle * Math.PI) / 360), 3)}"` : ''}`
    : k.kind === 'tee' ? 'Tee' : k.kind === 'cross' ? 'Cross' : k.kind === 'straight' ? 'Straight-through butt weld' : k.kind === 'multi' ? `${k.count} runs meet here` : 'End of line';
  return <p className="fhint">{txt}</p>;
}

function RunEditor({ run, i, d, prefs, cut, onChange, onDelete }: { run: Run; i: number; d: IsoDrawing; prefs: ReturnType<typeof useApp>['settings']['prefs']; cut: ReturnType<typeof cutList>[number]; onChange: (r: Run) => void; onDelete: () => void }) {
  const L = runLength(run);
  const [text, setText] = useState(formatFtIn(L, prefs));
  useEffect(() => setText(formatFtIn(L, prefs)), [run.id, i]);
  const apply = (s: string) => {
    setText(s);
    const r = tryParse(parseLength, s);
    if (r && r.ok && r.v > 0 && L > 0) { const k = r.v / L; onChange({ ...run, dx: run.dx * k, dy: run.dy * k, dz: run.dz * k }); }
  };
  const axes = [run.dx, run.dy, run.dz].filter((v) => v !== 0).length;
  return (
    <Card>
      <div className="row-between"><b>Run {i + 1}: {describeRun(run)}</b><span className="muted">from point {run.from}</span></div>
      <Grid>
        <Field label={axes > 1 ? 'Travel (scales all components)' : 'Length'} value={text} onChange={apply} parse={parseLength} />
        <Select label="On this run" value={run.inline} options={(Object.keys(INLINE_LABEL) as Inline[]).map((k) => [k, INLINE_LABEL[k]])} onChange={(v) => onChange({ ...run, inline: v as Inline })} />
      </Grid>
      {axes > 1 && <p className="fhint">E {formatFtIn(run.dx, prefs)} · N {formatFtIn(run.dy, prefs)} · Up {formatFtIn(run.dz, prefs)}</p>}
      <p className="fhint">Cut length {cut.ok ? formatFracIn(cut.cut, prefs) : 'impossible — fittings longer than the run'}{cut.note.length ? ` · ${cut.note.join('; ')}` : ''}</p>
      <button className="btn danger" onClick={onDelete}>Delete run</button>
    </Card>
  );
}

function CutPanel({ d, cuts, prefs, onShare }: { d: IsoDrawing; cuts: ReturnType<typeof cutList>; prefs: ReturnType<typeof useApp>['settings']['prefs']; onShare: (t: string) => void }) {
  if (!d.runs.length) return <Card><p className="lead">Add runs to see the cut list.</p></Card>;
  const total = cuts.reduce((s, c) => s + Math.max(0, c.cut), 0);
  const text = [`${d.name} — ${d.nps}" pipe, gap ${formatFracIn(d.gap, prefs)}`, ...cuts.map((c) => `Run ${c.run + 1} ${describeRun(d.runs[c.run])}: C-C ${formatFtIn(c.travel, prefs)}, CUT ${c.ok ? formatFtIn(c.cut, prefs) : 'IMPOSSIBLE'}${c.note.length ? ' (' + c.note.join('; ') + ')' : ''}`), `Total pipe ${formatFtIn(total, prefs)}`].join('\n');
  return (
    <Card>
      <h4>Cut list · {d.nps}" · gap {formatFracIn(d.gap, prefs)}</h4>
      <div className="tablewrap">
        <table className="dtable">
          <thead><tr><th>Run</th><th>C-C</th><th>Deduct</th><th>Cut</th></tr></thead>
          <tbody>{cuts.map((c) => (
            <tr key={c.run} className={c.ok ? '' : 'bad'}><th>{c.run + 1}<small className="muted"> {describeRun(d.runs[c.run])}</small></th><td>{formatFtIn(c.travel, prefs)}</td><td>{formatFracIn(c.to1 + c.to2 + c.gaps, prefs)}</td><td><b>{c.ok ? formatFtIn(c.cut, prefs) : 'impossible'}</b></td></tr>
          ))}</tbody>
        </table>
      </div>
      {cuts.some((c) => c.note.length) && <ul className="fhint">{cuts.filter((c) => c.note.length).map((c) => <li key={c.run}>Run {c.run + 1}: {c.note.join('; ')}</li>)}</ul>}
      <p><b>Total pipe: {formatFtIn(total, prefs)}</b></p>
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
          <div className="ihead"><b>{x.name}</b><span className="muted">{x.runs.length} runs · {new Date(x.updated).toLocaleDateString()}</span></div>
          <div className="iact">
            <button className="chip" onClick={() => onOpen(x.id)}>Open</button>
            <button className="chip" onClick={() => { const c = { ...JSON.parse(JSON.stringify(x)), id: uid(), name: x.name + ' copy', created: Date.now(), updated: Date.now() }; setStore((s) => ({ ...s, drawings: [c, ...s.drawings] })); }}>Duplicate</button>
            {armed === x.id
              ? <><button className="chip danger" onClick={() => { setStore((s) => { const ds = s.drawings.filter((q) => q.id !== x.id); return { drawings: ds, current: s.current === x.id ? ds[0]?.id ?? null : s.current }; }); setArmed(null); }}>Delete for good</button><button className="chip" onClick={() => setArmed(null)}>Cancel</button></>
              : <button className="chip danger" onClick={() => setArmed(x.id)}>Delete</button>}
          </div>
        </div>
      ))}
      <p className="fhint">Drawings are saved on this device.</p>
    </Card>
  );
}

// ------------------------------------------------------------------ setup + image export
type Prefs = ReturnType<typeof useApp>['settings']['prefs'];
function SetupPanel({ d, pts, opts, prefs, update, toast }: { d: IsoDrawing; pts: Array<[number, number]>; opts: { dims: boolean; welds: boolean; labels: boolean }; prefs: Prefs; update: (f: (d: IsoDrawing) => IsoDrawing) => void; toast: (m: string) => void }) {
  const [gap, setGap] = useState(formatFracIn(d.gap, prefs));
  useEffect(() => setGap(formatFracIn(d.gap, prefs)), [d.id]);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 400, H = 300;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = Math.min((W - 100) / Math.max(40, x1 - x0), (H - 90) / Math.max(40, y1 - y0), 50);
  const T = (p: [number, number]): [number, number] => [(p[0] - (x0 + x1) / 2) * s + W / 2, (p[1] - (y0 + y1) / 2) * s + H / 2 - 6];
  return (
    <Card>
      <Grid>
        <Select label="Pipe size (for take-outs)" value={d.nps} options={Object.keys(B169).map((n) => [n, `${n}" NPS`])} onChange={(v) => update((x) => ({ ...x, nps: v }))} />
        <Field label="Butt-weld root gap" value={gap} parse={parseLength} hint="used at every butt weld in the cut list"
          onChange={(v) => { setGap(v); const r = tryParse(parseLength, v); if (r && r.ok && r.v >= 0 && r.v < 1) update((x) => ({ ...x, gap: r.v })); }} />
      </Grid>
      <p className="fhint">Take-outs use ASME B16.9 long-radius elbows (90°, 45°, other angles cut from a 90°) and straight tees for the selected size.</p>
      <div className="actions">
        <button className="btn primary" onClick={() => svgRef.current && shareImage(d, svgRef.current.outerHTML, W, H).then((m) => m && toast(m))}>Share drawing as image</button>
      </div>
      <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={W * 3} height={H * 3} viewBox={`0 0 ${W} ${H}`} style={{ display: 'none' }}>
        <rect width={W} height={H} fill="#fff" />
        <IsoArt d={d} T={T} pts={pts} P={nodePositions(d)} sel={null} cursor={-1} opts={opts} prefs={prefs} exportMode />
        <NorthArrow x={24} y={30} />
        <text x={8} y={H - 10} style={{ font: '700 9px sans-serif', fill: '#111' }}>{d.name} · {d.nps}" NPS · Ridgecrest Pipe Calculator</text>
      </svg>
    </Card>
  );
}
const EXPORT_CSS = `.iso-pipe{stroke:#111;stroke-width:2.6;stroke-linecap:round}.iso-hit{stroke:none}.iso-sym{fill:#fff;stroke:#111;stroke-width:1.3}.iso-sym.thick{stroke-width:2.4}.iso-symfill{fill:#111}.iso-weld{fill:#111}.iso-dim{font:600 9px sans-serif;fill:#1f7f7a}.iso-note{font:600 8px sans-serif;fill:#111}.iso-node{font:600 7px sans-serif;fill:#666}.iso-leader{stroke:#666;stroke-width:.6}.isonorth line{stroke:#444;stroke-width:1.4}.isonorth path{fill:#444}.isonorth text{font:700 10px sans-serif;fill:#444}`;

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
