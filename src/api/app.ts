import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { Bindings } from '../bindings';
import { MAX_CLIP_CHARS, OLLAMA_MODEL, PROMPT_VERSION } from '../constants';
import { addCandidates, setCandidateStatus } from '../lib/candidates-db';
import { reviewCardWithGemini } from '../lib/card-review';
import { deleteCard, getCard, getDailyStats, getDueCards, insertCard, reviewCard, type Card } from '../lib/cards-db';
import { getClip, normalizeClipText } from '../lib/clips';
import { analyzeLearningInput } from '../lib/learning-analysis';
import { formatInterval, nextSchedule, ratings } from '../lib/srs';
import { createStory, deleteStory, getStory, getStoryAudio, listStories } from '../lib/stories';
import { countWords } from '../lib/text';

export const api = new Hono<{ Bindings: Bindings }>();

class ApiError extends Error {
  constructor(readonly status: ContentfulStatusCode, readonly title: string, message: string) { super(message); }
}

api.onError((error, c) => {
  if (error instanceof z.ZodError) return c.json({ error: 'Validation error', message: error.errors.map(issue => issue.message).join(', ') }, 400);
  if (error instanceof ApiError) return c.json({ error: error.title, message: error.message }, error.status);
  console.error(`${c.req.method} ${c.req.path} failed`, error);
  return c.json({ error: 'Request failed', message: error instanceof Error ? error.message : 'Unknown error' }, 502);
});

