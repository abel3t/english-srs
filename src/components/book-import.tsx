import { Link, useRouter } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

function runFinder(chapters: Array<{ title: string; text: string }>, limit: number, onProgress: (done: number, total: number) => void): Promise<FoundPhrase[]> {
  // Compile-time guard so the server bundle does not include the finder and its dictionary code.
  if (import.meta.env.SSR) return Promise.reject(new Error('The phrase finder runs in the browser only'));
  return import('@/lib/phrase-finder.worker?worker').then(({ default: FinderWorker }) => new Promise<FoundPhrase[]>((resolve, reject) => {
    const worker = new FinderWorker();
    worker.onmessage = (event: MessageEvent<{ type: 'progress'; done: number; total: number } | { type: 'done'; results: FoundPhrase[] } | { type: 'error'; message: string }>) => {
      if (event.data.type === 'progress') onProgress(event.data.done, event.data.total);
      else { worker.terminate(); if (event.data.type === 'done') resolve(event.data.results); else reject(new Error(event.data.message)); }
    };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message || 'Phrase finder failed')); };
    worker.postMessage({ chapters, limit });
  }));
}

// Import dialog: reads a PDF/EPUB on the device and saves only the phrases the finder picks (never the book).
export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {open && <BookImport close={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function BookImport({ close }: { close: () => void }) {
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
      // 1. Keep the text as ~1,000-word parts: the cron job lets the AI review them one by one.
      const parts = chosen.flatMap(chapter => chunkChapter(chapter.text).map(text => ({ chapterTitle: chapter.title, text, words: text.split(/\s+/).filter(Boolean).length })))
        .map((part, position) => ({ ...part, position }));
      const { bookId } = await postJson<{ bookId: number }>('/api/books', { title: book.title, author: book.author ?? undefined, format: book.format });
      for (let start = 0; start < parts.length; start += 20) {
        setProgress({ label: 'Saving the text', done: start, total: parts.length });
        await postJson(`/api/books/${bookId}/parts`, { parts: parts.slice(start, start + 20) });
      }
      // 2. The code finder proposes candidates (about 20 per part), each tied to the part its example comes from.
      const found = await runFinder(chosen.map(chapter => ({ title: chapter.title, text: proseOf(chapter.text) })), Math.max(200, parts.length * 20),
        (done, total) => setProgress({ label: 'Finding phrases', done, total }));
      const clean = (text: string) => text.toLowerCase().replace(/\s+/g, ' ');
      const partTexts = parts.map(part => clean(part.text));
      const partOf = (phrase: FoundPhrase) => {
        const index = partTexts.findIndex(text => text.includes(clean(phrase.example)));
        return index >= 0 ? index : undefined;
      };
      let added = 0;
      for (let start = 0; start < found.length; start += 50) {
        setProgress({ label: 'Saving phrases', done: start, total: found.length });
        const batch = found.slice(start, start + 50).map(phrase => ({ phrase: phrase.phrase, example: phrase.example, kind: phrase.kind, band: phrase.band, score: phrase.score, part: partOf(phrase) }));
        added += (await postJson<{ added: number }>('/api/candidates/batch', { source: book.title, bookId, items: batch })).added;
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
      <DialogHeader>
        <DialogTitle>Import a book or document</DialogTitle>
        <DialogDescription>PDF or EPUB. The text is kept privately so the AI can go through it part by part and pick the best phrases for your daily suggestions.</DialogDescription>
      </DialogHeader>

      {!summary && (
        <div className="grid gap-3">
          <Input type="file" accept=".pdf,.epub,application/pdf,application/epub+zip" disabled={running} onChange={event => open(event.target.files?.[0])} className="h-10 bg-background" />
          {!book && <p className="text-xs text-muted-foreground">Text-based PDFs only (not scanned images).</p>}
          {book && (
            <>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{book.title} <span className="font-normal text-muted-foreground">· {book.chapters.length} chapters</span></span>
                <span className="flex gap-2">
                  <Button variant="link" size="sm" className="px-0" disabled={running} onClick={() => setSelected(new Set(book.chapters.map((_, index) => index)))}>All</Button>
                  <Button variant="link" size="sm" className="px-0" disabled={running} onClick={() => setSelected(new Set())}>None</Button>
                </span>
              </div>
              <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                {book.chapters.map((chapter, index) => (
                  <li key={index}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                      <Checkbox checked={selected.has(index)} disabled={running} onCheckedChange={() => toggle(index)} />
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
              <DialogFooter>
                <Button disabled={running || !chosen.length} onClick={findFree}>{running ? 'Finding…' : `Find phrases in ${selected.size} chapters`}</Button>
              </DialogFooter>
            </>
          )}
        </div>
      )}

      {summary && (
        <div className="grid gap-3 text-sm">
          <p className="font-medium">Found {summary.found} phrases · {summary.added} new</p>
          <p className="text-muted-foreground">The AI will now go through the book part by part in the background and pick the best ones for your daily suggestions.</p>
          <p className="text-muted-foreground">
            {Object.entries(summary.byKind).map(([kind, count]) => `${count} ${kindLabels[kind as keyof typeof kindLabels]}${count === 1 ? '' : 's'}`).join(' · ')}
            {summary.found > summary.added && ` · ${summary.found - summary.added} you already had`}
          </p>
          <ul className="grid gap-1">
            {summary.top.map(phrase => <li key={phrase.phrase}><b>{phrase.phrase}</b> <span className="text-muted-foreground">· {kindLabels[phrase.kind]} · ×{phrase.count}</span></li>)}
          </ul>
          <DialogFooter>
            <Button variant="secondary" onClick={close}>Close</Button>
            <Button asChild><Link to="/" onClick={close}>See today's suggestions</Link></Button>
          </DialogFooter>
        </div>
      )}
      <StatusMessage status={status} />
    </>
  );
}
