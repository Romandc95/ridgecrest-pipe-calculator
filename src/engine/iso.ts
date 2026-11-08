// ISO sketch model: a pipe route as a tree of straight runs between nodes, in plant coordinates.
// x = East, y = North, z = Up (inches). Run lengths are centerline, fitting center to fitting center.
// Fittings are inferred at nodes (elbow / tee / cross / straight weld / end) and can be overridden at ends.
import { CalcError, deg2rad, rad2deg } from './units';
import { B169, npsNumber } from './fittings';
import { bwFitting } from './refdata';

/** Fittings and valves that can be placed on a drawing. kind: line = sits on a line; elbow = at a turn; branch = at a tee point; end = at the end of a line. */
export type ItemKind = 'line' | 'elbow' | 'branch' | 'end';
export interface CatalogItem { id: string; label: string; kind: ItemKind; group: string; short?: string }
export const CATALOG: CatalogItem[] = [
  // valves on a line
  { id: 'gate', label: 'Gate valve', kind: 'line', group: 'Valves' },
  { id: 'globe', label: 'Globe valve', kind: 'line', group: 'Valves' },
  { id: 'ball', label: 'Ball valve', kind: 'line', group: 'Valves' },
  { id: 'butterfly', label: 'Butterfly valve', kind: 'line', group: 'Valves' },
  { id: 'check', label: 'Swing check', kind: 'line', group: 'Valves' },
  { id: 'liftcheck', label: 'Lift check', kind: 'line', group: 'Valves' },
  { id: 'plug', label: 'Plug valve', kind: 'line', group: 'Valves' },
  { id: 'needle', label: 'Needle valve', kind: 'line', group: 'Valves' },
  { id: 'diaphragm', label: 'Diaphragm valve', kind: 'line', group: 'Valves' },
  { id: 'knifegate', label: 'Knife gate', kind: 'line', group: 'Valves' },
  { id: 'control', label: 'Control valve', kind: 'line', group: 'Valves' },
  { id: 'regulator', label: 'Pressure regulator', kind: 'line', group: 'Valves' },
  { id: 'solenoid', label: 'Solenoid valve', kind: 'line', group: 'Valves' },
  { id: 'anglevalve', label: 'Angle valve', kind: 'elbow', group: 'Valves' },
  { id: 'threeway', label: '3-way valve', kind: 'branch', group: 'Valves' },
  { id: 'relief', label: 'Relief valve', kind: 'end', group: 'Valves' },
  { id: 'vent', label: 'Vent valve', kind: 'end', group: 'Valves' },
  { id: 'drain', label: 'Drain valve', kind: 'end', group: 'Valves' },
  // fittings on a line
  { id: 'flange', label: 'Flange pair', kind: 'line', group: 'Line' },
  { id: 'orifice', label: 'Orifice flanges', kind: 'line', group: 'Line', short: 'FO' },
  { id: 'spectacle', label: 'Spectacle blind', kind: 'line', group: 'Line' },
  { id: 'reducer', label: 'Conc. reducer', kind: 'line', group: 'Line' },
  { id: 'eccreducer', label: 'Ecc. reducer', kind: 'line', group: 'Line' },
  { id: 'swage', label: 'Swage nipple', kind: 'line', group: 'Line' },
  { id: 'union', label: 'Union', kind: 'line', group: 'Line' },
  { id: 'coupling', label: 'Coupling', kind: 'line', group: 'Line' },
  { id: 'dielectric', label: 'Dielectric union', kind: 'line', group: 'Line' },
  { id: 'expjoint', label: 'Expansion joint', kind: 'line', group: 'Line' },
  { id: 'flexhose', label: 'Flex connector', kind: 'line', group: 'Line' },
  { id: 'ystrainer', label: 'Y-strainer', kind: 'line', group: 'Line' },
  { id: 'basket', label: 'Basket strainer', kind: 'line', group: 'Line' },
  { id: 'trap', label: 'Steam trap', kind: 'line', group: 'Line', short: 'T' },
  { id: 'flowmeter', label: 'Flow meter', kind: 'line', group: 'Line', short: 'FM' },
  { id: 'sightglass', label: 'Sight glass', kind: 'line', group: 'Line' },
  { id: 'spool', label: 'Spool break', kind: 'line', group: 'Line' },
  // elbows
  { id: 'lr', label: 'LR elbow', kind: 'elbow', group: 'Elbows', short: 'LR' },
  { id: 'sr', label: 'SR elbow', kind: 'elbow', group: 'Elbows', short: 'SR' },
  { id: 'r3', label: '3R bend', kind: 'elbow', group: 'Elbows', short: '3R' },
  { id: 'r5', label: '5R bend', kind: 'elbow', group: 'Elbows', short: '5R' },
  { id: 'miter', label: 'Mitered elbow', kind: 'elbow', group: 'Elbows', short: 'MITER' },
  { id: 'thd90', label: 'Threaded / SW elbow', kind: 'elbow', group: 'Elbows', short: 'THD' },
  // branches
  { id: 'tee', label: 'Straight tee', kind: 'branch', group: 'Branches', short: 'TEE' },
  { id: 'redtee', label: 'Reducing tee', kind: 'branch', group: 'Branches', short: 'RED TEE' },
  { id: 'weldolet', label: 'Weldolet', kind: 'branch', group: 'Branches', short: 'WOL' },
  { id: 'sockolet', label: 'Sockolet', kind: 'branch', group: 'Branches', short: 'SOL' },
  { id: 'threadolet', label: 'Threadolet', kind: 'branch', group: 'Branches', short: 'TOL' },
  { id: 'stubin', label: 'Stub-in', kind: 'branch', group: 'Branches', short: 'STUB-IN' },
  { id: 'lateral', label: 'Lateral', kind: 'branch', group: 'Branches', short: 'LAT' },
  // ends
  { id: 'open', label: 'Open end', kind: 'end', group: 'Ends' },
  { id: 'cap', label: 'Cap', kind: 'end', group: 'Ends' },
  { id: 'flange', label: 'Flange', kind: 'end', group: 'Ends' },
  { id: 'blind', label: 'Blind flange', kind: 'end', group: 'Ends' },
  { id: 'plug', label: 'Plug', kind: 'end', group: 'Ends' },
  { id: 'threaded', label: 'Threaded end', kind: 'end', group: 'Ends', short: 'THD' },
  { id: 'weld', label: 'Field weld / tie-in', kind: 'end', group: 'Ends', short: 'FW' },
  { id: 'nozzle', label: 'Equipment nozzle', kind: 'end', group: 'Ends' },
  { id: 'hose', label: 'Hose connection', kind: 'end', group: 'Ends', short: 'HC' },
  { id: 'gauge', label: 'Pressure gauge', kind: 'end', group: 'Ends', short: 'PI' },
  { id: 'thermowell', label: 'Thermowell', kind: 'end', group: 'Ends', short: 'TW' },
];
export const CATALOG_GROUPS = ['Valves', 'Line', 'Elbows', 'Branches', 'Ends'];
export const catalogItem = (id: string, kind?: ItemKind) => CATALOG.find((c) => c.id === id && (!kind || c.kind === kind));
export type Inline = string;
const LINE_IDS = CATALOG.filter((c) => c.kind === 'line');
export const INLINE_LABEL: Record<string, string> = { none: 'Pipe only', ...Object.fromEntries(LINE_IDS.map((c) => [c.id, c.label])) };
export type EndType = string;
export const END_LABEL: Record<string, string> = Object.fromEntries(CATALOG.filter((c) => c.kind === 'end').map((c) => [c.id, c.label]));

