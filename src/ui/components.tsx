import React, { createContext, useContext, useState } from 'react';
import { Settings, OutUnit, SavedItem, shareText } from './store';
import { formatQ, formatNumber, formatAngle } from '../engine/format';
import { Q } from '../engine/units';
import { tryParse } from '../engine/parse';

export interface AppCtxT {
  tools: Record<string, Record<string, string>>;
  setToolField: (tool: string, key: string, value: string) => void;
  replaceTool: (tool: string, inputs: Record<string, string>) => void;
  settings: Settings;
  setSettings: (f: (s: Settings) => Settings) => void;
  saveItem: (item: Omit<SavedItem, 'id' | 'ts' | 'fav'>) => void;
  toast: (msg: string) => void;
}
export const AppCtx = createContext<AppCtxT>(null as unknown as AppCtxT);
export const useApp = () => useContext(AppCtx);

/** Persistent input state for a guided tool. */
export function useTool(id: string, defaults: Record<string, string>): [Record<string, string>, (k: string, v: string) => void, () => void] {
  const { tools, setToolField, replaceTool } = useApp();
  const v = { ...defaults, ...(tools[id] ?? {}) };
  return [v, (k, val) => setToolField(id, k, val), () => replaceTool(id, { ...defaults })];
}

/** Format a length in inches per the chosen output unit. */
export function useLen() {
  const { settings } = useApp();
  return (inches: number, unit?: OutUnit) => formatQ({ v: inches, kind: 'len', dim: 1, unit: unit ?? settings.outUnit }, settings.prefs);
}
export function useFmt() {
  const { settings } = useApp();
  return {
    len: (inches: number, unit?: OutUnit) => formatQ({ v: inches, kind: 'len', dim: 1, unit: unit ?? settings.outUnit }, settings.prefs),
    dec: (inches: number) => `${formatNumber(inches, 4, 10)} in · ${formatNumber(inches * 25.4, 2, 10)} mm`,
    ang: (d: number) => formatAngle(d, { ...settings.prefs, degDecimals: 'float' }).replace(/(\.\d{4})\d+/, '$1'),
    q: (q: Q) => formatQ(q, settings.prefs),
    num: (v: number, d = 6) => formatNumber(v, d),
  };
}

export function Segmented<T extends string>({ value, options, onChange, small }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div className={'seg' + (small ? ' seg-sm' : '')} role="tablist">
      {options.map(([v, l]) => (
        <button key={v} role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

type Parser<T> = (s: string) => T;
export interface FieldProps<T> {
  label: string; value: string; onChange: (s: string) => void; parse?: Parser<T>;
  placeholder?: string; hint?: string; unitHint?: string; disabled?: boolean; derived?: string | null; inputMode?: 'decimal' | 'text';
}
export function Field<T>({ label, value, onChange, parse, placeholder, hint, unitHint, disabled, derived, inputMode = 'text' }: FieldProps<T>) {
  const p = parse ? tryParse(parse, value) : null;
  const err = p && !p.ok ? p.err : null;
  return (
    <label className={'field' + (err ? ' bad' : '') + (disabled ? ' dis' : '')}>
      <span className="flabel">{label}{unitHint && <em> {unitHint}</em>}</span>
      <span className="finput">
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={derived ? `= ${derived}` : placeholder} disabled={disabled}
          inputMode={inputMode} autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="done" />
        {value && <button type="button" className="fclear" aria-label={`Clear ${label}`} onClick={() => onChange('')}>×</button>}
      </span>
      {err ? <span className="ferr">{err}</span> : hint ? <span className="fhint">{hint}</span> : null}
    </label>
  );
}

export function Select({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span className="flabel">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

export interface Row { label: string; value: string; sub?: string; strong?: boolean; tag?: string; warn?: boolean }
export function Results({ rows, title = 'Results' }: { rows: Row[]; title?: string }) {
  return (
    <section className="results" aria-live="polite">
      <h3>{title}</h3>
      {rows.map((r, i) => (
        <div key={i} className={'rrow' + (r.strong ? ' strong' : '') + (r.warn ? ' warn' : '')}>
          <span className="rl">{r.label}{r.tag && <i className={'tag tag-' + r.tag}>{r.tag}</i>}</span>
          <span className="rv">{r.value}{r.sub && <small>{r.sub}</small>}</span>
        </div>
      ))}
    </section>
  );
}

export function Msg({ kind = 'error', children }: { kind?: 'error' | 'info' | 'warn'; children: React.ReactNode }) {
  return <div className={'msg msg-' + kind} role={kind === 'error' ? 'alert' : undefined}>{children}</div>;
}

export function Formula({ title = 'How it’s calculated', children }: { title?: string; children: React.ReactNode }) {
  return (
    <details className="formula">
      <summary>{title}</summary>
      <div className="fbody">{children}</div>
    </details>
  );
}

export function ToolActions({ tool, title, inputs, summary, disabled }: { tool: string; title: string; inputs: Record<string, string>; summary: string; disabled?: boolean }) {
  const { saveItem, toast } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <div className="actions">
      <button className="btn" disabled={disabled} onClick={() => { saveItem({ kind: 'guided', tool, title, inputs, summary }); toast('Saved to history'); }}>Save</button>
      <button className="btn" disabled={disabled || busy} onClick={async () => { setBusy(true); const m = await shareText(summary); setBusy(false); if (m) toast(m); }}>Copy / Share</button>
    </div>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={'card ' + className}>{children}</div>;
}

export function Grid({ children }: { children: React.ReactNode }) { return <div className="grid2">{children}</div>; }

export const LEN_HINT = `e.g. 5' 7 3/8", 7-3/8", 7.375 in, 150 mm`;
