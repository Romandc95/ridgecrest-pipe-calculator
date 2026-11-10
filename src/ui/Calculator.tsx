import React, { useEffect, useRef, useState } from 'react';
import { press, initialState, CalcState, Key, CONV_MAP, entryText, DEFAULT_REGS } from '../engine/calculator';
import { formatQ, secondaryText } from '../engine/format';
import { MATERIALS } from '../engine/pipedata';
import { Tok } from '../engine/expr';
import { useApp } from './components';
import { usePersistent, shareText } from './store';

/** Back key: the outlined "delete" arrow with an ×. */
function BackIcon() {
  return <svg viewBox="0 0 28 22" width="26" height="20" aria-hidden="true"><path d="M9.2 3h14.3A2.5 2.5 0 0 1 26 5.5v11a2.5 2.5 0 0 1-2.5 2.5H9.2a1.4 1.4 0 0 1-1-.45L2.6 11.9a1.3 1.3 0 0 1 0-1.8l5.6-6.65A1.4 1.4 0 0 1 9.2 3Z" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round" /><path d="m12.8 7.6 6.8 6.8m0-6.8-6.8 6.8" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" /></svg>;
}

interface KeyDef { k: Key; label: React.ReactNode; cls: string; aria: string }
const L = (k: Key, label: React.ReactNode, cls: string, aria?: string): KeyDef => ({ k, label, cls, aria: aria ?? (typeof label === 'string' ? label : k) });

export const KEYPAD: KeyDef[][] = [
  [L('angle', <>Angle<br />Slope</>, 'proj', 'Angle/Slope'), L('offset', 'Offset', 'proj'), L('run', 'Run', 'proj'), L('travel', 'Travel', 'proj'), L('material', <>Pipe<br />Matl</>, 'proj', 'Pipe Material')],
  [L('pow', <>x<sup>y</sup></>, 'fn', 'x to the y'), L('sin', 'Sin', 'fn'), L('cos', 'Cos', 'fn'), L('tan', 'Tan', 'fn'), L('size', <>Pipe<br />Size</>, 'proj', 'Pipe Size')],
  [L('(', '(', 'fn'), L(')', ')', 'fn'), L('circle', 'Circle', 'fn'), L('sq', <>x<sup>2</sup></>, 'fn', 'x squared'), L('sqrt', '√x', 'fn', 'square root')],
  [L('mm', 'mm', 'unit'), L('ft', 'Feet', 'unit'), L('in', 'Inch', 'unit'), L('frac', <span className="fracglyph">⁄</span>, 'unit', 'Fraction'), L('bksp', <BackIcon />, 'unit back', 'Back one keystroke')],
  [L('conv', 'Conv', 'conv'), L('7', '7', 'num'), L('8', '8', 'num'), L('9', '9', 'num'), L('div', '÷', 'op', 'divide')],
  [L('store', 'Stor', 'mem', 'Store'), L('4', '4', 'num'), L('5', '5', 'num'), L('6', '6', 'num'), L('mul', '×', 'op', 'multiply')],
  [L('recall', 'Rcl', 'mem', 'Recall'), L('1', '1', 'num'), L('2', '2', 'num'), L('3', '3', 'num'), L('sub', '−', 'op', 'subtract')],
  [L('mplus', 'M+', 'mem'), L('0', '0', 'num'), L('.', '.', 'num', 'decimal point'), L('eq', '=', 'op eq', 'equals'), L('add', '+', 'op', 'add')],
];

const OPSYM: Record<string, string> = { '+': '+', '-': '−', '*': '×', '/': '÷', '^': '^', root: 'ʸ√' };

