// ISO sketch model: a pipe route as a tree of straight runs between nodes, in plant coordinates.
// x = East, y = North, z = Up (inches). Run lengths are centerline, fitting center to fitting center.
// Fittings are inferred at nodes (elbow / tee / cross / straight weld / end) and can be overridden at ends.
import { CalcError, deg2rad, rad2deg } from './units';
import { B169, npsNumber } from './fittings';
import { bwFitting, flange, nptMakeup, socketWeld, valveFaceToFace, FlangeClass, ValveType } from './refdata';

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
  { id: 'reducer', label: 'Reducer (end)', kind: 'end', group: 'Ends' },
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
/**
 * A fitting placed on a line, at fraction t (0–1) of the way along it.
 * len: your length (face-to-face / end-to-end), overriding the standard one. at: distance from the start of the line to its center.
 */
export interface LineItem { id: string; type: string; t: number; conn?: Conn; len?: number; at?: number; /** reducer: the size it reduces (or swages) to */ size?: string }
export const isReducer = (type: string) => type === 'reducer' || type === 'eccreducer' || type === 'swage';

/** `move`: an invisible jump that starts a new, separate line at another point (no pipe, no cut). */
export interface Run { id: string; from: number; dx: number; dy: number; dz: number; inline: Inline; label?: string; meas?: Vec3; sketch?: boolean; items?: LineItem[]; move?: boolean }
/** Items on a run (older drawings kept a single `inline` item). */
export const runItems = (r: Run): LineItem[] => r.items ?? (r.inline && r.inline !== 'none' ? [{ id: r.id + '-i', type: r.inline, t: 0.5 }] : []);
export interface IsoNote { id: string; node: number; text: string }
export interface IsoDrawing {
  id: string; name: string; created: number; updated: number;
  nps: string; gap: number; // nominal size for take-outs, butt-weld root gap
  /** Pipe schedule of the main size (default 40). */
  sch?: string;
  /** Settings for the other pipe sizes on the drawing (after reducers / reducing branches); unset = same as the main size. */
  sizeSpec?: Record<string, SizeSpec>;
  runs: Run[]; ends: Record<number, EndType>; notes: IsoNote[];
  /** Fitting chosen at an elbow or branch point (default: LR elbow / straight tee). */
  fits?: Record<number, string>;
  /** Default joint for the drawing's elbows, tees and straight joints, and per-point overrides. */
  conn?: Conn;
  nodeConn?: Record<number, Conn>;
  /** Optional branch size (NPS) for a reducing tee or olet at a point. */
  fitSize?: Record<number, string>;
  /** Flange pressure class used for flanged valve and flange lengths (default 150), and gasket thickness (default 1/8"). */
  cls?: FlangeClass;
  gasket?: number;
  /** Your take-off for the fitting at a line end (cap, flange, valve …), overriding the standard one. */
  endLen?: Record<number, number>;
  /** A valve / inline fitting sitting at a point where the line was broken (the point is a straight joint between two lines). */
  inl?: Record<number, LineItem>;
  /** Weld map: welder stencil, shop / field and notes per weld (keyed by weldList keys). */
  welds?: Record<string, WeldInfo>;
  /** Line ends joined onto another point (end node → the point it connects to): closes a loop / ties a new line back in. */
  links?: Record<number, number>;
  /** Title block details asked for when the drawing is named / completed. */
  info?: DrawingInfo;
  /** Free text placed on the drawing. */
  texts?: TextNote[];
  /** Finished: saved and locked (shown as the 11×17 sheet). */
  done?: boolean;
  doneAt?: number;
}
/** Per-size settings: joint, flange class, weld gap, gasket and schedule. */
export interface SizeSpec { conn?: Conn; cls?: number; gap?: number; gasket?: number; sch?: string }
export interface SizeSettings { conn: Conn; cls: number; gap: number; gasket: number; sch: string }
/** The settings that apply to a pipe size on this drawing. */
export function specFor(d: IsoDrawing, size: string): SizeSettings {
  const own = size === d.nps ? {} : d.sizeSpec?.[size] ?? {};
  return { conn: own.conn ?? d.conn ?? 'bw', cls: own.cls ?? d.cls ?? 150, gap: own.gap ?? d.gap, gasket: own.gasket ?? d.gasket ?? 0.125, sch: own.sch ?? d.sch ?? '40' };
}
/** The drawing as seen from one pipe size: take-outs, joints and allowances use that size's settings. */
export function sized(d: IsoDrawing, size: string | undefined): IsoDrawing {
  if (!size || size === d.nps) return d;
  const sp = specFor(d, size);
  return { ...d, nps: size, conn: sp.conn, cls: sp.cls as IsoDrawing['cls'], gap: sp.gap, gasket: sp.gasket, sch: sp.sch };
}
/** Pipe sizes on the drawing, main size first. */
export function drawingSizes(d: IsoDrawing): string[] {
  const sz = runSizes(d).filter((_, i) => !d.runs[i]?.move);
  return [d.nps, ...[...new Set(sz)].filter((z) => z !== d.nps)];
}
export interface DrawingInfo { customer?: string; site?: string; jobNo?: string; system?: string }
export interface WeldInfo { stencil?: string; field?: boolean; notes?: string }
/** Text on the drawing, anchored to a point (node) with an offset in sketch units so it follows the drawing. */
export interface TextNote { id: string; node: number; off: Vec3; text: string }
/** The inline fitting at a point, if that point is still a straight joint. */
export const inlineAt = (d: IsoDrawing, node0: number): LineItem | null => {
  const node = d.links?.[node0] ?? node0;
  const it = d.inl?.[node];
  if (!it) return null;
  const k = nodeKind(d, node).kind;
  // a reducer can also sit on the end of a line, or be welded straight onto the elbow where the line turns
  return k === 'straight' || (isReducer(it.type) && (k === 'end' || k === 'start-end' || k === 'elbow')) ? it : null;
};
export const connAt = (d: IsoDrawing, node: number): Conn => d.nodeConn?.[d.links?.[node] ?? node] ?? d.conn ?? 'bw';

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
/** Runs in an order where each run's start point is already placed (splitting a line can make a run start from a later point). */
export function runOrder(d: IsoDrawing): number[] {
  const placed = new Set<number>([0]);
  const order: number[] = [];
  let left = d.runs.map((_, i) => i);
  for (let pass = 0; left.length && pass <= d.runs.length; pass++) {
    const next: number[] = [];
    for (const i of left) { if (placed.has(d.runs[i].from)) { order.push(i); placed.add(i + 1); } else next.push(i); }
    if (next.length === left.length) break;
    left = next;
  }
  return order;
}

