import { Link, createFileRoute } from '@tanstack/react-router';
import { Volume2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import type { PracticeCard } from '@/api/app';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { TypingBox, type TypingResult } from '@/components/typing-box';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getStoryById } from '@/data/cards';
import { useClip } from '@/hooks/use-clip';
import { apiRequest, errorMessage, postJson } from '@/lib/api-client';
import { blankSpans } from '@/lib/practice';
import type { Rating } from '@/lib/srs';
import type { Story } from '@/lib/stories';

export const Route = createFileRoute('/practice')({
  validateSearch: z.object({ story: z.number().int().positive().optional().catch(undefined) }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => (deps.story ? getStoryById({ data: { id: deps.story } }) : null),
  head: () => ({ meta: [{ title: 'Practice · English SRS' }] }),
  component: Practice,
});

type Source = 'mixed' | 'phrase' | 'sentences';
const SETTINGS_KEY = 'practice-settings';

function useSettings() {
  const [settings, setSettings] = useState<{ blank: boolean; source: Source }>({ blank: false, source: 'mixed' });
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null'); if (saved) setSettings(current => ({ ...current, ...saved })); } catch { /* storage unavailable */ }
  }, []);
  const update = (change: Partial<typeof settings>) => setSettings(current => {
    const next = { ...current, ...change };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  return [settings, update] as const;
}

function Toggle({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={on} onChange={event => onChange(event.target.checked)} className="size-4" /> {children}
    </label>
  );
}

function Practice() {
  const story = Route.useLoaderData();
  const [settings, update] = useSettings();
  return (
    <>
      <PageHeader title="Practice" description="Type it Monkeytype-style and read it aloud as you go. Turn on blanks to fill the phrases from memory." />
      <div className="mb-3 flex flex-wrap items-center gap-4 rounded-lg bg-muted px-3 py-2">
        <Toggle on={settings.blank} onChange={blank => update({ blank })}>Blanks (hide the phrases)</Toggle>
        {!story && (
          <div className="flex gap-1 text-sm">
            {(['mixed', 'phrase', 'sentences'] as const).map(source => (
              <button key={source} onClick={() => update({ source })}
                className={`rounded-md px-2.5 py-1 capitalize ${settings.source === source ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}>
                {source === 'phrase' ? 'Phrases' : source === 'sentences' ? 'Sentences' : 'Mixed'}
              </button>
            ))}
          </div>
        )}
      </div>
      {story ? <StoryPractice key={story.id} story={story} blank={settings.blank} /> : <CardPractice blank={settings.blank} source={settings.source} />}
    </>
  );
}

function PlayButton({ text }: { text: string }) {
  const { play, state } = useClip();
  return <Button variant="ghost" size="sm" disabled={state === 'loading'} onClick={() => play(text)}><Volume2 />Listen</Button>;
}

// ---------- due cards ----------

const confidence: Array<{ rating: Rating; label: string; style: string }> = [
  { rating: 'again', label: 'Didn’t know', style: 'bg-red-100 text-red-800 hover:bg-red-200' },
  { rating: 'hard', label: 'Unsure', style: 'bg-amber-100 text-amber-800 hover:bg-amber-200' },
  { rating: 'good', label: 'Confident', style: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' },
  { rating: 'easy', label: 'Easy', style: 'bg-sky-100 text-sky-800 hover:bg-sky-200' },
];

function pickText(card: PracticeCard, source: Source): string {
  const sentences = card.texts.slice(1);
  if (source === 'phrase' || !sentences.length) return card.texts[0];
  if (source === 'sentences') return sentences[Math.floor(Math.random() * sentences.length)];
  return card.texts[Math.floor(Math.random() * card.texts.length)];
}

function CardPractice({ blank, source }: { blank: boolean; source: Source }) {
  const [cards, setCards] = useState<PracticeCard[] | null>(null);
  const [done, setDone] = useState(0);
  const [status, setStatus] = useState<Status>(null);

  const load = useCallback(async () => {
    try { setCards((await apiRequest<{ cards: PracticeCard[] }>('/api/practice/due')).cards); }
    catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const card = cards?.[0];
  if (status) return <StatusMessage status={status} />;
  if (!cards) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!card) {
    return (
      <Card>
        <CardContent className="grid gap-3 text-sm">
          <p className="font-medium">{done ? `Done: ${done} cards typed. 🎉` : 'Nothing is due right now.'}</p>
          <div className="flex gap-2">
            <Button asChild><Link to="/stories">Type a story</Link></Button>
            <Button variant="secondary" asChild><Link to="/">Learn new phrases</Link></Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <CardItem key={`${card.id}-${done}-${blank}-${source}`} card={card} blank={blank} source={source} remaining={cards.length}
      onAnswered={() => { setDone(count => count + 1); setCards(current => (current ?? []).slice(1)); }} onError={text => setStatus({ type: 'error', text })} />
  );
}

function CardItem({ card, blank, source, remaining, onAnswered, onError }: {
  card: PracticeCard; blank: boolean; source: Source; remaining: number; onAnswered: () => void; onError: (text: string) => void;
}) {
  const [text] = useState(() => pickText(card, source));
  const [result, setResult] = useState<TypingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [startedAt] = useState(Date.now());
  // Hide the key expression; a bare phrase card with nothing to find hides the whole text.
  const blanks = useMemo(() => {
    if (!blank) return [];
    const spans = blankSpans(text, [card.keyExpression || card.phrase]);
    return spans.length ? spans : [{ start: 0, end: text.length }];
  }, [blank, text, card]);

  const answer = useCallback(async (rating: Rating) => {
    setBusy(true);
    try {
      await postJson('/api/practice/answer', { cardId: card.id, rating, durationMs: Date.now() - startedAt, accuracy: result?.accuracy });
      onAnswered();
    } catch (error) { onError(errorMessage(error)); setBusy(false); }
  }, [card.id, startedAt, result, onAnswered, onError]);

  useEffect(() => {
    if (!result) return;
    const onKey = (event: KeyboardEvent) => { const choice = confidence[Number(event.key) - 1]; if (choice && !busy) void answer(choice.rating); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, busy, answer]);

  return (
    <Card>
      <CardHeader>
        <CardDescription>{remaining} due · {card.keyExpression || 'whole phrase'}</CardDescription>
        <div className="flex justify-end"><PlayButton text={text} /></div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <TypingBox text={text} blanks={blanks} onDone={setResult} />
        {result && (
          <>
            <p className="text-sm text-muted-foreground">{Math.round(result.accuracy * 100)}% accuracy · {result.wpm} words/min · {result.errors} mistakes</p>
            <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Meaning and notes</summary>
              <p className="mt-2 leading-relaxed whitespace-pre-wrap">{card.explanation.replace(/\*\*([^*]+)\*\*/g, '$1')}</p>
            </details>
            <div className="grid gap-1.5">
              <p className="text-sm font-medium">How confident were you?</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {confidence.map((choice, index) => (
                  <Button key={choice.rating} size="lg" disabled={busy} onClick={() => answer(choice.rating)} className={`h-auto flex-col py-2 ${choice.style}`}>
                    {choice.label}<span className="text-xs font-normal opacity-80">again in {card.intervals[choice.rating]} · {index + 1}</span>
                  </Button>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- a story or conversation ----------

function StoryPractice({ story, blank }: { story: Story; blank: boolean }) {
  const [line, setLine] = useState(0);
  const [results, setResults] = useState<TypingResult[]>([]);
  const current = story.lines[line];
  const blanks = useMemo(() => (blank && current ? blankSpans(current.text, story.phrases) : []), [blank, current, story.phrases]);
  const average = (pick: (result: TypingResult) => number) => (results.length ? results.reduce((sum, result) => sum + pick(result), 0) / results.length : 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{story.title}</CardTitle>
        <CardDescription>{story.kind === 'conversation' ? 'Conversation' : 'Story'} · line {Math.min(line + 1, story.lines.length)} of {story.lines.length}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <audio controls preload="none" src={`/api/stories/${story.id}/audio`} className="h-9 w-full" />
        <div className="grid gap-1 text-sm text-muted-foreground">
          {story.lines.slice(0, line).map((done, index) => <p key={index}>{done.speaker && <b>{done.speaker}: </b>}{done.text}</p>)}
        </div>
        {current ? (
          <>
            {current.speaker && <p className="text-sm font-semibold">{current.speaker}:</p>}
            <TypingBox key={`${line}-${blank}`} text={current.text} blanks={blanks} onDone={result => { setResults(all => [...all, result]); setLine(line + 1); }} />
          </>
        ) : (
          <div className="grid gap-3">
            <p className="font-medium">Finished! {Math.round(average(result => result.accuracy) * 100)}% accuracy · {Math.round(average(result => result.wpm))} words/min</p>
            <div className="flex gap-2">
              <Button onClick={() => { setLine(0); setResults([]); }}>Type it again</Button>
              <Button variant="secondary" asChild><Link to="/stories">Back to stories</Link></Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
