import { Link, createFileRoute } from '@tanstack/react-router';
import { Gauge, Lightbulb, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ReviewCard } from '@/api/app';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { prefetchClip, useClip } from '@/hooks/use-clip';
import { apiRequest, errorMessage, postJson } from '@/lib/api-client';
import type { DailyStats } from '@/lib/cards-db';
import { compareDictation, makeCloze, suggestDictationRating, suggestTypingRating, typingTask, type DictationResult } from '@/lib/practice';
import type { Rating, ReviewMode } from '@/lib/srs';

export const Route = createFileRoute('/review')({
  head: () => ({ meta: [{ title: 'Review · English SRS' }] }),
  component: Review,
});

const modes: Array<{ id: ReviewMode; label: string; hint: string }> = [
  { id: 'classic', label: 'Recall', hint: 'Fill the blank in your head, then reveal' },
  { id: 'dictation', label: 'Dictation', hint: 'Listen and type what you hear' },
  { id: 'typing', label: 'Type it', hint: 'Type the phrase from memory' },
];
const MODE_KEY = 'review-mode';

type Answer = { rating: Rating; accuracy?: number };

function Review() {
  const [mode, setMode] = useState<ReviewMode>('classic');
  const [card, setCard] = useState<ReviewCard | null | undefined>(undefined);
  const [dueCount, setDueCount] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    try { const saved = localStorage.getItem(MODE_KEY); if (modes.some(item => item.id === saved)) setMode(saved as ReviewMode); } catch { /* storage unavailable */ }
  }, []);
  const chooseMode = (next: ReviewMode) => {
    setMode(next); setStartedAt(Date.now());
    try { localStorage.setItem(MODE_KEY, next); } catch { /* storage unavailable */ }
  };

  const loadNext = useCallback(async () => {
    setBusy(true); setStatus(null);
    try {
      const body = await apiRequest<{ card: ReviewCard | null; dueCount: number }>('/api/review/due');
      setCard(body.card); setDueCount(body.dueCount); setStartedAt(Date.now());
      if (body.card) prefetchClip(body.card.front);
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void loadNext(); }, [loadNext]);

  async function answer({ rating, accuracy }: Answer) {
    if (!card) return;
    setBusy(true); setStatus(null);
    try {
      const body = await postJson<{ stats: DailyStats }>('/api/review/answer', { cardId: card.cardId, answer: rating, reviewDurationMs: Date.now() - startedAt, mode, accuracy });
      setStats(body.stats);
      await loadNext();
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); setBusy(false); }
  }

  const ModeView = { classic: ClassicReview, dictation: DictationReview, typing: TypingReview }[mode];

  return (
    <>
      <PageHeader title="Review" description="Practice each due phrase by recalling it, hearing it, or typing it." />
      <div className="mb-3 flex flex-wrap gap-1 rounded-lg bg-muted p-1" role="tablist">
        {modes.map(item => (
          <button key={item.id} role="tab" aria-selected={mode === item.id} title={item.hint} onClick={() => chooseMode(item.id)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${mode === item.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {item.label}
          </button>
        ))}
      </div>
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
          <CardHeader><CardDescription>{modes.find(item => item.id === mode)!.hint} · {dueCount} due</CardDescription></CardHeader>
          <CardContent><ModeView key={`${card.cardId}-${mode}`} card={card} busy={busy} onAnswer={answer} /></CardContent>
        </Card>
      )}
    </>
  );
}

type ModeProps = { card: ReviewCard; busy: boolean; onAnswer: (answer: Answer) => void };

// ---------- shared pieces ----------

const ratingStyles: Record<Rating, string> = {
  again: 'bg-red-100 text-red-800 hover:bg-red-200',
  hard: 'bg-amber-100 text-amber-800 hover:bg-amber-200',
  good: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200',
  easy: 'bg-sky-100 text-sky-800 hover:bg-sky-200',
};