/** A fitting placed on a line, at fraction t (0–1) of the way along it. */
/** How fittings join the pipe. */
export type Conn = 'bw' | 'sw' | 'thd' | 'solder' | 'glue' | 'flg';
export const CONN_LABEL: Record<Conn, string> = { bw: 'Butt weld', sw: 'Socket weld', thd: 'Threaded', solder: 'Soldered', glue: 'Glued (solvent)', flg: 'Flanged' };
export const CONN_ORDER: Conn[] = ['bw', 'sw', 'thd', 'solder', 'glue', 'flg'];
export interface LineItem { id: string; type: string; t: number; conn?: Conn }

/** `move`: an invisible jump that starts a new, separate line at another point (no pipe, no cut). */
export interface Run { id: string; from: number; dx: number; dy: number; dz: number; inline: Inline; label?: string; meas?: Vec3; sketch?: boolean; items?: LineItem[]; move?: boolean }
/** Items on a run (older drawings kept a single `inline` item). */
export const runItems = (r: Run): LineItem[] => r.items ?? (r.inline && r.inline !== 'none' ? [{ id: r.id + '-i', type: r.inline, t: 0.5 }] : []);
export interface IsoNote { id: string; node: number; text: string }
export interface IsoDrawing {
  id: string; name: string; created: number; updated: number;
  nps: string; gap: number; // nominal size for take-outs, butt-weld root gap
  runs: Run[]; ends: Record<number, EndType>; notes: IsoNote[];
  /** Fitting chosen at an elbow or branch point (default: LR elbow / straight tee). */
  fits?: Record<number, string>;
  /** Default joint for the drawing's elbows, tees and straight joints, and per-point overrides. */
  conn?: Conn;
  nodeConn?: Record<number, Conn>;
}
export const connAt = (d: IsoDrawing, node: number): Conn => d.nodeConn?.[node] ?? d.conn ?? 'bw';

