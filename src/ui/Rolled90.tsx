// Layout → Rolled 90: a full 90 rolled down θ, welded direct to an elbow cut down to θ that brings the outlet back level.
import React from 'react';
import { Field, Results, Msg, Formula, ToolActions, Segmented, Select, useTool, useFmt, Card, Grid } from './components';
import { parseLength, tryParse } from '../engine/parse';
import { CalcError } from '../engine/units';
import { steelOD, B169, B169_SOURCE, NPS_SORTED } from '../engine/fittings';
import { formatNumber } from '../engine/format';
import { rolled90, rolled90Angle, rolled90Shortcut, cutDownMarks, dms, Rolled90 } from '../engine/rolled90';

const val = (s: string): number | undefined => {
  const r = tryParse(parseLength, s);
  if (r === null) return undefined;
  if (!r.ok) throw new CalcError('INPUT', r.err);
  return r.v;
};
function attempt<T>(f: () => T): { ok: true; v: T } | { ok: false; err: string } {
  try { return { ok: true, v: f() }; } catch (e) { return { ok: false, err: (e as Error).message }; }
}
const RADIUS_LABEL: Record<string, string> = { LR: 'Long radius', SR: 'Short radius', C: 'Custom' };

/** B16.9 90° elbow radius (center-to-end "A") for a size; null when that radius isn't made in that size. */
const stdRadius = (nps: string, rt: string) => (rt === 'LR' ? B169[nps]?.lr90 : rt === 'SR' ? B169[nps]?.sr90 : undefined) ?? null;

