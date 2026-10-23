import { Link, createFileRoute } from '@tanstack/react-router';
import { Check, ChevronDown, Headphones, LoaderCircle, SlidersHorizontal, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import type { PracticeCard } from '@/api/app';
import { AudioPlayer, type AudioPlayerHandle } from '@/components/audio-player';
import { SpeedControl } from '@/components/speed-control';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Equalizer } from '@/components/equalizer';
import { PracticeSetupDialog, type PracticeMode } from '@/components/practice-setup-dialog';
import { More } from '@/components/more';
import { TypingBox, type TypingHandle, type TypingResult } from '@/components/typing-box';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getStoryById } from '@/data/cards';
import { useClip } from '@/hooks/use-clip';
import { apiRequest, errorMessage, postJson } from '@/lib/api-client';
import { recordTyping } from '@/lib/activity';
import { player, sentenceTrack } from '@/lib/player';
import { blankSpans } from '@/lib/practice';
import type { Rating } from '@/lib/srs';
import type { Story } from '@/lib/stories';
import { toast } from 'sonner';

export const Route = createFileRoute('/practice')({
  validateSearch: z.object({
    mode: z.enum(['mixed', 'phrase', 'sentences', 'story']).catch('mixed').default('mixed'),
    blank: z.boolean().catch(false).default(false),
    story: z.number().int().positive().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => (deps.mode === 'story' && deps.story ? getStoryById({ data: { id: deps.story } }) : null),
  head: () => ({ meta: [{ title: 'Practice · PhraseLoop' }] }),
  component: Practice,
});

type Source = 'mixed' | 'phrase' | 'sentences';
const MODE_LABELS: Record<PracticeMode, string> = { mixed: 'Phrases and sentences', phrase: 'Phrases', sentences: 'Sentences', story: 'Story' };

// Settings are chosen in the Start practice dialog and carried in the URL; this page only does the typing.
function Practice() {
  const story = Route.useLoaderData();
  const search = Route.useSearch();
  const [changing, setChanging] = useState(false);
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Practice</h1>
        {/* What is being practised, as one button that opens the choice. */}
        <Button variant="outline" size="sm" className="min-w-0 gap-1.5 rounded-full" onClick={() => setChanging(true)} aria-label="Change what to practise">
          <SlidersHorizontal aria-hidden />
          <span className="truncate">{story ? story.title : MODE_LABELS[search.mode]}</span>
          <span className="shrink-0 text-muted-foreground">· Blanks {search.blank ? 'on' : 'off'}</span>
        </Button>
      </div>
      {story
        ? <StoryPractice key={`${story.id}-${search.blank}`} story={story} blank={search.blank} />
        : search.mode === 'story'
          ? <Card><CardContent className="text-sm text-muted-foreground">That story was not found. <Button variant="link" className="px-1" onClick={() => setChanging(true)}>Pick another</Button></CardContent></Card>
          : <CardPractice key={`${search.mode}-${search.blank}`} blank={search.blank} source={search.mode as Source} />}
      <PracticeSetupDialog open={changing} onOpenChange={setChanging} initial={search} />
    </>
  );
}

// ---------- due cards ----------

const confidence: Array<{ rating: Rating; label: string; style: string }> = [
  { rating: 'again', label: 'Didn’t know', style: 'bg-red-100 text-red-800 hover:bg-red-200' },
  { rating: 'hard', label: 'Unsure', style: 'bg-amber-100 text-amber-800 hover:bg-amber-200' },
  { rating: 'good', label: 'Confident', style: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' },
  { rating: 'easy', label: 'Easy', style: 'bg-sky-100 text-sky-800 hover:bg-sky-200' },
];

// Short enter animations (tw-animate-css); off when the learner prefers reduced motion.
const NEXT_CARD = 'animate-in fade-in slide-in-from-right-6 duration-300 ease-out motion-reduce:animate-none';
const APPEAR = 'animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none';

// A card due again within this many minutes ("Didn't know", "Unsure" on a new card) comes back at the end of the
// session instead of waiting for the next one.
const AGAIN_IN_SESSION_MINUTES = 15;

// The schedule is per card (the phrase is what is learned); its sentences take turns, one per review,
// so every review is a new context and none is skipped or repeated by chance.
function pickTexts(card: PracticeCard, source: Source): string[] {
  const sentences = card.texts.slice(1);
  if (source === 'phrase' || !sentences.length) return card.texts.slice(0, 1);
  return source === 'sentences' ? sentences : card.texts;
}

function CardPractice({ blank, source }: { blank: boolean; source: Source }) {
  const [cards, setCards] = useState<PracticeCard[] | null>(null);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try { setCards((await apiRequest<{ cards: PracticeCard[] }>('/api/practice/due')).cards); }
    catch (error) { toast.error(errorMessage(error)); setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const card = cards?.[0];
  if (failed) return <p className="text-sm text-muted-foreground">Could not load the cards. Reload the page to try again.</p>;
  if (!cards) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!card) {
    return (
      <Card>
        <CardContent className="grid gap-3 text-sm">
          <p className="font-medium">{done ? `Done: typed ${done} time${done === 1 ? '' : 's'}. 🎉` : 'Nothing is due right now.'}</p>
          <div className="flex gap-2">
            <Button asChild><Link to="/stories">Type a story</Link></Button>
            <Button variant="secondary" asChild><Link to="/queue">Review new cards</Link></Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  const onAnswered = (next: PracticeCard, dueAt: string) => {
    const again = new Date(dueAt).getTime() - Date.now() <= AGAIN_IN_SESSION_MINUTES * 60_000;
    setDone(count => count + 1);
    setCards(current => [...(current ?? []).slice(1), ...(again ? [next] : [])]);
  };
  const onError = (text: string) => toast.error(text);
  // A new card is drilled first; a learned one is reviewed and rated.
  return card.isNew
    ? <DrillItem key={`${card.id}-${done}-${blank}`} card={card} blank={blank} remaining={cards.length} onLearned={onAnswered} onError={onError} />
    : <CardItem key={`${card.id}-${done}-${blank}-${source}`} card={card} blank={blank} source={source} remaining={cards.length} onAnswered={onAnswered} onError={onError} />;
}

function CardItem({ card, blank, source, remaining, onAnswered, onError }: {
  card: PracticeCard; blank: boolean; source: Source; remaining: number; onAnswered: (next: PracticeCard, dueAt: string) => void; onError: (text: string) => void;
}) {
  const texts = pickTexts(card, source);
  // Each review starts on a random text. Before rating, the learner may type as much as they like: Enter types the
  // same sentence again, Tab / Shift+Tab (or the sentence buttons) switch to another one. The card is rated once.
  const [turn, setTurn] = useState(() => Math.floor(Math.random() * texts.length));
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<TypingResult | null>(null);
  const [results, setResults] = useState<TypingResult[]>([]);
  // Which texts have been typed: after a long gap every one of them is, before the card is rated.
  const [typed, setTyped] = useState<Set<number>>(new Set());
  const text = texts[turn];
  const ready = card.typeAll ? typed.size >= texts.length : results.length > 0;
  const accuracy = results.length ? results.reduce((sum, item) => sum + item.accuracy, 0) / results.length : undefined;
  const restart = useCallback((next: number) => { setTurn((next + texts.length) % texts.length); setAttempt(count => count + 1); setResult(null); }, [texts.length]);
  const [busy, setBusy] = useState(false);
  const [startedAt] = useState(Date.now());
  const { play, state: clipState } = useClip();
  // Passive listening: the chosen texts, one after another, in the mini player (it keeps playing on other pages).
  const [selected, setSelected] = useState<boolean[]>(() => texts.map(() => true));
  const toggle = (index: number) => setSelected(prev => prev.map((v, i) => i === index ? !v : v));
  const nameOf = (index: number) => (source === 'mixed' && index === 0 ? 'Phrase' : `Example ${source === 'mixed' ? index : index + 1}`);
  const name = card.keyExpression || card.phrase;
  const startListening = () => player.play(texts.map((item, index) => ({ item, index })).filter(({ index }) => selected[index])
    .map(({ item, index }) => sentenceTrack(item, `${name} · ${nameOf(index)}`)));
  // Hide the key expression; a bare phrase card with nothing to find hides the whole text.
  const blanks = useMemo(() => {
    if (!blank) return [];
    const spans = blankSpans(text, [card.keyExpression || card.phrase]);
    return spans.length ? spans : [{ start: 0, end: text.length }];
  }, [blank, text, card]);

  const answer = useCallback(async (rating: Rating) => {
    setBusy(true);
    try {
      const { card: next, dueAt } = await postJson<{ card: PracticeCard; dueAt: string }>('/api/practice/answer', { cardId: card.id, rating, durationMs: Date.now() - startedAt, accuracy });
      onAnswered(next, dueAt);
    } catch (error) { onError(errorMessage(error)); setBusy(false); }
  }, [card.id, startedAt, accuracy, onAnswered, onError]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || busy || (event.target as HTMLElement).closest('[role="dialog"]')) return;
      // Esc plays the sentence, even while typing it (it is never typed).
      if (event.key === 'Escape') { event.preventDefault(); void play(text); return; }
      if (event.key === 'Tab' && texts.length > 1) { event.preventDefault(); restart(turn + (event.shiftKey ? -1 : 1)); return; }
      // Enter and 1–4 only once the sentence is typed, so they never land in the text being typed.
      if (!result) return;
      if (event.key === 'Enter') { event.preventDefault(); restart(turn); return; }
      const choice = confidence[Number(event.key) - 1];
      if (choice && ready) { event.preventDefault(); void answer(choice.rating); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, ready, busy, answer, restart, turn, texts.length, play, text]);

  return (
    <Card className={NEXT_CARD}>
      {/* minmax(0, 1fr): the column never grows past the card, so long text or a row of buttons cannot overflow it. */}
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {/* What is being practised on its own line (never cut), then the count with the listening buttons. */}
        <div className="min-w-0">
          <p className="font-medium break-words">{card.keyExpression || 'Whole phrase'}</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{remaining} due</p>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="secondary" size="sm" className="h-8 gap-1.5 rounded-full px-2.5 sm:px-3" disabled={clipState === 'loading'} aria-busy={clipState === 'loading'}
                aria-label="Listen to this text (Esc)" title="Listen to this text (Esc)" onClick={() => play(text)}>
                {clipState === 'loading' ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
                  : clipState === 'playing' ? <Equalizer playing /> : <Volume2 aria-hidden="true" />}
                <span className="hidden sm:inline">Listen</span>
                <kbd className="hidden rounded border border-current/15 px-1 text-[10px] opacity-70 sm:inline">Esc</kbd>
              </Button>
              {texts.length > 1 && (
                <ListenToCard names={texts.map((_, index) => nameOf(index))} selected={selected} onToggle={toggle} onPlay={startListening} />
              )}
              <SpeedControl />
            </div>
          </div>
        </div>
        {texts.length > 1 && (
          <div className="flex min-w-0 items-center gap-3">
            <div role="tablist" aria-label="Text to type" className="flex max-w-full overflow-x-auto rounded-full bg-muted p-0.5 [scrollbar-width:none]">
              {texts.map((_, index) => (
                <button key={index} type="button" role="tab" aria-selected={index === turn} disabled={busy} onClick={() => restart(index)}
                  className={`h-7 shrink-0 rounded-full px-3 text-xs font-medium whitespace-nowrap transition-colors ${index === turn ? 'bg-background text-foreground shadow-sm' : card.typeAll && typed.has(index) ? 'text-emerald-700' : 'text-muted-foreground hover:text-foreground'}`}>
                  {source === 'mixed' && index === 0 ? 'Phrase' : <><span className="sm:hidden">Ex {source === 'mixed' ? index : index + 1}</span><span className="hidden sm:inline">{nameOf(index)}</span></>}
                </button>
              ))}
            </div>
            <span className="hidden text-xs text-muted-foreground sm:inline"><kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> to switch</span>
          </div>
        )}
        <div key={attempt} className="animate-in fade-in duration-200 motion-reduce:animate-none">
          <TypingBox text={text} blanks={blanks} onDone={typed => { recordTyping(text, typed.accuracy); setResult(typed); setResults(all => [...all, typed]); setTyped(done => new Set(done).add(turn)); }} />
        </div>
        {result && (
          <div className={`flex flex-wrap items-center justify-between gap-2 ${APPEAR}`}>
            <p className="text-sm text-muted-foreground">
              {Math.round(result.accuracy * 100)}% accuracy · {result.wpm} words/min · {result.errors} mistakes
              {results.length > 1 && ` · typed ${results.length} times, ${Math.round((accuracy ?? 0) * 100)}% on average`}
            </p>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => restart(turn)}>Type it again<kbd className="ml-1 hidden text-xs opacity-70 sm:inline">Enter</kbd></Button>
          </div>
        )}
        {card.typeAll && results.length > 0 && !ready && (
          <p className={`text-sm text-muted-foreground ${APPEAR}`}>
            Not seen for a while: type every text once ({typed.size} of {texts.length} done), then rate it. <kbd>Tab</kbd> goes to the next one.
          </p>
        )}
        {ready && (
          <>
            <More label="Meaning and notes">
              <p className="leading-relaxed whitespace-pre-wrap">{card.explanation.replace(/\*\*([^*]+)\*\*/g, '$1')}</p>
            </More>
            <div className={`grid gap-1.5 ${APPEAR}`}>
              <p className="text-sm font-medium">How confident were you?</p>
              <p className="hidden text-xs text-muted-foreground sm:block">
                {result ? 'Click a rating or use keys 1–4.' : 'Finish this text to enable keys 1–4, or click a rating.'}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {confidence.map((choice, index) => (
                  <Button key={choice.rating} size="lg" disabled={busy} onClick={() => answer(choice.rating)} className={`h-auto flex-col gap-1 py-3 ${choice.style}`}>
                    <span className="flex items-center gap-2">
                      {choice.label}
                      {result && <kbd aria-label={`Keyboard shortcut ${index + 1}`} className="hidden rounded border border-current/20 px-1.5 py-0.5 text-xs font-normal sm:inline">{index + 1}</kbd>}
                    </span>
                    <span className="text-xs font-normal opacity-80">again in {card.intervals[choice.rating]}</span>
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

// The first drill of a new card: every text typed card.drillTimes times, in rounds (phrase, example 1, example 2, …,
// then again from the phrase), read aloud. No rating: the last typing makes the card learned, first review an hour
// later. Progress is saved after every typing, so leaving halfway loses nothing.
function DrillItem({ card, blank, remaining, onLearned, onError }: {
  card: PracticeCard; blank: boolean; remaining: number; onLearned: (next: PracticeCard, dueAt: string) => void; onError: (text: string) => void;
}) {
  const texts = card.texts;
  const [counts, setCounts] = useState(card.drill);
  const [attempt, setAttempt] = useState(0);
  const [last, setLast] = useState<TypingResult | null>(null);
  const [learned, setLearned] = useState<{ next: PracticeCard; dueAt: string } | null>(null);
  const saving = useRef(Promise.resolve());
  const { play, state: clipState } = useClip();
  // The next text is the one typed least (the earliest on a tie): that makes the rounds.
  const turn = counts.reduce((best, count, index) => (count < counts[best] ? index : best), 0);
  const text = texts[turn];
  const total = texts.length * card.drillTimes;
  const typedCount = counts.reduce((sum, count) => sum + count, 0);
  const finished = typedCount >= total;
  const round = Math.min(card.drillTimes, Math.min(...counts) + 1);
  const name = card.keyExpression || card.phrase;
  const nameOf = (index: number) => (index === 0 ? 'Phrase' : `Example ${index}`);
  const blanks = useMemo(() => {
    if (!blank) return [];
    const spans = blankSpans(text, [card.keyExpression || card.phrase]);
    return spans.length ? spans : [{ start: 0, end: text.length }];
  }, [blank, text, card]);

  const typed = (result: TypingResult) => {
    const index = turn;
    recordTyping(text, result.accuracy);
    setCounts(current => current.map((count, i) => (i === index ? Math.min(card.drillTimes, count + 1) : count)));
    setLast(result);
    setAttempt(count => count + 1);
    // Saved in order, one after another; the server says when the card is learned.
    saving.current = saving.current
      .then(async () => {
        const response = await postJson<{ card: PracticeCard; learned: boolean; dueAt: string }>('/api/practice/drill', { cardId: card.id, textIndex: index, accuracy: result.accuracy });
        if (response.learned) setLearned({ next: response.card, dueAt: response.dueAt });
      })
      .catch(error => onError(errorMessage(error)));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || (event.target as HTMLElement).closest('[role="dialog"]')) return;
      if (event.key === 'Escape' && !finished) { event.preventDefault(); void play(text); }
      if (event.key === 'Enter' && learned) { event.preventDefault(); onLearned(learned.next, learned.dueAt); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finished, learned, onLearned, play, text]);

  return (
    <Card className={NEXT_CARD}>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <div className="min-w-0">
          <p className="font-medium break-words">{name}</p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground"><span className="font-medium text-amber-700">New</span> · first drill · {remaining} due</p>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="secondary" size="sm" className="h-8 gap-1.5 rounded-full px-2.5 sm:px-3" disabled={clipState === 'loading' || finished}
                aria-label="Listen to this text (Esc)" title="Listen to this text (Esc)" onClick={() => play(text)}>
                {clipState === 'loading' ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
                  : clipState === 'playing' ? <Equalizer playing /> : <Volume2 aria-hidden="true" />}
                <span className="hidden sm:inline">Listen</span>
                <kbd className="hidden rounded border border-current/15 px-1 text-[10px] opacity-70 sm:inline">Esc</kbd>
              </Button>
              <Button variant="secondary" size="sm" className="h-8 gap-1.5 rounded-full px-2.5 sm:px-3" aria-label="Listen to the whole card"
                onClick={() => player.play(texts.map((item, index) => sentenceTrack(item, `${name} · ${nameOf(index)}`)))}>
                <Headphones aria-hidden /><span className="hidden sm:inline">All</span>
              </Button>
              <SpeedControl />
            </div>
          </div>
        </div>

        {/* Overall progress, then each text's own count. */}
        <div className="grid gap-2">
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={typedCount} aria-label="Drill progress">
              <div className="h-full rounded-full bg-amber-500 transition-[width] duration-300" style={{ width: `${(typedCount / total) * 100}%` }} />
            </div>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{typedCount}/{total}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {texts.map((_, index) => {
              const complete = counts[index] >= card.drillTimes;
              return (
                <span key={index} className={`flex h-7 items-center gap-1 rounded-full px-2.5 text-xs tabular-nums transition-colors ${
                  !finished && index === turn ? 'bg-foreground text-background' : complete ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
                  {complete && <Check className="size-3" aria-hidden />}
                  <span className="sm:hidden">{index === 0 ? 'Phrase' : `Ex ${index}`}</span><span className="hidden sm:inline">{nameOf(index)}</span>
                  <span className="opacity-70">{counts[index]}/{card.drillTimes}</span>
                </span>
              );
            })}
          </div>
        </div>

        {learned ? (
          <div className={`grid gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-900 ${APPEAR}`}>
            <p className="flex items-center gap-2 font-medium"><Check className="size-4" aria-hidden />Learned: every text typed {card.drillTimes} times.</p>
            <p className="text-sm">First review in an hour, then a day, 3 days, a week… the gaps grow as long as you remember it.</p>
            <div><Button onClick={() => onLearned(learned.next, learned.dueAt)}>Next card<kbd className="ml-1 hidden text-xs opacity-70 sm:inline">Enter</kbd></Button></div>
          </div>
        ) : finished ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />Saving…</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Round {round} of {card.drillTimes} · {nameOf(turn)}</span>
              {last && <span className="tabular-nums">Last: {Math.round(last.accuracy * 100)}% · {last.wpm} wpm</span>}
            </div>
            <div key={attempt} className="animate-in fade-in duration-200 motion-reduce:animate-none">
              <TypingBox text={text} blanks={blanks} onDone={typed} />
            </div>
          </>
        )}
        <More label="Meaning and notes">
          <p className="leading-relaxed whitespace-pre-wrap">{card.explanation.replace(/\*\*([^*]+)\*\*/g, '$1')}</p>
        </More>
      </CardContent>
    </Card>
  );
}

// Listening to the card's texts one after another in the mini player: the button plays the chosen ones at once,
// the arrow opens the choice.
function ListenToCard({ names, selected, onToggle, onPlay }: { names: string[]; selected: boolean[]; onToggle: (index: number) => void; onPlay: () => void }) {
  const [open, setOpen] = useState(false);
  const count = selected.filter(Boolean).length;
  return (
    <div className="flex items-center rounded-full bg-secondary">
      <Button variant="secondary" size="sm" className="h-8 gap-1.5 rounded-l-full rounded-r-none px-2.5 sm:px-3" disabled={!count}
        aria-label={`Listen to ${count === names.length ? 'the whole card' : `${count} texts`}`} title="Listen to the whole card, one text after another" onClick={onPlay}>
        <Headphones aria-hidden /><span className="hidden sm:inline">{count === names.length ? 'All' : count}</span>
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm" className="h-8 rounded-l-none rounded-r-full border-l border-foreground/10 px-1.5" aria-label="Choose what to listen to">
            <ChevronDown aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-3">
          <p className="mb-2 text-sm font-medium">Listen to</p>
          <div className="grid gap-2">
            {names.map((name, index) => (
              <label key={name} className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={selected[index]} onCheckedChange={() => onToggle(index)} />{name}
              </label>
            ))}
          </div>
          <Button size="sm" className="mt-3 w-full gap-1.5" disabled={!count} onClick={() => { onPlay(); setOpen(false); }}>
            <Headphones aria-hidden />Play {count} {count === 1 ? 'text' : 'texts'}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ---------- a story or conversation ----------

// Monkeytype-style window over the story: the line just typed, the one being typed and the next two.
const LINES_AHEAD = 2;

function StoryPractice({ story, blank }: { story: Story & { canPlayAudio: boolean }; blank: boolean }) {
  const [line, setLine] = useState(0);
  const [results, setResults] = useState<TypingResult[]>([]);
  const player = useRef<AudioPlayerHandle>(null);
  const typing = useRef<TypingHandle>(null);
  // Esc plays or pauses the whole story, even while typing, without leaving the line being typed.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !player.current || (event.target as HTMLElement).closest('[role="dialog"]')) return;
      event.preventDefault();
      player.current.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const current = story.lines[line];
  const spansOf = (text: string) => (blank ? blankSpans(text, story.phrases) : []);
  const blanks = useMemo(() => (blank && current ? blankSpans(current.text, story.phrases) : []), [blank, current, story.phrases]);
  const average = (pick: (result: TypingResult) => number) => (results.length ? results.reduce((sum, result) => sum + pick(result), 0) / results.length : 0);
  // Who speaks is a label, never typed: small, in another font and color, without a colon.
  const speaker = (name: string | null) => name && <span className="mr-2 align-middle font-sans text-xs font-semibold tracking-wide text-primary/70 uppercase">{name}</span>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{story.title}</CardTitle>
        <CardDescription>{story.kind === 'conversation' ? 'Conversation' : 'Story'} · line {Math.min(line + 1, story.lines.length)} of {story.lines.length}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {story.canPlayAudio ? <div className="grid gap-1">
          {/* Using the player (play, pause, seek) gives the focus straight back to the typing. */}
          <AudioPlayer ref={player} src={`/api/stories/${story.id}/audio`} title={story.title} onInteraction={() => typing.current?.focus()} />
          <p className="text-xs text-muted-foreground"><kbd>Esc</kbd> plays or pauses it, even while you type.</p>
        </div> : <p className="text-sm text-muted-foreground"><Link to="/settings" className="underline">Add your ElevenLabs API key in Settings</Link> to create story audio.</p>}
        {current ? (
          <div key={line} className="grid gap-2 animate-in fade-in slide-in-from-bottom-4 duration-300 ease-out motion-reduce:animate-none">
            {line > 0 && <p className="text-sm text-muted-foreground/70">{speaker(story.lines[line - 1].speaker)}{story.lines[line - 1].text}</p>}
            {current.speaker && <p>{speaker(current.speaker)}</p>}
            <TypingBox key={`${line}-${blank}`} handle={typing} text={current.text} blanks={blanks} onDone={result => { recordTyping(current.text, result.accuracy); setResults(all => [...all, result]); setLine(line + 1); }} />
            {story.lines.slice(line + 1, line + 1 + LINES_AHEAD).map((next, index) => (
              <p key={line + 1 + index} className="font-mono text-lg leading-[1.8] tracking-[0.01em] text-muted-foreground/60">
                {speaker(next.speaker)}<Hidden text={next.text} spans={spansOf(next.text)} />
              </p>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 animate-in fade-in zoom-in-95 duration-300 ease-out motion-reduce:animate-none">
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

// An upcoming line, with its phrases already hidden in blank mode.
function Hidden({ text, spans }: { text: string; spans: Array<{ start: number; end: number }> }) {
  if (!spans.length) return <>{text}</>;
  return <>{[...text].map((char, index) => (char !== ' ' && spans.some(span => index >= span.start && index < span.end) ? '_' : char)).join('')}</>;
}
