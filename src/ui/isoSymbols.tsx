import React from 'react';
import { CatalogItem, Conn } from '../engine/iso';

type V2 = readonly [number, number];
/** Builder for points relative to a center m, along u (pipe direction) and n (normal). */
const frame = (m: V2, u: V2) => {
  const n: V2 = [u[1], -u[0]]; // left of the pipe direction: "up" for a pipe running left to right
  const P = (a: number, b: number): string => `${(m[0] + u[0] * a + n[0] * b).toFixed(1)},${(m[1] + u[1] * a + n[1] * b).toFixed(1)}`;
  const X = (a: number, b: number): [number, number] => [m[0] + u[0] * a + n[0] * b, m[1] + u[1] * a + n[1] * b];
  return { n, P, X };
};

const VALVES = new Set(['gate', 'globe', 'ball', 'butterfly', 'check', 'liftcheck', 'plug', 'needle', 'diaphragm', 'knifegate', 'control', 'regulator', 'solenoid']);

/**
 * Symbol for an item sitting on a line. m = center, u = unit direction of the pipe on screen, s = size.
 * stem = screen direction of the valve stem / handwheel (from its real-world direction, so it stays put when the view turns);
 * defaults to "left of the pipe".
 */
export function lineSymbol(type: string, m: V2, u: V2, s: number, key: string, stem?: V2): React.ReactNode[] {
  const { P, X, n } = frame(m, u);
  const t: V2 = stem ?? n, w: V2 = [-t[1], t[0]];
  /** point across (a) and along (b) the stem */
  const T = (a: number, b: number): [number, number] => [m[0] + w[0] * a + t[0] * b, m[1] + w[1] * a + t[1] * b];
  const PT = (a: number, b: number): string => { const q = T(a, b); return `${q[0].toFixed(1)},${q[1].toFixed(1)}`; };
  const out: React.ReactNode[] = [];
  const k = (x: string) => key + x;
  const line = (a: [number, number], b: [number, number], cls = 'iso-sym', kk = 'l' + out.length) => out.push(<line key={k(kk)} className={cls} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />);
  const gap = () => line(X(-s * 1.05, 0), X(s * 1.05, 0), 'iso-gap', 'gap');
  if (VALVES.has(type)) {
    out.push(<polygon key={k('b')} className="iso-sym" points={`${P(-s, -s * 0.75)} ${P(s, s * 0.75)} ${P(s, -s * 0.75)} ${P(-s, s * 0.75)}`} />);
    const stem = (h = 1.5) => line(T(0, 0), T(0, s * h), 'iso-sym', 'st');
    switch (type) {
      case 'gate': stem(); line(T(-s * 0.6, s * 1.5), T(s * 0.6, s * 1.5), 'iso-sym', 'hw'); break;
      case 'globe': stem(); out.push(<circle key={k('c')} className="iso-symfill" cx={m[0]} cy={m[1]} r={s * 0.36} />); line(T(-s * 0.6, s * 1.5), T(s * 0.6, s * 1.5), 'iso-sym', 'hw'); break;
      case 'ball': stem(1.4); out.push(<circle key={k('c')} className="iso-symball" cx={m[0]} cy={m[1]} r={s * 0.42} />); line(T(0, s * 1.4), T(s * 0.8, s * 1.4), 'iso-sym', 'lv'); break;
      case 'butterfly': line(X(0, -s * 1.15), X(0, s * 1.15), 'iso-sym', 'disc'); out.push(<circle key={k('c')} className="iso-symfill" cx={m[0]} cy={m[1]} r={s * 0.2} />); break;
      case 'check': out.push(<polygon key={k('f')} className="iso-symfill" points={`${P(-s, -s * 0.75)} ${P(0, 0)} ${P(-s, s * 0.75)}`} />); break;
      case 'liftcheck': out.push(<polygon key={k('f')} className="iso-symfill" points={`${P(-s, -s * 0.75)} ${P(0, 0)} ${P(-s, s * 0.75)}`} />); stem(1.1); out.push(<polygon key={k('r')} className="iso-sym" points={`${PT(-s * 0.35, s * 1.1)} ${PT(s * 0.35, s * 1.1)} ${PT(s * 0.35, s * 1.6)} ${PT(-s * 0.35, s * 1.6)}`} />); break;
      case 'plug': out.push(<polygon key={k('r')} className="iso-symfill" points={`${P(-s * 0.3, -s * 0.3)} ${P(s * 0.3, -s * 0.3)} ${P(s * 0.3, s * 0.3)} ${P(-s * 0.3, s * 0.3)}`} />); stem(); break;
      case 'needle': stem(1.3); out.push(<polygon key={k('n')} className="iso-symfill" points={`${PT(0, s * 1.3)} ${PT(-s * 0.45, s * 1.8)} ${PT(s * 0.45, s * 1.8)}`} />); break;
      case 'diaphragm': stem(1.1); { const a = T(-s * 0.8, s * 1.1), b = T(s * 0.8, s * 1.1), c = T(0, s * 2.1); out.push(<path key={k('d')} className="iso-sym" d={`M${a[0]},${a[1]} Q${c[0]},${c[1]} ${b[0]},${b[1]} Z`} />); } break;
      case 'knifegate': stem(2); line(T(-s * 0.35, s * 2), T(s * 0.35, s * 2), 'iso-sym', 'hw'); line(T(-s * 0.25, s * 0.75), T(s * 0.25, s * 0.75), 'iso-sym thick', 'kb'); break;
      case 'control': case 'regulator': {
        stem(1.3);
        const a = T(-s * 0.9, s * 1.3), b = T(s * 0.9, s * 1.3), c = T(0, s * 2.5);
        out.push(<path key={k('a')} className="iso-sym" d={`M${a[0]},${a[1]} Q${c[0]},${c[1]} ${b[0]},${b[1]} Z`} />);
        if (type === 'regulator') { const p1 = T(s * 0.9, s * 1.3), p2 = X(s * 2.2, 0); out.push(<line key={k('s')} className="iso-off" x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} />); } // sensing line downstream
        break;
      }
      case 'solenoid': stem(1.2); out.push(<polygon key={k('r')} className="iso-sym" points={`${PT(-s * 0.55, s * 1.2)} ${PT(s * 0.55, s * 1.2)} ${PT(s * 0.55, s * 2.1)} ${PT(-s * 0.55, s * 2.1)}`} />);
        { const tt = T(0, s * 1.65); out.push(<text key={k('t')} className="iso-symtext" x={tt[0]} y={tt[1] + 2.5} textAnchor="middle">S</text>); } break;
    }
    return out;
  }
  switch (type) {
    case 'flange': for (const t of [-2.2, 2.2]) line(X(t, s), X(t, -s), 'iso-sym thick', 'f' + t); break;
    case 'orifice': for (const t of [-2.6, 2.6]) line(X(t, s), X(t, -s), 'iso-sym thick', 'f' + t); line(X(0, s * 1.25), X(0, -s * 1.25), 'iso-sym', 'pl');
      { const t = X(0, s * 2); out.push(<text key={k('t')} className="iso-symtext" x={t[0]} y={t[1] + 3} textAnchor="middle">FO</text>); } break;
    case 'spectacle': { line(X(0, s), X(0, -s), 'iso-sym thick', 'b'); const r = X(0, s * 1.7), f = X(0, -s * 1.7); line(X(0, s), r, 'iso-sym', 'w1'); line(X(0, -s), f, 'iso-sym', 'w2');
      out.push(<circle key={k('r')} className="iso-symball" cx={r[0]} cy={r[1]} r={s * 0.55} />); out.push(<circle key={k('f')} className="iso-symfill" cx={f[0]} cy={f[1]} r={s * 0.55} />); break; }
    case 'reducer': out.push(<polygon key={k('r')} className="iso-sym" points={`${P(-s, -s)} ${P(s, -s * 0.5)} ${P(s, s * 0.5)} ${P(-s, s)}`} />); break;
    case 'eccreducer': out.push(<polygon key={k('r')} className="iso-sym" points={`${P(-s, -s)} ${P(s, -s)} ${P(s, 0)} ${P(-s, s)}`} />); break;
    case 'swage': out.push(<polygon key={k('r')} className="iso-sym" points={`${P(-s * 1.4, -s * 0.8)} ${P(-s * 0.4, -s * 0.8)} ${P(s * 0.4, -s * 0.4)} ${P(s * 1.4, -s * 0.4)} ${P(s * 1.4, s * 0.4)} ${P(s * 0.4, s * 0.4)} ${P(-s * 0.4, s * 0.8)} ${P(-s * 1.4, s * 0.8)}`} />); break;
    case 'union': for (const t of [-3, 0, 3]) line(X(t, s * 0.8), X(t, -s * 0.8), 'iso-sym', 'u' + t); break;
    case 'coupling': out.push(<polygon key={k('r')} className="iso-sym" points={`${P(-s * 0.7, -s * 0.6)} ${P(s * 0.7, -s * 0.6)} ${P(s * 0.7, s * 0.6)} ${P(-s * 0.7, s * 0.6)}`} />); break;
    case 'dielectric': gap(); for (const t of [-2.5, 2.5]) line(X(t, s * 0.9), X(t, -s * 0.9), 'iso-sym thick', 'f' + t);
      out.push(<polygon key={k('r')} className="iso-symfill" points={`${P(-1, -s * 0.5)} ${P(1, -s * 0.5)} ${P(1, s * 0.5)} ${P(-1, s * 0.5)}`} />); break;
    case 'expjoint': gap(); line(X(-s, s * 0.9), X(-s, -s * 0.9), 'iso-sym thick', 'e1'); line(X(s, s * 0.9), X(s, -s * 0.9), 'iso-sym thick', 'e2');
      out.push(<polyline key={k('z')} className="iso-sym nofill" points={[-1, -0.5, 0, 0.5, 1].map((t, j) => P(t * s, (j % 2 ? 0.8 : -0.8) * s)).join(' ')} />); break;
    case 'flexhose': gap(); out.push(<polyline key={k('z')} className="iso-sym nofill" points={[-1, -0.66, -0.33, 0, 0.33, 0.66, 1].map((t, j) => P(t * s * 1.05, j === 0 || j === 6 ? 0 : (j % 2 ? 0.5 : -0.5) * s)).join(' ')} />); break;
    case 'ystrainer': line(X(-s * 0.4, 0), X(s * 0.6, s * 1.5), 'iso-sym thick', 'y'); line(X(s * 0.25, s * 1.75), X(s * 0.95, s * 1.25), 'iso-sym', 'yc'); break;
    case 'basket': out.push(<polygon key={k('r')} className="iso-sym" points={`${P(-s * 0.8, -s * 0.6)} ${P(s * 0.8, -s * 0.6)} ${P(s * 0.8, s * 1.7)} ${P(-s * 0.8, s * 1.7)}`} />); line(X(-s * 0.4, s * 0.1), X(s * 0.4, s * 0.1), 'iso-off', 'bk'); break;
    case 'trap': case 'flowmeter': case 'sightglass': {
      out.push(<circle key={k('c')} className="iso-symball" cx={m[0]} cy={m[1]} r={s * 0.95} />);
      if (type === 'sightglass') out.push(<circle key={k('i')} className="iso-symball" cx={m[0]} cy={m[1]} r={s * 0.45} />);
      else out.push(<text key={k('t')} className="iso-symtext" x={m[0]} y={m[1] + 2.5} textAnchor="middle">{type === 'trap' ? 'T' : 'FM'}</text>);
      break;
    }
    case 'spool': for (const t of [-3, 3]) line(X(t - 2, s), X(t + 2, -s), 'iso-sym', 'sp' + t); break;
  }
  return out;
}