export type Vec3 = [number, number, number];
export const DIRS: Record<string, { v: Vec3; label: string }> = {
  N: { v: [0, 1, 0], label: 'North' }, S: { v: [0, -1, 0], label: 'South' },
  E: { v: [1, 0, 0], label: 'East' }, W: { v: [-1, 0, 0], label: 'West' },
  U: { v: [0, 0, 1], label: 'Up' }, D: { v: [0, 0, -1], label: 'Down' },
};

export function newDrawing(name: string, id: string): IsoDrawing {
  const now = Date.now();
  return { id, name, created: now, updated: now, nps: '4', gap: 0.125, runs: [], ends: {}, notes: [] };
}

/** Node coordinates: node 0 is the start; run i ends at node i + 1. */
export function nodePositions(d: IsoDrawing): Vec3[] {
  const p: Vec3[] = [[0, 0, 0]];
  d.runs.forEach((r, i) => {
    const a = p[r.from];
    if (!a) throw new CalcError('INPUT', `Run ${i + 1} starts from a node that does not exist.`);
    p[i + 1] = [a[0] + r.dx, a[1] + r.dy, a[2] + r.dz];
  });
  return p;
}

const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sketchVec = (r: Run): Vec3 => [r.dx, r.dy, r.dz];
/** True if the run has real dimensions (measured, or entered by length). */
export const isMeasured = (r: Run) => !!r.meas || !r.sketch;
/** Best known direction/length: the measurement when there is one, otherwise the sketch. */
export const runVec = (r: Run): Vec3 => r.meas ?? sketchVec(r);
export const runLength = (r: Run) => len(runVec(r));

export type NodeKind = { kind: 'start-end' | 'end' } | { kind: 'straight' } | { kind: 'elbow'; angle: number } | { kind: 'tee' } | { kind: 'cross' } | { kind: 'multi'; count: number };

/** Unit vectors pointing away from a node along each connected run. */
export function nodeLegs(d: IsoDrawing, node: number): Array<{ run: number; dir: Vec3 }> {
  const legs: Array<{ run: number; dir: Vec3 }> = [];
  d.runs.forEach((r, i) => {
    if (r.move) return;
    const v = runVec(r), L = len(v);
    if (L === 0) return;
    if (r.from === node) legs.push({ run: i, dir: [v[0] / L, v[1] / L, v[2] / L] });
    if (i + 1 === node) legs.push({ run: i, dir: [-v[0] / L, -v[1] / L, -v[2] / L] });
  });
  return legs;
}

export function nodeKind(d: IsoDrawing, node: number): NodeKind {
  const legs = nodeLegs(d, node);
  if (legs.length <= 1) return { kind: node === 0 || d.runs[node - 1]?.move ? 'start-end' : 'end' };
  if (legs.length === 2) {
    const c = Math.max(-1, Math.min(1, dot(legs[0].dir, legs[1].dir)));
    const between = rad2deg(Math.acos(c)); // 180 = straight through
    const bend = 180 - between;
    return bend < 0.05 ? { kind: 'straight' } : { kind: 'elbow', angle: bend };
  }
  if (legs.length === 3) return { kind: 'tee' };
  if (legs.length === 4) return { kind: 'cross' };
  return { kind: 'multi', count: legs.length };
}

