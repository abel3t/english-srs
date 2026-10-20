import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage, postJson } from '@/lib/api-client';
import type { Conversation } from '@/lib/conversation';
import { geminiAudioToBlob } from '@/lib/wav';

export const Route = createFileRoute('/listen')({
  head: () => ({ meta: [{ title: 'Listen · English SRS' }] }),
  component: Listen,
});

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function Listen() {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [transcript, setTranscript] = useState('');
  const [audio, setAudio] = useState<{ url: string; transcript: string; extension: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio.url); }, [audio]);

  async function write() {
    setBusy(true); setStatus({ type: 'info', text: 'Picking phrases and writing a conversation…' });
    try {
      const body = await postJson<{ conversation: Conversation }>('/api/conversations');
      setConversation(body.conversation);
      setTranscript(body.conversation.lines.map(line => `${line.speaker}: ${line.text}`).join('\n'));
      setAudio(null); setStatus(null);
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(false); }
  }

  async function speak() {
    setBusy(true); setStatus({ type: 'info', text: 'Generating audio… this can take up to a minute.' });
    try {
      const text = transcript.trim();
      const blob = geminiAudioToBlob(await postJson('/api/conversations/audio', { transcript: text }));
      setAudio({ url: URL.createObjectURL(blob), transcript: text, extension: blob.type.split('/')[1]?.replace('mpeg', 'mp3') || 'wav' }); setStatus(null);
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(false); }
  }

  const fileName = `${(conversation?.title || 'conversation').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${audio?.extension ?? 'wav'}`;

  return (
    <>
      <PageHeader title="Conversation practice" description="Turn about 10 phrases you are learning into a real conversation, then listen to it." />
      <Card>
        <CardContent>
          <Button size="lg" disabled={busy} onClick={write}>{conversation ? 'Write another' : 'Pick phrases & write conversation'}</Button>
          <StatusMessage status={status} />
        </CardContent>
      </Card>

      {conversation && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{conversation.title}</CardTitle>
            <CardDescription>Built from {conversation.phrases.length} phrases you are learning</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {conversation.phrases.map(phrase => <li key={phrase}>{phrase}</li>)}
            </ol>
            <div className="grid gap-1.5">
              <Label htmlFor="transcript">Transcript <span className="font-normal text-muted-foreground">(edit before generating audio if you like)</span></Label>
              <Textarea id="transcript" className="min-h-80 leading-relaxed" value={transcript} onChange={event => setTranscript(event.target.value)} />
            </div>
            <div><Button size="lg" disabled={busy || !transcript.trim()} onClick={speak}>Generate audio</Button></div>
          </CardContent>
        </Card>
      )}

      {audio && conversation && (
        <Card className="mt-4">
          <CardContent className="grid gap-4">
            <audio controls src={audio.url} className="w-full" />
            <div><Button variant="secondary" asChild><a href={audio.url} download={fileName}>Download audio</a></Button></div>
            <ReadAlong transcript={audio.transcript} phrases={conversation.usedPhrases} />
          </CardContent>
        </Card>
      )}
    </>
  );
}

function ReadAlong({ transcript, phrases }: { transcript: string; phrases: string[] }) {
  const pattern = phrases.filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
  const highlight = pattern ? new RegExp(`(${pattern})`, 'gi') : null;
  return (
    <div className="space-y-1.5 leading-relaxed">
      {transcript.split('\n').filter(line => line.trim()).map((line, index) => {
        const [speaker, ...rest] = line.split(':');
        const said = rest.join(':').trim();
        return (
          <p key={index}>
            <b>{speaker}:</b>{' '}
            {highlight ? said.split(highlight).map((part, i) => i % 2 ? <mark key={i} className="rounded bg-amber-100 px-0.5">{part}</mark> : part) : said}
          </p>
        );
      })}
    </div>
  );
}
