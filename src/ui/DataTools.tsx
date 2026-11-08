import { npsNumber } from '../engine/fittings';
import React from 'react';
import { Field, Results, Row, Msg, Formula, ToolActions, Segmented, Select, useTool, Card, Grid, useApp } from './components';
import { parseLength, parseMeasurement, tryParse } from '../engine/parse';
import { formatFracIn, formatNumber } from '../engine/format';
import { CalcError } from '../engine/units';
import {
  FLANGE_CLASSES, FlangeClass, Flange, flange, flangeSizes, FLANGE_SOURCE, STUD_SOURCE, RING_SOURCE, boltTorque, tighteningSequence, boltTPI,
  spiralGasket, SW_GASKET_SOURCE, bwFitting, B169_FIT_SOURCE, socketWeld, B1611_SOURCE, threadedFitting, THREADED_KINDS, THREADED_LABEL,
  ThreadedKind, threadedSizes, NPT_SOURCE, B163_SOURCE, VALVE_CLASSES, VALVE_LABEL, ValveType, valveFaceToFace, VALVE_SOURCE, SIZES,
  WELDOLET_A, weldolet, OLET_SOURCE, SUPPORT_SPAN, SUPPORT_SOURCE, pipeVolume, pipeSurface, pipeSpacing, heavyHexAcrossFlats,
} from '../engine/refdata';
import { B169, B169_SOURCE, steelOD } from '../engine/fittings';
import { pipeProps, sizesFor, typesFor } from '../engine/pipedata';

function attempt<T>(f: () => T): { ok: true; v: T } | { ok: false; err: string } {
  try { return { ok: true, v: f() }; } catch (e) { return { ok: false, err: (e as Error).message }; }
}
const val = <T,>(fn: (s: string) => T, s: string): T | undefined => {
  const r = tryParse(fn, s);
  if (r === null) return undefined;
  if (!r.ok) throw new CalcError('INPUT', r.err);
  return r.v;
};

/** Dimension shown as a fraction with decimal inches and mm underneath. */
function useDim() {
  const { settings } = useApp();
  return (v: number | null | undefined, label: string, extra: Partial<Row> = {}): Row => v == null
    ? { label, value: '—', sub: 'not in source table', ...extra }
    : { label, value: formatFracIn(v, settings.prefs), sub: `${formatNumber(v, 3, 8)} in · ${formatNumber(v * 25.4, 1, 8)} mm`, ...extra };
}
const SRC = ({ children }: { children: React.ReactNode }) => <p className="src">Source: {children}</p>;
const CLASS_OPTS = (cs: readonly number[]): Array<[string, string]> => cs.map((c) => [String(c), `Class ${c}`]);
const NPS_OPTS = (ns: readonly string[]): Array<[string, string]> => [...ns].sort((a, b) => (npsNumber(a) ?? 0) - (npsNumber(b) ?? 0)).map((n) => [n, `${n}"`]);

export function DataTools() {
  const [t, set] = useTool('data', { tab: 'flange' });
  const tabs: Array<[string, string]> = [['flange', 'Flanges'], ['bolting', 'Bolting'], ['gasket', 'Gaskets'], ['fitting', 'Fittings'], ['valve', 'Valves'], ['pipe', 'Pipe & supports']];
  return (
    <div className="tool">
      <div className="chipgrid" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={t.tab === k} className={t.tab === k ? 'on' : ''} onClick={() => set('tab', k)}>{l}</button>)}
      </div>
      {t.tab === 'flange' && <FlangeView />}
      {t.tab === 'bolting' && <BoltingView />}
      {t.tab === 'gasket' && <GasketView />}
      {t.tab === 'fitting' && <FittingView />}
      {t.tab === 'valve' && <ValveView />}
      {t.tab === 'pipe' && <PipeExtras />}
    </div>
  );
}

// ------------------------------------------------------------------ class + size picker shared by flanges/bolting/gaskets
function useClassSize(id: string, def = { cls: '150', nps: '4' }) {
  const [inp, set] = useTool(id, def);
  const cls = Number(inp.cls) as FlangeClass;
  const sizes = flangeSizes(cls);
  const nps = sizes.includes(inp.nps) ? inp.nps : sizes[sizes.length > 9 ? 9 : 0];
  return { inp, set, cls, nps, sizes };
}
function ClassSize({ p }: { p: ReturnType<typeof useClassSize> }) {
  return (
    <Grid>
      <Select label="Pressure class" value={String(p.cls)} options={CLASS_OPTS(FLANGE_CLASSES)} onChange={(v) => p.set('cls', v)} />
      <Select label="Nominal size" value={p.nps} options={NPS_OPTS(p.sizes)} onChange={(v) => p.set('nps', v)} />
    </Grid>
  );
}

