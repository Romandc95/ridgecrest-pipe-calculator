// Layout → Fit-Fit: an offset made with two equal elbows cut to the same angle — fitting to fitting, or with a pipe
// piece between them; plain or rolling. Gives the cut angle, pipe piece, travel, C-C run, take off, cut marks and a
// to-scale drawing. Lengths follow the app's display settings.
import React from 'react';
import { Field, Results, Msg, Formula, ToolActions, Segmented, Select, useTool, useFmt, Card, Grid } from './components';
import { parseLength, tryParse } from '../engine/parse';
import { steelOD, B169, NPS_SORTED } from '../engine/fittings';
import { fitFit, fitFitOptions, offsetOf, solveTheta, clockStr, FitFitSol, FitFitMode } from '../engine/fitfit';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const sinD = (a: number) => Math.sin(a * D2R), cosD = (a: number) => Math.cos(a * D2R), tanD = (a: number) => Math.tan(a * D2R);
const n3 = (v: number) => `${v.toFixed(3)}"`, fa = (a: number) => `${a.toFixed(2)}°`;
const faShort = (a: number) => `${(+a.toFixed(2)).toString()}°`;
function dmsShort(a: number) { let d = Math.floor(Math.abs(a)), m = Math.round((Math.abs(a) - d) * 60); if (m === 60) { d++; m = 0; } return `${d}° ${String(m).padStart(2, '0')}′`; }

/** null = blank, NaN = unreadable, else inches. */
function len(s: string): number | null {
  if (!s || !s.trim()) return null;
  const r = tryParse(parseLength, s);
  return r && r.ok ? r.v : NaN;
}
function angleIn(s: string): number | null {
  const t = (s || '').trim().replace(/°|deg/gi, '').trim(); if (!t) return null;
  const v = Number(t.replace(',', '.')); return isFinite(v) ? v : NaN;
}
/** ASME B16.9 90° elbow radius (center to end); SR is made NPS 1–24 only. */
const stdRadius = (nps: string, elb: string) => (elb === 'LR' ? B169[nps]?.lr90 : B169[nps]?.sr90) ?? null;

type Lvl = 'err' | 'need' | 'warn' | 'info';
interface Note { lvl: Lvl; msg: string }
const LVL_LABEL: Record<Lvl, string> = { err: 'Problem', need: 'Need', warn: 'Check', info: 'Note' };

