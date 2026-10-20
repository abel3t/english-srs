import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { getPendingCandidates } from '@/data/cards';
import { errorMessage, postJson } from '@/lib/api-client';
import { chunkChapter, parseBook, type ParsedBook } from '@/lib/book-parser';

export const Route = createFileRoute('/import')({
  loader: () => getPendingCandidates(),
  head: () => ({ meta: [{ title: 'Import · English SRS' }] }),
  component: Import,
});

type Progress = { done: number; total: number; found: number; added: number };

function Import() {
  const router = useRouter();
  const pending = Route.useLoaderData();
  const [book, setBook] = useState<ParsedBook | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const stopRequested = useRef(false);

  const chunks = useMemo(() => book ? [...selected].sort((a, b) => a - b).flatMap(index => chunkChapter(book.chapters[index].text)) : [], [book, selected]);

  async function open(file: File | undefined) {
    if (!file) return;
    setBook(null); setProgress(null); setStatus({ type: 'info', text: `Reading ${file.name} in your browser…` });
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

  // One chunk per request, sequentially: small requests for the Worker, and the learner can stop any time.
  async function extract() {
    if (!book || !chunks.length) return;
    stopRequested.current = false; setRunning(true); setStatus(null);
    const current: Progress = { done: 0, total: chunks.length, found: 0, added: 0 };
    setProgress({ ...current });
    try {
      for (const text of chunks) {
        if (stopRequested.current) break;
        const result = await postJson<{ found: number; added: number }>('/api/import/extract', { text, source: book.title });
        current.done += 1; current.found += result.found; current.added += result.added;
        setProgress({ ...current });
      }
      setStatus({ type: 'success', text: `${stopRequested.current ? 'Stopped. ' : ''}Added ${current.added} new phrases (${current.found - current.added} were duplicates or already cards). The book itself was not saved.` });
    } catch (error) { setStatus({ type: 'error', text: `${errorMessage(error)} — ${current.added} phrases were added before the error.` }); }
    finally { setRunning(false); await router.invalidate(); }
  }

  return (
    <>
      <PageHeader title="Import a book" description="Pick chapters from a PDF or EPUB. The AI finds phrases worth learning; only those phrases are saved, never the book." />
      <Card>
        <CardContent className="grid gap-2">
          <Input type="file" accept=".pdf,.epub,application/pdf,application/epub+zip" disabled={running} onChange={event => open(event.target.files?.[0])} className="h-10 bg-background" />
          <p className="text-xs text-muted-foreground">Parsed on your device. Text-based PDFs only (not scanned images).</p>
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
            <p className="text-sm text-muted-foreground">
              {selected.size} chapters selected → {chunks.length} AI requests (about 1,000 words each).
              {chunks.length > 40 && ' Tip: start with one or two chapters you are reading now.'}
            </p>
            {progress && (
              <div className="grid gap-1">
                <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
                <p className="text-xs text-muted-foreground">{progress.done}/{progress.total} chunks · {progress.added} new phrases</p>
              </div>
            )}
            <div className="flex gap-2">
              <Button size="lg" disabled={running || !chunks.length} onClick={extract}>{running ? 'Extracting…' : 'Extract phrases'}</Button>
              {running && <Button size="lg" variant="secondary" onClick={() => { stopRequested.current = true; }}>Stop</Button>}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Waiting to be offered ({pending.length})</CardTitle>
          <CardDescription>The dashboard asks you about one of these at random. <Link to="/" className="underline">Go to Today</Link></CardDescription>
        </CardHeader>
        <CardContent className="divide-y text-sm">
          {pending.length ? pending.map(candidate => (
            <div key={candidate.id} className="py-2 first:pt-0 last:pb-0">
              <span className="font-medium">{candidate.phrase}</span>
              {candidate.meaning && <span className="text-muted-foreground"> — {candidate.meaning}</span>}
            </div>
          )) : <p className="text-muted-foreground">No phrases yet.</p>}
        </CardContent>
      </Card>
    </>
  );
}
