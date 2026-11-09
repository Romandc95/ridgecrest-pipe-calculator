import React from 'react';
import { ExpansionTool } from './ShopTools';
import { Field, Results, Row, Msg, Formula, ToolActions, Segmented, Select, useTool, useFmt, Card, Grid } from './components';
import { parseLength, parseMeasurement, tryParse } from '../engine/parse';
import { MATERIALS, MATERIAL_ORDER, Material, typesFor, sizesFor, pipeProps, manualPipe, DATASETS, PipeProps } from '../engine/pipedata';
import { pressureLoss, circle, WATER } from '../engine/hydraulics';
import { CalcError, Q, fromUnit, inDisplayUnit, UNIT_LABEL, LB_PER_FT3_WATER, DENS_TO_PCF, DensUnit, FLOW_TO_CFS, VEL_TO_FPS, PRESS_TO_PSI } from '../engine/units';
import { formatNumber } from '../engine/format';

function attempt<T>(f: () => T): { ok: true; v: T } | { ok: false; err: string } {
  try { return { ok: true, v: f() }; } catch (e) { return { ok: false, err: (e as Error).message }; }
}
const val = <T,>(fn: (s: string) => T, s: string): T | undefined => {
  const r = tryParse(fn, s);
  if (r === null) return undefined;
  if (!r.ok) throw new CalcError('INPUT', r.err);
  return r.v;
};
const plain = (s: string) => { const q = parseMeasurement(s); if (q.kind !== 'num') throw new CalcError('INPUT', 'Enter a number (unit is chosen separately).'); return q.v; };

export function PipeTools() {
  const [t0, set] = useTool('pipe', { tab: 'flow' });
  const t = { ...t0, tab: t0.tab === 'data' ? 'flow' : t0.tab }; // pipe data moved to Specs → Piping
  return (
    <div className="tool">
      <div className="chipgrid four" role="tablist">
        {([['flow', 'Flow'], ['expansion', 'Expansion'], ['pfa', 'P·F·A'], ['loss', 'Loss'], ['conv', 'Convert'], ['circle', 'Circle']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={t.tab === k} className={t.tab === k ? 'on' : ''} onClick={() => set('tab', k)}>{l}</button>
        ))}
      </div>
      {t.tab === 'flow' && <FlowTool />}
      {t.tab === 'expansion' && <ExpansionTool />}
      {t.tab === 'pfa' && <PFATool />}
      {t.tab === 'loss' && <LossTool />}
      {t.tab === 'conv' && <ConvertTool />}
      {t.tab === 'circle' && <CircleTool />}
    </div>
  );
}

