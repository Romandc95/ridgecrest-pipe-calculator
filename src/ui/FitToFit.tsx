import React from 'react';
import { Field, Results, Msg, Formula, ToolActions, Segmented, Select, useTool, useFmt, Card, Grid } from './components';
import { FitToFitDiagram, F2FDrawing } from './diagrams';
import { parseLength, parseAngle, tryParse } from '../engine/parse';
import { solveFittingToFitting, F2FSolution } from '../engine/fit2fit';
import { AXES, Axis, Vec } from '../engine/layout';
import { CalcError } from '../engine/units';

const val = <T,>(fn: (s: string) => T, s: string): T | undefined => {
  const r = tryParse(fn, s);
  if (r === null) return undefined;
  if (!r.ok) throw new CalcError('INPUT', r.err);
  return r.v;
};
const AX: Array<[string, string]> = [['+X', '+X (east)'], ['-X', '−X (west)'], ['+Y', '+Y (north)'], ['-Y', '−Y (south)'], ['+Z', '+Z (up)'], ['-Z', '−Z (down)']];
const TGT: Array<[string, string]> = [['-Z', 'Drop (−Z, down)'], ['+Z', 'Rise (+Z, up)'], ['+Y', 'Offset toward +Y'], ['-Y', 'Offset toward −Y'], ['+X', 'Offset toward +X'], ['-X', 'Offset toward −X']];

const v3 = (v: Vec): string => v.map((x) => (Math.abs(x) < 5e-10 ? 0 : x).toFixed(4)).join(', ');

