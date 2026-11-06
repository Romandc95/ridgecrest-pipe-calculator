// Local dev server with rebuild on save: http://localhost:5173
import { context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
mkdirSync('.dev', { recursive: true });
cpSync('public', '.dev', { recursive: true });
writeFileSync('.dev/index.html', readFileSync('index.html', 'utf8')
  .replace('<!--CSS-->', '<link rel="stylesheet" href="./main.css" />')
  .replace('<!--JS-->', '<script type="module" src="./main.js"></script>'));
const ctx = await context({
  entryPoints: ['src/main.tsx'], bundle: true, format: 'esm', outdir: '.dev', jsx: 'automatic', sourcemap: true,
  define: { __PREVIEW__: 'true', 'process.env.NODE_ENV': '"development"' }, loader: { '.css': 'css' },
});
await ctx.watch();
const { port } = await ctx.serve({ servedir: '.dev', port: 5173, host: '0.0.0.0' });
console.log(`Ridgecrest dev server: http://localhost:${port}  (service worker disabled in dev)`);