export function nodePositions(d: IsoDrawing): Vec3[] {
  const p: Vec3[] = [[0, 0, 0]];
  const order = runOrder(d);
  if (order.length !== d.runs.length) throw new CalcError('INPUT', 'A run starts from a point that does not exist.');
  for (const i of order) { const r = d.runs[i]; const a = p[r.from]; p[i + 1] = [a[0] + r.dx, a[1] + r.dy, a[2] + r.dz]; }
  return p;
}

/**
 * Split run i at fraction t (0–1) of its length, making a new point there. The first part becomes a new run
 * (index = old run count, ending at the new point); run i keeps its id and end point and now starts at the new point,
 * so anything already attached to its end stays attached. Measurements and fittings on the line are shared out.
 */
export function splitRun(d: IsoDrawing, i: number, t: number, newId: string): { d: IsoDrawing; node: number } {
  const r = d.runs[i];
  const node = d.runs.length + 1;
  const items = runItems(r);
  const first: Run = {
    id: newId, from: r.from, dx: r.dx * t, dy: r.dy * t, dz: r.dz * t, inline: 'none', sketch: r.sketch,
    ...(r.meas ? { meas: [r.meas[0] * t, r.meas[1] * t, r.meas[2] * t] as Vec3 } : {}),
    items: items.filter((it) => it.t < t).map((it) => ({ ...it, t: it.t / t })),
  };
  const rest: Run = {
    ...r, from: node, dx: r.dx * (1 - t), dy: r.dy * (1 - t), dz: r.dz * (1 - t), inline: 'none',
    ...(r.meas ? { meas: [r.meas[0] * (1 - t), r.meas[1] * (1 - t), r.meas[2] * (1 - t)] as Vec3 } : {}),
    items: items.filter((it) => it.t >= t).map((it) => ({ ...it, t: (it.t - t) / (1 - t) })),
  };
  return { d: { ...d, runs: [...d.runs.map((q, k) => (k === i ? rest : q)), first] }, node };
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
/** The point a node really is: a line end joined onto another point is that point. */
export const canon = (d: IsoDrawing, n: number): number => d.links?.[n] ?? n;
/** True for a line end that is joined onto another point (it is drawn and counted at that point). */
export const isLinked = (d: IsoDrawing, n: number): boolean => d.links?.[n] !== undefined;
export function nodeLegs(d: IsoDrawing, node: number): Array<{ run: number; dir: Vec3 }> {
  const legs: Array<{ run: number; dir: Vec3 }> = [];
  const c = canon(d, node);
  d.runs.forEach((r, i) => {
    if (r.move) return;
    const v = runVec(r), L = len(v);
    if (L === 0) return;
    if (canon(d, r.from) === c) legs.push({ run: i, dir: [v[0] / L, v[1] / L, v[2] / L] });
    if (canon(d, i + 1) === c) legs.push({ run: i, dir: [-v[0] / L, -v[1] / L, -v[2] / L] });
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

export interface CutPiece { from: string; to: string; cut: number; ok: boolean }
export interface CutRow {
  run: number; travel: number; to1: number; to2: number; gaps: number; cut: number; note: string[]; ok: boolean; skip?: boolean;
  /** When fittings sit on the line: the pipe pieces (spools) between them. */
  pieces?: CutPiece[];
}

/** Take-out at one end of a run, using ASME B16.9 fittings for the drawing's NPS and the fitting chosen at that point. */
function takeoutAt(d0: IsoDrawing, node0: number, run: number, note: string[], sizes?: string[]): { to: number; weld: boolean } {
  const node = canon(d0, node0);
  const d: IsoDrawing = sizes ? sized(d0, sizes[run] ?? d0.nps) : d0;
  const red = d0.inl?.[node];
  if (red && isReducer(red.type) && run === node - 1 && nodeKind(d0, node).kind === 'elbow') {
    // reducer welded onto the elbow: the line in loses the reducer and the (smaller) elbow's take-off
    const up: IsoDrawing = { ...d0, nps: sizes?.[node - 1] ?? d0.nps };
    const H = itemLength(up, red).len;
    const inl = { ...(d0.inl ?? {}) }; delete inl[node];
    const sz2 = sizes ? sizes.slice() : d0.runs.map(() => d0.nps); sz2[run] = red.size ?? up.nps;
    const el = takeoutAt({ ...d0, inl }, node, run, note, sz2);
    if (H === null) { note.push('enter the reducer length (tap it)'); return { to: NaN, weld: true }; }
    note.push(`reducer ${up.nps}"×${red.size ?? '?'}" (${frac(H)}) welded to the elbow`);
    return { to: el.to + H + d.gap, weld: true };
  }
  const dUp: IsoDrawing = sized(d0, (sizes ?? runSizes(d0))[node - 1] ?? d0.nps); // an inline fitting is the size (and class) of the line coming into it
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
  if (k.kind === 'straight') {
    const it = inlineAt(d, node);
    if (it) {
      // the line runs to the fitting's center; the pipe stops at its face / end, adjusted for the joint
      const L = itemLength(dUp, it), al = joinAllowance(dUp, it);
      const name = (INLINE_LABEL[it.type] ?? it.type).toLowerCase();
      // no length for it (e.g. a flow meter): the line is then measured to its face / end, so the cut doesn't need it
      if (L.len === null) { if (!note.some((n) => n.startsWith(name + ':'))) note.push(`${name}: measured to its ${itemRef(it) === 'F' ? 'face' : 'end'}${al.note ? '; ' + al.note : ''} (enter its length only if you need the overall)`); return { to: -al.v, weld: false }; }
      if (!note.some((n) => n.startsWith(name + ':'))) note.push(`${name}: ${L.src}${al.note ? '; ' + al.note : ''}`);
      return { to: L.len / 2 - al.v, weld: false };
    }
    if (conn !== 'bw') return { to: 0, weld: false };
  }
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
          const bs = d.fitSize?.[node];
          note.push(`reducing tee${bs ? ` ${d.nps}" × ${bs}"` : ''} branch: subtract outlet M from the fitting`); return { to: 0, weld: true };
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
      const it = inlineAt(d0, node);
      if (it) { // reducer on the end of a line: dimensioned to its small end
        const L = itemLength(d, it);
        if (L.len === null) { note.push('enter the reducer length (tap it)'); return { to: NaN, weld: false }; }
        note.push(`${(INLINE_LABEL[it.type] ?? it.type).toLowerCase()} at the end: ${L.src}`);
        return { to: L.len, weld: (it.conn ?? 'bw') === 'bw' };
      }
      const e2 = endTakeoff(d, node);
      if (e2 && e2.len !== null) note.push(`${END_LABEL[end].toLowerCase()} at the end: ${e2.src}`);
      return { to: e2?.len ?? 0, weld: conn === 'bw' && ['weld', 'cap', 'flange', 'blind', 'nozzle'].includes(end) };
    }
  }
}

/** Cut list: center-to-center travel less fitting take-outs and a root gap at every butt weld. */
export function cutList(d0: IsoDrawing): CutRow[] {
  const sizes = runSizes(d0);
  return d0.runs.map((r, i) => {
    if (r.move) return { run: i, travel: 0, to1: 0, to2: 0, gaps: 0, cut: 0, note: [], ok: true, skip: true };
    const note: string[] = [];
    const a = takeoutAt(d0, r.from, i, note, sizes), b = takeoutAt(d0, i + 1, i, note, sizes);
    const d = sized(d0, sizes[i]);
    if (!isMeasured(r)) return { run: i, travel: NaN, to1: a.to, to2: b.to, gaps: 0, cut: NaN, note: ['no dimension yet'], ok: false };
    const travel = runLength(r);
    const gaps = (a.weld ? d.gap : 0) + (b.weld ? d.gap : 0);

    for (const n of [r.from, i + 1]) {
      const k = nodeKind(d, n).kind;
      if (k !== 'end' && k !== 'start-end') continue;
      const end = d.ends[n] ?? 'open';
      if (endTakeoff(d, n)?.len === null) note.push(`${END_LABEL[end].toLowerCase()} at the end: enter its length (tap the point) if the line is dimensioned to its end`);
    }
    const items = runItems(r).slice().sort((x, y) => itemPos(r, x) - itemPos(r, y));
    if (!items.length) {
      const cut = travel - a.to - b.to - gaps;
      return { run: i, travel, to1: a.to, to2: b.to, gaps, cut, note, ok: cut > 0 };
    }
    // fittings on the line break it into spools: each piece runs between fitting faces / ends
    const pieces: CutPiece[] = [];
    let prevPos = 0, prevAllow = -a.to - (a.weld ? d.gap : 0), prevName = 'start';
    for (const it of items) {
      const L = itemLength(d, it);
      const al = joinAllowance(d, it);
      const pos = itemPos(r, it);
      const name = (INLINE_LABEL[it.type] ?? it.type).toLowerCase();
      if (L.len === null) note.push(`enter the ${name} length (tap it)`);
      else note.push(`${name}: ${L.src}${al.note ? '; ' + al.note : ''}`);
      const cut = L.len === null ? NaN : pos - L.len / 2 - prevPos + prevAllow + al.v;
      pieces.push({ from: prevName, to: name, cut, ok: cut > 0 });
      prevPos = L.len === null ? NaN : pos + L.len / 2; prevAllow = al.v; prevName = name;
    }
    const last = travel - prevPos + prevAllow - b.to - (b.weld ? d.gap : 0);
    pieces.push({ from: prevName, to: 'end', cut: last, ok: last > 0 });
    const total = pieces.reduce((t, q) => t + q.cut, 0);
    return { run: i, travel, to1: a.to, to2: b.to, gaps, cut: total, note, ok: pieces.every((q) => q.ok), pieces };
  });
}

const VALVE_TYPE: Record<string, ValveType> = { gate: 'gate', globe: 'globe', check: 'swing', liftcheck: 'globe', ball: 'ball' };
const safe = <T,>(f: () => T): T | null => { try { return f(); } catch { return null; } };
const frac = (x: number) => { const n = Math.round(x * 16); const w = Math.floor(n / 16), r = n % 16; if (!r) return `${w}"`; let a = r, b = 16; while (a % 2 === 0) { a /= 2; b /= 2; } return `${w ? w + '-' : ''}${a}/${b}"`; };

/** Length of a fitting on a line (face-to-face / end-to-end): yours if entered, else the standard one when there is data. */
export function itemLength(d: IsoDrawing, it: LineItem): { len: number | null; src: string } {
  if (it.len != null) return { len: it.len, src: `your length ${frac(it.len)}` };
  const cls = d.cls ?? 150, conn = it.conn ?? 'bw', gk = d.gasket ?? 0.125;
  if (it.type === 'spool') return { len: 0, src: 'field joint' };
  if (it.type === 'flange' || it.type === 'orifice') {
    const f = safe(() => flange(cls, d.nps));
    if (f) return { len: 2 * f.yWN + gk, src: `2 × WN flange ${frac(f.yWN)} + gasket ${frac(gk)} = ${frac(2 * f.yWN + gk)} (Class ${cls})${it.type === 'orifice' ? ' — check the orifice flange' : ''}` };
  }
  if (isReducer(it.type) && it.type !== 'swage') {
    const h = bwFitting(d.nps).reducerH;
    if (h != null) return { len: h, src: `B16.9 reducer H ${frac(h)}` };
  }
  if (conn === 'flg' && VALVE_TYPE[it.type]) {
    const v = safe(() => valveFaceToFace(cls, VALVE_TYPE[it.type], d.nps));
    if (v != null) return { len: v, src: `B16.10 Class ${cls} RF face-to-face ${frac(v)}` };
  }
  return { len: null, src: '' };
}

/** One piece of a dimensioned line between its end points and the faces of the fittings on it (positions in inches from the start). */
export interface Segment { a: number; b: number; len: number; kind: string; known: boolean; item?: string }
/** What a dimension measures to: C = fitting center, F = flange / flanged face, E = end (pipe end, cap, threaded, welded …). */
export type Ref = 'C' | 'F' | 'E';
export function nodeRef(d: IsoDrawing, node0: number): Ref {
  const node = canon(d, node0);
  const k = nodeKind(d, node).kind;
  if (k === 'elbow' || k === 'tee' || k === 'cross' || k === 'multi') return 'C';
  if (k === 'straight') { const it = inlineAt(d, node); return it ? itemRef(it) : 'E'; }
  const end = d.ends[node] ?? 'open';
  return end === 'flange' || end === 'blind' || end === 'nozzle' ? 'F' : 'E';
}
/** Which face of a line fitting the spools measure to. */
export const itemRef = (it: LineItem): Ref => (it.type !== 'flange' && it.type !== 'orifice' && it.type !== 'spool' && it.conn === 'flg' ? 'F' : 'E');
/** The reference pair for a whole line, e.g. "C-C", "C-F", "E-E". */
export const runRef = (d: IsoDrawing, i: number) => `${nodeRef(d, d.runs[i].from)}-${nodeRef(d, i + 1)}`;
/** Where an item's center is along its line (inches from the start point). */
export const itemPos = (r: Run, it: LineItem) => it.at ?? it.t * runLength(r);
/**
 * The spools of a dimensioned line with fittings on it, as drawn dimensions: start center → first fitting face (C-F),
 * face to face between fittings (F-F), last face → end center (F-C). null when the line has no fittings or no dimension.
 */
export function runSegments(d: IsoDrawing, i: number): Segment[] | null {
  const r = d.runs[i];
  if (!r || r.move || !isMeasured(r)) return null;
  const items = runItems(r).slice().sort((x, y) => itemPos(r, x) - itemPos(r, y));
  if (!items.length) return null;
  const travel = runLength(r);
  const segs: Segment[] = [];
  let prev = 0, prevKnown = true, prevRef: Ref = nodeRef(d, r.from);
  for (const it of items) {
    const L = itemLength(d, it).len;
    const pos = itemPos(r, it), half = (L ?? 0) / 2, ref = itemRef(it);
    segs.push({ a: prev, b: pos - half, len: pos - half - prev, kind: `${prevRef}-${ref}`, known: prevKnown && L !== null, item: it.id });
    prev = pos + half; prevKnown = L !== null; prevRef = ref;
  }
  segs.push({ a: prev, b: travel, len: travel - prev, kind: `${prevRef}-${nodeRef(d, i + 1)}`, known: prevKnown });
  return segs;
}

/** What each pipe end next to a line fitting gains (+) or loses (−) for its joint. */
export function joinAllowance(d: IsoDrawing, it: LineItem): { v: number; note: string } {
  const conn = it.type === 'flange' || it.type === 'orifice' || it.type === 'spool' ? 'bw' : (it.conn ?? 'bw');
  const gk = d.gasket ?? 0.125;
  switch (conn) {
    case 'bw': return { v: -d.gap, note: '' };
    case 'flg': {
      const f = safe(() => flange(d.cls ?? 150, d.nps));
      if (!f) return { v: 0, note: 'flanged: subtract mating flange + gasket' };
      return { v: -(gk + f.yWN + d.gap), note: `pipe ends in WN flanges (${frac(f.yWN)}) + gasket ${frac(gk)}` };
    }
    case 'thd': { const m = safe(() => nptMakeup(d.nps)); return m ? { v: m.makeup, note: `add thread makeup ${frac(m.makeup)}` } : { v: 0, note: 'add thread makeup' }; }
    case 'sw': { const w = safe(() => socketWeld(d.nps, 3000)); return w ? { v: w.engagement, note: `add socket engagement ${frac(w.engagement)}` } : { v: 0, note: 'add socket engagement' }; }
    default: return { v: 0, note: 'add socket / cup depth' };
  }
}

/** Take-off of the fitting at a line end, when the line is dimensioned to the end of that fitting. */
export function endTakeoff(d: IsoDrawing, node: number): { len: number | null; src: string } | null {
  const end = d.ends[node] ?? 'open';
  if (end === 'open' || end === 'weld') return null;
  const own = d.endLen?.[node];
  if (own != null) return { len: own, src: `your take-off ${frac(own)}` };
  const cls = d.cls ?? 150, gk = d.gasket ?? 0.125;
  if (end === 'cap') { const e = bwFitting(d.nps).capE; return e != null ? { len: e, src: `cap E ${frac(e)}` } : { len: null, src: '' }; }
  if (end === 'flange') { const f = safe(() => flange(cls, d.nps)); return f ? { len: f.yWN, src: `WN flange ${frac(f.yWN)} to face (Class ${cls})` } : { len: null, src: '' }; }
  if (end === 'blind') { const f = safe(() => flange(cls, d.nps)); return f ? { len: f.yWN + gk + f.tf, src: `WN flange ${frac(f.yWN)} + gasket + blind ${frac(f.tf)} (Class ${cls})` } : { len: null, src: '' }; }
  return { len: null, src: '' };
}

/**
 * Real-world direction a valve stem / handwheel points on a line: straight up off a level or sloped line
 * (square to the pipe), and toward the West off a vertical one — so it stays put when the view turns.
 */
export function stemDir(v: Vec3): Vec3 {
  const L = len(v) || 1; const u: Vec3 = [v[0] / L, v[1] / L, v[2] / L];
  const ref: Vec3 = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [-1, 0, 0];
  const k = dot(ref, u);
  const s: Vec3 = [ref[0] - k * u[0], ref[1] - k * u[1], ref[2] - k * u[2]];
  const sl = len(s) || 1;
  return [s[0] / sl, s[1] / sl, s[2] / sl];
}

/**
 * Pipe size of every line: the drawing's size, changed downstream of a reducer with a size set, and on the branch of a
 * reducing tee / olet with a branch size set.
 */
export function runSizes(d: IsoDrawing): string[] {
  const sz: string[] = [];
  for (const i of runOrder(d)) {
    const r = d.runs[i], n = r.from;
    const into = n - 1;
    if (r.move || n === 0 || into < 0 || d.runs[into]?.move) { sz[i] = d.nps; continue; }
    const up = sz[into] ?? d.nps;
    const it = d.inl?.[n];
    if (it && isReducer(it.type) && it.size) { sz[i] = it.size; continue; }
    const fit = d.fits?.[n], bs = d.fitSize?.[n];
    if (bs && fit && ['redtee', 'weldolet', 'sockolet', 'threadolet', 'stubin', 'lateral'].includes(fit)) {
      const legs = nodeLegs(d, n), me = legs.find((l) => l.run === i);
      const header = !!me && legs.some((l) => l !== me && dot(l.dir, me.dir) < -0.9999);
      if (!header) { sz[i] = bs; continue; }
    }
    sz[i] = up;
  }
  for (let i = 0; i < d.runs.length; i++) if (!sz[i]) sz[i] = d.nps;
  return sz;
}

/** How much of a line's center-to-center length is inside inline fittings at its ends (half of each fitting's length). */
export function faceAdj(d: IsoDrawing, i: number): number {
  const r = d.runs[i];
  let a = 0;
  const sizes = runSizes(d);
  for (const n of [r.from, i + 1]) { const it = inlineAt(d, n); if (it && nodeKind(d, n).kind === 'straight') a += (itemLength(sized(d, sizes[n - 1] ?? d.nps), it).len ?? 0) / 2; } // only a fitting sitting in a straight run splits the length at its center
  return a;
}
/** The length shown for a line: to the faces / ends of inline fittings, center elsewhere. */
export const shownLength = (d: IsoDrawing, i: number) => runLength(d.runs[i]) - faceAdj(d, i);

/** The two lines either side of a straight point: [into it, out of it]. */
export function sidesOf(d: IsoDrawing, node: number): [number, number] | null {
  const a = node - 1, b = d.runs.findIndex((r) => r.from === node && !r.move);
  return a >= 0 && b >= 0 && !d.runs[a].move ? [a, b] : null;
}

/** Join the two lines at a straight point back into one (removing what sat there). */
export function mergeAt(d: IsoDrawing, node: number): IsoDrawing {
  const sd = sidesOf(d, node); if (!sd) return d;
  const [ia, ib] = sd; const A = d.runs[ia], B = d.runs[ib];
  const both = isMeasured(A) && isMeasured(B);
  const ra = runVec(A), rb = runVec(B);
  const joined: Run = { ...A, dx: A.dx + B.dx, dy: A.dy + B.dy, dz: A.dz + B.dz, sketch: A.sketch || B.sketch,
    ...(both ? { meas: [ra[0] + rb[0], ra[1] + rb[1], ra[2] + rb[2]] as Vec3 } : {}), items: [...runItems(A), ...runItems(B)] };
  if (!both) delete joined.meas;
  const bEnd = ib + 1;
  // everything hanging off B's end now hangs off the joined line's end (A's end = node); then drop B and renumber
  let runs = d.runs.map((r, k) => (k === ia ? joined : r.from === bEnd ? { ...r, from: node } : r));
  const remap = (n: number) => (n === bEnd ? node : n > bEnd ? n - 1 : n);
  runs = runs.filter((_, k) => k !== ib).map((r) => ({ ...r, from: remap(r.from) }));
  const mapRec = <T,>(o: Record<number, T> | undefined, skip: number) => {
    const out: Record<number, T> = {};
    Object.entries(o ?? {}).forEach(([n, v]) => { const k = Number(n); if (k === skip) return; out[remap(k)] = v; });
    return out;
  };
  return { ...d, runs, ends: mapRec(d.ends, node), fits: mapRec(d.fits, node), nodeConn: mapRec(d.nodeConn, node), fitSize: mapRec(d.fitSize, node),
    endLen: mapRec(d.endLen, node), inl: mapRec(d.inl, node), notes: d.notes.filter((t) => t.node !== node).map((t) => ({ ...t, node: remap(t.node) })),
    ...(d.texts ? { texts: d.texts.map((t) => (t.node === node ? { ...t, node: remap(A.from) } : { ...t, node: remap(t.node) })) } : {}),
    links: Object.fromEntries(Object.entries(d.links ?? {}).filter(([n, t]) => Number(n) !== node && t !== node).map(([n, t]) => [remap(Number(n)), remap(t)])) };
}

// ---------------------------------------------------------------- offset angle
const isAxial = (v: Vec3) => { const L = len(v) || 1; return [0, 1, 2].filter((k) => Math.abs(v[k]) / L > 1e-6).length <= 1; };
/** The angled (offset) line at an elbow, and the line it turns off. */
export function offsetAt(d: IsoDrawing, node: number): { run: number; other: number } | null {
  const k = nodeKind(d, node);
  if (k.kind !== 'elbow') return null;
  const legs = nodeLegs(d, node);
  const diag = legs.filter((l) => !isAxial(runVec(d.runs[l.run])));
  if (!diag.length) return null;
  const pick = diag.find((l) => d.runs[l.run].from === node) ?? diag[0];
  const other = legs.find((l) => l !== pick)!;
  return { run: pick.run, other: other.run };
}
/**
 * Change the angle of an offset. The offset (set — how far it moves across, including any roll) stays the same;
 * the run along the line and the travel are worked out again for the new angle, and everything after it moves with it.
 */
export function setOffsetAngle(d: IsoDrawing, node: number, angle: number): IsoDrawing | null {
  if (!(angle > 0.5 && angle < 89.5)) return null;
  const at = offsetAt(d, node); if (!at) return null;
  const r = d.runs[at.run];
  // heading = the axis the offset runs along: the line it turns off if that line is square, else its biggest part
  const ov = runVec(d.runs[at.other]);
  const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const rv = runVec(r);
  let h: Vec3 | null = null;
  if (isAxial(ov)) { const a = axes.find((x) => Math.abs(dot(x, ov)) > 1e-6)!; if (Math.abs(dot(a, rv)) > 1e-6) h = a; }
  if (!h) h = axes.reduce((b, x) => (Math.abs(dot(x, rv)) > Math.abs(dot(b, rv)) ? x : b), axes[0]);
  const t = Math.tan((angle * Math.PI) / 180);
  const redo = (v: Vec3): Vec3 => {
    const along = dot(v, h!); const sgn = along < 0 ? -1 : 1;
    const o: Vec3 = [v[0] - h![0] * along, v[1] - h![1] * along, v[2] - h![2] * along];
    const set = len(o); if (set === 0) return v;
    const run = (set / t) * sgn;
    return [o[0] + h![0] * run, o[1] + h![1] * run, o[2] + h![2] * run];
  };
  const sk = redo([r.dx, r.dy, r.dz]);
  const runs = d.runs.map((x, i) => (i !== at.run ? x : { ...x, dx: sk[0], dy: sk[1], dz: sk[2], ...(x.meas ? { meas: redo(x.meas) } : {}) }));
  return { ...d, runs };
}

// ---------------------------------------------------------------- weld map
export interface Weld { key: string; node: number; run: number; side: 'a' | 'b'; conn: Conn; where: 'fitting' | 'inline' | 'joint' | 'end' | 'reducer' }
/** Flanged joints count as welds too: the pipe side is a weld-neck flange butt-welded to the pipe. */
const isWeldConn = (c: Conn) => c === 'bw' || c === 'sw' || c === 'flg';
const weldType = (c: Conn): Conn => (c === 'flg' ? 'bw' : c);
/**
 * Every weld on the drawing, in a stable order (by point, then line). A weld's key is the line's id + which end of it,
 * so weld records survive edits elsewhere on the drawing.
 */
/** Size of the fitting at a point: the pipe coming in (the smaller side when a reducer sits at an elbow). */
export function nodeSize(d: IsoDrawing, sizes: string[], n: number): string {
  const legs = nodeLegs(d, n);
  const into = n > 0 && !d.runs[n - 1]?.move && legs.some((l) => l.run === n - 1) ? n - 1 : -1;
  const red = inlineAt(d, n);
  if (red && into >= 0 && nodeKind(d, n).kind === 'elbow' && red.size) return red.size;
  if (into >= 0) return sizes[into] ?? d.nps;
  return legs.length ? sizes[legs[0].run] ?? d.nps : d.nps;
}
/** Joint at a point, using the default joint for the pipe size there. */
export const connAtSized = (d: IsoDrawing, sizes: string[], n0: number): Conn => { const n = canon(d, n0); return d.nodeConn?.[n] ?? specFor(d, nodeSize(d, sizes, n)).conn; };

export function weldList(d: IsoDrawing): Weld[] {
  const out: Weld[] = [];
  const sizes = runSizes(d);
  const side = (n: number, ri: number): 'a' | 'b' => (canon(d, d.runs[ri].from) === n ? 'a' : 'b');
  const push = (n: number, ri: number, conn: Conn, where: Weld['where'], suffix = '') => out.push({ key: `${d.runs[ri].id}:${side(n, ri)}${suffix}`, node: n, run: ri, side: side(n, ri), conn: weldType(conn), where });
  for (let n = 0; n <= d.runs.length; n++) {
    if (isLinked(d, n)) continue;
    const k = nodeKind(d, n).kind;
    const legs = nodeLegs(d, n);
    if (!legs.length) continue;
    const conn = connAtSized(d, sizes, n);
    if (k === 'elbow' || k === 'tee' || k === 'cross') {
      const fit = d.fits?.[n];
      const red = inlineAt(d, n);
      legs.forEach((l, j) => {
        const header = legs.some((m, q) => q !== j && dot(l.dir, m.dir) < -0.9999);
        let c: Conn | null = conn;
        if (fit === 'thd90') c = null;
        if (fit === 'weldolet' || fit === 'stubin') c = header ? null : 'bw';
        if (fit === 'sockolet') c = header ? null : 'sw';
        if (fit === 'threadolet') c = null;
        if (fit === 'miter') c = null;
        if (c && isWeldConn(c)) push(n, l.run, c, 'fitting');
        if (red && l.run === n - 1 && isWeldConn(red.conn ?? 'bw')) push(n, l.run, red.conn ?? 'bw', 'reducer', ':r');
      });
    } else if (k === 'straight') {
      const it = inlineAt(d, n);
      if (it) {
        const c: Conn = it.type === 'flange' || it.type === 'orifice' ? 'bw' : (it.conn ?? 'bw');
        if (['spool'].includes(it.type)) { push(n, n - 1, 'bw', 'joint'); continue; }
        if (['union', 'coupling', 'dielectric', 'swage', 'spectacle'].includes(it.type)) continue;
        if (isWeldConn(c)) legs.forEach((l) => push(n, l.run, c, 'inline'));
      } else if (isWeldConn(conn) && n >= 1 && !d.runs[n - 1]?.move) push(n, n - 1, conn, 'joint');
    } else if (k === 'end' || k === 'start-end') {
      const end = d.ends[n] ?? 'open';
      const red = inlineAt(d, n);
      const c = red ? red.conn ?? 'bw' : conn;
      if (end === 'weld') push(n, legs[0].run, 'bw', 'end');
      else if ((red || !['open', 'plug', 'threaded', 'hose', 'gauge', 'thermowell'].includes(end)) && isWeldConn(c)) push(n, legs[0].run, c, 'end');
    }
  }
  return out;
}

// ---------------------------------------------------------------- material breakdown
export interface MaterialRow { item: string; size: string; spec: string; qty: number; unit: string; /** points where this item is the fitting drawn (for item numbers on the drawing) */ nodes?: number[] }
/** Bill of materials: pipe by size, fittings, valves, flanges, gaskets, bolt sets and welds. */
export function materials(d: IsoDrawing): MaterialRow[] {
  const sizes = runSizes(d);
  const rows = new Map<string, MaterialRow>();
  const add = (item: string, size: string, spec: string, qty = 1, unit = 'ea') => {
    const k = `${item}|${size}|${spec}|${unit}`;
    const r = rows.get(k); if (r) r.qty += qty; else rows.set(k, { item, size, spec, qty, unit });
    return rows.get(k)!;
  };
  const addAt = (node: number, item: string, size: string, spec: string, qty = 1) => { const r = add(item, size, spec, qty); (r.nodes ??= []).push(node); };
  const clsOf = (z: string) => specFor(d, z).cls;
  const flanged = (size: string, n: number) => { add('WN flange', size, `Class ${clsOf(size)} RF`, n); };
  const joint = (size: string) => { add('Gasket', size, `Class ${clsOf(size)}`); add('Stud bolt set', size, `Class ${clsOf(size)}`); };
  // pipe: cut lengths by size (rounded up to the inch)
  const cuts = cutList(d);
  const pipe: Record<string, number> = {};
  cuts.forEach((c) => { if (c.skip) return; const v = c.pieces ? c.pieces.reduce((t, q) => t + (q.ok ? q.cut : 0), 0) : c.ok ? c.cut : 0; pipe[sizes[c.run]] = (pipe[sizes[c.run]] ?? 0) + v; });
  Object.entries(pipe).forEach(([z, v]) => { if (v > 0) add('Pipe', z, `Sch ${specFor(d, z).sch}`, Math.ceil(v) / 12, 'ft'); });
  for (let n = 0; n <= d.runs.length; n++) {
    if (isLinked(d, n)) continue;
    const k = nodeKind(d, n);
    const legs = nodeLegs(d, n); if (!legs.length) continue;
    const z = sizes[legs[0].run] ?? d.nps;
    const cn = connAtSized(d, sizes, n);
    const conn = CONN_LABEL[cn];
    const fit = d.fits?.[n];
    if ((k.kind === 'elbow' || k.kind === 'tee' || k.kind === 'cross') && cn === 'flg' && !['weldolet', 'sockolet', 'threadolet', 'stubin'].includes(fit ?? '')) {
      legs.forEach((l) => { const lz = sizes[l.run] ?? z; flanged(lz, 1); joint(lz); }); // flanged fitting: a WN flange on each pipe end
    }
    if (k.kind === 'elbow') {
      const red = inlineAt(d, n);
      const ez = red?.size ?? z;
      const typ = fit && !['anglevalve'].includes(fit) ? (catalogItem(fit)?.label ?? fit) : 'LR elbow';
      if (fit === 'anglevalve') addAt(n, 'Angle valve', z, conn);
      else addAt(n, `${typ} ${Math.abs(k.angle - 90) < 0.05 ? '90°' : Math.abs(k.angle - 45) < 0.05 ? '45°' : `${k.angle.toFixed(1)}° (cut)`}`, red ? ez : z, conn);
      if (red) addAt(n, red.type === 'eccreducer' ? 'Ecc. reducer' : 'Conc. reducer', `${sizes[n - 1] ?? d.nps}×${red.size ?? '?'}`, CONN_LABEL[red.conn ?? 'bw']);
    } else if (k.kind === 'tee' || k.kind === 'cross') {
      const hz = sizes[n - 1] ?? z, bs = d.fitSize?.[n];
      const typ = fit ? (catalogItem(fit)?.label ?? fit) : k.kind === 'cross' ? 'Cross' : 'Straight tee';
      addAt(n, typ, bs ? `${hz}×${bs}` : hz, conn);
    } else if (k.kind === 'straight') {
      const it = inlineAt(d, n);
      if (it) {
        const iz = sizes[n - 1] ?? z;
        const nm = INLINE_LABEL[it.type] ?? it.type;
        if (it.type === 'flange' || it.type === 'orifice') { addAt(n, 'WN flange', iz, `Class ${clsOf(iz)} RF`, 2); joint(iz); }
        else if (it.type !== 'spool') {
          addAt(n, nm, isReducer(it.type) && it.size ? `${iz}×${it.size}` : iz, CONN_LABEL[it.conn ?? 'bw']);
          if ((it.conn ?? 'bw') === 'flg') { flanged(iz, 2); joint(iz); joint(iz); }
        }
      }
    } else if (k.kind === 'end' || k.kind === 'start-end') {
      const end = d.ends[n] ?? 'open';
      const red = inlineAt(d, n);
      if (red) addAt(n, red.type === 'eccreducer' ? 'Ecc. reducer' : 'Conc. reducer', `${z}×${red.size ?? '?'}`, CONN_LABEL[red.conn ?? 'bw']);
      else if (end === 'flange') { addAt(n, 'WN flange', z, `Class ${clsOf(z)} RF`); joint(z); }
      else if (end === 'blind') { flanged(z, 1); addAt(n, 'Blind flange', z, `Class ${clsOf(z)} RF`); joint(z); }
      else if (end === 'nozzle') { if (cn === 'flg') { flanged(z, 1); joint(z); } }
      else if (!['open', 'weld'].includes(end)) addAt(n, END_LABEL[end] ?? end, z, conn);
    }
  }
  // legacy fittings sitting on lines
  d.runs.forEach((r, i) => runItems(r).forEach((it) => { if (it.type !== 'spool') add(INLINE_LABEL[it.type] ?? it.type, sizes[i], CONN_LABEL[it.conn ?? 'bw']); }));
  const welds = weldList(d);
  const bw = welds.filter((w) => w.conn === 'bw'), sw = welds.filter((w) => w.conn === 'sw');
  const fieldOf = (w: Weld) => !!d.welds?.[w.key]?.field;
  if (bw.length) { const f = bw.filter(fieldOf).length; if (bw.length - f) add('Butt weld', '', 'shop', bw.length - f); if (f) add('Butt weld', '', 'field', f); }
  if (sw.length) { const f = sw.filter(fieldOf).length; if (sw.length - f) add('Socket weld', '', 'shop', sw.length - f); if (f) add('Socket weld', '', 'field', f); }
  return [...rows.values()].filter((r) => r.qty > 0);
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
  for (const i of runOrder(d)) { const a = P[d.runs[i].from] ?? [0, 0, 0]; const v = vecs[i]; P[i + 1] = [a[0] + v[0], a[1] + v[1], a[2] + v[2]]; }
  for (let n = 0; n <= d.runs.length; n++) if (!P[n]) P[n] = [0, 0, 0];
  // a line end joined onto another point is drawn right on that point
  Object.entries(d.links ?? {}).forEach(([a, t]) => { if (P[t]) P[Number(a)] = P[t]; });
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
  const fitSize: Record<number, string> = {};
  Object.entries(d.fitSize ?? {}).forEach(([n, f]) => { const m = nodeMap.get(Number(n)); if (m !== undefined) fitSize[m] = f; });
  const nodeConn: Record<number, Conn> = {};
  Object.entries(d.nodeConn ?? {}).forEach(([n, f]) => { const m = nodeMap.get(Number(n)); if (m !== undefined) nodeConn[m] = f; });
  const inl: Record<number, LineItem> = {}; const endLen: Record<number, number> = {};
  Object.entries(d.inl ?? {}).forEach(([n, f]) => { const m = nodeMap.get(Number(n)); if (m !== undefined) inl[m] = f; });
  Object.entries(d.endLen ?? {}).forEach(([n, f]) => { const m = nodeMap.get(Number(n)); if (m !== undefined) endLen[m] = f; });
  const texts = d.texts?.filter((t) => nodeMap.has(t.node)).map((t) => ({ ...t, node: nodeMap.get(t.node)! }));
  const links: Record<number, number> = {};
  Object.entries(d.links ?? {}).forEach(([n, t]) => { const a = nodeMap.get(Number(n)), b = nodeMap.get(t); if (a !== undefined && b !== undefined) links[a] = b; });
  return { ...d, runs, ends, notes, fits, fitSize, nodeConn, inl, endLen, links, ...(texts ? { texts } : {}) };
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
