// Browser-only: turns a PDF or EPUB into chapters of plain text. Nothing here is uploaded or stored;
// the import page sends small chunks of the selected chapters to the phrase extractor and discards the rest.
export type Chapter = { title: string; text: string; words: number };
export type ParsedBook = { title: string; author: string | null; format: 'pdf' | 'epub'; chapters: Chapter[] };

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
const chapter = (title: string, paragraphs: string[]): Chapter => {
  const text = paragraphs.filter(Boolean).join('\n\n');
  return { title: clean(title) || 'Untitled', text, words: wordCount(text) };
};

export async function parseBook(file: File): Promise<ParsedBook> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const fallbackTitle = file.name.replace(/\.(pdf|epub)$/i, '');
  if (/\.epub$/i.test(file.name) || file.type === 'application/epub+zip') return parseEpub(buffer, fallbackTitle);
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return parsePdf(buffer, fallbackTitle);
  throw new Error('Please choose a PDF or EPUB file.');
}

// ---------- PDF ----------

async function parsePdf(data: Uint8Array, fallbackTitle: string): Promise<ParsedBook> {
  // Compile-time guard: keeps pdf.js (~2 MB) out of the Worker bundle; parsing only ever happens in the browser.
  if (import.meta.env.SSR) throw new Error('PDF parsing runs in the browser only');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const doc = await pdfjs.getDocument({ data }).promise;

  const pageLines: string[][] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const content = await (await doc.getPage(number)).getTextContent();
    const lines: string[] = [];
    let line = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      line += item.str;
      if (item.hasEOL) { lines.push(line.trim()); line = ''; }
    }
    if (line.trim()) lines.push(line.trim());
    pageLines.push(lines);
  }
  const pages = removeRunningHeaders(pageLines).map(linesToParagraphs);

  const info = (await doc.getMetadata().catch(() => null))?.info as { Title?: string; Author?: string } | undefined;
  const starts = await outlineStarts(doc);
  const chapters = starts.length
    ? starts.map((start, index) => chapter(start.title, pages.slice(start.page, starts[index + 1]?.page ?? pages.length).flat()))
    : Array.from({ length: Math.ceil(pages.length / 10) }, (_, index) =>
      chapter(`Pages ${index * 10 + 1}–${Math.min(pages.length, index * 10 + 10)}`, pages.slice(index * 10, index * 10 + 10).flat()));
  if (starts.length && starts[0].page > 0) chapters.unshift(chapter('Front matter', pages.slice(0, starts[0].page).flat()));

  return { title: clean(info?.Title ?? '') || fallbackTitle, author: clean(info?.Author ?? '') || null, format: 'pdf', chapters: chapters.filter(item => item.words >= 50) };
}

type PdfDoc = Awaited<ReturnType<typeof import('pdfjs-dist')['getDocument']>['promise']>;

// Top-level outline entries become chapters, ordered by the page they start on.
async function outlineStarts(doc: PdfDoc): Promise<Array<{ title: string; page: number }>> {
  const outline = await doc.getOutline().catch(() => null);
  if (!outline?.length) return [];
  const starts: Array<{ title: string; page: number }> = [];
  for (const entry of outline) {
    try {
      const dest = typeof entry.dest === 'string' ? await doc.getDestination(entry.dest) : entry.dest;
      const target = dest?.[0];
      if (target == null) continue;
      const page = typeof target === 'number' ? target : await doc.getPageIndex(target);
      starts.push({ title: entry.title, page });
    } catch { /* skip entries whose destination cannot be resolved */ }
  }
  return starts.sort((a, b) => a.page - b.page).filter((start, index, all) => index === 0 || start.page !== all[index - 1].page);
}

// Book titles, chapter names and page numbers repeat at the top/bottom of most pages; drop them.
function removeRunningHeaders(pages: string[][]): string[][] {
  const key = (line: string) => line.replace(/\d+/g, '#').toLowerCase();
  const counts = new Map<string, number>();
  for (const lines of pages) for (const line of [...lines.slice(0, 2), ...lines.slice(-2)]) counts.set(key(line), (counts.get(key(line)) ?? 0) + 1);
  const threshold = Math.max(3, pages.length * 0.2);
  return pages.map(lines => lines.filter((line, index) => {
    const edge = index < 2 || index >= lines.length - 2;
    return !/^\d+$/.test(line) && !(edge && (counts.get(key(line)) ?? 0) >= threshold);
  }));
}

// PDFs only have lines; a short line ending a sentence (or an empty line) usually ends a paragraph.
function linesToParagraphs(lines: string[]): string[] {
  const lengths = lines.filter(Boolean).map(line => line.length).sort((a, b) => a - b);
  const typical = lengths[Math.floor(lengths.length / 2)] ?? 0;
  const paragraphs: string[] = [];
  let current = '';
  for (const line of lines) {
    if (!line) { if (current) paragraphs.push(current); current = ''; continue; }
    current = !current ? line : current.endsWith('-') && /^[a-z]/.test(line) ? current.slice(0, -1) + line : `${current} ${line}`;
    if (/[.!?:"”)]$/.test(line) && line.length < typical * 0.85) { paragraphs.push(current); current = ''; }
  }
  if (current) paragraphs.push(current);
  return paragraphs.map(clean);
}

// ---------- EPUB ----------

const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt';

function parseMarkup(text: string, type: DOMParserSupportedType): Document {
  const doc = new DOMParser().parseFromString(text, type);
  return doc.getElementsByTagName('parsererror').length && type !== 'text/html' ? new DOMParser().parseFromString(text, 'text/html') : doc;
}

function resolvePath(base: string, href: string): string {
  const parts = (base ? `${base}/${decodeURIComponent(href.split('#')[0])}` : decodeURIComponent(href.split('#')[0])).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part && part !== '.') resolved.push(part);
  }
  return resolved.join('/');
}

