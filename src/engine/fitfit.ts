// Fit-Fit: an offset made with two equal elbows of radius R, each cut to θ (one turns out, one turns back), either
// welded fitting to fitting or with a straight pipe piece between them. All lengths in inches.
//   L = straight between the elbow faces (root gaps + any pipe piece)
//   O = 2R(1 − cos θ) + L·sin θ
//   θ = atan2(2R, L) + asin((O − 2R) / √(L² + 4R²))     (θ ≤ 90°)
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const sinD = (a: number) => Math.sin(a * D2R), cosD = (a: number) => Math.cos(a * D2R), tanD = (a: number) => Math.tan(a * D2R);

export const offsetOf = (R: number, L: number, t: number) => 2 * R * (1 - cosD(t)) + L * sinD(t);
export function solveTheta(R: number, L: number, O: number): number {
  const A = Math.hypot(L, 2 * R), x = (O - 2 * R) / A;
  if (x > 1 || x < -1) return NaN;
  return Math.atan2(2 * R, L) * R2D + Math.asin(x) * R2D;
}

export type FitFitMode = 'f2f' | 'pipeLen' | 'pipeAng';
export interface FitFitIn { R: number; od: number | null; O: number; g: number; mode: FitFitMode; pipeLen?: number; angle?: number }
export interface FitFitSol { theta: number; C: number; L: number; T: number; run: number; ccRun: number; pipe: number; mode: FitFitMode; marks: { heel: number; cl: number; throat: number; ro: number } | null }
export interface FitFitMsg { lvl: 'err' | 'warn' | 'info'; msg: string; tooMuch?: { p90: number; p45: number; reach: number } }

/** Solve the offset; returns the solution or a problem message. Lengths in the messages are left to the caller to format. */
export function fitFit(i: FitFitIn): { sol: FitFitSol | null; W: FitFitMsg[] } {
  const { R, O, g, od } = i, W: FitFitMsg[] = [];
  let theta: number, L: number, pipe = 0;
  if (i.mode === 'f2f') {
    L = g;
    if (O > 2 * R + L + 1e-9) {
      W.push({ lvl: 'err', msg: 'tooMuch', tooMuch: { reach: 2 * R + L, p90: O - 2 * R - 2 * g, p45: (O - offsetOf(R, 0, 45)) / sinD(45) - 2 * g } });
      return { sol: null, W };
    }
    theta = solveTheta(R, L, O);
  } else if (i.mode === 'pipeLen') {
    pipe = i.pipeLen!; L = pipe + 2 * g;
    if (O > 2 * R + L + 1e-9) { W.push({ lvl: 'err', msg: 'tooShort', tooMuch: { reach: 2 * R + L, p90: O - 2 * R - 2 * g, p45: 0 } }); return { sol: null, W }; }
    theta = solveTheta(R, L, O);
  } else {
    const a = i.angle!;
    if (!(a > 0 && a <= 90)) { W.push({ lvl: 'err', msg: 'The elbow angle must be more than 0° and no more than 90°.' }); return { sol: null, W }; }
    theta = a; L = (O - offsetOf(R, 0, a)) / sinD(a); pipe = L - 2 * g;
    if (pipe < 0) { W.push({ lvl: 'err', msg: 'overlap', tooMuch: { reach: -pipe, p90: solveTheta(R, g, O), p45: 0 } }); return { sol: null, W }; }
  }
  if (!(theta > 0) || !isFinite(theta)) { W.push({ lvl: 'err', msg: 'No angle fits these numbers. Check the offset and the pipe length.' }); return { sol: null, W }; }
  const C = R * tanD(theta / 2), T = 2 * C + L, run = 2 * R * sinD(theta) + L * cosD(theta), ccRun = T * cosD(theta), tr = theta * D2R;
  let marks: FitFitSol['marks'] = null;
  if (od && theta < 89.99) {
    const ro = od / 2; marks = { heel: (R + ro) * tr, cl: R * tr, throat: (R - ro) * tr, ro };
    if (R - ro <= 0) W.push({ lvl: 'warn', msg: 'The throat radius is zero or less for this elbow, so there’s no throat mark. Mark the heel and sides only.' });
  }
  if (theta < 3) W.push({ lvl: 'warn', msg: `${theta.toFixed(2)}° is a very small cut. Check that a fitting is really needed.` });
  if (theta > 89.99) W.push({ lvl: 'info', msg: 'This is a full 90°, so no cut is needed.' });
  return { sol: { theta, C, L, T, run, ccRun, pipe, mode: i.mode, marks }, W };
}

/** Other ways to make the same offset: fitting to fitting (when it reaches) and standard cut angles with a pipe piece. */
export function fitFitOptions(R: number, O: number, g: number) {
  const rows: Array<{ a: number; pipe: number; run: number; cc: number; T: number; f2f?: boolean }> = [];
  const tf = solveTheta(R, g, O);
  if (O <= 2 * R + g + 1e-9 && isFinite(tf)) rows.push({ a: tf, pipe: 0, run: 2 * R * sinD(tf) + g * cosD(tf), cc: (2 * R * tanD(tf / 2) + g) * cosD(tf), T: 2 * R * tanD(tf / 2) + g, f2f: true });
  for (const a of [11.25, 22.5, 30, 45, 60, 90]) {
    const L = (O - offsetOf(R, 0, a)) / sinD(a);
    rows.push({ a, pipe: L - 2 * g, run: 2 * R * sinD(a) + L * cosD(a), cc: (2 * R * tanD(a / 2) + L) * cosD(a), T: 2 * R * tanD(a / 2) + L });
  }
  return rows;
}

/** Clock position (looking downstream) for a rolling offset: 12 = up, 3 = right. */
export function clockStr(deg: number): string {
  const hrs = (((deg % 360) + 360) % 360) / 30; let hh = Math.floor(hrs + 1e-9), mm = Math.round((hrs - hh) * 60);
  if (mm === 60) { hh++; mm = 0; } if (hh === 0) hh = 12; if (hh > 12) hh -= 12;
  return `${hh}:${String(mm).padStart(2, '0')}`;
}