export interface CutRow {
  run: number; travel: number; to1: number; to2: number; gaps: number; cut: number; note: string[]; ok: boolean; skip?: boolean;
}

/** Take-out at one end of a run, using ASME B16.9 fittings for the drawing's NPS and the fitting chosen at that point. */
function takeoutAt(d: IsoDrawing, node: number, run: number, note: string[]): { to: number; weld: boolean } {
  const k = nodeKind(d, node);
  const e = B169[d.nps];
  const fit = d.fits?.[node];
  const lbl = (id: string) => catalogItem(id)?.label ?? id;
  const conn = connAt(d, node);
  if (conn !== 'bw' && (k.kind === 'elbow' || k.kind === 'tee' || k.kind === 'cross')) {
    const what = k.kind === 'elbow' ? 'elbow' : k.kind;
    note.push(conn === 'flg' ? `flanged ${what}: subtract its center-to-face (and gasket)`
      : conn === 'thd' ? `threaded ${what}: subtract center-to-end, add thread makeup (Fittings tab)`
      : `${CONN_LABEL[conn].toLowerCase()} ${what}: subtract center-to-end, add socket depth (Fittings tab)`);
    return { to: 0, weld: false };
  }
  if (conn !== 'bw' && k.kind === 'straight') return { to: 0, weld: false };
  switch (k.kind) {
    case 'elbow': {
      const ang = k.angle;
      if (fit === 'anglevalve') { note.push('angle valve: subtract its center-to-face'); return { to: 0, weld: true }; }
      if (fit === 'thd90') { note.push('threaded / socket-weld elbow: use the Data tab take-out'); return { to: 0, weld: false }; }
      if (ang > 90.05) { note.push(`${ang.toFixed(1)}° turn needs two fittings — not deducted`); return { to: 0, weld: true }; }
      const n = npsNumber(d.nps);
      if (fit === 'r3' || fit === 'r5') {
        if (!n) { note.push(`no size for ${d.nps}"`); return { to: 0, weld: true }; }
        const R = (fit === 'r3' ? 3 : 5) * n;
        note.push(`${lbl(fit)} R = ${fit === 'r3' ? 3 : 5} × NPS = ${R}" (verify against the bend)`);
        return { to: R * Math.tan(deg2rad(ang / 2)), weld: true };
      }
      if (fit === 'sr') {
        if (!e?.sr90) { note.push(`no SR elbow data for ${d.nps}"`); return { to: 0, weld: true }; }
        if (Math.abs(ang - 90) < 0.05) return { to: e.sr90, weld: true };
        note.push(`${ang.toFixed(2)}° cut from an SR 90°`);
        return { to: e.sr90 * Math.tan(deg2rad(ang / 2)), weld: true };
      }
      if (!e) { note.push(`no elbow data for ${d.nps}"`); return { to: 0, weld: true }; }
      if (fit === 'miter') note.push('mitered elbow: take-out shown for R = 1.5 × NPS — see the Miter tool');
      if (Math.abs(ang - 90) < 0.05) return { to: e.lr90, weld: true };
      if (Math.abs(ang - 45) < 0.05 && fit !== 'miter') return { to: e.lr45, weld: true };
      if (fit !== 'miter') note.push(`${ang.toFixed(2)}° elbow cut from a 90° (ideal R·tan θ/2)`);
      return { to: e.lr90 * Math.tan(deg2rad(ang / 2)), weld: true };
    }
    case 'tee': case 'cross': {
      if (fit && fit !== 'tee') {
        // which legs are the header (straight through) and which is the branch
        const legs = nodeLegs(d, node);
        const me = legs.find((l) => l.run === run);
        const header = !!me && legs.some((l) => l !== me && dot(l.dir, me.dir) < -0.9999);
        if (fit === 'weldolet' || fit === 'sockolet' || fit === 'threadolet' || fit === 'stubin') {
          if (header) { note.push(`header runs straight through the ${lbl(fit).toLowerCase()} — one piece of pipe`); return { to: 0, weld: false }; }
          note.push(fit === 'stubin' ? 'stub-in: subtract ½ header OD' : `${lbl(fit).toLowerCase()}: subtract its height + ½ header OD (Data tab)`);
          return { to: 0, weld: fit !== 'threadolet' && fit !== 'sockolet' };
        }
        if (fit === 'redtee') {
          const c = bwFitting(d.nps).teeC;
          if (header && c != null) return { to: c, weld: true };
          note.push('reducing tee branch: subtract outlet M from the fitting'); return { to: 0, weld: true };
        }
        note.push(`${lbl(fit).toLowerCase()}: subtract per the fitting`);
        return { to: 0, weld: fit !== 'threeway' };
      }
      const c = bwFitting(d.nps).teeC;
      if (c == null) { note.push('no tee data'); return { to: 0, weld: true }; }
      return { to: c, weld: true };
    }
    case 'straight': return { to: 0, weld: true };
    default: {
      // run ends: a cap, weld-neck flange, nozzle or field weld is a butt weld; threaded / flanged items are not
      const end = d.ends[node] ?? 'open';
      return { to: 0, weld: conn === 'bw' && ['weld', 'cap', 'flange', 'nozzle'].includes(end) };
    }
  }
}

