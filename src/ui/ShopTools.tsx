import React from 'react';
import { Field, Results, Msg, Formula, ToolActions, Segmented, Select, useTool, useFmt, Card, Grid, useApp } from './components';
import { parseLength, parseAngle, parseMeasurement, tryParse } from '../engine/parse';
import { miter, cope, thermalExpansion, EXPANSION_COEFF, EXPANSION_SOURCE } from '../engine/shop';
import { CalcError } from '../engine/units';
import { steelOD, B169 } from '../engine/fittings';
import { formatFracIn, formatNumber } from '../engine/format';

const val = <T,>(fn: (s: string) => T, s: string): T | undefined => {
  const r = tryParse(fn, s);
  if (r === null) return undefined;
  if (!r.ok) throw new CalcError('INPUT', r.err);
  return r.v;
};
function attempt<T>(f: () => T): { ok: true; v: T } | { ok: false; err: string } {
  try { return { ok: true, v: f() }; } catch (e) { return { ok: false, err: (e as Error).message }; }
}
const NPS = Object.keys(B169);

/** Pipe OD from a nominal size picker or a typed actual OD. */
function OdPicker({ label, inp, set, k }: { label: string; inp: Record<string, string>; set: (k: string, v: string) => void; k: string }) {
  return (
    <Grid>
      <Select label={label} value={inp[k + 'nps']} options={[...NPS.map((n) => [n, `${n}" NPS (OD ${steelOD(n)})`] as [string, string]), ['manual', 'Enter OD…']]} onChange={(v) => set(k + 'nps', v)} />
      {inp[k + 'nps'] === 'manual' && <Field label={`${label} OD`} value={inp[k + 'od']} onChange={(v) => set(k + 'od', v)} parse={parseLength} />}
    </Grid>
  );
}
const odOf = (inp: Record<string, string>, k: string) => {
  if (inp[k + 'nps'] !== 'manual') return steelOD(inp[k + 'nps']);
  const v = val(parseLength, inp[k + 'od']);
  if (v === undefined) throw new CalcError('INPUT', 'Enter the actual OD.');
  return v;
};

