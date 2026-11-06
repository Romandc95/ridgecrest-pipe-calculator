// Labeled schematic diagrams (not to scale). All dimensions are centerline dimensions unless noted.
import React from 'react';

const W = 340;

function Dim({ x1, y1, x2, y2, label, off = 0, side = 1 }: { x1: number; y1: number; x2: number; y2: number; label: string; off?: number; side?: number }) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * side, ny = (dx / L) * side;
  const mx = (x1 + x2) / 2 + nx * (12 + off), my = (y1 + y2) / 2 + ny * (12 + off);
  return (
    <g className="dg-dim">
      <line x1={x1} y1={y1} x2={x2} y2={y2} markerStart="url(#arr)" markerEnd="url(#arr)" />
      <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" className="dg-lbl">{label}</text>
    </g>
  );
}

function Defs() {
  return (
    <defs>
      <marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,1 L9,5 L0,9 z" className="dg-arrowhead" />
      </marker>
      <marker id="flow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto">
        <path d="M0,0 L10,5 L0,10 z" className="dg-flowhead" />
      </marker>
    </defs>
  );
}

export function Caption({ children }: { children: React.ReactNode }) { return <figcaption>{children}</figcaption>; }

export function SimpleOffsetDiagram({ O, A, L, T }: { O: string; A: string; L: string; T: string }) {
  const F1 = [70, 165], F2 = [250, 60];
  const ang = Math.atan2(F1[1] - F2[1], F2[0] - F1[0]);
  const r = 42;
  return (
    <figure className="diagram">
      <svg viewBox={`0 0 ${W} 225`} role="img" aria-label="Simple offset diagram">
        <Defs />
        <line className="dg-ext" x1={F2[0]} y1={F2[1]} x2={F2[0]} y2={205} />
        <line className="dg-ext" x1={F1[0]} y1={F1[1]} x2={F1[0]} y2={205} />
        <line className="dg-ext" x1={F1[0]} y1={F1[1]} x2={305} y2={F1[1]} />
        <line className="dg-ext" x1={F2[0]} y1={F2[1]} x2={305} y2={F2[1]} />
        <path className="dg-pipe" d={`M10,${F1[1]} L${F1[0]},${F1[1]} L${F2[0]},${F2[1]} L330,${F2[1]}`} />
        <path className="dg-flowline" d={`M14,${F1[1] - 14} L44,${F1[1] - 14}`} markerEnd="url(#flow)" />
        <circle className="dg-node" cx={F1[0]} cy={F1[1]} r={5} /><circle className="dg-node" cx={F2[0]} cy={F2[1]} r={5} />
        <path className="dg-angle" d={`M${F1[0] + r},${F1[1]} A${r},${r} 0 0 0 ${F1[0] + r * Math.cos(ang)},${F1[1] - r * Math.sin(ang)}`} />
        <text className="dg-lbl acc" x={F1[0] + r + 14} y={F1[1] - 12}>θ {T}</text>
        <Dim x1={F1[0]} y1={198} x2={F2[0]} y2={198} label={`A run ${A}`} side={-1} off={-2} />
        <Dim x1={300} y1={F1[1]} x2={300} y2={F2[1]} label="" />
        <text className="dg-lbl" x={300} y={(F1[1] + F2[1]) / 2 - 12} textAnchor="end">O offset</text>
        <text className="dg-lbl" x={300} y={(F1[1] + F2[1]) / 2 + 4} textAnchor="end">{O}</text>
        <text className="dg-lbl strong" x={(F1[0] + F2[0]) / 2 - 18} y={(F1[1] + F2[1]) / 2 - 14} transform={`rotate(${-ang * 180 / Math.PI} ${(F1[0] + F2[0]) / 2 - 18} ${(F1[1] + F2[1]) / 2 - 14})`} textAnchor="middle">L travel {L}</text>
      </svg>
      <Caption>Schematic, not to scale. ● = fitting center (tangent intersection). O ⟂ to the pipe line, A along it, L center-to-center, θ = bend angle at each fitting.</Caption>
    </figure>
  );
}

