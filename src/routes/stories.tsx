import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { More } from '@/components/more';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Toggle } from '@/components/ui/toggle';
import { getStoriesPage } from '@/data/cards';
import { apiRequest, errorMessage, postJson } from '@/lib/api-client';
import type { Card as LearningCard } from '@/lib/cards-db';

export const Route = createFileRoute('/stories')({
  loader: () => getStoriesPage(),
  head: () => ({ meta: [{ title: 'Stories · English SRS' }] }),
  component: Stories,
});

function Stories() {
  const router = useRouter();
  const { stories, learning } = Route.useLoaderData();
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function remove(id: number) {
    if (!confirm('Delete this story and its audio?')) return;
    try { await apiRequest(`/api/stories/${id}`, { method: 'DELETE' }); await router.invalidate(); }
    catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h1 className="text-2xl font-semibold tracking-tight">Stories</h1>
          <p className="text-sm text-muted-foreground">Real, natural English built from the phrases you are still memorizing. Listen, then type it.</p>
        </div>
        <div className="grid justify-items-end gap-1">
          <Button disabled={!learning.length} onClick={() => setCreating(true)}>Create</Button>
          {!learning.length && <span className="text-xs text-muted-foreground">Learn a few phrases first</span>}
        </div>
      </div>
      <CreateStoryDialog open={creating} onOpenChange={setCreating} learning={learning} />
      <StatusMessage status={status} />
      {!stories.length && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {learning.length ? 'No stories yet. Click Create: the AI writes a conversation or a story with your phrases.' : 'Stories are built from phrases you are learning. Learn a few from Today first.'}
        </Card>
      )}

      <div className="mt-4 grid gap-3">
        {stories.map(story => (
          <Card key={story.id}>
            <CardHeader>
              <CardTitle>{story.title}</CardTitle>
              <CardDescription>{story.kind === 'conversation' ? 'Conversation' : 'Story'} · {story.lines.length} lines · {story.phrases.join(', ')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <audio controls preload="none" src={`/api/stories/${story.id}/audio`} className="h-9 w-full" />
              <More label="Read it">
                <div className="grid gap-1">{story.lines.map((line, index) => <p key={index}>{line.speaker && <b>{line.speaker}: </b>}{line.text}</p>)}</div>
              </More>
              <div className="flex gap-2">
                <Button asChild><Link to="/practice" search={{ mode: 'story', story: story.id, blank: false }}>Type it</Link></Button>
                <Button variant="ghost" onClick={() => remove(story.id)}>Delete</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

// Pick phrases (or none: the AI picks from everything still being learned) and an optional topic.
// The AI chooses a conversation or a story, whichever fits the phrases best.
function CreateStoryDialog({ open, onOpenChange, learning }: { open: boolean; onOpenChange: (open: boolean) => void; learning: LearningCard[] }) {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const toggle = (id: number) => setPicked(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  async function create() {
    setBusy(true); setStatus({ type: 'info', text: 'Writing it…' });
    try {
      await postJson('/api/stories', { topic: topic.trim() || undefined, cardIds: [...picked] });
      setPicked(new Set()); setTopic(''); setStatus(null);
      onOpenChange(false);
      await router.invalidate();
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create a story</DialogTitle>
          <DialogDescription>The AI writes a conversation or a short story, whichever makes your phrases sound most natural.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 text-sm">
          <div className="grid gap-1.5">
            <Label>Phrases <span className="font-normal text-muted-foreground">(optional: none picked = the AI chooses)</span></Label>
            <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
              {learning.map(card => (
                <Toggle key={card.id} variant="outline" size="sm" pressed={picked.has(card.id)} onPressedChange={() => toggle(card.id)} disabled={busy}
                  className="h-7 rounded-full data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  {card.keyExpression || card.phrase}
                </Toggle>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="story-topic">Topic <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="story-topic" value={topic} onChange={event => setTopic(event.target.value)} disabled={busy} placeholder="e.g. “a code review that went wrong”" className="h-9 bg-background" />
          </div>
          <StatusMessage status={status} />
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={create}>{busy ? 'Writing…' : picked.size ? `Create with ${picked.size} phrase${picked.size === 1 ? '' : 's'}` : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
