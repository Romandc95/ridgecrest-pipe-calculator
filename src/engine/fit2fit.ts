// Fitting-to-fitting solver: a fixed-angle elbow (normally a 90°) rolled about its inlet axis, joined
// directly (face to face, with an explicit gap) to a second elbow trimmed to whatever angle is required,
// so that the outlet centerline lands a given distance from the inlet centerline. No pipe spool between.
//
// Coordinate system: X, Y horizontal, Z up. Elbow-1 inlet face centre is the origin.
// Each elbow is modelled by its tangent intersection point ("centre") and center-to-face (tangent) length T:
//   face₁ ──T── centre ──T── face₂. For an ideal elbow T = R·tan(angle/2).
import { CalcError, deg2rad, rad2deg } from './units';
import { Axis, AXES, Vec, dot, cross, norm, unit, addV, scaleV, angleBetween } from './layout';
import { arcs, Arcs } from './fittings';

export type SecondFitting =
  | { mode: 'trim'; R: number } // trimmed from a 90°: T₂ = R·tan(β/2); R = measured 90° center-to-face
  | { mode: 'fixed'; angle: number; cf: number }; // fixed manufactured angle with measured center-to-face

export interface F2FInput {
  inDir: Axis; // direction of flow entering elbow 1
  outDir: Axis; // required direction leaving elbow 2
  targetAxis: Axis; // axis along which the outlet centerline is displaced (e.g. '-Z' for a drop)
  target: number; // displacement magnitude along targetAxis, inches (> 0)
  e1Angle: number; // elbow-1 bend angle (90 for a standard 90°)
  e1CF: number; // elbow-1 measured center-to-face (tangent length), inches
  second: SecondFitting;
  gap: number; // joint gap between elbow-1 outlet face and elbow-2 inlet face
  od?: number; // optional pipe OD for trim arcs
}

export interface F2FSolution {
  roll: number; // ρ, degrees
  beta: number; // elbow-2 bend (retained) angle
  removed: number | null; // angle trimmed off a 90° (trim mode)
  T1: number; T2: number; R1: number; R2: number | null;
  travel: number; // elbow-1 centre to elbow-2 centre (= T1 + gap + T2)
  runInlet: number; // along inlet axis: elbow-1 inlet face → outlet centerline
  advanceOutlet: number; // along outlet axis: elbow-1 centre → elbow-2 outlet face
  lateral: number; // remaining perpendicular displacement (⊥ inlet axis and ⊥ target axis)
  separation: number; // achieved displacement along target axis
  clocking: number; // rotation of elbow-2 bend plane relative to elbow-1 bend plane, about the joint axis
  points: Record<'P0' | 'C1' | 'P1' | 'P1g' | 'C2' | 'P2', Vec>;
  dirs: { d0: Vec; d1: Vec; d2: Vec };
  trimArcs: Arcs | null;
}

export interface F2FResult { solutions: F2FSolution[]; warning: string | null; basis: { e1: Vec; n: Vec }; maxSeparation: number | null }

const EPS = 1e-9;