// ---------- isometric helpers ----------
type V3 = [number, number, number];
const C30 = Math.cos(Math.PI / 6), S30 = 0.5;
const iso = (p: V3): [number, number] => [(p[0] - p[1]) * C30, -p[2] + (p[0] + p[1]) * S30];
function fit(points: V3[], w = W, h = 230, pad = 34) {
  const pr = points.map(iso);
  const xs = pr.map((p) => p[0]), ys = pr.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = Math.min((w - 2 * pad) / (maxX - minX || 1), (h - 2 * pad) / (maxY - minY || 1));
  const ox = (w - (maxX - minX) * s) / 2 - minX * s, oy = (h - (maxY - minY) * s) / 2 - minY * s;
  return (p: V3): [number, number] => { const q = iso(p); return [q[0] * s + ox, q[1] * s + oy]; };
}

export function RollingOffsetDiagram({ H, V, A, L, T, phi }: { H: string; V: string; A: string; L: string; T: string; phi: string }) {
  // oblique projection: run → right, H → depth (up-right), V → up
  const a = 165, h = 70, v = 62, ox = 40, oy = 190;
  const P = (x: number, y: number, z: number): [number, number] => [ox + x + y * 0.62, oy - z - y * 0.36];
  const pt = (x: number, y: number, z: number) => P(x, y, z).join(',');
  const box: Array<[number[], number[]]> = [
    [[0, 0, 0], [a, 0, 0]], [[0, h, 0], [a, h, 0]], [[0, 0, v], [a, 0, v]], [[0, h, v], [a, h, v]],
    [[0, 0, 0], [0, h, 0]], [[a, 0, 0], [a, h, 0]], [[0, 0, v], [0, h, v]], [[a, 0, v], [a, h, v]],
    [[0, 0, 0], [0, 0, v]], [[a, 0, 0], [a, 0, v]], [[0, h, 0], [0, h, v]], [[a, h, 0], [a, h, v]],
  ];
  const ln = ([p, q]: [number[], number[]], i: number) => { const A1 = P(p[0], p[1], p[2]), B1 = P(q[0], q[1], q[2]); return <line key={i} className="dg-ext" x1={A1[0]} y1={A1[1]} x2={B1[0]} y2={B1[1]} />; };
  const [x0, y0] = P(0, 0, 0), [x1, y1] = P(a, h, v);
  const cx = 62, cy = 50, R = 28, phiR = Math.atan2(v, h);
  return (
    <figure className="diagram">
      <svg viewBox={`0 0 ${W} 228`} role="img" aria-label="Rolling offset diagram">
        <Defs />
        {box.map(ln)}
        <line className="dg-dim" x1={P(a, h, 0)[0]} y1={P(a, h, 0)[1]} x2={x1} y2={y1} />
        <path className="dg-pipe" d={`M${pt(-30, 0, 0)} L${pt(0, 0, 0)} L${pt(a, h, v)} L${pt(a + 30, h, v)}`} />
        <circle className="dg-node" cx={x0} cy={y0} r={4.5} /><circle className="dg-node" cx={x1} cy={y1} r={4.5} />
        <text className="dg-lbl" x={P(a / 2, 0, 0)[0]} y={P(a / 2, 0, 0)[1] + 17} textAnchor="middle">A run {A}</text>
        <text className="dg-lbl" x={P(a, h / 2, 0)[0] + 8} y={P(a, h / 2, 0)[1] + 12}>H {H}</text>
        <text className="dg-lbl" x={P(a, h, v / 2)[0] + 8} y={P(a, h, v / 2)[1] + 4}>V {V}</text>
        <text className="dg-lbl strong" x={(x0 + x1) / 2 - 10} y={(y0 + y1) / 2 - 12} textAnchor="middle">L {L}</text>
        <text className="dg-lbl acc" x={x0 + 4} y={y0 + 34}>θ {T}</text>
        <g>
          <circle className="dg-ext" cx={cx} cy={cy} r={R} />
          <line className="dg-dim" x1={cx - R - 4} y1={cy} x2={cx + R + 6} y2={cy} />
          <line className="dg-dim" x1={cx} y1={cy + R + 4} x2={cx} y2={cy - R - 6} />
          <text className="dg-lbl sm" x={cx + R + 6} y={cy + 14} textAnchor="end">+H</text>
          <text className="dg-lbl sm" x={cx + 5} y={cy - R - 4}>+V</text>
          <line className="dg-pipe thin" x1={cx} y1={cy} x2={cx + R * Math.cos(phiR)} y2={cy - R * Math.sin(phiR)} />
          <path className="dg-angle" d={`M${cx + 15},${cy} A15,15 0 0 0 ${cx + 15 * Math.cos(phiR)},${cy - 15 * Math.sin(phiR)}`} />
          <text className="dg-lbl acc sm" x={cx + R + 12} y={cy - 8}>φ {phi}</text>
          <text className="dg-lbl sm" x={cx + R + 12} y={cy + 8}>end view, looking</text>
          <text className="dg-lbl sm" x={cx + R + 12} y={cy + 21}>downstream along A</text>
        </g>
      </svg>
      <Caption>A = run along the pipe axis; H = horizontal transverse; V = vertical (+ up). Resultant offset O = √(H²+V²). φ = atan2(V, H) is the rotation of the offset plane from +H toward +V — it is not the clocking of a particular elbow on its pipe.</Caption>
    </figure>
  );
}

