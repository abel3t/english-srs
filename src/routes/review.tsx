import { Link, createFileRoute } from '@tanstack/react-router';
import { Volume2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ReviewCard } from '@/api/app';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { apiRequest, errorMessage, postJson } from '@/lib/api-client';
import type { DailyStats } from '@/lib/cards-db';
import type { Rating } from '@/lib/srs';

export const Route = createFileRoute('/review')({
  head: () => ({ meta: [{ title: 'Review · English SRS' }] }),
  component: Review,
});

const ratingStyles: Record<Rating, string> = {
  again: 'bg-red-100 text-red-800 hover:bg-red-200',
  hard: 'bg-amber-100 text-amber-800 hover:bg-amber-200',
  good: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200',
  easy: 'bg-sky-100 text-sky-800 hover:bg-sky-200',
};

// Blank out the key expression when it appears in the phrase; otherwise one longer word.
function makeCloze(phrase: string, keyExpression: string): string {
  const key = keyExpression.trim();
  const index = key ? phrase.toLowerCase().indexOf(key.toLowerCase()) : -1;
  if (index >= 0) return phrase.slice(0, index) + key.replace(/\S/g, '_') + phrase.slice(index + key.length);
  const stop = new Set(['this', 'that', 'with', 'from', 'have', 'your', 'what', 'when', 'where', 'which', 'would', 'could', 'should', 'about', 'there', 'their']);
  const words = [...phrase.matchAll(/[A-Za-z][A-Za-z'-]{3,}/g)].filter(match => !stop.has(match[0].toLowerCase()));
  const chosen = words.length ? words[Math.floor(Math.random() * words.length)] : null;
  return chosen ? phrase.slice(0, chosen.index) + '_'.repeat(Math.min(chosen[0].length, 10)) + phrase.slice(chosen.index! + chosen[0].length) : phrase;
}

// Free, offline browser voice; good enough for hearing a phrase while reviewing.
function speak(text: string) {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US'; utterance.rate = 0.95;
  speechSynthesis.speak(utterance);
}

function Review() {
  const [card, setCard] = useState<ReviewCard | null | undefined>(undefined);
  const [dueCount, setDueCount] = useState(0);
  const [cloze, setCloze] = useState('');
  const [stage, setStage] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const loadNext = useCallback(async () => {
    setBusy(true); setStatus(null);
    try {
      const body = await apiRequest<{ card: ReviewCard | null; dueCount: number }>('/api/review/due');
      setCard(body.card); setDueCount(body.dueCount); setStage(0); setStartedAt(Date.now());
      if (body.card) setCloze(makeCloze(body.card.front, body.card.keyExpression));
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void loadNext(); }, [loadNext]);

  async function answer(rating: Rating) {
    if (!card) return;
    setBusy(true); setStatus(null);
    try {
      const body = await postJson<{ stats: DailyStats }>('/api/review/answer', { cardId: card.cardId, answer: rating, reviewDurationMs: Date.now() - startedAt });
      setStats(body.stats);
      await loadNext();
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Review" description="Recall the phrase, say it out loud, then rate how well you knew it." />
      <StatusMessage status={status} />
      {card === undefined && !status && <p className="text-sm text-muted-foreground">Loading…</p>}
      {card === null && (
        <Card>
          <CardContent className="grid gap-3 text-sm">
            <p className="font-medium">Nothing is due right now. 🎉</p>
            {stats && <p className="text-muted-foreground">Today: {stats.reviewed} reviewed · {stats.added} added</p>}
            <div className="flex gap-2">
              <Button asChild><Link to="/">Find a new phrase</Link></Button>
              <Button variant="secondary" asChild><Link to="/listen">Practice listening</Link></Button>
            </div>
          </CardContent>
        </Card>
      )}
      {card && (
        <Card>
          <CardHeader>
            <CardDescription>{['Fill in the blank', 'Complete phrase', 'Explanation'][stage]} · {dueCount} due</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex items-start gap-2">
              <p className="text-xl leading-relaxed font-medium">{stage === 0 ? cloze : card.front}</p>
              {stage > 0 && <Button variant="ghost" size="icon" aria-label="Listen" onClick={() => speak(card.front)}><Volume2 /></Button>}
            </div>
            {stage === 2 && <p className="text-sm leading-relaxed whitespace-pre-wrap">{card.back.replace(/\*\*([^*]+)\*\*/g, '$1')}</p>}
            {stage < 2
              ? <div><Button size="lg" disabled={busy} onClick={() => { setStage(stage + 1); if (stage === 0) speak(card.front); }}>{stage === 0 ? 'Reveal phrase' : 'Show explanation'}</Button></div>
              : (
                <div className="grid grid-cols-4 gap-2">
                  {card.answerButtons.map(button => (
                    <Button key={button.type} size="lg" disabled={busy} className={`h-auto flex-col py-2 capitalize ${ratingStyles[button.type]}`} onClick={() => answer(button.type)}>
                      {button.type}<span className="text-xs font-normal opacity-80">{button.repeat}</span>
                    </Button>
                  ))}
                </div>
              )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