const idParam = (value: string) => {
  const id = Number.parseInt(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError(400, 'Validation error', 'Invalid ID.');
  return id;
};

const examplesSchema = z.array(z.string().trim().min(1).max(400)).max(6).default([]);
const analyzeSchema = z.object({
  text: z.string().trim().min(1).max(3000), context: z.string().trim().max(1500).optional(),
  confusingPart: z.string().trim().max(500).optional(), intendedMeaning: z.string().trim().max(1000).optional(),
});
const reviewSchema = z.object({
  text: z.string().trim().min(1).max(3000), context: z.string().trim().max(1500).optional(),
  mainSentence: z.string().trim().min(1).max(1000), meaning: z.string().trim().max(2000).default(''),
  keyExpression: z.string().trim().max(300).default(''), explanation: z.string().trim().max(6000).default(''),
  examples: examplesSchema, score: z.number().min(0).max(10).default(5),
});
const cardSchema = z.object({
  phrase: z.string().trim().min(1).max(1000), explanation: z.string().trim().min(1).max(6000),
  keyExpression: z.string().trim().max(300).default(''), grammarPattern: z.string().trim().max(300).default(''),
  examples: examplesSchema, originalInput: z.string().trim().max(3000).optional(), context: z.string().trim().max(1500).optional(),
  candidateId: z.number().int().positive().optional(),
});
const answerSchema = z.object({
  cardId: z.number().int().positive(), rating: z.enum(['again', 'hard', 'good', 'easy']),
  durationMs: z.number().int().min(0).max(3_600_000), accuracy: z.number().min(0).max(1).optional(),
});
const candidateBatchSchema = z.object({
  source: z.string().trim().max(200).optional(),
  items: z.array(z.object({
    phrase: z.string().trim().min(2).max(120), example: z.string().trim().max(600).optional(),
    kind: z.enum(['frame', 'phrasal_verb', 'idiom', 'prep_phrase', 'collocation', 'word']),
    band: z.number().int().min(0).max(3), score: z.number().min(-5).max(20),
  })).min(1).max(100),
});
const storySchema = z.object({
  kind: z.enum(['story', 'conversation']), cardIds: z.array(z.number().int().positive()).max(15).default([]),
  topic: z.string().trim().max(300).optional(),
});

// What the Practice page types: the card's front and its example sentences, with the next interval per rating.
export function toPracticeCard(card: Card) {
  return {
    id: card.id, phrase: card.phrase, keyExpression: card.keyExpression, explanation: card.explanation,
    texts: [card.phrase, ...card.examples].filter(Boolean),
    intervals: Object.fromEntries(ratings.map(rating => [rating, formatInterval(nextSchedule(card, rating).intervalDays)])) as Record<(typeof ratings)[number], string>,
  };
}
export type PracticeCard = ReturnType<typeof toPracticeCard>;

const audioResponse = (audio: { body: ReadableStream | Uint8Array<ArrayBuffer>; contentType: string }) =>
  new Response(audio.body, { headers: { 'Content-Type': audio.contentType, 'Cache-Control': 'private, max-age=31536000, immutable' } });

api.get('/health', c => c.json({ service: 'English SRS', status: 'running', runtime: 'cloudflare-workers', timestamp: new Date().toISOString() }));
api.get('/api/stats', async c => c.json(await getDailyStats(c.env.DB)));

// Step 1 of learning: a free Ollama preview (meaning, examples, "worth learning?" score). Nothing is stored.
api.post('/api/analyze', async c => {
  const input = analyzeSchema.parse(await c.req.json());
  if (countWords(input.text) < 2) throw new ApiError(400, 'Validation error', 'Please enter at least 2 words.');
  return c.json({ analysis: await analyzeLearningInput(c.env, input) });
});

// Step 2: Gemini reviews Ollama's card, only for phrases the learner wants to keep. Nothing is stored.
api.post('/api/analyze/review', async c => c.json({ review: await reviewCardWithGemini(c.env, reviewSchema.parse(await c.req.json())) }));

// Step 3: the learner decided to learn it — store the card in the review schedule.
api.post('/api/cards', async c => {
  const input = cardSchema.parse(await c.req.json());
  const card = await insertCard(c.env.DB, {
    phrase: input.phrase, explanation: input.explanation, keyExpression: input.keyExpression, grammarPattern: input.grammarPattern,
    examples: input.examples, originalInput: input.originalInput || null, context: input.context || null,
    model: OLLAMA_MODEL, promptVersion: PROMPT_VERSION,
  });
  if (input.candidateId) await setCandidateStatus(c.env.DB, input.candidateId, 'learned');
  return c.json({ card, stats: await getDailyStats(c.env.DB) }, 201);
});

api.delete('/api/cards/:id', async c => {
  const id = idParam(c.req.param('id'));
  if (!await deleteCard(c.env.DB, id)) throw new ApiError(404, 'Not found', 'Card was not found.');
  return c.json({ deleted: true, id });
});

api.get('/api/practice/due', async c => {
  const due = await getDueCards(c.env.DB, 30);
  return c.json({ cards: due.map(toPracticeCard) });
});

// After typing, the learner rates their confidence; that rating drives the schedule.
api.post('/api/practice/answer', async c => {
  const input = answerSchema.parse(await c.req.json());
  const card = await getCard(c.env.DB, input.cardId);
  if (!card) throw new ApiError(404, 'Not found', 'Card was not found.');
  const updated = await reviewCard(c.env.DB, card, input.rating, { durationMs: input.durationMs, mode: 'typing', accuracy: input.accuracy });
  return c.json({ card: updated, stats: await getDailyStats(c.env.DB) });
});

// Phrases found in the browser by the phrase finder (src/lib/phrase-finder.ts); the book itself is never sent.
api.post('/api/candidates/batch', async c => {
  const input = candidateBatchSchema.parse(await c.req.json());
  const added = await addCandidates(c.env.DB, input.items.map(item => ({ ...item, source: input.source })));
  return c.json({ added, skipped: input.items.length - added }, 201);
});

api.post('/api/candidates/:id/skip', async c => {
  if (!await setCandidateStatus(c.env.DB, idParam(c.req.param('id')), 'dismissed')) throw new ApiError(404, 'Not found', 'Phrase was not found.');
  return c.json({ ok: true });
});

// GET so <audio src> can point straight at it; clips are immutable, so the browser may cache them.
api.get('/api/audio', async c => {
  const text = normalizeClipText(c.req.query('text') ?? '');
  if (!text || text.length > MAX_CLIP_CHARS) throw new ApiError(400, 'Validation error', `Text must be 1–${MAX_CLIP_CHARS} characters.`);
  return audioResponse(await getClip(c.env, text));
});

api.get('/api/stories', async c => c.json({ stories: (await listStories(c.env.DB)).map(({ id, title, kind }) => ({ id, title, kind })) }));
api.post('/api/stories', async c => c.json({ story: await createStory(c.env, storySchema.parse(await c.req.json())) }, 201));

api.get('/api/stories/:id/audio', async c => {
  const story = await getStory(c.env.DB, idParam(c.req.param('id')));
  if (!story) throw new ApiError(404, 'Not found', 'Story was not found.');
  return audioResponse(await getStoryAudio(c.env, story));
});

api.delete('/api/stories/:id', async c => {
  if (!await deleteStory(c.env, idParam(c.req.param('id')))) throw new ApiError(404, 'Not found', 'Story was not found.');
  return c.json({ deleted: true });
});