export function Rolled90Tool() {
  const f = useFmt();
  const [inp, set, reset] = useTool('rolled90', { mode: 'angle', drop: '2', ang: '', nps: '4', od: '', rt: 'LR', same: '1', A: '', B: '', g: '0' });
  const manual = inp.nps === 'manual';
  const std = manual ? null : stdRadius(inp.nps, inp.rt);
  // typing a radius makes it Custom (like a measured fitting); a standard radius fills both fittings
  const typeRadius = (k: 'A' | 'B', v: string) => {
    if (inp.rt !== 'C') { set('rt', 'C'); if (k === 'B' || !inp.A) set('A', inp.A || (std != null ? String(std) : '')); }
    set(k, v); if (k === 'A' && inp.same === '1') set('B', v);
  };
  const shownA = inp.rt === 'C' ? inp.A : std != null ? String(std) : '';
  const shownB = inp.rt === 'C' ? (inp.same === '1' ? inp.A : inp.B) : std != null ? String(std) : '';

  const r = attempt(() => {
    const od = manual ? val(inp.od) : steelOD(inp.nps);
    if (!(od && od > 0)) throw new CalcError('INPUT', 'Enter the pipe OD.');
    let A: number, B: number;
    if (inp.rt === 'C') {
      const a = val(inp.A), b = inp.same === '1' ? a : val(inp.B);
      if (!(a && a > 0)) throw new CalcError('INPUT', 'Enter the full 90 radius A.');
      if (!(b && b > 0)) throw new CalcError('INPUT', 'Enter the cut elbow radius B.');
      A = a; B = b;
    } else {
      if (manual) throw new CalcError('INPUT', 'With a typed OD, pick Custom and enter the elbow radii.');
      if (std == null) throw new CalcError('DATA', `ASME B16.9 has no ${RADIUS_LABEL[inp.rt].toLowerCase()} 90° elbow in ${inp.nps}" — pick Custom and enter the radius.`);
      A = B = std;
    }
    const g = val(inp.g) ?? 0;
    if (!(g >= 0)) throw new CalcError('INPUT', 'Root gap must be 0 or more.');
    let sol: ReturnType<typeof rolled90Angle> | null = null, deg: number;
    if (inp.mode === 'angle') {
      const D = val(inp.drop);
      if (!(D && D > 0)) throw new CalcError('INPUT', 'Enter the drop you need.');
      sol = rolled90Angle(A, B, g, D); deg = sol.deg;
    } else {
      deg = Number(inp.ang.replace(',', '.'));
      if (!(deg >= 1 && deg <= 90)) throw new CalcError('INPUT', 'Enter an angle between 1° and 90°.');
    }
    const G = rolled90(A, B, g, deg), M = cutDownMarks(B, od, deg);
    return { A, B, g, od, G, M, sol, drop: sol ? val(inp.drop)! : G.D };
  });
  const v = r.ok ? r.v : null;
  const L2 = (x: number) => ({ value: f.len(x), sub: f.dec(x) });

  return (
    <div className="tool">
      <p className="lead tooldesc"><b>Rolled 90:</b> drop a line with a full 90 rolled down and an elbow cut down to the same angle, welded straight to it, so the outlet comes back level. Enter the drop to get the roll angle (or the angle to get the drop), plus travel, take-offs and where to mark the cut on the elbow.</p>
      <Card>
        <Segmented value={inp.mode} onChange={(m) => set('mode', m)} options={[['angle', 'Find angle'], ['drop', 'Find drop']]} />
        <Grid>
          {inp.mode === 'angle'
            ? <Field label="Drop you need" value={inp.drop} onChange={(s) => set('drop', s)} parse={parseLength} hint="center to center, inlet level to outlet level" />
            : <Field label="Roll / cut angle θ (1°–90°)" value={inp.ang} onChange={(s) => set('ang', s)} inputMode="decimal" />}
        </Grid>
      </Card>
      <Card>
        <h3 className="cardh">Pipe &amp; fittings</h3>
        <Grid>
          <Select label="Pipe size" value={inp.nps} options={[...NPS_SORTED.map((n) => [n, `${n}" NPS (OD ${steelOD(n)})`] as [string, string]), ['manual', 'Enter OD…']]} onChange={(s) => set('nps', s)} />
          {manual && <Field label="Pipe OD" value={inp.od} onChange={(s) => set('od', s)} parse={parseLength} />}
        </Grid>
        <Segmented small value={inp.rt} onChange={(s) => { if (s === 'C' && inp.rt !== 'C' && std != null) { if (!inp.A) set('A', String(std)); if (!inp.B) set('B', String(std)); } set('rt', s); }} options={[['LR', 'Long radius'], ['SR', 'Short radius'], ['C', 'Custom']]} />
        <label className="toggle sm"><input type="checkbox" checked={inp.same === '1'} onChange={(e) => { set('same', e.target.checked ? '1' : ''); if (e.target.checked && inp.rt === 'C') set('B', inp.A); }} /> Same radius for both fittings</label>
        <Grid>
          <Field label="Full 90 radius A" value={shownA} onChange={(s) => typeRadius('A', s)} parse={parseLength} />
          <Field label="Cut elbow radius B" value={shownB} onChange={(s) => typeRadius('B', s)} parse={parseLength} disabled={inp.same === '1'} />
          <Field label="Weld root gap g" value={inp.g} onChange={(s) => set('g', s)} parse={parseLength} hint="axial, between the two fittings" />
        </Grid>
        <p className="fhint">Long and short radius come from ASME B16.9 (90° elbow center-to-end). Type a measured radius to override — it switches to Custom.</p>
        <div className="actions"><button className="btn" onClick={reset}>Reset</button></div>
      </Card>

      {!r.ok && <Msg>{r.err}</Msg>}
      {v && <>
        <Results title="Set-up angles" rows={[
          { label: 'Roll the full 90 down', value: `${v.G.deg.toFixed(4)}°`, sub: dms(v.G.deg), strong: true },
          { label: 'Keep on the cut-down elbow', value: `${v.G.deg.toFixed(4)}°`, sub: `${dms(v.G.deg)} · discard ${(90 - v.G.deg).toFixed(4)}°`, strong: true },
        ]} />
        <p className="fhint">Roll the full 90’s outlet {v.G.deg.toFixed(2)}° below level, then weld the {v.G.deg.toFixed(2)}° cut-down elbow directly to it to bring the outlet back level.</p>
        <Results title="Centerline results" rows={[
          { label: 'Drop D', ...L2(v.G.D), strong: true },
          { label: 'Cut elbow take-off t', ...L2(v.G.t) },
          { label: 'Travel L', ...L2(v.G.L) },
          { label: 'Horizontal projection', ...L2(v.G.H) },
          { label: 'Full 90 take-off A (+ gap g)', value: f.len(v.A) + (v.g > 0 ? ` + ${f.len(v.g)}` : ''), sub: f.dec(v.A) },
        ]} />
        <p className="fhint">Take-offs and travel are straight-line centerline dimensions between the theoretical intersection points — not cut marks.</p>

        <MarkDiagram B={v.B} deg={v.G.deg} ri={v.M.ri} ro={v.M.ro} />
        <Results title="Cut-down elbow marking (arc lengths)" rows={[
          { label: 'Throat (inside) arc', ...L2(v.M.throat), strong: true },
          { label: 'Heel (outside) arc', ...L2(v.M.heel), strong: true },
          { label: 'Centerline / side arc', ...L2(v.M.center), strong: true },
          { label: 'Inside radius', ...L2(v.M.ri) },
          { label: 'Outside radius', ...L2(v.M.ro) },
        ]} />
        <p className="fhint">Measure along the outside of the elbow from the factory end with a flexible tape: heel on the outside of the bend, sides on the centerline (both sides), throat on the inside. Join the marks with a wrap-around and cut square to the elbow. Keep the {v.G.deg.toFixed(2)}° piece; the scrap piece is {(90 - v.G.deg).toFixed(2)}°.</p>
        {v.M.ri <= 0 && <Msg kind="warn">Cut elbow radius B is not larger than OD/2, so there is no real throat — check B and OD.</Msg>}

        <LayoutDiagram A={v.A} B={v.B} g={v.g} od={v.od} G={v.G} fmt={f.len} />

        <ToolActions tool="rolled90" title="Rolled 90" inputs={inp}
          summary={`Rolled 90 + cut-down elbow: roll ${v.G.deg.toFixed(2)}° (${dms(v.G.deg)}), keep ${v.G.deg.toFixed(2)}° of the cut elbow. Drop ${f.len(v.G.D)}, travel ${f.len(v.G.L)}, cut elbow take-off ${f.len(v.G.t)}, horizontal ${f.len(v.G.H)}. Marks: throat ${f.len(v.M.throat)}, centerline ${f.len(v.M.center)}, heel ${f.len(v.M.heel)}. A ${f.len(v.A)}, B ${f.len(v.B)}, gap ${f.len(v.g)}, OD ${f.len(v.od)}.`} />

        <Formula title="Step-by-step">
          <ol className="steps">
            <li>Inputs: A = {f.dec(v.A)}, B = {f.dec(v.B)}, g = {f.dec(v.g)}, OD = {f.dec(v.od)}.</li>
            {v.sol ? <>
              <li>Drops this pair can make over 1°–90°: {f.dec(v.sol.dmin)} to {f.dec(v.sol.dmax)} (max = A + B + g). The target {f.dec(v.drop)} is in range.</li>
              <li>Solve <b>D = [A + B·tan(θ/2) + g]·sin θ</b> for θ by bisection on [1°, 90°] → θ = <b>{v.G.deg.toFixed(6)}°</b> ({v.sol.iterations} steps).</li>
            </> : <li>Angle entered: θ = <b>{v.G.deg.toFixed(6)}°</b>.</li>}
            <li>Cut elbow take-off: t = B × tan(θ/2) = {formatNumber(v.B, 6)} × tan({(v.G.deg / 2).toFixed(6)}°) = {formatNumber(v.G.t, 6)}"</li>
            <li>Travel: L = A + t + g = {formatNumber(v.A, 6)} + {formatNumber(v.G.t, 6)} + {formatNumber(v.g, 6)} = {formatNumber(v.G.L, 6)}"</li>
            <li>Drop: D = L × sin θ = {formatNumber(v.G.L, 6)} × {Math.sin(v.G.rad).toFixed(8)} = {formatNumber(v.G.D, 6)}"</li>
            <li>Horizontal projection: H = L × cos θ = {formatNumber(v.G.L, 6)} × {Math.cos(v.G.rad).toFixed(8)} = {formatNumber(v.G.H, 6)}"</li>
            <li>Cut elbow radii: inside B − OD/2 = {formatNumber(v.M.ri, 6)}", outside B + OD/2 = {formatNumber(v.M.ro, 6)}"</li>
            <li>Arc marks from the factory end (θ = {v.G.rad.toFixed(6)} rad): throat {formatNumber(v.M.throat, 6)}", centerline {formatNumber(v.M.center, 6)}", heel {formatNumber(v.M.heel, 6)}"</li>
            {v.sol && Math.abs(v.A - v.B) < 1e-9 && v.g === 0 && (() => { const sc = rolled90Shortcut(v.A, v.drop); const ok = Math.abs(sc - v.G.deg) < 1e-6; return <li>Check (A = B = R, g = 0): θ = 45° − asin[(R − D)/(R√2)] = {sc.toFixed(6)}° {ok ? '✓ matches' : '✗ differs'}</li>; })()}
            <li>{B169_SOURCE}</li>
          </ol>
        </Formula>
        <LookupTable A={v.A} B={v.B} g={v.g} deg={v.G.deg} fmt={f.len} />
      </>}
    </div>
  );
}