/** Symbol at an elbow or branch point. legs = unit screen directions leaving the point. */
export function nodeSymbol(type: string | undefined, kind: 'elbow' | 'tee' | 'cross', p: V2, legs: V2[], key: string, labelDir?: V2, size?: string, onLabel?: (text: string, dir: V2, dist: number) => void): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const s = 6;
  const at = (u: V2, a: number, w = 0): [number, number] => [p[0] + u[0] * a - u[1] * w, p[1] + u[1] * a + u[0] * w];
  const pts = (...q: Array<[number, number]>) => q.map((x) => `${x[0].toFixed(1)},${x[1].toFixed(1)}`).join(' ');
  /** valve body triangle on a leg, point at the center */
  const tri = (u: V2, kk: string) => out.push(<polygon key={key + kk} className="iso-sym" points={pts([p[0], p[1]], at(u, s * 1.5, s * 0.75), at(u, s * 1.5, -s * 0.75))} />);
  // outside of the bend / away from all legs: where labels and stems go
  let bx = 0, by = 0; legs.forEach((l) => { bx -= l[0]; by -= l[1]; });
  const bl = Math.hypot(bx, by);
  const [ox, oy] = labelDir ?? (bl > 0.1 ? [bx / bl, by / bl] : legs.length ? [-legs[0][1], legs[0][0]] : [0, -1]);
  const label = (t: string, d = 15) => onLabel ? onLabel(t, [ox, oy], d) : out.push(<text key={key + 'lb'} className="iso-fit" x={p[0] + ox * d} y={p[1] + oy * d + 3} textAnchor="middle">{t}</text>);
  // for branches: the leg that isn't straight through (the branch), and a header leg
  const isHeader = (j: number) => legs.some((m, k) => k !== j && legs[j][0] * m[0] + legs[j][1] * m[1] < -0.98);
  const branch = legs.find((_, j) => !isHeader(j)) ?? legs[legs.length - 1];
  const header = legs.find((_, j) => isHeader(j)) ?? legs[0];

  if (type === 'anglevalve' || type === 'threeway') {
    legs.forEach((l, j) => tri(l, 't' + j));
    const st = at([ox, oy], 12), hw1 = [st[0] - oy * 5, st[1] + ox * 5], hw2 = [st[0] + oy * 5, st[1] - ox * 5];
    out.push(<line key={key + 'st'} className="iso-sym" x1={p[0]} y1={p[1]} x2={st[0]} y2={st[1]} />);
    out.push(<line key={key + 'hw'} className="iso-sym" x1={hw1[0]} y1={hw1[1]} x2={hw2[0]} y2={hw2[1]} />);
    return out;
  }
  if (kind === 'elbow' && legs.length === 2) {
    const [u1, u2] = legs;
    if (type === 'r3' || type === 'r5') {
      // long-radius bend: round the corner off
      const r = type === 'r3' ? 11 : 15;
      const a1 = at(u1, r), a2 = at(u2, r);
      out.push(<polyline key={key + 'gap'} className="iso-gap nofill" points={pts(a1, [p[0], p[1]], a2)} />);
      out.push(<path key={key + 'arc'} className="iso-pipe nofill" d={`M${a1[0].toFixed(1)},${a1[1].toFixed(1)} Q${p[0].toFixed(1)},${p[1].toFixed(1)} ${a2[0].toFixed(1)},${a2[1].toFixed(1)}`} />);
      label(type === 'r3' ? '3R' : '5R', 12);
      return out;
    }
    if (type === 'miter') {
      // miter joint across the corner, square to the bisector
      const m = [u1[0] + u2[0], u1[1] + u2[1]], ml = Math.hypot(m[0], m[1]) || 1;
      const q: V2 = [-m[1] / ml, m[0] / ml];
      const c = [p[0] + (m[0] / ml) * 3, p[1] + (m[1] / ml) * 3];
      out.push(<line key={key + 'mj'} className="iso-sym thick" x1={c[0] + q[0] * 6} y1={c[1] + q[1] * 6} x2={c[0] - q[0] * 6} y2={c[1] - q[1] * 6} />);
      label('MITER');
      return out;
    }
    const L: Record<string, string> = { sr: 'SR', thd90: 'THD' };
    if (type && L[type]) label(L[type]);
    return out;
  }
  if (kind === 'elbow') return out;
  // ---- branches
  switch (type) {
    case 'redtee': {
      // reducing tee: tee body plus a reducer on the branch outlet, narrowing away from the run
      out.push(<polygon key={key + 'rt'} className="iso-sym" points={pts(at(branch, 3, 5), at(branch, 13, 2.6), at(branch, 13, -2.6), at(branch, 3, -5))} />);
      out.push(<circle key={key + 'd'} className="iso-symfill" cx={p[0]} cy={p[1]} r={3} />);
      label(size ? `RED TEE ${size}` : 'RED TEE');
      return out;
    }
    case 'weldolet': case 'sockolet': case 'threadolet': {
      // olet: saddle body sitting on the header, widening onto the pipe
      out.push(<polygon key={key + 'ol'} className="iso-olet" points={pts(at(branch, 0, 6), at(branch, 10, 3.2), at(branch, 10, -3.2), at(branch, 0, -6))} />);
      label(size ? `${type === 'weldolet' ? 'WOL' : type === 'sockolet' ? 'SOL' : 'TOL'} ${size}` : type === 'weldolet' ? 'WOL' : type === 'sockolet' ? 'SOL' : 'TOL', 17);
      return out;
    }
    case 'stubin': label(size ? `STUB-IN ${size}` : 'STUB-IN', 17); return out;
    case 'lateral': {
      // lateral: the branch leaves at 45°, drawn as a body between the branch and the header
      const h = at(header, 11), b = at(branch, 11);
      out.push(<polygon key={key + 'lat'} className="iso-sym" points={pts([p[0], p[1]], h, b)} />);
      label('LAT', 17);
      return out;
    }
    default:
      out.push(<circle key={key + 'd'} className="iso-symfill" cx={p[0]} cy={p[1]} r={3} />);
      return out;
  }
}

