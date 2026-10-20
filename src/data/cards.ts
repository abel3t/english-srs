import { createServerFn } from '@tanstack/react-start';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { countCandidates, getCandidate, getKnowledgeModel, getOfferedCandidate, getSortQueue, listQueuedToLearn } from '@/lib/candidates-db';
import { getOverview, listCards } from '@/lib/cards-db';
import { listRecentAttempts } from '@/lib/speaking';

export const cardsSearchSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  state: z.enum(['new', 'learning', 'review']).optional().catch(undefined),
});
export type CardsSearch = z.infer<typeof cardsSearchSchema>;

export const getDashboard = createServerFn().handler(async () => ({
  overview: await getOverview(env.DB),
  candidate: await getOfferedCandidate(env.DB),
  recent: await listCards(env.DB, { limit: 6 }),
}));

export const getCards = createServerFn()
  .validator(cardsSearchSchema)
  .handler(({ data }) => listCards(env.DB, { query: data.q, state: data.state, limit: 200 }));

export const getCandidateById = createServerFn()
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(({ data }) => getCandidate(env.DB, data.id));

export const getCandidateCounts = createServerFn().handler(() => countCandidates(env.DB));

export const getPhrasesPage = createServerFn().handler(async () => {
  const [queue, model, queued, counts] = await Promise.all([getSortQueue(env.DB), getKnowledgeModel(env.DB), listQueuedToLearn(env.DB), countCandidates(env.DB)]);
  return { queue, bands: model.bands, queued, counts };
});

export const getRecentSpeaking = createServerFn().handler(() => listRecentAttempts(env.DB, 10));
