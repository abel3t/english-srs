import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { StateBadge, SyncBadge } from '@/components/card-badges';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cardsSearchSchema, getCards, type CardsSearch } from '@/data/cards';
import { apiRequest, errorMessage, postJson } from '@/lib/api-client';
import type { Card as SavedCard } from '@/lib/cards-db';
import { formatInterval } from '@/lib/srs';

export const Route = createFileRoute('/cards')({
  validateSearch: cardsSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getCards({ data: deps }),
  head: () => ({ meta: [{ title: 'Cards · English SRS' }] }),
  component: Cards,
});

const filterOptions = [
  ['all', 'All cards'], ['new', 'New'], ['learning', 'Learning'], ['review', 'Review'], ['failed', 'Noji sync failed'], ['pending', 'Not in Noji yet'],
] as const;

function Cards() {
  const cards = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState(search.q ?? '');
  const [filter, setFilter] = useState<string>(search.state ?? search.sync ?? 'all');
  const [status, setStatus] = useState<Status>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const state = ['new', 'learning', 'review'].includes(filter) ? filter as CardsSearch['state'] : undefined;
    const sync = ['failed', 'pending'].includes(filter) ? filter as CardsSearch['sync'] : undefined;
    navigate({ search: { q: query.trim() || undefined, state, sync } });
  }

  return (
    <>
      <PageHeader title="Cards" description="Everything you decided to learn, with its review schedule and Noji sync status." />
      <form onSubmit={submit} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_200px_auto]">
        <Input className="col-span-2 h-9 bg-background sm:col-span-1" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search phrase or expression" />
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="h-9 w-full bg-background"><SelectValue /></SelectTrigger>
          <SelectContent>{filterOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="submit" size="lg">Search</Button>
      </form>
      <StatusMessage status={status} />
      <div className="mt-3 grid gap-2">
        {cards.length
          ? cards.map(card => <CardItem key={card.id} card={card} onError={text => setStatus({ type: 'error', text })} />)
          : <Card className="p-4 text-sm text-muted-foreground">No matching cards.</Card>}
      </div>
    </>
  );
}

function CardItem({ card, onError }: { card: SavedCard; onError: (text: string) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const due = new Date(card.dueAt);

  async function run(action: 'sync' | 'delete') {
    if (action === 'delete' && !confirm('Permanently delete this card and its review history? A copy already in Noji will remain there.')) return;
    setBusy(true);
    try {
      if (action === 'delete') await apiRequest(`/api/cards/${card.id}`, { method: 'DELETE' });
      else await postJson(`/api/cards/${card.id}/sync`);
      await router.invalidate();
    } catch (error) { onError(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return (
    <details className="rounded-xl bg-card ring-1 ring-foreground/10">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="font-medium">{card.phrase}</div>
          <div className="text-sm text-muted-foreground">
            {card.keyExpression || 'Whole sentence'} · due {due <= new Date() ? 'now' : due.toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium' })}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1"><StateBadge state={card.state} /><SyncBadge status={card.nojiSyncStatus} /></div>
      </summary>
      <div className="grid gap-2 border-t px-4 pt-3 pb-4 text-sm">
        {card.originalInput && card.originalInput !== card.phrase && <p><b>Original:</b> {card.originalInput}</p>}
        {card.context && <p><b>Context:</b> {card.context}</p>}
        <p className="leading-relaxed whitespace-pre-wrap">{card.explanation.replace(/\*\*([^*]+)\*\*/g, '$1')}</p>
        <p className="text-muted-foreground">
          {card.reps} reviews · {card.lapses} lapses · interval {card.intervalDays ? formatInterval(card.intervalDays) : '—'} · ease {card.ease.toFixed(2)}
        </p>
        {card.nojiSyncError && <p className="text-red-700">Noji: {card.nojiSyncError}</p>}
        <div className="mt-1 flex flex-wrap gap-2">
          {card.nojiSyncStatus !== 'synced' && <Button variant="secondary" disabled={busy} onClick={() => run('sync')}>Retry Noji sync</Button>}
          <Button variant="destructive" className="ml-auto" disabled={busy} onClick={() => run('delete')}>Delete</Button>
        </div>
      </div>
    </details>
  );
}
