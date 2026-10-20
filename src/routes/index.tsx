import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { StateBadge } from '@/components/card-badges';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { getDashboard } from '@/data/cards';
import { errorMessage, postJson } from '@/lib/api-client';
import type { Candidate } from '@/lib/candidates-db';

export const Route = createFileRoute('/')({
  loader: () => getDashboard(),
  component: Dashboard,
});

function Dashboard() {
  const { overview, candidate, recent } = Route.useLoaderData();
  const metrics = [['Due now', overview.due], ['Reviewed today', overview.reviewed], ['Added today', overview.added], ['Cards', overview.total]] as const;
  return (
    <>
      <PageHeader title="Today" description="Review what is due, then pick something new to learn." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map(([label, value]) => (
          <Card key={label} size="sm">
            <CardContent>
              <div className="text-2xl font-semibold">{value}</div>
              <div className="text-sm text-muted-foreground">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="lg" asChild><Link to="/review">Review {overview.due ? `${overview.due} due` : 'cards'}</Link></Button>
        <Button size="lg" variant="secondary" asChild><Link to="/learn">Analyze a phrase</Link></Button>
        <Button size="lg" variant="secondary" asChild><Link to="/import">Import a book</Link></Button>
      </div>

      {candidate
        ? <PhrasePrompt candidate={candidate} remaining={overview.candidates} />
        : <Card className="mt-4"><CardContent className="text-sm text-muted-foreground">No new phrase to offer right now. <Link to="/import" className="underline">Import a book or PDF</Link> to find more.</CardContent></Card>}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Recently added</CardTitle>
          <CardAction><Button variant="link" size="sm" asChild><Link to="/cards">All cards</Link></Button></CardAction>
        </CardHeader>
        <CardContent className="divide-y">
          {recent.length ? recent.map(card => (
            <div key={card.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="font-medium">{card.phrase}</div>
                <div className="text-sm text-muted-foreground">{card.keyExpression || 'Whole sentence'}</div>
              </div>
              <StateBadge state={card.state} />
            </div>
          )) : <p className="text-sm text-muted-foreground">No cards yet. Learn your first phrase.</p>}
        </CardContent>
      </Card>
    </>
  );
}

// "Want to learn this?" — one random phrase from imported books or the Chrome extension.
function PhrasePrompt({ candidate, remaining }: { candidate: Candidate; remaining: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function act(action: 'snooze' | 'dismiss') {
    setBusy(true); setStatus(null);
    try { await postJson(`/api/candidates/${candidate.id}/${action}`); await router.invalidate(); }
    catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(false); }
  }

  return (
    <Card className="mt-4 border-primary/30 ring-primary/20">
      <CardHeader>
        <CardDescription>Want to learn this phrase?{candidate.source ? ` · from ${candidate.source}` : ''}</CardDescription>
        <CardTitle className="text-xl">{candidate.phrase}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {candidate.meaning && <p>{candidate.meaning}</p>}
        {candidate.example && <blockquote className="border-l-2 pl-3 text-muted-foreground italic">{candidate.example}</blockquote>}
        <StatusMessage status={status} />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button asChild><Link to="/learn" search={{ candidate: candidate.id }}>Yes, learn it</Link></Button>
        <Button variant="secondary" disabled={busy} onClick={() => act('snooze')}>Not now</Button>
        <Button variant="ghost" disabled={busy} onClick={() => act('dismiss')}>Never</Button>
        <span className="ml-auto text-xs text-muted-foreground">{remaining} waiting</span>
      </CardFooter>
    </Card>
  );
}
