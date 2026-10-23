import { Link, createFileRoute, useRouter } from '@tanstack/react-router';
import { Headphones } from 'lucide-react';
import { Equalizer } from '@/components/equalizer';
import { More } from '@/components/more';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getStoriesPage } from '@/data/cards';
import { apiRequest, errorMessage } from '@/lib/api-client';
import { player, usePlayer, type Track } from '@/lib/player';
import { toast } from 'sonner';

export const Route = createFileRoute('/stories')({
  loader: () => getStoriesPage(),
  head: () => ({ meta: [{ title: 'Stories · PhraseLoop' }] }),
  component: Stories,
});

function Stories() {
  const router = useRouter();
  const { stories, learning, hasElevenLabsKey } = Route.useLoaderData();
  // Stories with audio, or that can get it now (an ElevenLabs key is set), play in the mini player.
  const playable = stories.filter(story => story.hasAudio || hasElevenLabsKey);
  const trackOf = (story: (typeof stories)[number]): Track => ({ src: `/api/stories/${story.id}/audio`, title: story.title, subtitle: story.kind === 'conversation' ? 'Conversation' : 'Story', kind: 'story' });
  const now = usePlayer();
  const current = now.tracks[now.index];

  async function remove(id: number) {
    if (!confirm('Delete this story and its audio?')) return;
    try { await apiRequest(`/api/stories/${id}`, { method: 'DELETE' }); await router.invalidate(); }
    catch (error) { toast.error(errorMessage(error)); }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h1 className="text-2xl font-semibold tracking-tight">Stories</h1>
          <p className="text-sm text-muted-foreground">Real, natural English built from the phrases you are still memorizing. Ask Claude or ChatGPT: “Write me a story with my phrases in PhraseLoop.” Listen, then type it.</p>
        </div>
        {playable.length > 1 && (
          <Button variant="secondary" className="gap-1.5 rounded-full" onClick={() => player.play(playable.map(trackOf))}>
            <Headphones aria-hidden />Listen to all {playable.length}
          </Button>
        )}
      </div>
      {!stories.length && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {learning ? 'No stories yet.' : 'Stories are built from phrases you are learning. Learn a few from the Queue first.'}
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
              {!(story.hasAudio || hasElevenLabsKey) && (
                <p className="text-sm text-muted-foreground"><Link to="/settings" className="underline">Add your ElevenLabs API key in Settings</Link> to create story audio.</p>
              )}
              <More label="Read it">
                <div className="grid gap-1">{story.lines.map((line, index) => <p key={index}>{line.speaker && <b>{line.speaker}: </b>}{line.text}</p>)}</div>
              </More>
              <div className="flex flex-wrap gap-2">
                {(story.hasAudio || hasElevenLabsKey) && (current?.src === trackOf(story).src && now.status !== 'idle'
                  // Already in the player: the button pauses or resumes it.
                  ? <Button variant="secondary" className="gap-2" onClick={player.toggle}>
                      <Equalizer playing={now.status === 'playing'} />{now.status === 'playing' ? 'Pause' : 'Resume'}
                    </Button>
                  : <Button variant="secondary" className="gap-1.5" onClick={() => player.play([trackOf(story)])}><Headphones aria-hidden />Listen</Button>
                )}
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