export function CutbackDiagram({ S, T, C }: { S: string; T: string; C: string }) {
  const th = (Math.PI / 180) * 40; // drawing angle
  const sp = 46;
  const P: [number, number] = [210, 170];
  const c = sp * Math.tan(th / 2);
  const Q: [number, number] = [P[0] - c, P[1] - sp];
  const up = (p: [number, number], l: number) => [p[0] + l * Math.cos(th), p[1] - l * Math.sin(th)];
  const p2 = up(P, 120), q2 = up(Q, 120);
  return (
    <figure className="diagram">
      <svg viewBox={`0 0 ${W} 210`} role="img" aria-label="Parallel pipe cutback diagram">
        <Defs />
        <path className="dg-pipe" d={`M20,${P[1]} L${P[0]},${P[1]} L${p2[0]},${p2[1]}`} />
        <path className="dg-pipe alt" d={`M20,${Q[1]} L${Q[0]},${Q[1]} L${q2[0]},${q2[1]}`} />
        <line className="dg-ext" x1={P[0] + (P[0] - Q[0]) * 0.5} y1={P[1] + (P[1] - Q[1]) * 0.5} x2={Q[0] - (P[0] - Q[0]) * 0.6} y2={Q[1] - (P[1] - Q[1]) * 0.6} />
        <line className="dg-ext" x1={Q[0]} y1={Q[1]} x2={Q[0]} y2={Q[1] - 34} />
        <line className="dg-ext" x1={P[0]} y1={P[1]} x2={P[0]} y2={Q[1] - 34} />
        <Dim x1={Q[0]} y1={Q[1] - 28} x2={P[0]} y2={Q[1] - 28} label="" />
        <text className="dg-lbl strong" x={(P[0] + Q[0]) / 2} y={Q[1] - 40} textAnchor="middle">cutback {C}</text>
        <Dim x1={50} y1={P[1]} x2={50} y2={Q[1]} label="" />
        <text className="dg-lbl" x={58} y={(P[1] + Q[1]) / 2 + 4}>spacing {S}</text>
        <circle className="dg-node" cx={P[0]} cy={P[1]} r={4.5} /><circle className="dg-node" cx={Q[0]} cy={Q[1]} r={4.5} />
        <path className="dg-angle" d={`M${P[0] + 40},${P[1]} A40,40 0 0 0 ${P[0] + 40 * Math.cos(th)},${P[1] - 40 * Math.sin(th)}`} />
        <text className="dg-lbl acc" x={P[0] + 46} y={P[1] - 6}>θ {T}</text>
      </svg>
      <Caption>Parallel (or concentric) runs turning through the same bend θ: each bend center sits on the bisector line, so the inside pipe’s bend moves back by cutback = spacing × tan(θ/2).</Caption>
    </figure>
  );
}