// ---- shared pipe picker -------------------------------------------------------------
const PIPE_DEFAULTS = { mat: 'steel', type: 'Std', nps: '2', manual: '', mOD: '', mWall: '', fluid: '62.42796', fluidU: 'pcf' };
function usePipe(id: string) {
  const [inp, set, reset] = useTool(id, PIPE_DEFAULTS);
  const mat = (Object.prototype.hasOwnProperty.call(MATERIALS, inp.mat) ? inp.mat : PIPE_DEFAULTS.mat) as Material;
  const types = typesFor(mat);
  const type = types.includes(inp.type) ? inp.type : types[0] ?? '';
  const sizes = sizesFor(mat, type);
  const nps = sizes.includes(inp.nps) ? inp.nps : sizes[0] ?? '';
  const useManual = inp.manual === '1' || !types.length;
  const pipe = attempt((): PipeProps => {
    const fl = Number(inp.fluid) * DENS_TO_PCF[inp.fluidU as DensUnit];
    if (!(fl > 0)) throw new CalcError('INPUT', 'Fluid density must be positive.');
    if (useManual) {
      const od = val(parseLength, inp.mOD), w = val(parseLength, inp.mWall);
      if (od === undefined || w === undefined) throw new CalcError('INPUT', 'Enter actual OD and wall thickness.');
      return manualPipe(mat, od, w, fl);
    }
    return pipeProps(mat, type, nps, fl);
  });
  return { inp, set, reset, mat, types, type, sizes, nps, useManual, pipe };
}
function PipePicker({ p, fluid = false }: { p: ReturnType<typeof usePipe>; fluid?: boolean }) {
  const { inp, set, types, type, sizes, nps, useManual, mat } = p;
  return (
    <>
      <Grid>
        <Select label="Material" value={mat} options={MATERIAL_ORDER.map((m) => [m, MATERIALS[m].label])} onChange={(v) => set('mat', v)} />
        {types.length ? <Select label="Schedule / type" value={type} options={types.map((t) => [t, t])} onChange={(v) => set('type', v)} /> : <div />}
        {types.length && !useManual ? <Select label="Nominal size (NPS)" value={nps} options={sizes.map((s) => [s, `${s}"`])} onChange={(v) => set('nps', v)} /> : null}
      </Grid>
      {types.length > 0 && <label className="toggle sm"><input type="checkbox" checked={inp.manual === '1'} onChange={(e) => set('manual', e.target.checked ? '1' : '')} /> Enter actual dimensions manually</label>}
      {!types.length && <Msg kind="warn">{MATERIALS[mat].coverage}</Msg>}
      {useManual && (
        <Grid>
          <Field label="Actual OD" value={inp.mOD} onChange={(v) => set('mOD', v)} parse={parseLength} />
          <Field label="Wall thickness" value={inp.mWall} onChange={(v) => set('mWall', v)} parse={parseLength} />
        </Grid>
      )}
      {fluid && (
        <Grid>
          <Field label="Fluid density" value={inp.fluid} onChange={(v) => set('fluid', v)} inputMode="decimal" hint="water = 62.42796 lb/ft³" />
          <Select label="Density unit" value={inp.fluidU} options={(Object.keys(DENS_TO_PCF) as DensUnit[]).map((u) => [u, UNIT_LABEL[u]])} onChange={(v) => set('fluidU', v)} />
        </Grid>
      )}
    </>
  );
}

