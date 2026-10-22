import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { Bindings } from '../bindings';
import { MAX_CLIP_CHARS } from '../constants';
import { addParts, createBook, deleteBook } from '../lib/books-db';
import { setCandidateStatus } from '../lib/candidates-db';
import { deleteCard, getCard, getDueCards, insertCard, reviewCard, type Card } from '../lib/cards-db';
import { getClip, normalizeClipText } from '../lib/clips';
import { formatInterval, nextSchedule, ratings } from '../lib/srs';
import { createConnectorToken, getKeyStatuses, isConnectorToken, providers, removeConnectorToken, setApiKey } from '../lib/settings';
import { deleteStory, getStory, getStoryAudio, listStories } from '../lib/stories';
import { handleMcp } from './mcp';

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
const bookSchema = z.object({ title: z.string().trim().min(1).max(300), author: z.string().trim().max(300).optional(), format: z.enum(['pdf', 'epub']) });
const partsSchema = z.object({
  parts: z.array(z.object({ position: z.number().int().min(0), chapterTitle: z.string().trim().min(1).max(300), text: z.string().trim().min(1).max(20_000), words: z.number().int().min(1) })).min(1).max(20),
});
const keySchema = z.object({ key: z.string().trim().min(8).max(500) });

// What the Practice page types: the card's front and its example sentences, with the next interval per rating.
export function toPracticeCard(card: Card) {
  return {
    id: card.id, phrase: card.phrase, keyExpression: card.keyExpression, explanation: card.explanation,
    texts: [card.phrase, ...card.examples].filter(Boolean),
    intervals: Object.fromEntries(ratings.map(rating => [rating, formatInterval(nextSchedule(card, rating).intervalDays)])) as Record<(typeof ratings)[number], string>,
  };
}
export type PracticeCard = ReturnType<typeof toPracticeCard>;

// Answers Range requests (206), which Safari needs to play audio. Clips and stories are small, so the whole file is read.
async function audioResponse(audio: { body: ReadableStream | Uint8Array<ArrayBuffer>; contentType: string }, range: string | undefined): Promise<Response> {
  const bytes = new Uint8Array(await new Response(audio.body).arrayBuffer());
  const headers = { 'Content-Type': audio.contentType, 'Cache-Control': 'private, max-age=31536000, immutable', 'Accept-Ranges': 'bytes' };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range ?? '');
  if (!match || (!match[1] && !match[2])) return new Response(bytes, { headers: { ...headers, 'Content-Length': String(bytes.length) } });
  const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
  if (start >= bytes.length || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.length}` } });
  return new Response(bytes.slice(start, end + 1), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': String(end - start + 1) } });
}

// Requests that change data must come from the app itself (or carry no Origin, like curl); a page on another
// site cannot make the learner's browser change anything.
api.use('/api/*', async (c, next) => {
  const origin = c.req.header('Origin');
  if (c.req.method !== 'GET' && origin && origin !== new URL(c.req.url).origin) return c.json({ error: 'Forbidden', message: 'Cross-site request.' }, 403);
  await next();
});

api.get('/health', c => c.json({ service: 'English SRS', status: 'running', runtime: 'cloudflare-workers', timestamp: new Date().toISOString() }));

// The learner chose "Learn it" for a card written through the connector — store it in the review schedule.
api.post('/api/cards', async c => {
  const input = cardSchema.parse(await c.req.json());
  const card = await insertCard(c.env.DB, {
    phrase: input.phrase, explanation: input.explanation, keyExpression: input.keyExpression, grammarPattern: input.grammarPattern,
    examples: input.examples, originalInput: input.originalInput || null, context: input.context || null,
    model: 'connector', promptVersion: 'connector-v2',
  });
  if (input.candidateId) await setCandidateStatus(c.env.DB, input.candidateId, 'learned');
  return c.json({ card }, 201);
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
  return c.json({ card: updated });
});

// A book is stored as short text parts so Claude or ChatGPT can read just enough of it at a time (connector).
api.post('/api/books', async c => {
  const input = bookSchema.parse(await c.req.json());
  return c.json({ bookId: await createBook(c.env.DB, { title: input.title, author: input.author || null, format: input.format }) }, 201);
});

api.post('/api/books/:id/parts', async c => {
  await addParts(c.env.DB, idParam(c.req.param('id')), partsSchema.parse(await c.req.json()).parts);
  return c.json({ ok: true });
});

api.delete('/api/books/:id', async c => {
  if (!await deleteBook(c.env.DB, idParam(c.req.param('id')))) throw new ApiError(404, 'Not found', 'Book was not found.');
  return c.json({ deleted: true });
});

api.post('/api/candidates/:id/skip', async c => {
  if (!await setCandidateStatus(c.env.DB, idParam(c.req.param('id')), 'dismissed')) throw new ApiError(404, 'Not found', 'Phrase was not found.');
  return c.json({ ok: true });
});

// GET so <audio src> can point straight at it; clips are immutable, so the browser may cache them.
api.get('/api/audio', async c => {
  const text = normalizeClipText(c.req.query('text') ?? '');
  if (!text || text.length > MAX_CLIP_CHARS) throw new ApiError(400, 'Validation error', `Text must be 1–${MAX_CLIP_CHARS} characters.`);
  return audioResponse(await getClip(c.env, text), c.req.header('Range'));
});

api.get('/api/stories', async c => c.json({ stories: (await listStories(c.env.DB)).map(({ id, title, kind }) => ({ id, title, kind })) }));

api.get('/api/stories/:id/audio', async c => {
  const story = await getStory(c.env.DB, idParam(c.req.param('id')));
  if (!story) throw new ApiError(404, 'Not found', 'Story was not found.');
  return audioResponse(await getStoryAudio(c.env, story), c.req.header('Range'));
});

api.delete('/api/stories/:id', async c => {
  if (!await deleteStory(c.env, idParam(c.req.param('id')))) throw new ApiError(404, 'Not found', 'Story was not found.');
  return c.json({ deleted: true });
});

// Settings: API keys are write-only (only the last 4 characters come back).
const providerParam = (value: string) => {
  const provider = providers.find(item => item === value);
  if (!provider) throw new ApiError(404, 'Not found', 'Unknown provider.');
  return provider;
};

api.put('/api/settings/keys/:provider', async c => {
  await setApiKey(c.env.DB, providerParam(c.req.param('provider')), keySchema.parse(await c.req.json()).key);
  return c.json({ keys: await getKeyStatuses(c.env) });
});

api.delete('/api/settings/keys/:provider', async c => {
  await setApiKey(c.env.DB, providerParam(c.req.param('provider')), null);
  return c.json({ keys: await getKeyStatuses(c.env) });
});

// A new connector link replaces the old one; the full link is only returned here, once.
api.post('/api/settings/connector', async c => c.json({ url: `${new URL(c.req.url).origin}/mcp/${await createConnectorToken(c.env.DB)}` }, 201));
api.delete('/api/settings/connector', async c => { await removeConnectorToken(c.env.DB); return c.json({ deleted: true }); });

// MCP connector for Claude and ChatGPT. The token is in the link (ChatGPT cannot send custom headers) or a Bearer header.
api.all('/mcp/:token?', async c => {
  const token = c.req.param('token') ?? c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!await isConnectorToken(c.env.DB, token)) return c.json({ error: 'Unauthorized', message: 'Unknown connector link. Create a new one in Settings.' }, 401);
  return handleMcp(c.env, c.req.raw);
});