export function TrimDiagram({ beta, kept, removed, arcs }: { beta: number; kept: string; removed: string; arcs: { i: string; c: string; o: string } }) {
  const C: [number, number] = [70, 190];
  const R = 115, r = 42;
  const pt = (a: number, rad: number): [number, number] => [C[0] + rad * Math.cos(a), C[1] - rad * Math.sin(a)];
  const b = Math.max(1, Math.min(90, beta)) * Math.PI / 180;
  const sector = (a0: number, a1: number) => {
    const [x1, y1] = pt(a0, R + r), [x2, y2] = pt(a1, R + r), [x3, y3] = pt(a1, R - r), [x4, y4] = pt(a0, R - r);
    const lg = a1 - a0 > Math.PI ? 1 : 0;
    return `M${x1},${y1} A${R + r},${R + r} 0 ${lg} 0 ${x2},${y2} L${x3},${y3} A${R - r},${R - r} 0 ${lg} 1 ${x4},${y4} Z`;
  };
  const [cx1, cy1] = pt(b, R - r - 4), [cx2, cy2] = pt(b, R + r + 4);
  const lblA = (a: number, rad: number) => pt(a, rad);
  return (
    <figure className="diagram">
      <svg viewBox={`0 0 ${W} 215`} role="img" aria-label="Elbow trimming diagram">
        <Defs />
        <path className="dg-elbow-keep" d={sector(0, b)} />
        <path className="dg-elbow-cut" d={sector(b, Math.PI / 2)} />
        <path className="dg-ext" d={`M${pt(0, R)[0]},${pt(0, R)[1]} A${R},${R} 0 0 0 ${pt(Math.PI / 2, R)[0]},${pt(Math.PI / 2, R)[1]}`} />
        <line className="dg-cut" x1={cx1} y1={cy1} x2={cx2} y2={cy2} />
        <line className="dg-ext" x1={C[0]} y1={C[1]} x2={pt(b, R - r - 6)[0]} y2={pt(b, R - r - 6)[1]} />
        <line className="dg-ext" x1={C[0]} y1={C[1]} x2={pt(0, R - r)[0]} y2={pt(0, R - r)[1]} />
        <circle className="dg-node" cx={C[0]} cy={C[1]} r={3} />
        <text className="dg-lbl sm" x={C[0] - 4} y={C[1] + 14} textAnchor="middle">bend center</text>
        <line className="dg-start" x1={pt(0, R - r)[0]} y1={pt(0, R - r)[1]} x2={pt(0, R + r)[0]} y2={pt(0, R + r)[1]} />
        <text className="dg-lbl acc sm" x={pt(0, R)[0]} y={C[1] + 16} textAnchor="middle">▲ arcs start: kept factory end</text>
        <text className="dg-lbl sm" x={lblA(b / 2, R - r - 12)[0]} y={lblA(b / 2, R - r - 12)[1]} textAnchor="end">inside {arcs.i}</text>
        <text className="dg-lbl sm strong" x={lblA(b / 2, R)[0] + 2} y={lblA(b / 2, R)[1] + 4} textAnchor="middle">center {arcs.c}</text>
        <text className="dg-lbl sm" x={lblA(b / 2, R + r + 8)[0]} y={lblA(b / 2, R + r + 8)[1]}>outside {arcs.o}</text>
        <text className="dg-lbl acc" x={pt(b, R + r + 14)[0] + 2} y={pt(b, R + r + 14)[1]}>cut line</text>
        <text className="dg-lbl" x={pt((b + Math.PI / 2) / 2, R)[0]} y={pt((b + Math.PI / 2) / 2, R)[1] + 4} textAnchor="middle">{beta < 89.5 ? `remove ${removed}` : ''}</text>
        <text className="dg-lbl strong" x={250} y={30}>keep {kept}</text>
      </svg>
      <Caption>Solid = retained piece (bend angle kept), hatched = removed piece. Measure inside (throat), center and outside (heel) arcs from the kept factory end and mark the cut; connect the three marks around the fitting.</Caption>
    </figure>
  );
}

