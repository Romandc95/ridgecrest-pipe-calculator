// Print, JPEG and PDF output for a completed 11×17 ISO sheet. No libraries: the sheet SVG is drawn to a canvas,
// saved as JPEG, or wrapped in a one-page PDF (the JPEG embedded with DCTDecode) at the chosen paper size.

export interface Paper { id: string; label: string; w: number; h: number } // inches, landscape
export const PAPERS: Paper[] = [
  { id: 'tabloid', label: '11 × 17 (Tabloid / ANSI B)', w: 17, h: 11 },
  { id: 'letter', label: '8½ × 11 (Letter)', w: 11, h: 8.5 },
  { id: 'legal', label: '8½ × 14 (Legal)', w: 14, h: 8.5 },
  { id: 'archb', label: '12 × 18 (ARCH B)', w: 18, h: 12 },
  { id: 'archc', label: '18 × 24 (ARCH C)', w: 24, h: 18 },
  { id: 'ansic', label: '17 × 22 (ANSI C)', w: 22, h: 17 },
  { id: 'archd', label: '24 × 36 (ARCH D)', w: 36, h: 24 },
  { id: 'a4', label: 'A4 (210 × 297 mm)', w: 297 / 25.4, h: 210 / 25.4 },
  { id: 'a3', label: 'A3 (297 × 420 mm)', w: 420 / 25.4, h: 297 / 25.4 },
];
export const paperById = (id: string) => PAPERS.find((p) => p.id === id) ?? PAPERS[0];
const MARGIN = 0.25; // in

/** Fit a W×H drawing inside the paper's printable area: size and offset in inches. */
export function fitOnPaper(p: Paper, W: number, H: number) {
  const aw = p.w - 2 * MARGIN, ah = p.h - 2 * MARGIN;
  const k = Math.min(aw / W, ah / H);
  const w = W * k, h = H * k;
  return { w, h, x: (p.w - w) / 2, y: (p.h - h) / 2, scale: (w / 17) }; // scale vs. full 17" width
}

/** Draw the sheet SVG markup to a white canvas pxW wide. */
export function renderCanvas(svgMarkup: string, W: number, H: number, pxW: number): Promise<HTMLCanvasElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(pxW); c.height = Math.round((pxW * H) / W);
      const g = c.getContext('2d'); if (!g) { rej(new Error('no canvas')); return; }
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      res(c);
    };
    img.onerror = () => rej(new Error('Could not draw the sheet'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMarkup);
  });
}
/** Pixel width for a drawing printed w inches wide: ~200 dpi, capped so phones (16 MP canvas limit) can make it. */
export function pxFor(wIn: number, hIn: number, dpi = 200) {
  let px = wIn * dpi;
  const maxSide = 6000, maxArea = 15e6;
  px = Math.min(px, maxSide, Math.sqrt(maxArea * (wIn / hIn)));
  return Math.round(px);
}
const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the image'))), type, q));

export async function sheetJpeg(svgMarkup: string, W: number, H: number): Promise<Blob> {
  const c = await renderCanvas(svgMarkup, W, H, pxFor(17, 11));
  return toBlob(c, 'image/jpeg', 0.92);
}

/** A one-page PDF of the sheet at the chosen paper size (landscape, ¼" margins, drawing centred and scaled to fit). */
export async function sheetPdf(svgMarkup: string, W: number, H: number, paper: Paper, title: string): Promise<Blob> {
  const f = fitOnPaper(paper, W, H);
  const c = await renderCanvas(svgMarkup, W, H, pxFor(f.w, f.h));
  const jpg = new Uint8Array(await (await toBlob(c, 'image/jpeg', 0.92)).arrayBuffer());
  return new Blob([buildPdf(jpg, c.width, c.height, paper.w * 72, paper.h * 72, f.x * 72, f.y * 72, f.w * 72, f.h * 72, title)], { type: 'application/pdf' });
}

/** Minimal PDF 1.4: catalog, pages, one page, its content stream and the JPEG image XObject. */
export function buildPdf(jpg: Uint8Array, pxW: number, pxH: number, pageW: number, pageH: number, x: number, y: number, w: number, h: number, title = ''): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = []; let size = 0; const offs: number[] = [];
  const put = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); size += u.length; };
  const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
  const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, '').replace(/([()\\])/g, '\\$1');
  const obj = (id: number, body: string) => { offs[id] = size; put(`${id} 0 obj\n${body}\nendobj\n`); };
  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'.replace(/[\u0080-ÿ]/g, 'X'));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(pageW)} ${n(pageH)}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
  // PDF y runs up from the bottom; the offsets are symmetric so y is the same either way
  const content = `q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(pageH - y - h)} cm /Im0 Do Q`;
  obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  offs[5] = size;
  put(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
  put(jpg); put('\nendstream\nendobj\n');
  obj(6, `<< /Title (${esc(title)}) /Producer (PipeWorks Pro) >>`);
  const xref = size;
  let x2 = 'xref\n0 7\n0000000000 65535 f \n';
  for (let i = 1; i <= 6; i++) x2 += `${String(offs[i]).padStart(10, '0')} 00000 n \n`;
  put(x2 + `trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Save a file: on phones/tablets the share sheet (Save Image / Save to Files / AirDrop…), on desktop a download. */
export async function saveBlob(blob: Blob, name: string): Promise<string> {
  const file = new File([blob], name, { type: blob.type });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch) {
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return 'Saved'; } }
    catch (e) { if ((e as Error).name === 'AbortError') return ''; }
  }
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return `Saved ${name}`;
  } catch { return 'Saving files is not available here'; }
}

/**
 * Print the sheet at a paper size through the browser's own print dialog: the sheet is put in the page itself
 * (printing from a hidden frame fails on iPhone / iPad and in home-screen apps) and everything else is hidden for print.
 */
export function printSheet(svgMarkup: string, W: number, H: number, paper: Paper, title: string): boolean {
  document.getElementById('rc-print')?.remove(); document.getElementById('rc-print-css')?.remove();
  const f = fitOnPaper(paper, W, H);
  const holder = document.createElement('div'); holder.id = 'rc-print';
  holder.innerHTML = svgMarkup.replace(/<svg /, `<svg style="width:${f.w}in;height:${f.h}in;display:block" `);
  const css = document.createElement('style'); css.id = 'rc-print-css';
  css.textContent = `@page{size:${paper.w}in ${paper.h}in;margin:0}
@media screen{#rc-print{display:none}}
@media print{html,body{margin:0!important;padding:0!important;background:#fff!important;height:auto!important;overflow:visible!important}
body>*:not(#rc-print){display:none!important}
#rc-print{display:flex!important;align-items:center;justify-content:center;width:${paper.w}in;height:${paper.h}in;break-inside:avoid;page-break-inside:avoid}}`;
  document.head.appendChild(css); document.body.appendChild(holder);
  const old = document.title; document.title = title;
  const clean = () => { document.title = old; holder.remove(); css.remove(); window.removeEventListener('afterprint', clean); };
  window.addEventListener('afterprint', clean);
  try { window.print(); } catch { clean(); return false; }
  setTimeout(() => { if (document.getElementById('rc-print') === holder) clean(); }, 120000); // iOS sometimes skips afterprint
  return true;
}
