// PipeWorks Pro — unit constants and quantity model.
// All lengths are stored internally in inches (area in in², volume in in³).
// Values are kept at full double precision; rounding happens only in format.ts.

export const MM_PER_IN = 25.4; // exact by definition
export const IN_PER_FT = 12;
export const IN3_PER_GAL = 231; // US liquid gallon, exact
export const IN3_PER_L = 1000 / Math.pow(2.54, 3); // 61.0237440947...
export const KG_PER_LB = 0.45359237; // exact
export const N_PER_LBF = 4.4482216152605; // exact (lb × g0)
export const PA_PER_PSI = 6894.757293168361;
export const PA_PER_INHG = 3386.389; // conventional inch of mercury (0 °C)
export const G0 = 9.80665;
export const WATER_DENSITY_KGM3 = 1000; // reference calculator water property
export const PA_PER_FT_H2O = WATER_DENSITY_KGM3 * G0 * 0.3048; // ft of water head
export const LB_PER_FT3_WATER = 62.42796057614462; // 1000 kg/m³ expressed in lb/ft³
export const FT3_PER_M3 = 1 / Math.pow(0.3048, 3);
export const L_PER_FT3 = 28.316846592;
export const GPM_PER_CFS = (1728 / 231) * 60; // 448.8311688...

export type Kind = 'num' | 'len' | 'weight' | 'flow' | 'vel' | 'press' | 'force' | 'temp' | 'dens' | 'money';

/** Display units. For kind 'len' the dimension (1, 2, 3) is carried in `dim`. */
export type LenUnit = 'ftin' | 'ftdec' | 'infrac' | 'indec' | 'mm' | 'm';
export type AreaUnit = 'sqin' | 'sqft' | 'sqm';
export type VolUnit = 'cuin' | 'cuft' | 'cum' | 'gal' | 'L';
export type WeightUnit = 'lb' | 'kg';
export type FlowUnit = 'gpm' | 'cfm' | 'cfs' | 'lps' | 'm3s';
export type VelUnit = 'fps' | 'fpm' | 'mps';
export type PressUnit = 'psi' | 'psf' | 'inHg' | 'ftH2O' | 'bar' | 'kPa';
export type ForceUnit = 'lbf' | 'N';
export type TempUnit = 'F' | 'C';
export type DensUnit = 'pcf' | 'pci' | 'ppg' | 'kgm3' | 'kgL';
export type NumUnit = 'none' | 'deg' | 'dms' | 'pct';

export type Unit =
  | LenUnit | AreaUnit | VolUnit | WeightUnit | FlowUnit | VelUnit | PressUnit
  | ForceUnit | TempUnit | DensUnit | NumUnit | 'usd';

/**
 * A dimensioned quantity.
 *  - len: v in inches^dim (dim 1..3)
 *  - num: plain number (dim 0); unit gives display hint (deg, dms, pct)
 *  - weight: lb, flow: ft³/s, vel: ft/s, press: psi, force: lbf, temp: °F, dens: lb/ft³, money: $
 */
export interface Q {
  v: number;
  kind: Kind;
  dim: number;
  unit: Unit;
}

export const num = (v: number, unit: NumUnit = 'none'): Q => ({ v, kind: 'num', dim: 0, unit });
export const inches = (v: number, unit: LenUnit = 'infrac'): Q => ({ v, kind: 'len', dim: 1, unit });
export const len = (v: number, unit: LenUnit): Q => ({ v, kind: 'len', dim: 1, unit });

// ---- conversion factors to base -------------------------------------------------
export const LEN_TO_IN: Record<string, number> = {
  in: 1, ft: 12, yd: 36, mm: 1 / MM_PER_IN, cm: 10 / MM_PER_IN, m: 1000 / MM_PER_IN,
};
/** Exact-as-possible length conversions (divide/multiply by 25.4 rather than by its reciprocal). */
export function lenToIn(value: number, base: string): number {
  switch (base) {
    case 'mm': return value / MM_PER_IN;
    case 'cm': return (value * 10) / MM_PER_IN;
    case 'm': return (value * 1000) / MM_PER_IN;
    default: return value * LEN_TO_IN[base];
  }
}
export function inToLen(inches: number, base: string): number {
  switch (base) {
    case 'mm': return inches * MM_PER_IN;
    case 'cm': return (inches * MM_PER_IN) / 10;
    case 'm': return (inches * MM_PER_IN) / 1000;
    default: return inches / LEN_TO_IN[base];
  }
}
export const lenUnitBase = (u: LenUnit): string =>
  u === 'ftin' || u === 'ftdec' ? 'ft' : u === 'infrac' || u === 'indec' ? 'in' : u;

export const AREA_TO_IN2: Record<AreaUnit, number> = { sqin: 1, sqft: 144, sqm: Math.pow(1000 / MM_PER_IN, 2) };
export const VOL_TO_IN3: Record<VolUnit, number> = {
  cuin: 1, cuft: 1728, cum: Math.pow(1000 / MM_PER_IN, 3), gal: IN3_PER_GAL, L: IN3_PER_L,
};
export const WEIGHT_TO_LB: Record<WeightUnit, number> = { lb: 1, kg: 1 / KG_PER_LB };
export const FLOW_TO_CFS: Record<FlowUnit, number> = {
  cfs: 1, cfm: 1 / 60, gpm: 1 / GPM_PER_CFS, lps: 1 / L_PER_FT3, m3s: FT3_PER_M3,
};
export const VEL_TO_FPS: Record<VelUnit, number> = { fps: 1, fpm: 1 / 60, mps: 1 / 0.3048 };
export const PRESS_TO_PSI: Record<PressUnit, number> = {
  psi: 1, psf: 1 / 144, inHg: PA_PER_INHG / PA_PER_PSI, ftH2O: PA_PER_FT_H2O / PA_PER_PSI,
  bar: 1e5 / PA_PER_PSI, kPa: 1000 / PA_PER_PSI,
};
export const FORCE_TO_LBF: Record<ForceUnit, number> = { lbf: 1, N: 1 / N_PER_LBF };
export const DENS_TO_PCF: Record<DensUnit, number> = {
  pcf: 1, pci: 1728, ppg: 1728 / 231, kgm3: LB_PER_FT3_WATER / 1000, kgL: LB_PER_FT3_WATER,
};