export function solveFittingToFitting(inp: F2FInput): F2FResult {
  const d0 = AXES[inp.inDir], d2 = AXES[inp.outDir], N = AXES[inp.targetAxis];
  if (!(inp.target > 0)) throw new CalcError('INPUT', 'Enter the required offset/drop as a positive distance; its direction is set by the axis.');
  if (!(inp.e1CF > 0)) throw new CalcError('INPUT', 'Enter elbow 1 center-to-face.');
  if (!(inp.e1Angle > 0 && inp.e1Angle <= 90)) throw new CalcError('INPUT', 'Elbow 1 angle must be greater than 0° and at most 90°.');
  if (!(inp.gap >= 0)) throw new CalcError('INPUT', 'Gap must be zero or positive.');
  if (Math.abs(dot(d0, N)) > EPS) {
    throw new CalcError('INPUT', `The displacement axis (${inp.targetAxis}) is along the inlet direction. A drop/offset must be measured perpendicular to the inlet line — choose a different axis or inlet direction.`);
  }
  if (Math.abs(dot(d2, N)) > EPS) {
    throw new CalcError('INPUT', `The outlet direction (${inp.outDir}) is parallel to the displacement axis, so "separation between the inlet and outlet lines" is not defined. Missing constraint: a specific point on the outlet line (e.g. where the outlet face must be).`);
  }
  if (inp.second.mode === 'trim' && !(inp.second.R > 0)) throw new CalcError('INPUT', 'Enter elbow 2 radius (its 90° center-to-face).');
  if (inp.second.mode === 'fixed' && (!(inp.second.cf > 0) || !(inp.second.angle > 0 && inp.second.angle <= 90))) throw new CalcError('INPUT', 'Enter elbow 2 fixed angle (0–90°) and center-to-face.');

  const alpha = deg2rad(inp.e1Angle);
  const T1 = inp.e1CF;
  const R1 = T1 / Math.tan(alpha / 2);
  // reference direction for roll = 0: toward the outlet direction's component perpendicular to inlet
  const p = addV(d2, scaleV(d0, -dot(d2, d0)));
  let e1: Vec;
  let ambiguous = false;
  if (norm(p) > EPS) e1 = unit(p);
  else { e1 = unit(cross(N, d0)); ambiguous = true; }
  // make e1 ⊥ N (N already ⊥ d0, d2 ⊥ N so p ⊥ N)
  const d1Of = (rho: number): Vec => addV(scaleV(d0, Math.cos(alpha)), scaleV(addV(scaleV(e1, Math.cos(rho)), scaleV(N, Math.sin(rho))), Math.sin(alpha)));
  const T2Of = (betaDeg: number) => (inp.second.mode === 'trim' ? inp.second.R * Math.tan(deg2rad(betaDeg / 2)) : inp.second.cf);

  const build = (rho: number): F2FSolution => {
    const d1 = d1Of(rho);
    const beta = angleBetween(d1, d2);
    const T2 = T2Of(beta);
    const P0: Vec = [0, 0, 0];
    const C1 = scaleV(d0, T1);
    const P1 = addV(C1, scaleV(d1, T1));
    const P1g = addV(P1, scaleV(d1, inp.gap));
    const C2 = addV(P1g, scaleV(d1, T2));
    const P2 = addV(C2, scaleV(d2, T2));
    const sep = dot(addV(C2, scaleV(C1, -1)), N);
    const lat = cross(d0, N); // remaining perpendicular axis
    const n1 = cross(d0, d1), n2 = cross(d1, d2);
    const clocking = norm(n1) < EPS || norm(n2) < EPS ? 0 : rad2deg(Math.atan2(dot(cross(n1, n2), unit(d1)), dot(n1, n2)));
    const R2 = inp.second.mode === 'trim' ? inp.second.R : null;
    return {
      roll: rad2deg(rho), beta, removed: inp.second.mode === 'trim' ? 90 - beta : null, T1, T2, R1, R2,
      travel: T1 + inp.gap + T2,
      runInlet: Math.abs(dot(d2, d0)) < EPS ? dot(C2, d0) : dot(P2, d0),
      advanceOutlet: dot(addV(P2, scaleV(C1, -1)), d2),
      lateral: dot(C2, lat), separation: sep, clocking,
      points: { P0, C1, P1, P1g, C2, P2 }, dirs: { d0, d1, d2 },
      trimArcs: R2 && inp.od ? arcs(R2, inp.od, beta) : null,
    };
  };

  const steps = 7200; // 0.05° scan, then bisection
  const rhoAt = (i: number) => -Math.PI + (2 * Math.PI * i) / steps;
  const sols: number[] = [];
  let maxSep: number | null = null;

  if (inp.second.mode === 'trim') {
    const g = (rho: number) => {
      const d1 = d1Of(rho);
      const beta = angleBetween(d1, d2);
      if (beta <= 1e-7 || beta > 90 + 1e-7) return NaN; // elbow 2 must be a real bend cut from a 90°
      const T2 = T2Of(beta);
      const s = (T1 + inp.gap + T2) * dot(d1, N);
      if (maxSep === null || s > maxSep) maxSep = s;
      return s - inp.target;
    };
    let prev = g(rhoAt(0));
    for (let i = 1; i <= steps; i++) {
      const cur = g(rhoAt(i));
      if (isFinite(prev) && isFinite(cur) && (prev === 0 || prev * cur < 0)) {
        let a = rhoAt(i - 1), b = rhoAt(i), ga = prev;
        for (let k = 0; k < 80; k++) { const m = (a + b) / 2, gm = g(m); if (ga * gm <= 0) b = m; else { a = m; ga = gm; } }
        sols.push((a + b) / 2);
      }
      prev = cur;
    }
  } else {
    const betaT = inp.second.angle;
    const h = (rho: number) => angleBetween(d1Of(rho), d2) - betaT;
    let prev = h(rhoAt(0));
    for (let i = 1; i <= steps; i++) {
      const cur = h(rhoAt(i));
      if (prev === 0 || prev * cur < 0) {
        let a = rhoAt(i - 1), b = rhoAt(i), ha = prev;
        for (let k = 0; k < 80; k++) { const m = (a + b) / 2, hm = h(m); if (ha * hm <= 0) b = m; else { a = m; ha = hm; } }
        sols.push((a + b) / 2);
      }
      prev = cur;
    }
  }

  // dedupe
  const uniq: number[] = [];
  for (const s of sols) if (!uniq.some((u) => Math.abs(u - s) < 1e-4)) uniq.push(s);
  let solutions = uniq.map(build);
  let warning: string | null = null;

  if (inp.second.mode === 'fixed') {
    const tol = 1 / 128;
    const matching = solutions.filter((s) => Math.abs(s.separation - inp.target) < tol);
    if (!matching.length) {
      const reach = solutions.filter((s) => s.separation > 0).map((s) => s.separation.toFixed(4) + '"');
      throw new CalcError('GEOM', `With a fixed ${inp.second.angle}° second fitting the roll is set by the directions alone, giving a displacement of ${reach.length ? reach.join(' or ') : 'none in the required direction'} — not ${inp.target}". The problem is over-constrained: use a trimmed second elbow, or let the drop be a result.`);
    }
    solutions = matching;
  }

  if (!solutions.length) {
    const max = maxSep as number | null;
    throw new CalcError('GEOM', max !== null && max > 0
      ? `No arrangement reaches ${inp.target}". The most these fittings can produce in that direction is ${max.toFixed(4)}" (elbow 1 rolled fully toward the drop, elbow 2 a full 90°). Add a spool between the fittings.`
      : 'No arrangement produces a displacement in that direction with these outlet directions.');
  }
  if (solutions.length > 1) {
    warning = ambiguous
      ? `${solutions.length} arrangements satisfy the inputs because the outlet runs parallel to the inlet: elbow 1 may be rolled to either side. Missing constraint: which side the lateral offset goes (or its size).`
      : `${solutions.length} arrangements satisfy the inputs. Missing constraint: specify which roll direction or the lateral offset.`;
  }
  return { solutions, warning, basis: { e1, n: N }, maxSeparation: maxSep };
}
