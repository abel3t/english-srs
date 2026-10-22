import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { Bindings } from '../bindings';
import { MAX_CLIP_CHARS } from '../constants';
import { recordActivities } from '../lib/activity-db';
import { getAuth, getViewer } from '../lib/auth';
import { DOCUMENT_FORMATS, addParts, createDocument, deleteDocument, previewDocument } from '../lib/documents-db';
import { decideCandidate, getCandidate, reopenCandidate } from '../lib/candidates-db';
import { cardTexts, deleteCard, drillCard, getCard, getDueCards, insertCard, reviewCard, type Card } from '../lib/cards-db';
import { getClip, normalizeClipText, prepareClips } from '../lib/clips';
import { DRILL_TIMES, formatInterval, nextSchedule, ratings } from '../lib/srs';
import { connectorUser, createConnectorToken, getKeyStatuses, providers, removeConnectorToken, setApiKey } from '../lib/settings';
import { deleteStory, getStory, getStoryAudio, listStories } from '../lib/stories';
import { handleMcp } from './mcp';
import { MissingElevenLabsKeyError } from '../lib/speech';

// Every /api route but /api/auth/* works for the signed-in user (userId); the connector for its link's user.
export const api = new Hono<{ Bindings: Bindings; Variables: { userId: string } }>();

class ApiError extends Error {
  constructor(readonly status: ContentfulStatusCode, readonly title: string, message: string) { super(message); }
}

api.onError((error, c) => {
  if (error instanceof MissingElevenLabsKeyError) return c.json({ error: 'ElevenLabs key required', message: error.message }, 403);
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
  keyExpression: z.string().trim().max(300).default(''),
  examples: examplesSchema, originalInput: z.string().trim().max(3000).optional(), context: z.string().trim().max(1500).optional(),
  candidateId: z.number().int().positive().optional(),
});
const answerSchema = z.object({
  cardId: z.number().int().positive(), rating: z.enum(['again', 'hard', 'good', 'easy']),
  durationMs: z.number().int().min(0).max(3_600_000), accuracy: z.number().min(0).max(1).optional(),
});
const documentSchema = z.object({ title: z.string().trim().min(1).max(300), author: z.string().trim().max(300).optional(), format: z.enum(DOCUMENT_FORMATS) });
const partsSchema = z.object({
  parts: z.array(z.object({ position: z.number().int().min(0), chapterTitle: z.string().trim().min(1).max(300), text: z.string().trim().min(1).max(20_000), words: z.number().int().min(1) })).min(1).max(20),
});
const keySchema = z.object({ key: z.string().trim().min(8).max(500) });

// What the Practice page types: the card's front and its example sentences, with the next interval per rating.
// A new card comes with its first-drill progress (typings of each text so far).
function toPracticeCard(card: Card) {
  const texts = cardTexts(card);
  return {
    id: card.id, phrase: card.phrase, keyExpression: card.keyExpression, explanation: card.explanation,
    isNew: card.state === 'new', drill: texts.map((_, index) => card.drill[index] ?? 0), drillTimes: DRILL_TIMES,
    texts,
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

// Better Auth: sign in and out, sessions, and the Admin page's account management.
api.on(['GET', 'POST'], '/api/auth/*', c => getAuth(c.env, new URL(c.req.url).origin).handler(c.req.raw));

api.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) return next();
  const viewer = await getViewer(c.env, c.req.raw);
  if (!viewer) return c.json({ error: 'Unauthorized', message: 'Please sign in again.' }, 401);
  c.set('userId', viewer.id);
  await next();
});

api.get('/health', c => c.json({ service: 'PhraseLoop', status: 'running', runtime: 'cloudflare-workers', timestamp: new Date().toISOString() }));

// The learner chose "Learn it" for a card written through the connector — store it in the review schedule.
api.post('/api/cards', async c => {
  const input = cardSchema.parse(await c.req.json());
  const userId = c.get('userId');
  if (input.candidateId) await decide(c.env.DB, userId, input.candidateId, 'learned');
  try {
    const card = await insertCard(c.env.DB, userId, {
      phrase: input.phrase, explanation: input.explanation, keyExpression: input.keyExpression,
      examples: input.examples, originalInput: input.originalInput || null, context: input.context || null,
    });
    // The card's sentences will be listened to: make their audio now, after answering, so the first play is instant.
    c.executionCtx.waitUntil(prepareClips(c.env, [card.phrase, ...card.examples]));
    return c.json({ card }, 201);
  } catch (error) {
    if (input.candidateId) await reopenCandidate(c.env.DB, userId, input.candidateId);
    throw error;
  }
});

