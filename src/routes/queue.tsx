import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { More } from '@/components/more';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getQueue } from '@/data/cards';
import { errorMessage, postJson } from '@/lib/api-client';
import type { Candidate, SkipReason } from '@/lib/candidates-db';
import { findPhraseSpan } from '@/lib/practice';

export const Route = createFileRoute('/queue')({
  loader: () => getQueue(),
  head: () => ({ meta: [{ title: 'Queue · PhraseLoop' }] }),
  component: Queue,
});

const plain = (markdown: string) => markdown.replace(/\*\*([^*]+)\*\*/g, '$1');

function Highlighted({ text, phrase }: { text: string; phrase: string }) {
  const span = findPhraseSpan(text, phrase);
  if (!span) return <>{text}</>;
  return <>{text.slice(0, span.start)}<mark className="rounded bg-amber-100 px-0.5">{text.slice(span.start, span.end)}</mark>{text.slice(span.end)}</>;
}

// Cards written by Claude or ChatGPT wait here, oldest first (reading order for imported text). The learner reviews them
// one at a time: Learn it (after editing, if needed), I know it, or Not useful.
function Queue() {
  const { current, upNext, pending } = Route.useLoaderData();
  return (
    <>
      <PageHeader title="Queue" description={pending ? `${pending} card${pending === 1 ? '' : 's'} waiting for your review, oldest first.` : 'Cards written by Claude or ChatGPT wait here for your review.'} />
      {current ? (
        <div className="grid gap-4">
          <Review key={current.id} candidate={current} />
          {upNext.length > 0 && (
            <div className="grid gap-1.5 text-sm">
              <p className="font-medium text-muted-foreground">Up next</p>
              <ul className="grid gap-1">
                {upNext.map(candidate => <li key={candidate.id} className="truncate"><span className="font-medium">{candidate.phrase}</span> <span className="text-muted-foreground">· {candidate.draft.meaning}</span></li>)}
                {pending > upNext.length + 1 && <li className="text-muted-foreground">and {pending - upNext.length - 1} more</li>}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="grid gap-3 text-sm">
            <p className="font-medium">The queue is empty.</p>
            <p className="text-muted-foreground">
              Ask Claude or ChatGPT: “Find 10 new phrases in PhraseLoop”, or “Add <i>circle back</i> to PhraseLoop”.
              Nothing to read yet? <Link to="/library" className="underline">Import something to read</Link> and <Link to="/settings" className="underline">connect Claude or ChatGPT</Link>.
            </p>
            <div><Button asChild><Link to="/">Back to Today</Link></Button></div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

type Action = 'learn' | SkipReason;
// Keys work while not typing in the card's fields.
const shortcuts: Record<string, Action> = { l: 'learn', k: 'known', n: 'not_useful' };

function Review({ candidate }: { candidate: Candidate }) {
  const router = useRouter();
  const { draft } = candidate;
  const [front, setFront] = useState(draft.front);
  const [examples, setExamples] = useState(draft.examples.join('\n'));
  const [busy, setBusy] = useState<Action | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const act = useCallback(async (action: Action) => {
    if (action === 'learn' && !front.trim()) return;
    setStatus(null); setBusy(action);
    try {
      if (action === 'learn') {
        await postJson('/api/cards', {
          phrase: front.trim(), explanation: draft.explanation, keyExpression: draft.keyExpression,
          examples: examples.split('\n').map(line => line.trim()).filter(Boolean),
          originalInput: candidate.example ?? undefined, context: candidate.source ? `From "${candidate.source}"` : undefined, candidateId: candidate.id,
        });
      } else {
        await postJson(`/api/candidates/${candidate.id}/skip`, { reason: action });
      }
      await router.invalidate();
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); setBusy(null); }
  }, [candidate, draft, front, examples, router]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey || target.closest('input, textarea, [contenteditable]')) return;
      const action = shortcuts[event.key.toLowerCase()];
      if (action && !busy) { event.preventDefault(); void act(action); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, busy]);

  return (
    // The next card slides in after each decision.
    <Card className="animate-in fade-in slide-in-from-right-6 duration-300 ease-out motion-reduce:animate-none">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          {candidate.phrase}
          <Badge variant="secondary">{draft.score}/10</Badge>
          {draft.register && <Badge variant="outline">{draft.register}</Badge>}
        </CardTitle>
        <CardDescription>{draft.meaning}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {candidate.example && (
          <blockquote className="border-l-2 pl-3 text-sm">
            <Highlighted text={candidate.example} phrase={candidate.phrase} />
            {candidate.source && <span className="mt-1 block text-xs text-muted-foreground">{candidate.source}</span>}
          </blockquote>
        )}
        <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Why learn it:</span> {draft.reason}</p>
        {draft.usage && <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Usage:</span> {draft.usage}</p>}
        <div className="grid gap-1.5">
          <Label htmlFor="front">Card</Label>
          <Textarea id="front" value={front} onChange={event => setFront(event.target.value)} className="min-h-10" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="examples">Sentences to type <span className="font-normal text-muted-foreground">(one per line)</span></Label>
          <Textarea id="examples" value={examples} onChange={event => setExamples(event.target.value)} className="min-h-24" />
        </div>
        <More label="Meaning and notes"><p className="leading-relaxed whitespace-pre-wrap">{plain(draft.explanation)}</p></More>
        <div className="flex flex-wrap gap-2">
          <Button className="bg-emerald-700 hover:bg-emerald-700/85" disabled={busy !== null || !front.trim()} onClick={() => act('learn')}>
            {busy === 'learn' ? 'Saving…' : 'Learn it'}<kbd className="ml-1 text-xs opacity-70">L</kbd>
          </Button>
          <Button variant="secondary" disabled={busy !== null} onClick={() => act('known')} title="Kept as a memorized card, checked again in a month">
            I know it<kbd className="ml-1 text-xs opacity-70">K</kbd>
          </Button>
          <Button variant="secondary" disabled={busy !== null} onClick={() => act('not_useful')}>
            Not useful<kbd className="ml-1 text-xs opacity-70">N</kbd>
          </Button>
        </div>
        <StatusMessage status={status} />
      </CardContent>
    </Card>
  );
}