/** Unrolled cut line around the pipe: x = distance around the OD, y = cut-back from the reference line. */
function TemplatePlot({ pts, circ, yLabel, ref, signed }: { pts: Array<{ arc: number; y: number; deg: number }>; circ: number; yLabel: string; ref: string; signed?: boolean }) {
  const { settings } = useApp();
  const W = 340, H = 170, pl = 30, pr = 12, pt = 18, pb = 34;
  const ys = pts.map((p) => p.y);
  const ymin = signed ? Math.min(...ys) : 0, ymax = Math.max(...ys, ymin + 1e-6);
  const X = (a: number) => pl + (a / circ) * (W - pl - pr);
  const Y = (v: number) => pt + ((v - ymin) / (ymax - ymin)) * (H - pt - pb);
  // smooth curve: use the given points (dense enough at 16+ divisions)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.arc).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  return (
    <figure className="diagram">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Unrolled cut template">
        <rect x={pl} y={pt} width={W - pl - pr} height={H - pt - pb} className="dg-tplbg" />
        <line className="dg-dim" x1={pl} x2={W - pr} y1={Y(signed ? 0 : 0)} y2={Y(signed ? 0 : 0)} />
        <text className="dg-lbl sm" x={pl} y={pt - 5}>{ref}</text>
        {pts.map((p, i) => <line key={i} className="dg-ext" x1={X(p.arc)} x2={X(p.arc)} y1={pt} y2={H - pb} />)}
        <path className="dg-tplcurve" d={d} />
        {pts.map((p, i) => <circle key={i} className="dg-node" cx={X(p.arc)} cy={Y(p.y)} r={2.5} />)}
        {pts.filter((_, i) => i % Math.max(1, Math.round((pts.length - 1) / 8)) === 0).map((p, i) => (
          <text key={i} className="dg-lbl sm" x={X(p.arc)} y={H - pb + 14} textAnchor="middle">{Math.round(p.deg)}°</text>
        ))}
        <text className="dg-lbl sm" x={(pl + W - pr) / 2} y={H - 4} textAnchor="middle">around the pipe · circumference {formatFracIn(circ, settings.prefs)}</text>
        <text className="dg-lbl sm" transform={`translate(12 ${(pt + H - pb) / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
      </svg>
      <figcaption>Unrolled pattern: wrap a straight edge or paper around the pipe, divide the circumference into equal spaces, and mark each ordinate from the reference line.</figcaption>
    </figure>
  );
}

function Ordinates({ rows }: { rows: Array<{ n: number; deg: number; arc: number; y: number }> }) {
  const { settings } = useApp();
  return (
    <div className="tablewrap">
      <table className="dtable">
        <thead><tr><th>Line</th><th>Angle</th><th>Around OD</th><th>Mark</th><th>Decimal</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.n}><th>{r.n}</th><td>{Math.round(r.deg * 10) / 10}°</td><td>{formatFracIn(r.arc, settings.prefs)}</td><td>{formatFracIn(r.y, settings.prefs)}</td><td>{formatNumber(r.y, 3)}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ miter
export function MiterTool() {
  const [inp, set, reset] = useTool('miter', { onps: '6', ood: '', bend: '90', welds: '3', R: '9"', div: '16' });
  const f = useFmt();
  const r = attempt(() => {
    const od = odOf(inp, 'o');
    const bend = val(parseAngle, inp.bend); if (bend === undefined) throw new CalcError('INPUT', 'Enter the bend angle.');
    const R = Number(inp.welds) === 1 ? (val(parseLength, inp.R) ?? 0) : val(parseLength, inp.R);
    if (R === undefined) throw new CalcError('INPUT', 'Enter the centerline radius.');
    return miter(bend, Number(inp.welds), R, od, Number(inp.div));
  });
  const m = r.ok ? r.v : null;
  return (
    <>
      <Card>
        <OdPicker label="Pipe" inp={inp} set={set} k="o" />
        <Grid>
          <Field label="Total bend angle" unitHint="°" value={inp.bend} onChange={(v) => set('bend', v)} parse={parseAngle} />
          <Select label="Miter welds" value={inp.welds} options={['1', '2', '3', '4', '5', '6'].map((n) => [n, n === '1' ? '1 (two-piece miter)' : `${n} (${Number(n) + 1} pieces)`])} onChange={(v) => set('welds', v)} />
          <Field label="Centerline radius" value={inp.R} onChange={(v) => set('R', v)} parse={parseLength} hint={Number(inp.welds) === 1 ? 'not needed for a two-piece miter' : '1.5 × NPS is long radius'} />
          <Select label="Template divisions" value={inp.div} options={['8', '12', '16', '24', '32'].map((n) => [n, n])} onChange={(v) => set('div', v)} />
        </Grid>
        {!r.ok && <Msg>{r.err}</Msg>}
        <button className="btn ghost" onClick={reset}>Reset</button>
      </Card>
      {m && <Results rows={[
        { label: 'Cut angle on each end of a piece', value: f.ang(m.cutAngle), sub: 'tilt of the cut from square', strong: true },
        { label: 'Turn at each weld', value: f.ang(m.bend / m.welds) },
        ...(m.gore ? [
          { label: `Middle pieces (${m.gores}): heel`, value: f.len(m.gore.heel), sub: f.dec(m.gore.heel), strong: true },
          { label: 'Middle pieces: centerline', value: f.len(m.gore.center), sub: f.dec(m.gore.center) },
          { label: 'Middle pieces: throat', value: f.len(m.gore.throat), sub: f.dec(m.gore.throat) },
        ] : []),
        ...(m.welds > 1 || m.R > 0 ? [
          { label: 'End pieces (2): heel, from tangent line', value: f.len(m.end.heel), sub: f.dec(m.end.heel) },
          { label: 'End pieces: throat, from tangent line', value: f.len(m.end.throat), sub: f.dec(m.end.throat) },
          { label: 'Take-out (tangent to intersection)', value: f.len(m.takeout), sub: f.dec(m.takeout) },
        ] : []),
        { label: 'Template: heel to throat difference', value: f.len(2 * (m.od / 2) * Math.tan((m.cutAngle * Math.PI) / 180)) },
      ]} />}
      {m && <TemplatePlot pts={m.template.map((p) => ({ arc: p.arc, y: p.offset, deg: p.deg }))} circ={Math.PI * m.od} yLabel="± from square line" ref="square reference line (center of cut)" signed />}
      {m && <Card><h4>Cut ordinates (+ toward the heel side, − toward the throat)</h4><Ordinates rows={m.template.map((p, i) => ({ n: i + 1, deg: p.deg, arc: p.arc, y: p.offset }))} /></Card>}
      <Formula>
        <ul>
          <li>n welds turn B/n each, so every cut face is tilted α = B/(2n) from square.</li>
          <li>Middle pieces: centerline 2R·tanα, heel 2(R + OD/2)·tanα, throat 2(R − OD/2)·tanα. End pieces are half of that from the tangent line.</li>
          <li>Template ordinate at angle φ around the pipe (φ = 0 at the heel): (OD/2)·cosφ·tanα from a square line through the cut center.</li>
          <li>Take-out = R·tan(B/2). Pieces are measured on the OD; allow for bevel and root gap.</li>
        </ul>
      </Formula>
      <ToolActions tool="miter" title="Miter" inputs={inp} summary={m ? `Miter ${f.ang(m.bend)}, ${m.welds} welds, R ${f.len(m.R)}, OD ${m.od}: cut ${f.ang(m.cutAngle)} each end` + (m.gore ? `; middle heel ${f.len(m.gore.heel)} throat ${f.len(m.gore.throat)}` : '') : ''} disabled={!m} />
    </>
  );
}

// ------------------------------------------------------------------ cope
export function CopeTool() {
  const [inp, set, reset] = useTool('cope', { hnps: '6', hod: '', bnps: '4', bod: '', angle: '90', off: '0', div: '16' });
  const f = useFmt();
  const r = attempt(() => {
    const H = odOf(inp, 'h'), B = odOf(inp, 'b');
    const a = val(parseAngle, inp.angle); if (a === undefined) throw new CalcError('INPUT', 'Enter the branch angle.');
    return { c: cope(H, B, a, val(parseLength, inp.off) ?? 0, Number(inp.div)), H, B, a };
  });
  const c = r.ok ? r.v.c : null;
  return (
    <>
      <Card>
        <p className="lead">Fish-mouth (saddle) cut for a branch welded onto a header. Ordinates are cut-back from the square end of the branch.</p>
        <OdPicker label="Header" inp={inp} set={set} k="h" />
        <OdPicker label="Branch" inp={inp} set={set} k="b" />
        <Grid>
          <Field label="Branch angle to header" unitHint="°" value={inp.angle} onChange={(v) => set('angle', v)} parse={parseAngle} hint="90 = square tee, 45 = lateral" />
          <Field label="Offset from header centerline" value={inp.off} onChange={(v) => set('off', v)} parse={parseMeasurement} hint="0 = centered" />
          <Select label="Template divisions" value={inp.div} options={['8', '12', '16', '24', '32'].map((n) => [n, n])} onChange={(v) => set('div', v)} />
        </Grid>
        {!r.ok && <Msg>{r.err}</Msg>}
        <button className="btn ghost" onClick={reset}>Reset</button>
      </Card>
      {c && <Results rows={[
        { label: 'Depth of cut (tips to deepest point)', value: f.len(c.depth), sub: f.dec(c.depth), strong: true },
        { label: 'Branch circumference', value: f.len(c.circumference), sub: `${inp.div} spaces of ${f.len(c.circumference / Number(inp.div))}` },
      ]} />}
      {c && <TemplatePlot pts={c.points.map((p) => ({ arc: p.arc, y: p.cutback, deg: p.deg }))} circ={c.circumference} yLabel="cut back" ref="square end of branch" />}
      {c && <Card><h4>Cut-back ordinates from the square end</h4><Ordinates rows={c.points.map((p, i) => ({ n: i + 1, deg: p.deg, arc: p.arc, y: p.cutback }))} />
        <p className="fhint">Line 1 (0°) lies in the plane of the header axis{r.ok && r.v.a < 90 ? ', on the heel (obtuse) side; 180° is the crotch' : ''}. 90° and 270° are the sides.</p></Card>}
      <Formula>
        <ul>
          <li>Header radius R, branch radius r, branch angle θ, offset e. For a point at φ around the branch: distance along the branch from the header axis t = (√(R² − (r·sinφ + e)²) − r·cosφ·cosθ) / sinθ.</li>
          <li>Cut-back = t − t(min). Uses outside diameters; for set-in branches or heavy wall, use the header OD and the branch ID for the inside line and fair between them.</li>
        </ul>
      </Formula>
      <ToolActions tool="cope" title="Cope" inputs={inp} summary={c && r.ok ? `Cope ${r.v.B}" OD branch on ${r.v.H}" OD header at ${f.ang(r.v.a)}: depth ${f.len(c.depth)}\n` + c.points.map((p, i) => `${i + 1}: ${f.len(p.cutback)}`).join(', ') : ''} disabled={!c} />
    </>
  );
}

// ------------------------------------------------------------------ thermal expansion
export function ExpansionTool() {
  const [inp, set, reset] = useTool('expansion', { mat: 'carbon', L: "100'", from: '70', to: '350', unit: 'F' });
  const f = useFmt();
  const r = attempt(() => {
    const L = val(parseLength, inp.L); if (L === undefined) throw new CalcError('INPUT', 'Enter the pipe length.');
    const a = Number(inp.from), b = Number(inp.to);
    if (!isFinite(a) || !isFinite(b) || inp.from === '' || inp.to === '') throw new CalcError('INPUT', 'Enter both temperatures.');
    const toF = (t: number) => (inp.unit === 'C' ? t * 9 / 5 + 32 : t);
    return thermalExpansion(inp.mat, L, toF(a), toF(b));
  });
  const t = r.ok ? r.v : null;
  return (
    <>
      <Card>
        <Grid>
          <Select label="Material" value={inp.mat} options={Object.entries(EXPANSION_COEFF).map(([k, v]) => [k, v.label])} onChange={(v) => set('mat', v)} />
          <Field label="Pipe length" value={inp.L} onChange={(v) => set('L', v)} parse={parseLength} />
          <Field label="Installed temperature" value={inp.from} onChange={(v) => set('from', v)} inputMode="decimal" />
          <Field label="Operating temperature" value={inp.to} onChange={(v) => set('to', v)} inputMode="decimal" />
        </Grid>
        <Segmented small value={inp.unit} onChange={(v) => set('unit', v)} options={[['F', '°F'], ['C', '°C']]} />
        {!r.ok && <Msg>{r.err}</Msg>}
        <button className="btn ghost" onClick={reset}>Reset</button>
      </Card>
      {t && <Results rows={[
        { label: t.dL >= 0 ? 'Growth' : 'Shrinkage', value: f.len(Math.abs(t.dL), 'infrac'), sub: `${formatNumber(Math.abs(t.dL), 4)} in · ${formatNumber(Math.abs(t.dL) * 25.4, 2)} mm`, strong: true },
        { label: 'Per 100 ft of pipe', value: f.len(Math.abs(t.perHundredFt), 'infrac'), sub: `${formatNumber(Math.abs(t.perHundredFt), 4)} in` },
        { label: 'Temperature change', value: `${formatNumber(inp.unit === 'C' ? t.dT * 5 / 9 : t.dT, 2)} °${inp.unit}` },
        { label: 'Coefficient used', value: `${formatNumber(t.coeff * 1e6, 2)} × 10⁻⁶ in/in·°F` },
      ]} />}
      <Formula><p>ΔL = α × L × ΔT. {EXPANSION_SOURCE}</p></Formula>
      <ToolActions tool="expansion" title="Thermal expansion" inputs={inp} summary={t ? `${EXPANSION_COEFF[inp.mat].label}, ${inp.L}, ${inp.from}→${inp.to} °${inp.unit}: ${f.len(t.dL, 'infrac')}` : ''} disabled={!t} />
    </>
  );
}