api.delete('/api/cards/:id', async c => {
  const id = idParam(c.req.param('id'));
  if (!await deleteCard(c.env.DB, c.get('userId'), id)) throw new ApiError(404, 'Not found', 'Card was not found.');
  return c.json({ deleted: true, id });
});

api.get('/api/practice/due', async c => {
  const due = await getDueCards(c.env.DB, c.get('userId'), 30);
  return c.json({ cards: due.map(toPracticeCard) });
});

// One typing in a new card's first drill; the last one makes it learned (first review an hour later).
const drillSchema = z.object({ cardId: z.number().int().positive(), textIndex: z.number().int().min(0), accuracy: z.number().min(0).max(1).optional() });

api.post('/api/practice/drill', async c => {
  const input = drillSchema.parse(await c.req.json());
  const card = await getCard(c.env.DB, c.get('userId'), input.cardId);
  if (!card) throw new ApiError(404, 'Not found', 'Card was not found.');
  const { card: updated, learned } = await drillCard(c.env.DB, card, input.textIndex, input.accuracy);
  return c.json({ card: toPracticeCard(updated), learned, dueAt: updated.dueAt });
});

// Study activity from the browser, sent in small batches: sentences typed to the end and audio heard.
const activitySchema = z.object({
  items: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('typing'), characters: z.number().int().min(1).max(2000), accuracy: z.number().min(0).max(1).optional() }),
    z.object({ kind: z.literal('listening'), seconds: z.number().min(0.5).max(1800) }),
  ])).min(1).max(100),
});

api.post('/api/activity', async c => {
  await recordActivities(c.env.DB, c.get('userId'), activitySchema.parse(await c.req.json()).items);
  return c.json({ ok: true });
});

// After typing, the learner rates their confidence; that rating drives the schedule.
api.post('/api/practice/answer', async c => {
  const input = answerSchema.parse(await c.req.json());
  const card = await getCard(c.env.DB, c.get('userId'), input.cardId);
  if (!card) throw new ApiError(404, 'Not found', 'Card was not found.');
  const updated = await reviewCard(c.env.DB, card, input.rating, { durationMs: input.durationMs, accuracy: input.accuracy });
  return c.json({ card: toPracticeCard(updated), dueAt: updated.dueAt });
});

// A document (book, file or pasted text) is stored as short text parts so Claude or ChatGPT can read just enough of
// it at a time (connector).
api.post('/api/documents', async c => {
  const input = documentSchema.parse(await c.req.json());
  return c.json({ documentId: await createDocument(c.env.DB, c.get('userId'), { title: input.title, author: input.author || null, format: input.format }) }, 201);
});

api.post('/api/documents/:id/parts', async c => {
  if (!await addParts(c.env.DB, c.get('userId'), idParam(c.req.param('id')), partsSchema.parse(await c.req.json()).parts)) throw new ApiError(404, 'Not found', 'Document was not found.');
  return c.json({ ok: true });
});

api.get('/api/documents/:id/preview', async c => {
  const preview = await previewDocument(c.env.DB, c.get('userId'), idParam(c.req.param('id')));
  if (!preview) throw new ApiError(404, 'Not found', 'Document was not found.');
  return c.json(preview);
});

api.delete('/api/documents/:id', async c => {
  if (!await deleteDocument(c.env.DB, c.get('userId'), idParam(c.req.param('id')))) throw new ApiError(404, 'Not found', 'Document was not found.');
  return c.json({ deleted: true });
});

async function decide(db: D1Database, userId: string, id: number, status: 'learned' | 'dismissed', reason: 'known' | 'not_useful' | null = null) {
  if (await decideCandidate(db, userId, id, status, reason)) return;
  if (!await getCandidate(db, userId, id)) throw new ApiError(404, 'Not found', 'Phrase was not found.');
  throw new ApiError(409, 'Already reviewed', 'This card was already reviewed.');
}

