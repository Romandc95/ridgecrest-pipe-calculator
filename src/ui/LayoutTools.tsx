import React from 'react';
import { Field, Results, Row, Msg, Formula, ToolActions, Segmented, Select, useTool, useFmt, Card, Grid, LEN_HINT } from './components';
import { SimpleOffsetDiagram, RollingOffsetDiagram, CutbackDiagram, CombinationDiagram } from './diagrams';
import { parseLength, parseAngle, parseMeasurement, tryParse } from '../engine/parse';
import { solveSimpleOffset, solveRollingOffset, parallelCutback, combinationOffset, AXES, Axis } from '../engine/layout';
import { elbowTakeout, B169, ELBOW_ORDER, ELBOW_LABEL, ElbowType, cutLength } from '../engine/fittings';
import { CalcError } from '../engine/units';

const val = <T,>(fn: (s: string) => T, s: string): T | undefined => {
  const r = tryParse(fn, s);
  if (r === null) return undefined;
  if (!r.ok) throw new CalcError('INPUT', r.err);
  return r.v;
};
function attempt<T>(f: () => T): { ok: true; v: T } | { ok: false; err: string } {
  try { return { ok: true, v: f() }; } catch (e) { return { ok: false, err: (e as Error).message }; }
}

export function LayoutTools() {
  const [t, set] = useTool('layout', { tab: 'simple' });
  return (
    <div className="tool">
      <Segmented value={t.tab} onChange={(v) => set('tab', v)} options={[['simple', 'Offset'], ['rolling', 'Rolling'], ['slope', 'Slope'], ['cutback', 'Cutback'], ['combo', 'Combo']]} />
      {t.tab === 'simple' && <SimpleOffset />}
      {t.tab === 'rolling' && <RollingOffset />}
      {t.tab === 'slope' && <SlopeTool />}
      {t.tab === 'cutback' && <CutbackTool />}
      {t.tab === 'combo' && <ComboTool />}
    </div>
  );
}

// ---------------------------------------------------------------- simple offset
function SimpleOffset() {
  const D = { O: '', A: '', L: '', theta: '' };
  const [inp, set, reset] = useTool('simple', { ...D, ...CUT_DEFAULTS });
  const f = useFmt();
  const r = attempt(() => solveSimpleOffset({ O: val(parseLength, inp.O), A: val(parseLength, inp.A), L: val(parseLength, inp.L), theta: val(parseAngle, inp.theta) }));
  const filled = ['O', 'A', 'L', 'theta'].filter((k) => inp[k].trim()).length;
  const res = r.ok ? r.v : null;
  const rows: Row[] = res ? [
    { label: 'Travel L (center to center)', value: f.len(res.L), sub: f.dec(res.L), strong: true, tag: inp.L ? 'given' : 'solved' },
    { label: 'Bend angle θ', value: f.ang(res.theta), tag: inp.theta ? 'given' : 'solved' },
    { label: 'Run A', value: f.len(res.A), sub: f.dec(res.A), tag: inp.A ? 'given' : 'solved' },
    { label: 'Offset O', value: f.len(res.O), sub: f.dec(res.O), tag: inp.O ? 'given' : 'solved' },
  ] : [];
  const summary = res ? `Simple offset\nO ${f.len(res.O)}  A ${f.len(res.A)}\nL ${f.len(res.L)} (${f.dec(res.L)})\nθ ${f.ang(res.theta)}` : '';
  return (
    <>
      <SimpleOffsetDiagram O={res ? f.len(res.O) : 'O'} A={res ? f.len(res.A) : 'A'} L={res ? f.len(res.L) : 'L'} T={res ? f.ang(res.theta) : ''} />
      <Card>
        <p className="lead">Enter any two. Leave the others blank — they are solved.</p>
        <Grid>
          <Field label="Offset O" value={inp.O} onChange={(v) => set('O', v)} parse={parseLength} derived={res && !inp.O ? f.len(res.O) : null} />
          <Field label="Run A" value={inp.A} onChange={(v) => set('A', v)} parse={parseLength} derived={res && !inp.A ? f.len(res.A) : null} />
          <Field label="Travel L" value={inp.L} onChange={(v) => set('L', v)} parse={parseLength} derived={res && !inp.L ? f.len(res.L) : null} />
          <Field label="Angle θ" unitHint="°" value={inp.theta} onChange={(v) => set('theta', v)} parse={parseAngle} derived={res && !inp.theta ? f.ang(res.theta) : null} />
        </Grid>
        <p className="fhint">{LEN_HINT}. Unitless numbers are inches.</p>
        {filled > 0 && !r.ok && <Msg>{r.err}</Msg>}
        <button className="btn ghost" onClick={reset}>Clear inputs</button>
      </Card>
      {res && <Results rows={rows} />}
      {res && <CutSection inp={inp} set={set} travel={res.L} theta={res.theta} />}
      <Formula>
        <p>Right-triangle offset, two fittings of equal angle θ:</p>
        <ul><li>L = √(A² + O²), θ = atan2(O, A)</li><li>L = O / sin θ and A = O / tan θ when O and θ are known</li><li>O = A·tan θ, L = A / cos θ when A and θ are known</li><li>A = √(L² − O²), θ = asin(O/L); O = √(L² − A²), θ = acos(A/L)</li></ul>
        <p>If three values are entered they must agree within 1/1024" and 0.005°, otherwise the conflict is reported.</p>
        {res && <p>Used: {res.formulas.join(' ; ')}</p>}
      </Formula>
      <ToolActions tool="simple" title="Simple offset" inputs={inp} summary={summary + cutSummary(inp, res?.L, res?.theta, f)} disabled={!res} />
    </>
  );
}