/** Where to mark the cut on the elbow: kept piece (teal), scrap (dashed), cut line (red). */
function MarkDiagram({ B, deg, ri, ro }: { B: number; deg: number; ri: number; ro: number }) {
  if (!(ri > 0)) return null;
  const D2R = Math.PI / 180, W0 = 360, sc = 205 / ro, cx = 118, cy = 34 + ro * sc, H0 = Math.ceil(cy + (deg > 60 ? 40 : 14));
  const pt = (r: number, phi: number): [number, number] => [cx + r * sc * Math.sin(phi * D2R), cy - r * sc * Math.cos(phi * D2R)];
  const P = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const arc = (r: number, b: number, sweep: number) => `A${(r * sc).toFixed(1)},${(r * sc).toFixed(1)} 0 0 ${sweep} ${P(pt(r, b))}`;
  const band = (a: number, b: number) => `M${P(pt(ro, a))} ${arc(ro, b, 1)} L${P(pt(ri, b))} ${arc(ri, a, 0)} Z`;
  const e = 0.12 * (ro - ri), c1 = pt(Math.max(0, ri - e), deg), c2 = pt(ro + e, deg), scrap = 90 - deg;
  const fe = pt((ri + ro) / 2, 0), tm = pt(ri, deg / 2), sm = pt(B, deg + scrap / 2);
  const heel = deg < 22 ? { p: pt(ro, 0), dx: -8, dy: -4, a: 'end' as const } : { p: pt(ro, deg / 2), dx: 4, dy: -9, a: 'middle' as const };
  return (
    <figure className="diagram">
      <svg viewBox={`0 0 ${W0} ${H0}`} role="img" aria-label="Marking the cut on the elbow">
        <path d={band(deg, 90)} className="r90-scrap" />
        <path d={band(0, deg)} className="r90-keep" />
        <path d={`M${P(pt(ro, 0))} ${arc(ro, deg, 1)}`} className="r90-keepedge" />
        <path d={`M${P(pt(ri, 0))} ${arc(ri, deg, 1)}`} className="r90-keepedge" />
        <path d={`M${P(pt(B, 0))} ${arc(B, 90, 1)}`} className="dg-center" />
        <line x1={pt(ri, 0)[0]} y1={pt(ri, 0)[1]} x2={pt(ro, 0)[0]} y2={pt(ro, 0)[1]} className="r90-face" />
        <line x1={c1[0]} y1={c1[1]} x2={c2[0]} y2={c2[1]} className="r90-cut" />
        <text className="dg-lbl sm" x={fe[0] - 10} y={fe[1] + 4} textAnchor="end">factory end</text>
        <text className="dg-lbl sm acc" x={heel.p[0] + heel.dx} y={heel.p[1] + heel.dy} textAnchor={heel.a}>Heel</text>
        <text className="dg-lbl sm acc" x={tm[0] - 4} y={tm[1] + 19} textAnchor="end">Throat</text>
        {deg <= 60
          ? <text className="dg-lbl sm r90-cuttxt" x={c2[0] + 6} y={c2[1] - 4}>cut at {deg.toFixed(2)}°</text>
          : <text className="dg-lbl sm r90-cuttxt" x={Math.min(c2[0] + 4, W0 - 4)} y={c2[1] + 28} textAnchor="end">cut at {deg.toFixed(2)}°</text>}
        {scrap >= 12 && <text className="dg-lbl sm" x={sm[0]} y={sm[1]} textAnchor="middle">scrap {scrap.toFixed(2)}°</text>}
      </svg>
      <figcaption>Teal: the piece you keep. Dashed: scrap. Red: the cut, square to the elbow.</figcaption>
    </figure>
  );
}