export function Calculator({ onOpenPrefs }: { onOpenPrefs: () => void }) {
  const { settings, saveItem, toast } = useApp();
  const opts = { chain: settings.chain, prefs: settings.prefs, lossMethod: settings.lossMethod };
  const [s, setS] = usePersistent<CalcState>('calc', initialState());
  const [tape, setTape] = useState(false);
  const lastEvalId = useRef(s.lastEval?.id ?? 0);
  const prefsN = useRef(s.openPrefs);

  const fmt = (q: Parameters<typeof formatQ>[0]) => formatQ(q, settings.prefs);
  const exprText = (toks: Tok[]) => toks.map((t) => (t.t === 'v' ? fmt(t.q) : t.t === 'op' ? ` ${OPSYM[t.op]} ` : t.t)).join('');

  useEffect(() => {
    if (s.lastEval && s.lastEval.id !== lastEvalId.current) {
      lastEvalId.current = s.lastEval.id;
      const e = `${exprText(s.lastEval.tokens)} = ${fmt(s.lastEval.result)}`;
      saveItem({ kind: 'calc', title: 'Calculation', summary: e });
    }
    if (s.openPrefs !== prefsN.current) { prefsN.current = s.openPrefs; onOpenPrefs(); }
  }, [s.lastEval?.id, s.openPrefs]);

  // Back (⌫) steps back one keystroke at a time — digits, operators, units, =, even C — by restoring the
  // calculator exactly as it was before that key. Kept for this visit (the last 200 keystrokes).
  const sRef = useRef(s); sRef.current = s;
  const hist = useRef<CalcState[]>([]);
  const tap = (k: Key) => {
    if (settings.haptics && 'vibrate' in navigator) { try { navigator.vibrate(6); } catch { /* */ } }
    if (k === 'bksp' && !sRef.current.conv) { // with Conv lit this key is Conv → Force
      const prev = hist.current.pop();
      if (prev) { sRef.current = prev; setS(prev); return; }
    } else { hist.current.push(JSON.parse(JSON.stringify(sRef.current)) as CalcState); /* deep copy: press() updates arrays in place */ if (hist.current.length > 200) hist.current.shift(); }
    const p = sRef.current;
    const next = press({ ...initialState(), ...p, regs: { ...DEFAULT_REGS(), ...p.regs } }, k, opts);
    sRef.current = next; setS(next);
  };

  // hardware keyboard support (desktop / iPad)
  useEffect(() => {
    const map: Record<string, Key> = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '=': 'eq', Enter: 'eq', Backspace: 'bksp', Escape: 'C', '(': '(', ')': ')', '.': '.', "'": 'ft', '"': 'in', '^': 'pow' };
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,select,textarea')) return;
      const k = /^[0-9]$/.test(e.key) ? (e.key as Key) : map[e.key];
      if (k) { e.preventDefault(); tap(k); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const d = s.display;
  const main = s.entry ? entryText(s.entry) : d.q ? fmt(d.q) : d.text ?? '0';
  const sub = d.tag === 'error' ? null : (!s.entry && d.q ? secondaryText(d.q, settings.prefs) : null);
  const r = s.regs;
  const depth = s.tokens.filter((t) => t.t === '(').length - s.tokens.filter((t) => t.t === ')').length;
  const size = main.length > 22 ? 'xs' : main.length > 16 ? 'sm' : main.length > 11 ? 'md' : 'lg';
  const regChips: string[] = [];
  if (r.O !== undefined) regChips.push(`O ${fmt({ v: r.O, kind: 'len', dim: 1, unit: r.lenUnit })}`);
  if (r.A !== undefined) regChips.push(`A ${fmt({ v: r.A, kind: 'len', dim: 1, unit: r.lenUnit })}`);
  if (r.L !== undefined) regChips.push(`L ${fmt({ v: r.L, kind: 'len', dim: 1, unit: r.lenUnit })}`);
  if (r.theta !== undefined) regChips.push(`∠ ${r.theta.toFixed(2)}°`);
  if (r.roll !== undefined) regChips.push(`Roll ${fmt({ v: r.roll, kind: 'len', dim: 1, unit: 'infrac' })}`);
  if (r.takeout !== undefined) regChips.push(`TO ${fmt({ v: r.takeout, kind: 'len', dim: 1, unit: 'infrac' })}`);

  return (
    <div className="calc">
      <div className={'display' + (d.tag === 'error' ? ' err' : '')} aria-live="polite">
        <div className="ind">
          {s.conv && <b className="ind-conv">CONV</b>}
          {s.pending && <b className="ind-pend">{s.pending === 'store' ? 'STO' : 'RCL'}</b>}
          {s.mem.sum && <b>M</b>}
          {depth > 0 && <b>( {depth}</b>}
          {settings.chain && <b>CHAIN</b>}
          <span>1/{settings.prefs.fracDen}</span>
          <span className="grow" />
          <span>{MATERIALS[r.material].short} · {r.ptype}{r.nps ? ` · ${r.nps}"` : ''} · {r.elbow} · gap {fmt({ v: r.gap, kind: 'len', dim: 1, unit: 'infrac' })}</span>
        </div>
        <div className="expr">{s.tokens.length ? exprText(s.tokens) : d.label === '=' && s.lastEval ? exprText(s.lastEval.tokens) + ' =' : ''}</div>
        <div className="mainrow">
          {d.label && !s.entry && <span className={'dlabel tag-' + d.tag}>{d.label}</span>}
          <span className={'dval ' + size + (d.tag === 'error' ? ' errtext' : '')}>{d.tag === 'error' ? d.text : main}</span>
        </div>
        <div className="subrow">
          {!s.entry && (d.tag === 'entered' || d.tag === 'solved') && <i className={'tag tag-' + d.tag}>{d.tag === 'entered' ? 'stored' : 'solved'}</i>}
          {!s.entry && d.note && <span className="note">{d.note}</span>}
          {sub && <span className="dec">{sub}</span>}
          {d.tag === 'error' && <span className="note">Press C to clear</span>}
        </div>
        {regChips.length > 0 && <div className="regs">{regChips.map((c) => <span key={c}>{c}</span>)}</div>}
      </div>
      <div className="ctrl">
        <button onClick={() => tap('C')} className="cbtn clr" aria-label="Clear entry; press twice to clear project values">C</button>
        <button onClick={() => tap('AC')} className="cbtn">AC</button>
        <button onClick={() => tap('MC')} className="cbtn">MC</button>
        <button onClick={() => setTape(true)} className="cbtn">Tape</button>
        <button className="cbtn" onClick={async () => { const t = `${d.label ? d.label + ' ' : ''}${main}${sub ? '\n' + sub : ''}`; const m = await shareText(t); if (m) toast(m); }}>Share</button>
        <button className="cbtn" aria-label="Save to favorites" onClick={() => { saveItem({ kind: 'calc', title: d.label || 'Value', summary: `${d.label ? d.label + ' ' : ''}${main}${sub ? ' (' + sub + ')' : ''}` }); toast('Saved to history'); }}>★</button>
      </div>
      <div className={'keypad' + (s.conv ? ' conv-on' : '')}>
        {KEYPAD.flat().map((kd) => {
          const c = CONV_MAP[kd.k];
          return (
            <button key={kd.k} className={'key ' + kd.cls + (kd.k === 'conv' && s.conv ? ' active' : '')} onClick={() => tap(kd.k)} aria-label={kd.aria + (c ? `; Conv: ${c.label}` : '')}>
              {c && <span className="sec">{c.label}</span>}
              <span className="pri">{kd.label}</span>
            </button>
          );
        })}
      </div>
      {tape && (
        <div className="sheet" role="dialog" aria-label="Paperless tape" onClick={() => setTape(false)}>
          <div className="sheet-body" onClick={(e) => e.stopPropagation()}>
            <h3>Tape <small>(last 30 values of = calculations)</small></h3>
            {s.tapeQ.length === 0 && <p className="muted">No calculations yet.</p>}
            <ol className="tape">{s.tapeQ.map((t, i) => <li key={i} className={t.op === '=' ? 'tot' : ''}><span>{t.op === '=' ? 'TTL =' : t.op || '·'}</span><b>{fmt(t.q)}</b></li>)}</ol>
            <button className="btn" onClick={() => setTape(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
