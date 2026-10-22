import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { More } from '@/components/more';
import { StatusMessage, type Status } from '@/components/status-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage, postJson } from '@/lib/api-client';
import type { Candidate } from '@/lib/candidates-db';

const plain = (markdown: string) => markdown.replace(/\*\*([^*]+)\*\*/g, '$1');

/**
 * A card written by Claude or ChatGPT (connector): check it, edit it if you like, then "Learn it" stores it in the
 * review schedule; "Skip" drops it for good.
 */
export function LearnDialog({ candidate, open, onOpenChange }: { candidate: Candidate | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {open && candidate && <LearnFlow key={candidate.id} candidate={candidate} close={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function LearnFlow({ candidate, close }: { candidate: Candidate; close: () => void }) {
  const router = useRouter();
  const { draft } = candidate;
  const [front, setFront] = useState(draft.front);
  const [examples, setExamples] = useState(draft.examples.join('\n'));
  const [busy, setBusy] = useState<'save' | 'skip' | null>(null);
  const [status, setStatus] = useState<Status>(null);

  async function skip() {
    setBusy('skip');
    try { await postJson(`/api/candidates/${candidate.id}/skip`); close(); await router.invalidate(); }
    catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); setBusy(null); }
  }

  async function learn() {
    setStatus(null); setBusy('save');
    try {
      await postJson('/api/cards', {
        phrase: front.trim(), explanation: draft.explanation, keyExpression: draft.keyExpression,
        examples: examples.split('\n').map(line => line.trim()).filter(Boolean),
        originalInput: candidate.example ?? undefined, context: candidate.source ? `From "${candidate.source}"` : undefined, candidateId: candidate.id,
      });
      close();
      await router.invalidate();
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); setBusy(null); }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{candidate.phrase}</DialogTitle>
        <DialogDescription>{draft.meaning}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2 font-medium">Worth learning? <Badge variant="secondary">{draft.score}/10</Badge></div>
          <p className="text-sm text-muted-foreground">{draft.reason}</p>
          {candidate.example && <p className="text-sm text-muted-foreground">From {candidate.source ? `“${candidate.source}”` : 'the book'}: {candidate.example}</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="phrase">Card</Label>
          <Textarea id="phrase" value={front} onChange={event => setFront(event.target.value)} className="min-h-10" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="examples">Sentences to type <span className="font-normal text-muted-foreground">(one per line)</span></Label>
          <Textarea id="examples" value={examples} onChange={event => setExamples(event.target.value)} className="min-h-24" />
        </div>
        <More label="Meaning and notes"><p className="leading-relaxed whitespace-pre-wrap">{plain(draft.explanation)}</p></More>
        <DialogFooter>
          <Button variant="secondary" disabled={busy !== null} onClick={skip}>Skip</Button>
          <Button className="bg-emerald-700 hover:bg-emerald-700/85" disabled={busy !== null || !front.trim()} onClick={learn}>{busy === 'save' ? 'Saving…' : 'Learn it'}</Button>
        </DialogFooter>
      </div>
      <StatusMessage status={status} />
    </>
  );
}