/** The layout looking along the inlet: ① rolled full 90, ② direct weld, ③ cut-down elbow, ④ level outlet. */
function LayoutDiagram({ A, B, g, od, G, fmt }: { A: number; B: number; g: number; od: number; G: Rolled90; fmt: (v: number) => string }) {
  const c = Math.cos(G.rad), s = Math.sin(G.rad), t = G.t, L = G.L;
  const PI2: [number, number] = [L * c, L * s], Wp: [number, number] = [A * c, A * s], Sx: [number, number] = [(A + g) * c, (A + g) * s];
  const C: [number, number] = [Sx[0] + B * s, Sx[1] - B * c], E: [number, number] = [C[0], C[1] + B];
  const ext = Math.max(0.35 * L, 1.2 * t, od), endX = E[0] + ext;
  const W0 = 360, ml = 34, mr = 62, mt = 46, mb = 56;
  const minX = -od / 2, maxX = endX, minY = -od / 2, maxY = PI2[1] + od / 2;
  const sc = Math.min((W0 - ml - mr) / (maxX - minX), 230 / Math.max(maxY - minY, 1e-9));
  const usedH = (maxY - minY) * sc, H0 = Math.max(170, usedH + mt + mb), oy = mt + ((H0 - mt - mb) - usedH) / 2;
  const X = (x: number) => ml + (x - minX) * sc, Y = (y: number) => oy + (y - minY) * sc;
  const P = (p: [number, number]) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`;
  const pw = Math.max(5, Math.min(26, od * sc)), R = B * sc;
  const y0 = Y(0), y2 = Y(PI2[1]), xR = X(endX) + 18;
  const nx = -s, ny = c, tk = pw / 2 + 5;
  const am = G.rad / 2, AM: [number, number] = [C[0] - B * Math.sin(G.rad - am), C[1] + B * Math.cos(G.rad - am)];
  const tmid: [number, number] = [PI2[0] * 0.42, PI2[1] * 0.42], off = pw / 2 + 8;
  const ra = Math.min(34, Math.max(18, X(PI2[0]) - X(0) > 60 ? 30 : 20));
  const yb = Math.max(y2, Y(E[1])) + pw / 2 + 22, span = X(PI2[0]) - X(0);
  const cal = (x: number, y: number, n: number, cls: string) => <g key={n}><circle cx={x} cy={y} r={9} className={'r90-cal ' + cls} /><text x={x} y={y + 4} className="r90-caltxt" textAnchor="middle">{n}</text></g>;
  const elbowArc = `M${P(Sx)} A${R.toFixed(1)},${R.toFixed(1)} 0 0 0 ${P(E)}`;
  return (
    <figure className="diagram">
      <svg viewBox={`0 0 ${W0} ${H0}`} role="img" aria-label="Rolled 90 and cut-down elbow layout">
        <defs><marker id="r90ah" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" className="dg-arrowhead" /></marker></defs>
        <line x1={X(0)} y1={y0} x2={xR} y2={y0} className="r90-level" />
        <line x1={X(endX)} y1={y2} x2={xR} y2={y2} className="r90-level" />
        {/* pipe bodies */}
        <line x1={X(0)} y1={Y(0)} x2={X(Wp[0])} y2={Y(Wp[1])} className="r90-body a90" strokeWidth={pw} />
        <path d={elbowArc} className="r90-body corr" strokeWidth={pw} fill="none" />
        <line x1={X(E[0])} y1={Y(E[1])} x2={X(endX)} y2={Y(E[1])} className="r90-body outlet" strokeWidth={pw} />
        <circle cx={X(0)} cy={Y(0)} r={pw / 2} className="r90-inlet" />
        {/* centerlines */}
        <line x1={X(0)} y1={Y(0)} x2={X(Wp[0])} y2={Y(Wp[1])} className="r90-cl a90" />
        <path d={elbowArc} className="r90-cl corr" fill="none" />
        <line x1={X(E[0])} y1={Y(E[1])} x2={X(endX)} y2={Y(E[1])} className="r90-cl outlet" />
        {/* theoretical travel & tangent */}
        <line x1={X(0)} y1={Y(0)} x2={X(PI2[0])} y2={Y(PI2[1])} className="r90-travel" />
        <line x1={X(PI2[0])} y1={Y(PI2[1])} x2={X(E[0])} y2={Y(E[1])} className="r90-travel" />
        <circle cx={X(0)} cy={Y(0)} r={3} className="r90-pi" /><circle cx={X(PI2[0])} cy={Y(PI2[1])} r={3} className="r90-pi" />
        {/* weld */}
        <line x1={X(Wp[0]) + nx * tk} y1={Y(Wp[1]) + ny * tk} x2={X(Wp[0]) - nx * tk} y2={Y(Wp[1]) - ny * tk} className="r90-weld" />
        <text className="dg-lbl sm" x={X(0) - 4} y={Y(0) - pw / 2 - 8}>INLET (end view) · PI₁</text>
        <text className="dg-lbl sm" x={X(PI2[0]) - 4} y={Y(PI2[1]) + pw / 2 + 14} textAnchor="end">PI₂</text>
        {cal(X(Wp[0] * 0.5), Y(Wp[1] * 0.5), 1, 'a90')}
        {cal(X(Wp[0]) - nx * (tk + 10), Y(Wp[1]) - ny * (tk + 10), 2, 'weld')}
        {cal(X(AM[0]), Y(AM[1]), 3, 'corr')}
        {cal((X(E[0]) + X(endX)) / 2, Y(E[1]), 4, 'outlet')}
        <text className="dg-lbl sm" x={X(tmid[0]) + nx * off} y={Y(tmid[1]) + ny * off} textAnchor="middle" transform={`rotate(${G.deg} ${(X(tmid[0]) + nx * off).toFixed(1)} ${(Y(tmid[1]) + ny * off).toFixed(1)})`}>TRAVEL L = {fmt(L)}</text>
        <path d={`M${X(0) + ra},${Y(0)} A${ra},${ra} 0 0 1 ${(X(0) + ra * c).toFixed(1)},${(Y(0) + ra * s).toFixed(1)}`} className="r90-thetaarc" fill="none" />
        <text className="dg-lbl sm" x={X(0) + ra * Math.cos(G.rad / 2) + 9} y={Y(0) + ra * Math.sin(G.rad / 2) + 4}>θ</text>
        <line x1={xR - 6} y1={y0} x2={xR - 6} y2={y2} className="dg-dim" markerStart="url(#r90ah)" markerEnd="url(#r90ah)" />
        <text className="dg-lbl sm" x={xR - 2} y={(y0 + y2) / 2 - 6}>DROP</text>
        <text className="dg-lbl sm" x={xR - 2} y={(y0 + y2) / 2 + 8}>{fmt(G.D)}</text>
        <line x1={X(0)} y1={y0 + pw / 2 + 3} x2={X(0)} y2={yb + 5} className="dg-ext" />
        <line x1={X(PI2[0])} y1={y2 + 3} x2={X(PI2[0])} y2={yb + 5} className="dg-ext" />
        {span > 6 && <line x1={X(0)} y1={yb} x2={X(PI2[0])} y2={yb} className="dg-dim" markerStart="url(#r90ah)" markerEnd="url(#r90ah)" />}
        {span > 130
          ? <text className="dg-lbl sm" x={(X(0) + X(PI2[0])) / 2} y={yb + 15} textAnchor="middle">HORIZ. PROJ. = {fmt(G.H)}</text>
          : <text className="dg-lbl sm" x={X(0) - 6} y={yb + 15}>HORIZ. PROJ. = {fmt(G.H)}</text>}
      </svg>
      <figcaption>Looking along the inlet (shown end-on). ① rolled full 90 (A) · ② direct weld (gap g) · ③ cut-down elbow (B, θ) · ④ level outlet. Dashed lines are centerlines through the intersection points PI₁ and PI₂.</figcaption>
    </figure>
  );
}

/** Drop, take-off and travel for every whole degree, with the current angle highlighted. */
function LookupTable({ A, B, g, deg, fmt }: { A: number; B: number; g: number; deg: number; fmt: (v: number) => string }) {
  const hl = Math.min(90, Math.max(1, Math.round(deg)));
  return (
    <details className="formula">
      <summary>Lookup table: 1°–90°</summary>
      <div className="fbody">
        <p className="fhint">For the current A, B and g. The highlighted row is nearest the current angle.</p>
        <div className="r90-tbl">
          <table className="dtable">
            <thead><tr><th>θ°</th><th>Drop</th><th>Take-off t</th><th>Travel L</th></tr></thead>
            <tbody>
              {Array.from({ length: 90 }, (_, i) => i + 1).map((a) => { const G = rolled90(A, B, g, a); return <tr key={a} className={a === hl ? 'hl' : ''}><td>{a}</td><td>{fmt(G.D)}</td><td>{fmt(G.t)}</td><td>{fmt(G.L)}</td></tr>; })}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