export function PipeData() {
  const p = usePipe('pipedata');
  const f = useFmt();
  const r = p.pipe;
  const pp = r.ok ? r.v : null;
  const ds = MATERIALS[p.mat].datasets[0];
  const rows: Row[] = pp ? [
    { label: 'Nominal size', value: pp.nps ? `${pp.nps}" NPS · ${pp.type}` : 'manual', sub: 'designation only — not the OD' },
    { label: 'Outside diameter', value: f.len(pp.od, 'indec'), sub: `${formatNumber(pp.od * 25.4, 2)} mm`, strong: true },
    { label: 'Inside diameter', value: f.len(pp.id, 'indec'), sub: `${formatNumber(pp.id * 25.4, 2)} mm` },
    { label: 'Wall thickness', value: f.len(pp.wall, 'indec'), sub: `${formatNumber(pp.wall * 25.4, 2)} mm` },
    { label: 'Internal area', value: `${formatNumber(pp.area)} sq in`, sub: `${formatNumber(pp.area / 144)} sq ft` },
    { label: 'Capacity', value: `${formatNumber(pp.galPerFt)} gal/ft`, sub: `${formatNumber(pp.galPerFt * 3.785411784 / 0.3048)} L/m` },
    { label: 'Empty weight', value: pp.weightPerFt === null ? 'no density data' : `${formatNumber(pp.weightPerFt)} lb/ft`, sub: pp.weightPerFt === null ? undefined : `${formatNumber(pp.weightPerFt * 0.45359237 / 0.3048)} kg/m · ${MATERIALS[p.mat].densitySource}` },
    { label: 'Filled weight', value: pp.filledPerFt === null ? '—' : `${formatNumber(pp.filledPerFt)} lb/ft`, sub: `fluid ${formatNumber(pp.fluidPcf)} lb/ft³` },
  ] : [];
  return (
    <>
      <Card><PipePicker p={p} fluid />{!r.ok && <Msg>{r.err}</Msg>}</Card>
      {pp && <Results rows={rows} />}
      <Card className="srcbox">
        <h4>Dataset coverage</h4>
        {ds ? <><p><b>{DATASETS[ds].label}.</b> {DATASETS[ds].source}</p><p>Units: {DATASETS[ds].units}. {DATASETS[ds].notes}</p></> : null}
        <p>{MATERIALS[p.mat].coverage}</p>
        <p className="muted">Weights computed from geometry × material density ({MATERIALS[p.mat].densitySource}). Steel weights agree with ASME B36.10M tabulated plain-end weights within rounding (e.g. 3" Sch 80: 10.26 lb/ft; the reference calculator displays 10.2528).</p>
      </Card>
      <ToolActions tool="pipedata" title="Pipe data" inputs={p.inp} summary={pp ? `${MATERIALS[p.mat].label} ${pp.nps ?? 'manual'} ${pp.type}: OD ${pp.od} in, ID ${formatNumber(pp.id)} in, wall ${pp.wall} in, area ${formatNumber(pp.area)} sq in, ${formatNumber(pp.galPerFt)} gal/ft` + (pp.weightPerFt !== null ? `, ${formatNumber(pp.weightPerFt)} lb/ft empty, ${formatNumber(pp.filledPerFt!)} lb/ft filled` : '') : ''} disabled={!pp} />
    </>
  );
}

// ---- Flow / velocity / area --------------------------------------------------------
const FLOW_U: Array<[string, string]> = (Object.keys(FLOW_TO_CFS)).map((u) => [u, UNIT_LABEL[u]]);
const VEL_U: Array<[string, string]> = (Object.keys(VEL_TO_FPS)).map((u) => [u, UNIT_LABEL[u]]);
function FlowTool() {
  const [inp, set, reset] = useTool('flow', { areaSrc: 'pipe', area: '', Q: '', Qu: 'gpm', V: '', Vu: 'fps', solve: 'V' });
  const p = usePipe('flowpipe');
  const r = attempt(() => {
    let A: number;
    if (inp.areaSrc === 'pipe') { if (!p.pipe.ok) throw new CalcError('DATA', p.pipe.err); A = p.pipe.v.area; }
    else { const a = val(parseMeasurement, inp.area); if (!a) throw new CalcError('INPUT', 'Enter the flow area.'); A = a.kind === 'len' && a.dim === 2 ? a.v : a.kind === 'num' ? a.v : NaN; if (!(A > 0)) throw new CalcError('INPUT', 'Area must be a positive area, e.g. 1.8 sq in.'); }
    const Aft = A / 144;
    if (inp.solve === 'V') {
      const q = val(plain, inp.Q); if (q === undefined) throw new CalcError('INPUT', 'Enter the flow rate.');
      const cfs = q * FLOW_TO_CFS[inp.Qu as keyof typeof FLOW_TO_CFS];
      return { A, cfs, fps: cfs / Aft };
    }
    const v = val(plain, inp.V); if (v === undefined) throw new CalcError('INPUT', 'Enter the velocity.');
    const fps = v * VEL_TO_FPS[inp.Vu as keyof typeof VEL_TO_FPS];
    return { A, cfs: fps * Aft, fps };
  });
  const res = r.ok ? r.v : null;
  const fq = (u: string) => `${formatNumber(inDisplayUnit({ v: res!.cfs, kind: 'flow', dim: 0, unit: u as Q['unit'] }))} ${UNIT_LABEL[u]}`;
  const fv = (u: string) => `${formatNumber(inDisplayUnit({ v: res!.fps, kind: 'vel', dim: 0, unit: u as Q['unit'] }))} ${UNIT_LABEL[u]}`;
  return (
    <>
      <Card>
        <Segmented small value={inp.solve} onChange={(v) => set('solve', v)} options={[['V', 'Solve velocity'], ['Q', 'Solve flow']]} />
        <Segmented small value={inp.areaSrc} onChange={(v) => set('areaSrc', v)} options={[['pipe', 'Area from pipe'], ['manual', 'Enter area']]} />
        {inp.areaSrc === 'pipe' ? <PipePicker p={p} /> : <Field label="Flow area" value={inp.area} onChange={(v) => set('area', v)} parse={parseMeasurement} hint="e.g. 1.8 sq in" />}
        {inp.solve === 'V'
          ? <Grid><Field label="Flow rate" value={inp.Q} onChange={(v) => set('Q', v)} parse={plain} inputMode="decimal" /><Select label="Unit" value={inp.Qu} options={FLOW_U} onChange={(v) => set('Qu', v)} /></Grid>
          : <Grid><Field label="Velocity" value={inp.V} onChange={(v) => set('V', v)} parse={plain} inputMode="decimal" /><Select label="Unit" value={inp.Vu} options={VEL_U} onChange={(v) => set('Vu', v)} /></Grid>}
        {!r.ok && (inp.Q || inp.V) && <Msg>{r.err}</Msg>}
        <button className="btn ghost" onClick={reset}>Clear</button>
      </Card>
      {res && <Results rows={[
        { label: 'Area', value: `${formatNumber(res.A)} sq in` },
        { label: 'Flow', value: fq('gpm'), sub: ['cfm', 'cfs', 'lps', 'm3s'].map(fq).join(' · '), strong: inp.solve === 'Q' },
        { label: 'Velocity', value: fv('fps'), sub: ['fpm', 'mps'].map(fv).join(' · '), strong: inp.solve === 'V' },
      ]} />}
      <Formula><p>Q = V · A (consistent units). 1 ft³/s = 448.831 gpm = 28.3168 L/s.</p></Formula>
      <ToolActions tool="flow" title="Flow / velocity" inputs={inp} summary={res ? `Area ${formatNumber(res.A)} sq in; flow ${fq('gpm')}; velocity ${fv('fps')}` : ''} disabled={!res} />
    </>
  );
}

// ---- Pressure / force / area ---------------------------------------------------------
function PFATool() {
  const [inp0, set, reset] = useTool('pfa', { P: '', Pu: 'psi', F: '', Fu: 'lbf', A: '' });
  const inp = { ...inp0, Pu: Object.prototype.hasOwnProperty.call(PRESS_TO_PSI, inp0.Pu) ? inp0.Pu : 'psi', Fu: inp0.Fu === 'N' ? 'N' : 'lbf' };
  const r = attempt(() => {
    const P = val(plain, inp.P), F = val(plain, inp.F), Aq = val(parseMeasurement, inp.A);
    const A = Aq ? (Aq.kind === 'len' && Aq.dim === 2 ? Aq.v : Aq.kind === 'num' ? Aq.v : NaN) : undefined;
    if (A !== undefined && !(A >= 0)) throw new CalcError('INPUT', 'Area must be an area, e.g. 2 sq in.');
    const psi = P === undefined ? undefined : P * PRESS_TO_PSI[inp.Pu as keyof typeof PRESS_TO_PSI];
    const lbf = F === undefined ? undefined : inp.Fu === 'N' ? F / 4.4482216152605 : F;
    const n = [psi, lbf, A].filter((x) => x !== undefined).length;
    if (n < 2) throw new CalcError('INPUT', 'Enter any two of pressure, force and area.');
    if (n === 3) throw new CalcError('INPUT', 'All three entered — clear the one you want calculated.');
    if (psi === undefined) { if (A === 0) throw new CalcError('MATH', 'Area is zero — division by zero.'); return { psi: lbf! / A!, lbf: lbf!, A: A!, solved: 'P' }; }
    if (lbf === undefined) return { psi, lbf: psi * A!, A: A!, solved: 'F' };
    if (psi === 0) throw new CalcError('MATH', 'Pressure is zero — division by zero.');
    return { psi, lbf, A: lbf / psi, solved: 'A' };
  });
  const res = r.ok ? r.v : null;
  const fp = (u: keyof typeof PRESS_TO_PSI) => `${formatNumber(res!.psi / PRESS_TO_PSI[u])} ${UNIT_LABEL[u]}`;
  return (
    <>
      <Card>
        <p className="lead">Enter any two; the third is calculated.</p>
        <Grid>
          <Field label="Pressure" value={inp.P} onChange={(v) => set('P', v)} parse={plain} inputMode="decimal" />
          <Select label="Unit" value={inp.Pu} options={Object.keys(PRESS_TO_PSI).map((u) => [u, UNIT_LABEL[u]])} onChange={(v) => set('Pu', v)} />
          <Field label="Force" value={inp.F} onChange={(v) => set('F', v)} parse={plain} inputMode="decimal" />
          <Select label="Unit" value={inp.Fu} options={[['lbf', 'lbf'], ['N', 'N']]} onChange={(v) => set('Fu', v)} />
          <Field label="Area" value={inp.A} onChange={(v) => set('A', v)} parse={parseMeasurement} hint="sq in if no unit" />
        </Grid>
        {(inp.P || inp.F || inp.A) && !r.ok && <Msg>{r.err}</Msg>}
        <button className="btn ghost" onClick={reset}>Clear</button>
      </Card>
      {res && <Results rows={[
        { label: 'Pressure', value: fp('psi'), sub: (['psf', 'inHg', 'ftH2O', 'bar', 'kPa'] as const).map(fp).join(' · '), strong: res.solved === 'P' },
        { label: 'Force', value: `${formatNumber(res.lbf)} lbf`, sub: `${formatNumber(res.lbf * 4.4482216152605)} N`, strong: res.solved === 'F' },
        { label: 'Area', value: `${formatNumber(res.A)} sq in`, sub: `${formatNumber(res.A / 144)} sq ft`, strong: res.solved === 'A' },
      ]} />}
      <Formula><p>P = F / A. Head uses water at 1000 kg/m³ (1 psi ≈ 2.30665 ft); inHg at 0 °C.</p></Formula>
      <ToolActions tool="pfa" title="Pressure · force · area" inputs={inp} summary={res ? `P ${fp('psi')}, F ${formatNumber(res.lbf)} lbf, A ${formatNumber(res.A)} sq in` : ''} disabled={!res} />
    </>
  );
}

// ---- Pressure loss ---------------------------------------------------------------------
function LossTool() {
  const [inp0, set, reset] = useTool('loss', { Q: '', Qu: 'gpm', L: '' });
  const inp = { ...inp0, Qu: Object.prototype.hasOwnProperty.call(FLOW_TO_CFS, inp0.Qu) ? inp0.Qu : 'gpm' };
  const p = usePipe('losspipe');
  const r = attempt(() => {
    if (!p.pipe.ok) throw new CalcError('DATA', p.pipe.err);
    const q = val(plain, inp.Q); if (q === undefined) throw new CalcError('INPUT', 'Enter the flow rate.');
    const L = val(parseLength, inp.L);
    return { pl: pressureLoss(p.pipe.v.id, q * FLOW_TO_CFS[inp.Qu as keyof typeof FLOW_TO_CFS], MATERIALS[p.mat].roughnessFt, L === undefined ? null : L / 12), L };
  });
  const res = r.ok ? r.v : null;
  const per = res?.pl.perFoot ? ' per ft' : '';
  return (
    <>
      <Card>
        <PipePicker p={p} />
        <Grid>
          <Field label="Flow rate" value={inp.Q} onChange={(v) => set('Q', v)} parse={plain} inputMode="decimal" />
          <Select label="Unit" value={inp.Qu} options={FLOW_U} onChange={(v) => set('Qu', v)} />
          <Field label="Pipe length (optional)" value={inp.L} onChange={(v) => set('L', v)} parse={parseLength} hint="blank = loss per foot" />
        </Grid>
        {inp.Q && !r.ok && <Msg>{r.err}</Msg>}
        <button className="btn ghost" onClick={reset}>Clear</button>
      </Card>
      {res && <Results rows={[
        { label: 'Pressure loss' + per, value: `${formatNumber(res.pl.units.psi)} psi`, strong: true, sub: `${formatNumber(res.pl.units.psf)} psf · ${formatNumber(res.pl.units.kPa)} kPa · ${formatNumber(res.pl.units.bar)} bar` },
        { label: 'Head loss' + per, value: `${formatNumber(res.pl.units.ftH2O)} ft`, sub: `${formatNumber(res.pl.units.inHg)} inHg` },
        { label: 'Reynolds number', value: formatNumber(res.pl.Re, 2) },
        { label: 'Friction factor f', value: formatNumber(res.pl.f, 6), sub: res.pl.method },
        { label: 'Mean velocity', value: `${formatNumber(res.pl.velocityFps)} ft/s` },
      ]} />}
      <Formula title="Equation, fluid and limits">
        <ul>
          <li>Darcy–Weisbach: Δp = f · (L/D) · ρV²/2, D = pipe inside diameter.</li>
          <li>Fluid: water, ρ = {WATER.rho} kg/m³, μ = {WATER.mu} Pa·s (≈ 68 °F). Other fluids / temperatures are not modelled.</li>
          <li>Re &lt; 3 000: laminar f = 64/Re. 3 000–100 000: Blasius f = 0.3164·Re^−0.25 (smooth). Above 100 000: Kármán–Prandtl smooth if roughness ε is inside the viscous sublayer, otherwise Colebrook–White.</li>
          <li>Roughness ε (×10⁻⁶ ft), from the reference calculator: PVC 15.6, copper 4.9, steel 221, stainless 49.2, brass 4.9, aluminum 4.9, cast iron 850. Selected: {formatNumber(MATERIALS[p.mat].roughnessFt * 1e6)}.</li>
          <li>Straight pipe only — no fitting or valve losses. Transitional flow (≈2 300–4 000) is inherently uncertain.</li>
          <li>Verified against the reference guide: 2" Std steel, 4 gpm → Re 6 120.09, 0.000205 psi/ft, 0.010232 psi per 50 ft; 40 gpm → 0.575408 psi per 50 ft. Above Re 100 000 the reference method is not published, so results there may differ.</li>
        </ul>
      </Formula>
      <ToolActions tool="loss" title="Pressure loss" inputs={inp} summary={res ? `Pressure loss${per}: ${formatNumber(res.pl.units.psi)} psi (${formatNumber(res.pl.units.ftH2O)} ft head), Re ${formatNumber(res.pl.Re, 2)}, ${res.pl.method}` : ''} disabled={!res} />
    </>
  );
}

// ---- Conversions -------------------------------------------------------------------
const CATS: Record<string, string[]> = {
  Length: ['in', 'ft', 'mm', 'm'], Area: ['sqin', 'sqft', 'sqm'], Volume: ['cuin', 'cuft', 'gal', 'L', 'cum'],
  Weight: ['lb', 'kg'], Temperature: ['F', 'C'], Flow: ['gpm', 'cfm', 'cfs', 'lps', 'm3s'], Velocity: ['fps', 'fpm', 'mps'],
  Pressure: ['psi', 'psf', 'inHg', 'ftH2O', 'bar', 'kPa'], Force: ['lbf', 'N'], Density: ['pcf', 'pci', 'ppg', 'kgm3', 'kgL'],
};
const LAB = (u: string) => (u === 'in' ? 'in' : u === 'ft' ? 'ft' : UNIT_LABEL[u] ?? u);
function ConvertTool() {
  const [inp, set, reset] = useTool('convert', { cat: 'Length', unit: 'in', v: '', dens: '62.42796' });
  const units = CATS[inp.cat];
  const unit = units.includes(inp.unit) ? inp.unit : units[0];
  const r = attempt(() => {
    const x = val(plain, inp.v); if (x === undefined) throw new CalcError('INPUT', 'Enter a value.');
    const q = fromUnit(x, unit as Q['unit']);
    return units.map((u) => {
      const disp = q.kind === 'len' && q.dim === 1 ? { ...q, unit: (u === 'in' ? 'indec' : u === 'ft' ? 'ftdec' : u) as Q['unit'] } : { ...q, unit: u as Q['unit'] };
      return [u, inDisplayUnit(disp)] as [string, number];
    });
  });
  const wv = attempt(() => {
    const x = val(plain, inp.v); const d = Number(inp.dens);
    if (x === undefined || !(d > 0)) return null;
    const q = fromUnit(x, unit as Q['unit']);
    if (inp.cat === 'Volume') { const lb = (q.v / 1728) * d; return `${formatNumber(lb)} lb · ${formatNumber(lb * 0.45359237)} kg at ${d} lb/ft³`; }
    if (inp.cat === 'Weight') { const ft3 = q.v / d; return `${formatNumber(ft3)} cu ft · ${formatNumber(ft3 * 1728 / 231)} gal · ${formatNumber(ft3 * 28.316846592)} L at ${d} lb/ft³`; }
    return null;
  });
  return (
    <>
      <Card>
        <Select label="Quantity" value={inp.cat} options={Object.keys(CATS).map((c) => [c, c])} onChange={(v) => { set('cat', v); set('unit', CATS[v][0]); }} />
        <Grid>
          <Field label="Value" value={inp.v} onChange={(v) => set('v', v)} parse={plain} inputMode="decimal" />
          <Select label="From" value={unit} options={units.map((u) => [u, LAB(u)])} onChange={(v) => set('unit', v)} />
        </Grid>
        {(inp.cat === 'Volume' || inp.cat === 'Weight') && <Field label="Weight/volume density (lb/ft³)" value={inp.dens} onChange={(v) => set('dens', v)} inputMode="decimal" hint="water 62.42796; set e.g. 111 for concrete" />}
        {inp.v && !r.ok && <Msg>{r.err}</Msg>}
        <button className="btn ghost" onClick={reset}>Clear</button>
      </Card>
      {r.ok && <Results rows={[...r.v.map(([u, x]) => ({ label: LAB(u), value: formatNumber(x, 6, 10), strong: u === unit })), ...(wv.ok && wv.v ? [{ label: inp.cat === 'Volume' ? 'Weight' : 'Volume', value: wv.v }] : [])]} />}
      <Formula><p>Exact definitions: 1 in = 25.4 mm; 1 US gal = 231 in³; 1 lb = 0.45359237 kg; 1 lbf = 4.4482216 N. Temperatures convert absolutely (°F = °C × 9/5 + 32). Default weight/volume is water at 1000 kg/m³ = {formatNumber(LB_PER_FT3_WATER)} lb/ft³.</p></Formula>
    </>
  );
}

function CircleTool() {
  const [inp, set, reset] = useTool('circle', { d: '', L: '' });
  const f = useFmt();
  const r = attempt(() => {
    const d = val(parseLength, inp.d); if (d === undefined) throw new CalcError('INPUT', 'Enter a diameter.');
    if (!(d > 0)) throw new CalcError('INPUT', 'Diameter must be greater than zero.');
    const L = val(parseLength, inp.L);
    return { d, L, ...circle(d) };
  });
  const res = r.ok ? r.v : null;
  return (
    <>
      <Card>
        <Grid>
          <Field label="Diameter" value={inp.d} onChange={(v) => set('d', v)} parse={parseLength} />
          <Field label="Length (optional, for capacity)" value={inp.L} onChange={(v) => set('L', v)} parse={parseLength} />
        </Grid>
        {inp.d && !r.ok && <Msg>{r.err}</Msg>}
        <button className="btn ghost" onClick={reset}>Clear</button>
      </Card>
      {res && <Results rows={[
        { label: 'Area', value: `${formatNumber(res.area)} sq in`, sub: `${formatNumber(res.area / 144)} sq ft · ${formatNumber(res.area * 645.16)} mm²`, strong: true },
        { label: 'Circumference', value: f.len(res.circumference), sub: f.dec(res.circumference) },
        { label: 'Radius', value: f.len(res.d / 2) },
        ...(res.L !== undefined ? [
          { label: 'Volume (capacity)', value: `${formatNumber(res.area * res.L / 1728)} cu ft`, sub: `${formatNumber(res.area * res.L / 231)} gal · ${formatNumber(res.area * res.L * 0.016387064)} L` },
          { label: 'Water weight', value: `${formatNumber(res.area * res.L / 1728 * LB_PER_FT3_WATER)} lb` },
        ] : []),
      ]} />}
      <Formula><p>Area = π d²/4; circumference = π d; capacity = area × length.</p></Formula>
      <ToolActions tool="circle" title="Circle" inputs={inp} summary={res ? `Circle Ø${f.len(res.d)}: area ${formatNumber(res.area)} sq in, circumference ${f.len(res.circumference)}` : ''} disabled={!res} />
    </>
  );
}
