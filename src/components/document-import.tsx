import { useRouter } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { apiRequest, errorMessage, postJson } from '@/lib/api-client';
import { FILE_TYPES, chunkChapter, parseDocument, parseText, type Chapter, type ParsedDocument } from '@/lib/document-parser';
import { toast } from 'sonner';

type Progress = { label: string; done: number; total: number };
// `chapter` is the index in the chosen chapters (titles can repeat); it is not sent to the server.
type Part = { chapter: number; position: number; chapterTitle: string; text: string; words: number };

// Short parts, so Claude or ChatGPT can be given just enough text for the number of phrases asked for.
const PART_WORDS = 250;

// Import dialog: reads a file (PDF, EPUB, Word) on the device, or takes pasted or typed text, and saves its prose as
// text parts (code, tables and captions are left out).
export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {open && <DocumentImport close={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function DocumentImport({ close }: { close: () => void }) {
  const router = useRouter();
  const [source, setSource] = useState<'file' | 'text'>('file');
  // What the document is called in the Library: the file's title or name to start with (pasted text starts empty so it
  // is always named), editable before saving.
  const [name, setName] = useState('');
  const [pasted, setPasted] = useState('');
  const [doc, setDoc] = useState<ParsedDocument | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<Progress | null>(null);
  // The exact text that will be saved (and that Claude or ChatGPT will read), shown before saving.
  const [preview, setPreview] = useState<{ chapters: Chapter[]; parts: Part[] } | null>(null);
  const [shown, setShown] = useState('');
  const [summary, setSummary] = useState<{ parts: number; words: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const chosen = useMemo(() => (doc ? [...selected].sort((a, b) => a - b).map(index => doc.chapters[index]) : []), [doc, selected]);

  // Pasted text and single-section files go straight to the preview; otherwise the chapters are chosen first.
  function opened(parsed: ParsedDocument) {
    if (!parsed.chapters.length) throw new Error(parsed.format === 'pdf' ? 'No readable text was found. Scanned PDFs (images of pages) are not supported.' : 'No readable text was found.');
    const indices = parsed.chapters.map((_, index) => index).filter(index => !/^(front matter|contents|index|copyright|acknowledg)/i.test(parsed.chapters[index].title));
    setDoc(parsed); setName(parsed.format === 'text' ? '' : parsed.title); setSelected(new Set(indices)); setStatus(null);
    if (parsed.format === 'text' || parsed.chapters.length === 1) showPreview(parsed.chapters);
  }

  async function openFile(file: File | undefined) {
    if (!file) return;
    setDoc(null); setPreview(null); setProgress(null); setSummary(null); setStatus({ type: 'info', text: `Reading ${file.name} in your browser…` });
    try { opened(await parseDocument(file)); }
    catch (error) { toast.error(errorMessage(error)); }
  }

  function openText() {
    setSummary(null);
    try { opened(parseText('', pasted)); }
    catch (error) { toast.error(errorMessage(error)); }
  }

  function toggle(index: number) {
    setSelected(current => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; });
  }

  function showPreview(chapters = chosen) {
    const parts = chapters.flatMap((chapter, index) => chunkChapter(chapter.text, PART_WORDS).map(text => ({ chapter: index, chapterTitle: chapter.title, text, words: text.split(/\s+/).filter(Boolean).length })))
      .map((part, position) => ({ ...part, position }));
    if (!parts.length) { toast.error('There is no prose to read here (code, tables and lists of short lines are left out).'); return; }
    setStatus(null); setPreview({ chapters, parts }); setShown(String(parts[0].chapter));
  }

  async function save() {
    if (!doc || !preview || !name.trim()) return;
    // Pasted text has no title of its own: its first section takes the chosen name.
    const parts = preview.parts.map(({ chapter: _chapter, ...part }) => (doc.format === 'text' && part.chapterTitle === doc.title ? { ...part, chapterTitle: name.trim() } : part));
    setRunning(true); setStatus(null); setSummary(null);
    try {
      const { documentId } = await postJson<{ documentId: number }>('/api/documents', { title: name.trim(), author: doc.author ?? undefined, format: doc.format });
      try {
        for (let start = 0; start < parts.length; start += 20) {
          setProgress({ label: 'Saving the text', done: start, total: parts.length });
          await postJson(`/api/documents/${documentId}/parts`, { parts: parts.slice(start, start + 20) });
        }
      } catch (error) {
        // Never keep half a document: remove it so importing again starts clean.
        await apiRequest(`/api/documents/${documentId}`, { method: 'DELETE' }).catch(() => undefined);
        throw error;
      }
      setSummary({ parts: parts.length, words: parts.reduce((total, part) => total + part.words, 0) });
      setProgress(null);
    } catch (error) { toast.error(`${errorMessage(error)} Nothing was saved; please try again.`); setProgress(null); }
    finally { setRunning(false); await router.invalidate(); }
  }

  const { chapters, parts } = preview ?? { chapters: [], parts: [] };
  // Back to the chapter list, or to the file or text when there was nothing to choose.
  const back = () => { setPreview(null); if (doc && (doc.format === 'text' || doc.chapters.length === 1)) setDoc(null); };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import something to read</DialogTitle>
        <DialogDescription>A book or document (PDF, EPUB, Word), or text you paste or type. It is kept privately; Claude or ChatGPT reads it in order, a little at a time, when you ask for new phrases.</DialogDescription>
      </DialogHeader>

      {preview && !summary && (
        <div className="grid gap-3 text-sm">
          <div className="grid gap-1.5">
            <Label htmlFor="import-name">Name</Label>
            <Input id="import-name" autoFocus={doc?.format === 'text'} value={name} maxLength={300} disabled={running} onChange={event => setName(event.target.value)} placeholder="e.g. Team retro notes" className="bg-background" />
          </div>
          <p>
            <span className="font-medium">{parts.reduce((total, part) => total + part.words, 0).toLocaleString()} words</span>
            {chapters.length > 1 && <span className="text-muted-foreground"> from {new Set(parts.map(part => part.chapter)).size} of {chapters.length} chapters</span>}
            <span className="text-muted-foreground">. Check that the text reads correctly: this is exactly what will be saved and what Claude or ChatGPT will read. Code, tables, captions and headings are left out.</span>
          </p>
          {chapters.some((_, index) => !parts.some(part => part.chapter === index)) && (
            <p className="text-amber-800">No readable prose in: {chapters.filter((_, index) => !parts.some(part => part.chapter === index)).map(chapter => chapter.title).join(', ')}</p>
          )}
          {new Set(parts.map(part => part.chapter)).size > 1 && (
            <Select value={shown} onValueChange={setShown}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[...new Set(parts.map(part => part.chapter))].map(index => (
                  <SelectItem key={index} value={String(index)}>{chapters[index].title} · {parts.filter(part => part.chapter === index).reduce((total, part) => total + part.words, 0).toLocaleString()} words</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="max-h-96 overflow-y-auto rounded-lg border bg-muted/30 p-3 leading-relaxed whitespace-pre-wrap">
            {parts.filter(part => String(part.chapter) === shown).map(part => part.text).join('\n\n')}
          </div>
          {progress && (
            <div className="grid gap-1">
              <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
              <p className="text-xs text-muted-foreground">{progress.label}: {progress.done}/{progress.total}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" disabled={running} onClick={back}>Back</Button>
            <Button disabled={running || !name.trim()} onClick={save}>{running ? 'Saving…' : 'Looks good: save'}</Button>
          </DialogFooter>
        </div>
      )}

      {!preview && !summary && (
        <div className="grid gap-3">
          <ToggleGroup type="single" variant="outline" value={source} onValueChange={value => { if (value) { setSource(value as 'file' | 'text'); setDoc(null); setStatus(null); } }} className="w-full">
            <ToggleGroupItem value="file" className="flex-1">File</ToggleGroupItem>
            <ToggleGroupItem value="text" className="flex-1">Paste text</ToggleGroupItem>
          </ToggleGroup>

          {source === 'file' && (
            <>
              <Input type="file" accept={FILE_TYPES} disabled={running} onChange={event => openFile(event.target.files?.[0])} className="h-10 bg-background" />
              {!doc && <p className="text-xs text-muted-foreground">PDF (text-based, not scanned images), EPUB (without DRM) or Word (.docx).</p>}
            </>
          )}

          {source === 'text' && (
            <>
              <Textarea value={pasted} onChange={event => setPasted(event.target.value)} placeholder="Paste or type English text: an article, an email thread, a transcript…"
                className="min-h-48 bg-background" />
              <p className="text-xs text-muted-foreground">Leave a blank line between paragraphs. A line starting with “# ” starts a new section.</p>
              <DialogFooter>
                <Button disabled={!pasted.trim()} onClick={openText}>Preview</Button>
              </DialogFooter>
            </>
          )}

          {source === 'file' && doc && doc.chapters.length > 1 && (
            <>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{doc.title} <span className="font-normal text-muted-foreground">· {doc.chapters.length} chapters</span></span>
                <span className="flex gap-2">
                  <Button variant="link" size="sm" className="px-0" disabled={running} onClick={() => setSelected(new Set(doc.chapters.map((_, index) => index)))}>All</Button>
                  <Button variant="link" size="sm" className="px-0" disabled={running} onClick={() => setSelected(new Set())}>None</Button>
                </span>
              </div>
              <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                {doc.chapters.map((chapter, index) => (
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
                <Button disabled={!chosen.length} onClick={() => showPreview()}>Preview text of {selected.size} chapters</Button>
              </DialogFooter>
            </>
          )}
        </div>
      )}

      {summary && (
        <div className="grid gap-3 text-sm">
          <p className="font-medium">Imported {summary.words.toLocaleString()} words ({summary.parts} parts).</p>
          <p className="text-muted-foreground">Now ask Claude or ChatGPT (connected in Settings): “Find 10 new phrases in PhraseLoop.” The cards wait in the Queue.</p>
          <DialogFooter><Button onClick={close}>Done</Button></DialogFooter>
        </div>
      )}
      <StatusMessage status={status} />
    </>
  );
}
