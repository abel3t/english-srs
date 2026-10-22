import { useRouter } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiRequest, errorMessage, postJson } from '@/lib/api-client';
import { chunkChapter, parseBook, type ParsedBook } from '@/lib/book-parser';

type Progress = { label: string; done: number; total: number };
// `chapter` is the index in the chosen chapters (titles can repeat); it is not sent to the server.
type Part = { chapter: number; position: number; chapterTitle: string; text: string; words: number };

// Short parts, so Claude or ChatGPT can be given just enough text for the number of phrases asked for.
const PART_WORDS = 250;

// Import dialog: reads a PDF/EPUB on the device and saves its prose as text parts (code, tables and captions are left out).
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
  // The exact text that will be saved (and that Claude or ChatGPT will read), shown before saving.
  const [preview, setPreview] = useState<Part[] | null>(null);
  const [shown, setShown] = useState('');
  const [summary, setSummary] = useState<{ parts: number; words: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const chosen = useMemo(() => (book ? [...selected].sort((a, b) => a - b).map(index => book.chapters[index]) : []), [book, selected]);

  async function open(file: File | undefined) {
    if (!file) return;
    setBook(null); setPreview(null); setProgress(null); setSummary(null); setStatus({ type: 'info', text: `Reading ${file.name} in your browser…` });
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

  function showPreview() {
    const parts = chosen.flatMap((chapter, index) => chunkChapter(chapter.text, PART_WORDS).map(text => ({ chapter: index, chapterTitle: chapter.title, text, words: text.split(/\s+/).filter(Boolean).length })))
      .map((part, position) => ({ ...part, position }));
    if (!parts.length) { setStatus({ type: 'error', text: 'These chapters have no prose to read.' }); return; }
    setStatus(null); setPreview(parts); setShown(String(parts[0].chapter));
  }

  async function save() {
    if (!book || !preview) return;
    const parts = preview.map(({ chapter: _chapter, ...part }) => part);
    setRunning(true); setStatus(null); setSummary(null);
    try {
      const { bookId } = await postJson<{ bookId: number }>('/api/books', { title: book.title, author: book.author ?? undefined, format: book.format });
      try {
        for (let start = 0; start < parts.length; start += 20) {
          setProgress({ label: 'Saving the text', done: start, total: parts.length });
          await postJson(`/api/books/${bookId}/parts`, { parts: parts.slice(start, start + 20) });
        }
      } catch (error) {
        // Never keep half a book: remove it so importing again starts clean.
        await apiRequest(`/api/books/${bookId}`, { method: 'DELETE' }).catch(() => undefined);
        throw error;
      }
      setSummary({ parts: parts.length, words: parts.reduce((total, part) => total + part.words, 0) });
      setProgress(null);
    } catch (error) { setStatus({ type: 'error', text: `${errorMessage(error)} Nothing was saved; please try again.` }); setProgress(null); }
    finally { setRunning(false); await router.invalidate(); }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import a book or document</DialogTitle>
        <DialogDescription>PDF or EPUB. The text is kept privately; Claude or ChatGPT reads it in order, a little at a time, when you ask for new phrases.</DialogDescription>
      </DialogHeader>

      {preview && !summary && (
        <div className="grid gap-3 text-sm">
          <p>
            <span className="font-medium">{preview.reduce((total, part) => total + part.words, 0).toLocaleString()} words</span>
            <span className="text-muted-foreground"> from {new Set(preview.map(part => part.chapter)).size} of {chosen.length} chapters. Check that the text reads correctly: this is exactly what will be saved and what Claude or ChatGPT will read. Code, tables, captions and headings are left out.</span>
          </p>
          {chosen.some((_, index) => !preview.some(part => part.chapter === index)) && (
            <p className="text-amber-800">No readable prose in: {chosen.filter((_, index) => !preview.some(part => part.chapter === index)).map(chapter => chapter.title).join(', ')}</p>
          )}
          <Select value={shown} onValueChange={setShown}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[...new Set(preview.map(part => part.chapter))].map(index => (
                <SelectItem key={index} value={String(index)}>{chosen[index].title} · {preview.filter(part => part.chapter === index).reduce((total, part) => total + part.words, 0).toLocaleString()} words</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="max-h-96 overflow-y-auto rounded-lg border bg-muted/30 p-3 leading-relaxed whitespace-pre-wrap">
            {preview.filter(part => String(part.chapter) === shown).map(part => part.text).join('\n\n')}
          </div>
          {progress && (
            <div className="grid gap-1">
              <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
              <p className="text-xs text-muted-foreground">{progress.label}: {progress.done}/{progress.total}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" disabled={running} onClick={() => setPreview(null)}>Back</Button>
            <Button disabled={running} onClick={save}>{running ? 'Saving…' : 'Looks good: save'}</Button>
          </DialogFooter>
        </div>
      )}

      {!preview && !summary && (
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
              <DialogFooter>
                <Button disabled={!chosen.length} onClick={showPreview}>Preview text of {selected.size} chapters</Button>
              </DialogFooter>
            </>
          )}
        </div>
      )}

      {summary && (
        <div className="grid gap-3 text-sm">
          <p className="font-medium">Imported {summary.words.toLocaleString()} words ({summary.parts} parts).</p>
          <p className="text-muted-foreground">Now ask Claude or ChatGPT (connected in Settings): “Find 10 new phrases in my English app.” The cards appear on Today.</p>
          <DialogFooter><Button onClick={close}>Done</Button></DialogFooter>
        </div>
      )}
      <StatusMessage status={status} />
    </>
  );
}
