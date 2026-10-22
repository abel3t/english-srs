import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { Headphones } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ImportDialog } from '@/components/document-import';
import { StateBadge } from '@/components/card-badges';
import { StatusMessage, type Status } from '@/components/status-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DOCUMENTS_PER_PAGE, getLibrary, librarySearchSchema, type LibrarySearch } from '@/data/cards';
import { apiRequest, errorMessage } from '@/lib/api-client';
import { player, sentenceTrack } from '@/lib/player';
import type { DocumentPreview, DocumentSummary } from '@/lib/documents-db';
import { MEMORIZED_DAYS, cardTexts, type Card as SavedCard } from '@/lib/cards-db';
import { DRILL_TIMES, LADDER, formatInterval } from '@/lib/srs';

export const Route = createFileRoute('/library')({
  validateSearch: librarySearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getLibrary({ data: deps }),
  head: () => ({ meta: [{ title: 'Library · PhraseLoop' }] }),
  component: Library,
});

const filterOptions = [
  ['all', 'All cards'], ['new', 'New'], ['learning', 'Learning'], ['review', 'Review'],
] as const;

// Two tabs: the learner's cards, and what they imported for Claude or ChatGPT to read.
function Library() {
  const { totalCards, totalDocuments, pending } = Route.useLoaderData();
  const search = Route.useSearch();
  const [status, setStatus] = useState<Status>(null);
  const [importing, setImporting] = useState(false);
  const tabs = [['cards', 'Cards', totalCards], ['imported', 'Imported', totalDocuments]] as const;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          <p className="text-sm text-muted-foreground">{pending} new card{pending === 1 ? '' : 's'} waiting in the <Link to="/queue" className="underline">Queue</Link></p>
        </div>
        <Button onClick={() => setImporting(true)}>Import</Button>
      </div>
      <ImportDialog open={importing} onOpenChange={setImporting} />
      <nav className="mb-4 flex gap-1 border-b">
        {tabs.map(([tab, label, count]) => (
          <Link key={tab} to="/library" search={{ tab }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${search.tab === tab ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {label} <span className="text-xs text-muted-foreground">{count}</span>
          </Link>
        ))}
      </nav>
      <StatusMessage status={status} />
      {search.tab === 'cards'
        ? <CardsTab onImport={() => setImporting(true)} onError={text => setStatus({ type: 'error', text })} />
        : <ImportedTab onImport={() => setImporting(true)} onError={text => setStatus({ type: 'error', text })} />}
    </>
  );
}

// ---------- cards ----------

function CardsTab({ onImport, onError }: { onImport: () => void; onError: (text: string) => void }) {
  const { cards } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState(search.q ?? '');
  const [filter, setFilter] = useState<string>(search.state ?? 'all');
  const apply = (nextQuery: string, nextFilter: string) =>
    navigate({ search: { tab: 'cards', q: nextQuery.trim() || undefined, state: nextFilter === 'all' ? undefined : nextFilter as LibrarySearch['state'] }, replace: true });
  function submit(event: FormEvent) { event.preventDefault(); void apply(query, filter); }
  const filtered = !!search.q || !!search.state;

  // Passive listening: every visible card's phrase and examples, top to bottom, in the mini player.
  const tracks = cards.flatMap(card => {
    const name = card.keyExpression || card.phrase;
    return [sentenceTrack(card.phrase, name), ...card.examples.map((example, index) => sentenceTrack(example, `${name} · Example ${index + 1}`))];
  });

  return (
    <>
      {(cards.length > 0 || filtered) && (
        <form onSubmit={submit} className="grid grid-cols-[1fr_150px] gap-2">
          <Input className="h-9 bg-background" value={query} onChange={event => setQuery(event.target.value)} onBlur={() => apply(query, filter)} placeholder="Search your cards" />
          <Select value={filter} onValueChange={value => { setFilter(value); void apply(query, value); }}>
            <SelectTrigger className="h-9 w-full bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>{filterOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
        </form>
      )}
      {cards.length > 0 && (
        <div className="mt-3 flex items-center gap-3">
          <Button size="sm" variant="secondary" className="h-8 gap-1.5 rounded-full" onClick={() => player.play(tracks)}>
            <Headphones aria-hidden />Listen to these {cards.length} card{cards.length === 1 ? '' : 's'}
          </Button>
          <span className="text-xs text-muted-foreground">{tracks.length} phrases and examples, one after another</span>
        </div>
      )}
      <div className="mt-3 grid gap-2">
        {cards.length
          ? cards.map(card => <CardItem key={card.id} card={card} onError={onError} />)
          : filtered
            ? <Card className="p-4 text-sm text-muted-foreground">No matching cards.</Card>
            : (
              <Card className="grid justify-items-center gap-3 p-8 text-center text-sm text-muted-foreground">
                <p>No cards yet. Import something to read, then ask Claude or ChatGPT to find new phrases in it.</p>
                <Button onClick={onImport}>Import</Button>
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
          {card.state === 'new'
            ? `First drill: ${card.drill.reduce((total, count) => total + count, 0)} of ${cardTexts(card).length * DRILL_TIMES} typings`
            : `${card.reps} reviews · ${card.lapses} lapses · step ${card.step + 1} of ${LADDER.length} · next gap ${formatInterval(card.intervalDays)}`}
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Button variant="destructive" className="ml-auto" disabled={busy} onClick={remove}>Delete</Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------- imported ----------

const FORMAT_LABELS: Record<DocumentSummary['format'], string> = { pdf: 'PDF', epub: 'EPUB', docx: 'Word', text: 'Text' };

// What was imported, newest first, and how far Claude or ChatGPT has read each one (it reads on when asked for
// new phrases). Opening one shows a quick look at its text.
function ImportedTab({ onImport, onError }: { onImport: () => void; onError: (text: string) => void }) {
  const { documents, totalDocuments } = Route.useLoaderData();
  const { page } = Route.useSearch();
  const pages = Math.max(1, Math.ceil(totalDocuments / DOCUMENTS_PER_PAGE));

  if (!totalDocuments) {
    return (
      <Card className="grid justify-items-center gap-3 p-8 text-center text-sm text-muted-foreground">
        <p>Nothing imported yet: a book, a document, or text you paste.</p>
        <Button onClick={onImport}>Import</Button>
      </Card>
    );
  }
  return (
    <div className="grid gap-2">
      {documents.map(document => <DocumentItem key={document.id} document={document} onError={onError} />)}
      {!documents.length && <Card className="p-4 text-sm text-muted-foreground">Nothing on this page. <Link to="/library" search={{ tab: 'imported' }} className="underline">Back to the first page</Link></Card>}
      {pages > 1 && (
        <div className="flex items-center justify-between gap-2 pt-1 text-sm text-muted-foreground">
          <span>Page {page} of {pages}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={page <= 1} asChild={page > 1}>
              {page > 1 ? <Link to="/library" search={{ tab: 'imported', page: page - 1 }}>Previous</Link> : 'Previous'}
            </Button>
            <Button size="sm" variant="outline" disabled={page >= pages} asChild={page < pages}>
              {page < pages ? <Link to="/library" search={{ tab: 'imported', page: page + 1 }}>Next</Link> : 'Next'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentItem({ document, onError }: { document: DocumentSummary; onError: (text: string) => void }) {
  const router = useRouter();
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const percent = Math.round((document.read / Math.max(1, document.parts)) * 100);

  async function load(open: boolean) {
    if (!open || preview) return;
    try { setPreview(await apiRequest<DocumentPreview>(`/api/documents/${document.id}/preview`)); }
    catch (error) { onError(errorMessage(error)); }
  }

  async function remove() {
    if (!confirm(`Delete "${document.title}"? Its text and its new cards still waiting are removed; your learned cards stay.`)) return;
    try { await apiRequest(`/api/documents/${document.id}`, { method: 'DELETE' }); await router.invalidate(); }
    catch (error) { onError(errorMessage(error)); }
  }

  return (
    <Collapsible className="rounded-xl bg-card ring-1 ring-foreground/10" onOpenChange={load}>
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-4 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{document.title}</span>
            <Badge variant="outline">{FORMAT_LABELS[document.format]}</Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {document.words.toLocaleString()} words · {document.read >= document.parts ? 'read to the end' : `${percent}% read`}
            {' · '}{new Date(document.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium' })}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${percent}%` }} /></div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-3 border-t px-4 pt-3 pb-4 text-sm">
        {!preview
          ? <p className="text-muted-foreground">Loading…</p>
          : (
            <>
              {preview.start && <Excerpt label="Starts with" part={preview.start} />}
              {preview.next && <Excerpt label="Read next" part={preview.next} />}
            </>
          )}
        <div className="flex">
          <Button variant="destructive" className="ml-auto" onClick={remove}>Delete</Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Excerpt({ label, part }: { label: string; part: { chapterTitle: string; text: string } }) {
  return (
    <div className="grid gap-1">
      <p className="text-xs font-medium text-muted-foreground">{label} · {part.chapterTitle}</p>
      <p className="line-clamp-4 leading-relaxed whitespace-pre-wrap">{part.text}</p>
    </div>
  );
}
