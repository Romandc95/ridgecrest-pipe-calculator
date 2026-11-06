// Local persistence (localStorage). Everything stays on the device.
import { useEffect, useRef, useState } from 'react';
import { FormatPrefs, DEFAULT_PREFS } from '../engine/format';

export type OutUnit = 'ftin' | 'infrac' | 'indec' | 'ftdec' | 'mm' | 'm';

export interface Settings {
  theme: 'dark' | 'light' | 'system';
  prefs: FormatPrefs;
  chain: boolean;
  outUnit: OutUnit; // guided-mode length display
  haptics: boolean;
}
export const DEFAULT_SETTINGS: Settings = { theme: 'dark', prefs: DEFAULT_PREFS, chain: false, outUnit: 'infrac', haptics: true };

export interface SavedItem {
  id: string; ts: number; kind: 'calc' | 'guided'; tool?: string; title: string;
  inputs?: Record<string, string>; summary: string; fav: boolean; jobId?: string;
}
export interface Job { id: string; name: string; ts: number }

const PREFIX = 'ridgecrest.v1.';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) return { ...fallback, ...v };
    return v as T;
  } catch { return fallback; }
}
export function save(key: string, v: unknown) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(v)); } catch { /* storage unavailable (private mode / preview) */ }
}
export function storageAvailable(): boolean {
  try { const k = PREFIX + '__t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch { return false; }
}

/** useState that persists to localStorage (debounced). */
export function usePersistent<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => load(key, initial));
  const t = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => save(key, v), 150);
    return () => window.clearTimeout(t.current);
  }, [key, v]);
  return [v, setV];
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export async function shareText(text: string, title = 'Ridgecrest Pipe Calculator'): Promise<string> {
  try {
    if (navigator.share) { await navigator.share({ title, text }); return 'Shared'; }
  } catch (e) { if ((e as Error).name === 'AbortError') return ''; }
  try { await navigator.clipboard.writeText(text); return 'Copied to clipboard'; } catch { /* fallthrough */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove(); return 'Copied to clipboard';
  } catch { return 'Copy not available here'; }
}
