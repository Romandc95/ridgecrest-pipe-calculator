import { PipeData } from './PipeTools';
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
  BOLT_GRADES, BOLT_GRADE_SOURCE, boltYieldPsi, NUT_FACTORS, WELDOLET_A, weldolet, OLET_SOURCE, SUPPORT_SPAN, SUPPORT_SOURCE, pipeVolume, pipeSurface, pipeSpacing, heavyHexAcrossFlats,
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
  const [t, set] = useTool('data', { tab: 'piping' });
  const tabs: Array<[string, string]> = [['piping', 'Piping'], ['flange', 'Flanges'], ['bolting', 'Bolting'], ['gasket', 'Gaskets'], ['fitting', 'Fittings'], ['valve', 'Valves'], ['pipe', 'Pipe & supports']];
  return (
    <div className="tool">
      <div className="chipgrid" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={t.tab === k} className={t.tab === k ? 'on' : ''} onClick={() => set('tab', k)}>{l}</button>)}
      </div>
      {t.tab === 'piping' && <PipeData />}
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
      {f && <BoltingLink cls={p.inp.cls} nps={p.nps} />}
      <Card>
        <label className="toggle sm"><input type="checkbox" checked={x.table === '1'} onChange={(e) => setX('table', e.target.checked ? '1' : '')} /> Show the full Class {p.cls} table</label>
        {x.table === '1' && <FlangeTable cls={p.cls} />}
        <SRC>{FLANGE_SOURCE} Stud lengths: {STUD_SOURCE} {RING_SOURCE}</SRC>
      </Card>
      <ToolActions tool="dflange" title={`Flange ${p.cls}# ${p.nps}"`} inputs={{ ...p.inp, ...x }} summary={f ? `B16.5 Class ${p.cls} NPS ${p.nps}: OD ${f.od}, BC ${f.boltCircle}, ${f.nBolts} × ${f.boltDia}" bolts, studs RF ${f.studRF ?? '—'} / RTJ ${f.studRTJ ?? '—'}, tf ${f.tf}, WN Y ${f.yWN}` : ''} disabled={!f} />
    </>
  );
}
/** Torque spec for the selected flange: bolt size and count from B16.5, stud grade, lubricant (nut factor) and target stress. */
function BoltTorque({ d, n, title, source }: { d: number; n: number; title: string; source: React.ReactNode }) {
  const prefs = useAppPrefs();
  const [x, setX] = useTool('dftorque', { grade: 'B7', lube: 'oilgraph', k: '', mode: 'pct', pct: '50', psi: '50000', job: '' });
  const grade = BOLT_GRADES[x.grade] ? x.grade : 'B7';
  const lube = NUT_FACTORS.find((n) => n.id === x.lube) ?? NUT_FACTORS[0];
  const Sy = boltYieldPsi(grade, d);
  const r = attempt(() => {
    const K = lube.id === 'custom' ? Number(x.k) : lube.k;
    if (!(K > 0 && K < 1)) throw new CalcError('INPUT', 'Enter a nut factor K, e.g. 0.16.');
    let S: number;
    if (x.mode === 'pct') {
      if (Sy == null) throw new CalcError('DATA', `${BOLT_GRADES[grade].label} yield is not tabulated for ${formatFracIn(d, prefs)} studs — enter the stress in psi instead.`);
      const pct = Number(x.pct); if (!(pct > 0 && pct <= 100)) throw new CalcError('INPUT', 'Enter a percent of yield between 1 and 100.');
      S = (Sy * pct) / 100;
    } else { S = Number(x.psi); if (!(S > 0)) throw new CalcError('INPUT', 'Enter the target bolt stress in psi.'); }
    const t = boltTorque(d, S, K);
    const job = x.job.trim() ? Number(x.job) : null;
    if (job != null && !(job > 0)) throw new CalcError('INPUT', 'Job target torque must be a number in ft·lb.');
    return { K, S, t, job, seq: tighteningSequence(n) };
  });
  const v = r.ok ? r.v : null;
  const final = v ? (v.job ?? v.t.torqueFtLb) : 0;
  const pctY = v && Sy ? (v.S / Sy) * 100 : null;
  const warns: string[] = [];
  if (v && pctY != null && pctY > 70) warns.push(`Target is ${formatNumber(pctY, 0)}% of the stud's minimum yield (${formatNumber(Sy! / 1000, 0)} ksi). Common practice stays at or below about 70%; check the procedure.`);
  if (v && Sy == null) warns.push(`${BOLT_GRADES[grade].label} yield is not tabulated for this stud size, so stress can't be checked against yield.`);
  if (v && grade === 'B7' && v.S > 60000) warns.push('Flexitallic does not generally recommend more than 60,000 psi bolt stress on spiral-wound gaskets.');
  if (v && v.job != null) { const dev = (v.job / v.t.torqueFtLb - 1) * 100; if (Math.abs(dev) > 25) warns.push(`Job target is ${formatNumber(Math.abs(dev), 0)}% ${dev > 0 ? 'above' : 'below'} the calculated value — confirm the procedure's lubricant and stress basis match.`); }
  return (
    <>
      <Card>
        {source}
        <p className="lead">{n} × {formatFracIn(d, prefs)}-{boltTPI(d)} studs. Pick the stud grade, lubricant and target stress — or enter the torque your job procedure gives.</p>
        <Grid>
          <Select label="Stud grade" value={grade} options={Object.entries(BOLT_GRADES).map(([k, g]) => [k, g.label.replace('A193 ', '').replace(/ \(.*\)/, '').replace('Class', 'Cl.')])} onChange={(s) => setX('grade', s)} />
          <Select label="Lubrication" value={lube.id} options={NUT_FACTORS.map((q) => [q.id, q.id === 'custom' ? 'Custom K' : q.short])} onChange={(s) => setX('lube', s)} />
          {lube.id === 'custom' && <Field label="Nut factor K" value={x.k} onChange={(s) => setX('k', s)} inputMode="decimal" hint="from the procedure / lubricant sheet" />}
          <Select label="Target stress set by" value={x.mode} options={[['pct', '% of stud yield'], ['psi', 'Bolt stress (psi)']]} onChange={(s) => setX('mode', s)} />
          {x.mode === 'pct'
            ? <Field label="Percent of yield" value={x.pct} onChange={(s) => setX('pct', s)} inputMode="decimal" hint={Sy ? `yield ${formatNumber(Sy / 1000, 0)} ksi min` : 'yield not tabulated'} />
            : <Field label="Target bolt stress (psi)" value={x.psi} onChange={(s) => setX('psi', s)} inputMode="decimal" hint="from the bolting procedure" />}
          <Field label="Approved job target (ft·lb, optional)" value={x.job} onChange={(s) => setX('job', s)} inputMode="decimal" hint="overrides the calculated torque" />
        </Grid>
        <p className="fhint">{lube.id !== 'custom' && <b>K {lube.k.toFixed(2)} — </b>}{lube.note}</p>
        {!r.ok && <Msg>{r.err}</Msg>}
      </Card>
      {v && <Results title={title} rows={[
        { label: v.job != null ? 'Job target torque' : 'Final torque (100%)', value: `${formatNumber(final, 0)} ft·lb`, sub: `${formatNumber(final * 1.3558179, 0)} N·m${v.job != null ? ` · calculated ${formatNumber(v.t.torqueFtLb, 0)} ft·lb` : ''}`, strong: true },
        ...v.t.passes.filter((q) => q.pct < 100).map((q) => ({ label: `Pass at ${q.pct}%`, value: `${formatNumber((final * q.pct) / 100, 0)} ft·lb` })),
        { label: 'Studs', value: `${n} × ${formatFracIn(d, prefs)}-${boltTPI(d)}`, sub: `${BOLT_GRADES[grade].label} · ${BOLT_GRADES[grade].nut} heavy-hex nuts` },
        { label: 'Target bolt stress', value: `${formatNumber(v.S, 0)} psi`, sub: pctY != null ? `${formatNumber(pctY, 0)}% of ${formatNumber(Sy! / 1000, 0)} ksi minimum yield` : 'yield not tabulated for this size' },
        { label: 'Preload per stud', value: `${formatNumber(v.t.preload, 0)} lbf`, sub: `stress area ${formatNumber(v.t.As, 4)} in² · total ${formatNumber(v.t.preload * n, 0)} lbf` },
        { label: 'Nut factor K', value: v.K.toFixed(2), sub: lube.label },
        { label: 'Wrench (heavy hex nut)', value: formatFracIn(heavyHexAcrossFlats(d), prefs) },
        { label: 'Tightening order', value: v.seq.join(' – ') },
      ]} />}
      {v && <BoltPattern n={n} seq={v.seq} />}
      {warns.map((w, i) => <Msg key={i} kind="warn">{w}</Msg>)}
      <Msg kind="warn">Torque values depend on the gasket, bolt material, lubricant and your site procedure. Use the procedure's target stress and nut factor; these defaults are only a starting point.</Msg>
      <Formula title="How the torque is worked out">
        <ul>
          <li>Tensile stress area As = 0.7854 (D − 0.9743/n)², n = threads per inch (UNC to 1", 8-UN above) — ASME B1.1.</li>
          <li>Preload F = target stress × As. Torque T = K × D × F ÷ 12 ft·lb — the ASME PCC-1 short-form method.</li>
          <li>Lubrication changes K, so a dry stud needs more torque for the same preload. Presets are typical published values; your lubricant data sheet or procedure governs.</li>
          <li>Passes: snug, then about 20–30%, 50–70%, 100% in the cross pattern, then rotate clockwise at 100% until nuts stop turning (ASME PCC-1 legacy method).</li>
          <li>Cross pattern numbers bolts clockwise from 1. Wrench size = heavy hex nut across flats, 1.5D + 1/8" (ASME B18.2.2).</li>
          <li>{BOLT_GRADE_SOURCE}</li>
          <li>General service guide only. High temperature, high pressure, hydrotest and critical joints need the specified joint procedure and gasket maker's values.</li>
        </ul>
      </Formula>
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
  const boxX = 60, boxW = 154, cy = 128, maxHalf = 96;
  const s = Math.min(boxW / L, maxHalf / (H / 2));
  const ox = boxX + (boxW - L * s) / 2;
  const X = (x: number) => ox + x * s, Yt = (r: number) => cy - r * s, Yb = (r: number) => cy + r * s;
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
        {/* side view: the outside of the flange, solid (nothing cut away) */}
        {(() => {
          const prof: Array<[number, number]> = blind
            ? [[0, f.rfDia / 2], [x1, f.rfDia / 2], [x1, f.od / 2], [x2, f.od / 2], [x2, 0]]
            : [...(lap ? [] as Array<[number, number]> : [[0, f.rfDia / 2], [x1, f.rfDia / 2]] as Array<[number, number]>), [x1, f.od / 2], [x2, f.od / 2], [x2, f.hubDia / 2],
              ...(type === 'WN' ? [[x3 - Math.max(0, ((A - pid) / 2 - Math.min(0.0625, (A - pid) * 0.15)) * Math.tan((37.5 * Math.PI) / 180)), A / 2], [x3, A / 2 - Math.min(0.06, (A - pid) / 4)]] as Array<[number, number]> : [[x3, f.hubDia / 2]] as Array<[number, number]>)];
          const pts = [...prof.map(([x, r]) => [X(x), Yt(r)]), ...[...prof].reverse().map(([x, r]) => [X(x), Yb(r)])];
          return <>
            <polygon className="dg-solid" points={pts.map((q) => q.map((v) => v.toFixed(1)).join(',')).join(' ')} />
            {/* visible edges across the part: raised face, back of the flange ring, weld bevel */}
            {!lap && <line className="dg-edge" x1={X(x1)} x2={X(x1)} y1={Yt(f.rfDia / 2)} y2={Yb(f.rfDia / 2)} />}
            {!blind && <line className="dg-edge" x1={X(x2)} x2={X(x2)} y1={Yt(f.hubDia / 2)} y2={Yb(f.hubDia / 2)} />}
            {type === 'WN' && prof.length > 1 && <line className="dg-edge" x1={X(prof[prof.length - 2][0])} x2={X(prof[prof.length - 2][0])} y1={Yt(A / 2)} y2={Yb(A / 2)} />}
          </>;
        })()}
        <line className="dg-center" x1={X(0) - 8} x2={X(x3) + 8} y1={cy} y2={cy} />
        {/* O, dimensioned from the centerline */}
        <line className="dg-ext" x1={X(x1) - 2} x2={boxX - 44} y1={Yt(half)} y2={Yt(half)} />
        <line className="dg-ext" x1={X(x1) - 2} x2={boxX - 44} y1={Yb(half)} y2={Yb(half)} />
        <line className="dg-dim" x1={boxX - 40} x2={boxX - 40} y1={Yb(half)} y2={Yt(half)} markerStart="url(#fa)" markerEnd="url(#fa)" />
        <text className="dg-lbl sm" transform={`translate(${boxX - 46} ${cy}) rotate(-90)`} textAnchor="middle">Ø O {fmt(f.od)}</text>
        <text className="dg-lbl sm" x={X(x3) + 8} y={cy + 4}>℄ pipe</text>
        {/* tf */}
        <line className="dg-dim" x1={X(x1)} x2={X(x2)} y1={Yt(half) - 9} y2={Yt(half) - 9} markerStart="url(#fa)" markerEnd="url(#fa)" />
        <text className="dg-lbl sm" x={(X(x1) + X(x2)) / 2} y={Yt(half) - 14} textAnchor="middle">tf {fmt(f.tf)}</text>
        {/* Y */}
        {!blind && made && <>
          {/* Y below the section: from the face (behind the raised face) to the hub end */}
          <line className="dg-ext" x1={X(x1)} x2={X(x1)} y1={Yb(half) + 2} y2={Yb(half) + 15} />
          <line className="dg-ext" x1={X(x3)} x2={X(x3)} y1={Yb(type === 'WN' ? A / 2 : f.hubDia / 2) + 2} y2={Yb(half) + 15} />
          <line className="dg-dim" x1={X(x1)} x2={X(x3)} y1={Yb(half) + 11} y2={Yb(half) + 11} markerStart="url(#fa)" markerEnd="url(#fa)" />
          <text className="dg-lbl sm" x={(X(x1) + X(x3)) / 2} y={Yb(half) + 24} textAnchor="middle">Y {fmt(Y)}</text>
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
        <text className="dg-lbl sm strong" x={fx} y={214} textAnchor="middle">◂ SIDE VIEW</text>
        <text className="dg-lbl sm strong" x={fx} y={fy - fR - 12} textAnchor="middle">FACE</text>
      </svg>
      <figcaption>{typeName}, Class {f.cls}, NPS {f.nps}, drawn to scale from the table values. Side view of the whole flange (left) and the face (right). {lap ? 'Lap joint flanges have no raised face; the stub end forms the gasket face.' : `Raised face ${fmt(f.rfHeight)} high, shown on the left; tf and Y exclude it.`} {type === 'WN' ? 'Bore shown for standard-weight pipe; it matches the pipe ordered.' : ''}{!made ? ' This type is not made in this class and size.' : ''}</figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------ bolting
function BoltingView() {
  const p = useClassSize('dbolt');
  const [x, setX] = useTool('dbolt2', { src: 'flange', dia: '', n: '8' });
  const prefs = useAppPrefs();
  const r = attempt(() => {
    if (x.src === 'flange') { const f = flange(p.cls, p.nps); return { d: f.boltDia, n: f.nBolts, title: `Torque · Class ${p.cls} · NPS ${p.nps}` }; }
    const d = val(parseLength, x.dia); const n = Number(x.n);
    if (d === undefined) throw new CalcError('INPUT', 'Enter the bolt diameter.');
    if (!(n >= 4 && n % 4 === 0)) throw new CalcError('INPUT', 'Pick the number of bolts.');
    return { d, n, title: `Torque · ${n} × ${formatFracIn(d, prefs)} studs` };
  });
  const source = (
    <>
      <Segmented small value={x.src} onChange={(s) => setX('src', s)} options={[['flange', 'From flange size'], ['manual', 'Enter bolt size']]} />
      {x.src === 'flange' ? <ClassSize p={p} /> : (
        <Grid>
          <Field label="Bolt diameter" value={x.dia} onChange={(s) => setX('dia', s)} parse={parseLength} hint={'e.g. 7/8"'} />
          <Select label="Number of bolts" value={x.n} options={['4', '8', '12', '16', '20', '24'].map((s) => [s, s])} onChange={(s) => setX('n', s)} />
        </Grid>
      )}
    </>
  );
  if (!r.ok) return <Card>{source}<Msg>{r.err}</Msg></Card>;
  return <BoltTorque d={r.v.d} n={r.v.n} title={r.v.title} source={source} />;
}

/** On Flanges: torque lives on the Bolting screen — one tap takes this flange there. */
function BoltingLink({ cls, nps }: { cls: string; nps: string }) {
  const { setToolField } = useApp();
  const go = () => { setToolField('dbolt', 'cls', cls); setToolField('dbolt', 'nps', nps); setToolField('dbolt2', 'src', 'flange'); setToolField('data', 'tab', 'bolting'); };
  return (
    <Card>
      <div className="row-between"><span className="lead">Bolt torque for this flange is on the Bolting screen.</span><button className="btn" onClick={go}>Bolting ›</button></div>
    </Card>
  );
}

/** Elevation of a straight run on supports at the B31.1 maximum spans — water-filled vs steam / gas / air. */
function SupportSpanDiagram({ nps, water, gas }: { nps: string; water: number; gas: number }) {
  const W = 340, x0 = 20, x1 = W - 20, n = 3; // three spans of the longer (gas) spacing fill the width
  const k = (x1 - x0) / (n * Math.max(water, gas));
  const row = (y: number, ft: number, label: string, cls: string) => {
    const xs = Array.from({ length: n + 1 }, (_, i) => x0 + i * ft * k);
    const end = xs[n];
    return (
      <g>
        <text className="dg-lbl sm strong" x={x0} y={y - 16}>{label}</text>
        <rect className={'sp-pipe ' + cls} x={x0 - 6} y={y - 5} width={end - x0 + 12} height={10} rx={2} />
        {xs.map((x, i) => (
          <g key={i}>
            <line className="sp-rod" x1={x} x2={x} y1={y + 5} y2={y + 19} />
            <path className="sp-shoe" d={`M${x - 8},${y + 27} L${x},${y + 19} L${x + 8},${y + 27} Z`} />
            <line className="sp-ground" x1={x - 11} x2={x + 11} y1={y + 27} y2={y + 27} />
          </g>
        ))}
        {xs.slice(0, n).map((x, i) => (
          <g key={'d' + i}>
            <line className="dg-dim" x1={x + 1} x2={xs[i + 1] - 1} y1={y + 38} y2={y + 38} markerStart="url(#spa)" markerEnd="url(#spa)" />
            <text className={'dg-lbl sm ' + (i === 0 ? 'acc' : '')} x={(x + xs[i + 1]) / 2} y={y + 51} textAnchor="middle">{ft} ft max</text>
          </g>
        ))}
      </g>
    );
  };
  return (
    <figure className="diagram">
      <svg viewBox={`0 0 ${W} 205`} role="img" aria-label={`Maximum support spacing for NPS ${nps}: ${water} ft water, ${gas} ft steam, gas or air`}>
        <defs><marker id="spa" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" className="dg-arrowhead" /></marker></defs>
        {row(40, water, `Water service · NPS ${nps}`, 'water')}
        {row(140, gas, `Steam, gas or air · NPS ${nps}`, 'gas')}
      </svg>
      <figcaption>Side view of a straight run on supports, drawn to the same scale: supports no farther apart than the maximum span (water-filled lines are heavier, so their spans are shorter). Spans are for straight runs — add supports near concentrated loads such as valves and flanges, and at changes of direction.</figcaption>
    </figure>
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
/** End view of the two parallel lines, to scale: pipe, insulation, flange (if any), the clear gap and the spacing. */
function SpacingDiagram({ a, b, clear, cc, fmt }: {
  a: { nps: string; od: number; insul: number; flangeOD: number | null; side: number };
  b: { nps: string; od: number; insul: number; flangeOD: number | null; side: number };
  clear: number; cc: number; fmt: (v: number) => string;
}) {
  const W = 340, ml = 18, mr = 18;
  const span = a.side + cc + b.side; // outer edge to outer edge
  const s = Math.min((W - ml - mr) / span, 150 / (2 * Math.max(a.side, b.side)));
  const H = 2 * Math.max(a.side, b.side) * s + 134;
  const cy = 58 + Math.max(a.side, b.side) * s;
  const xa = ml + ((W - ml - mr) - span * s) / 2 + a.side * s, xb = xa + cc * s;
  const edgeA = xa + a.side * s, edgeB = xb - b.side * s;
  const yTop = cy - Math.max(a.side, b.side) * s - 14, yBot = cy + Math.max(a.side, b.side) * s + 14;
  const pipe = (x: number, p: typeof a, k: string) => (
    <g key={k}>
      {p.flangeOD != null && p.flangeOD / 2 > p.od / 2 + p.insul && <circle className="dg-sp-flange" cx={x} cy={cy} r={(p.flangeOD / 2) * s} />}
      {p.insul > 0 && <circle className="dg-sp-insul" cx={x} cy={cy} r={(p.od / 2 + p.insul) * s} />}
      <circle className="dg-solid" cx={x} cy={cy} r={(p.od / 2) * s} />
      <line className="dg-center" x1={x - p.side * s - 4} x2={x + p.side * s + 4} y1={cy} y2={cy} />
      <line className="dg-center" x1={x} x2={x} y1={cy - p.side * s - 4} y2={yBot + 22} />
      <text className="dg-lbl sm strong" x={x} y={cy + 4} textAnchor="middle">{p.nps}"</text>
    </g>
  );
  return (
    <figure className="diagram">
      <svg viewBox={`0 0 ${W} ${H.toFixed(0)}`} role="img" aria-label="Spacing between two parallel lines, end view">
        <defs><marker id="spa" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" className="dg-arrowhead" /></marker></defs>
        {pipe(xa, a, 'a')}{pipe(xb, b, 'b')}
        {/* center to center, above */}
        <line className="dg-ext" x1={xa} x2={xa} y1={cy - a.side * s - 2} y2={yTop - 18} />
        <line className="dg-ext" x1={xb} x2={xb} y1={cy - b.side * s - 2} y2={yTop - 18} />
        <line className="dg-dim" x1={xa} x2={xb} y1={yTop - 12} y2={yTop - 12} markerStart="url(#spa)" markerEnd="url(#spa)" />
        <text className="dg-lbl sm acc" x={(xa + xb) / 2} y={yTop - 17} textAnchor="middle">C-C {fmt(cc)}</text>
        {/* the clear gap between the outsides */}
        {clear > 0 && <>
          <line className="dg-ext" x1={edgeA} x2={edgeA} y1={cy} y2={yBot + 2} />
          <line className="dg-ext" x1={edgeB} x2={edgeB} y1={cy} y2={yBot + 2} />
          <line className="dg-dim" x1={edgeA} x2={edgeB} y1={yBot - 2} y2={yBot - 2} markerStart="url(#spa)" markerEnd="url(#spa)" />
          <text className="dg-lbl sm" x={(edgeA + edgeB) / 2} y={yBot + 12} textAnchor="middle">gap {fmt(clear)}</text>
        </>}
        {/* each side: center to the outside of pipe / insulation / flange */}
        <line className="dg-dim" x1={xa} x2={edgeA} y1={yBot + 18} y2={yBot + 18} markerStart="url(#spa)" markerEnd="url(#spa)" />
        <text className="dg-lbl sm" x={Math.max(ml + 60, Math.min(W - mr - 60, (xa + edgeA) / 2))} y={yBot + 34} textAnchor="middle">{a.nps}" side {fmt(a.side)}</text>
        <line className="dg-dim" x1={edgeB} x2={xb} y1={yBot + 18} y2={yBot + 18} markerStart="url(#spa)" markerEnd="url(#spa)" />
        <text className="dg-lbl sm" x={Math.max(ml + 60, Math.min(W - mr - 60, (edgeB + xb) / 2))} y={yBot + 50} textAnchor="middle">{b.nps}" side {fmt(b.side)}</text>
      </svg>
      <figcaption>End view, to scale. Teal: pipe OD{a.insul > 0 || b.insul > 0 ? ' · dashed ring: insulation' : ''}{a.flangeOD != null ? ' · dotted ring: flange OD' : ''}. Each side is measured from the pipe center to whichever is biggest — pipe, insulation or flange; C-C = both sides + the clear gap.</figcaption>
    </figure>
  );
}

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
  const prefs = useAppPrefs();
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
      {span && <SupportSpanDiagram nps={nps} water={span[0]} gas={span[1]} />}
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
        {sp.ok && <SpacingDiagram a={{ nps, od: steelOD(nps), insul: val(parseLength, x.ins1) ?? 0, flangeOD: x.fl1 === '1' ? flange(Number(x.fcls) as FlangeClass, nps).od : null, side: sp.v.sideA }}
          b={{ nps: x.nps2, od: steelOD(x.nps2), insul: val(parseLength, x.ins2) ?? 0, flangeOD: null, side: sp.v.sideB }} clear={val(parseLength, x.clear) ?? 0} cc={sp.v.spacing} fmt={(v) => formatFracIn(v, prefs)} />}
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