/** Where the joint marks go on each leg of a fitting point (offset along the leg), or null for no mark on that leg. */
export function legJoint(type: string | undefined, legs: V2[], j: number, conn: Conn): { off: number; conn: Conn } | null {
  const header = legs.some((m, k) => k !== j && legs[j][0] * m[0] + legs[j][1] * m[1] < -0.98);
  switch (type) {
    case 'weldolet': return header ? null : { off: 12, conn: 'bw' };
    case 'sockolet': return header ? null : { off: 12, conn: 'sw' };
    case 'threadolet': return header ? null : { off: 12, conn: 'thd' };
    case 'stubin': return header ? null : { off: 3, conn: 'bw' };
    case 'r3': case 'r5': return { off: type === 'r3' ? 12 : 16, conn };
    case 'anglevalve': case 'threeway': return { off: 12, conn };
    case 'redtee': return { off: header ? 8 : 15, conn };
    case 'lateral': return { off: 13, conn };
    case 'thd90': return { off: 8, conn: 'thd' };
    case 'miter': return null;
  }
  return { off: 8, conn };
}

/** Symbol at the end of a line. u = unit screen direction from the end back along the pipe. */
export function endSymbol(type: string, p: V2, u: V2, key: string, exportMode?: boolean, conn?: Conn): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const o: V2 = [-u[0], -u[1]]; // outward
  const { P, X } = frame(p, o);
  const s = 6.5;
  const txt = (t: string, a: number, b: number) => { const q = X(a, b); out.push(<text key={key + 't' + t} className="iso-fit" x={q[0]} y={q[1] + 3} textAnchor="middle">{t}</text>); };
  switch (type) {
    case 'open': if (!exportMode) out.push(<circle key={key} className="iso-endpt" cx={p[0]} cy={p[1]} r={2.6} />); break;
    case 'cap': { const a = X(0, s), b = X(0, -s), c = X(s * 1.1, 0); out.push(<path key={key} className="iso-sym" d={`M${a[0]},${a[1]} Q${c[0]},${c[1]} ${b[0]},${b[1]}`} />); break; }
    case 'flange': case 'blind': {
      const a = X(0, s * 1.2), b = X(0, -s * 1.2); out.push(<line key={key} className="iso-sym thick" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />);
      if (type === 'blind') { const c = X(3, s * 1.2), d = X(3, -s * 1.2); out.push(<line key={key + 'b'} className="iso-sym thick" x1={c[0]} y1={c[1]} x2={d[0]} y2={d[1]} />); }
      break;
    }
    case 'plug': out.push(<polygon key={key} className="iso-symfill" points={`${P(0, -3)} ${P(5, -3)} ${P(5, 3)} ${P(0, 3)}`} />); break;
    case 'threaded': for (const t of [-6, -3, 0]) { const a = X(t, 3), b = X(t + 1.5, -3); out.push(<line key={key + t} className="iso-sym" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />); } break;
    case 'weld': out.push(<circle key={key} className="iso-weld" cx={p[0]} cy={p[1]} r={3} />); txt('FW', 6, -9); break;
    case 'nozzle': {
      // equipment: the box, joined to the pipe by whatever connection was chosen (flanged unless set)
      const cn = conn ?? 'flg';
      const gap = 9; // a short nozzle stub between the joint and the equipment, so the joint mark reads clearly
      out.push(<line key={key + 'nz'} className="iso-pipe thin" {...seg(X(0, 0), X(gap, 0))} />);
      out.push(...jointMark(cn, X(cn === 'flg' ? 2.5 : 2, 0), o, key + 'j'));
      out.push(<polygon key={key} className="iso-equip" points={`${P(gap, -s * 2.4)} ${P(gap + s * 2.6, -s * 2.4)} ${P(gap + s * 2.6, s * 2.4)} ${P(gap, s * 2.4)}`} />);
      break;
    }
    case 'hose': for (const t of [0, 3]) out.push(<line key={key + t} className="iso-sym" {...seg(X(t, s * 0.8), X(t, -s * 0.8))} />); txt('HC', 10, 0); break;
    case 'gauge': { out.push(<line key={key + 's'} className="iso-sym" {...seg(X(0, 0), X(s * 1.3, 0))} />); const c = X(s * 2.1, 0); out.push(<circle key={key} className="iso-symball" cx={c[0]} cy={c[1]} r={s * 0.8} />); out.push(<line key={key + 'n'} className="iso-sym" {...seg(c, X(s * 2.4, s * 0.45))} />); break; }
    case 'thermowell': out.push(<polygon key={key} className="iso-sym" points={`${P(0, -2.5)} ${P(s * 1.6, -2.5)} ${P(s * 1.6, 2.5)} ${P(0, 2.5)}`} />); txt('TW', s * 2.8, 0); break;
    case 'reducer': case 'eccreducer':
      out.push(<polygon key={key} className="iso-sym" points={type === 'reducer' ? `${P(0, -s)} ${P(s * 2, -s * 0.5)} ${P(s * 2, s * 0.5)} ${P(0, s)}` : `${P(0, -s)} ${P(s * 2, -s)} ${P(s * 2, 0)} ${P(0, s)}`} />);
      break;
    case 'relief': case 'vent': case 'drain': {
      out.push(...lineSymbol('gate', X(s, 0), o, s * 0.8, key + 'v').filter((_, j) => j === 0));
      if (type === 'relief') { const pts = [0, 1, 2, 3, 4].map((j) => P(s + (j % 2 ? 2.5 : -2.5), s * 0.6 + j * 2.2)).join(' '); out.push(<polyline key={key + 'z'} className="iso-sym nofill" points={pts} />); txt('PSV', s * 3.2, 0); }
      else { const a = X(s * 1.8, s * 0.7), b = X(s * 1.8, -s * 0.7), c = X(s * 2.6, 0); out.push(<path key={key + 'c'} className="iso-sym" d={`M${a[0]},${a[1]} Q${c[0]},${c[1]} ${b[0]},${b[1]}`} />); txt(type === 'vent' ? 'V' : 'D', s, -s * 1.8); }
      break;
    }
  }
  return out;
}
const seg = (a: [number, number] | V2, b: [number, number] | V2) => ({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });

/** Small picture of a catalog item for the palette. */
export function PaletteIcon({ item }: { item: CatalogItem }) {
  const W = 46, H = 28;
  let body: React.ReactNode[] = [];
  if (item.kind === 'line') {
    body = [<line key="p" className="iso-pipe thin" x1={2} y1={15} x2={W - 2} y2={15} />, ...lineSymbol(item.id, [W / 2, 15], [1, 0], 6.5, 'i')];
  } else if (item.kind === 'elbow') {
    body = [<polyline key="p" className="iso-pipe thin nofill" points={`4,22 26,22 26,3`} />, ...nodeSymbol(item.id, 'elbow', [26, 22], [[-1, 0], [0, -1]], 'i', [-0.75, -0.66])];
  } else if (item.kind === 'branch') {
    body = [<line key="p" className="iso-pipe thin" x1={2} y1={22} x2={W - 2} y2={22} />, <line key="b" className="iso-pipe thin" x1={W / 2} y1={22} x2={W / 2} y2={3} />,
      ...nodeSymbol(item.id, 'tee', [W / 2, 22], [[-1, 0], [1, 0], [0, -1]], 'i', [0.75, -0.66])];
  } else {
    body = [<line key="p" className="iso-pipe thin" x1={2} y1={15} x2={18} y2={15} />, ...endSymbol(item.id, [18, 15], [-1, 0], 'i')];
  }
  return <svg className="palicon" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">{body}</svg>;
}