// ---------------------------------------------------------------- cut length section (shared)
export const CUT_DEFAULTS = {
  cut: '', src1: 'nps', nps1: '6', el1: 'BW-L', to1: '', gap1: '1/8"', same: '1', src2: 'nps', nps2: '6', el2: 'BW-L', to2: '', gap2: '1/8"',
};

function endTakeout(inp: Record<string, string>, n: 1 | 2, theta: number): { to: number; note: string } {
  const k = (s: string) => inp[`${s}${n}`];
  if (k('src') === 'manual') {
    const v = val(parseLength, k('to'));
    if (v === undefined) throw new CalcError('INPUT', `Enter fitting ${n} take-out (center-to-face for this angle).`);
    if (v < 0) throw new CalcError('INPUT', 'Take-out must not be negative.');
    return { to: v, note: 'manual (measured / manufacturer)' };
  }
  const t = elbowTakeout(k('nps'), theta, k('el') as ElbowType);
  return { to: t.takeout, note: t.method === 'ideal' ? `ideal R·tan(θ/2), R ${t.R}"` : 'ASME B16.9 table' };
}

function computeCut(inp: Record<string, string>, travel: number, theta: number) {
  const e1 = endTakeout(inp, 1, theta);
  const e2 = inp.same === '1' ? e1 : endTakeout(inp, 2, theta);
  const g1 = val(parseLength, inp.gap1) ?? 0;
  const g2 = inp.same === '1' ? g1 : val(parseLength, inp.gap2) ?? 0;
  if (g1 < 0 || g2 < 0) throw new CalcError('INPUT', 'Gaps must be zero or positive.');
  return { e1, e2, g1, g2, ...cutLength({ travel, to1: e1.to, to2: e2.to, gap1: g1, gap2: g2 }) };
}

function cutSummary(inp: Record<string, string>, travel: number | undefined, theta: number | undefined, f: ReturnType<typeof useFmt>) {
  if (inp.cut !== '1' || travel === undefined || theta === undefined) return '';
  const r = attempt(() => computeCut(inp, travel, theta));
  if (!r.ok) return `\nCut length: ${r.err}`;
  return `\nCut length ${f.len(r.v.cut)} = L ${f.len(travel)} − TO₁ ${f.len(r.v.e1.to)} − gap ${f.len(r.v.g1)} − TO₂ ${f.len(r.v.e2.to)} − gap ${f.len(r.v.g2)}`;
}

const NPS_OPTS: Array<[string, string]> = Object.keys(B169).map((k) => [k, `${k}" NPS`]);
const EL_OPTS: Array<[string, string]> = ELBOW_ORDER.map((e) => [e, `${e} — ${ELBOW_LABEL[e]}`]);