// ------------------------------------------------------------------ flanges
const FTYPES: Array<[string, string]> = [['WN', 'Weld neck'], ['SO', 'Slip-on'], ['SW', 'Socket weld'], ['THD', 'Threaded'], ['LJ', 'Lap joint'], ['BL', 'Blind']];
function FlangeView() {
  const p = useClassSize('dflange');
  const [x, setX] = useTool('dflange2', { type: 'WN', table: '' });
  const dim = useDim();
  const prefs = useAppPrefs();
  const r = attempt(() => flange(p.cls, p.nps));
  const f = r.ok ? r.v : null;
  const y = f ? (x.type === 'WN' ? f.yWN : x.type === 'LJ' ? f.yLJ : x.type === 'BL' ? null : f.ySO) : null;
  const rows: Row[] = f ? [
    dim(f.od, 'Outside diameter O', { strong: true }),
    dim(f.boltCircle, 'Bolt circle', { strong: true }),
    { label: 'Bolts', value: `${f.nBolts} × ${formatFracIn(f.boltDia, prefs)}`, sub: `holes ${formatNumber(f.holeDia, 3)} in`, strong: true },
    dim(f.tf, 'Thickness tf', { sub: `${formatNumber(f.tf, 3)} in, excludes ${f.rfHeight === 0.06 ? '1/16"' : '1/4"'} raised face` }),
    dim(f.rfDia, 'Raised face diameter R'),
    dim(f.rfHeight, 'Raised face height'),
    ...(x.type !== 'BL' ? [dim(f.hubDia, 'Hub diameter X (at base)')] : []),
    ...(x.type === 'BL' ? [] : [dim(y, `Length through hub Y (${FTYPES.find((t) => t[0] === x.type)![1].toLowerCase()})`, y == null ? { sub: x.type === 'SO' || x.type === 'SW' || x.type === 'THD' ? 'not made in this size/class' : 'not in source' } : {})]),
    ...(x.type === 'SW' ? [dim(f.socketDepth, 'Socket depth D', f.socketDepth == null ? { sub: 'no socket-weld flange in this size/class' } : {})] : []),
    dim(f.studRF, 'Stud length, raised face'),
    dim(f.studRTJ, 'Stud length, ring joint'),
    { label: 'Nut wrench (heavy hex)', value: formatFracIn(f.wrench, prefs), sub: `1.5 × D + 1/8 (ASME B18.2.2)` },
    { label: 'Ring gasket (RTJ)', value: f.ring ?? '—', sub: f.ring ? undefined : 'not included for this class' },
  ] : [];
  return (
    <>
      {f && <FlangeDiagram f={f} type={x.type} fmt={(v) => formatFracIn(v, prefs)} />}
      <Card>
        <ClassSize p={p} />
        <Select label="Flange type" value={x.type} options={FTYPES} onChange={(v) => setX('type', v)} />
        {!r.ok && <Msg>{r.err}</Msg>}
      </Card>
      {f && <Results title={`Class ${p.cls} · NPS ${p.nps} · ASME B16.5`} rows={rows} />}
      <Card>
        <label className="toggle sm"><input type="checkbox" checked={x.table === '1'} onChange={(e) => setX('table', e.target.checked ? '1' : '')} /> Show the full Class {p.cls} table</label>
        {x.table === '1' && <FlangeTable cls={p.cls} />}
        <SRC>{FLANGE_SOURCE} Stud lengths: {STUD_SOURCE} {RING_SOURCE}</SRC>
      </Card>
      <ToolActions tool="dflange" title={`Flange ${p.cls}# ${p.nps}"`} inputs={{ ...p.inp, ...x }} summary={f ? `B16.5 Class ${p.cls} NPS ${p.nps}: OD ${f.od}, BC ${f.boltCircle}, ${f.nBolts} × ${f.boltDia}" bolts, studs RF ${f.studRF ?? '—'} / RTJ ${f.studRTJ ?? '—'}, tf ${f.tf}, WN Y ${f.yWN}` : ''} disabled={!f} />
    </>
  );
}
function useAppPrefs() { return useApp().settings.prefs; }