async function parseEpub(data: Uint8Array, fallbackTitle: string): Promise<ParsedBook> {
  if (import.meta.env.SSR) throw new Error('EPUB parsing runs in the browser only');
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(data);
  const read = (path: string) => (files[path] ? strFromU8(files[path]) : null);

  const container = read('META-INF/container.xml');
  const opfPath = container && parseMarkup(container, 'application/xml').getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
  const opfText = opfPath && read(opfPath);
  if (!opfPath || !opfText) throw new Error('This EPUB is missing its package file.');
  const opf = parseMarkup(opfText, 'application/xml');
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const meta = (name: string) => clean(opf.getElementsByTagNameNS('*', name)[0]?.textContent ?? '');

  const manifest = new Map([...opf.getElementsByTagNameNS('*', 'item')].map(item => [item.getAttribute('id') ?? '', {
    path: resolvePath(base, item.getAttribute('href') ?? ''), type: item.getAttribute('media-type') ?? '', properties: item.getAttribute('properties') ?? '',
  }]));
  const tocTitles = readTocTitles(manifest, opf, read);

  const chapters: Chapter[] = [];
  for (const ref of opf.getElementsByTagNameNS('*', 'itemref')) {
    const item = manifest.get(ref.getAttribute('idref') ?? '');
    const markup = item && /html/.test(item.type) ? read(item.path) : null;
    if (!item || !markup) continue;
    const doc = parseMarkup(markup, 'application/xhtml+xml');
    const blocks = [...doc.querySelectorAll(BLOCKS)]
      .filter(element => !element.querySelector(BLOCKS) && !element.closest('pre, table, figure, nav, aside'))
      .map(element => clean(element.textContent ?? ''));
    const heading = clean(doc.querySelector('h1, h2, h3')?.textContent ?? '');
    chapters.push(chapter(tocTitles.get(item.path) || heading || `Section ${chapters.length + 1}`, blocks));
  }

  return { title: meta('title') || fallbackTitle, author: meta('creator') || null, format: 'epub', chapters: chapters.filter(item => item.words >= 80) };
}

// EPUB 3 navigation document, falling back to the EPUB 2 NCX.
function readTocTitles(manifest: Map<string, { path: string; type: string; properties: string }>, opf: Document, read: (path: string) => string | null): Map<string, string> {
  const titles = new Map<string, string>();
  const add = (base: string, href: string | null, title: string | null | undefined) => {
    const path = href && resolvePath(base, href);
    if (path && title && !titles.has(path)) titles.set(path, clean(title));
  };
  const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

  const nav = [...manifest.values()].find(item => item.properties.split(' ').includes('nav'));
  const navText = nav && read(nav.path);
  if (nav && navText) {
    const doc = parseMarkup(navText, 'application/xhtml+xml');
    const toc = [...doc.querySelectorAll('nav')].find(element => element.getAttributeNS('http://www.idpf.org/2007/ops', 'type') === 'toc' || element.getAttribute('epub:type') === 'toc') ?? doc;
    for (const link of toc.querySelectorAll('a[href]')) add(dirname(nav.path), link.getAttribute('href'), link.textContent);
  }
  const ncx = manifest.get(opf.getElementsByTagNameNS('*', 'spine')[0]?.getAttribute('toc') ?? '');
  const ncxText = ncx && read(ncx.path);
  if (ncx && ncxText) {
    for (const point of parseMarkup(ncxText, 'application/xml').getElementsByTagNameNS('*', 'navPoint')) {
      add(dirname(ncx.path), point.getElementsByTagNameNS('*', 'content')[0]?.getAttribute('src') ?? null, point.getElementsByTagNameNS('*', 'text')[0]?.textContent);
    }
  }
  return titles;
}

// ---------- Chunking for phrase extraction ----------

// Code listings, tables and captions add noise and cost; prose paragraphs are what carry learnable English.
const looksLikeProse = (paragraph: string) => {
  const symbols = (paragraph.match(/[{}()[\];=<>$#\\|_*/]/g) ?? []).length;
  return wordCount(paragraph) >= 6 && /[a-z]/.test(paragraph) && symbols / paragraph.length < 0.05;
};

export function chunkChapter(text: string, maxWords = 1000): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let words = 0;
  const flush = () => { if (current.length) chunks.push(current.join('\n\n')); current = []; words = 0; };
  for (const paragraph of text.split('\n\n').filter(looksLikeProse)) {
    const pieces = wordCount(paragraph) > maxWords ? paragraph.match(/[^.!?]+[.!?]+["”)]?\s*/g) ?? [paragraph] : [paragraph];
    for (const piece of pieces) {
      const count = wordCount(piece);
      if (words + count > maxWords) flush();
      current.push(piece.trim()); words += count;
    }
  }
  flush();
  return chunks;
}
