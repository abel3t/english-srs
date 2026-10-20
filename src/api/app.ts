import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { Bindings } from '../bindings';
import { CONVERSATION_SPEAKERS, MAX_CLIP_CHARS, OLLAMA_MODEL, PROMPT_VERSION } from '../constants';
import { deleteCard, getCard, getDailyStats, getDueCards, insertCard, reviewCard, type Card } from '../lib/cards-db';
import { addCandidates, setCandidateStatus, snoozeCandidate } from '../lib/candidates-db';
import { getClip, normalizeClipText } from '../lib/clips';
import { createConversation, synthesizeConversation } from '../lib/conversation';
import { analyzeLearningInput } from '../lib/learning-analysis';
import { extractPhrases } from '../lib/phrase-extraction';
import { assessAttempt, createQuestion } from '../lib/speaking';
import { formatInterval, nextSchedule, ratings } from '../lib/srs';
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

const analyzeSchema = z.object({
  text: z.string().trim().min(1).max(3000), context: z.string().trim().max(1500).optional(),
  confusingPart: z.string().trim().max(500).optional(), intendedMeaning: z.string().trim().max(1000).optional(),
});
const cardSchema = z.object({
  phrase: z.string().trim().min(1).max(1000), explanation: z.string().trim().min(1).max(6000),
  keyExpression: z.string().trim().max(300).default(''), grammarPattern: z.string().trim().max(300).default(''),
  originalInput: z.string().trim().max(3000).optional(), context: z.string().trim().max(1500).optional(),
  candidateId: z.number().int().positive().optional(),
});
const reviewAnswerSchema = z.object({
  cardId: z.union([z.string(), z.number()]).transform(String), answer: z.enum(['again', 'hard', 'good', 'easy']),
  reviewDurationMs: z.number().int().min(0).max(3_600_000),
  mode: z.enum(['classic', 'dictation', 'typing']).default('classic'), accuracy: z.number().min(0).max(1).optional(),
});
const candidateSchema = z.object({ text: z.string().trim().min(1).max(500), context: z.string().trim().max(1500).optional(), source: z.string().trim().max(200).default('Chrome extension') });
const extractSchema = z.object({ text: z.string().trim().min(1).max(12_000), source: z.string().trim().max(200).optional() });
const speakerLine = new RegExp(`^(${CONVERSATION_SPEAKERS.map(speaker => speaker.name).join('|')}): \\S`);
const audioSchema = z.object({ transcript: z.string().trim().min(1).max(8000).refine(
  text => text.split('\n').filter(line => line.trim()).every(line => speakerLine.test(line.trim())),
  `Every line must start with ${CONVERSATION_SPEAKERS.map(speaker => `"${speaker.name}:"`).join(' or ')}.`,
) });

export function toReviewCard(card: Card) {
  return {
    cardId: String(card.id), front: card.phrase, back: card.explanation, keyExpression: card.keyExpression,
    sessionTimestamp: Math.floor(Date.now() / 1000),
    answerButtons: ratings.map(type => ({ type, repeat: formatInterval(nextSchedule(card, type).intervalDays) })),
  };
}
export type ReviewCard = ReturnType<typeof toReviewCard>;

api.get('/health', c => c.json({ service: 'English SRS', status: 'running', runtime: 'cloudflare-workers', timestamp: new Date().toISOString() }));

api.post('/api/analyze', async c => {
  const input = analyzeSchema.parse(await c.req.json());
  if (countWords(input.text) < 3) throw new ApiError(400, 'Validation error', 'Please enter at least 3 words.');
  return c.json({ analysis: await analyzeLearningInput(c.env, input) });
});

