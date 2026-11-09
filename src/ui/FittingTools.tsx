import React from 'react';
import { Field, Results, Row, Msg, Formula, ToolActions, Segmented, Select, useTool, useFmt, Card, Grid } from './components';
// Take-out, Cut length and Trim — shown on the Layout tab (the Fittings tab was folded into Layout).
import { TrimDiagram } from './diagrams';
import { parseLength, parseAngle, tryParse } from '../engine/parse';
import { elbowTakeout, B169, ELBOW_ORDER, ELBOW_LABEL, ElbowType, arcs, idealTakeout, trimElbow, steelOD, B169_SOURCE } from '../engine/fittings';
import { NPS_SORTED } from '../engine/fittings';
import { CalcError } from '../engine/units';
import { CutSection, CUT_DEFAULTS } from './LayoutTools';

const val = <T,>(fn: (s: string) => T, s: string): T | undefined => {
  const r = tryParse(fn, s);
  if (r === null) return undefined;
  if (!r.ok) throw new CalcError('INPUT', r.err);
  return r.v;
};
function attempt<T>(f: () => T): { ok: true; v: T } | { ok: false; err: string } {
  try { return { ok: true, v: f() }; } catch (e) { return { ok: false, err: (e as Error).message }; }
}
const NPS_OPTS: Array<[string, string]> = NPS_SORTED.map((k) => [k, `${k}" NPS`]);
const EL_OPTS: Array<[string, string]> = ELBOW_ORDER.map((e) => [e, `${e} — ${ELBOW_LABEL[e]}`]);

function GeometrySource({ inp, set, withElbow }: { inp: Record<string, string>; set: (k: string, v: string) => void; withElbow: boolean }) {
  return (
    <>
      <Segmented small value={inp.src} onChange={(v) => set('src', v)} options={[['nps', 'Standard butt-weld (B16.9)'], ['manual', 'Manual radius & OD']]} />
      {inp.src === 'nps' ? (
        <Grid>
          <Select label="Nominal pipe size" value={inp.nps} options={NPS_OPTS} onChange={(v) => set('nps', v)} />
          {withElbow ? <Select label="Elbow type" value={inp.el} options={EL_OPTS} onChange={(v) => set('el', v)} />
            : <Select label="Radius" value={inp.rad} options={[['LR', 'Long radius'], ['SR', 'Short radius']]} onChange={(v) => set('rad', v)} />}
        </Grid>
      ) : (
        <Grid>
          <Field label="Centerline bend radius R" value={inp.R} onChange={(v) => set('R', v)} parse={parseLength} hint="= 90° center-to-face of the elbow" />
          <Field label="Actual pipe OD" value={inp.OD} onChange={(v) => set('OD', v)} parse={parseLength} hint="actual OD, not nominal size" />
        </Grid>
      )}
    </>
  );
}

