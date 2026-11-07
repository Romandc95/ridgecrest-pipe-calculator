// ISO sketch model: a pipe route as a tree of straight runs between nodes, in plant coordinates.
// x = East, y = North, z = Up (inches). Run lengths are centerline, fitting center to fitting center.
// Fittings are inferred at nodes (elbow / tee / cross / straight weld / end) and can be overridden at ends.
import { CalcError, deg2rad, rad2deg } from './units';
import { B169 } from './fittings';
import { bwFitting } from './refdata';

export type Inline = 'none' | 'gate' | 'globe' | 'check' | 'ball' | 'butterfly' | 'flange' | 'reducer' | 'union' | 'spool';
export const INLINE_LABEL: Record<Inline, string> = {
  none: 'Pipe only', gate: 'Gate valve', globe: 'Globe valve', check: 'Check valve', ball: 'Ball valve', butterfly: 'Butterfly valve',
  flange: 'Flange pair', reducer: 'Reducer', union: 'Union', spool: 'Spool break',
};
export type EndType = 'open' | 'cap' | 'flange' | 'blind' | 'plug' | 'weld';
export const END_LABEL: Record<EndType, string> = { open: 'Open end', cap: 'Cap', flange: 'Flange', blind: 'Blind flange', plug: 'Plug', weld: 'Field weld / tie-in' };

export interface Run { id: string; from: number; dx: number; dy: number; dz: number; inline: Inline; label?: string }
export interface IsoNote { id: string; node: number; text: string }
export interface IsoDrawing {
  id: string; name: string; created: number; updated: number;
  nps: string; gap: number; // nominal size for take-outs, butt-weld root gap
  runs: Run[]; ends: Record<number, EndType>; notes: IsoNote[];
}

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
export const runVec = (r: Run): Vec3 => [r.dx, r.dy, r.dz];
export const runLength = (r: Run) => len(runVec(r));

export type NodeKind = { kind: 'start-end' | 'end' } | { kind: 'straight' } | { kind: 'elbow'; angle: number } | { kind: 'tee' } | { kind: 'cross' } | { kind: 'multi'; count: number };

/** Unit vectors pointing away from a node along each connected run. */
export function nodeLegs(d: IsoDrawing, node: number): Array<{ run: number; dir: Vec3 }> {
  const legs: Array<{ run: number; dir: Vec3 }> = [];
  d.runs.forEach((r, i) => {
    const v = runVec(r), L = len(v);
    if (L === 0) return;
    if (r.from === node) legs.push({ run: i, dir: [v[0] / L, v[1] / L, v[2] / L] });
    if (i + 1 === node) legs.push({ run: i, dir: [-v[0] / L, -v[1] / L, -v[2] / L] });
  });
  return legs;
}

export function nodeKind(d: IsoDrawing, node: number): NodeKind {
  const legs = nodeLegs(d, node);
  if (legs.length <= 1) return { kind: node === 0 ? 'start-end' : 'end' };
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
  run: number; travel: number; to1: number; to2: number; gaps: number; cut: number; note: string[]; ok: boolean;
}

/** Take-out at one end of a run, using ASME B16.9 long-radius elbows / straight tees for the drawing's NPS. */
function takeoutAt(d: IsoDrawing, node: number, note: string[]): { to: number; weld: boolean } {
  const k = nodeKind(d, node);
  const e = B169[d.nps];
  switch (k.kind) {
    case 'elbow': {
      if (!e) { note.push(`no elbow data for ${d.nps}"`); return { to: 0, weld: true }; }
      if (k.angle > 90.05) { note.push(`${k.angle.toFixed(1)}° turn needs two fittings — not deducted`); return { to: 0, weld: true }; }
      if (Math.abs(k.angle - 90) < 0.05) return { to: e.lr90, weld: true };
      if (Math.abs(k.angle - 45) < 0.05) return { to: e.lr45, weld: true };
      note.push(`${k.angle.toFixed(2)}° elbow cut from a 90° (ideal R·tan θ/2)`);
      return { to: e.lr90 * Math.tan(deg2rad(k.angle / 2)), weld: true };
    }
    case 'tee': case 'cross': {
      const c = bwFitting(d.nps).teeC;
      if (c == null) { note.push('no tee data'); return { to: 0, weld: true }; }
      return { to: c, weld: true };
    }
    case 'straight': return { to: 0, weld: true };
    default: {
      // run ends: a cap, weld-neck flange or field weld is a butt weld; open ends, plugs and blinds are not
      const end = d.ends[node] ?? 'open';
      return { to: 0, weld: end === 'weld' || end === 'cap' || end === 'flange' };
    }
  }
}

/** Cut list: center-to-center travel less fitting take-outs and a root gap at every butt weld. */
export function cutList(d: IsoDrawing): CutRow[] {
  return d.runs.map((r, i) => {
    const note: string[] = [];
    const a = takeoutAt(d, r.from, note), b = takeoutAt(d, i + 1, note);
    const travel = runLength(r);
    const gaps = (a.weld ? d.gap : 0) + (b.weld ? d.gap : 0);
    if (r.inline !== 'none' && r.inline !== 'spool') note.push(`subtract the ${INLINE_LABEL[r.inline].toLowerCase()} length`);
    for (const n of [r.from, i + 1]) {
      const k = nodeKind(d, n).kind;
      if (k !== 'end' && k !== 'start-end') continue;
      const end = d.ends[n] ?? 'open';
      if (end === 'flange') note.push('flange end: subtract the flange length through hub if dimensioned to the face');
      if (end === 'cap') note.push('cap: subtract cap length E if dimensioned to the end of the cap');
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