api.post('/api/cards', async c => {
  const input = cardSchema.parse(await c.req.json());
  const card = await insertCard(c.env.DB, {
    phrase: input.phrase, explanation: input.explanation, keyExpression: input.keyExpression, grammarPattern: input.grammarPattern,
    originalInput: input.originalInput || null, context: input.context || null,
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

api.get('/api/stats', async c => c.json(await getDailyStats(c.env.DB)));

// Response shape kept from the original Chrome extension review flow.
api.get('/api/review/due', async c => {
  const due = await getDueCards(c.env.DB);
  const card = due.length ? due[Math.floor(Math.random() * due.length)] : null;
  return c.json({ card: card ? toReviewCard(card) : null, dueCount: due.length });
});

api.post('/api/review/answer', async c => {
  const input = reviewAnswerSchema.parse(await c.req.json());
  const card = await getCard(c.env.DB, idParam(input.cardId));
  if (!card) throw new ApiError(404, 'Not found', 'Card was not found.');
  const updated = await reviewCard(c.env.DB, card, input.answer, { durationMs: input.reviewDurationMs, mode: input.mode, accuracy: input.accuracy });
  return c.json({ status: 'accepted', card: updated, stats: await getDailyStats(c.env.DB) });
});

// Captured text (e.g. from the Chrome extension) waits as a candidate until the dashboard offers it.
api.post('/api/candidates', async c => {
  const input = candidateSchema.parse(await c.req.json());
  const added = await addCandidates(c.env.DB, [{ phrase: input.text, example: input.context, source: input.source }]);
  return c.json({ added }, 201);
});

api.post('/api/candidates/:id/:action{snooze|dismiss}', async c => {
  const id = idParam(c.req.param('id'));
  const done = c.req.param('action') === 'snooze' ? await snoozeCandidate(c.env.DB, id) : await setCandidateStatus(c.env.DB, id, 'dismissed');
  if (!done) throw new ApiError(404, 'Not found', 'Phrase was not found.');
  return c.json({ ok: true });
});

// One chunk of a book per request; the browser drives the loop so each request stays small.
api.post('/api/import/extract', async c => {
  const input = extractSchema.parse(await c.req.json());
  return c.json(await extractPhrases(c.env, input.text, input.source));
});

// GET so <audio src> can point straight at it; clips are immutable, so the browser may cache them.
api.get('/api/audio', async c => {
  const text = normalizeClipText(c.req.query('text') ?? '');
  if (!text || text.length > MAX_CLIP_CHARS) throw new ApiError(400, 'Validation error', `Text must be 1–${MAX_CLIP_CHARS} characters.`);
  const clip = await getClip(c.env, text);
  return new Response(clip.body, { headers: { 'Content-Type': clip.contentType, 'Cache-Control': 'private, max-age=31536000, immutable' } });
});

api.post('/api/speaking/question', async c => {
  const { topic } = z.object({ topic: z.string().trim().max(300).optional() }).parse(await c.req.json().catch(() => ({})));
  return c.json(await createQuestion(c.env, topic || undefined));
});

const attemptMetaSchema = z.object({
  sessionId: z.string().uuid(), attempt: z.number().int().min(1).max(20),
  question: z.string().trim().min(1).max(500), phrases: z.array(z.string().trim().min(1).max(120)).max(5).default([]),
});

// multipart/form-data: "meta" (JSON) and "audio" (16 kHz mono WAV recorded in the browser).
api.post('/api/speaking/attempts', async c => {
  const form = await c.req.formData();
  const meta = attemptMetaSchema.parse(JSON.parse(String(form.get('meta') ?? '{}')));
  const audio = form.get('audio');
  if (!(audio instanceof File) || audio.size === 0) throw new ApiError(400, 'Validation error', 'Missing recording.');
  if (audio.size > 4 * 1024 * 1024) throw new ApiError(400, 'Validation error', 'Recording is too large.');
  return c.json({ attempt: await assessAttempt(c.env, { ...meta, audio: new Uint8Array(await audio.arrayBuffer()) }) }, 201);
});

api.get('/api/speaking/recordings/:sessionId/:attempt', async c => {
  const sessionId = z.string().uuid().parse(c.req.param('sessionId'));
  const attempt = z.coerce.number().int().min(1).max(20).parse(c.req.param('attempt'));
  const object = await c.env.AUDIO.get(`recordings/${sessionId}/${attempt}.wav`);
  if (!object) throw new ApiError(404, 'Not found', 'Recording was not found.');
  return new Response(object.body, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=31536000, immutable' } });
});

api.post('/api/conversations', async c => c.json({ conversation: await createConversation(c.env) }));
api.post('/api/conversations/audio', async c => synthesizeConversation(c.env, audioSchema.parse(await c.req.json()).transcript));
