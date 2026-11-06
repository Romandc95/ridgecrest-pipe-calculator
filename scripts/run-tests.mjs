// Runs the vitest-style test files with a tiny built-in shim (no network needed).
import { build } from 'esbuild';
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const files = readdirSync('tests').filter((f) => f.endsWith('.test.ts')).sort();
mkdirSync('.test-out', { recursive: true });
const entry = files.map((f) => `import './tests/${f}';`).join('\n') + `\nimport { report } from './tests/shim/vitest';\nreport();\n`;
writeFileSync('.test-out/entry.ts', entry.replaceAll('./tests/', '../tests/'));
await build({ entryPoints: ['.test-out/entry.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-out/all.mjs', alias: { vitest: './tests/shim/vitest.ts' }, logLevel: 'error' });
execFileSync('node', ['.test-out/all.mjs'], { stdio: 'inherit' });
