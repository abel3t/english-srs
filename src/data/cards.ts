import { notFound, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { getStudyStats } from '@/lib/activity-db';
import { ensureSuperadmin, getViewer } from '@/lib/auth';
import { listDocuments } from '@/lib/documents-db';
import { countPending, getReadyCandidates } from '@/lib/candidates-db';
import { getOverview, getUnmemorizedCards, listCards } from '@/lib/cards-db';
import { connectorCreatedAt, getApiKey, getKeyStatuses } from '@/lib/settings';
import { getStory, listStories } from '@/lib/stories';

// ---------- who is signed in ----------

// For the pages: the signed-in user, or null (the root route then sends them to the sign-in page).
export const getViewerFn = createServerFn().handler(async () => getViewer(env, getRequest()));

// The sign-in page also creates the superadmin from the secrets the first time (no admin yet).
export const prepareSignIn = createServerFn().handler(async () => {
  const request = getRequest();
  await ensureSuperadmin(env, new URL(request.url).origin);
  return getViewer(env, request);
});

// Every page's data belongs to the signed-in user.
async function userId(): Promise<string> {
  const viewer = await getViewer(env, getRequest());
  if (!viewer) throw redirect({ to: '/login' });
  return viewer.id;
}

// Library: the cards tab (search and state filter) or the imported tab (paged).
export const librarySearchSchema = z.object({
  tab: z.enum(['cards', 'imported']).catch('cards').default('cards'),
  q: z.string().trim().max(200).optional().catch(undefined),
  state: z.enum(['new', 'learning', 'review']).optional().catch(undefined),
  page: z.number().int().min(1).catch(1).default(1),
});
export type LibrarySearch = z.infer<typeof librarySearchSchema>;
export const DOCUMENTS_PER_PAGE = 10;

const LISTEN_CARDS = 30;

export const getToday = createServerFn().handler(async () => {
  const user = await userId();
  const [overview, pending, candidates, study, learning] = await Promise.all([
    getOverview(env.DB, user),
    countPending(env.DB, user),
    getReadyCandidates(env.DB, user, 3),
    getStudyStats(env.DB, user),
    // What "Listen to your cards" plays: cards still being learned, soonest due first.
    getUnmemorizedCards(env.DB, user, LISTEN_CARDS),
  ]);
  return {
    overview, pending, peek: candidates.map(candidate => candidate.phrase), study,
    listen: learning.map(card => ({ phrase: card.phrase, name: card.keyExpression || card.phrase, examples: card.examples })),
  };
});

// The queue is reviewed one card at a time: the oldest one, plus a glance at what comes after it.
export const getQueue = createServerFn().handler(async () => {
  const user = await userId();
  const [candidates, pending] = await Promise.all([getReadyCandidates(env.DB, user, 6), countPending(env.DB, user)]);
  const [current, ...upNext] = candidates;
  return { current: current ?? null, upNext, pending };
});

export const getLibrary = createServerFn()
  .validator(librarySearchSchema)
  .handler(async ({ data }) => {
    const user = await userId();
    const [overview, imported, pending, cards] = await Promise.all([
      getOverview(env.DB, user),
      listDocuments(env.DB, user, data.tab === 'imported' ? { limit: DOCUMENTS_PER_PAGE, offset: (data.page - 1) * DOCUMENTS_PER_PAGE } : { limit: 0, offset: 0 }),
      countPending(env.DB, user),
      data.tab === 'cards' ? listCards(env.DB, user, { query: data.q, state: data.state, limit: 200 }) : [],
    ]);
    return {
      totalCards: overview.total, pending, cards,
      documents: imported.documents, totalDocuments: imported.total,
    };
  });

export const getStoriesPage = createServerFn().handler(async () => {
  const user = await userId();
  const [stories, cards, key] = await Promise.all([listStories(env.DB, user), getUnmemorizedCards(env.DB, user, 1), getApiKey(env.DB, user, 'elevenlabs')]);
  return { stories, learning: cards.length > 0, hasElevenLabsKey: !!key };
});

export const getStoryById = createServerFn()
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const user = await userId();
    const story = await getStory(env.DB, user, data.id);
    if (!story) throw notFound();
    return { ...story, canPlayAudio: story.hasAudio || !!await getApiKey(env.DB, user, 'elevenlabs') };
  });

export const getSettingsPage = createServerFn().handler(async () => {
  const user = await userId();
  const [keys, createdAt] = await Promise.all([getKeyStatuses(env.DB, user), connectorCreatedAt(env.DB, user)]);
  return { keys, connectorCreatedAt: createdAt };
});