export function CutSection({ inp, set, travel, theta }: { inp: Record<string, string>; set: (k: string, v: string) => void; travel: number; theta: number }) {
  const f = useFmt();
  const on = inp.cut === '1';
  const end = (n: 1 | 2) => (
    <div className="endbox">
      <h4>{n === 1 ? 'Fitting 1 (upstream)' : 'Fitting 2 (downstream)'}</h4>
      <Segmented small value={inp[`src${n}`]} onChange={(v) => set(`src${n}`, v)} options={[['nps', 'Butt-weld elbow'], ['manual', 'Known take-out']]} />
      {inp[`src${n}`] === 'nps' ? (
        <Grid>
          <Select label="Nominal size" value={inp[`nps${n}`]} options={NPS_OPTS} onChange={(v) => set(`nps${n}`, v)} />
          <Select label="Elbow type" value={inp[`el${n}`]} options={EL_OPTS} onChange={(v) => set(`el${n}`, v)} />
        </Grid>
      ) : <Field label="Take-out (center to face)" value={inp[`to${n}`]} onChange={(v) => set(`to${n}`, v)} parse={parseLength} />}
      <Field label={`Gap at joint ${n}`} value={inp[`gap${n}`]} onChange={(v) => set(`gap${n}`, v)} parse={parseLength} hint="Root gap between pipe end and fitting face. 0 is valid." />
    </div>
  );
  const r = on ? attempt(() => computeCut(inp, travel, theta)) : null;
  return (
    <Card className="cutsec">
      <label className="toggle"><input type="checkbox" checked={on} onChange={(e) => set('cut', e.target.checked ? '1' : '')} /> Pipe cut length between the two fittings</label>
      {on && (
        <>
          {end(1)}
          <label className="toggle sm"><input type="checkbox" checked={inp.same === '1'} onChange={(e) => set('same', e.target.checked ? '1' : '')} /> Fitting 2 same as fitting 1</label>
          {inp.same !== '1' && end(2)}
          {r && !r.ok && <Msg>{r.err}</Msg>}
          {r && r.ok && (
            <>
              <Results title="Cut length" rows={[
                { label: 'Center-to-center travel L', value: f.len(travel), sub: f.dec(travel) },
                { label: `− Fitting 1 take-out`, value: f.len(r.v.e1.to), sub: r.v.e1.note },
                { label: '− Gap, joint 1', value: f.len(r.v.g1) },
                { label: `− Fitting 2 take-out`, value: f.len(r.v.e2.to), sub: r.v.e2.note },
                { label: '− Gap, joint 2', value: f.len(r.v.g2) },
                { label: 'Cut length (end to end)', value: r.v.ok ? f.len(r.v.cut) : 'Impossible', sub: r.v.ok ? f.dec(r.v.cut) : undefined, strong: true, warn: !r.v.ok },
              ]} />
              {r.v.message && <Msg kind={r.v.ok ? 'info' : 'error'}>{r.v.message}</Msg>}
            </>
          )}
          <p className="fhint">Take-outs from ASME B16.9 use carbon-steel OD and LR/SR radius for the NPS. Field-cut and odd angles use the ideal circular bend R·tan(θ/2). Use “Known take-out” for socket, threaded, grooved, copper or measured fittings.</p>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- rolling offset
function RollingOffset() {
  const D = { mode: 'hv', H: '', V: '', O: '', phi: '', A: '', L: '', theta: '' };
  const [inp, set, reset] = useTool('rolling', { ...D, ...CUT_DEFAULTS });
  const f = useFmt();
  const hv = inp.mode === 'hv';
  const r = attempt(() => solveRollingOffset({
    H: hv ? val(parseLength, inp.H) : undefined, V: hv ? val(parseLength, inp.V) : undefined,
    Ores: !hv ? val(parseLength, inp.O) : undefined, phi: !hv ? val(parseAngle, inp.phi) : undefined,
    A: val(parseLength, inp.A), L: val(parseLength, inp.L), theta: val(parseAngle, inp.theta),
  }));
  const res = r.ok ? r.v : null;
  const any = Object.entries(inp).some(([k, v]) => ['H', 'V', 'O', 'phi', 'A', 'L', 'theta'].includes(k) && v.trim());
  const rows: Row[] = res ? [
    { label: 'Travel L (center to center)', value: f.len(res.L), sub: f.dec(res.L), strong: true },
    { label: 'Bend angle θ (each fitting)', value: f.ang(res.theta) },
    { label: 'Resultant (true) offset O', value: f.len(res.Ores), sub: f.dec(res.Ores) },
    { label: 'Run / advance A', value: f.len(res.A), sub: f.dec(res.A) },
    ...(isFinite(res.H) ? [
      { label: 'Horizontal H', value: f.len(res.H), sub: f.dec(res.H) },
      { label: 'Vertical V', value: f.len(res.V), sub: f.dec(res.V) },
      { label: 'Offset-plane rotation φ', value: f.ang(res.phi), sub: 'from +H toward +V, looking downstream' },
    ] : [{ label: 'Offset-plane rotation φ', value: 'unknown', sub: 'enter H and V (or O and φ)' }]),
  ] : [];
  const summary = res ? `Rolling offset\nH ${f.len(res.H)}  V ${f.len(res.V)}  A ${f.len(res.A)}\nO ${f.len(res.Ores)}  φ ${f.ang(res.phi)}\nL ${f.len(res.L)}  θ ${f.ang(res.theta)}` : '';
  return (
    <>
      <RollingOffsetDiagram H={res && isFinite(res.H) ? f.len(res.H) : ''} V={res && isFinite(res.V) ? f.len(res.V) : ''} A={res ? f.len(res.A) : ''} L={res ? f.len(res.L) : ''} T={res ? f.ang(res.theta) : ''} phi={res && isFinite(res.phi) ? f.ang(res.phi) : ''} />
      <Card>
        <Segmented small value={inp.mode} onChange={(v) => set('mode', v)} options={[['hv', 'Offset as H and V'], ['op', 'Offset as O and φ']]} />
        <Grid>
          {hv ? <>
            <Field label="Horizontal H" value={inp.H} onChange={(v) => set('H', v)} parse={parseLength} hint="+ toward reference side, − opposite" />
            <Field label="Vertical V" value={inp.V} onChange={(v) => set('V', v)} parse={parseLength} hint="+ up (rise), − down (drop)" />
          </> : <>
            <Field label="Resultant offset O" value={inp.O} onChange={(v) => set('O', v)} parse={parseLength} />
            <Field label="Rotation φ" unitHint="°" value={inp.phi} onChange={(v) => set('phi', v)} parse={parseAngle} hint="from +H toward +V" />
          </>}
        </Grid>
        <p className="lead">…plus one of:</p>
        <Grid>
          <Field label="Run A" value={inp.A} onChange={(v) => set('A', v)} parse={parseLength} derived={res && !inp.A ? f.len(res.A) : null} />
          <Field label="Travel L" value={inp.L} onChange={(v) => set('L', v)} parse={parseLength} derived={res && !inp.L ? f.len(res.L) : null} />
          <Field label="Bend angle θ" unitHint="°" value={inp.theta} onChange={(v) => set('theta', v)} parse={parseAngle} derived={res && !inp.theta ? f.ang(res.theta) : null} />
        </Grid>
        {any && !r.ok && <Msg>{r.err}</Msg>}
        <button className="btn ghost" onClick={reset}>Clear inputs</button>
      </Card>
      {res && <Results rows={rows} />}
      {res && <CutSection inp={inp} set={set} travel={res.L} theta={res.theta} />}
      <Formula>
        <ul>
          <li>O = √(H² + V²); L = √(A² + H² + V²); θ = atan2(O, A)</li>
          <li>φ = atan2(V, H), measured from the horizontal transverse axis (+H) toward +V, looking downstream along A.</li>
          <li>φ fixes the plane that contains both bends. How an elbow is clocked on the pipe depends on where its previous fitting points — φ is not the elbow roll mark.</li>
          <li>Reference calculator equivalent: Offset = one component, Roll = the other, Run = advance.</li>
        </ul>
        {res && <p>Used: {res.formulas.join(' ; ')}</p>}
      </Formula>
      <ToolActions tool="rolling" title="Rolling offset" inputs={inp} summary={summary + cutSummary(inp, res?.L, res?.theta, f)} disabled={!res} />
    </>
  );
}

// ---------------------------------------------------------------- slope / grade / drop
function SlopeTool() {
  const [inp, set, reset] = useTool('slope', { run: '', which: 'slope', slope: '', angle: '', grade: '', drop: '' });
  const f = useFmt();
  const r = attempt(() => {
    const run = val(parseLength, inp.run);
    let theta: number | undefined; let drop: number | undefined;
    if (inp.which === 'slope') { const s = val(parseLength, inp.slope); if (s !== undefined) theta = Math.atan(s / 12) * 180 / Math.PI; }
    else if (inp.which === 'angle') theta = val(parseAngle, inp.angle);
    else if (inp.which === 'grade') { const g = val(parseMeasurement, inp.grade); if (g) theta = Math.atan(g.unit === 'pct' ? g.v : g.v / 100) * 180 / Math.PI; }
    else drop = val(parseLength, inp.drop);
    if (theta !== undefined && theta === 0) {
      if (run === undefined) throw new CalcError('INPUT', 'Enter the run.');
      return { O: 0, A: run, L: run, theta: 0 };
    }
    return solveSimpleOffset({ A: run, O: drop, theta });
  });
  const res = r.ok ? r.v : null;
  const g = res ? (res.A > 0 ? res.O / res.A : Infinity) : 0;
  const rows: Row[] = res ? [
    { label: 'Total drop (fall)', value: f.len(res.O), sub: f.dec(res.O), strong: true },
    { label: 'Slope per foot of run', value: f.len(g * 12, 'infrac'), sub: `${f.num(g * 12, 5)} in/ft` },
    { label: 'Angle', value: f.ang(res.theta) },
    { label: 'Percent grade', value: `${f.num(g * 100, 4)} %` },
    { label: 'Grade (rise/run)', value: f.num(g, 6) },
    { label: 'Run', value: f.len(res.A) },
    { label: 'Pipe length along slope', value: f.len(res.L), sub: f.dec(res.L) },
  ] : [];
  return (
    <>
      <Card>
        <Field label="Horizontal run" value={inp.run} onChange={(v) => set('run', v)} parse={parseLength} hint={`e.g. 25'`} />
        <Segmented small value={inp.which} onChange={(v) => set('which', v)} options={[['slope', 'Slope/ft'], ['angle', 'Angle'], ['grade', '% Grade'], ['drop', 'Drop']]} />
        {inp.which === 'slope' && <Field label="Slope per foot" value={inp.slope} onChange={(v) => set('slope', v)} parse={parseLength} hint={`e.g. 1/8" or 1/4"`} />}
        {inp.which === 'angle' && <Field label="Angle" unitHint="°" value={inp.angle} onChange={(v) => set('angle', v)} parse={parseAngle} />}
        {inp.which === 'grade' && <Field label="Percent grade" unitHint="%" value={inp.grade} onChange={(v) => set('grade', v)} parse={parseMeasurement} hint="e.g. 2 or 2%" />}
        {inp.which === 'drop' && <Field label="Total drop" value={inp.drop} onChange={(v) => set('drop', v)} parse={parseLength} />}
        {inp.run && !r.ok && <Msg>{r.err}</Msg>}
        <button className="btn ghost" onClick={reset}>Clear inputs</button>
      </Card>
      {res && <Results rows={rows} />}
      <Formula><ul><li>Slope is fall per 12" of horizontal run; grade = drop ÷ run; % grade = 100 × grade; angle = atan(grade).</li><li>Drop = run × slope ÷ 12.</li></ul></Formula>
      <ToolActions tool="slope" title="Slope / drop" inputs={inp} summary={res ? `Slope: run ${f.len(res.A)}, drop ${f.len(res.O)}, ${f.len(g * 12, 'infrac')}/ft, ${f.num(g * 100, 4)}%, ${f.ang(res.theta)}` : ''} disabled={!res} />
    </>
  );
}

// ---------------------------------------------------------------- cutback
function CutbackTool() {
  const [inp, set, reset] = useTool('cutback', { S: '', theta: '45' });
  const f = useFmt();
  const r = attempt(() => {
    const S = val(parseLength, inp.S), t = val(parseAngle, inp.theta);
    if (S === undefined || t === undefined) throw new CalcError('INPUT', 'Enter spacing and bend angle.');
    return { S, t, c: parallelCutback(S, t) };
  });
  const res = r.ok ? r.v : null;
  return (
    <>
      <CutbackDiagram S={res ? f.len(res.S) : 'S'} T={res ? f.ang(res.t) : 'θ'} C={res ? f.len(res.c) : ''} />
      <Card>
        <Grid>
          <Field label="Center-to-center spacing" value={inp.S} onChange={(v) => set('S', v)} parse={parseLength} />
          <Field label="Bend angle θ" unitHint="°" value={inp.theta} onChange={(v) => set('theta', v)} parse={parseAngle} />
        </Grid>
        {inp.S && !r.ok && <Msg>{r.err}</Msg>}
        <button className="btn ghost" onClick={reset}>Clear inputs</button>
      </Card>
      {res && <Results rows={[{ label: 'Cutback (each successive pipe)', value: f.len(res.c), sub: f.dec(res.c), strong: true }, { label: 'Spacing', value: f.len(res.S) }, { label: 'Bend angle', value: f.ang(res.t) }]} />}
      <Formula><p>cutback = spacing × tan(θ/2). Each pipe further inside the turn starts its bend one cutback earlier; for more pipes at equal spacing, multiply.</p></Formula>
      <ToolActions tool="cutback" title="Parallel cutback" inputs={inp} summary={res ? `Cutback ${f.len(res.c)} (spacing ${f.len(res.S)}, θ ${f.ang(res.t)})` : ''} disabled={!res} />
    </>
  );
}

// ---------------------------------------------------------------- combination offset
const AXIS_OPTS: Array<[string, string]> = (Object.keys(AXES) as Axis[]).map((a) => [a, a + ({ '+X': ' (run)', '-X': '', '+Y': ' (horiz.)', '-Y': '', '+Z': ' (up)', '-Z': ' (down)' } as Record<string, string>)[a]]);
function ComboTool() {
  const [inp, set, reset] = useTool('combo', { X: '', Y: '', Z: '', inDir: '+X', outDir: '+Z' });
  const f = useFmt();
  const r = attempt(() => {
    const X = val(parseLength, inp.X) ?? 0, Y = val(parseLength, inp.Y) ?? 0, Z = val(parseLength, inp.Z) ?? 0;
    if (!inp.X && !inp.Y && !inp.Z) throw new CalcError('INPUT', 'Enter the displacements between fitting centers.');
    const c = combinationOffset([X, Y, Z], AXES[inp.inDir as Axis], AXES[inp.outDir as Axis]);
    return { ...c, X, Y, Z };
  });
  const res = r.ok ? r.v : null;
  return (
    <>
      <CombinationDiagram dx={res?.X ?? 3} dy={res?.Y ?? 2} dz={res?.Z ?? 1.5} inDir={AXES[inp.inDir as Axis]} outDir={AXES[inp.outDir as Axis]} L={res ? f.len(res.L) : ''} entry={res ? f.ang(res.entry) : ''} exit={res ? f.ang(res.exit) : ''} />
      <Card>
        <p className="lead">Combination rolling offset: entry and exit fittings in different planes, so their angles differ. Enter the center-to-center displacement and the incoming / outgoing directions.</p>
        <div className="presets">
          <button className="chip" onClick={() => { set('inDir', '+X'); set('outDir', '+Z'); }}>Horizontal → vertical</button>
          <button className="chip" onClick={() => { set('inDir', '+X'); set('outDir', '+Y'); }}>Horizontal → horizontal</button>
        </div>
        <Grid>
          <Field label="X (along incoming run)" value={inp.X} onChange={(v) => set('X', v)} parse={parseLength} />
          <Field label="Y (horizontal)" value={inp.Y} onChange={(v) => set('Y', v)} parse={parseLength} />
          <Field label="Z (vertical, + up)" value={inp.Z} onChange={(v) => set('Z', v)} parse={parseLength} />
          <Select label="Incoming direction" value={inp.inDir} options={AXIS_OPTS} onChange={(v) => set('inDir', v)} />
          <Select label="Outgoing direction" value={inp.outDir} options={AXIS_OPTS} onChange={(v) => set('outDir', v)} />
        </Grid>
        {(inp.X || inp.Y || inp.Z) && !r.ok && <Msg>{r.err}</Msg>}
        <button className="btn ghost" onClick={reset}>Clear inputs</button>
      </Card>
      {res && <Results rows={[
        { label: 'Pipe length L (center to center)', value: f.len(res.L), sub: f.dec(res.L), strong: true },
        { label: 'Entry fitting angle', value: f.ang(res.entry) },
        { label: 'Exit fitting angle', value: f.ang(res.exit) },
      ]} />}
      {res && (res.entry > 90 || res.exit > 90) && <Msg kind="warn">A fitting angle over 90° needs more than one fitting or a different arrangement.</Msg>}
      <Formula><ul><li>L = √(X² + Y² + Z²)</li><li>Fitting angle = angle between the pipe vector and the incoming (or outgoing) direction: acos(component ÷ L).</li><li>Guide example: X 29, Y 23, Z 15 → L 39-15/16", entry 43.44°, exit to vertical 67.94°, exit to horizontal (Y) 54.84°.</li></ul></Formula>
      <ToolActions tool="combo" title="Combination offset" inputs={inp} summary={res ? `Combination offset X ${f.len(res.X)} Y ${f.len(res.Y)} Z ${f.len(res.Z)}\nL ${f.len(res.L)}; entry ${f.ang(res.entry)}; exit ${f.ang(res.exit)}` : ''} disabled={!res} />
    </>
  );
}
