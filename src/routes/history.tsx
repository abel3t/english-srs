import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { DecisionBadge } from '@/components/decision-badge';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getHistory, historySearchSchema, type HistorySearch } from '@/data/learning';
import { apiRequest, errorMessage, postJson } from '@/lib/api-client';
import type { LearningItem } from '@/lib/learning-db';

export const Route = createFileRoute('/history')({
  validateSearch: historySearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getHistory({ data: deps }),
  head: () => ({ meta: [{ title: 'History · English SRS' }] }),
  component: History,
});

const decisionOptions = [['all', 'All decisions'], ['saved', 'Saved'], ['edited_then_saved', 'Edited & saved'], ['skipped', 'Skipped'], ['pending', 'Waiting']] as const;

function History() {
  const items = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState(search.q ?? '');
  const [decision, setDecision] = useState<string>(search.decision ?? 'all');
  const [status, setStatus] = useState<Status>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    navigate({ search: { q: query.trim() || undefined, decision: decision === 'all' ? undefined : decision as HistorySearch['decision'] } });
  }

  return (
    <>
      <PageHeader title="Learning history" description="Search your D1 history and confirm items captured for later." />
      <form onSubmit={submit} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_180px_auto]">
        <Input className="col-span-2 h-9 bg-background sm:col-span-1" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search sentence or expression" />
        <Select value={decision} onValueChange={setDecision}>
          <SelectTrigger className="h-9 w-full bg-background"><SelectValue /></SelectTrigger>
          <SelectContent>{decisionOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="submit" size="lg">Search</Button>
      </form>
      <StatusMessage status={status} />
      <div className="mt-3 grid gap-2">
        {items.length
          ? items.map(item => <HistoryItem key={item.id} item={item} onError={text => setStatus({ type: 'error', text })} />)
          : <Card className="p-4 text-sm text-muted-foreground">No matching sentences.</Card>}
      </div>
    </>
  );
}

function HistoryItem({ item, onError }: { item: LearningItem; onError: (text: string) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(action: 'save' | 'skip' | 'delete') {
    if (action === 'delete' && !confirm('Permanently delete this row from D1 history? This cannot be undone. A card already saved in Noji will remain there.')) return;
    if (action === 'save' && !confirm('Save this card to Noji?')) return;
    setBusy(true);
    try {
      if (action === 'delete') await apiRequest(`/api/learning-items/${item.id}`, { method: 'DELETE' });
      else await postJson(`/api/learning-items/${item.id}/${action}`, action === 'save' ? { mainSentence: item.mainSentence, explanation: item.explanation } : undefined);
      await router.invalidate();
    } catch (error) { onError(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return (
    <details className="group rounded-xl bg-card ring-1 ring-foreground/10">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="font-medium">{item.mainSentence}</div>
          <div className="text-sm text-muted-foreground">
            {item.keyExpression || 'Whole sentence'} · {new Date(item.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium' })}
          </div>
        </div>
        <DecisionBadge decision={item.userDecision} />
      </summary>
      <div className="grid gap-2 border-t px-4 pt-3 pb-4 text-sm">
        <p><b>Original:</b> {item.originalInput}</p>
        {item.context && <p><b>Context:</b> {item.context}</p>}
        <p className="leading-relaxed whitespace-pre-wrap">{item.explanation}</p>
        {item.nojiNoteId && <p className="text-muted-foreground">Saved to Noji · note {item.nojiNoteId}</p>}
        <div className="mt-1 flex flex-wrap gap-2">
          {item.userDecision === 'pending' && (
            <>
              <Button className="bg-emerald-700 hover:bg-emerald-700/85" disabled={busy} onClick={() => run('save')}>Save to Noji</Button>
              <Button variant="secondary" disabled={busy} onClick={() => run('skip')}>Skip</Button>
            </>
          )}
          <Button variant="destructive" className="ml-auto" disabled={busy} onClick={() => run('delete')}>Delete permanently</Button>
        </div>
      </div>
    </details>
  );
}
