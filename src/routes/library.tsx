import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { ImportDialog } from '@/components/book-import';
import { LearnDialog } from '@/components/learn-dialog';
import { StateBadge } from '@/components/card-badges';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cardsSearchSchema, getLibrary, type CardsSearch } from '@/data/cards';
import { apiRequest, errorMessage } from '@/lib/api-client';
import type { BookSummary } from '@/lib/books-db';
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
  const { cards, pending, books } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState(search.q ?? '');
  const [filter, setFilter] = useState<string>(search.state ?? 'all');
  const [status, setStatus] = useState<Status>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const apply = (nextQuery: string, nextFilter: string) =>
    navigate({ search: { q: nextQuery.trim() || undefined, state: nextFilter === 'all' ? undefined : nextFilter as CardsSearch['state'] }, replace: true });
  function submit(event: FormEvent) { event.preventDefault(); void apply(query, filter); }
  const filtered = !!search.q || !!search.state;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          <p className="text-sm text-muted-foreground">{cards.length} card{cards.length === 1 ? '' : 's'} · {pending} phrase{pending === 1 ? '' : 's'} waiting in suggestions</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImporting(true)}>Import</Button>
          <Button onClick={() => setAdding(true)}>Add a phrase</Button>
        </div>
      </div>
      <ImportDialog open={importing} onOpenChange={setImporting} />
      {books.length > 0 && <Books books={books} onError={text => setStatus({ type: 'error', text })} />}
      <LearnDialog candidate={null} open={adding} onOpenChange={setAdding} />
      {(cards.length > 0 || filtered) && (
        <form onSubmit={submit} className="grid grid-cols-[1fr_150px] gap-2">
          <Input className="h-9 bg-background" value={query} onChange={event => setQuery(event.target.value)} onBlur={() => apply(query, filter)} placeholder="Search your cards" />
          <Select value={filter} onValueChange={value => { setFilter(value); void apply(query, value); }}>
            <SelectTrigger className="h-9 w-full bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>{filterOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
        </form>
      )}
      <StatusMessage status={status} />
      <div className="mt-3 grid gap-2">
        {cards.length
          ? cards.map(card => <CardItem key={card.id} card={card} onError={text => setStatus({ type: 'error', text })} />)
          : filtered
            ? <Card className="p-4 text-sm text-muted-foreground">No matching cards.</Card>
            : (
              <Card className="grid justify-items-center gap-3 p-8 text-center text-sm text-muted-foreground">
                <p>No cards yet. Import a book to get daily suggestions, or add a phrase you met.</p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setImporting(true)}>Import</Button>
                  <Button onClick={() => setAdding(true)}>Add a phrase</Button>
                </div>
              </Card>
            )}
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
    <Collapsible className="rounded-xl bg-card ring-1 ring-foreground/10">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left">
        <div className="min-w-0">
          <div className="font-medium">{card.phrase}</div>
          <div className="text-sm text-muted-foreground">
            {card.keyExpression || 'Whole sentence'} · due {due <= new Date() ? 'now' : due.toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium' })}
          </div>
        </div>
        {card.intervalDays >= MEMORIZED_DAYS ? <span className="text-xs font-medium text-emerald-700">memorized</span> : <StateBadge state={card.state} />}
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-2 border-t px-4 pt-3 pb-4 text-sm">
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
      </CollapsibleContent>
    </Collapsible>
  );
}

// Imported books and how far the AI has got (the cron job reviews a few parts every 15 minutes).
function Books({ books, onError }: { books: BookSummary[]; onError: (text: string) => void }) {
  const router = useRouter();
  async function remove(book: BookSummary) {
    if (!confirm(`Delete "${book.title}"? Its text and the phrases still waiting are removed; your cards stay.`)) return;
    try { await apiRequest(`/api/books/${book.id}`, { method: 'DELETE' }); await router.invalidate(); }
    catch (error) { onError(errorMessage(error)); }
  }
  return (
    <div className="mb-4 grid gap-2">
      {books.map(book => {
        const finished = book.done + book.failed >= book.parts;
        return (
          <Card key={book.id} className="flex flex-row items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{book.title}</div>
              <div className="text-xs text-muted-foreground">
                {finished ? `AI reviewed all ${book.parts} parts` : `AI reviewed ${book.done} of ${book.parts} parts · continuing in the background`}
                {book.failed > 0 && ` · ${book.failed} could not be reviewed`}
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.round((book.done / Math.max(1, book.parts)) * 100)}%` }} /></div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => remove(book)}>Delete</Button>
          </Card>
        );
      })}
    </div>
  );
}
