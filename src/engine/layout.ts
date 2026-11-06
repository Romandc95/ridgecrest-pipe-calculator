// Pipe layout geometry: simple offsets, rolling offsets, slope/grade/drop, cutbacks, combination offsets.
// Conventions (all lengths in inches, angles in degrees):
//   O = perpendicular offset (set), A = axial run (advance), L = center-to-center travel,
//   θ = bend (fitting) angle = change of direction at each fitting of a two-fitting offset.
import { CalcError, deg2rad, rad2deg } from './units';

export const LEN_TOL = 1 / 1024; // inches: tolerance for consistency checks
export const ANG_TOL = 0.005; // degrees

export interface SimpleInput { O?: number; A?: number; L?: number; theta?: number }
export interface SimpleResult { O: number; A: number; L: number; theta: number; given: string[]; formulas: string[] }

const has = (x: number | undefined | null): x is number => typeof x === 'number' && isFinite(x);

function checkPositive(name: string, v: number | undefined) {
  if (has(v) && v < 0) throw new CalcError('INPUT', `${name} must not be negative. Direction is shown on the diagram; enter magnitudes.`);
}

/** Solve a right-triangle offset from any two of O, A, L, θ. Detects insufficient and conflicting input. */
export function solveSimpleOffset(inp: SimpleInput): SimpleResult {
  const { O, A, L, theta } = inp;
  checkPositive('Offset', O); checkPositive('Run', A); checkPositive('Travel', L);
  if (has(theta) && (theta <= 0 || theta > 90)) {
    throw new CalcError('GEOM', 'Bend angle must be greater than 0° and no more than 90° for a two-fitting offset.');
  }
  const given = (['O', 'A', 'L', 'theta'] as const).filter((k) => has(inp[k]));
  if (given.length < 2) {
    throw new CalcError('INPUT', 'Need two of: Offset, Run, Travel, Angle. ' + (given.length ? `Only ${given.map(nameOf).join(', ')} given.` : 'Nothing entered yet.'));
  }
  // solve using the first valid pair, then verify any extra inputs agree
  let r: SimpleResult | null = null;
  const pairs: Array<[keyof SimpleInput, keyof SimpleInput]> = [
    ['O', 'A'], ['O', 'theta'], ['A', 'theta'], ['O', 'L'], ['A', 'L'], ['L', 'theta'],
  ];
  for (const [p, q] of pairs) {
    if (has(inp[p]) && has(inp[q])) { r = solvePair(p, q, inp); break; }
  }
  if (!r) throw new CalcError('INPUT', 'Insufficient input.');
  if (given.length > 2) {
    const bad: string[] = [];
    if (has(O) && Math.abs(O - r.O) > LEN_TOL) bad.push(`Offset ${O.toFixed(4)} ≠ ${r.O.toFixed(4)}`);
    if (has(A) && Math.abs(A - r.A) > LEN_TOL) bad.push(`Run ${A.toFixed(4)} ≠ ${r.A.toFixed(4)}`);
    if (has(L) && Math.abs(L - r.L) > LEN_TOL) bad.push(`Travel ${L.toFixed(4)} ≠ ${r.L.toFixed(4)}`);
    if (has(theta) && Math.abs(theta - r.theta) > ANG_TOL) bad.push(`Angle ${theta.toFixed(3)}° ≠ ${r.theta.toFixed(3)}°`);
    if (bad.length) throw new CalcError('INPUT', `Conflicting inputs — only two of Offset, Run, Travel, Angle are independent. With ${r.given.map(nameOf).join(' and ')}: ${bad.join('; ')}. Clear one field.`);
  }
  return r;
}

function nameOf(k: string) { return ({ O: 'Offset', A: 'Run', L: 'Travel', theta: 'Angle' } as Record<string, string>)[k] ?? k; }

