import { useRouter } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { More } from '@/components/more';
import { StatusMessage, type Status } from '@/components/status-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage, postJson } from '@/lib/api-client';
import type { Candidate } from '@/lib/candidates-db';
import type { CardReview } from '@/lib/card-review';
import type { Analysis } from '@/lib/learning-analysis';

const wordCount = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const optional = (value: string) => value.trim() || undefined;
const plain = (markdown: string) => markdown.replace(/\*\*([^*]+)\*\*/g, '$1');

type Draft = { phrase: string; explanation: string; examples: string };

/**
 * Learn a phrase in a dialog: Ollama (free) previews it; Gemini is asked only if the learner still wants it;
 * only "Learn it" stores the card. `candidate` pre-fills a suggestion from a book (null = type your own).
 */
export function LearnDialog({ candidate, open, onOpenChange }: { candidate: Candidate | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {open && <LearnFlow key={candidate?.id ?? 'manual'} candidate={candidate} close={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function LearnFlow({ candidate, close }: { candidate: Candidate | null; close: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState(() => ({
    text: candidate ? candidate.example || candidate.phrase : '',
    context: candidate?.source ? `From "${candidate.source}"` : '',
    confusingPart: candidate?.example ? candidate.phrase : '',
  }));
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [review, setReview] = useState<CardReview | null>(null);
  const [draft, setDraft] = useState<Draft>({ phrase: '', explanation: '', examples: '' });
  const [busy, setBusy] = useState<'preview' | 'review' | 'save' | 'skip' | null>(null);
  const [status, setStatus] = useState<Status>(null);

  async function preview(event?: FormEvent) {
    event?.preventDefault(); setStatus(null); setAnalysis(null); setReview(null); setBusy('preview');
    try {
      const body = await postJson<{ analysis: Analysis }>('/api/analyze', { text: form.text.trim(), context: optional(form.context), confusingPart: optional(form.confusingPart) });
      setAnalysis(body.analysis);
      setDraft({ phrase: body.analysis.mainSentence, explanation: body.analysis.explanation, examples: body.analysis.examples.join('\n') });
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  // A suggestion already has its text, so preview it straight away.
  useEffect(() => { if (candidate) void preview(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function askGemini() {
    if (!analysis) return;
    setStatus(null); setBusy('review');
    try {
      const body = await postJson<{ review: CardReview }>('/api/analyze/review', {
        text: form.text.trim(), context: optional(form.context), mainSentence: draft.phrase, meaning: analysis.meaning,
        keyExpression: analysis.keyExpression, explanation: draft.explanation, examples: draft.examples.split('\n').filter(line => line.trim()), score: analysis.score,
      });
      setReview(body.review);
      setDraft(current => ({
        ...current,
        explanation: body.review.correctedMeaning ? current.explanation.replace(/\*\*Meaning\*\*\n[^\n]*/, `**Meaning**\n${body.review.correctedMeaning}`) : current.explanation,
        examples: body.review.examples.length ? body.review.examples.join('\n') : current.examples,
      }));
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function skip() {
    if (!candidate) { close(); return; }
    setBusy('skip');
    try { await postJson(`/api/candidates/${candidate.id}/skip`); close(); await router.invalidate(); }
    catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); setBusy(null); }
  }

  async function learn() {
    if (!analysis) return;
    setStatus(null); setBusy('save');
    try {
      await postJson('/api/cards', {
        phrase: draft.phrase.trim(), explanation: draft.explanation.trim(), keyExpression: analysis.keyExpression, grammarPattern: analysis.grammarPattern,
        examples: draft.examples.split('\n').map(line => line.trim()).filter(Boolean), originalInput: optional(form.text), context: optional(form.context), candidateId: candidate?.id,
      });
      close();
      await router.invalidate();
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); setBusy(null); }
  }

  const field = (key: keyof typeof form) => ({ id: key, value: form[key], onChange: (event: { target: { value: string } }) => setForm(current => ({ ...current, [key]: event.target.value })) });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{candidate ? candidate.phrase : 'Learn a phrase'}</DialogTitle>
        <DialogDescription>Preview it (free), ask Gemini to check it if you still want it, then save it to practice.</DialogDescription>
      </DialogHeader>

      {!analysis && (
        <form onSubmit={preview} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="text">Phrase or sentence</Label>
            <Textarea {...field('text')} maxLength={3000} className="min-h-20" placeholder="Paste a phrase or sentence you want to learn…" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="confusingPart">Focus on <span className="font-normal text-muted-foreground">(optional: the exact words to learn)</span></Label>
            <Textarea {...field('confusingPart')} maxLength={500} className="min-h-10" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="context">Context <span className="font-normal text-muted-foreground">(optional, English or Vietnamese)</span></Label>
            <Textarea {...field('context')} maxLength={1500} className="min-h-10" placeholder="Where did you see it?" />
          </div>
          <DialogFooter>
            {candidate && <Button type="button" variant="secondary" disabled={busy === 'skip'} onClick={skip}>Skip</Button>}
            <Button type="submit" disabled={busy !== null || wordCount(form.text) < 2}>{busy === 'preview' ? 'Previewing…' : 'Preview'}</Button>
          </DialogFooter>
        </form>
      )}

      {analysis && (
        <div className="grid gap-4">
          <div className="grid gap-1">
            <p className="text-xs text-muted-foreground">Step {review ? 2 : 1} of 2 · {review ? 'checked by Gemini' : 'preview by Ollama'}</p>
            <div className="flex flex-wrap items-center gap-2 font-medium">
              Worth learning? <Badge variant="secondary">{review ? review.score : analysis.score}/10</Badge>
              {review && <Badge className={review.verdict === 'learn' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}>Gemini: {review.verdict}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{review ? review.reason : analysis.reason}</p>
          </div>
          {review && review.issues.length > 0 && <ul className="list-disc pl-5 text-sm text-amber-900">{review.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
          <div className="grid gap-1.5">
            <Label htmlFor="phrase">Card</Label>
            <Textarea id="phrase" value={draft.phrase} onChange={event => setDraft(current => ({ ...current, phrase: event.target.value }))} className="min-h-10" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="examples">Sentences to type <span className="font-normal text-muted-foreground">(one per line)</span></Label>
            <Textarea id="examples" value={draft.examples} onChange={event => setDraft(current => ({ ...current, examples: event.target.value }))} className="min-h-24" />
          </div>
          <More label="Meaning and notes"><p className="leading-relaxed whitespace-pre-wrap">{plain(draft.explanation)}</p></More>
          <DialogFooter>
            <Button variant="secondary" disabled={busy !== null} onClick={skip}>Skip</Button>
            {review
              ? <Button className="bg-emerald-700 hover:bg-emerald-700/85" disabled={busy !== null || !draft.phrase.trim()} onClick={learn}>{busy === 'save' ? 'Saving…' : 'Learn it'}</Button>
              : <Button disabled={busy !== null} onClick={askGemini}>{busy === 'review' ? 'Gemini is checking…' : 'I want it: ask Gemini'}</Button>}
          </DialogFooter>
        </div>
      )}
      {busy === 'preview' && candidate && <p className="text-sm text-muted-foreground">Ollama is reading it…</p>}
      <StatusMessage status={status} />
    </>
  );
}
