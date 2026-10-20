import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage, postJson } from '@/lib/api-client';
import type { LearningItem } from '@/lib/learning-db';

export const Route = createFileRoute('/learn')({
  head: () => ({ meta: [{ title: 'Learn · English SRS' }] }),
  component: Learn,
});

type Stats = { analyzed: number; saved: number; skipped: number };
type ItemResponse = { item: LearningItem; stats: Stats };

const wordCount = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const optional = (value: string) => value.trim() || undefined;

function Learn() {
  const [form, setForm] = useState({ text: '', context: '', confusingPart: '', intendedMeaning: '' });
  const [item, setItem] = useState<LearningItem | null>(null);
  const [draft, setDraft] = useState({ mainSentence: '', explanation: '' });
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState<'analyze' | 'save' | 'skip' | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const field = (key: keyof typeof form) => ({
    id: key, value: form[key], onChange: (event: { target: { value: string } }) => setForm(current => ({ ...current, [key]: event.target.value })),
  });

  async function analyze(event: FormEvent) {
    event.preventDefault(); setStatus(null); setItem(null); setBusy('analyze');
    try {
      const body = await postJson<ItemResponse>('/api/analyze', {
        text: form.text.trim(), context: optional(form.context), confusingPart: optional(form.confusingPart), intendedMeaning: optional(form.intendedMeaning),
      });
      setItem(body.item); setStats(body.stats);
      setDraft({ mainSentence: body.item.mainSentence, explanation: body.item.explanation });
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function decide(action: 'save' | 'skip') {
    if (!item) return;
    setStatus(null); setBusy(action);
    try {
      await postJson<ItemResponse>(`/api/learning-items/${item.id}/${action}`, action === 'save'
        ? { mainSentence: draft.mainSentence.trim(), explanation: draft.explanation.trim() } : undefined);
      setStatus({ type: 'success', text: action === 'save' ? 'Saved to Noji.' : 'Skipped for now. It remains in your private history for recurrence detection.' });
      setItem(null);
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  return (
    <>
      <PageHeader title="English Learning Assistant" description="Understand real English, check how people use it, then decide whether it deserves a Noji card." />
      <Card>
        <CardContent>
          <form onSubmit={analyze} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="text">Sentence, phrase, or passage</Label>
              <Textarea {...field('text')} maxLength={3000} className="min-h-24" placeholder="Paste something you encountered and did not fully understand..." />
              <p className="text-xs text-muted-foreground">At least 3 words. Nothing is saved to Noji until you confirm.</p>
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

      {item && (
        <Card className="mt-4">
          <CardContent className="grid gap-4">
            <div className="rounded-md border-l-4 border-primary bg-muted px-3 py-2">
              <div className="font-semibold capitalize">{item.recommendation.replaceAll('_', ' ')} — {item.recommendationScore}/10</div>
              <div className="text-sm">{item.recommendationReason}</div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mainSentence">Noji title</Label>
              <Textarea id="mainSentence" value={draft.mainSentence} onChange={event => setDraft(current => ({ ...current, mainSentence: event.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="explanation">Card content</Label>
              <Textarea id="explanation" className="min-h-60" value={draft.explanation} onChange={event => setDraft(current => ({ ...current, explanation: event.target.value }))} />
            </div>
            {stats && <p className="text-sm text-muted-foreground">Today: {stats.analyzed} analyzed · {stats.saved} saved · {stats.skipped} skipped</p>}
            <div className="flex gap-2">
              <Button size="lg" className="bg-emerald-700 hover:bg-emerald-700/85" disabled={busy !== null} onClick={() => decide('save')}>{busy === 'save' ? 'Saving…' : 'Save to Noji'}</Button>
              <Button size="lg" variant="secondary" disabled={busy !== null} onClick={() => decide('skip')}>Skip for now</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