export function FitToFit() {
  const [inp, set, reset] = useTool('f2f', {
    inDir: '+X', outDir: '+Y', axis: '-Z', target: '2"', e1A: '90', e1CF: '6"', mode: 'trim', R2: '6"', e2A: '45', e2CF: '', gap: '0', od: '', pick: '0',
  });
  const f = useFmt();
  let err: string | null = null;
  let result: ReturnType<typeof solveFittingToFitting> | null = null;
  try {
    const target = val(parseLength, inp.target), e1CF = val(parseLength, inp.e1CF), e1A = val(parseAngle, inp.e1A), gap = val(parseLength, inp.gap) ?? 0;
    const missing: string[] = [];
    if (target === undefined) missing.push('required offset/drop');
    if (e1CF === undefined) missing.push('elbow 1 center-to-face');
    if (inp.mode === 'trim' && !inp.R2.trim()) missing.push('elbow 2 radius');
    if (inp.mode === 'fixed' && (!inp.e2CF.trim() || !inp.e2A.trim())) missing.push('elbow 2 angle and center-to-face');
    if (missing.length) throw new CalcError('INPUT', `Missing: ${missing.join(', ')}.`);
    result = solveFittingToFitting({
      inDir: inp.inDir as Axis, outDir: inp.outDir as Axis, targetAxis: inp.axis as Axis, target: target!,
      e1Angle: e1A ?? 90, e1CF: e1CF!, gap,
      second: inp.mode === 'trim' ? { mode: 'trim', R: val(parseLength, inp.R2)! } : { mode: 'fixed', angle: val(parseAngle, inp.e2A)!, cf: val(parseLength, inp.e2CF)! },
      od: val(parseLength, inp.od),
    });
  } catch (e) { err = (e as Error).message; }

  const sols = result?.solutions ?? [];
  const pick = Math.min(+inp.pick || 0, Math.max(0, sols.length - 1));
  const s: F2FSolution | null = sols[pick] ?? null;
  const drawing: F2FDrawing = s
    ? { ...s.points, d0: s.dirs.d0, d2: s.dirs.d2, N: AXES[inp.axis as Axis], sep: f.len(s.separation), illustrative: false, T: s.T1 }
    : illustrative(inp);

  const sum = s ? [
    'Fitting-to-fitting',
    `Inlet ${inp.inDir}, outlet ${inp.outDir}, ${TGT.find((t) => t[0] === inp.axis)![1]} ${f.len(s.separation)}`,
    `Elbow 1: ${f.ang(+inp.e1A || 90)} C-F ${f.len(s.T1)}, roll ${f.ang(s.roll)}`,
    `Elbow 2: retained ${f.ang(s.beta)}${s.removed !== null ? ` (remove ${f.ang(s.removed)})` : ''}, C-F ${f.len(s.T2)}`,
    `Gap ${f.len(+0 + (val(parseLength, inp.gap) ?? 0))}; travel C1→C2 ${f.len(s.travel)}; run ${f.len(s.runInlet)}`,
  ].join('\n') : '';

  return (
    <>
      <FitToFitDiagram d={drawing} />
      <Card>
        <p className="lead">Two fittings welded directly together (no spool): a fixed-angle elbow rolled about its inlet, then a second elbow trimmed to the required angle. Travel and run are results.</p>
        <h4>Directions</h4>
        <Grid>
          <Select label="Inlet flow direction" value={inp.inDir} options={AX} onChange={(v) => set('inDir', v)} />
          <Select label="Required outlet direction" value={inp.outDir} options={AX} onChange={(v) => set('outDir', v)} />
          <Select label="Displacement" value={inp.axis} options={TGT} onChange={(v) => set('axis', v)} />
          <Field label="Required offset / drop" value={inp.target} onChange={(v) => set('target', v)} parse={parseLength} hint="between inlet and outlet centerlines" />
        </Grid>
        <h4>Elbow 1 (rolled)</h4>
        <Grid>
          <Field label="Bend angle" unitHint="°" value={inp.e1A} onChange={(v) => set('e1A', v)} parse={parseAngle} />
          <Field label="Measured center-to-face" value={inp.e1CF} onChange={(v) => set('e1CF', v)} parse={parseLength} />
        </Grid>
        <h4>Elbow 2</h4>
        <Segmented small value={inp.mode} onChange={(v) => set('mode', v)} options={[['trim', 'Trimmed from a 90°'], ['fixed', 'Fixed angle (as made)']]} />
        <Grid>
          {inp.mode === 'trim'
            ? <Field label="Radius (its 90° center-to-face)" value={inp.R2} onChange={(v) => set('R2', v)} parse={parseLength} />
            : <>
              <Field label="Fitting angle" unitHint="°" value={inp.e2A} onChange={(v) => set('e2A', v)} parse={parseAngle} />
              <Field label="Measured center-to-face" value={inp.e2CF} onChange={(v) => set('e2CF', v)} parse={parseLength} />
            </>}
          <Field label="Joint gap (between faces)" value={inp.gap} onChange={(v) => set('gap', v)} parse={parseLength} hint="0 is valid" />
          {inp.mode === 'trim' && <Field label="Actual OD (optional, for arcs)" value={inp.od} onChange={(v) => set('od', v)} parse={parseLength} />}
        </Grid>
        {err && <Msg>{err}</Msg>}
        {result?.warning && <Msg kind="warn">{result.warning}</Msg>}
        {sols.length > 1 && <Segmented small value={String(pick)} onChange={(v) => set('pick', v)} options={sols.map((x, i) => [String(i), `Solution ${i + 1}: roll ${f.ang(x.roll)}`])} />}
        <button className="btn ghost" onClick={reset}>Reset to example</button>
      </Card>
      {s && <Results rows={[
        { label: 'Elbow 1 roll ρ', value: f.ang(s.roll), sub: 'about the inlet axis, from the outlet-direction side toward the displacement', strong: true },
        { label: 'Elbow 2 retained angle β', value: f.ang(s.beta), strong: true },
        ...(s.removed !== null ? [{ label: 'Elbow 2 angle removed', value: f.ang(s.removed), sub: 'trimmed off a 90°' }] : []),
        { label: 'Elbow 2 center-to-face at β', value: f.len(s.T2), sub: f.dec(s.T2) },
        { label: 'Travel C1 → C2', value: f.len(s.travel), sub: `= ${f.len(s.T1)} + gap + ${f.len(s.T2)}` },
        { label: 'Run along inlet (inlet face → outlet centerline)', value: f.len(s.runInlet), sub: f.dec(s.runInlet) },
        { label: 'Advance along outlet (C1 → outlet face)', value: f.len(s.advanceOutlet), sub: f.dec(s.advanceOutlet) },
        { label: 'Achieved displacement', value: f.len(s.separation), sub: f.dec(s.separation) },
        { label: 'Lateral (third axis) result', value: f.len(s.lateral), sub: 'C2 position across the inlet line' },
        { label: 'Elbow 2 clocking vs elbow 1 plane', value: f.ang(s.clocking), sub: 'rotation about the joint axis' },
        ...(s.trimArcs ? [{ label: 'Elbow 2 trim arcs (inside / center / outside)', value: `${f.len(s.trimArcs.inside)} / ${f.len(s.trimArcs.center)} / ${f.len(s.trimArcs.outside)}` }] : []),
      ]} />}
      {s && (
        <section className="results">
          <h3>Endpoints & tangents (inches, origin = elbow 1 inlet face)</h3>
          <table className="pts"><tbody>
            {([['P0', 'elbow 1 inlet face'], ['C1', 'elbow 1 center'], ['P1', 'elbow 1 outlet face'], ['P1g', 'elbow 2 inlet face (after gap)'], ['C2', 'elbow 2 center'], ['P2', 'elbow 2 outlet face']] as const).map(([k, l]) => (
              <tr key={k}><th>{k}</th><td>{v3(s.points[k])}</td><td className="muted">{l}</td></tr>
            ))}
            <tr><th>d₀</th><td>{v3(s.dirs.d0)}</td><td className="muted">inlet tangent</td></tr>
            <tr><th>d₁</th><td>{v3(s.dirs.d1)}</td><td className="muted">joint tangent</td></tr>
            <tr><th>d₂</th><td>{v3(s.dirs.d2)}</td><td className="muted">outlet tangent</td></tr>
          </tbody></table>
        </section>
      )}
      <Formula>
        <ul>
          <li>Each elbow is modelled by its tangent-intersection center: face → center = T, center → face = T. Elbow 1: T₁ = measured center-to-face. Elbow 2 (trimmed): T₂ = R·tan(β/2).</li>
          <li>Joint direction d₁ = cos α·d₀ + sin α·(cos ρ·e + sin ρ·n), where e points toward the outlet direction (perpendicular to the inlet) and n is the displacement direction.</li>
          <li>β = angle between d₁ and the outlet direction d₂. Separation between inlet and outlet centerlines along n = (T₁ + gap + T₂(β))·(d₁·n).</li>
          <li>ρ is found numerically (scan + bisection to 1e-12) so the separation equals the requirement; every root with 0° &lt; β ≤ 90° is reported.</li>
          <li>The answer depends on both fittings and the gap — it is not taken from elbow 1’s center-to-face alone.</li>
          <li>If the outlet is parallel to the inlet, both rolls to either side satisfy the drop; the missing constraint (lateral side) is reported instead of guessing.</li>
        </ul>
      </Formula>
      <ToolActions tool="f2f" title="Fitting-to-fitting" inputs={inp} summary={sum} disabled={!s} />
    </>
  );
}