function solvePair(p: keyof SimpleInput, q: keyof SimpleInput, inp: SimpleInput): SimpleResult {
  const key = [p, q].sort().join(',');
  let O = 0, A = 0, L = 0, th = 0;
  const f: string[] = [];
  switch (key) {
    case 'A,O': {
      O = inp.O!; A = inp.A!;
      if (O === 0 && A === 0) throw new CalcError('GEOM', 'Offset and Run are both zero — there is no pipe.');
      L = Math.hypot(A, O); th = rad2deg(Math.atan2(O, A));
      f.push('L = √(A² + O²)', 'θ = atan2(O, A)');
      break;
    }
    case 'O,theta': {
      O = inp.O!; th = inp.theta!;
      L = O / Math.sin(deg2rad(th)); A = th === 90 ? 0 : O / Math.tan(deg2rad(th));
      f.push('L = O / sin θ', 'A = O / tan θ');
      break;
    }
    case 'A,theta': {
      A = inp.A!; th = inp.theta!;
      if (th >= 90) throw new CalcError('GEOM', 'At 90° the run is zero for any offset, so Run and Angle cannot define the offset. Enter the Offset or Travel.');
      O = A * Math.tan(deg2rad(th)); L = A / Math.cos(deg2rad(th));
      f.push('O = A · tan θ', 'L = A / cos θ');
      break;
    }
    case 'L,O': {
      O = inp.O!; L = inp.L!;
      if (O > L + LEN_TOL) throw new CalcError('GEOM', 'Travel is shorter than the offset — impossible geometry.');
      A = Math.sqrt(Math.max(0, L * L - O * O)); th = rad2deg(Math.asin(Math.min(1, O / L)));
      f.push('A = √(L² − O²)', 'θ = asin(O / L)');
      break;
    }
    case 'A,L': {
      A = inp.A!; L = inp.L!;
      if (A > L + LEN_TOL) throw new CalcError('GEOM', 'Travel is shorter than the run — impossible geometry.');
      O = Math.sqrt(Math.max(0, L * L - A * A)); th = rad2deg(Math.acos(Math.min(1, A / L)));
      f.push('O = √(L² − A²)', 'θ = acos(A / L)');
      break;
    }
    case 'L,theta': {
      L = inp.L!; th = inp.theta!;
      O = L * Math.sin(deg2rad(th)); A = L * Math.cos(deg2rad(th));
      f.push('O = L · sin θ', 'A = L · cos θ');
      break;
    }
  }
  if (th <= 0 && O === 0) {
    // straight pipe: allowed but flag
  }
  return { O, A, L, theta: th, given: [p, q], formulas: f };
}

// ---------------- Rolling offset ----------------
export interface RollingInput {
  H?: number; // horizontal transverse displacement (signed: + toward reference side)
  V?: number; // vertical displacement (signed: + up)
  Ores?: number; // resultant (true) offset
  phi?: number; // offset-plane rotation from horizontal transverse axis, degrees
  A?: number; L?: number; theta?: number;
}
export interface RollingResult {
  H: number; V: number; Ores: number; phi: number; A: number; L: number; theta: number; formulas: string[];
}

/**
 * Rolling offset. Offset-plane rotation φ = atan2(V, H) is measured from the horizontal transverse axis
 * toward vertical (counter-clockwise looking downstream along the run, + up). It describes the plane
 * that contains both fittings' bends — NOT the clocking of a particular elbow on the pipe.
 */
