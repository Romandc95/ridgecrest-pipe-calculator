// Build without Vite: esbuild bundles React + TypeScript.
//   node scripts/build.mjs            -> dist/ (installable PWA with service worker)
//   node scripts/build.mjs --preview  -> dist-preview/index.html (single self-contained file, no service worker)
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const preview = process.argv.includes('--preview');
const out = preview ? 'dist-preview' : 'dist';
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets'), { recursive: true });

// In the preview build React comes from the pinned cdnjs UMD build (window.React / window.ReactDOM).
const umdReact = {
  name: 'umd-react',
  setup(b) {
    b.onResolve({ filter: /^react(-dom)?(\/client)?$/ }, (a) => ({ path: a.path, namespace: 'umd' }));
    b.onLoad({ filter: /.*/, namespace: 'umd' }, (a) => ({ contents: `module.exports = window.${a.path.startsWith('react-dom') ? 'ReactDOM' : 'React'};`, loader: 'js' }));
  },
};
const res = await build({
  entryPoints: ['src/main.tsx'], bundle: true, minify: true, format: 'esm', target: ['safari15', 'es2020'],
  write: false, outdir: 'out', define: { __PREVIEW__: String(preview), 'process.env.NODE_ENV': '"production"' },
  ...(preview ? { jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', plugins: [umdReact] } : { jsx: 'automatic' }),
  loader: { '.css': 'css' }, logLevel: 'warning',
});
const js = res.outputFiles.find((f) => f.path.endsWith('.js')).text;
const css = res.outputFiles.find((f) => f.path.endsWith('.css')).text;
const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);
let html = readFileSync('index.html', 'utf8');

if (preview) {
  // Fragment for the Claude artifact host (it supplies doctype/head/body).
  const frag = `<title>Ridgecrest Pipe Calculator</title>
<meta name="theme-color" content="#0d1013">
<style>html,body{height:100%}${css}</style>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script type="module">${js.replace(/<\/script/g, '<\\/script')}</script>
`;
  writeFileSync(join(out, 'ridgecrest-pipe-calculator.html'), frag);
  html = frag;
  console.log(`preview: ${out}/ridgecrest-pipe-calculator.html (${(html.length / 1024).toFixed(0)} KB)`);
} else {
  const jsName = `assets/app-${h(js)}.js`, cssName = `assets/app-${h(css)}.css`;
  writeFileSync(join(out, jsName), js); writeFileSync(join(out, cssName), css);
  html = html.replace('<!--CSS-->', `<link rel="stylesheet" href="./${cssName}" />`).replace('<!--JS-->', `<script type="module" src="./${jsName}"></script>`);
  writeFileSync(join(out, 'index.html'), html);
  cpSync('public', out, { recursive: true });
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p.slice(out.length + 1).replaceAll('\\', '/')); } };
  walk(out);
  const version = h(files.map((f) => f + readFileSync(join(out, f)).length).join('|') + js + css);
  const precache = ['./', ...files.map((f) => './' + f)];
  writeFileSync(join(out, 'sw.js'), readFileSync('src/sw.template.js', 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache)));
  console.log(`built ${out}/ (${files.length} files, cache ${version})`);
}