/** Cut list: center-to-center travel less fitting take-outs and a root gap at every butt weld. */
export function cutList(d: IsoDrawing): CutRow[] {
  return d.runs.map((r, i) => {
    if (r.move) return { run: i, travel: 0, to1: 0, to2: 0, gaps: 0, cut: 0, note: [], ok: true, skip: true };
    const note: string[] = [];
    const a = takeoutAt(d, r.from, i, note), b = takeoutAt(d, i + 1, i, note);
    if (!isMeasured(r)) return { run: i, travel: NaN, to1: a.to, to2: b.to, gaps: 0, cut: NaN, note: ['no dimension yet'], ok: false };
    const travel = runLength(r);
    const gaps = (a.weld ? d.gap : 0) + (b.weld ? d.gap : 0);
    for (const it of runItems(r)) if (it.type !== 'spool') note.push(`subtract the ${it.conn && it.conn !== 'bw' ? CONN_LABEL[it.conn].toLowerCase() + ' ' : ''}${(INLINE_LABEL[it.type] ?? it.type).toLowerCase()} length`);
    for (const n of [r.from, i + 1]) {
      const k = nodeKind(d, n).kind;
      if (k !== 'end' && k !== 'start-end') continue;
      const end = d.ends[n] ?? 'open';
      if (end === 'flange') note.push('flange end: subtract the flange length through hub if dimensioned to the face');
      if (end === 'cap') note.push('cap: subtract cap length E if dimensioned to the end of the cap');
      if (['relief', 'vent', 'drain', 'gauge', 'thermowell', 'hose'].includes(end)) note.push(`${END_LABEL[end].toLowerCase()} at the end: subtract its length if dimensioned to the end`);
    }
    const cut = travel - a.to - b.to - gaps;
    return { run: i, travel, to1: a.to, to2: b.to, gaps, cut, note, ok: cut > 0 };
  });
}

/** Isometric projection to screen (x right, y down): North up-right, East down-right, Up straight up. */
export function iso(p: Vec3): [number, number] {
  const c = Math.cos(Math.PI / 6), s = 0.5;
  return [(p[0] + p[1]) * c, (p[0] - p[1]) * s - p[2]];
}

// ---------------------------------------------------------------- 3D view
/** Orthographic view: az = camera azimuth (deg, from East toward North), el = elevation above horizontal (deg). */
export interface View { az: number; el: number }
/** The standard isometric view: East down-right, North up-right, Up straight up. */
export const ISO_VIEW: View = { az: -45, el: rad2deg(Math.atan(1 / Math.SQRT2)) };
export const VIEW_PRESETS: Array<{ id: string; label: string; v: View }> = [
  { id: 'iso', label: 'ISO', v: ISO_VIEW },
  { id: 'plan', label: 'Plan', v: { az: -90, el: 90 } },
  { id: 'north', label: 'Elev. N', v: { az: -90, el: 0 } },
  { id: 'east', label: 'Elev. E', v: { az: 0, el: 0 } },
];
const K = Math.sqrt(2 / 3); // so the ISO view matches isometric drawing scale (true lengths along axes)
export function viewBasis(v: View): { R: Vec3; U: Vec3; C: Vec3 } {
  const a = deg2rad(v.az), b = deg2rad(Math.max(-90, Math.min(90, v.el)));
  const C: Vec3 = [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)]; // toward the camera
  const R: Vec3 = [-Math.sin(a), Math.cos(a), 0];
  const U: Vec3 = [-Math.sin(b) * Math.cos(a), -Math.sin(b) * Math.sin(a), Math.cos(b)];
  return { R, U, C };
}
/** World → screen (x right, y down) for a view. With ISO_VIEW this equals iso(). */
export function project(p: Vec3, v: View): [number, number] {
  const { R, U } = viewBasis(v);
  return [dot(p, R) / K, -dot(p, U) / K];
}
/** Screen → the point on a plane (through `origin`, normal `n`) under that screen point, or null if the plane is edge-on. */
export function unproject(sx: number, sy: number, v: View, origin: Vec3, n: Vec3): Vec3 | null {
  const { R, U, C } = viewBasis(v);
  const q: Vec3 = [K * sx * R[0] - K * sy * U[0], K * sx * R[1] - K * sy * U[1], K * sx * R[2] - K * sy * U[2]];
  const cn = dot(C, n);
  if (Math.abs(cn) < 0.08) return null;
  const t = dot([origin[0] - q[0], origin[1] - q[1], origin[2] - q[2]], n) / cn;
  return [q[0] + t * C[0], q[1] + t * C[1], q[2] + t * C[2]];
}

