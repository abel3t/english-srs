import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { StateBadge } from '@/components/card-badges';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { PhraseDecider } from '@/components/phrase-decider';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDashboard } from '@/data/cards';

export const Route = createFileRoute('/')({
  loader: () => getDashboard(),
  component: Dashboard,
});

function Dashboard() {
  const router = useRouter();
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

      {candidate ? (
        <Card className="mt-4 border-primary/30 ring-primary/20">
          <CardHeader>
            <CardDescription>Want to learn this phrase?</CardDescription>
            <CardAction><Button variant="link" size="sm" asChild><Link to="/phrases">Sort more ({overview.candidates})</Link></Button></CardAction>
          </CardHeader>
          <CardContent><PhraseDecider key={candidate.id} candidate={candidate} onDone={() => void router.invalidate()} /></CardContent>
        </Card>
      ) : <Card className="mt-4"><CardContent className="text-sm text-muted-foreground">No new phrase to offer right now. <Link to="/import" className="underline">Import a book or PDF</Link> to find more.</CardContent></Card>}

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
