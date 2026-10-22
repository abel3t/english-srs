import { Link, createFileRoute } from '@tanstack/react-router';
import { Headphones, Keyboard } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PracticeSetupDialog } from '@/components/practice-setup-dialog';
import { StudyChart } from '@/components/study-chart';
import { getToday } from '@/data/cards';
import { player, sentenceTrack } from '@/lib/player';
import { formatMinutes } from '@/lib/study';

export const Route = createFileRoute('/')({
  loader: () => getToday(),
  component: Today,
});

// How much was studied (typing and listening), then the two jobs of the day: type what is due, and review the
// queue of new cards written by Claude or ChatGPT.
function Today() {
  const { overview, pending, peek, study, listen } = Route.useLoaderData();
  const listenToCards = () => player.play(listen.flatMap(card => [
    sentenceTrack(card.phrase, card.name),
    ...card.examples.map((example, index) => sentenceTrack(example, `${card.name} · Example ${index + 1}`)),
  ]));
  const [starting, setStarting] = useState(false);
  const today = study.today;
  const metrics = [['Due to type', overview.due], ['Learning', overview.total - overview.mature], ['Memorized', overview.mature]] as const;
  return (
    <>
      <PageHeader title="Today" description="Practise what is due, listen, then review the new cards in your queue." />
      <Card className="mb-4">
        <CardHeader>
          <CardDescription>Studied today</CardDescription>
          <CardTitle className="text-4xl font-semibold tabular-nums">{formatMinutes(today.typingSeconds + today.listeningSeconds)}</CardTitle>
          <CardAction className="text-right text-sm">
            <p className="font-medium tabular-nums">{study.streak ? `${study.streak}-day streak` : 'No streak yet'}</p>
            <p className="text-muted-foreground tabular-nums">{formatMinutes(study.weekSeconds)} this week</p>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-muted-foreground tabular-nums">
            Typing {formatMinutes(today.typingSeconds)} · {today.sentences} sentence{today.sentences === 1 ? '' : 's'} · Listening {formatMinutes(today.listeningSeconds)}
          </p>
          <StudyChart days={study.days} />
          <p className="text-xs text-muted-foreground">Counted on the low side: typing at 40 words a minute, listening by the time you actually listened (never more than the audio's length; pauses and skips don't count).</p>
        </CardContent>
      </Card>
      <div className="grid grid-cols-3 gap-3">
        {metrics.map(([label, value]) => (
          <Card key={label} size="sm"><CardContent>
            <div className="text-2xl font-semibold">{value}</div>
            <div className="text-sm text-muted-foreground">{label}</div>
          </CardContent></Card>
        ))}
      </div>
      {/* The two main actions, side by side; full width on phones. */}
      <div className="mt-4 grid gap-2 sm:flex">
        <Button size="lg" className="gap-2" onClick={() => setStarting(true)}>
          <Keyboard aria-hidden />{overview.due ? `Start practice · ${overview.due} due` : 'Start practice'}
        </Button>
        <Button size="lg" variant="secondary" className="gap-2" disabled={!listen.length} onClick={listenToCards}>
          <Headphones aria-hidden />Listen to your cards{listen.length ? ` · ${listen.length}` : ''}
        </Button>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Queue</CardTitle>
          <CardDescription>
            {pending ? `${pending} new card${pending === 1 ? '' : 's'} waiting for your review.` : 'No new cards waiting.'}
          </CardDescription>
          {pending > 0 && <CardAction><Button asChild><Link to="/queue">Review</Link></Button></CardAction>}
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {pending
            ? <p>Next: <span className="text-foreground">{peek.join(' · ')}</span>{pending > peek.length && ' …'}</p>
            : <p>Ask Claude or ChatGPT: “Find 10 new phrases in PhraseLoop”. Nothing to read yet? <Link to="/library" className="underline">Import something to read</Link> and <Link to="/settings" className="underline">connect Claude or ChatGPT</Link>.</p>}
        </CardContent>
      </Card>
      <PracticeSetupDialog open={starting} onOpenChange={setStarting} />
    </>
  );
}
