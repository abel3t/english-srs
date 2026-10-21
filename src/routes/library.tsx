import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { BookImport } from '@/components/book-import';
import { StateBadge } from '@/components/card-badges';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cardsSearchSchema, getLibrary, type CardsSearch } from '@/data/cards';
import { apiRequest, errorMessage } from '@/lib/api-client';
import { MEMORIZED_DAYS, type Card as SavedCard } from '@/lib/cards-db';
import { formatInterval } from '@/lib/srs';

export const Route = createFileRoute('/library')({
  validateSearch: cardsSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getLibrary({ data: deps }),
  head: () => ({ meta: [{ title: 'Library · English SRS' }] }),
  component: Library,
});

const filterOptions = [
  ['all', 'All cards'], ['new', 'New'], ['learning', 'Learning'], ['review', 'Review'],
] as const;

function Library() {
  const { cards, pending } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState(search.q ?? '');
  const [filter, setFilter] = useState<string>(search.state ?? 'all');
  const [status, setStatus] = useState<Status>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    navigate({ search: { q: query.trim() || undefined, state: filter === 'all' ? undefined : filter as CardsSearch['state'] } });
  }

  return (
    <>
      <PageHeader title="Library" description="Add material, and browse everything you are learning." />
      <BookImport pending={pending} />
      <div className="mt-6 mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Your cards ({cards.length})</h2>
        <Button variant="secondary" asChild><Link to="/learn">Add a phrase</Link></Button>
      </div>
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

  async function remove() {
    if (!confirm('Permanently delete this card and its review history?')) return;
    setBusy(true);
    try {
      await apiRequest(`/api/cards/${card.id}`, { method: 'DELETE' });
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
        {card.intervalDays >= MEMORIZED_DAYS ? <span className="text-xs font-medium text-emerald-700">memorized</span> : <StateBadge state={card.state} />}
      </summary>
      <div className="grid gap-2 border-t px-4 pt-3 pb-4 text-sm">
        {card.originalInput && card.originalInput !== card.phrase && <p><b>Original:</b> {card.originalInput}</p>}
        {card.context && <p><b>Context:</b> {card.context}</p>}
        <p className="leading-relaxed whitespace-pre-wrap">{card.explanation.replace(/\*\*([^*]+)\*\*/g, '$1')}</p>
        {card.examples.length > 0 && <ul className="list-disc pl-5">{card.examples.map(example => <li key={example}>{example}</li>)}</ul>}
        <p className="text-muted-foreground">
          {card.reps} reviews · {card.lapses} lapses · interval {card.intervalDays ? formatInterval(card.intervalDays) : '—'} · ease {card.ease.toFixed(2)}
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Button variant="destructive" className="ml-auto" disabled={busy} onClick={remove}>Delete</Button>
        </div>
      </div>
    </details>
  );
}
