import { Link, createFileRoute } from '@tanstack/react-router';
import { DecisionBadge } from '@/components/decision-badge';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDashboard } from '@/data/learning';

export const Route = createFileRoute('/')({
  loader: () => getDashboard(),
  component: Dashboard,
});

function Dashboard() {
  const { overview, recent } = Route.useLoaderData();
  const metrics = [['This week', overview.thisWeek], ['Saved to Noji', overview.saved], ['Skipped', overview.skipped], ['Waiting', overview.pending]] as const;
  return (
    <>
      <PageHeader title="Your learning dashboard" description="A small view of what you analyzed and what actually became a Noji card." />
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
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Recent sentences</CardTitle>
          <CardAction><Button variant="link" size="sm" asChild><Link to="/history">View all</Link></Button></CardAction>
        </CardHeader>
        <CardContent className="divide-y">
          {recent.length ? recent.map(item => (
            <Link key={item.id} to="/history" search={{ q: item.keyExpression || item.mainSentence }}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="font-medium">{item.mainSentence}</div>
                <div className="text-sm text-muted-foreground">
                  {item.keyExpression || 'Whole sentence'} · {new Date(item.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' })}
                </div>
              </div>
              <DecisionBadge decision={item.userDecision} />
            </Link>
          )) : <p className="text-sm text-muted-foreground">No learning history yet. Analyze your first sentence.</p>}
        </CardContent>
      </Card>
      <Button className="mt-4" size="lg" asChild><Link to="/learn">Analyze new English</Link></Button>
    </>
  );
}