export function TakeoutTool() {
  const [inp, set, reset] = useTool('takeout', { src: 'nps', nps: '6', el: 'BW-L', R: '', OD: '', angle: '45' });
  const f = useFmt();
  const r = attempt(() => {
    const th = val(parseAngle, inp.angle);
    if (th === undefined) throw new CalcError('INPUT', 'Enter the bend angle.');
    if (th < 1 || th > 90) throw new CalcError('GEOM', 'Bend angle must be 1°–90°.');
    if (inp.src === 'nps') {
      const t = elbowTakeout(inp.nps, th, inp.el as ElbowType);
      return { th, to: t.takeout, R: t.R, od: t.od, arcs: t.arcs!, note: t.note, ideal: idealTakeout(t.R, th) };
    }
    const R = val(parseLength, inp.R); const od = val(parseLength, inp.OD);
    if (R === undefined) throw new CalcError('INPUT', 'Enter the bend radius.');
    const to = idealTakeout(R, th);
    return { th, to, R, od: od ?? NaN, arcs: od !== undefined ? arcs(R, od, th) : null, note: 'Ideal circular bend R·tan(θ/2).', ideal: to };
  });
  const res = r.ok ? r.v : null;
  const rows: Row[] = res ? [
    { label: 'Take-out (center to face)', value: f.len(res.to), sub: f.dec(res.to), strong: true },
    ...(Math.abs(res.to - res.ideal) > 1e-9 ? [{ label: 'Ideal R·tan(θ/2) for comparison', value: f.len(res.ideal), sub: f.dec(res.ideal) }] : []),
    { label: 'Bend radius R', value: f.len(res.R), sub: f.dec(res.R) },
    ...(isFinite(res.od) ? [{ label: 'Pipe OD used for arcs', value: f.len(res.od, 'indec') }] : []),
    ...(res.arcs ? [
      { label: 'Inside (throat) arc', value: f.len(res.arcs.inside), sub: f.dec(res.arcs.inside) },
      { label: 'Centerline arc', value: f.len(res.arcs.center), sub: f.dec(res.arcs.center) },
      { label: 'Outside (heel) arc', value: f.len(res.arcs.outside), sub: f.dec(res.arcs.outside) },
    ] : [{ label: 'Arcs', value: '—', sub: 'enter OD for arc lengths' }]),
  ] : [];
  return (
    <>
      <Card>
        <GeometrySource inp={inp} set={set} withElbow />
        <Field label="Bend angle θ" unitHint="°" value={inp.angle} onChange={(v) => set('angle', v)} parse={parseAngle} hint="1° to 90°" />
        {!r.ok && <Msg>{r.err}</Msg>}
        <button className="btn ghost" onClick={reset}>Reset</button>
      </Card>
      {res && <Results rows={rows} />}
      {res && <Msg kind="info">{res.note}</Msg>}
      <Formula>
        <p>Ideal circular bend of centerline radius R through angle θ (radians for arcs):</p>
        <ul><li>Take-out = R·tan(θ/2)</li><li>Centerline arc = R·θ</li><li>Inside arc = (R − OD/2)·θ; outside arc = (R + OD/2)·θ</li></ul>
        <p>Factory 90° and long-radius 45° butt-weld elbows use the tabulated center-to-end dimension, which can differ from the ideal value (most at small sizes). Source: {B169_SOURCE} Arcs use carbon-steel OD from ASME B36.10M.</p>
      </Formula>
      <ToolActions tool="takeout" title="Take-out & arcs" inputs={inp} summary={res ? `Take-out ${f.len(res.to)} at ${f.ang(res.th)}, R ${f.len(res.R)}` + (res.arcs ? `\nArcs: inside ${f.len(res.arcs.inside)}, center ${f.len(res.arcs.center)}, outside ${f.len(res.arcs.outside)}` : '') : ''} disabled={!res} />
    </>
  );
}

export function CutTool() {
  const [inp, set, reset] = useTool('cutlen', { L: '', theta: '45', ...CUT_DEFAULTS, cut: '1' });
  const f = useFmt();
  const r = attempt(() => {
    const L = val(parseLength, inp.L); const th = val(parseAngle, inp.theta);
    if (L === undefined) throw new CalcError('INPUT', 'Enter the center-to-center travel.');
    if (th === undefined) throw new CalcError('INPUT', 'Enter the fitting angle (used for standard take-outs).');
    if (th <= 0 || th > 90) throw new CalcError('GEOM', 'Fitting angle must be greater than 0° and at most 90°.');
    return { L, th };
  });
  return (
    <>
      <Card>
        <p className="lead">Straight pipe between two fittings: cut = travel − take-out₁ − gap₁ − take-out₂ − gap₂.</p>
        <Grid>
          <Field label="Center-to-center travel" value={inp.L} onChange={(v) => set('L', v)} parse={parseLength} />
          <Field label="Fitting angle" unitHint="°" value={inp.theta} onChange={(v) => set('theta', v)} parse={parseAngle} />
        </Grid>
        {inp.L && !r.ok && <Msg>{r.err}</Msg>}
        <button className="btn ghost" onClick={reset}>Reset</button>
      </Card>
      {r.ok && <CutSection inp={{ ...inp, cut: '1' }} set={set} travel={r.v.L} theta={r.v.th} />}
      <ToolActions tool="cutlen" title="Cut length" inputs={inp} summary={r.ok ? `Cut length for travel ${f.len(r.v.L)} at ${f.ang(r.v.th)}` : ''} disabled={!r.ok} />
    </>
  );
}