export const UNIT_LABEL: Record<string, string> = {
  ftin: 'ft-in', ftdec: 'ft', infrac: 'in', indec: 'in', mm: 'mm', m: 'm',
  sqin: 'sq in', sqft: 'sq ft', sqm: 'sq m', cuin: 'cu in', cuft: 'cu ft', cum: 'cu m', gal: 'gal', L: 'L',
  lb: 'lb', kg: 'kg', gpm: 'gpm', cfm: 'cfm', cfs: 'cfs', lps: 'L/s', m3s: 'm³/s',
  fps: 'ft/s', fpm: 'ft/min', mps: 'm/s', psi: 'psi', psf: 'psf', inHg: 'inHg', ftH2O: 'ft head',
  bar: 'bar', kPa: 'kPa', lbf: 'lbf', N: 'N', F: '°F', C: '°C',
  pcf: 'lb/cu ft', pci: 'lb/cu in', ppg: 'lb/gal', kgm3: 'kg/m³', kgL: 'kg/L', usd: '$',
  none: '', deg: '°', dms: '', pct: '%',
};

/** Value of q expressed in its own display unit. */
export function inDisplayUnit(q: Q): number {
  switch (q.kind) {
    case 'len':
      if (q.dim === 1) return inToLen(q.v, lenUnitBase(q.unit as LenUnit));
      if (q.dim === 2) return q.v / AREA_TO_IN2[q.unit as AreaUnit];
      return q.v / VOL_TO_IN3[q.unit as VolUnit];
    case 'weight': return q.v / WEIGHT_TO_LB[q.unit as WeightUnit];
    case 'flow': return q.v / FLOW_TO_CFS[q.unit as FlowUnit];
    case 'vel': return q.v / VEL_TO_FPS[q.unit as VelUnit];
    case 'press': return q.v / PRESS_TO_PSI[q.unit as PressUnit];
    case 'force': return q.v / FORCE_TO_LBF[q.unit as ForceUnit];
    case 'temp': return q.unit === 'C' ? (q.v - 32) * 5 / 9 : q.v;
    case 'dens': return q.v / DENS_TO_PCF[q.unit as DensUnit];
    default: return q.v;
  }
}

/** Build a quantity from a value given in a named unit. */
export function fromUnit(value: number, unit: Unit, dimHint?: number): Q {
  if (unit in LEN_TO_IN || ['ftin', 'ftdec', 'infrac', 'indec'].includes(unit)) {
    const base = lenUnitBase(unit as LenUnit);
    const lu: LenUnit = base === 'ft' ? 'ftin' : base === 'in' ? (unit === 'indec' ? 'indec' : 'infrac') : (unit as LenUnit);
    return { v: lenToIn(value, base), kind: 'len', dim: 1, unit: lu };
  }
  if (unit in AREA_TO_IN2) return { v: value * AREA_TO_IN2[unit as AreaUnit], kind: 'len', dim: 2, unit };
  if (unit in VOL_TO_IN3) return { v: value * VOL_TO_IN3[unit as VolUnit], kind: 'len', dim: 3, unit };
  if (unit in WEIGHT_TO_LB) return { v: value * WEIGHT_TO_LB[unit as WeightUnit], kind: 'weight', dim: 0, unit };
  if (unit in FLOW_TO_CFS) return { v: value * FLOW_TO_CFS[unit as FlowUnit], kind: 'flow', dim: 0, unit };
  if (unit in VEL_TO_FPS) return { v: value * VEL_TO_FPS[unit as VelUnit], kind: 'vel', dim: 0, unit };
  if (unit in PRESS_TO_PSI) return { v: value * PRESS_TO_PSI[unit as PressUnit], kind: 'press', dim: 0, unit };
  if (unit in FORCE_TO_LBF) return { v: value * FORCE_TO_LBF[unit as ForceUnit], kind: 'force', dim: 0, unit };
  if (unit === 'F') return { v: value, kind: 'temp', dim: 0, unit };
  if (unit === 'C') return { v: value * 9 / 5 + 32, kind: 'temp', dim: 0, unit };
  if (unit in DENS_TO_PCF) return { v: value * DENS_TO_PCF[unit as DensUnit], kind: 'dens', dim: 0, unit };
  if (unit === 'usd') return { v: value, kind: 'money', dim: 0, unit };
  void dimHint;
  return num(value, unit as NumUnit);
}

export const fToC = (f: number) => (f - 32) * 5 / 9;
export const cToF = (c: number) => c * 9 / 5 + 32;
export const deg2rad = (d: number) => (d * Math.PI) / 180;
export const rad2deg = (r: number) => (r * 180) / Math.PI;

export class CalcError extends Error {
  code: 'DIM' | 'MATH' | 'ENT' | 'OFLO' | 'GEOM' | 'DATA' | 'INPUT';
  constructor(code: CalcError['code'], message: string) {
    super(message);
    this.code = code;
  }
}