// "I know it" keeps the phrase as a memorized card, checked again in a month; "Not useful" just drops it.
// Either way the reason is shown to the connector so it picks better phrases next time.
const KNOWN_CHECK_DAYS = 30;
const skipSchema = z.object({ reason: z.enum(['known', 'not_useful']) });

api.post('/api/candidates/:id/skip', async c => {
  const { reason } = skipSchema.parse(await c.req.json());
  const id = idParam(c.req.param('id'));
  const userId = c.get('userId');
  const candidate = await getCandidate(c.env.DB, userId, id);
  if (!candidate) throw new ApiError(404, 'Not found', 'Phrase was not found.');
  await decide(c.env.DB, userId, id, 'dismissed', reason);
  if (reason === 'known') {
    const { draft } = candidate;
    try {
      await insertCard(c.env.DB, userId, {
        phrase: draft.front, explanation: draft.explanation, keyExpression: draft.keyExpression, examples: draft.examples,
        originalInput: candidate.example, context: candidate.source ? `From "${candidate.source}"` : null, knownForDays: KNOWN_CHECK_DAYS,
      });
    } catch (error) {
      await reopenCandidate(c.env.DB, userId, id);
      throw error;
    }
  }
  return c.json({ ok: true });
});

// GET so <audio src> can point straight at it; clips are immutable, so the browser may cache them.
api.get('/api/audio', async c => {
  const text = normalizeClipText(c.req.query('text') ?? '');
  if (!text || text.length > MAX_CLIP_CHARS) throw new ApiError(400, 'Validation error', `Text must be 1–${MAX_CLIP_CHARS} characters.`);
  return audioResponse(await getClip(c.env, text), c.req.header('Range'));
});

api.get('/api/stories', async c => c.json({ stories: (await listStories(c.env.DB, c.get('userId'))).map(({ id, title, kind }) => ({ id, title, kind })) }));

api.get('/api/stories/:id/audio', async c => {
  const userId = c.get('userId');
  const story = await getStory(c.env.DB, userId, idParam(c.req.param('id')));
  if (!story) throw new ApiError(404, 'Not found', 'Story was not found.');
  return audioResponse(await getStoryAudio(c.env, userId, story), c.req.header('Range'));
});

api.delete('/api/stories/:id', async c => {
  if (!await deleteStory(c.env, c.get('userId'), idParam(c.req.param('id')))) throw new ApiError(404, 'Not found', 'Story was not found.');
  return c.json({ deleted: true });
});

// Settings: each user's own API keys, write-only (only the last 4 characters come back).
const providerParam = (value: string) => {
  const provider = providers.find(item => item === value);
  if (!provider) throw new ApiError(404, 'Not found', 'Unknown provider.');
  return provider;
};

api.put('/api/settings/keys/:provider', async c => {
  await setApiKey(c.env.DB, c.get('userId'), providerParam(c.req.param('provider')), keySchema.parse(await c.req.json()).key);
  return c.json({ keys: await getKeyStatuses(c.env.DB, c.get('userId')) });
});

api.delete('/api/settings/keys/:provider', async c => {
  await setApiKey(c.env.DB, c.get('userId'), providerParam(c.req.param('provider')), null);
  return c.json({ keys: await getKeyStatuses(c.env.DB, c.get('userId')) });
});

// A new connector link replaces the user's old one; the full link is only returned here, once.
api.post('/api/settings/connector', async c => c.json({ url: `${new URL(c.req.url).origin}/mcp/${await createConnectorToken(c.env.DB, c.get('userId'))}` }, 201));
api.delete('/api/settings/connector', async c => { await removeConnectorToken(c.env.DB, c.get('userId')); return c.json({ deleted: true }); });

// MCP connector for Claude and ChatGPT. The token is in the link (ChatGPT cannot send custom headers) or a Bearer
// header, and decides whose data it works on.
api.all('/mcp/:token?', async c => {
  const token = c.req.param('token') ?? c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const userId = await connectorUser(c.env.DB, token);
  if (!userId) return c.json({ error: 'Unauthorized', message: 'Unknown connector link. Create a new one in Settings.' }, 401);
  return handleMcp(c.env, userId, c.req.raw);
});