export function TrimTool() {
  const [inp, set, reset] = useTool('trim', { src: 'nps', nps: '6', rad: 'LR', R: '', OD: '', keep: '30' });
  const f = useFmt();
  const r = attempt(() => {
    const keep = val(parseAngle, inp.keep);
    if (keep === undefined) throw new CalcError('INPUT', 'Enter the angle to keep.');
    let R: number, od: number;
    if (inp.src === 'nps') {
      const row = B169[inp.nps];
      const rr = inp.rad === 'LR' ? row.lr90 : row.sr90;
      if (rr === undefined) throw new CalcError('DATA', `No short-radius elbow for NPS ${inp.nps}.`);
      R = rr; od = steelOD(inp.nps);
    } else {
      const a = val(parseLength, inp.R), b = val(parseLength, inp.OD);
      if (a === undefined || b === undefined) throw new CalcError('INPUT', 'Enter the bend radius and actual OD.');
      R = a; od = b;
    }
    return trimElbow(R, od, keep);
  });
  const res = r.ok ? r.v : null;
  return (
    <>
      <TrimDiagram beta={res?.retained ?? 30} kept={res ? f.ang(res.retained) : 'β'} removed={res ? f.ang(res.removed) : '90° − β'}
        arcs={{ i: res ? f.len(res.keepArcs.inside) : '', c: res ? f.len(res.keepArcs.center) : '', o: res ? f.len(res.keepArcs.outside) : '' }} />
      <Card>
        <GeometrySource inp={inp} set={set} withElbow={false} />
        <Field label="Angle to keep (retained bend)" unitHint="°" value={inp.keep} onChange={(v) => set('keep', v)} parse={parseAngle} hint="The finished fitting angle, 1°–90°" />
        {!r.ok && <Msg>{r.err}</Msg>}
        <button className="btn ghost" onClick={reset}>Reset</button>
      </Card>
      {res && <Results rows={[
        { label: 'Retained angle (fitting you keep)', value: f.ang(res.retained), strong: true },
        { label: 'Removed angle (offcut)', value: f.ang(res.removed) },
        { label: 'Inside arc from kept end', value: f.len(res.keepArcs.inside), sub: f.dec(res.keepArcs.inside), strong: true },
        { label: 'Centerline arc from kept end', value: f.len(res.keepArcs.center), sub: f.dec(res.keepArcs.center), strong: true },
        { label: 'Outside arc from kept end', value: f.len(res.keepArcs.outside), sub: f.dec(res.keepArcs.outside), strong: true },
        { label: 'Check: arcs from the other end', value: `${f.len(res.removeArcs.inside)} / ${f.len(res.removeArcs.center)} / ${f.len(res.removeArcs.outside)}`, sub: 'inside / center / outside' },
        { label: 'Take-out of trimmed fitting', value: f.len(res.takeout), sub: 'ideal R·tan(β/2), measured at the kept end' },
        { label: 'R / OD used', value: `${f.len(res.R, 'indec')} / ${f.len(res.od, 'indec')}` },
      ]} />}
      <Formula>
        <ul><li>Arcs from the kept factory end: (R − OD/2)·β, R·β, (R + OD/2)·β (β in radians)</li><li>Removed piece: 90° − β; its arcs are measured from the other factory end.</li><li>Ideal circular bend; actual fittings may vary — check against the fitting.</li></ul>
      </Formula>
      <ToolActions tool="trim" title="Elbow trim" inputs={inp} summary={res ? `Trim 90° elbow to ${f.ang(res.retained)} (remove ${f.ang(res.removed)})\nFrom kept end: inside ${f.len(res.keepArcs.inside)}, center ${f.len(res.keepArcs.center)}, outside ${f.len(res.keepArcs.outside)}` : ''} disabled={!res} />
    </>
  );
}
