import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { kindLabels } from '@/components/book-import';
import { LearnDialog } from '@/components/learn-dialog';
import { getToday } from '@/data/cards';
import { errorMessage, postJson } from '@/lib/api-client';
import { DAILY_SUGGESTIONS, type Candidate } from '@/lib/candidates-db';
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
  const { overview, suggestions, handledToday } = Route.useLoaderData();
  const [learning, setLearning] = useState<{ candidate: Candidate | null } | null>(null);
  const metrics = [['Due to type', overview.due], ['Typed today', overview.reviewed], ['Learning', overview.total - overview.mature], ['Memorized', overview.mature]] as const;
  return (
    <>
      <PageHeader title="Today" description="Type what is due, then pick a few new phrases from your books." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map(([label, value]) => (
          <Card key={label} size="sm"><CardContent>
            <div className="text-2xl font-semibold">{value}</div>
            <div className="text-sm text-muted-foreground">{label}</div>
          </CardContent></Card>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="lg" asChild><Link to="/practice">{overview.due ? `Practice ${overview.due} due` : 'Practice'}</Link></Button>
        <Button size="lg" variant="secondary" onClick={() => setLearning({ candidate: null })}>Add a phrase</Button>
        <Button size="lg" variant="secondary" asChild><Link to="/stories">Stories</Link></Button>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Suggested for today</CardTitle>
          <CardDescription>
            {overview.candidates || handledToday ? `Up to ${DAILY_SUGGESTIONS} a day from your books · ${Math.min(handledToday, DAILY_SUGGESTIONS)} of ${DAILY_SUGGESTIONS} done today` : 'Import a book in the Library to get suggestions.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {suggestions.length
            ? suggestions.map(candidate => <Suggestion key={candidate.id} candidate={candidate} onLearn={() => setLearning({ candidate })} />)
            : handledToday >= DAILY_SUGGESTIONS
              ? <p className="text-sm text-muted-foreground">That’s today’s {DAILY_SUGGESTIONS}. 🎉 New suggestions tomorrow; type them in Practice.</p>
              : <p className="text-sm text-muted-foreground"><Link to="/library" className="underline">Import a book or PDF</Link> to get suggestions.</p>}
        </CardContent>
      </Card>
      <LearnDialog candidate={learning?.candidate ?? null} open={!!learning} onOpenChange={open => { if (!open) setLearning(null); }} />
    </>
  );
}

function Suggestion({ candidate, onLearn }: { candidate: Candidate; onLearn: () => void }) {
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
        <Badge variant="secondary">{kindLabels[candidate.kind]}</Badge>
        <div className="ml-auto flex gap-1">
          <Button size="sm" onClick={onLearn}>Learn?</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={skip}>Skip</Button>
        </div>
      </div>
      {candidate.example && <p className="text-sm text-muted-foreground"><Example example={candidate.example} phrase={candidate.phrase} /></p>}
      <StatusMessage status={status} />
    </div>
  );
}
