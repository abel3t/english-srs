import { createFileRoute, useRouter } from '@tanstack/react-router';
import { Check, Mic, Square, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { getRecentSpeaking } from '@/data/cards';
import { useClip } from '@/hooks/use-clip';
import { apiRequest, errorMessage, postJson } from '@/lib/api-client';
import { FILLER, MAX_RECORDING_SECONDS } from '@/lib/practice';
import { startRecording, type Recorder } from '@/lib/recorder';
import type { SpeakingAttempt } from '@/lib/speaking';

export const Route = createFileRoute('/speak')({
  loader: () => getRecentSpeaking(),
  head: () => ({ meta: [{ title: 'Speak · English SRS' }] }),
  component: Speak,
});

type Question = { question: string; tip: string; phrases: string[] };
type Attempt = SpeakingAttempt & { localUrl: string };

const scoreLabels = [['grammar', 'Grammar'], ['vocabulary', 'Vocabulary'], ['fluency', 'Fluency'], ['clarity', 'Clarity']] as const;
const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function Speak() {
  const router = useRouter();
  const recent = Route.useLoaderData();
  const [topic, setTopic] = useState('');
  const [question, setQuestion] = useState<Question | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [busy, setBusy] = useState<'question' | 'feedback' | null>(null);
  const [status, setStatus] = useState<Status>(null);

  async function newQuestion() {
    setBusy('question'); setStatus(null);
    try {
      setQuestion(await postJson<Question>('/api/speaking/question', { topic: topic.trim() || undefined }));
      setSessionId(crypto.randomUUID()); setAttempts([]);
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function submit(blob: Blob) {
    if (!question) return;
    setBusy('feedback'); setStatus({ type: 'info', text: 'Listening to your answer and preparing feedback… usually under 30 seconds, up to 2 minutes when Gemini is busy.' });
    try {
      const form = new FormData();
      form.set('meta', JSON.stringify({ sessionId, attempt: attempts.length + 1, question: question.question, phrases: question.phrases }));
      form.set('audio', blob, 'answer.wav');
      const body = await apiRequest<{ attempt: SpeakingAttempt }>('/api/speaking/attempts', { method: 'POST', body: form });
      setAttempts(current => [...current, { ...body.attempt, localUrl: URL.createObjectURL(blob) }]);
      setStatus(null);
      void router.invalidate();
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  const latest = attempts.at(-1);
  const first = attempts[0];

  return (
    <>
      <PageHeader title="Speak" description="Answer out loud, get specific feedback, repeat a better version, then try again." />
      <Card>
        <CardHeader>
          <CardDescription>{question ? `Your question · attempt ${attempts.length + 1}` : 'Get a question that uses the phrases you are learning'}</CardDescription>
          {question && <CardTitle className="text-xl leading-snug">{question.question}</CardTitle>}
        </CardHeader>
        <CardContent className="grid gap-3">
          {question && (
            <>
              {question.phrases.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="text-muted-foreground">Try to use:</span>
                  {question.phrases.map(phrase => <Badge key={phrase} variant="secondary">{phrase}</Badge>)}
                </div>
              )}
              {question.tip && <p className="text-sm text-muted-foreground">Tip: {question.tip}</p>}
              <RecordPanel disabled={busy !== null} onRecorded={submit} />
            </>
          )}
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Input value={topic} onChange={event => setTopic(event.target.value)} placeholder="Optional topic, e.g. “a production incident I handled”" className="h-9 min-w-56 flex-1 bg-background" />
            <Button variant={question ? 'secondary' : 'default'} disabled={busy !== null} onClick={newQuestion}>
              {busy === 'question' ? 'Thinking…' : question ? 'New question' : 'Give me a question'}
            </Button>
          </div>
          <StatusMessage status={status} />
        </CardContent>
      </Card>

      {latest && <Feedback attempt={latest} previous={attempts.length > 1 ? attempts[attempts.length - 2] : undefined} />}
      {latest && first && latest !== first && <Progress first={first} latest={latest} />}

      {recent.length > 0 && (
        <Card className="mt-4">
          <CardHeader><CardTitle>Recent answers</CardTitle></CardHeader>
          <CardContent className="divide-y text-sm">
            {recent.map(item => (
              <div key={item.id} className="grid gap-1.5 py-2.5 first:pt-0 last:pb-0">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{item.question}</span>
                  <span className="shrink-0 text-muted-foreground">#{item.attempt} · {averageScore(item).toFixed(1)}/5</span>
                </div>
                <audio controls preload="none" src={`/api/speaking/recordings/${item.sessionId}/${item.attempt}`} className="h-8 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}

const averageScore = (attempt: SpeakingAttempt) => Object.values(attempt.feedback.scores).reduce((sum, value) => sum + value, 0) / 4;

// ---------- recording ----------

function RecordPanel({ disabled, onRecorded }: { disabled: boolean; onRecorded: (blob: Blob) => void }) {
  const recorder = useRef<Recorder | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => recorder.current?.cancel(), []);
  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = (Date.now() - started) / 1000;
      setSeconds(elapsed); setLevel(recorder.current?.level() ?? 0);
      if (elapsed >= MAX_RECORDING_SECONDS) void stop();
    }, 100);
    return () => clearInterval(timer);
  }, [recording]);

  async function start() {
    setError('');
    try { recorder.current = await startRecording(); setSeconds(0); setRecording(true); }
    catch (cause) { setError(cause instanceof DOMException && cause.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in the browser’s site settings.' : errorMessage(cause)); }
  }

  async function stop() {
    const current = recorder.current;
    if (!current) return;
    recorder.current = null; setRecording(false);
    try {
      const recording = await current.stop();
      // Don't upload silence: the coach would have nothing real to work with.
      if (recording.peak < 0.02) setError('We could not hear anything. Check that the right microphone is selected and not muted, then record again.');
      else onRecorded(recording.blob);
    } catch (cause) { setError(errorMessage(cause)); }
  }

  function cancel() { recorder.current?.cancel(); recorder.current = null; setRecording(false); }

  if (!recording) {
    return (
      <div className="grid gap-1.5">
        <div><Button size="lg" disabled={disabled} onClick={start}><Mic />Record answer</Button></div>
        <p className="text-xs text-muted-foreground">Take 15 seconds to think, then speak for 60–90 seconds. It stops by itself at {formatTime(MAX_RECORDING_SECONDS)}.</p>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    );
  }
  return (
    <div className="grid gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
      <div className="flex items-center gap-3">
        <span className="size-2.5 animate-pulse rounded-full bg-red-600" />
        <span className="font-mono text-lg tabular-nums">{formatTime(seconds)} / {formatTime(MAX_RECORDING_SECONDS)}</span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-red-100"><div className="h-full bg-red-500 transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} /></div>
      </div>
      <div className="flex gap-2">
        <Button size="lg" onClick={stop}><Square />Stop & get feedback</Button>
        <Button size="lg" variant="ghost" onClick={cancel}>Discard</Button>
      </div>
    </div>
  );
}

// ---------- feedback ----------

function Transcript({ text }: { text: string }) {
  return <p className="leading-relaxed">{text.split(FILLER).map((part, index) => index % 2 ? <mark key={index} className="rounded bg-amber-100 px-0.5 text-amber-900">{part}</mark> : part)}</p>;
}

function Delta({ value, better = 'up', format = (n: number) => String(n) }: { value: number; better?: 'up' | 'down'; format?: (n: number) => string }) {
  if (!value) return null;
  const good = better === 'up' ? value > 0 : value < 0;
  return <span className={`ml-1 text-xs ${good ? 'text-emerald-700' : 'text-red-700'}`}>{value > 0 ? '+' : ''}{format(value)}</span>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="grid gap-1.5"><h3 className="text-sm font-semibold">{title}</h3>{children}</div>;
}

function SentencePlayer({ sentence }: { sentence: string }) {
  const { play, state } = useClip();
  return (
    <li className="flex items-start gap-2">
      <Button variant="ghost" size="icon-sm" aria-label="Play sentence" disabled={state === 'loading'} onClick={() => play(sentence)}><Volume2 /></Button>
      <span className="pt-0.5">{sentence}</span>
    </li>
  );
}

function Feedback({ attempt, previous }: { attempt: Attempt; previous?: Attempt }) {
  const { feedback, metrics } = attempt;
  const [showVietnamese, setShowVietnamese] = useState(false);
  const sentences = feedback.improvedAnswer.match(/[^.!?]+[.!?]+["”’']?/g)?.map(sentence => sentence.trim()).filter(Boolean) ?? [feedback.improvedAnswer];

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardDescription>Attempt {attempt.attempt} · {formatTime(attempt.durationSeconds)} · {metrics.wordsPerMinute} words/min · {metrics.fillers} fillers</CardDescription>
        <CardTitle>Feedback</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5 text-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {scoreLabels.map(([key, label]) => (
            <div key={key} className="rounded-lg bg-muted px-3 py-2">
              <div className="text-xl font-semibold">{feedback.scores[key]}<span className="text-sm font-normal text-muted-foreground">/5</span>
                {previous && <Delta value={feedback.scores[key] - previous.feedback.scores[key]} />}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-1.5">
          <p className="text-base">{feedback.summary}</p>
          {feedback.vietnamese && (showVietnamese
            ? <p className="rounded-md bg-muted px-3 py-2">{feedback.vietnamese}</p>
            : <div><Button variant="link" size="sm" className="px-0" onClick={() => setShowVietnamese(true)}>Giải thích bằng tiếng Việt</Button></div>)}
        </div>

        <Section title="What you said">
          <Transcript text={feedback.transcript} />
          <audio controls src={attempt.localUrl} className="h-8 w-full" />
        </Section>

        {feedback.phrases.length > 0 && (
          <Section title="Practice phrases">
            <ul className="grid gap-1">
              {feedback.phrases.map(item => (
                <li key={item.phrase} className="flex items-start gap-2">
                  {item.used && item.correct ? <Check className="mt-0.5 size-4 text-emerald-700" /> : <X className="mt-0.5 size-4 text-red-700" />}
                  <span><b>{item.phrase}</b> — {item.used ? (item.correct ? 'used well' : 'used, but not quite right') : 'not used'}{item.note ? `. ${item.note}` : ''}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {feedback.corrections.length > 0 && (
          <Section title="Top corrections">
            <ul className="grid gap-2">
              {feedback.corrections.map((item, index) => (
                <li key={index} className="rounded-md border px-3 py-2">
                  <div><span className="text-red-700 line-through">{item.original}</span> → <span className="font-medium text-emerald-800">{item.better}</span></div>
                  <div className="text-muted-foreground">{item.why}</div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {feedback.pronunciation.length > 0 && (
          <Section title="Pronunciation">
            <ul className="grid gap-1">
              {feedback.pronunciation.map((item, index) => <li key={index}><b>{item.word}</b>: {item.issue} <span className="text-muted-foreground">— {item.tip}</span></li>)}
            </ul>
          </Section>
        )}

        {feedback.improvedAnswer && (
          <Section title="Say it like this">
            <p className="text-muted-foreground">Play each sentence, pause, and repeat it out loud (shadowing). Then record your next attempt.</p>
            <ol className="grid gap-1">{sentences.map((sentence, index) => <SentencePlayer key={index} sentence={sentence} />)}</ol>
          </Section>
        )}
      </CardContent>
    </Card>
  );
}

function Progress({ first, latest }: { first: Attempt; latest: Attempt }) {
  const usedWell = (attempt: Attempt) => attempt.feedback.phrases.filter(item => item.used && item.correct).length;
  const rows: Array<[string, number, number, 'up' | 'down']> = [
    ['Average score', averageScore(first), averageScore(latest), 'up'],
    ['Words per minute', first.metrics.wordsPerMinute, latest.metrics.wordsPerMinute, 'up'],
    ['Fillers', first.metrics.fillers, latest.metrics.fillers, 'down'],
    ['Phrases used well', usedWell(first), usedWell(latest), 'up'],
  ];
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>Attempt 1 → attempt {latest.attempt}</CardTitle></CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {rows.map(([label, before, after, better]) => (
              <tr key={label}>
                <td className="py-1.5 text-muted-foreground">{label}</td>
                <td className="py-1.5 text-right tabular-nums">{Number.isInteger(before) ? before : before.toFixed(1)}</td>
                <td className="py-1.5 text-right tabular-nums">→ {Number.isInteger(after) ? after : after.toFixed(1)}<Delta value={Math.round((after - before) * 10) / 10} better={better} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
