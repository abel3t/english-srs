import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getCandidateById } from '@/data/cards';
import { errorMessage, postJson } from '@/lib/api-client';
import type { Candidate } from '@/lib/candidates-db';
import type { CardReview } from '@/lib/card-review';
import type { Analysis } from '@/lib/learning-analysis';

export const Route = createFileRoute('/learn')({
  validateSearch: z.object({ candidate: z.number().int().positive().optional().catch(undefined) }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => (deps.candidate ? getCandidateById({ data: { id: deps.candidate } }) : null),
  head: () => ({ meta: [{ title: 'Learn · English SRS' }] }),
  component: LearnPage,
});

const wordCount = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const optional = (value: string) => value.trim() || undefined;
const plain = (markdown: string) => markdown.replace(/\*\*([^*]+)\*\*/g, '$1');

// Keyed by candidate so opening another suggested phrase starts with a fresh form.
function LearnPage() {
  const candidate = Route.useLoaderData();
  return <Learn key={candidate?.id ?? 'manual'} candidate={candidate} />;
}

type Draft = { phrase: string; explanation: string; examples: string };

// Ollama (free) previews first; Gemini is asked only if the learner still wants the phrase; only then is it stored.
function Learn({ candidate }: { candidate: Candidate | null }) {
  const navigate = useNavigate();
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

  async function preview(event: FormEvent) {
    event.preventDefault(); setStatus(null); setAnalysis(null); setReview(null); setBusy('preview');
    try {
      const body = await postJson<{ analysis: Analysis }>('/api/analyze', { text: form.text.trim(), context: optional(form.context), confusingPart: optional(form.confusingPart) });
      setAnalysis(body.analysis);
      setDraft({ phrase: body.analysis.mainSentence, explanation: body.analysis.explanation, examples: body.analysis.examples.join('\n') });
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

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
    setBusy('skip');
    try {
      if (candidate) await postJson(`/api/candidates/${candidate.id}/skip`);
      await navigate({ to: '/' });
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); setBusy(null); }
  }

  async function learn() {
    if (!analysis) return;
    setStatus(null); setBusy('save');
    try {
      await postJson('/api/cards', {
        phrase: draft.phrase.trim(), explanation: draft.explanation.trim(), keyExpression: analysis.keyExpression, grammarPattern: analysis.grammarPattern,
        examples: draft.examples.split('\n').map(line => line.trim()).filter(Boolean), originalInput: optional(form.text), context: optional(form.context), candidateId: candidate?.id,
      });
      setStatus({ type: 'success', text: `Saved “${draft.phrase.trim()}”. It will come up in Practice.` });
      setAnalysis(null); setReview(null);
      setForm({ text: '', context: '', confusingPart: '' });
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  const field = (key: keyof typeof form) => ({ id: key, value: form[key], onChange: (event: { target: { value: string } }) => setForm(current => ({ ...current, [key]: event.target.value })) });

  return (
    <>
      <PageHeader title="Learn a phrase" description="Preview it (free), ask Gemini to check it if you still want it, then save it to practice." />
      <Card>
        <CardContent>
          <form onSubmit={preview} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="text">Phrase or sentence</Label>
              <Textarea {...field('text')} maxLength={3000} className="min-h-20" placeholder="Paste a phrase or sentence you want to learn…" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="confusingPart">Focus on <span className="font-normal text-muted-foreground">(optional: the exact words you want to learn)</span></Label>
              <Textarea {...field('confusingPart')} maxLength={500} className="min-h-10" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="context">Context <span className="font-normal text-muted-foreground">(optional, English or Vietnamese)</span></Label>
              <Textarea {...field('context')} maxLength={1500} className="min-h-10" placeholder="Where did you see it?" />
            </div>
            <div><Button type="submit" size="lg" disabled={busy !== null || wordCount(form.text) < 2}>{busy === 'preview' ? 'Previewing…' : 'Preview'}</Button></div>
          </form>
        </CardContent>
      </Card>

      <StatusMessage status={status} />
      {status?.type === 'success' && <div className="mt-2 flex gap-2"><Button variant="secondary" asChild><Link to="/">Back to Today</Link></Button></div>}

      {analysis && (
        <Card className="mt-4">
          <CardHeader>
            <CardDescription>Step {review ? 2 : 1} of 2 · {review ? 'checked by Gemini' : 'preview by Ollama'}</CardDescription>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Worth learning? <Badge variant="secondary">{review ? review.score : analysis.score}/10</Badge>
              {review && <Badge className={review.verdict === 'learn' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}>Gemini: {review.verdict}</Badge>}
            </CardTitle>
            <CardDescription>{review ? review.reason : analysis.reason}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {review && review.issues.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-amber-900">{review.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="phrase">Card</Label>
              <Textarea id="phrase" value={draft.phrase} onChange={event => setDraft(current => ({ ...current, phrase: event.target.value }))} className="min-h-10" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="examples">Sentences to type <span className="font-normal text-muted-foreground">(one per line)</span></Label>
              <Textarea id="examples" value={draft.examples} onChange={event => setDraft(current => ({ ...current, examples: event.target.value }))} className="min-h-24" />
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Meaning and notes</summary>
              <p className="mt-2 leading-relaxed whitespace-pre-wrap">{plain(draft.explanation)}</p>
            </details>
            <div className="flex flex-wrap gap-2">
              {review
                ? <Button size="lg" className="bg-emerald-700 hover:bg-emerald-700/85" disabled={busy !== null || !draft.phrase.trim()} onClick={learn}>{busy === 'save' ? 'Saving…' : 'Learn it'}</Button>
                : <Button size="lg" disabled={busy !== null} onClick={askGemini}>{busy === 'review' ? 'Gemini is checking…' : 'I want it: ask Gemini'}</Button>}
              <Button size="lg" variant="secondary" disabled={busy !== null} onClick={skip}>Skip</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
