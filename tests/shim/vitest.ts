// Minimal vitest-compatible runner used where vitest cannot be installed. `npm test` uses real vitest.
type Fn = () => void;
const results: { name: string; ok: boolean; err?: string }[] = [];
let prefix: string[] = [];
export function describe(name: string, fn: Fn) { prefix.push(name); fn(); prefix.pop(); }
export function it(name: string, fn: Fn) {
  const full = [...prefix, name].join(' › ');
  try { fn(); results.push({ name: full, ok: true }); } catch (e) { results.push({ name: full, ok: false, err: (e as Error).message }); }
}
export const test = it;
function fmt(v: unknown) { try { return JSON.stringify(v); } catch { return String(v); } }
export function expect(actual: any) {
  const fail = (m: string) => { throw new Error(m); };
  const api = {
    toBe: (e: unknown) => { if (!Object.is(actual, e)) fail(`expected ${fmt(actual)} to be ${fmt(e)}`); },
    toEqual: (e: unknown) => { if (fmt(actual) !== fmt(e)) fail(`expected ${fmt(actual)} to equal ${fmt(e)}`); },
    toBeCloseTo: (e: number, digits = 2) => { if (!(Math.abs(actual - e) < Math.pow(10, -digits) / 2)) fail(`expected ${actual} ≈ ${e} (${digits} dp)`); },
    toBeGreaterThan: (e: number) => { if (!(actual > e)) fail(`expected ${actual} > ${e}`); },
    toBeLessThan: (e: number) => { if (!(actual < e)) fail(`expected ${actual} < ${e}`); },
    toMatch: (re: RegExp | string) => { if (!(typeof re === 'string' ? String(actual).includes(re) : re.test(String(actual)))) fail(`expected "${actual}" to match ${re}`); },
    toContain: (e: unknown) => { if (!(actual as any[]).includes(e)) fail(`expected ${fmt(actual)} to contain ${fmt(e)}`); },
    toBeNull: () => { if (actual !== null) fail(`expected null, got ${fmt(actual)}`); },
    toBeTruthy: () => { if (!actual) fail(`expected truthy, got ${fmt(actual)}`); },
    toThrow: (m?: RegExp | string) => {
      try { actual(); } catch (e) { const msg = (e as Error).message; if (m && !(typeof m === 'string' ? msg.includes(m) : m.test(msg))) fail(`threw "${msg}", expected ${m}`); return; }
      fail('expected to throw');
    },
  };
  return { ...api, not: { toBe: (e: unknown) => { if (Object.is(actual, e)) fail(`expected not ${fmt(e)}`); }, toThrow: () => { try { actual(); } catch (e) { fail(`unexpected throw: ${(e as Error).message}`); } } } };
}
export function report() {
  const bad = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : '\n    → ' + r.err}`);
  console.log(`\n${results.length - bad.length} passed, ${bad.length} failed, ${results.length} total`);
  if (bad.length) process.exitCode = 1;
}
