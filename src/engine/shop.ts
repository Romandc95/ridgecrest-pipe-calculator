// Shop layout tools: mitered (segmented) elbows, coping / fish-mouth templates, thermal expansion.
import { CalcError, deg2rad, rad2deg } from './units';

// =============================================================================== MITERS
export interface MiterResult {
  bend: number; welds: number; cutAngle: number; // α: each cut face is tilted α from square
  R: number; od: number; takeout: number;
  gore: { center: number; throat: number; heel: number } | null; // full middle segments (welds − 1 of them)
  end: { center: number; throat: number; heel: number }; // each end piece, measured from the tangent point
  gores: number; template: Array<{ deg: number; arc: number; offset: number }>;
}

/**
 * Segmented (mitered) bend of total angle B with n miter welds on centerline radius R.
 * Each weld turns B/n, so each cut face is tilted α = B/(2n) from square.
 * Middle gores (n − 1): centerline 2R·tanα, throat 2(R − OD/2)·tanα, heel 2(R + OD/2)·tanα.
 * End pieces: half a gore from the tangent point. Take-out (tangent point to intersection) = R·tan(B/2).
 * Cut template: offset from the square line = (OD/2)·cos φ·tanα, φ = 0 at the heel.
 */
export function miter(bendDeg: number, welds: number, R: number, od: number, divisions = 16): MiterResult {
  if (!(bendDeg > 0) || bendDeg >= 180) throw new CalcError('GEOM', 'Bend angle must be greater than 0° and less than 180°.');
  if (!Number.isInteger(welds) || welds < 1 || welds > 12) throw new CalcError('INPUT', 'Number of miter welds must be 1 to 12.');
  if (!(od > 0)) throw new CalcError('INPUT', 'Enter the pipe OD.');
  if (R < 0) throw new CalcError('INPUT', 'Radius must be zero or positive.');
  if (welds > 1 && R < od / 2) throw new CalcError('GEOM', `With ${welds} welds the centerline radius must be at least half the OD (${(od / 2).toFixed(3)}"), or the throat would fold over.`);
  const a = deg2rad(bendDeg / (2 * welds));
  const t = Math.tan(a);
  const piece = (k: number) => ({ center: k * R * t, throat: k * (R - od / 2) * t, heel: k * (R + od / 2) * t });
  const template = Array.from({ length: divisions + 1 }, (_, i) => {
    const phi = (2 * Math.PI * i) / divisions;
    return { deg: rad2deg(phi), arc: (od / 2) * phi, offset: (od / 2) * Math.cos(phi) * t };
  });
  return {
    bend: bendDeg, welds, cutAngle: rad2deg(a), R, od, takeout: R * Math.tan(deg2rad(bendDeg / 2)),
    gore: welds > 1 ? piece(2) : null, end: piece(1), gores: welds - 1, template,
  };
}

// =============================================================================== COPING / FISH-MOUTH
export interface CopeResult {
  points: Array<{ deg: number; arc: number; cutback: number }>; depth: number; circumference: number;
}
/**
 * Coping template for a branch of OD d meeting a header of OD D at angle θ between axes (90° = square tee),
 * with the branch axis offset e from the header axis (0 = centered). Cut-back is measured from the square
 * end of the branch (its longest points, the tips), around the branch OD. φ = 0 and 180° lie in the plane of the
 * header axis (the crotch / heel lines, for a lateral φ = 0 is the heel (obtuse side), 180° the crotch); φ = 90° and 270° are the sides.
 */
export function cope(headerOD: number, branchOD: number, thetaDeg: number, offset = 0, divisions = 16): CopeResult {
  const R = headerOD / 2, r = branchOD / 2;
  if (!(R > 0) || !(r > 0)) throw new CalcError('INPUT', 'Enter header and branch OD.');
  if (!(thetaDeg >= 15 && thetaDeg <= 90)) throw new CalcError('GEOM', 'Branch angle must be between 15° and 90°.');
  if (r + Math.abs(offset) > R + 1e-9) throw new CalcError('GEOM', 'The branch (plus any offset) is wider than the header, so it cannot sit on it. Use a reducing tee or a shaped saddle.');
  if (![8, 12, 16, 24, 32].includes(divisions)) throw new CalcError('INPUT', 'Divisions must be 8, 12, 16, 24 or 32.');
  const th = deg2rad(thetaDeg);
  const t = (phi: number) => {
    const yy = r * Math.sin(phi) + offset;
    return (Math.sqrt(Math.max(0, R * R - yy * yy)) - r * Math.cos(phi) * Math.cos(th)) / Math.sin(th);
  };
  const raw = Array.from({ length: divisions + 1 }, (_, i) => { const phi = (2 * Math.PI * i) / divisions; return { deg: rad2deg(phi), arc: r * phi, t: t(phi) }; });
  // fine scan for exact extremes
  let tmin = Infinity, tmax = -Infinity;
  for (let i = 0; i <= 3600; i++) { const v = t((2 * Math.PI * i) / 3600); tmin = Math.min(tmin, v); tmax = Math.max(tmax, v); }
  return { points: raw.map((p) => ({ deg: p.deg, arc: p.arc, cutback: p.t - tmin })), depth: tmax - tmin, circumference: Math.PI * branchOD };
}

// =============================================================================== THERMAL EXPANSION
export const EXPANSION_SOURCE = 'Engineering ToolBox, "Piping Materials - Temperature Expansion Coefficients" (in/in·°F ×10⁻⁶). Average linear coefficients; actual expansion of metals rises somewhat at high temperature — use ASME B31 Appendix C tables for design.';
export const EXPANSION_COEFF: Record<string, { label: string; perF: number }> = {
  carbon: { label: 'Carbon steel', perF: 6.5e-6 },
  stainless: { label: 'Stainless steel', perF: 9.9e-6 },
  copper: { label: 'Copper', perF: 9.3e-6 },
  aluminum: { label: 'Aluminum', perF: 12.8e-6 },
  castiron: { label: 'Cast iron', perF: 5.9e-6 },
  pvc: { label: 'PVC', perF: 28e-6 },
  cpvc: { label: 'CPVC', perF: 44e-6 },
  abs: { label: 'ABS', perF: 35e-6 },
  hdpe: { label: 'HDPE', perF: 67e-6 },
  pe: { label: 'PE', perF: 83e-6 },
};
/** ΔL = α · L · ΔT. Length in inches, temperatures in °F. Positive = growth. */
export function thermalExpansion(material: string, lengthIn: number, fromF: number, toF: number) {
  const m = EXPANSION_COEFF[material];
  if (!m) throw new CalcError('DATA', 'Unknown material.');
  if (!(lengthIn > 0)) throw new CalcError('INPUT', 'Enter a pipe length.');
  const dT = toF - fromF;
  const dL = m.perF * lengthIn * dT;
  return { dT, dL, perHundredFt: m.perF * 1200 * dT, coeff: m.perF };
}