function RatingButtons({ card, busy, suggested, accuracy, onAnswer }: ModeProps & { suggested?: Rating; accuracy?: number }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (busy || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const button = card.answerButtons[Number(event.key) - 1];
      if (button) onAnswer({ rating: button.type, accuracy });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, card, accuracy, onAnswer]);

  return (
    <div className="grid gap-1.5">
      {suggested && <p className="text-xs text-muted-foreground">Suggested: <b className="capitalize">{suggested}</b>. Change it if it felt different.</p>}
      <div className="grid grid-cols-4 gap-2">
        {card.answerButtons.map((button, index) => (
          <Button key={button.type} size="lg" disabled={busy} onClick={() => onAnswer({ rating: button.type, accuracy })}
            className={`h-auto flex-col py-2 capitalize ${ratingStyles[button.type]} ${suggested === button.type ? 'ring-2 ring-foreground/60' : ''}`}>
            {button.type}<span className="text-xs font-normal opacity-80">{button.repeat} · {index + 1}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

function PlayButtons({ text, onPlay }: { text: string; onPlay?: () => void }) {
  const { play, state, usingFallback } = useClip();
  const go = (rate: number) => { onPlay?.(); void play(text, rate); };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" onClick={() => go(1)} disabled={state === 'loading'}><Volume2 />{state === 'loading' ? 'Loading…' : 'Play'}</Button>
      <Button variant="ghost" onClick={() => go(0.75)} disabled={state === 'loading'}><Gauge />Slow</Button>
      {usingFallback && <span className="text-xs text-muted-foreground">Using your browser’s voice (natural voice unavailable).</span>}
    </div>
  );
}

const plain = (markdown: string) => markdown.replace(/\*\*([^*]+)\*\*/g, '$1');
const meaningOf = (back: string) => /\*\*Meaning\*\*\n([^\n]+)/.exec(back)?.[1] ?? plain(back).split('\n').find(Boolean) ?? '';

function Explanation({ card }: { card: ReviewCard }) {
  return <p className="text-sm leading-relaxed whitespace-pre-wrap">{plain(card.back)}</p>;
}

function Phrase({ children }: { children: ReactNode }) {
  return <p className="text-xl leading-relaxed font-medium">{children}</p>;
}

// ---------- Recall ----------

function ClassicReview({ card, busy, onAnswer }: ModeProps) {
  const [stage, setStage] = useState(0);
  const [cloze] = useState(() => makeCloze(card.front, card.keyExpression));
  return (
    <div className="grid gap-4">
      <Phrase>{stage === 0 ? cloze : card.front}</Phrase>
      {stage > 0 && <PlayButtons text={card.front} />}
      {stage === 2 && <Explanation card={card} />}
      {stage < 2
        ? <div><Button size="lg" disabled={busy} onClick={() => setStage(stage + 1)}>{stage === 0 ? 'Reveal phrase' : 'Show explanation'}</Button></div>
        : <RatingButtons card={card} busy={busy} onAnswer={onAnswer} />}
    </div>
  );
}

// ---------- Dictation ----------

function DictationReview({ card, busy, onAnswer }: ModeProps) {
  const [typed, setTyped] = useState('');
  const [replays, setReplays] = useState(-1);
  const [result, setResult] = useState<DictationResult | null>(null);
  const check = () => setResult(compareDictation(card.front, typed));

  if (!result) {
    return (
      <div className="grid gap-4">
        <PlayButtons text={card.front} onPlay={() => setReplays(count => count + 1)} />
        <form onSubmit={event => { event.preventDefault(); check(); }} className="grid gap-2">
          <Input autoFocus value={typed} onChange={event => setTyped(event.target.value)} placeholder="Type exactly what you hear, then press Enter" className="h-10 bg-background text-base" />
          <div><Button type="submit" size="lg" disabled={!typed.trim() && replays < 0}>{typed.trim() ? 'Check' : 'I couldn’t catch it'}</Button></div>
        </form>
        <p className="text-xs text-muted-foreground">Tip: play it first. Use Slow as often as you need. Rating suggestions count replays.</p>
      </div>
    );
  }

  const suggested = suggestDictationRating(result.accuracy, Math.max(0, replays));
  return (
    <div className="grid gap-4">
      <p className="text-xl leading-relaxed">
        {result.tokens.map((token, index) => (
          <span key={index}>
            {token.status === 'ok' && <span className="text-emerald-700">{token.word}</span>}
            {token.status === 'missing' && <span className="rounded bg-red-100 px-0.5 text-red-800 underline decoration-wavy">{token.word}</span>}
            {token.status === 'wrong' && <span className="rounded bg-amber-100 px-0.5 text-amber-900">{token.word}<sup className="ml-0.5 text-xs text-red-700 line-through">{token.typed}</sup></span>}
            {' '}
          </span>
        ))}
      </p>
      <p className="text-sm text-muted-foreground">
        {Math.round(result.accuracy * 100)}% of words · {Math.max(0, replays)} replay{replays === 1 ? '' : 's'}
        {result.extra.length > 0 && <> · extra words: <span className="line-through">{result.extra.join(' ')}</span></>}
      </p>
      {result.insights.map(insight => (
        <p key={insight} className="flex gap-2 rounded-md bg-muted px-3 py-2 text-sm"><Lightbulb className="mt-0.5 size-4 shrink-0" />{insight}</p>
      ))}
      <PlayButtons text={card.front} />
      <Explanation card={card} />
      <RatingButtons card={card} busy={busy} suggested={suggested} accuracy={result.accuracy} onAnswer={onAnswer} />
    </div>
  );
}

// ---------- Type it ----------

const sameChar = (a: string | undefined, b: string | undefined) => a?.toLowerCase().replace('’', "'") === b?.toLowerCase().replace('’', "'");

function TypingReview({ card, busy, onAnswer }: ModeProps) {
  const [task] = useState(() => typingTask(card.front, card.keyExpression));
  const [typed, setTyped] = useState('');
  const [errors, setErrors] = useState(0);
  const [done, setDone] = useState<{ gaveUp: boolean; seconds: number } | null>(null);
  const startedAt = useRef(Date.now());
  const target = task.target;

  function finish(gaveUp: boolean) {
    setDone({ gaveUp, seconds: (Date.now() - startedAt.current) / 1000 });
  }

  function change(value: string) {
    if (done) return;
    const added = value.length > typed.length ? value.slice(typed.length) : '';
    const mistakes = [...added].filter((char, offset) => !sameChar(char, target[typed.length + offset])).length;
    if (mistakes) setErrors(count => count + mistakes);
    setTyped(value);
    if (value.length >= target.length && [...target].every((char, index) => sameChar(char, value[index]))) finish(false);
  }

  function hint() {
    let correct = 0;
    while (correct < typed.length && sameChar(typed[correct], target[correct])) correct++;
    setErrors(count => count + 1);
    change(target.slice(0, correct + 1));
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm"><span className="text-muted-foreground">Meaning:</span> {meaningOf(card.back)}</p>
      {task.prompt ? <Phrase>{task.prompt}</Phrase> : <p className="text-sm text-muted-foreground">Type the whole phrase.</p>}
      <p className="font-mono text-2xl tracking-wide break-words" aria-label="Your progress">
        {[...target].map((char, index) => {
          const typedChar = typed[index];
          if (typedChar === undefined) return <span key={index} className="text-muted-foreground/50">{char === ' ' ? ' ' : '_'}</span>;
          return <span key={index} className={sameChar(typedChar, char) ? 'text-emerald-700' : 'rounded bg-red-100 text-red-700'}>{typedChar === ' ' ? ' ' : typedChar}</span>;
        })}
      </p>
      {!done ? (
        <>
          <Input autoFocus value={typed} onChange={event => change(event.target.value)} spellCheck={false} autoComplete="off" autoCapitalize="off"
            placeholder="Start typing…" className="h-10 bg-background font-mono text-base" />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={hint}><Lightbulb />Hint (next letter)</Button>
            <Button variant="ghost" onClick={() => finish(true)}>Show answer</Button>
            <span className="ml-auto self-center text-xs text-muted-foreground">{errors} mistake{errors === 1 ? '' : 's'}</span>
          </div>
        </>
      ) : (
        <>
          <Phrase>{card.front}</Phrase>
          <p className="text-sm text-muted-foreground">
            {done.gaveUp ? 'Answer shown.' : `Done in ${done.seconds.toFixed(1)}s`} · {errors} mistake{errors === 1 ? '' : 's'}
          </p>
          <PlayButtons text={card.front} />
          <Explanation card={card} />
          <RatingButtons card={card} busy={busy} suggested={suggestTypingRating({ errors, ...done })}
            accuracy={done.gaveUp ? 0 : Math.max(0, 1 - errors / Math.max(1, target.length))} onAnswer={onAnswer} />
        </>
      )}
    </div>
  );
}
