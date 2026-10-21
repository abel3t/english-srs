import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { kindLabels } from '@/components/book-import';
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
  const { overview, suggestions } = Route.useLoaderData();
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
        <Button size="lg" variant="secondary" asChild><Link to="/stories">Stories</Link></Button>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Suggested for today</CardTitle>
          <CardDescription>{overview.candidates ? `From your books · ${overview.candidates} waiting` : 'Import a book in the Library to get suggestions.'}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {suggestions.length
            ? suggestions.map(candidate => <Suggestion key={candidate.id} candidate={candidate} />)
            : <p className="text-sm text-muted-foreground"><Link to="/library" className="underline">Import a book or PDF</Link>, or <Link to="/learn" className="underline">add a phrase yourself</Link>.</p>}
        </CardContent>
      </Card>
    </>
  );
}

function Suggestion({ candidate }: { candidate: Candidate }) {
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
          <Button size="sm" asChild><Link to="/learn" search={{ candidate: candidate.id }}>Learn?</Link></Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={skip}>Skip</Button>
        </div>
      </div>
      {candidate.example && <p className="text-sm text-muted-foreground"><Example example={candidate.example} phrase={candidate.phrase} /></p>}
      <StatusMessage status={status} />
    </div>
  );
}
