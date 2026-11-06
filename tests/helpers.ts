import { initialState, press, CalcState, Key, CONV_MAP, CalcOptions } from '../src/engine/calculator';
import { DEFAULT_PREFS, formatQ, FormatPrefs } from '../src/engine/format';

/** Run a key sequence. Tokens: key names; digits may be grouped ("24"); "c:" prefix = Conv + key. */
export function run(seq: string, opts: Partial<CalcOptions> = {}, s0?: CalcState): CalcState {
  const o: CalcOptions = { chain: false, prefs: DEFAULT_PREFS, ...opts };
  let s = s0 ?? initialState();
  for (const tok of seq.trim().split(/\s+/)) {
    if (!tok) continue;
    if (tok.startsWith('c:')) {
      const k = tok.slice(2) as Key;
      if (!(k in CONV_MAP)) throw new Error('no conv for ' + k);
      s = press(s, 'conv', o); s = press(s, k, o); continue;
    }
    if (/^[0-9.]+$/.test(tok)) { for (const ch of tok) s = press(s, ch as Key, o); continue; }
    s = press(s, tok as Key, o);
  }
  return s;
}
/** Display text as the UI would show it (label + formatted value). */
export function shown(s: CalcState, prefs: FormatPrefs = DEFAULT_PREFS): string {
  const d = s.display;
  const v = d.q ? formatQ(d.q, prefs) : d.text ?? '';
  return `${d.label ? d.label + ' ' : ''}${v}`;
}
export const val = (s: CalcState) => s.display.q!.v;