function illustrative(inp: Record<string, string>): F2FDrawing {
  const d0 = AXES[inp.inDir as Axis], d2 = AXES[inp.outDir as Axis], N = AXES[inp.axis as Axis];
  const T = 6, T2 = 2;
  let e: Vec = [d2[0] - d0[0] * dot(d2, d0), d2[1] - d0[1] * dot(d2, d0), d2[2] - d0[2] * dot(d2, d0)];
  if (Math.hypot(...e) < 1e-9) e = [d0[1] * N[2] - d0[2] * N[1], d0[2] * N[0] - d0[0] * N[2], d0[0] * N[1] - d0[1] * N[0]];
  const n = Math.hypot(...e) || 1; e = [e[0] / n, e[1] / n, e[2] / n];
  const r = Math.PI / 6;
  const d1: Vec = [e[0] * Math.cos(r) + N[0] * Math.sin(r), e[1] * Math.cos(r) + N[1] * Math.sin(r), e[2] * Math.cos(r) + N[2] * Math.sin(r)];
  const add = (a: Vec, b: Vec, k: number): Vec => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const P0: Vec = [0, 0, 0], C1 = add(P0, d0, T), P1 = add(C1, d1, T), P1g = add(P1, d1, 0.2), C2 = add(P1g, d1, T2), P2 = add(C2, d2, T2);
  return { P0, C1, P1, P1g, C2, P2, d0, d2, N, sep: 'drop', illustrative: true, T };
}
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
