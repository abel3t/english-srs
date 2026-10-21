import { z } from 'zod';
import type { Bindings } from '../bindings';
import { AI_EXTRA_PER_PART, AI_PICKS_PER_PART, getPartPickPrompt } from '../constants';
import { isBasicPhrase } from './basic-phrases';
import { markPartDone, markPartFailed, nextPendingParts, type BookPart } from './books-db';
import { addCandidates, pendingCandidatesForPart, setAiPicks } from './candidates-db';
import { generateWithOllama } from './ollama';
import { normalizeText } from './text';

const resultSchema = z.object({
  // Models sometimes send numbers as strings ("3"); accept both.
  picks: z.array(z.object({ n: z.coerce.number().int().positive(), why: z.coerce.string().default('') })).default([]),
  extra: z.array(z.object({ phrase: z.string().trim().min(2).max(120), sentence: z.string().trim().max(600), why: z.string().default('') })).default([]),
});

const quotaError = (message: string) => /rate|limit|quota|429|too many|usage/i.test(message);

async function reviewPart(env: Bindings, part: BookPart): Promise<{ picked: number; added: number }> {
  const candidates = (await pendingCandidatesForPart(env.DB, part.id)).filter(candidate => !isBasicPhrase(candidate.phrase));
  const raw = await generateWithOllama(env, getPartPickPrompt(part.text, candidates.map(candidate => candidate.phrase)));
  const result = resultSchema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));

  const seen = new Set<number>();
  const picks = result.picks
    .filter(pick => pick.n <= candidates.length && !seen.has(pick.n) && seen.add(pick.n))
    .slice(0, AI_PICKS_PER_PART)
    .map((pick, index) => ({ id: candidates[pick.n - 1].id, rank: index + 1, reason: pick.why.trim() || null }));
  await setAiPicks(env.DB, picks);

  // Extra phrases only count when the sentence really is in the part and contains the phrase's words.
  const partText = normalizeText(part.text);
  const extras = result.extra.slice(0, AI_EXTRA_PER_PART).filter(item => !isBasicPhrase(item.phrase)).filter(item => {
    const sentence = normalizeText(item.sentence);
    return sentence.length > 10 && partText.includes(sentence) && normalizeText(item.phrase).split(' ').every(word => sentence.includes(word.slice(0, 4)));
  });
  const added = await addCandidates(env.DB, extras.map((item, index) => ({
    phrase: item.phrase, example: item.sentence, source: part.bookTitle, kind: 'ai' as const, score: 5,
    partId: part.id, aiRank: picks.length + index + 1, aiReason: item.why.trim() || null,
  })));
  return { picked: picks.length, added };
}

// Called by the cron trigger. Reviews up to EXTRACT_PARTS_PER_RUN parts and returns at once when nothing is left,
// so a frequent schedule costs nothing once every book is done. Quota errors stop the run without penalizing the part.
export async function runBookExtraction(env: Bindings): Promise<{ reviewed: number; stoppedForQuota: boolean }> {
  const perRun = Math.max(1, Math.min(20, Number.parseInt(env.EXTRACT_PARTS_PER_RUN ?? '2') || 2));
  const parts = await nextPendingParts(env.DB, perRun);
  let reviewed = 0;
  for (const part of parts) {
    try {
      const { picked, added } = await reviewPart(env, part);
      await markPartDone(env.DB, part.id);
      reviewed++;
      console.log(`AI reviewed "${part.bookTitle}" part ${part.position + 1}: ${picked} picked, ${added} added`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (quotaError(message)) { console.warn('Ollama quota reached; trying again next run.', message); return { reviewed, stoppedForQuota: true }; }
      console.error(`AI review failed for part ${part.id}`, message);
      await markPartFailed(env.DB, part.id, message);
    }
  }
  return { reviewed, stoppedForQuota: false };
}
