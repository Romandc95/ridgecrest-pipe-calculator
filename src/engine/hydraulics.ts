// Flow, velocity, pressure, force and pressure loss.
// Pressure loss: Darcy–Weisbach Δp = f · (L/D) · ρV²/2 with water at ρ = 1000 kg/m³, μ = 0.001 Pa·s.
// Two friction-factor methods:
//  'standard' (default) — the Moody chart / Crane TP-410 basis: laminar f = 64/Re below Re 2 300, Colebrook–White
//    with the pipe's roughness for Re ≥ 2 300 (Re 2 300–4 000 is the transition zone and is flagged as uncertain).
//  'reference' — reproduces the reference calculator's worked examples: f = 64/Re below Re 3 000, Blasius smooth-pipe
//    f = 0.3164·Re^-0.25 to Re 100 000, then Kármán–Prandtl smooth unless roughness exceeds the viscous sublayer
//    (then Colebrook). It ignores roughness below Re 100 000, so for commercial steel it reads ~20 % low (audit C2).
import { CalcError, GPM_PER_CFS, PA_PER_PSI, PRESS_TO_PSI, PressUnit } from './units';

export const WATER = { rho: 1000, mu: 0.001 }; // kg/m³, Pa·s

/** Q (ft³/s) = V (ft/s) · A (ft²). Area given in in². */
export const flowFrom = (vFps: number, areaIn2: number) => vFps * (areaIn2 / 144);
export function velocityFrom(qCfs: number, areaIn2: number) {
  if (areaIn2 <= 0) throw new CalcError('MATH', 'Area must be greater than zero.');
  return qCfs / (areaIn2 / 144);
}
export function areaFromFlow(qCfs: number, vFps: number) {
  if (vFps === 0) throw new CalcError('MATH', 'Velocity is zero — division by zero.');
  return (qCfs / vFps) * 144;
}
export const forceFrom = (psi: number, areaIn2: number) => psi * areaIn2;
export function pressureFrom(lbf: number, areaIn2: number) {
  if (areaIn2 === 0) throw new CalcError('MATH', 'Area is zero — division by zero.');
  return lbf / areaIn2;
}
export function areaFromForce(lbf: number, psi: number) {
  if (psi === 0) throw new CalcError('MATH', 'Pressure is zero — division by zero.');
  return lbf / psi;
}
export const gpmToCfs = (g: number) => g / GPM_PER_CFS;

export function circle(diameter: number) {
  return { area: (Math.PI / 4) * diameter * diameter, circumference: Math.PI * diameter };
}

export type LossMethod = 'standard' | 'reference';
export const LOSS_METHOD_LABEL: Record<LossMethod, string> = { standard: 'Standard (Colebrook–White)', reference: 'Reference calculator' };

export interface FrictionResult { f: number; method: string }
/** Colebrook–White, solved by fixed-point iteration from the Swamee–Jain estimate (converges to < 1e-12). */
export function colebrook(Re: number, relRough: number): number {
  let f = 0.25 / Math.pow(Math.log10(relRough / 3.7 + 5.74 / Math.pow(Re, 0.9)), 2);
  for (let i = 0; i < 100; i++) {
    const next = Math.pow(-2 * Math.log10(relRough / 3.7 + 2.51 / (Re * Math.sqrt(f))), -2);
    if (Math.abs(next - f) < 1e-14) return next;
    f = next;
  }
  return f;
}
export function frictionFactor(Re: number, relRough: number, D_m: number, V: number, method: LossMethod = 'standard'): FrictionResult {
  if (!(Re > 0)) throw new CalcError('MATH', 'No flow — Reynolds number is zero.');
  if (!(relRough >= 0)) throw new CalcError('INPUT', 'Pipe roughness must be zero or positive.');
  if (method === 'standard') {
    if (Re < 2300) return { f: 64 / Re, method: 'Laminar: f = 64/Re' };
    const f = colebrook(Re, relRough);
    if (Re < 4000) return { f, method: 'Transition zone (Re 2 300–4 000): Colebrook–White shown — the real loss is uncertain here' };
    return { f, method: 'Colebrook–White (turbulent, with pipe roughness)' };
  }
  if (Re < 3000) return { f: 64 / Re, method: 'Laminar: f = 64/Re' };
  if (Re <= 100000) return { f: 0.3164 * Math.pow(Re, -0.25), method: 'Blasius (smooth): f = 0.3164·Re^−0.25 — reference-calculator method' };
  // smooth Kármán–Prandtl
  let f = 0.02;
  for (let i = 0; i < 60; i++) f = Math.pow(1 / (2 * Math.log10(Re * Math.sqrt(f)) - 0.8), 2);
  const nu = WATER.mu / WATER.rho;
  const uStar = V * Math.sqrt(f / 8);
  const sublayer = (5 * nu) / uStar; // m
  const eps = relRough * D_m;
  if (eps <= sublayer) return { f, method: 'Kármán–Prandtl smooth pipe — reference-calculator method' };
  return { f: colebrook(Re, relRough), method: 'Colebrook–White (roughness exceeds viscous sublayer) — reference-calculator method' };
}

export interface PressureLoss {
  Re: number; f: number; method: string; lossMethod: LossMethod; velocityFps: number;
  psi: number; perFoot: boolean; units: Record<PressUnit, number>;
}
/** Pressure loss for water in a pipe of inside diameter idIn (in), flow qCfs, over lengthFt (null = per foot). */
export function pressureLoss(idIn: number, qCfs: number, roughnessFt: number, lengthFt: number | null, method: LossMethod = 'standard'): PressureLoss {
  if (!(idIn > 0)) throw new CalcError('DATA', 'Pipe inside diameter is required — select a pipe size or enter ID.');
  if (!(qCfs > 0)) throw new CalcError('INPUT', 'Enter a flow rate (or velocity) greater than zero.');
  const D = idIn * 0.0254;
  const A = (Math.PI / 4) * D * D;
  const V = (qCfs * 0.028316846592) / A;
  const Re = (WATER.rho * V * D) / WATER.mu;
  const fr = frictionFactor(Re, (roughnessFt * 0.3048) / D, D, V, method);
  const perM = (fr.f * WATER.rho * V * V) / (2 * D); // Pa/m
  const L = lengthFt === null ? 1 : lengthFt;
  const pa = perM * L * 0.3048;
  const psi = pa / PA_PER_PSI;
  const units = Object.fromEntries(Object.entries(PRESS_TO_PSI).map(([k, f]) => [k, psi / f])) as Record<PressUnit, number>;
  return { Re, f: fr.f, method: fr.method, lossMethod: method, velocityFps: V / 0.3048, psi, perFoot: lengthFt === null, units };
}