export function solveRollingOffset(inp: RollingInput): RollingResult {
  const f: string[] = [];
  let H = inp.H, V = inp.V, Ores = inp.Ores, phi = inp.phi;
  const hv = has(H) && has(V);
  const op = has(Ores) && has(phi);
  if (hv) {
    Ores = Math.hypot(H!, V!);
    phi = rad2deg(Math.atan2(V!, H!));
    f.push('O = √(H² + V²)', 'φ = atan2(V, H)');
    if (has(inp.Ores) && Math.abs(inp.Ores - Ores) > LEN_TOL) throw new CalcError('INPUT', 'Conflicting inputs: the resultant offset does not equal √(H² + V²). Clear one.');
    if (has(inp.phi) && Math.abs(normAng(inp.phi - phi)) > ANG_TOL) throw new CalcError('INPUT', 'Conflicting inputs: the rotation does not equal atan2(V, H). Clear one.');
  } else if (op) {
    H = Ores! * Math.cos(deg2rad(phi!)); V = Ores! * Math.sin(deg2rad(phi!));
    f.push('H = O · cos φ', 'V = O · sin φ');
  } else if (has(H) || has(V)) {
    // one component plus resultant offset or travel/run combo
    const known = has(H) ? H! : V!;
    if (has(Ores)) {
      if (Math.abs(known) > Ores! + LEN_TOL) throw new CalcError('GEOM', 'A displacement component is larger than the resultant offset.');
      const other = Math.sqrt(Math.max(0, Ores! * Ores! - known * known));
      if (has(H)) V = other; else H = other;
      phi = rad2deg(Math.atan2(V!, H!));
      f.push('missing component = √(O² − known²) (taken as positive; reverse sign on the diagram if needed)');
    } else {
      // need the rest from simple offset solution
      const s = solveSimpleOffset({ A: inp.A, L: inp.L, theta: inp.theta });
      Ores = s.O;
      if (Math.abs(known) > Ores + LEN_TOL) throw new CalcError('GEOM', 'The given component exceeds the resultant offset implied by run/travel/angle.');
      const other = Math.sqrt(Math.max(0, Ores * Ores - known * known));
      if (has(H)) V = other; else H = other;
      phi = rad2deg(Math.atan2(V!, H!));
      f.push(...s.formulas.map((x) => x.replace(/\bO\b/g, 'O(res)')), 'missing component = √(O² − known²)');
      return { H: H!, V: V!, Ores, phi, A: s.A, L: s.L, theta: s.theta, formulas: f };
    }
  } else if (has(Ores)) {
    // resultant only, rotation unknown — still can solve travel; rotation reported as unknown
    const s = solveSimpleOffset({ O: Ores, A: inp.A, L: inp.L, theta: inp.theta });
    return { H: NaN, V: NaN, Ores: s.O, phi: NaN, A: s.A, L: s.L, theta: s.theta, formulas: s.formulas };
  } else {
    const s = solveSimpleOffset({ A: inp.A, L: inp.L, theta: inp.theta });
    return { H: NaN, V: NaN, Ores: s.O, phi: NaN, A: s.A, L: s.L, theta: s.theta, formulas: [...s.formulas, 'H, V unknown: enter both (or O and φ) to fix the plane'] };
  }
  const s = solveSimpleOffset({ O: Ores, A: inp.A, L: inp.L, theta: inp.theta });
  f.push('L = √(A² + H² + V²)', 'θ = atan2(O, A)');
  return { H: H!, V: V!, Ores: Ores!, phi: phi!, A: s.A, L: s.L, theta: s.theta, formulas: f };
}

const normAng = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

// ---------------- Slope / grade / drop ----------------
export interface SlopeResult { slopePerFt: number; angle: number; pctGrade: number; grade: number }
/** Slope expressed per 12 inches of run. */
export function slopeFromAngle(angleDeg: number): SlopeResult {
  if (angleDeg < 0 || angleDeg >= 90) throw new CalcError('GEOM', 'Slope angle must be at least 0° and less than 90°.');
  const g = Math.tan(deg2rad(angleDeg));
  return { slopePerFt: g * 12, angle: angleDeg, pctGrade: g * 100, grade: g };
}
export const angleFromSlopePerFt = (s: number) => rad2deg(Math.atan(s / 12));
export const angleFromGrade = (g: number) => rad2deg(Math.atan(g));
export function dropFromRunAndSlope(run: number, slopePerFt: number) { return (run * slopePerFt) / 12; }

// ---------------- Cutbacks ----------------
/** Parallel / concentric pipes turning through the same bend: cutback = spacing × tan(θ/2). */
export function parallelCutback(spacing: number, thetaDeg: number): number {
  if (thetaDeg <= 0 || thetaDeg >= 180) throw new CalcError('GEOM', 'Bend angle must be between 0° and 180°.');
  if (spacing < 0) throw new CalcError('INPUT', 'Spacing must not be negative.');
  return spacing * Math.tan(deg2rad(thetaDeg / 2));
}

// ---------------- Combination (3-D) offset ----------------
export type Axis = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';
export type Vec = [number, number, number];
export const AXES: Record<Axis, Vec> = { '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0], '+Z': [0, 0, 1], '-Z': [0, 0, -1] };
export const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: Vec) => Math.hypot(a[0], a[1], a[2]);
export const scaleV = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
export const addV = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const unit = (a: Vec): Vec => { const n = norm(a); if (n === 0) throw new CalcError('GEOM', 'Zero-length direction.'); return scaleV(a, 1 / n); };
export const angleBetween = (a: Vec, b: Vec) => rad2deg(Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))));

/**
 * Combination offset: pipe between two fitting centers displaced by (dx, dy, dz).
 * Entry fitting angle = angle between incoming direction and the pipe; exit = angle between pipe and outgoing direction.
 * Matches the reference guide's horizontal-to-vertical and horizontal-to-horizontal workflows.
 */
export function combinationOffset(d: Vec, inDir: Vec, outDir: Vec) {
  const L = norm(d);
  if (L === 0) throw new CalcError('GEOM', 'Fitting centers coincide.');
  const entry = angleBetween(inDir, d);
  const exit = angleBetween(d, outDir);
  return { L, entry, exit };
}
