import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { PhraseDecider } from '@/components/phrase-decider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getPhrasesPage } from '@/data/cards';

export const Route = createFileRoute('/phrases')({
  loader: () => getPhrasesPage(),
  head: () => ({ meta: [{ title: 'Phrases · English SRS' }] }),
  component: Phrases,
});

function Phrases() {
  const router = useRouter();
  const { queue, bands, queued, counts } = Route.useLoaderData();
  const [position, setPosition] = useState(0);
  const [sorted, setSorted] = useState(0);
  useEffect(() => setPosition(0), [queue]);

  const current = queue[position];
  // Work through the loaded queue locally, then fetch a fresh one (the ranking adapts to each decision).
  const next = () => {
    setSorted(count => count + 1);
    if (position + 1 < queue.length) setPosition(position + 1);
    else void router.invalidate();
  };

  return (
    <>
      <PageHeader title="Phrases" description="Sort phrases found in your books. Keys: 1 use · 2 recognize · 3 new · 4 not useful · L later." />
      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <Card>
          <CardHeader>
            <CardDescription>{counts.pending} waiting{sorted ? ` · ${sorted} sorted this session` : ''}</CardDescription>
          </CardHeader>
          <CardContent>
            {current
              ? <PhraseDecider key={current.id} candidate={current} onDone={next} />
              : <p className="text-sm text-muted-foreground">Nothing to sort. <Link to="/import" className="underline">Import a book or PDF</Link> to find phrases.</p>}
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <Card size="sm">
            <CardHeader>
              <CardTitle>What you already use</CardTitle>
              <CardDescription>Estimated from your choices. Phrases you probably know are offered later.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2.5 text-sm">
              {bands.map(band => (
                <div key={band.label} className="grid gap-1">
                  <div className="flex justify-between"><span>{band.label}</span><span className="text-muted-foreground tabular-nums">{Math.round(band.estimate * 100)}%</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.round(band.estimate * 100)}%` }} /></div>
                  <div className="text-xs text-muted-foreground">{band.decisions ? `${band.decisions} decisions` : 'starting guess'}</div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">{counts.known} phrases marked as already used.</p>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader><CardTitle>Queued to learn ({queued.length})</CardTitle></CardHeader>
            <CardContent className="grid gap-1 text-sm">
              {queued.length ? queued.slice(0, 10).map(item => (
                <Link key={item.id} to="/learn" search={{ candidate: item.id }} className="truncate underline-offset-2 hover:underline">{item.phrase}</Link>
              )) : <p className="text-muted-foreground">Phrases you mark “New to me” wait here until you analyze them.</p>}
            </CardContent>
          </Card>
          <Button variant="secondary" asChild><Link to="/import">Import a book</Link></Button>
        </div>
      </div>
    </>
  );
}