export function FitFitTool() {
  const f = useFmt(), L = (v: number) => f.len(v);
  const [inp, set, reset] = useTool('fitfit', { nps: '4', elb: 'LR', rad: '', od: '', roll: '', off: '', side: '', sideDir: 'R', rise: '', riseDir: 'U', lay: 'f2f', pmode: 'len', plen: '', ang: '', gap: '' });
  const custom = inp.nps === 'custom';
  const W: Note[] = [];
  const steps: Array<{ t: string; f: string; v: string; p?: string }> = [];

  // ---- pipe & radius
  const odOv = len(inp.od), rOv = len(inp.rad);
  let od: number | null = null, odSrc = '', R: number | null = null, rSrc = '', rHow = '';
  if (odOv != null && odOv > 0) { od = odOv; odSrc = 'Entered'; } else if (odOv != null) W.push({ lvl: 'err', msg: 'Couldn’t read the OD override.' });
  if (od == null && !custom) { od = steelOD(inp.nps); odSrc = 'Standard'; }
  if (rOv != null && rOv > 0) { R = rOv; rSrc = 'Entered'; rHow = 'radius you entered'; }
  else {
    if (rOv != null) W.push({ lvl: 'err', msg: 'Couldn’t read the radius override.' });
    const sr = custom ? null : stdRadius(inp.nps, inp.elb);
    if (sr != null) { R = sr; rSrc = 'Standard'; rHow = `ASME B16.9 ${inp.elb} 90° elbow, center to end`; }
  }
  if (R == null) W.push({ lvl: 'need', msg: custom ? 'Custom size: enter the elbow radius (center to end of the uncut 90°).' : `Short-radius elbows in ASME B16.9 run NPS 1 to 24. For ${inp.nps}", enter the radius (center to end of the 90°) or pick long radius.` });
  if (od == null) W.push({ lvl: 'need', msg: 'Custom size: enter the pipe OD. It’s used for the cut marks on the elbow and the drawing.' });

  // ---- offset
  const roll = inp.roll === '1';
  const need = (v: number | null, name: string, ang?: boolean) => {
    if (v === null) { W.push({ lvl: 'need', msg: `Enter the ${name}.` }); return false; }
    if (!isFinite(v) || v < 0) { W.push({ lvl: 'err', msg: ang ? `Couldn’t read the ${name}. Use degrees, like 45 or 22.5.` : `Couldn’t read the ${name}. Try 24, 24-1/2, 2' 0-1/2 or 610 mm.` }); return false; }
    return true;
  };
  let O: number | null = null, h = 0, v = 0;
  if (roll) {
    const sd = len(inp.side), rs = len(inp.rise);
    const a = need(sd, 'side offset'), b = need(rs, 'rise / drop');
    if (a && b) { h = (inp.sideDir === 'R' ? 1 : -1) * sd!; v = (inp.riseDir === 'U' ? 1 : -1) * rs!; O = Math.hypot(sd!, rs!);
      steps.push({ t: 'True offset', f: 'O = √(side² + rise²)', v: `√(${n3(sd!)}² + ${n3(rs!)}²) = ${n3(O)}`, p: 'The real offset in the tilted plane of the two elbows. Everything below uses it.' }); }
  } else { const o = len(inp.off); if (need(o, 'offset')) O = o; }
  if (O === 0) { W.push({ lvl: 'err', msg: 'The offset is zero, so no offset is needed.' }); O = null; }
  let g = len(inp.gap); if (g === null) g = 0; else if (!isFinite(g) || g < 0) { W.push({ lvl: 'err', msg: 'Couldn’t read the root gap, so 0 is used.' }); g = 0; }

  // ---- solve
  let sol: FitFitSol | null = null;
  if (O != null && R != null) {
    steps.push({ t: 'Elbow radius', f: inp.elb === 'LR' ? 'R = long-radius 90° center to end' : 'R = short-radius 90° center to end', v: `R = ${n3(R)}`, p: rSrc === 'Entered' ? 'Radius you entered.' : 'The center-to-end of the uncut 90° elbow is its radius.' });
    let mode: FitFitMode = 'f2f', pipeLen: number | undefined, angle: number | undefined, ok = true;
    if (inp.lay === 'pipe') {
      if (inp.pmode === 'len') { mode = 'pipeLen'; const pl = len(inp.plen); if (!need(pl, 'pipe piece length')) ok = false; else pipeLen = pl!; }
      else { mode = 'pipeAng'; const a = angleIn(inp.ang); if (!need(a, 'elbow angle', true)) ok = false; else angle = a!; }
    }
    if (ok) {
      const r = fitFit({ R, od, O, g, mode, pipeLen, angle });
      for (const w of r.W) {
        if (w.msg === 'tooMuch') W.push({ lvl: 'err', msg: `Too much offset for two ${inp.elb} elbows welded together. Uncut 90s welded together only reach ${L(w.tooMuch!.reach)}. Switch to “Pipe in between”: two 90s need a ${L(w.tooMuch!.p90)} pipe piece, two 45s need ${L(w.tooMuch!.p45)}. The table below has more options.` });
        else if (w.msg === 'tooShort') W.push({ lvl: 'err', msg: `This pipe piece is too short to reach the offset, even with uncut 90s (they reach ${L(w.tooMuch!.reach)}). With 90s the pipe piece needs to be ${L(w.tooMuch!.p90)}.` });
        else if (w.msg === 'overlap') W.push({ lvl: 'err', msg: `At ${fa(angle!)} the two elbows by themselves make more offset than you need (they would overlap by ${L(w.tooMuch!.reach)}). Use a smaller angle, or “Fitting to fitting”, which needs ${isFinite(w.tooMuch!.p90) ? fa(w.tooMuch!.p90) : '—'}.` });
        else W.push({ lvl: w.lvl, msg: w.msg });
      }
      sol = r.sol;
      if (sol) {
        const t = sol.theta, Ls = sol.L;
        if (mode === 'f2f') {
          if (g === 0) steps.push({ t: 'Elbow angle (cut each elbow to)', f: 'cos θ = 1 − O ÷ (2R)', v: `cos θ = 1 − ${n3(O)} ÷ (2 × ${n3(R)}) = ${(1 - O / (2 * R)).toFixed(5)}  →  θ = ${fa(t)}`, p: 'Each elbow arc makes R(1 − cos θ) of offset. Two of them make the whole offset with nothing in between.' });
          else steps.push({ t: 'Elbow angle (cut each elbow to)', f: 'O = 2R(1 − cos θ) + gap × sin θ  →  θ = atan(2R ÷ gap) + asin((O − 2R) ÷ √(gap² + 4R²))', v: `θ = atan(${n3(2 * R)} ÷ ${n3(Ls)}) + asin((${n3(O)} − ${n3(2 * R)}) ÷ ${n3(Math.hypot(Ls, 2 * R))}) = ${fa(t)}`, p: 'The two elbow arcs make 2R(1 − cos θ) of offset. The root gap between them is a tiny straight piece that adds gap × sin θ.' });
        } else if (mode === 'pipeLen') {
          steps.push({ t: 'Straight between the elbows', f: 'L = pipe + 2 × gap', v: `${n3(pipeLen!)} + 2 × ${n3(g)} = ${n3(Ls)}`, p: 'Pipe piece plus a root gap at each end.' });
          steps.push({ t: 'Elbow angle (cut each elbow to)', f: 'O = 2R(1 − cos θ) + L × sin θ  →  θ = atan(2R ÷ L) + asin((O − 2R) ÷ √(L² + 4R²))', v: `θ = atan(${n3(2 * R)} ÷ ${n3(Ls)}) + asin((${n3(O)} − ${n3(2 * R)}) ÷ ${n3(Math.hypot(Ls, 2 * R))}) = ${fa(t)}`, p: 'The elbow arcs make 2R(1 − cos θ) of offset and the straight piece makes L × sin θ.' });
        } else {
          steps.push({ t: 'Straight between the elbows', f: 'L = (O − 2R(1 − cos θ)) ÷ sin θ', v: `(${n3(O)} − ${n3(offsetOf(R, 0, t))}) ÷ sin ${fa(t)} = ${n3(Ls)}`, p: 'The offset left after the two elbow arcs, laid along the travel.' });
          steps.push({ t: 'Pipe piece cut length', f: 'pipe = L − 2 × gap', v: `${n3(Ls)} − 2 × ${n3(g)} = ${n3(sol.pipe)}` });
        }
        steps.push({ t: 'Center to face of each cut elbow', f: 'C = R × tan(θ ÷ 2)', v: `${n3(R)} × tan(${fa(t)} ÷ 2) = ${n3(sol.C)}`, p: 'From the elbow’s work point (where the centerlines cross) to its cut face.' });
        steps.push({ t: 'Travel (work point to work point)', f: 'Travel = C + L + C', v: `${n3(sol.C)} + ${n3(Ls)} + ${n3(sol.C)} = ${n3(sol.T)}`, p: mode === 'f2f' ? 'Travel is fitting to fitting: just the two elbows and the root gap.' : 'Two elbows plus the straight between them.' });
        steps.push({ t: 'Check the offset', f: 'O = Travel × sin θ', v: `${n3(sol.T)} × sin ${fa(t)} = ${n3(sol.T * sinD(t))}`, p: `Matches the ${n3(O)} offset.` });
        steps.push({ t: 'Center-to-center run', f: 'C-C run = Travel × cos θ', v: `${n3(sol.T)} × cos ${fa(t)} = ${n3(sol.ccRun)}`, p: 'Along the line, from the work point of elbow 1 to the work point of elbow 2.' });
        steps.push({ t: 'Offset take off', f: 'Take off = 2R × sin θ + L × cos θ', v: `2 × ${n3(R)} × sin ${fa(t)} + ${n3(Ls)} × cos ${fa(t)} = ${n3(sol.run)}`, p: 'From the inlet face of elbow 1 to the outlet face of elbow 2, measured along the line. This is how much line the offset takes up. Add your root gaps at those two outer welds when you cut the existing line.' });
        if (sol.marks) { const m = sol.marks, tr = t * D2R; steps.push({ t: 'Cut marks on the 90° elbow', f: 'Mark = radius × θ in radians', v: `Heel ${n3(R + m.ro)} × ${tr.toFixed(4)} = ${n3(m.heel)}  ·  Sides ${n3(R)} × ${tr.toFixed(4)} = ${n3(m.cl)}  ·  Throat ${n3(R - m.ro)} × ${tr.toFixed(4)} = ${n3(m.throat)}`, p: `Heel radius = R + OD/2, throat radius = R − OD/2. ${fa(t)} = ${tr.toFixed(4)} radians.` }); }
        if (mode !== 'f2f' && sol.pipe > 0 && od && sol.pipe < od) W.push({ lvl: 'warn', msg: `Short pipe piece (${L(sol.pipe)}, less than one OD). Make sure it can be fit up and welded.` });
      }
    }
  }
  const order: Record<Lvl, number> = { err: 0, need: 1, warn: 2, info: 3 };
  const notes = W.slice().sort((a, b) => order[a.lvl] - order[b.lvl]);
  const cmp = R != null && O != null ? fitFitOptions(R, O, g) : null;
  const useRow = (x: { a: number; f2f?: boolean }) => { if (x.f2f) set('lay', 'f2f'); else { set('lay', 'pipe'); set('pmode', 'ang'); set('ang', String(+x.a.toFixed(4))); } };
  const sizeLabel = custom ? 'Custom' : `${inp.nps}"`;
  const rollAng = Math.atan2(Math.abs(v), Math.abs(h)) * R2D, clockDeg = (Math.atan2(h, v) * R2D + 360) % 360;

  return (
    <div className="tool">
      <Card>
        <h3 className="cardh">Pipe &amp; elbows</h3>
        <Grid>
          <Select label="Pipe size" value={inp.nps} options={[...NPS_SORTED.map((n) => [n, `${n}"`] as [string, string]), ['custom', 'Custom size']]} onChange={(s) => set('nps', s)} />
        </Grid>
        <Segmented small value={inp.elb} onChange={(s) => set('elb', s)} options={[['LR', 'Long radius'], ['SR', 'Short radius']]} />
        <Grid>
          <Field label={!custom && stdRadius(inp.nps, inp.elb) != null ? 'Radius override' : 'Elbow radius (required)'} value={inp.rad} onChange={(s) => set('rad', s)} parse={parseLength} placeholder={!custom && stdRadius(inp.nps, inp.elb) != null ? String(stdRadius(inp.nps, inp.elb)) : 'required'} />
          <Field label={custom ? 'Pipe OD (required)' : 'OD override'} value={inp.od} onChange={(s) => set('od', s)} parse={parseLength} placeholder={custom ? 'required' : String(steelOD(inp.nps))} />
        </Grid>
        <p className="fhint">{R != null ? <>Elbow radius <b>{L(R)}</b> ({rSrc})</> : <b>Elbow radius needed</b>} · {od != null ? <>Pipe OD <b>{L(od)}</b> ({odSrc})</> : <b>Pipe OD needed</b>}</p>
      </Card>
      <Card>
        <h3 className="cardh">Offset</h3>
        <label className="toggle sm"><input type="checkbox" checked={roll} onChange={(e) => set('roll', e.target.checked ? '1' : '')} /> Rolling offset (side and rise)</label>
        {!roll ? (
          <Grid><Field label="Offset, center to center" value={inp.off} onChange={(s) => set('off', s)} parse={parseLength} hint="same as bottom of pipe to bottom of pipe, or top to top" /></Grid>
        ) : (<>
          <Grid>
            <Field label="Side (horizontal)" value={inp.side} onChange={(s) => set('side', s)} parse={parseLength} />
            <Select label="Side direction" value={inp.sideDir} options={[['R', 'to the Right'], ['L', 'to the Left']]} onChange={(s) => set('sideDir', s)} />
            <Field label="Rise / drop" value={inp.rise} onChange={(s) => set('rise', s)} parse={parseLength} />
            <Select label="Vertical direction" value={inp.riseDir} options={[['U', 'Up'], ['D', 'Down']]} onChange={(s) => set('riseDir', s)} />
          </Grid>
          <p className="fhint">Center to center. Right / left is looking downstream (with the flow).</p>
        </>)}
      </Card>
      <Card>
        <h3 className="cardh">Layout</h3>
        <Segmented value={inp.lay} onChange={(s) => set('lay', s)} options={[['f2f', 'Fitting to fitting'], ['pipe', 'Pipe in between']]} />
        {inp.lay === 'pipe' && <>
          <Segmented small value={inp.pmode} onChange={(s) => set('pmode', s)} options={[['len', 'I know the pipe length'], ['ang', 'I know the angle']]} />
          <Grid>
            {inp.pmode === 'len'
              ? <Field label="Pipe piece, cut length" value={inp.plen} onChange={(s) => set('plen', s)} parse={parseLength} hint="straight pipe between the two elbow faces" />
              : <Field label="Elbow angle (each), degrees" value={inp.ang} onChange={(s) => set('ang', s)} inputMode="decimal" />}
          </Grid>
          {inp.pmode === 'ang' && <div className="chiprow">{[['11.25', '11¼'], ['22.5', '22½'], ['30', '30'], ['45', '45'], ['60', '60'], ['90', '90']].map(([vv, l]) => <button key={vv} className={'chip' + (inp.ang === vv ? ' on' : '')} onClick={() => set('ang', vv)}>{l}°</button>)}</div>}
        </>}
        <Grid><Field label="Root gap per weld" value={inp.gap} onChange={(s) => set('gap', s)} parse={parseLength} placeholder="0" hint={inp.lay === 'f2f' ? 'gap at the weld between the two elbows; blank = 0' : 'gap at each end of the pipe piece; blank = 0'} /></Grid>
        <div className="actions"><button className="btn" onClick={reset}>Reset</button></div>
      </Card>

      {notes.map((n, i) => <Msg key={i} kind={n.lvl === 'info' ? 'info' : n.lvl === 'warn' || n.lvl === 'need' ? 'warn' : undefined}><b>{LVL_LABEL[n.lvl]}: </b>{n.msg}</Msg>)}
      {!sol && !notes.length && <Msg kind="info">Enter the offset and the elbow angle shows up here.</Msg>}

      {sol && R != null && O != null && <>
        <Results title={`Answer · ${sizeLabel} ${inp.elb === 'LR' ? 'long' : 'short'} radius · ${sol.mode === 'f2f' ? 'fitting to fitting' : 'pipe in between'}`} rows={[
          { label: sol.mode === 'pipeAng' ? 'Elbow angle (you picked)' : 'Cut each elbow to', value: `${sol.theta.toFixed(2)}°`, sub: `${dmsShort(sol.theta)} · both elbows the same; elbow 2 turns back so the line comes out parallel`, strong: true },
          sol.mode === 'f2f'
            ? { label: 'Pipe between elbows', value: 'None', sub: `weld elbow 1 straight to elbow 2${g > 0 ? ` with a ${L(g)} root gap` : ''}`, strong: true }
            : { label: 'Pipe piece, cut length', value: L(sol.pipe), sub: `${f.dec(sol.pipe)} · ${sol.mode === 'pipeLen' ? 'your pipe length' : 'between the elbow faces, root gaps taken off'}`, strong: true },
          { label: 'Travel', value: L(sol.T), sub: 'work point to work point' },
          { label: 'C-C run', value: L(sol.ccRun), sub: 'work point to work point, along the line' },
          { label: 'Offset take off', value: L(sol.run), sub: 'elbow 1 inlet face to elbow 2 outlet face' },
          { label: 'Center to face', value: L(sol.C), sub: 'each cut elbow' },
          { label: roll ? 'True offset' : 'Offset', value: L(O), sub: 'center to center' },
          ...(roll ? [{ label: 'Roll angle', value: `${rollAng.toFixed(2)}°`, sub: 'from level' }] : []),
        ]} />
        {sol.marks && <>
          <figure className="diagram"><svg viewBox="0 0 330 225" role="img" aria-label="Where to cut the 90° elbow" dangerouslySetInnerHTML={{ __html: elbowSvg(R, od!, sol.theta) }} /></figure>
          <Results title={`Marking the cut · on a 90° ${inp.elb} elbow, both the same`} rows={[
            { label: 'Heel — outside of the bend', value: L(sol.marks.heel), strong: true },
            { label: 'Sides — on the centerline, both sides', value: L(sol.marks.cl), strong: true },
            { label: 'Throat — inside of the bend', value: sol.marks.throat > 0 ? L(sol.marks.throat) : '—', strong: true },
          ]} />
          <p className="fhint">Measure along the outside of the elbow from the factory end with a flexible tape. Join the marks with a wrap-around and cut square to the elbow. The scrap piece is {fa(90 - sol.theta)}.</p>
        </>}
        <LayoutDrawing R={R} od={od ?? R * 0.6} O={O} sol={sol} fmt={L} />
        {roll && <div className="ff-clockwrap">
          <svg viewBox="0 0 160 160" width="150" height="150" role="img" aria-label="Clock position looking downstream" dangerouslySetInnerHTML={{ __html: clockSvg(h, v) }} />
          <p className="fhint"><b>Rolling offset.</b> The drawing is laid flat in the plane of the offset. Looking downstream, roll elbow 1 so its outlet points at <b>{clockStr(clockDeg)}</b> on the clock, {v >= 0 ? 'up' : 'down'} and to the {h >= 0 ? 'right' : 'left'}. Elbow 2 sits in the same tilted plane, turned to bend back so the line comes out parallel.</p>
        </div>}
        <ToolActions tool="fitfit" title="Fit-Fit offset" inputs={inp} summary={[
          `Fit-Fit offset with cut elbows: ${sizeLabel} ${inp.elb === 'LR' ? 'long' : 'short'} radius, ${sol.mode === 'f2f' ? 'fitting to fitting' : 'pipe in between'}`,
          roll ? `Side ${inp.side} ${inp.sideDir === 'R' ? 'right' : 'left'}, rise ${inp.rise} ${inp.riseDir === 'U' ? 'up' : 'down'} (true offset ${L(O)})` : `Offset ${L(O)} (center to center)`,
          `Elbow radius ${n3(R)} (${rSrc}), OD ${od != null ? n3(od) : '—'}, root gap ${n3(g)}`,
          `CUT EACH ELBOW TO ${sol.theta.toFixed(2)}° (${dmsShort(sol.theta)})`,
          `Pipe between: ${sol.mode === 'f2f' ? 'none (fitting to fitting)' : `${L(sol.pipe)} (${sol.pipe.toFixed(3)}")`}`,
          `Travel ${L(sol.T)}, C-C run ${L(sol.ccRun)}, offset take off ${L(sol.run)}, center to face ${L(sol.C)}`,
          ...(sol.marks ? [`Cut marks from factory end: heel ${L(sol.marks.heel)}, sides ${L(sol.marks.cl)}, throat ${sol.marks.throat > 0 ? L(sol.marks.throat) : '—'}`] : []),
          ...(roll ? [`Roll elbow 1 outlet to ${clockStr(clockDeg)} looking downstream`] : []),
        ].join('\n')} />
        <Formula title="How it was worked out">
          <ol className="steps">
            {steps.map((s, i) => <li key={i}><b>{s.t}</b><br /><code className="ff-f">{s.f}</code><br /><code>{s.v}</code>{s.p && <><br /><span className="fhint">{s.p}</span></>}</li>)}
          </ol>
        </Formula>
        <Formula title="Dimensions used">
          <ul>
            <li>Elbow radius {L(R)} ({R.toFixed(3)}") — {rSrc}: {rHow}.</li>
            {od != null && <li>Pipe OD {L(od)} ({od.toFixed(3)}") — {odSrc}{odSrc === 'Standard' ? ', ASME B36.10M' : ''}. Used only for the cut marks and the drawing.</li>}
            <li>Root gap {L(g)} per weld{inp.gap ? '' : ' (none entered)'}.</li>
            <li>Both elbows cut to the same angle. The line comes out parallel to the line going in. Offset is center to center.</li>
          </ul>
        </Formula>
      </>}

      {cmp && <section className="results">
        <h3>Other ways to make this offset · tap a row to use it</h3>
        <div className="r90-tbl">
          <table className="dtable ff-cmp">
            <thead><tr><th>Elbows</th><th>Pipe piece</th><th>Travel</th><th>C-C run</th><th>Take off</th></tr></thead>
            <tbody>
              {cmp.map((x, i) => {
                const cur = sol && Math.abs(x.a - sol.theta) < 0.005 && (x.f2f ? sol.mode === 'f2f' : sol.mode !== 'f2f');
                if (!x.f2f && x.pipe < -1e-9) return <tr key={i} onClick={() => useRow(x)}><td>{faShort(x.a)}</td><td colSpan={4} className="muted">Too much angle, elbows overlap</td></tr>;
                return <tr key={i} className={cur ? 'hl' : ''} onClick={() => useRow(x)}><td>{x.f2f ? <>{fa(x.a)}<br /><small>fitting to fitting</small></> : faShort(x.a)}</td><td>{x.f2f ? 'None' : L(x.pipe)}</td><td>{L(x.T)}</td><td>{L(x.cc)}</td><td>{L(x.run)}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
        <p className="fhint">Same pipe size, elbows and root gap. Pipe piece is the cut length between the elbow faces.</p>
      </section>}
    </div>
  );
}

// ---------------------------------------------------------------- drawings (SVG strings, coloured with the app's theme)
const fmt = (v: number) => (+v).toFixed(1);
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const DEFS = `<defs><marker id="ffah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L10 5 L0 9z" style="fill:var(--text)"/></marker><marker id="ffaho" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 1 L10 5 L0 9z" style="fill:var(--accent)"/></marker></defs>`;
function txt(p: number[], s: string, o: { anchor?: string; col?: string; size?: number; w?: number; rot?: number } = {}) {
  return `<text class="ff-lbl" x="${fmt(p[0])}" y="${fmt(p[1])}" text-anchor="${o.anchor || 'middle'}" style="fill:${o.col || 'var(--text)'};font-size:${o.size || 13.5}px;font-weight:${o.w || 600}"${o.rot != null ? ` transform="rotate(${fmt(o.rot)} ${fmt(p[0])} ${fmt(p[1])})"` : ''}>${esc(s)}</text>`;
}
function dim(p: number[], q: number[], off: number, label: string) {
  const dx = q[0] - p[0], dy = q[1] - p[1], Lh = Math.hypot(dx, dy); if (Lh < 3) return '';
  const n = [-dy / Lh, dx / Lh], a = [p[0] + n[0] * off, p[1] + n[1] * off], b = [q[0] + n[0] * off, q[1] + n[1] * off], s = Math.sign(off) || 1;
  let ang = Math.atan2(dy, dx) * R2D; if (ang > 90) ang -= 180; if (ang < -90) ang += 180; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const ext = (o: number[]) => `<line x1="${fmt(o[0] + n[0] * s * 3)}" y1="${fmt(o[1] + n[1] * s * 3)}" x2="${fmt(o[0] + n[0] * (off + s * 5))}" y2="${fmt(o[1] + n[1] * (off + s * 5))}" style="stroke:var(--muted)" stroke-width="1"/>`;
  const up = [Math.sin(ang * D2R), -Math.cos(ang * D2R)];
  return ext(p) + ext(q) + `<line x1="${fmt(a[0])}" y1="${fmt(a[1])}" x2="${fmt(b[0])}" y2="${fmt(b[1])}" style="stroke:var(--text)" stroke-width="1.4" marker-start="url(#ffah)" marker-end="url(#ffah)"/>` + txt([m[0] + up[0] * 6, m[1] + up[1] * 6], label, { rot: ang });
}
const COL: Record<string, [string, string]> = {
  fit: ['var(--accent)', 'color-mix(in srgb, var(--accent) 28%, var(--surface))'],
  spool: ['var(--text)', 'color-mix(in srgb, var(--text) 30%, var(--surface))'],
  pipe: ['var(--muted)', 'color-mix(in srgb, var(--muted) 22%, var(--surface))'],
};
function stroke(pts: number[][], w: number, kind: string) {
  const c = COL[kind], d = 'M' + pts.map((p) => fmt(p[0]) + ' ' + fmt(p[1])).join(' L');
  return `<path d="${d}" style="stroke:${c[0]}" stroke-width="${fmt(w)}" fill="none" stroke-linejoin="round"/><path d="${d}" style="stroke:${c[1]}" stroke-width="${fmt(Math.max(1, w - 3))}" fill="none" stroke-linejoin="round"/>`;
}
const arcPts = (c: number[], r0: number, a0: number, a1: number, n: number) => { const out: number[][] = []; for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * D2R; out.push([c[0] + r0 * Math.cos(a), c[1] + r0 * Math.sin(a)]); } return out; };

function LayoutDrawing({ R, od, O, sol, fmt: lenTxt }: { R: number; od: number; O: number; sol: FitFitSol; fmt: (v: number) => string }) {
  const t = sol.theta, L = sol.L;
  const A1 = arcPts([0, R], R, -90, -90 + t, 48), E1 = A1[A1.length - 1], d = [cosD(t), sinD(t)];
  const S2 = [E1[0] + d[0] * L, E1[1] + d[1] * L], c2 = [S2[0] + R * sinD(t), S2[1] - R * cosD(t)];
  const A2 = arcPts(c2, R, 90 + t, 90, 48), E2 = A2[A2.length - 1];
  const lead = Math.max(R * 1.1, od * 2, O * 0.3);
  const inA = [-lead, 0], outB = [E2[0] + lead, E2[1]];
  const WP1 = [R * tanD(t / 2), 0], WP2 = [E2[0] - R * tanD(t / 2), E2[1]];
  const minX = inA[0], maxX = outB[0], minY = Math.min(0, E2[1]) - od / 2, maxY = Math.max(0, E2[1]) + od / 2;
  const Wd = 760, padL = 110, padR = 110, padT = 50, padB = 128, maxH = 500;
  const sc = Math.min((Wd - padL - padR) / (maxX - minX), (maxH - padT - padB) / Math.max(maxY - minY, 1e-6));
  const H = Math.max(270, (maxY - minY) * sc + padT + padB), oy = padT + ((H - padT - padB) - (maxY - minY) * sc) / 2;
  const tp = (p: number[]) => [padL + (p[0] - minX) * sc, oy + (maxY - p[1]) * sc], w = Math.max(5, od * sc);
  let g = '';
  g += stroke([tp(inA), tp([0, 0])], w, 'pipe') + stroke([tp(E2), tp(outB)], w, 'pipe');
  if (sol.pipe > 1e-9) g += stroke([tp(E1), tp(S2)], w, 'spool');
  g += stroke(A1.map(tp), w, 'fit') + stroke(A2.map(tp), w, 'fit');
  const cl = [inA, ...A1, S2, ...A2, outB].map(tp);
  g += `<path d="M${cl.map((p) => fmt(p[0]) + ' ' + fmt(p[1])).join(' L')}" fill="none" style="stroke:var(--text)" stroke-width="1.2" stroke-dasharray="14 4 2 4"/>`;
  const wpA = tp(WP1), wpB = tp(WP2);
  g += `<path d="M${fmt(tp([0, 0])[0])} ${fmt(wpA[1])} L${fmt(wpA[0])} ${fmt(wpA[1])} L${fmt(wpB[0])} ${fmt(wpB[1])} L${fmt(tp(E2)[0])} ${fmt(wpB[1])}" fill="none" style="stroke:var(--muted)" stroke-width="1" stroke-dasharray="3 3"/>`;
  [wpA, wpB].forEach((p) => { g += `<circle cx="${fmt(p[0])}" cy="${fmt(p[1])}" r="4" style="fill:var(--text)"/>`; });
  const tick = (p: number[], dir: number[]) => { const q = tp(p), n = [-dir[1], dir[0]], hh = w / 2 + 6; return `<line x1="${fmt(q[0] + n[0] * hh)}" y1="${fmt(q[1] - n[1] * hh)}" x2="${fmt(q[0] - n[0] * hh)}" y2="${fmt(q[1] + n[1] * hh)}" style="stroke:var(--text)" stroke-width="2.5"/>`; };
  g += tick([0, 0], [1, 0]) + tick(E1, d) + tick(E2, [1, 0]); if (L > 1e-9 && sol.pipe > 1e-9) g += tick(S2, d);
  {
    const q1 = tp([0, 0]), q2 = tp(E2);
    const tv = [wpB[0] - wpA[0], wpB[1] - wpA[1]], tl = Math.hypot(tv[0], tv[1]) || 1, tOff = -(w / 2 + 18), tStartX = wpA[0] + (-tv[1] / tl) * tOff;
    const tLab = `Travel ${lenTxt(sol.T)}`, tShort = tl < tLab.length * 8 + 24;
    g += txt(tShort ? [q1[0] - 10, q1[1] + w / 2 + 22] : [Math.min(q1[0] - 10, tStartX - 12), q1[1] - w / 2 - 12], `Elbow 1 · ${fa(t)}`, { col: 'var(--accent)', w: 700, anchor: 'end' });
    g += txt([q2[0] + 8, q2[1] - w / 2 - 12], `Elbow 2 · ${fa(t)}`, { col: 'var(--accent)', w: 700, anchor: 'start' });
  }
  if (sol.pipe > 1e-9) { const mm = tp([(E1[0] + S2[0]) / 2, (E1[1] + S2[1]) / 2]); g += txt([mm[0] + w / 2 + 8, mm[1] + w / 2 + 10], `Pipe ${lenTxt(sol.pipe)} E-E`, { w: 700, anchor: 'start' }); }
  const xr = outB[0];
  g += `<line x1="${fmt(tp([0, 0])[0])}" y1="${fmt(tp([0, 0])[1])}" x2="${fmt(tp([xr, 0])[0])}" y2="${fmt(tp([xr, 0])[1])}" style="stroke:var(--muted)" stroke-width="1" stroke-dasharray="2 5"/>`;
  g += dim(tp([xr, 0]), tp([xr, E2[1]]), -24, `Offset ${lenTxt(O)}`);
  const yb = tp([0, 0])[1] + w / 2;
  g += dim([wpA[0], yb], [wpB[0], yb], 40, `C-C run ${lenTxt(sol.ccRun)}`);
  g += dim([tp([0, 0])[0], yb], [tp(E2)[0], yb], 78, `Offset take off ${lenTxt(sol.run)}`);
  g += dim(wpA, wpB, -(w / 2 + 18), `Travel ${lenTxt(sol.T)}`);
  // the drawing is built from R and θ alone — check it lands on the numbers
  const chk: Array<[string, number, number]> = [['offset', E2[1], O], ['offset take off', E2[0], sol.run], ['C-C run', WP2[0] - WP1[0], sol.ccRun], ['travel', Math.hypot(WP2[0] - WP1[0], WP2[1] - WP1[1]), sol.T], ['parallel outlet', E2[0] - c2[0], 0]];
  const bad = chk.filter((c) => Math.abs(c[1] - c[2]) > 1e-6);
  return (
    <figure className="diagram ff-layout">
      <div className="ff-scroll"><svg viewBox={`0 0 ${Wd} ${fmt(H)}`} role="img" aria-label="Offset drawn to scale" dangerouslySetInnerHTML={{ __html: DEFS + g }} /></div>
      <figcaption>Drawn to scale. Teal: cut elbows{sol.pipe > 1e-9 ? ' · dark: pipe piece' : ''} · grey: existing line · ● work point · | weld.</figcaption>
      {bad.length
        ? <Msg><b>Drawing check failed:</b> the drawing’s {bad.map((b) => b[0]).join(', ')} don’t match the numbers. Don’t use this drawing.</Msg>
        : <p className="fhint ff-ok"><b>Drawing check:</b> the drawing is built from the elbow radius and angle alone. Its offset, take off, C-C run, travel and parallel outlet match the numbers above.</p>}
    </figure>
  );
}

function elbowSvg(R: number, od: number, t: number) {
  const ro = od / 2, ri = Math.max(R - ro, 0), Ro = R + ro, s = 150 / Ro, cx = 96, cy = 205;
  const pt = (rad: number, a: number) => [cx + rad * s * Math.sin(a * D2R), cy - rad * s * Math.cos(a * D2R)];
  const ring = (a0: number, a1: number) => { const p: number[][] = []; for (let i = 0; i <= 40; i++) p.push(pt(Ro, a0 + (a1 - a0) * i / 40)); for (let i = 40; i >= 0; i--) p.push(pt(ri, a0 + (a1 - a0) * i / 40)); return 'M' + p.map((q) => fmt(q[0]) + ' ' + fmt(q[1])).join(' L') + 'Z'; };
  let g = DEFS;
  g += `<path d="${ring(t, 90)}" style="fill:${COL.pipe[1]};stroke:var(--muted)" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  g += `<path d="${ring(0, t)}" style="fill:${COL.fit[1]};stroke:var(--accent)" stroke-width="2"/>`;
  const clp: number[][] = []; for (let i = 0; i <= 40; i++) clp.push(pt(R, 90 * i / 40));
  g += `<path d="M${clp.map((p) => fmt(p[0]) + ' ' + fmt(p[1])).join(' L')}" fill="none" style="stroke:var(--text)" stroke-width="1" stroke-dasharray="10 3 2 3"/>`;
  const c1 = pt(ri, t), c2 = pt(Ro, t), dx = c2[0] - c1[0], dy = c2[1] - c1[1];
  g += `<line x1="${fmt(c1[0] - dx * 0.1)}" y1="${fmt(c1[1] - dy * 0.1)}" x2="${fmt(c2[0] + dx * 0.12)}" y2="${fmt(c2[1] + dy * 0.12)}" style="stroke:#e0533f" stroke-width="2.5"/>`;
  const f1 = pt(ri, 0), f2 = pt(Ro, 0); g += `<line x1="${fmt(f1[0])}" y1="${fmt(f1[1])}" x2="${fmt(f2[0])}" y2="${fmt(f2[1])}" style="stroke:var(--text)" stroke-width="3"/>`;
  g += txt([f1[0] - 8, (f1[1] + f2[1]) / 2 + 4], 'factory end', { size: 12, col: 'var(--muted)', anchor: 'end' });
  const hp = pt(Ro, t / 2); g += txt([hp[0] + 6, hp[1] + 2], 'Heel', { anchor: 'start', col: 'var(--accent)', w: 700 });
  if (ri > 0) { const tq = pt(ri, t / 2); g += txt([tq[0] - 4, tq[1] + 4], 'Throat', { anchor: 'end', col: 'var(--accent)', w: 700, size: 12 }); }
  g += txt([c2[0] + dx * 0.12 + 4, c2[1] + dy * 0.12 + 4], `cut at ${fa(t)}`, { anchor: 'start', col: '#e0533f', w: 700, size: 12.5 });
  const rest = pt(R, (t + 90) / 2); if (90 - t > 12) g += txt([rest[0], rest[1] + 4], `scrap ${fa(90 - t)}`, { size: 11.5, col: 'var(--muted)', w: 500 });
  return g;
}

function clockSvg(h: number, v: number) {
  const ang = (Math.atan2(h, v) * R2D + 360) % 360, c = 80, r = 60;
  let g = DEFS + `<circle cx="${c}" cy="${c}" r="${r + 8}" style="fill:var(--surface);stroke:var(--line)" stroke-width="2"/>`;
  for (let i = 0; i < 12; i++) { const a = i * 30 * D2R; g += `<line x1="${fmt(c + (r + 2) * Math.sin(a))}" y1="${fmt(c - (r + 2) * Math.cos(a))}" x2="${fmt(c + (r + 8) * Math.sin(a))}" y2="${fmt(c - (r + 8) * Math.cos(a))}" style="stroke:var(--muted)" stroke-width="${i % 3 ? 1 : 2}"/>`; }
  ([[12, 0], [3, 90], [6, 180], [9, 270]] as Array<[number, number]>).forEach(([n, a]) => { g += txt([c + (r - 12) * Math.sin(a * D2R), c - (r - 12) * Math.cos(a * D2R) + 4], String(n), { size: 12, col: 'var(--muted)' }); });
  const A = ang * D2R;
  g += `<line x1="${c}" y1="${c}" x2="${fmt(c + (r - 6) * Math.sin(A))}" y2="${fmt(c - (r - 6) * Math.cos(A))}" style="stroke:var(--accent)" stroke-width="4" marker-end="url(#ffaho)"/><circle cx="${c}" cy="${c}" r="7" style="fill:${COL.pipe[1]};stroke:var(--muted)" stroke-width="2"/>`;
  return g;
}
