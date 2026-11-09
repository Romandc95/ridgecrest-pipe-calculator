// Pipe diagrams for Layout → Miter and Layout → Cope, drawn to scale from the same numbers as the results.
import React from 'react';

const D2R = Math.PI / 180;
type P = [number, number];
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
const dir = (deg: number): P => [Math.cos(deg * D2R), Math.sin(deg * D2R)];

/** Fit model points (y up) into a W×H box with a margin; returns a mapper to screen (y down). */
function fitter(pts: P[], W: number, H: number, m: number) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const k = Math.min((W - 2 * m) / Math.max(x1 - x0, 1e-9), (H - 2 * m) / Math.max(y1 - y0, 1e-9));
  const ox = (W - (x1 - x0) * k) / 2, oy = (H - (y1 - y0) * k) / 2;
  const T = (p: P): P => [ox + (p[0] - x0) * k, H - (oy + (p[1] - y0) * k)];
  return { T, k };
}
const pathOf = (pts: P[], close = true) => 'M' + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L') + (close ? ' Z' : '');

/**
 * Miter elbow, side view: n welds turning the line through the total bend B, each cut tilted α = B/(2n).
 * End pieces run R·tanα from the tangent lines, middle pieces 2R·tanα, all on the centerline.
 */
export function MiterDiagram({ bend, welds, R, od, cut, fmt }: { bend: number; welds: number; R: number; od: number; cut: number; fmt: (v: number) => string }) {
  const a = bend / (2 * welds), r = od / 2, ta = Math.tan(a * D2R);
  const lead = Math.max(od * 1.1, R * 0.5);
  // centerline: tangent point T1 at the origin heading +x, turning left (counter-clockwise)
  const dirs = Array.from({ length: welds + 1 }, (_, i) => i * 2 * a);
  const lens = dirs.map((_, i) => (i === 0 || i === welds ? Math.max(R * ta, welds === 1 ? od * 0.9 : 0) : 2 * R * ta));
  const W: P[] = []; // weld points on the centerline
  let p: P = [0, 0];
  for (let i = 0; i < welds; i++) { p = add(p, mul(dir(dirs[i]), lens[i])); W.push(p); }
  const T2 = add(p, mul(dir(dirs[welds]), lens[welds]));
  // weld-plane offsets: half-width along the cut line, which is square to the bisector of the two pieces
  const cutVec = (k: number): P => mul(dir((dirs[k] + dirs[k + 1]) / 2 + 90), r / Math.cos(a * D2R));
  const nrm = (deg: number): P => mul(dir(deg + 90), r);
  const pieces: P[][] = [];
  for (let i = 0; i <= welds; i++) {
    const s = i === 0 ? [add([0, 0], nrm(dirs[0])), add([0, 0], mul(nrm(dirs[0]), -1))] : [add(W[i - 1], cutVec(i - 1)), add(W[i - 1], mul(cutVec(i - 1), -1))];
    const e = i === welds ? [add(T2, nrm(dirs[welds])), add(T2, mul(nrm(dirs[welds]), -1))] : [add(W[i], cutVec(i)), add(W[i], mul(cutVec(i), -1))];
    pieces.push([s[0], e[0], e[1], s[1]]);
  }
  const leadIn: P[] = [[-lead, r], [0, r], [0, -r], [-lead, -r]];
  const L2 = add(T2, mul(dir(bend), lead));
  const leadOut: P[] = [add(T2, nrm(bend)), add(L2, nrm(bend)), add(L2, mul(nrm(bend), -1)), add(T2, mul(nrm(bend), -1))];
  const C: P = [0, R]; // bend center (radius R)
  const all = [...pieces.flat(), ...leadIn, ...leadOut, ...(R > 0 ? [C] : [])];
  const Wd = 340, Hd = 250;
  const { T } = fitter(all, Wd, Hd, 30);
  const mid = (q: P[]) => mul(q.reduce((s, v) => add(s, v), [0, 0] as P), 1 / q.length);
  const heelLbl = add(mid(pieces[Math.floor(welds / 2)]), mul(nrm(dirs[Math.floor(welds / 2)]), -1.9));
  const throatLbl = add(mid(pieces[Math.floor(welds / 2)]), mul(nrm(dirs[Math.floor(welds / 2)]), 1.5));
  const arcPts: P[] = R > 0 ? Array.from({ length: 33 }, (_, i) => add(C, mul(dir(-90 + bend * i / 32), R))) : [];
  const w0 = W[0], cv = cutVec(0);
  return (
    <figure className="diagram">
      <svg viewBox={`0 0 ${Wd} ${Hd}`} role="img" aria-label={`Miter elbow: ${bend}° in ${welds} welds`}>
        <path d={pathOf(leadIn.map(T))} className="shp-lead" />
        <path d={pathOf(leadOut.map(T))} className="shp-lead" />
        {pieces.map((q, i) => <path key={i} d={pathOf(q.map(T))} className={'shp-piece' + (i === 0 || i === welds ? ' end' : '')} />)}
        {W.map((w, k) => { const c = cutVec(k), A = T(add(w, c)), B = T(add(w, mul(c, -1))); return <line key={k} x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} className="shp-weld" />; })}
        <path d={pathOf([T([-lead, 0]), T([0, 0]), ...W.map(T), T(T2), T(L2)], false)} className="dg-center" fill="none" />
        {R > 0 && <path d={pathOf(arcPts.map(T), false)} className="shp-radius" fill="none" />}
        {R > 0 && <><line x1={T(C)[0]} y1={T(C)[1]} x2={T([0, 0])[0]} y2={T([0, 0])[1]} className="shp-radius" /><circle cx={T(C)[0]} cy={T(C)[1]} r={2.5} className="shp-dot" />
          <text className="dg-lbl sm" x={T(C)[0] + 5} y={T(C)[1] - 6}>R {fmt(R)}</text></>}
        {pieces.map((q, i) => { const c = T(mid(q)); return <text key={'n' + i} className="dg-lbl sm strong" x={c[0]} y={c[1] + 4} textAnchor="middle">{i + 1}</text>; })}
        <text className="dg-lbl sm acc" x={T(heelLbl)[0]} y={T(heelLbl)[1]} textAnchor="middle">heel</text>
        <text className="dg-lbl sm" x={T(throatLbl)[0] + 8} y={T(throatLbl)[1]} textAnchor="middle">throat</text>
        {(() => { const q = T(add(w0, mul(cv, -1.35))); return <text className="dg-lbl sm shp-cuttxt" x={q[0]} y={q[1] + 4} textAnchor="middle">{cut.toFixed(2)}°</text>; })()}
        <text className="dg-lbl sm" x={T([-lead, 0])[0]} y={T([-lead, -r])[1] + 14}>tangent</text>
      </svg>
      <figcaption>Side view, to scale: {welds + 1} pieces (numbered), {welds} weld{welds > 1 ? 's' : ''} (red), each cut {cut.toFixed(2)}° from square. {R > 0 ? 'Dashed arc is the centerline radius.' : ''} Heel is the outside of the bend, throat the inside.</figcaption>
    </figure>
  );
}