/**
 * Joint mark at a fitting end, by connection type:
 * butt weld ●, socket weld ● with a socket bracket, threaded | (one tick), soldered ○, glued ■, flanged ‖.
 * p = where the joint is, u = unit direction of the pipe there.
 */
export function jointMark(conn: Conn, p: V2, u: V2, key: string): React.ReactNode[] {
  const n: V2 = [u[1], -u[0]];
  const L = (a: number, b: number, c: number, d: number, cls: string, k: string) =>
    <line key={key + k} className={cls} x1={p[0] + u[0] * a + n[0] * b} y1={p[1] + u[1] * a + n[1] * b} x2={p[0] + u[0] * c + n[0] * d} y2={p[1] + u[1] * c + n[1] * d} />;
  switch (conn) {
    case 'bw': return [<circle key={key} className="iso-weld" cx={p[0]} cy={p[1]} r={2.3} />];
    case 'sw': return [<circle key={key} className="iso-weld" cx={p[0]} cy={p[1]} r={2} />, L(-2.5, 4, 2.5, 4, 'iso-sym', 'a'), L(-2.5, -4, 2.5, -4, 'iso-sym', 'b')];
    case 'thd': return [L(0, -4.5, 0, 4.5, 'iso-sym thick', 't')];
    case 'solder': return [<circle key={key} className="iso-symball" cx={p[0]} cy={p[1]} r={2.6} />];
    case 'glue': return [<rect key={key} className="iso-symfill" x={p[0] - 2.3} y={p[1] - 2.3} width={4.6} height={4.6} />];
    case 'flg': return [L(-1.6, -5.5, -1.6, 5.5, 'iso-sym thick', 'f1'), L(1.6, -5.5, 1.6, 5.5, 'iso-sym thick', 'f2')];
  }
  return [];
}

/** Little legend picture of a joint type for buttons. */
export function JointIcon({ conn }: { conn: Conn }) {
  return (
    <svg className="jointicon" viewBox="0 0 26 14" width={26} height={14} aria-hidden="true">
      <line className="iso-pipe thin" x1={1} y1={7} x2={25} y2={7} />
      {jointMark(conn, [13, 7], [1, 0], 'j')}
    </svg>
  );
}
