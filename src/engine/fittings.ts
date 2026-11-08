// Butt-weld elbow takeouts, arcs, cut lengths and elbow trimming.
// "Ideal circular bend": a torus segment of centerline radius R. Real fittings may differ; where a
// tabulated manufactured dimension exists (ASME B16.9 90° and 45° center-to-end) it is used instead.
import { CalcError, deg2rad } from './units';
import { DATASETS, NPS_VALUE } from './pipedata';

export type ElbowType = 'BW-L' | 'BW-S' | 'FC-L' | 'FC-S';
export const ELBOW_LABEL: Record<ElbowType, string> = {
  'BW-L': 'Butt weld, long radius (factory 90°/45°)',
  'BW-S': 'Butt weld, short radius (factory 90°)',
  'FC-L': 'Field-cut from long-radius 90°',
  'FC-S': 'Field-cut from short-radius 90°',
};
export const ELBOW_ORDER: ElbowType[] = ['BW-L', 'BW-S', 'FC-L', 'FC-S'];

// ASME B16.9 center-to-end, inches. LR90 'A' (= bend radius), LR45 'B', SR90 'A'.
export const B169: Record<string, { lr90: number; lr45: number; sr90?: number }> = {
  '1/2': { lr90: 1.50, lr45: 0.62 }, '3/4': { lr90: 1.12, lr45: 0.44 },
  '1': { lr90: 1.50, lr45: 0.88, sr90: 1.00 }, '1-1/4': { lr90: 1.88, lr45: 1.00, sr90: 1.25 },
  '1-1/2': { lr90: 2.25, lr45: 1.12, sr90: 1.50 }, '2': { lr90: 3.00, lr45: 1.38, sr90: 2.00 },
  '2-1/2': { lr90: 3.75, lr45: 1.75, sr90: 2.50 }, '3': { lr90: 4.50, lr45: 2.00, sr90: 3.00 },
  '3-1/2': { lr90: 5.25, lr45: 2.25, sr90: 3.50 }, '4': { lr90: 6.00, lr45: 2.50, sr90: 4.00 },
  '5': { lr90: 7.50, lr45: 3.12, sr90: 5.00 }, '6': { lr90: 9.00, lr45: 3.75, sr90: 6.00 },
  '8': { lr90: 12.00, lr45: 5.00, sr90: 8.00 }, '10': { lr90: 15.00, lr45: 6.25, sr90: 10.00 },
  '12': { lr90: 18.00, lr45: 7.50, sr90: 12.00 }, '14': { lr90: 21.00, lr45: 8.75, sr90: 14.00 },
  '16': { lr90: 24.00, lr45: 10.00, sr90: 16.00 }, '18': { lr90: 27.00, lr45: 11.25, sr90: 18.00 },
  '20': { lr90: 30.00, lr45: 12.50, sr90: 20.00 }, '24': { lr90: 36.00, lr45: 15.00, sr90: 24.00 },
};
export const B169_SOURCE = 'ASME B16.9 Factory-Made Wrought Buttwelding Fittings — center-to-end dimensions (LR 90° "A", LR 45° "B", SR 90° "A").';

export function steelOD(nps: string): number {
  const r = DATASETS.steel.rows.find((x) => x.nps === nps);
  if (!r) throw new CalcError('DATA', `No carbon-steel OD for NPS ${nps}.`);
  return r.od;
}

export interface Arcs { inside: number; center: number; outside: number }
/** Ideal circular-bend arcs for bend angle θ: (R ∓ OD/2)·θ. */
export function arcs(R: number, od: number, thetaDeg: number): Arcs {
  if (od / 2 > R) throw new CalcError('GEOM', 'Bend radius is smaller than half the OD — the inside arc would be negative.');
  const t = deg2rad(thetaDeg);
  return { inside: (R - od / 2) * t, center: R * t, outside: (R + od / 2) * t };
}

/** Ideal circular-bend tangent takeout: R·tan(θ/2). */
export function idealTakeout(R: number, thetaDeg: number): number {
  if (thetaDeg < 0 || thetaDeg > 90) throw new CalcError('GEOM', 'Bend angle must be 0°–90° for an elbow cut from a 90°.');
  return R * Math.tan(deg2rad(thetaDeg / 2));
}

export interface TakeoutResult {
  takeout: number; R: number; od: number; method: 'table90' | 'table45' | 'ideal';
  note: string; arcs: Arcs | null; source: string;
}