/**
 * Cope (fish-mouth), side view looking square to both axes: header horizontal, branch at θ, with the saddle line
 * the branch end makes on the header; plus an end view when the branch is offset from the header centerline.
 */
export function CopeDiagram({ H, B, angle, off, depth, fmt }: { H: number; B: number; angle: number; off: number; depth: number; fmt: (v: number) => string }) {
  const R = H / 2, r = B / 2, th = angle * D2R;
  const u: P = [Math.cos(th), Math.sin(th)], n: P = [-Math.sin(th), Math.cos(th)];
  // saddle: for each φ, the branch surface meets the top of the header at t(φ)
  const sad: P[] = [];
  let tmin = Infinity, tmax = -Infinity;
  for (let i = 0; i <= 72; i++) {
    const ph = (i / 72) * 2 * Math.PI, z = r * Math.sin(ph) + off;
    const y = Math.sqrt(Math.max(0, R * R - z * z));
    const t = (y - r * Math.cos(ph) * Math.cos(th)) / Math.sin(th);
    tmin = Math.min(tmin, t); tmax = Math.max(tmax, t);
    sad.push(add(mul(u, t), mul(n, r * Math.cos(ph))));
  }
  const len = tmax + Math.max(B * 1.4, H * 0.8);
  const ends = { a: add(mul(u, len), mul(n, r)), b: add(mul(u, len), mul(n, -r)) };
  // silhouette lines run from the saddle at φ = 0 / 180° out to the branch end
  const s0 = sad[0], s180 = sad[36];
  const reach = Math.max(H * 1.3, Math.abs(len * u[0]) + r + B);
  const hdr: P[] = [[-reach, R], [reach, R], [reach, -R], [-reach, -R]];
  const Wd = 340, Hd = 240;
  const showEnd = Math.abs(off) > 1e-6;
  const { T } = fitter([...hdr, ends.a, ends.b, ...sad], showEnd ? 230 : Wd, Hd, 26);
  const sadPath = pathOf(sad.map(T), true);
  const arcR = 34, hc = T([0, R]);
  // depth of cut, measured along the branch between the tips and the deepest point
  const side = angle < 89.5 ? 1 : -1; // put the depth dimension on the open side of the branch
  const dA = add(mul(u, tmax), mul(n, side * (r + B * 0.35))), dB = add(mul(u, tmin), mul(n, side * (r + B * 0.35)));
  return (
    <figure className="diagram">
      <svg viewBox={`0 0 ${Wd} ${Hd}`} role="img" aria-label={`Cope: ${B}" OD branch on ${H}" OD header at ${angle}°`}>
        <defs><marker id="cpah" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" className="dg-arrowhead" /></marker></defs>
        <path d={pathOf(hdr.map(T))} className="shp-lead" />
        <line x1={T([-reach, 0])[0]} y1={T([-reach, 0])[1]} x2={T([reach, 0])[0]} y2={T([reach, 0])[1]} className="dg-center" />
        <path d={pathOf([T(s0), T(ends.a), T(ends.b), T(s180)], true)} className="shp-piece" />
        <path d={sadPath} className="shp-saddle" fill="none" />
        <line x1={T([0, 0])[0]} y1={T([0, 0])[1]} x2={T(mul(u, len))[0]} y2={T(mul(u, len))[1]} className="dg-center" />
        {angle < 89.5 || angle > 90.5 ? <path d={`M${hc[0] + arcR},${hc[1]} A${arcR},${arcR} 0 0 0 ${(hc[0] + arcR * Math.cos(th)).toFixed(1)},${(hc[1] - arcR * Math.sin(th)).toFixed(1)}`} className="shp-radius" fill="none" /> : null}
        <text className="dg-lbl sm" x={hc[0] + (arcR + 10) * Math.cos(th / 2) + (angle >= 89.5 ? 14 : 4)} y={hc[1] - (arcR + 10) * Math.sin(th / 2)}>{angle}°</text>
        {depth > 1e-6 && <><line x1={T(dA)[0]} y1={T(dA)[1]} x2={T(dB)[0]} y2={T(dB)[1]} className="dg-dim" markerStart="url(#cpah)" markerEnd="url(#cpah)" />
          <text className="dg-lbl sm acc" x={(T(dA)[0] + T(dB)[0]) / 2 + (side > 0 ? -6 : 6)} y={(T(dA)[1] + T(dB)[1]) / 2 + 4} textAnchor={side > 0 ? 'end' : 'start'}>depth {fmt(depth)}</text></>}
        <text className="dg-lbl sm" x={T([-reach, -R])[0] + 4} y={T([-reach, -R])[1] - 6}>header {H}" OD</text>
        {(() => { const q = T(add(mul(u, len), mul(n, r))); return <text className="dg-lbl sm" x={q[0] + 4} y={q[1] - 4}>branch {B}" OD</text>; })()}
        {showEnd && (() => {
          const cx = 285, cy = 150, k = 44 / Math.max(R, r + Math.abs(off));
          return <g>
            <circle cx={cx} cy={cy} r={R * k} className="shp-lead" />
            <rect x={cx + (off - r) * k} y={cy - R * k - 46} width={2 * r * k} height={46 + R * k * 0.6} className="shp-piece" />
            <line x1={cx} x2={cx} y1={cy - R * k - 52} y2={cy + R * k + 6} className="dg-center" />
            <line x1={cx + off * k} x2={cx + off * k} y1={cy - R * k - 52} y2={cy} className="dg-center" />
            <text className="dg-lbl sm" x={cx} y={cy + R * k + 20} textAnchor="middle">end view · offset {fmt(Math.abs(off))}</text>
          </g>;
        })()}
      </svg>
      <figcaption>Side view, to scale: the branch (teal) sits on the header (grey) at {angle}°; the red line is where the cope meets the header. Depth of cut is from the tips to the deepest point, along the branch.</figcaption>
    </figure>
  );
}