export interface F2FDrawing {
  P0: V3; C1: V3; P1: V3; P1g: V3; C2: V3; P2: V3; d0: V3; d2: V3; N: V3; sep: string; illustrative: boolean; T: number;
}
export function FitToFitDiagram({ d }: { d: F2FDrawing }) {
  const inlet: V3 = [d.P0[0] - d.d0[0] * d.T * 1.2, d.P0[1] - d.d0[1] * d.T * 1.2, d.P0[2] - d.d0[2] * d.T * 1.2];
  const outlet: V3 = [d.P2[0] + d.d2[0] * d.T * 1.2, d.P2[1] + d.d2[1] * d.T * 1.2, d.P2[2] + d.d2[2] * d.T * 1.2];
  const foot: V3 = [d.C2[0] - d.N[0] * (dot3(sub3(d.C2, d.C1), d.N)), d.C2[1] - d.N[1] * dot3(sub3(d.C2, d.C1), d.N), d.C2[2] - d.N[2] * dot3(sub3(d.C2, d.C1), d.N)];
  const P = fit([inlet, outlet, d.P0, d.C1, d.P1, d.C2, d.P2, foot], W, 240, 36);
  const s = (p: V3) => P(p).join(',');
  const [c1x, c1y] = P(d.C1), [c2x, c2y] = P(d.C2), [fx, fy] = P(foot);
  const ax = 30, ay = 210;
  const axis = (v: V3, l: string) => { const q = iso(v); return <g key={l}><line className="dg-dim" x1={ax} y1={ay} x2={ax + q[0] * 18} y2={ay + q[1] * 18} markerEnd="url(#arr)" /><text className="dg-lbl sm" x={ax + q[0] * 26} y={ay + q[1] * 26 + 4} textAnchor="middle">{l}</text></g>; };
  return (
    <figure className="diagram">
      <svg viewBox={`0 0 ${W} 240`} role="img" aria-label="Fitting-to-fitting arrangement">
        <Defs />
        <path className="dg-pipe" d={`M${s(inlet)} L${s(d.P0)}`} markerStart="" />
        <path className="dg-pipe elbow" d={`M${s(d.P0)} Q${s(d.C1)} ${s(d.P1)}`} />
        <path className="dg-gap" d={`M${s(d.P1)} L${s(d.P1g)}`} />
        <path className="dg-pipe elbow2" d={`M${s(d.P1g)} Q${s(d.C2)} ${s(d.P2)}`} />
        <path className="dg-pipe" d={`M${s(d.P2)} L${s(outlet)}`} />
        <path className="dg-ext" d={`M${s(d.P0)} L${s(d.C1)} L${s(d.P1)}`} />
        <path className="dg-ext" d={`M${s(d.P1g)} L${s(d.C2)} L${s(d.P2)}`} />
        <circle className="dg-node" cx={c1x} cy={c1y} r={4} /><circle className="dg-node" cx={c2x} cy={c2y} r={4} />
        <text className="dg-lbl sm" x={c1x + 7} y={c1y - 6}>C1 (90°, rolled)</text>
        <text className="dg-lbl sm" x={c2x + 7} y={c2y + 14}>C2 (trimmed)</text>
        <circle className="dg-face" cx={P(d.P0)[0]} cy={P(d.P0)[1]} r={3} /><circle className="dg-face" cx={P(d.P1)[0]} cy={P(d.P1)[1]} r={3} /><circle className="dg-face" cx={P(d.P2)[0]} cy={P(d.P2)[1]} r={3} />
        <line className="dg-ext" x1={c1x} y1={c1y} x2={fx} y2={fy} />
        <line className="dg-dim" x1={fx} y1={fy} x2={c2x} y2={c2y} markerStart="url(#arr)" markerEnd="url(#arr)" />
        <text className="dg-lbl acc" x={(fx + c2x) / 2 + 8} y={(fy + c2y) / 2}>{d.sep}</text>
        <text className="dg-lbl sm" x={P(inlet)[0]} y={P(inlet)[1] - 8}>inlet</text>
        <text className="dg-lbl sm" x={P(outlet)[0] - 6} y={P(outlet)[1] - 8} textAnchor="end">outlet</text>
        {axis([1, 0, 0], 'X')}{axis([0, 1, 0], 'Y')}{axis([0, 0, 1], 'Z↑')}
      </svg>
      <Caption>{d.illustrative ? 'Assumed arrangement (illustrative roll until solved). ' : 'Solved arrangement, isometric, to scale. '}Elbow 1 face → C1 → face, gap, elbow 2 face → C2 → outlet face. Fitting centers are tangent intersections; face dots mark weld joints.</Caption>
    </figure>
  );
}
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function CombinationDiagram({ dx, dy, dz, inDir, outDir, L, entry, exit }: { dx: number; dy: number; dz: number; inDir: V3; outDir: V3; L: string; entry: string; exit: string }) {
  const m = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) || 1;
  const a: V3 = [dx / m * 3, dy / m * 3, dz / m * 3];
  const ob = (p: V3): [number, number] => [p[0] + p[1] * 0.62, -p[2] - p[1] * 0.36];
  const st: V3 = [-inDir[0] * 0.9, -inDir[1] * 0.9, -inDir[2] * 0.9];
  const en: V3 = [a[0] + outDir[0] * 0.9, a[1] + outDir[1] * 0.9, a[2] + outDir[2] * 0.9];
  const corners: V3[] = [];
  for (const x of [0, a[0]]) for (const y of [0, a[1]]) for (const z of [0, a[2]]) corners.push([x, y, z]);
  const all = [...corners, st, en].map(ob);
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const pad = 40, w = W, h = 210;
  const k = Math.min((w - 2 * pad) / (Math.max(...xs) - Math.min(...xs) || 1), (h - 2 * pad) / (Math.max(...ys) - Math.min(...ys) || 1));
  const ox = (w - (Math.max(...xs) - Math.min(...xs)) * k) / 2 - Math.min(...xs) * k, oy = (h - (Math.max(...ys) - Math.min(...ys)) * k) / 2 - Math.min(...ys) * k;
  const P = (p: V3): [number, number] => { const q = ob(p); return [q[0] * k + ox, q[1] * k + oy]; };
  const s = (p: V3) => P(p).join(',');
  const edges: Array<[V3, V3]> = [];
  for (const c of corners) for (const d of corners) {
    const diff = [0, 1, 2].filter((i) => c[i] !== d[i]).length;
    if (diff === 1 && c.join() < d.join()) edges.push([c, d]);
  }
  const mid = (p: V3, q: V3) => P([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]);
  const [xl, yl] = mid([0, 0, 0], [a[0], 0, 0]), [hx, hy] = mid([a[0], 0, 0], [a[0], a[1], 0]), [vx, vy] = mid([a[0], a[1], 0], a);
  const [p0x, p0y] = P([0, 0, 0]), [p1x, p1y] = P(a);
  return (
    <figure className="diagram">
      <svg viewBox={`0 0 ${W} ${h}`} role="img" aria-label="Combination offset diagram">
        <Defs />
        {edges.map(([p, q], i) => <line key={i} className="dg-ext" x1={P(p)[0]} y1={P(p)[1]} x2={P(q)[0]} y2={P(q)[1]} />)}
        <path className="dg-pipe" d={`M${s(st)} L${s([0, 0, 0])} L${s(a)} L${s(en)}`} />
        <circle className="dg-node" cx={p0x} cy={p0y} r={4.5} /><circle className="dg-node" cx={p1x} cy={p1y} r={4.5} />
        <text className="dg-lbl acc sm" x={p0x} y={p0y + 30} textAnchor="middle">entry {entry}</text>
        <text className="dg-lbl acc sm" x={p1x - 12} y={p1y - 10} textAnchor="end">exit {exit}</text>
        <text className="dg-lbl strong" x={(p0x + p1x) / 2 - 8} y={(p0y + p1y) / 2 - 10} textAnchor="end">L {L}</text>
        <text className="dg-lbl sm" x={xl} y={yl + 16} textAnchor="middle">X {formatShort(dx)}</text>
        <text className="dg-lbl sm" x={hx + 8} y={hy + 12}>Y {formatShort(dy)}</text>
        <text className="dg-lbl sm" x={vx + 8} y={vy + 4}>Z {formatShort(dz)}</text>
      </svg>
      <Caption>Oblique view (X along the incoming run, Y horizontal into the page, Z up). Fitting angle = angle between the pipe and the incoming / outgoing direction.</Caption>
    </figure>
  );
}
const formatShort = (v: number) => (Math.round(v * 1000) / 1000).toString();
