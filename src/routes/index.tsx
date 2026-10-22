import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LearnDialog } from '@/components/learn-dialog';
import { PracticeSetupDialog } from '@/components/practice-setup-dialog';
import { getToday } from '@/data/cards';
import { errorMessage, postJson } from '@/lib/api-client';
import type { Candidate } from '@/lib/candidates-db';
import { findPhraseSpan } from '@/lib/practice';

export const Route = createFileRoute('/')({
  loader: () => getToday(),
  component: Today,
});

function Example({ example, phrase }: { example: string; phrase: string }) {
  const span = findPhraseSpan(example, phrase);
  if (!span) return <span>{example}</span>;
  return <span>{example.slice(0, span.start)}<mark className="rounded bg-amber-100 px-0.5">{example.slice(span.start, span.end)}</mark>{example.slice(span.end)}</span>;
}

function Today() {
  const { overview, ready } = Route.useLoaderData();
  const [learning, setLearning] = useState<Candidate | null>(null);
  const [starting, setStarting] = useState(false);
  const metrics = [['Due to type', overview.due], ['Typed today', overview.reviewed], ['Learning', overview.total - overview.mature], ['Memorized', overview.mature]] as const;
  return (
    <>
      <PageHeader title="Today" description="Practise what is due, then choose which new cards to learn." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map(([label, value]) => (
          <Card key={label} size="sm"><CardContent>
            <div className="text-2xl font-semibold">{value}</div>
            <div className="text-sm text-muted-foreground">{label}</div>
          </CardContent></Card>
        ))}
      </div>
      <Button size="lg" className="mt-4 w-full sm:w-auto" onClick={() => setStarting(true)}>
        {overview.due ? `Start practice · ${overview.due} due` : 'Start practice'}
      </Button>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>New cards</CardTitle>
          <CardDescription>
            Written by Claude or ChatGPT from your books. Ask it: “Find 10 new phrases in my English app”, or “Add <i>circle back</i> to my English app”.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {ready.length
            ? ready.map(candidate => <NewCard key={candidate.id} candidate={candidate} onLearn={() => setLearning(candidate)} />)
            : <p className="text-sm text-muted-foreground">No new cards waiting. <Link to="/library" className="underline">Import a book</Link> and <Link to="/settings" className="underline">connect Claude or ChatGPT</Link> first.</p>}
        </CardContent>
      </Card>
      <LearnDialog candidate={learning} open={!!learning} onOpenChange={open => { if (!open) setLearning(null); }} />
      <PracticeSetupDialog open={starting} onOpenChange={setStarting} />
    </>
  );
}

function NewCard({ candidate, onLearn }: { candidate: Candidate; onLearn: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function skip() {
    setBusy(true);
    try { await postJson(`/api/candidates/${candidate.id}/skip`); await router.invalidate(); }
    catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); setBusy(false); }
  }

  return (
    <div className="grid gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{candidate.phrase}</span>
        <Badge variant="secondary">{candidate.draft.score}/10</Badge>
        <div className="ml-auto flex gap-1">
          <Button size="sm" onClick={onLearn}>Learn?</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={skip}>Skip</Button>
        </div>
      </div>
      {candidate.example && <p className="text-sm text-muted-foreground"><Example example={candidate.example} phrase={candidate.phrase} /></p>}
      <p className="text-sm">{candidate.draft.meaning}</p>
      <StatusMessage status={status} />
    </div>
  );
}
