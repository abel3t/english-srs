import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { More } from '@/components/more';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getStoriesPage } from '@/data/cards';
import { apiRequest, errorMessage } from '@/lib/api-client';

export const Route = createFileRoute('/stories')({
  loader: () => getStoriesPage(),
  head: () => ({ meta: [{ title: 'Stories · English SRS' }] }),
  component: Stories,
});

function Stories() {
  const router = useRouter();
  const { stories, learning } = Route.useLoaderData();
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
          <p className="text-sm text-muted-foreground">Real, natural English built from the phrases you are still memorizing. Ask Claude or ChatGPT: “Write me a story with my phrases in my English app.” Listen, then type it.</p>
        </div>
      </div>
      <StatusMessage status={status} />
      {!stories.length && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {learning ? 'No stories yet.' : 'Stories are built from phrases you are learning. Learn a few from Today first.'}
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
