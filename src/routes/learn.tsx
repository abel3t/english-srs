import { Link, createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { SyncBadge } from '@/components/card-badges';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getCandidateById } from '@/data/cards';
import { errorMessage, postJson } from '@/lib/api-client';
import type { Candidate } from '@/lib/candidates-db';
import type { Card as SavedCard, DailyStats } from '@/lib/cards-db';
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

// Keyed by candidate so opening another suggested phrase starts with a fresh form.
function LearnPage() {
  const candidate = Route.useLoaderData();
  return <Learn key={candidate?.id ?? 'manual'} candidate={candidate} />;
}

function Learn({ candidate }: { candidate: Candidate | null }) {
  const [form, setForm] = useState(() => ({
    text: candidate ? candidate.example || candidate.phrase : '',
    context: candidate?.source ? `From "${candidate.source}"` : '',
    confusingPart: candidate?.example ? candidate.phrase : '',
    intendedMeaning: '',
  }));
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [draft, setDraft] = useState({ phrase: '', explanation: '' });
  const [saved, setSaved] = useState<{ card: SavedCard; stats: DailyStats } | null>(null);
  const [busy, setBusy] = useState<'analyze' | 'save' | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const field = (key: keyof typeof form) => ({
    id: key, value: form[key], onChange: (event: { target: { value: string } }) => setForm(current => ({ ...current, [key]: event.target.value })),
  });

  async function analyze(event: FormEvent) {
    event.preventDefault(); setStatus(null); setAnalysis(null); setSaved(null); setBusy('analyze');
    try {
      const body = await postJson<{ analysis: Analysis }>('/api/analyze', {
        text: form.text.trim(), context: optional(form.context), confusingPart: optional(form.confusingPart), intendedMeaning: optional(form.intendedMeaning),
      });
      setAnalysis(body.analysis);
      setDraft({ phrase: body.analysis.mainSentence, explanation: body.analysis.explanation });
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function save() {
    if (!analysis) return;
    setStatus(null); setBusy('save');
    try {
      const body = await postJson<{ card: SavedCard; stats: DailyStats }>('/api/cards', {
        phrase: draft.phrase.trim(), explanation: draft.explanation.trim(),
        keyExpression: analysis.keyExpression, grammarPattern: analysis.grammarPattern,
        originalInput: optional(form.text), context: optional(form.context), candidateId: candidate?.id,
      });
      setSaved(body); setAnalysis(null);
      setForm({ text: '', context: '', confusingPart: '', intendedMeaning: '' });
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  return (
    <>
      <PageHeader title="Learn a phrase" description="Analyze real English first. Nothing is saved until you choose to make it a card." />
      <Card>
        <CardContent>
          <form onSubmit={analyze} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="text">Sentence, phrase, or passage</Label>
              <Textarea {...field('text')} maxLength={3000} className="min-h-24" placeholder="Paste something you encountered and did not fully understand..." />
              <p className="text-xs text-muted-foreground">At least 3 words.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="context">Context <span className="font-normal text-muted-foreground">(English or Vietnamese, optional)</span></Label>
              <Textarea {...field('context')} maxLength={1500} placeholder="Where did you find it? Who was speaking? What was happening?" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="confusingPart">What part don’t you understand? <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea {...field('confusingPart')} maxLength={500} placeholder="A word, phrase, grammar point, or tone. Leave empty to explain the whole sentence." />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="intendedMeaning">What do you think it means? <span className="font-normal text-muted-foreground">(English or Vietnamese, optional)</span></Label>
              <Textarea {...field('intendedMeaning')} maxLength={1000} placeholder="Leave empty if you have no idea. This helps identify a possible misunderstanding." />
            </div>
            <div><Button type="submit" size="lg" disabled={busy !== null || wordCount(form.text) < 3}>{busy === 'analyze' ? 'Analyzing…' : 'Analyze'}</Button></div>
          </form>
        </CardContent>
      </Card>

      <StatusMessage status={status} />

      {saved && (
        <Card className="mt-4 border-emerald-200 bg-emerald-50">
          <CardContent className="flex flex-wrap items-center gap-2 text-sm text-emerald-900">
            <span>Saved “{saved.card.phrase}”. It will show up in your next review.</span>
            <SyncBadge status={saved.card.nojiSyncStatus} />
            {saved.card.nojiSyncError && <span className="text-red-700">{saved.card.nojiSyncError} — retry from <Link to="/cards" className="underline">Cards</Link>.</span>}
            <span className="ml-auto text-muted-foreground">Today: {saved.stats.added} added · {saved.stats.reviewed} reviewed</span>
          </CardContent>
        </Card>
      )}

      {analysis && (
        <Card className="mt-4">
          <CardContent className="grid gap-4">
            <div className="rounded-md border-l-4 border-primary bg-muted px-3 py-2">
              <div className="font-semibold capitalize">{analysis.recommendation.replaceAll('_', ' ')} — {analysis.score}/10</div>
              <div className="text-sm">{analysis.reason}</div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="phrase">Card front</Label>
              <Textarea id="phrase" value={draft.phrase} onChange={event => setDraft(current => ({ ...current, phrase: event.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="explanation">Card back</Label>
              <Textarea id="explanation" className="min-h-60" value={draft.explanation} onChange={event => setDraft(current => ({ ...current, explanation: event.target.value }))} />
            </div>
            <div className="flex gap-2">
              <Button size="lg" className="bg-emerald-700 hover:bg-emerald-700/85" disabled={busy !== null || !draft.phrase.trim() || !draft.explanation.trim()} onClick={save}>
                {busy === 'save' ? 'Saving…' : 'Save card'}
              </Button>
              <Button size="lg" variant="secondary" disabled={busy !== null} onClick={() => setAnalysis(null)}>Discard</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
