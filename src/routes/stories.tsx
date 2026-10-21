import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { More } from '@/components/more';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { getStoriesPage } from '@/data/cards';
import { apiRequest, errorMessage, postJson } from '@/lib/api-client';
import type { StoryKind } from '@/constants';

export const Route = createFileRoute('/stories')({
  loader: () => getStoriesPage(),
  head: () => ({ meta: [{ title: 'Stories · English SRS' }] }),
  component: Stories,
});

function Stories() {
  const router = useRouter();
  const { stories, learning } = Route.useLoaderData();
  const [kind, setKind] = useState<StoryKind>('conversation');
  const [topic, setTopic] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const toggle = (id: number) => setPicked(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  async function create() {
    setBusy(true); setStatus({ type: 'info', text: `Writing a ${kind}…` });
    try {
      await postJson('/api/stories', { kind, topic: topic.trim() || undefined, cardIds: [...picked] });
      setPicked(new Set()); setTopic(''); setStatus(null);
      await router.invalidate();
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(false); }
  }

  async function remove(id: number) {
    if (!confirm('Delete this story and its audio?')) return;
    try { await apiRequest(`/api/stories/${id}`, { method: 'DELETE' }); await router.invalidate(); }
    catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
  }

  return (
    <>
      <PageHeader title="Stories" description="A short story or conversation built from the phrases you are still memorizing. Listen to it, then type it." />
      <Card>
        <CardHeader><CardTitle>Create</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <ToggleGroup type="single" variant="outline" size="sm" value={kind} onValueChange={value => value && setKind(value as StoryKind)} className="justify-start">
            <ToggleGroupItem value="conversation">Conversation</ToggleGroupItem>
            <ToggleGroupItem value="story">Story</ToggleGroupItem>
          </ToggleGroup>
          <Input value={topic} onChange={event => setTopic(event.target.value)} placeholder="Optional topic, e.g. “a code review that went wrong”" className="h-9 bg-background" />
          {learning.length > 0 && (
            <div className="grid gap-1.5">
              <p className="text-muted-foreground">Pick phrases to include, or none and the AI picks from everything you are still learning:</p>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {learning.map(card => (
                  <Toggle key={card.id} variant="outline" size="sm" pressed={picked.has(card.id)} onPressedChange={() => toggle(card.id)}
                    className="h-7 rounded-full data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                    {card.keyExpression || card.phrase}
                  </Toggle>
                ))}
              </div>
            </div>
          )}
          <div><Button size="lg" disabled={busy || !learning.length} onClick={create}>{busy ? 'Writing…' : `Create ${kind}`}</Button></div>
          {!learning.length && <p className="text-muted-foreground">Learn a few phrases first: stories are built from them.</p>}
          <StatusMessage status={status} />
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-3">
        {stories.map(story => (
          <Card key={story.id}>
            <CardHeader>
              <CardTitle>{story.title}</CardTitle>
              <CardDescription className="capitalize">{story.kind} · {story.lines.length} lines · {story.phrases.join(', ')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <audio controls preload="none" src={`/api/stories/${story.id}/audio`} className="h-9 w-full" />
              <More label="Read it">
                <div className="grid gap-1">{story.lines.map((line, index) => <p key={index}>{line.speaker && <b>{line.speaker}: </b>}{line.text}</p>)}</div>
              </More>
              <div className="flex gap-2">
                <Button asChild><Link to="/practice" search={{ story: story.id }}>Type it</Link></Button>
                <Button variant="ghost" onClick={() => remove(story.id)}>Delete</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