function FlangeTable({ cls }: { cls: FlangeClass }) {
  const sizes = flangeSizes(cls);
  const n = (v: number | null) => (v == null ? '—' : formatNumber(v, 2));
  return (
    <div className="tablewrap">
      <table className="dtable">
        <thead><tr><th>NPS</th><th>O</th><th>tf</th><th>R</th><th>X</th><th>BC</th><th>Bolts</th><th>Y WN</th><th>Y SO</th><th>Y LJ</th><th>Stud RF</th><th>Stud RTJ</th></tr></thead>
        <tbody>
          {sizes.map((s) => { const f = flange(cls, s); return (
            <tr key={s}><th>{s}</th><td>{n(f.od)}</td><td>{n(f.tf)}</td><td>{n(f.rfDia)}</td><td>{n(f.hubDia)}</td><td>{n(f.boltCircle)}</td><td>{f.nBolts}×{n(f.boltDia)}</td><td>{n(f.yWN)}</td><td>{n(f.ySO)}</td><td>{n(f.yLJ)}</td><td>{n(f.studRF)}</td><td>{n(f.studRTJ)}</td></tr>
          ); })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * To-scale flange drawing built from the selected B16.5 row: full cross-section on the left (hatched = cut
 * material, cut through a bolt hole), face view on the right. Pipe OD/ID are ASME B36.10M standard weight.
 */
function FlangeDiagram({ f, type, fmt }: { f: Flange; type: string; fmt: (v: number) => string }) {
  const A = steelOD(f.nps);
  let pid: number;
  try { pid = pipeProps('steel', 'Std', f.nps).id; } catch { pid = A * 0.88; }
  const lap = type === 'LJ', blind = type === 'BL';
  const rfH = lap ? 0 : f.rfHeight;
  const Y = blind ? f.tf : type === 'WN' ? f.yWN : type === 'LJ' ? (f.yLJ ?? f.tf) : (f.ySO ?? f.yWN);
  const made = !(type !== 'WN' && type !== 'BL' && type !== 'LJ' && f.ySO == null) && !(type === 'SW' && f.socketDepth == null);

  // ---- section view geometry (inches), x along the axis from the raised-face front, r from centerline
  const x1 = rfH, x2 = rfH + f.tf, x3 = rfH + Y;
  const boreFace = type === 'WN' || type === 'SW' ? pid : A + 0.07; // SO/THD/LJ bores fit over the pipe
  const top: Array<[number, number]> = [];
  if (blind) {
    top.push([0, 0], [0, f.rfDia / 2], [x1, f.rfDia / 2], [x1, f.od / 2], [x2, f.od / 2], [x2, 0]);
  } else {
    const rB = boreFace / 2;
    if (lap) top.push([0, rB + 0.12], [0.12, rB]); else top.push([0, rB]);
    if (!lap) top.push([0, f.rfDia / 2], [x1, f.rfDia / 2]);
    top.push([x1, f.od / 2], [x2, f.od / 2]);
    if (type === 'WN') {
      const t = (A - pid) / 2, land = Math.min(0.0625, t * 0.3), bev = Math.max(0, (t - land) * Math.tan((37.5 * Math.PI) / 180));
      top.push([x2, f.hubDia / 2], [x3 - bev, A / 2], [x3, pid / 2 + land], [x3, pid / 2]);
    } else {
      top.push([x2, f.hubDia / 2], [x3, f.hubDia / 2 - (type === 'SO' || type === 'SW' || type === 'THD' ? 0 : 0)]);
      if (type === 'SW') { const D = f.socketDepth ?? 0.5; top.push([x3, (A + 0.07) / 2], [x3 - D, (A + 0.07) / 2], [x3 - D, pid / 2]); }
      else top.push([x3, rB]);
    }
  }

  // ---- fit into the left box
  const L = x3, H = f.od;
  const boxX = 60, boxW = 154, cy = 206, maxHalf = 176;
  const s = Math.min(boxW / L, maxHalf / (H / 2));
  const ox = boxX + (boxW - L * s) / 2;
  const X = (x: number) => ox + x * s, Yt = (r: number) => cy - r * s, Yb = (r: number) => cy + r * s;
  const poly = (fy: (r: number) => number) => top.map(([x, r]) => `${X(x).toFixed(1)},${fy(r).toFixed(1)}`).join(' ');
  const holeTop = [f.boltCircle / 2 - f.holeDia / 2, f.boltCircle / 2 + f.holeDia / 2];
  const half = H / 2;

  // ---- face view
  const fx = 282, fy = 104, fR = 46, k = fR / half;
  const holes = Array.from({ length: f.nBolts }, (_, i) => { const a = -Math.PI / 2 + Math.PI / f.nBolts + (i / f.nBolts) * 2 * Math.PI; return [fx + (f.boltCircle / 2) * k * Math.cos(a), fy + (f.boltCircle / 2) * k * Math.sin(a)]; });
  const typeName = FTYPES.find((t) => t[0] === type)![1];

  return (
    <figure className="diagram">
      <svg viewBox="0 0 340 262" role="img" aria-label={`${typeName} flange, Class ${f.cls}, NPS ${f.nps}, to scale`}>
        <defs>
          <marker id="fa" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" className="dg-arrowhead" /></marker>
          <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" className="dg-hatch" /></pattern>
        </defs>
        {/* section */}
        <polygon className="dg-section" points={poly(Yt)} />
        {!blind && [Yt].map((fyy, i) => (
          <g key={i}>
            <rect className="dg-hole" x={X(x1)} y={Math.min(fyy(holeTop[0]), fyy(holeTop[1]))} width={(x2 - x1) * s} height={f.holeDia * s} />
            <line className="dg-center" x1={X(x1) - 4} x2={X(x2) + 4} y1={fyy(f.boltCircle / 2)} y2={fyy(f.boltCircle / 2)} />
          </g>
        ))}
        {blind && [Yt].map((fyy, i) => <rect key={i} className="dg-hole" x={X(x1)} y={Math.min(fyy(holeTop[0]), fyy(holeTop[1]))} width={(x2 - x1) * s} height={f.holeDia * s} />)}
        {type === 'THD' && [Yt].map((fyy, i) => <line key={i} className="dg-thread" x1={X(0)} x2={X(x3)} y1={fyy(A / 2 + 0.035)} y2={fyy(A / 2 + 0.035)} />)}
        <line className="dg-center" x1={X(0) - 8} x2={X(x3) + 8} y1={cy} y2={cy} />
        {/* O, dimensioned from the centerline */}
        <line className="dg-ext" x1={X(x1) - 2} x2={boxX - 44} y1={Yt(half)} y2={Yt(half)} />
        <line className="dg-dim" x1={boxX - 40} x2={boxX - 40} y1={cy} y2={Yt(half)} markerEnd="url(#fa)" />
        <text className="dg-lbl sm" transform={`translate(${boxX - 46} ${(cy + Yt(half)) / 2}) rotate(-90)`} textAnchor="middle">Ø O {fmt(f.od)}</text>
        <text className="dg-lbl sm" x={X(x3) + 8} y={cy + 4}>℄ pipe</text>
        {/* tf */}
        <line className="dg-dim" x1={X(x1)} x2={X(x2)} y1={Yt(half) - 9} y2={Yt(half) - 9} markerStart="url(#fa)" markerEnd="url(#fa)" />
        <text className="dg-lbl sm" x={(X(x1) + X(x2)) / 2} y={Yt(half) - 14} textAnchor="middle">tf {fmt(f.tf)}</text>
        {/* Y */}
        {!blind && made && <>
          <line className="dg-ext" x1={X(x1)} x2={X(x1)} y1={Yt(boreFace / 2) + 2} y2={cy + 18} />
          <line className="dg-ext" x1={X(x3)} x2={X(x3)} y1={Yt(boreFace / 2) + 2} y2={cy + 18} />
          <line className="dg-dim" x1={X(x1)} x2={X(x3)} y1={cy + 13} y2={cy + 13} markerStart="url(#fa)" markerEnd="url(#fa)" />
          <text className="dg-lbl sm" x={(X(x1) + X(x3)) / 2} y={cy + 27} textAnchor="middle">Y {fmt(Y)}</text>
        </>}
        {/* callouts */}
        {!lap && <><line className="dg-ext" x1={X(0) - 2} x2={X(0) - 12} y1={Yt(f.rfDia / 2 - 0.15)} y2={Yt(f.rfDia / 2 - 0.15)} /><text className="dg-lbl sm acc" x={X(0) - 14} y={Yt(f.rfDia / 2 - 0.15) + 4} textAnchor="end">RF</text></>}
        {!blind && <text className="dg-lbl sm acc" x={X(x2) + 4} y={Yt(f.hubDia / 2) - 4}>X</text>}
        {type === 'WN' && <text className="dg-lbl sm acc" x={X(x3) + 3} y={Yt(A / 2) + 4}>weld</text>}
        {type === 'SW' && <text className="dg-lbl sm acc" x={X(x3) + 3} y={Yt(A / 2) + 4}>socket</text>}
        {/* face view */}
        <circle className="dg-face-o" cx={fx} cy={fy} r={fR} />
        {!lap && <circle className="dg-face-rf" cx={fx} cy={fy} r={(f.rfDia / 2) * k} />}
        <circle className="dg-center" cx={fx} cy={fy} r={(f.boltCircle / 2) * k} />
        {holes.map(([hx, hy], i) => <circle key={i} className="dg-face-hole" cx={hx} cy={hy} r={Math.max(1.5, (f.holeDia / 2) * k)} />)}
        {!blind && <circle className="dg-face-bore" cx={fx} cy={fy} r={(boreFace / 2) * k} />}
        <line className="dg-center" x1={fx - fR - 5} x2={fx + fR + 5} y1={fy} y2={fy} />
        <line className="dg-center" x1={fx} x2={fx} y1={fy - fR - 5} y2={fy + fR + 5} />
        <text className="dg-lbl sm" x={fx} y={fy + fR + 16} textAnchor="middle">BC {fmt(f.boltCircle)}</text>
        <text className="dg-lbl sm" x={fx} y={fy + fR + 29} textAnchor="middle">{f.nBolts} holes Ø{fmt(f.holeDia)}</text>
        <text className="dg-lbl sm strong" x={boxX + boxW / 2} y={256} textAnchor="middle">HALF SECTION</text>
        <text className="dg-lbl sm strong" x={fx} y={fy - fR - 12} textAnchor="middle">FACE</text>
      </svg>
      <figcaption>{typeName}, Class {f.cls}, NPS {f.nps}, drawn to scale from the table values. Half section above the pipe centerline, cut through a bolt hole (hatched = metal). {lap ? 'Lap joint flanges have no raised face; the stub end forms the gasket face.' : `Raised face ${fmt(f.rfHeight)} high, shown on the left; tf and Y exclude it.`} {type === 'WN' ? 'Bore shown for standard-weight pipe; it matches the pipe ordered.' : ''}{!made ? ' This type is not made in this class and size.' : ''}</figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------ bolting
function BoltingView() {
  const p = useClassSize('dbolt');
  const [x, setX] = useTool('dbolt2', { stress: '50000', k: '0.17', src: 'flange', dia: '', n: '8' });
  const r = attempt(() => {
    let d: number, n: number;
    if (x.src === 'flange') { const f = flange(p.cls, p.nps); d = f.boltDia; n = f.nBolts; }
    else { d = val(parseLength, x.dia)!; n = Number(x.n); if (d === undefined) throw new CalcError('INPUT', 'Enter the bolt diameter.'); }
    const S = Number(x.stress), K = Number(x.k);
    return { d, n, t: boltTorque(d, S, K), seq: tighteningSequence(n) };
  });
  const v = r.ok ? r.v : null;
  const prefs = useAppPrefs();
  return (
    <>
      <Card>
        <Segmented small value={x.src} onChange={(s) => setX('src', s)} options={[['flange', 'From flange size'], ['manual', 'Enter bolt size']]} />
        {x.src === 'flange' ? <ClassSize p={p} /> : (
          <Grid>
            <Field label="Bolt diameter" value={x.dia} onChange={(s) => setX('dia', s)} parse={parseLength} hint={'e.g. 7/8"'} />
            <Select label="Number of bolts" value={x.n} options={['4', '8', '12', '16', '20', '24'].map((s) => [s, s])} onChange={(s) => setX('n', s)} />
          </Grid>
        )}
        <Grid>
          <Field label="Target bolt stress (psi)" value={x.stress} onChange={(s) => setX('stress', s)} inputMode="decimal" hint="from your bolting procedure" />
          <Field label="Nut factor K" value={x.k} onChange={(s) => setX('k', s)} inputMode="decimal" hint="≈0.16–0.20 lubricated" />
        </Grid>
        {!r.ok && <Msg>{r.err}</Msg>}
      </Card>
      {v && <BoltPattern n={v.n} seq={v.seq} />}
      {v && <Results title="Torque" rows={[
        { label: 'Bolt', value: `${v.n} × ${formatFracIn(v.d, prefs)}-${boltTPI(v.d)}`, sub: `stress area ${formatNumber(v.t.As, 4)} in²` },
        { label: 'Target preload per bolt', value: `${formatNumber(v.t.preload, 0)} lbf` },
        { label: 'Final torque (100%)', value: `${formatNumber(v.t.torqueFtLb, 0)} ft·lb`, sub: `${formatNumber(v.t.torqueFtLb * 1.3558179, 0)} N·m`, strong: true },
        ...v.t.passes.filter((q) => q.pct < 100).map((q) => ({ label: `Pass at ${q.pct}%`, value: `${formatNumber(q.ftlb, 0)} ft·lb` })),
        { label: 'Wrench (heavy hex nut)', value: formatFracIn(heavyHexAcrossFlats(v.d), prefs) },
        { label: 'Tightening order', value: v.seq.join(' – ') },
      ]} />}
      <Msg kind="warn">Torque values depend on the gasket, bolt material, lubricant and your site procedure. Use the procedure's target stress and nut factor; these defaults are only a starting point.</Msg>
      <Formula>
        <ul>
          <li>Tensile stress area As = 0.7854 (D − 0.9743/n)², n = threads per inch (UNC to 1", 8-UN above) — ASME B1.1.</li>
          <li>Preload F = target stress × As. Torque T = K × D × F ÷ 12 (ft·lb).</li>
          <li>Passes: snug, then about 20–30%, 50–70%, 100% in the cross pattern, then rotate clockwise at 100% until nuts stop turning (ASME PCC-1 legacy method).</li>
          <li>Cross pattern numbers bolts clockwise from 1. Wrench size = heavy hex nut across flats, 1.5D + 1/8" (ASME B18.2.2).</li>
        </ul>
      </Formula>
    </>
  );
}

function BoltPattern({ n, seq }: { n: number; seq: number[] }) {
  const cx = 170, cy = 105, R = 78;
  const pos = (b: number) => { const a = -Math.PI / 2 + ((b - 1) / n) * 2 * Math.PI; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; };
  const order = new Map(seq.map((b, i) => [b, i + 1]));
  return (
    <figure className="diagram">
      <svg viewBox="0 0 340 215" role="img" aria-label="Bolt tightening order">
        <circle className="dg-ext" cx={cx} cy={cy} r={R} />
        <circle className="dg-elbow-cut" cx={cx} cy={cy} r={R - 26} />
        <polyline className="dg-seq" points={seq.map((b) => pos(b).join(',')).join(' ')} />
        {Array.from({ length: n }, (_, i) => i + 1).map((b) => { const [x, y] = pos(b); return (
          <g key={b}>
            <circle className="dg-bolt" cx={x} cy={y} r={11} />
            <text className="dg-boltno" x={x} y={y + 4} textAnchor="middle">{b}</text>
            <text className="dg-lbl sm acc" x={cx + (R + 22) * Math.cos(-Math.PI / 2 + ((b - 1) / n) * 2 * Math.PI)} y={cy + (R + 22) * Math.sin(-Math.PI / 2 + ((b - 1) / n) * 2 * Math.PI) + 4} textAnchor="middle">{order.get(b)}</text>
          </g>
        ); })}
      </svg>
      <figcaption>White numbers: bolt positions, clockwise. Teal numbers outside: the order to tighten them on each pass. Line shows the cross pattern.</figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------ gaskets
function GasketView() {
  const p = useClassSize('dgasket');
  const dim = useDim();
  const r = attempt(() => ({ g: spiralGasket(p.cls, p.nps), f: flange(p.cls, p.nps) }));
  return (
    <>
      <Card><ClassSize p={p} />{!r.ok && <Msg>{r.err}</Msg>}</Card>
      {r.ok && <Results title={`Spiral-wound gasket · Class ${p.cls} · NPS ${p.nps}`} rows={[
        dim(r.v.g.ringOD, 'Centering (outer) ring OD', { strong: true }),
        dim(r.v.g.windingOD, 'Sealing element OD', r.v.g.windingOD == null ? { sub: 'source gives Classes 150–600 only' } : {}),
        dim(r.v.g.windingID, 'Sealing element ID'),
        dim(r.v.g.innerRingID, 'Inner ring ID', r.v.g.innerRingID == null ? { sub: 'source gives Class 150 only' } : {}),
        { label: 'Ring joint gasket', value: r.v.f.ring ?? '—', sub: r.v.f.ring ? 'oval or octagonal, same number' : 'not included for this class' },
        dim(r.v.f.rfDia, 'Flange raised-face diameter'),
      ]} />}
      <Card>
        <p className="lead">Not included: B16.21 non-metallic flat gaskets, jacketed gaskets and ring-joint ring dimensions. Use the gasket maker's data sheet for those.</p>
        <SRC>{SW_GASKET_SOURCE} {RING_SOURCE}</SRC>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ fittings
function FittingView() {
  const [x, setX] = useTool('dfit', { kind: 'bw', nps: '4', swcls: '3000', thd: 'B16.3-150', gap: '1/16' });
  return (
    <>
      <Card>
        <Segmented small value={x.kind} onChange={(v) => setX('kind', v)} options={[['bw', 'Butt weld (B16.9)'], ['sw', 'Socket weld'], ['thd', 'Threaded']]} />
        {x.kind === 'bw' && <Select label="Nominal size" value={SIZES.includes(x.nps as never) ? x.nps : '4'} options={NPS_OPTS(SIZES)} onChange={(v) => setX('nps', v)} />}
        {x.kind === 'sw' && (
          <Grid>
            <Select label="Class" value={x.swcls} options={[['3000', '3000'], ['6000', '6000']]} onChange={(v) => setX('swcls', v)} />
            <Select label="Nominal size" value={x.nps} options={NPS_OPTS(['1/2', '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2', '3', '4'])} onChange={(v) => setX('nps', v)} />
            <Field label="Gap at bottom of socket" value={x.gap} onChange={(v) => setX('gap', v)} parse={parseLength} hint="B31.1/B31.3: about 1/16 before welding" />
          </Grid>
        )}
        {x.kind === 'thd' && (
          <Grid>
            <Select label="Fitting" value={x.thd} options={THREADED_KINDS.map((k) => [k, THREADED_LABEL[k]])} onChange={(v) => setX('thd', v)} />
            <Select label="Nominal size" value={threadedSizes(x.thd as ThreadedKind).includes(x.nps) ? x.nps : '1'} options={NPS_OPTS(threadedSizes(x.thd as ThreadedKind))} onChange={(v) => setX('nps', v)} />
          </Grid>
        )}
      </Card>
      {x.kind === 'bw' && <BWFit nps={SIZES.includes(x.nps as never) ? x.nps : '4'} />}
      {x.kind === 'sw' && <SWFit nps={x.nps} cls={Number(x.swcls) as 3000} gap={x.gap} />}
      {x.kind === 'thd' && <ThdFit kind={x.thd as ThreadedKind} nps={threadedSizes(x.thd as ThreadedKind).includes(x.nps) ? x.nps : '1'} />}
    </>
  );
}
function BWFit({ nps }: { nps: string }) {
  const dim = useDim();
  const r = attempt(() => ({ f: bwFitting(nps), e: B169[nps] }));
  if (!r.ok) return <Msg>{r.err}</Msg>;
  const { f, e } = r.v;
  return (
    <>
      <Results title={`Butt-weld fittings · NPS ${nps}`} rows={[
        dim(e?.lr90, '90° LR elbow, center to end A', { strong: true }),
        dim(e?.lr45, '45° LR elbow, center to end B'),
        dim(e?.sr90 ?? null, '90° SR elbow, center to end A', e?.sr90 ? {} : { sub: 'no SR elbow in this size' }),
        dim(f.teeC, 'Straight tee, center to end C (run) = M (outlet)', { strong: true }),
        dim(f.reducerH, 'Reducer length H (concentric & eccentric)'),
        dim(f.capE, 'Cap length E (standard weight)'),
        dim(f.lrO, '180° LR return, center to center O', f.lrO == null ? { sub: 'sources disagree — measure the fitting' } : {}),
        dim(f.lrK, '180° LR return, back to face K', f.lrK == null ? { sub: 'sources disagree — measure the fitting' } : {}),
        dim(f.srO, '180° SR return, center to center O'),
        dim(f.srK, '180° SR return, back to face K'),
        dim(f.stubF, 'Stub end length F (long pattern)'),
        dim(f.stubG, 'Stub end lap diameter G'),
        dim(f.stubR, 'Stub end fillet radius R'),
      ]} />
      <Card><SRC>{B169_SOURCE} {B169_FIT_SOURCE} Reducing tees (M differs from C), short-pattern stub ends and XS cap lengths are not included.</SRC></Card>
    </>
  );
}
function SWFit({ nps, cls, gap }: { nps: string; cls: 3000 | 6000; gap: string }) {
  const dim = useDim();
  const r = attempt(() => socketWeld(nps, cls, val(parseLength, gap) ?? 0.0625));
  return (
    <>
      {!r.ok ? <Msg>{r.err}</Msg> : <Results title={`Socket weld · Class ${cls} · NPS ${nps}`} rows={[
        dim(r.v.a90, '90° elbow / tee: center to bottom of socket A', { strong: true }),
        dim(r.v.a45, '45° elbow: center to bottom of socket'),
        dim(r.v.depth, 'Socket depth J'),
        dim(r.v.bore, 'Socket bore (mean)'),
        dim(r.v.engagement, 'Pipe engagement (J − gap)'),
        dim(r.v.takeout90, 'Take-out, 90° / tee (A − engagement)', { strong: true }),
        dim(r.v.takeout45, 'Take-out, 45°'),
      ]} />}
      <Card><SRC>{B1611_SOURCE}</SRC></Card>
    </>
  );
}
function ThdFit({ kind, nps }: { kind: ThreadedKind; nps: string }) {
  const dim = useDim();
  const r = attempt(() => threadedFitting(kind, nps));
  return (
    <>
      {!r.ok ? <Msg>{r.err}</Msg> : <Results title={`${THREADED_LABEL[kind]} · NPS ${nps}`} rows={[
        dim(r.v.a90, '90° elbow / tee: center to end', { strong: true }),
        dim(r.v.a45, '45° elbow: center to end'),
        dim(r.v.makeup, 'Thread makeup (L1 + L3)', { sub: `hand-tight ${formatNumber(r.v.L1, 3)} + wrench ${formatNumber(r.v.L3, 3)} in` }),
        dim(r.v.takeout90, 'Take-out, 90° / tee', { strong: true }),
        dim(r.v.takeout45, 'Take-out, 45°'),
      ]} />}
      <Msg kind="info">Thread makeup is the nominal ASME B1.20.1 engagement. It varies about ±1 thread with tapping, sealant and how hard the joint is made up — check on the first joint.</Msg>
      <Card><SRC>{kind === 'B16.3-150' ? B163_SOURCE : B1611_SOURCE} {NPT_SOURCE}</SRC></Card>
    </>
  );
}

// ------------------------------------------------------------------ valves
function ValveView() {
  const [x, setX] = useTool('dvalve', { cls: '150', nps: '4', type: 'gate' });
  const dim = useDim();
  const cls = Number(x.cls) as FlangeClass;
  const sizes = SIZES.filter((s) => s !== '3-1/2' && (cls !== 2500 || ['1/2', '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2', '3', '4', '5', '6', '8', '10', '12'].includes(s)));
  const nps = sizes.includes(x.nps as never) ? x.nps : '4';
  const types = Object.keys(VALVE_LABEL) as ValveType[];
  return (
    <>
      <Card>
        <Grid>
          <Select label="Pressure class" value={x.cls} options={CLASS_OPTS(VALVE_CLASSES)} onChange={(v) => setX('cls', v)} />
          <Select label="Nominal size" value={nps} options={NPS_OPTS(sizes)} onChange={(v) => setX('nps', v)} />
        </Grid>
      </Card>
      <Results title={`Valve face to face · Class ${cls} RF · NPS ${nps}`} rows={types.map((t, i) => {
        const r = attempt(() => valveFaceToFace(cls, t, nps));
        return r.ok ? dim(r.v, VALVE_LABEL[t], { strong: i === 0, ...(r.v == null ? { sub: 'not listed in B16.10 for this size' } : {}) }) : { label: VALVE_LABEL[t], value: '—', sub: r.err };
      })} />
      <Card>
        <p className="lead">Face to face is measured between the raised gasket faces. Ring-joint valves are longer (end to end) and butt-weld valves differ; check the valve drawing for those, and for wafer, butterfly and control valves.</p>
        <SRC>{VALVE_SOURCE}</SRC>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ pipe extras: volume, surface area, spacing, supports, outlets
function PipeExtras() {
  const [x, setX] = useTool('dpipe', { nps: '6', sch: 'Std', len: "20'", nps2: '4', sch2: 'Std', ins1: '0', ins2: '0', clear: '1"', fl1: '', fcls: '150', branch: '2', gap: '1/16' });
  const dim = useDim();
  const steelSizes = sizesFor('steel', x.sch);
  const nps = steelSizes.includes(x.nps) ? x.nps : '6';
  const r = attempt(() => {
    const p = pipeProps('steel', x.sch, nps);
    const L = val(parseLength, x.len);
    if (L === undefined) throw new CalcError('INPUT', 'Enter a length.');
    return { p, L, v: pipeVolume(p.id, L), s: pipeSurface(p.od, p.id, L) };
  });
  const sp = attempt(() => {
    const a = steelOD(nps), b = steelOD(x.nps2);
    const fl = x.fl1 === '1' ? flange(Number(x.fcls) as FlangeClass, nps).od : null;
    return pipeSpacing({ od: a, insul: val(parseLength, x.ins1) ?? 0, flangeOD: fl }, { od: b, insul: val(parseLength, x.ins2) ?? 0 }, val(parseLength, x.clear) ?? 0);
  });
  const ol = attempt(() => weldolet(x.branch, steelOD(nps), val(parseLength, x.gap) ?? 0));
  const span = SUPPORT_SPAN[nps];
  const n = (v: number, d = 4) => formatNumber(v, d);
  return (
    <>
      <Card>
        <Grid>
          <Select label="Steel pipe size" value={nps} options={NPS_OPTS(steelSizes)} onChange={(v) => setX('nps', v)} />
          <Select label="Schedule" value={x.sch} options={typesFor('steel').map((t) => [t, t])} onChange={(v) => setX('sch', v)} />
          <Field label="Length" value={x.len} onChange={(v) => setX('len', v)} parse={parseLength} />
        </Grid>
        {!r.ok && <Msg>{r.err}</Msg>}
      </Card>
      {r.ok && <Results title="Volume & surface area" rows={[
        { label: 'Contents', value: `${n(r.v.v.usgal)} US gal`, sub: `${n(r.v.v.impgal)} Imp gal · ${n(r.v.v.L)} L · ${n(r.v.v.bbl)} bbl`, strong: true },
        { label: 'Contents (volume)', value: `${n(r.v.v.ft3)} cu ft`, sub: `${n(r.v.v.m3, 5)} m³` },
        { label: 'Outside surface area', value: `${n(r.v.s.outside / 144)} sq ft`, sub: `${n(r.v.s.outside * 0.00064516, 4)} m²` },
        { label: 'Inside surface area', value: `${n(r.v.s.inside / 144)} sq ft`, sub: `${n(r.v.s.inside * 0.00064516, 4)} m²` },
        dim(r.v.p.od, 'OD used'), dim(r.v.p.id, 'ID used'),
      ]} />}
      <Results title={`Support spacing · NPS ${nps}`} rows={span ? [
        { label: 'Water service, max span', value: `${span[0]} ft`, strong: true },
        { label: 'Steam, gas or air service, max span', value: `${span[1]} ft` },
      ] : [{ label: 'Max span', value: '—', sub: 'B31.1 Table 121.5 lists NPS 1, 2, 3, 4, 6, 8, 12, 16, 20, 24 only' }]} />
      <Card>
        <h4>Pipe spacing (parallel lines)</h4>
        <Grid>
          <Field label={`Insulation on ${nps}" line`} value={x.ins1} onChange={(v) => setX('ins1', v)} parse={parseLength} />
          <Select label="Second line" value={x.nps2} options={NPS_OPTS(sizesFor('steel', 'Std'))} onChange={(v) => setX('nps2', v)} />
          <Field label="Insulation on second line" value={x.ins2} onChange={(v) => setX('ins2', v)} parse={parseLength} />
          <Field label="Clear gap" value={x.clear} onChange={(v) => setX('clear', v)} parse={parseLength} />
        </Grid>
        <label className="toggle sm"><input type="checkbox" checked={x.fl1 === '1'} onChange={(e) => setX('fl1', e.target.checked ? '1' : '')} /> Flange on the {nps}" line at this point</label>
        {x.fl1 === '1' && <Select label="Flange class" value={x.fcls} options={CLASS_OPTS(FLANGE_CLASSES)} onChange={(v) => setX('fcls', v)} />}
        {sp.ok ? <Results title="Spacing" rows={[dim(sp.v.spacing, 'Center to center', { strong: true }), dim(sp.v.sideA, `${nps}" side`), dim(sp.v.sideB, `${x.nps2}" side`)]} /> : <Msg>{sp.err}</Msg>}
      </Card>
      <Card>
        <h4>Weldolet branch (STD, reducing)</h4>
        <Grid>
          <Select label="Branch size" value={x.branch} options={NPS_OPTS(Object.keys(WELDOLET_A))} onChange={(v) => setX('branch', v)} />
          <Field label="Root gap" value={x.gap} onChange={(v) => setX('gap', v)} parse={parseLength} />
        </Grid>
        {ol.ok ? <Results title={`On ${nps}" run`} rows={[dim(ol.v.A, 'Weldolet height A'), dim(ol.v.centerToEnd, 'Run centerline to branch weld end', { strong: true, sub: 'run OD/2 + A + gap' })]} /> : <Msg>{ol.err}</Msg>}
        <SRC>{OLET_SOURCE}</SRC>
      </Card>
      <Card><SRC>Pipe OD/ID: ASME B36.10M. Spans: {SUPPORT_SOURCE}</SRC></Card>
    </>
  );
}
