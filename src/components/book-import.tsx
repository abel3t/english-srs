import { Link, useRouter } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { errorMessage, postJson } from '@/lib/api-client';
import { chunkChapter, parseBook, type ParsedBook } from '@/lib/book-parser';
import type { CandidateKind } from '@/lib/candidates-db';
import type { FoundPhrase } from '@/lib/phrase-finder';

export const kindLabels: Record<CandidateKind, string> = {
  frame: 'work phrase', phrasal_verb: 'phrasal verb', idiom: 'idiom', prep_phrase: 'fixed phrase',
  collocation: 'word partnership', word: 'word', ai: 'AI pick', capture: 'saved by you',
};

type Progress = { label: string; done: number; total: number };
type Summary = { found: number; added: number; byKind: Record<string, number>; top: FoundPhrase[] };

// The finder only gets prose: code listings, tables and captions are filtered out by chunkChapter.
const proseOf = (text: string) => chunkChapter(text, 1_000_000).join('\n\n');

function runFinder(chapters: Array<{ title: string; text: string }>, onProgress: (done: number, total: number) => void): Promise<FoundPhrase[]> {
  // Compile-time guard so the server bundle does not include the finder and its dictionary code.
  if (import.meta.env.SSR) return Promise.reject(new Error('The phrase finder runs in the browser only'));
  return import('@/lib/phrase-finder.worker?worker').then(({ default: FinderWorker }) => new Promise<FoundPhrase[]>((resolve, reject) => {
    const worker = new FinderWorker();
    worker.onmessage = (event: MessageEvent<{ type: 'progress'; done: number; total: number } | { type: 'done'; results: FoundPhrase[] } | { type: 'error'; message: string }>) => {
      if (event.data.type === 'progress') onProgress(event.data.done, event.data.total);
      else { worker.terminate(); if (event.data.type === 'done') resolve(event.data.results); else reject(new Error(event.data.message)); }
    };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message || 'Phrase finder failed')); };
    worker.postMessage({ chapters });
  }));
}

// Reads a PDF/EPUB on the device and saves only the phrases the finder picks (never the book).
export function BookImport({ pending }: { pending: number }) {
  const router = useRouter();
  const [book, setBook] = useState<ParsedBook | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<Progress | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const chosen = useMemo(() => (book ? [...selected].sort((a, b) => a - b).map(index => book.chapters[index]) : []), [book, selected]);

  async function open(file: File | undefined) {
    if (!file) return;
    setBook(null); setProgress(null); setSummary(null); setStatus({ type: 'info', text: `Reading ${file.name} in your browser…` });
    try {
      const parsed = await parseBook(file);
      if (!parsed.chapters.length) throw new Error('No readable text was found. Scanned PDFs (images of pages) are not supported.');
      setBook(parsed);
      setSelected(new Set(parsed.chapters.map((_, index) => index).filter(index => !/^(front matter|contents|index|copyright|acknowledg)/i.test(parsed.chapters[index].title))));
      setStatus(null);
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
  }

  function toggle(index: number) {
    setSelected(current => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; });
  }

  // Free and instant: the finder runs in the browser; only the phrases it picks are sent and saved.
  async function findFree() {
    if (!book || !chosen.length) return;
    setRunning(true); setStatus(null); setSummary(null);
    try {
      const found = await runFinder(chosen.map(chapter => ({ title: chapter.title, text: proseOf(chapter.text) })),
        (done, total) => setProgress({ label: 'Reading chapters', done, total }));
      let added = 0;
      for (let start = 0; start < found.length; start += 50) {
        setProgress({ label: 'Saving phrases', done: start, total: found.length });
        const batch = found.slice(start, start + 50).map(({ phrase, example, kind, band, score }) => ({ phrase, example, kind, band, score }));
        added += (await postJson<{ added: number }>('/api/candidates/batch', { source: book.title, items: batch })).added;
      }
      const byKind: Record<string, number> = {};
      for (const phrase of found) byKind[phrase.kind] = (byKind[phrase.kind] ?? 0) + 1;
      setSummary({ found: found.length, added, byKind, top: found.slice(0, 12) });
      setProgress(null);
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setRunning(false); await router.invalidate(); }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Import a book or document</CardTitle>
          <CardDescription>PDF or EPUB, read on your device. Only the phrases found in it are saved, never the book.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Input type="file" accept=".pdf,.epub,application/pdf,application/epub+zip" disabled={running} onChange={event => open(event.target.files?.[0])} className="h-10 bg-background" />
          <p className="text-xs text-muted-foreground">Text-based PDFs only (not scanned images). {pending} phrases are waiting in your suggestions.</p>
          <StatusMessage status={status} />
        </CardContent>
      </Card>

      {book && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{book.title}</CardTitle>
            <CardDescription>{book.author ? `${book.author} · ` : ''}{book.format.toUpperCase()} · {book.chapters.length} chapters</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex gap-2 text-sm">
              <Button variant="link" size="sm" className="px-0" disabled={running} onClick={() => setSelected(new Set(book.chapters.map((_, index) => index)))}>Select all</Button>
              <Button variant="link" size="sm" className="px-0" disabled={running} onClick={() => setSelected(new Set())}>Clear</Button>
            </div>
            <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
              {book.chapters.map((chapter, index) => (
                <li key={index}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                    <input type="checkbox" checked={selected.has(index)} disabled={running} onChange={() => toggle(index)} />
                    <span className="min-w-0 flex-1 truncate">{chapter.title}</span>
                    <span className="text-xs text-muted-foreground">{chapter.words.toLocaleString()} words</span>
                  </label>
                </li>
              ))}
            </ul>
            {progress && (
              <div className="grid gap-1">
                <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
                <p className="text-xs text-muted-foreground">{progress.label}: {progress.done}/{progress.total}</p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="lg" disabled={running || !chosen.length} onClick={findFree}>{running ? 'Finding…' : `Find phrases in ${selected.size} chapters`}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {summary && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Found {summary.found} phrases · {summary.added} new</CardTitle>
            <CardDescription>
              {Object.entries(summary.byKind).map(([kind, count]) => `${count} ${kindLabels[kind as keyof typeof kindLabels]}${count === 1 ? '' : 's'}`).join(' · ')}
              {summary.found > summary.added && ` · ${summary.found - summary.added} you already had`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <ul className="grid gap-1">
              {summary.top.map(phrase => <li key={phrase.phrase}><b>{phrase.phrase}</b> <span className="text-muted-foreground">· {kindLabels[phrase.kind]} · ×{phrase.count}</span></li>)}
            </ul>
            <div><Button size="lg" asChild><Link to="/">See today's suggestions</Link></Button></div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