/**
 * Node positions for display. Sketch: the drawn geometry. Scaled: measured runs at their true size, unmeasured runs
 * at the drawing's typical measured/drawn ratio (k).
 */
export function displayPositions(d: IsoDrawing, scaled: boolean): { P: Vec3[]; k: number; vecs: Vec3[] } {
  const ratios = d.runs.filter((r) => r.meas && len(sketchVec(r)) > 0).map((r) => len(r.meas!) / len(sketchVec(r))).sort((a, b) => a - b);
  const k = scaled && ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1;
  const vecs = d.runs.map((r): Vec3 => (scaled && r.meas ? r.meas : [r.dx * k, r.dy * k, r.dz * k]));
  const P: Vec3[] = [[0, 0, 0]];
  d.runs.forEach((r, i) => { const a = P[r.from] ?? [0, 0, 0]; const v = vecs[i]; P[i + 1] = [a[0] + v[0], a[1] + v[1], a[2] + v[2]]; });
  return { P, k, vecs };
}

/** Remove run i and every run that continues from it (directly or further down the line). */
export function deleteSubtree(d: IsoDrawing, i: number): IsoDrawing {
  const gone = new Set<number>([i]);
  let grew = true;
  while (grew) { grew = false; d.runs.forEach((r, j) => { if (!gone.has(j) && r.from > 0 && gone.has(r.from - 1)) { gone.add(j); grew = true; } }); }
  const nodeMap = new Map<number, number>([[0, 0]]);
  let k = 0;
  d.runs.forEach((_, j) => { if (!gone.has(j)) nodeMap.set(j + 1, ++k); });
  const runs = d.runs.filter((_, j) => !gone.has(j)).map((r) => ({ ...r, from: nodeMap.get(r.from)! }));
  const ends: Record<number, EndType> = {};
  Object.entries(d.ends).forEach(([n, e]) => { const m = nodeMap.get(Number(n)); if (m !== undefined) ends[m] = e; });
  const notes = d.notes.filter((t) => nodeMap.has(t.node)).map((t) => ({ ...t, node: nodeMap.get(t.node)! }));
  const fits: Record<number, string> = {};
  Object.entries(d.fits ?? {}).forEach(([n, f]) => { const m = nodeMap.get(Number(n)); if (m !== undefined) fits[m] = f; });
  return { ...d, runs, ends, notes, fits };
}

/** Human description of a run direction, e.g. "North", "Up 45° East". */
export function describeRun(r: Run): string {
  const parts: string[] = [];
  if (r.dy) parts.push(r.dy > 0 ? 'N' : 'S');
  if (r.dx) parts.push(r.dx > 0 ? 'E' : 'W');
  if (r.dz) parts.push(r.dz > 0 ? 'Up' : 'Down');
  const axes = [r.dx, r.dy, r.dz].filter((v) => v !== 0).length;
  if (axes <= 1) return ({ N: 'North', S: 'South', E: 'East', W: 'West', Up: 'Up', Down: 'Down' } as Record<string, string>)[parts[0]] ?? '—';
  return (axes === 2 ? 'Offset ' : 'Rolling ') + parts.join('-');
}
