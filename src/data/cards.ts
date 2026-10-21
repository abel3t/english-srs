import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { countPending, getCandidate, getSuggestions } from '@/lib/candidates-db';
import { getOverview, getUnmemorizedCards, listCards } from '@/lib/cards-db';
import { getStory, listStories } from '@/lib/stories';

export const cardsSearchSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  state: z.enum(['new', 'learning', 'review']).optional().catch(undefined),
});
export type CardsSearch = z.infer<typeof cardsSearchSchema>;

export const getToday = createServerFn().handler(async () => ({
  overview: await getOverview(env.DB),
  suggestions: await getSuggestions(env.DB, 10),
}));

export const getLibrary = createServerFn()
  .validator(cardsSearchSchema)
  .handler(async ({ data }) => ({
    cards: await listCards(env.DB, { query: data.q, state: data.state, limit: 200 }),
    pending: await countPending(env.DB),
  }));

export const getCandidateById = createServerFn()
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(({ data }) => getCandidate(env.DB, data.id));

export const getStoriesPage = createServerFn().handler(async () => ({
  stories: await listStories(env.DB),
  learning: await getUnmemorizedCards(env.DB, 60),
}));

export const getStoryById = createServerFn()
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const story = await getStory(env.DB, data.id);
    if (!story) throw notFound();
    return story;
  });
