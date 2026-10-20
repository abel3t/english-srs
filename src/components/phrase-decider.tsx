import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { StatusMessage, type Status } from '@/components/status-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage, postJson } from '@/lib/api-client';
import type { Candidate, CandidateKind, Decision } from '@/lib/candidates-db';
import { findPhraseSpan } from '@/lib/practice';

export const kindLabels: Record<CandidateKind, string> = {
  frame: 'work phrase', phrasal_verb: 'phrasal verb', idiom: 'idiom', prep_phrase: 'fixed phrase',
  collocation: 'word partnership', word: 'word', ai: 'AI pick', capture: 'saved by you',
};

const choices: Array<{ decision: Decision; label: string; hint: string; key: string }> = [
  { decision: 'use', label: 'I use it', hint: 'I can say this myself', key: '1' },
  { decision: 'recognize', label: 'I recognize it', hint: 'I understand it but never say it', key: '2' },
  { decision: 'new', label: 'New to me', hint: 'I don’t understand it yet', key: '3' },
  { decision: 'not_useful', label: 'Not useful', hint: 'Too rare, too technical, or not my style', key: '4' },
];

function Example({ example, phrase }: { example: string; phrase: string }) {
  const span = findPhraseSpan(example, phrase);
  if (!span) return <blockquote className="border-l-2 pl-3 text-muted-foreground italic">{example}</blockquote>;
  return (
    <blockquote className="border-l-2 pl-3 text-muted-foreground italic">
      {example.slice(0, span.start)}<mark className="rounded bg-amber-100 px-0.5 text-foreground not-italic">{example.slice(span.start, span.end)}</mark>{example.slice(span.end)}
    </blockquote>
  );
}

// Sorting one suggested phrase. Saying "I use it" is sometimes checked with a quick fill-in-the-gap,
// so the knowledge estimate is not built on overconfident clicks.
export function PhraseDecider({ candidate, onDone }: { candidate: Candidate; onDone: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [check, setCheck] = useState<{ prompt: string; answer: string; typed: string; wrong: boolean } | null>(null);

  async function decide(decision: Decision) {
    setBusy(true); setStatus(null);
    try {
      await postJson(`/api/candidates/${candidate.id}/decide`, { decision });
      if (decision === 'new') { await navigate({ to: '/learn', search: { candidate: candidate.id } }); return; }
      onDone();
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(false); }
  }

  async function later() {
    setBusy(true); setStatus(null);
    try { await postJson(`/api/candidates/${candidate.id}/snooze`); onDone(); }
    catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(false); }
  }

  function choose(decision: Decision) {
    const span = candidate.example ? findPhraseSpan(candidate.example, candidate.phrase) : null;
    if (decision === 'use' && span && candidate.example && Math.random() < 0.25) {
      setCheck({ prompt: candidate.example.slice(0, span.start) + '____' + candidate.example.slice(span.end), answer: candidate.example.slice(span.start, span.end), typed: '', wrong: false });
      return;
    }
    void decide(decision);
  }

  function submitCheck(event: FormEvent) {
    event.preventDefault();
    if (!check) return;
    const clean = (value: string) => value.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
    if ([check.answer, candidate.phrase].map(clean).includes(clean(check.typed))) void decide('use');
    else setCheck({ ...check, wrong: true });
  }

  useEffect(() => {
    if (check) return;
    const onKey = (event: KeyboardEvent) => {
      if (busy || event.metaKey || event.ctrlKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const choice = choices.find(item => item.key === event.key);
      if (choice) choose(choice.decision);
      else if (event.key.toLowerCase() === 'l') void later();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="secondary">{kindLabels[candidate.kind]}</Badge>
        {candidate.source && <span>from {candidate.source}</span>}
      </div>
      <p className="text-2xl font-semibold">{candidate.phrase}</p>
      {candidate.meaning && <p className="text-sm">{candidate.meaning}</p>}
      {candidate.example && <Example example={candidate.example} phrase={candidate.phrase} />}

      {check ? (
        <form onSubmit={submitCheck} className="grid gap-2 rounded-lg bg-muted p-3 text-sm">
          <p className="font-medium">Quick check: fill the gap.</p>
          <p className="italic">{check.prompt}</p>
          {!check.wrong ? (
            <div className="flex gap-2">
              <Input autoFocus value={check.typed} onChange={event => setCheck({ ...check, typed: event.target.value })} className="h-9 bg-background" placeholder="Type the missing words" />
              <Button type="submit" disabled={busy || !check.typed.trim()}>Check</Button>
            </div>
          ) : (
            <>
              <p>The words were <b>“{check.answer}”</b>.</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={busy} onClick={() => decide('recognize')}>I’m still learning it</Button>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => decide('use')}>Just a typo, I use it</Button>
              </div>
            </>
          )}
        </form>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {choices.map(choice => (
            <Button key={choice.decision} variant={choice.decision === 'recognize' ? 'default' : 'secondary'} disabled={busy} title={choice.hint}
              className="h-auto flex-col items-start gap-0 px-3 py-2 text-left whitespace-normal" onClick={() => choose(choice.decision)}>
              <span>{choice.label} <span className="text-xs opacity-60">{choice.key}</span></span>
              <span className="text-xs font-normal opacity-75">{choice.hint}</span>
            </Button>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <Button variant="link" size="sm" className="px-0 text-muted-foreground" disabled={busy} onClick={later}>Ask me later (L)</Button>
      </div>
      <StatusMessage status={status} />
    </div>
  );
}