/** Takeout for an NPS butt-weld elbow at the given bend angle using B16.9 radii and carbon-steel OD. */
export function elbowTakeout(nps: string, thetaDeg: number, type: ElbowType): TakeoutResult {
  const row = B169[nps];
  if (!row) throw new CalcError('DATA', `No ASME B16.9 elbow data for NPS ${nps} (covered: ${Object.keys(B169).join(', ')}). Enter a known take-out instead.`);
  if (!(thetaDeg > 0) || thetaDeg > 90) throw new CalcError('GEOM', 'Bend angle must be greater than 0° and at most 90°.');
  const long = type === 'BW-L' || type === 'FC-L';
  const R = long ? row.lr90 : row.sr90;
  if (R === undefined) throw new CalcError('DATA', `ASME B16.9 has no short-radius elbow for NPS ${nps}.`);
  const od = steelOD(nps);
  const factory = type === 'BW-L' || type === 'BW-S';
  const a = arcs(R, od, thetaDeg);
  if (factory && Math.abs(thetaDeg - 90) < 1e-9) {
    return { takeout: R, R, od, method: 'table90', note: 'Factory 90° — ASME B16.9 center-to-end.', arcs: a, source: B169_SOURCE };
  }
  if (type === 'BW-L' && Math.abs(thetaDeg - 45) < 1e-9) {
    return { takeout: row.lr45, R, od, method: 'table45', note: `Factory LR 45° — ASME B16.9 center-to-end ${row.lr45}" (ideal R·tan 22.5° would be ${idealTakeout(R, 45).toFixed(3)}").`, arcs: a, source: B169_SOURCE };
  }
  return {
    takeout: idealTakeout(R, thetaDeg), R, od, method: 'ideal',
    note: `Ideal circular bend: R·tan(θ/2) with R = ${R}" (${long ? 'LR' : 'SR'} 90° center-to-end). Arcs use carbon-steel OD ${od}".`,
    arcs: a, source: B169_SOURCE,
  };
}

export interface CutLengthInput { travel: number; to1: number; to2: number; gap1: number; gap2: number }
export interface CutLengthResult { cut: number; deductions: Array<{ label: string; value: number }>; ok: boolean; message?: string }
/** Straight pipe cut length between two fittings: L − TO₁ − TO₂ − gap₁ − gap₂. */
export function cutLength(i: CutLengthInput): CutLengthResult {
  for (const [k, v] of Object.entries(i)) if (!(v >= 0) && v !== 0) throw new CalcError('INPUT', `${k} must be a non-negative number.`);
  const deductions = [
    { label: 'Fitting 1 take-out', value: i.to1 }, { label: 'Gap at joint 1', value: i.gap1 },
    { label: 'Fitting 2 take-out', value: i.to2 }, { label: 'Gap at joint 2', value: i.gap2 },
  ];
  const cut = i.travel - i.to1 - i.to2 - i.gap1 - i.gap2;
  if (cut < 0) {
    return { cut, deductions, ok: false, message: `Impossible arrangement: the fittings and gaps need ${(-cut).toFixed(4)}" more than the center-to-center travel. Increase the offset/run, use a smaller-radius fitting, or trim the fittings.` };
  }
  if (cut === 0) return { cut, deductions, ok: true, message: 'Zero cut length: the fittings meet directly (fitting-to-fitting).' };
  return { cut, deductions, ok: true };
}

export interface TrimResult {
  retained: number; removed: number; R: number; od: number;
  keepArcs: Arcs; removeArcs: Arcs; takeout: number;
}
/**
 * Trimming a 90° elbow to a retained angle β. Arcs are measured along the inside (throat), centerline and
 * outside (heel) from the factory end that is KEPT. The removed piece spans 90° − β from the other factory end.
 */
export function trimElbow(R: number, od: number, retainedDeg: number): TrimResult {
  if (!(retainedDeg > 0) || retainedDeg > 90) throw new CalcError('GEOM', 'Retained angle must be greater than 0° and at most 90°.');
  return {
    retained: retainedDeg, removed: 90 - retainedDeg, R, od,
    keepArcs: arcs(R, od, retainedDeg), removeArcs: arcs(R, od, 90 - retainedDeg), takeout: idealTakeout(R, retainedDeg),
  };
}

export function npsNumber(nps: string) { return NPS_VALUE[nps]; }

/** Pipe sizes in B16.9, smallest to largest (object keys alone put "2", "3" … ahead of "1/2", "1-1/4"). */
export const NPS_SORTED: string[] = Object.keys(B169).sort((a, b) => (npsNumber(a) ?? 0) - (npsNumber(b) ?? 0));
