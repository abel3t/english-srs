import { Hono } from 'hono';
import { z } from 'zod';
import type { Bindings } from '../bindings';
import { CONVERSATION_SPEAKERS } from '../constants';
import { analyzeLearningInput } from '../lib/learning-analysis';
import { deleteLearningItem, getDailyStats, getLearningItem, markLearningItem } from '../lib/learning-db';
import { answerNojiCard, createNojiNote, getRandomDueCard } from '../lib/cloud-services';
import { createConversation, synthesizeConversation } from '../lib/conversation';

export const api = new Hono<{ Bindings: Bindings }>();

const analyzeSchema = z.object({
  text: z.string().trim().min(1).max(3000), context: z.string().trim().max(1500).optional(),
  confusingPart: z.string().trim().max(500).optional(), intendedMeaning: z.string().trim().max(1000).optional(),
});
const saveSchema = z.object({ mainSentence: z.string().trim().min(1).max(1000), explanation: z.string().trim().min(1).max(6000) });
const reviewAnswerSchema = z.object({ cardId: z.string().min(1).max(100), sessionTimestamp: z.number().int().positive(),
  answer: z.enum(['again', 'hard', 'good', 'easy']), reviewDurationMs: z.number().int().min(0).max(3_600_000) });
const speakerLine = new RegExp(`^(${CONVERSATION_SPEAKERS.map(speaker => speaker.name).join('|')}): \\S`);
const audioSchema = z.object({ transcript: z.string().trim().min(1).max(8000).refine(
  text => text.split('\n').filter(line => line.trim()).every(line => speakerLine.test(line.trim())),
  `Every line must start with ${CONVERSATION_SPEAKERS.map(speaker => `"${speaker.name}:"`).join(' or ')}.`,
) });
const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

api.get('/health', c => c.json({ service: 'English SRS', status: 'running', runtime: 'cloudflare-workers', timestamp: new Date().toISOString() }));
api.get('/cards', c => c.redirect('/learn', 301));

api.post('/api/analyze', async c => {
  try {
    const input = analyzeSchema.parse(await c.req.json());
    if (countWords(input.text) < 3) return c.json({ error: 'Validation error', message: 'Please enter at least 3 words.' }, 400);
    const item = await analyzeLearningInput(c.env, input);
    return c.json({ item, stats: await getDailyStats(c.env.DB) });
  } catch (error) {
    console.error('Learning analysis failed', error);
    if (error instanceof z.ZodError) return c.json({ error: 'Validation error', message: error.errors.map(issue => issue.message).join(', ') }, 400);
    return c.json({ error: 'Analysis failed', message: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

api.post('/api/learning-items/:id/save', async c => {
  const id = Number.parseInt(c.req.param('id'));
  const existing = Number.isSafeInteger(id) ? await getLearningItem(c.env.DB, id) : null;
  if (!existing) return c.json({ error: 'Not found', message: 'Learning item was not found.' }, 404);
  if (existing.userDecision === 'saved' || existing.userDecision === 'edited_then_saved') return c.json({ error: 'Already saved', message: 'This item was already saved to Noji.' }, 409);

  try {
    const input = saveSchema.parse(await c.req.json());
    const noteId = await createNojiNote(c.env, input.mainSentence, input.explanation);
    const edited = input.mainSentence !== existing.mainSentence || input.explanation !== existing.explanation;
    const item = await markLearningItem(c.env.DB, id, edited ? 'edited_then_saved' : 'saved', { ...input, nojiNoteId: noteId });
    return c.json({ item, stats: await getDailyStats(c.env.DB) });
  } catch (error) {
    console.error('Noji save failed', error);
    if (error instanceof z.ZodError) return c.json({ error: 'Validation error', message: error.errors.map(issue => issue.message).join(', ') }, 400);
    return c.json({ error: 'Noji save failed', message: error instanceof Error ? error.message : 'Unknown error' }, 502);
  }
});

api.post('/api/learning-items/:id/skip', async c => {
  const id = Number.parseInt(c.req.param('id'));
  const existing = Number.isSafeInteger(id) ? await getLearningItem(c.env.DB, id) : null;
  if (!existing) return c.json({ error: 'Not found', message: 'Learning item was not found.' }, 404);
  if (existing.userDecision === 'saved' || existing.userDecision === 'edited_then_saved') return c.json({ error: 'Already saved', message: 'A saved item cannot be skipped.' }, 409);
  return c.json({ item: await markLearningItem(c.env.DB, id, 'skipped'), stats: await getDailyStats(c.env.DB) });
});

api.delete('/api/learning-items/:id', async c => {
  const id = Number.parseInt(c.req.param('id'));
  if (!Number.isSafeInteger(id)) return c.json({ error: 'Validation error', message: 'Invalid learning item ID.' }, 400);
  return await deleteLearningItem(c.env.DB, id)
    ? c.json({ deleted: true, id })
    : c.json({ error: 'Not found', message: 'Learning item was not found.' }, 404);
});

api.get('/api/stats', async c => c.json(await getDailyStats(c.env.DB)));
api.get('/api/review/due', async c => {
  try { return c.json({ card: await getRandomDueCard(c.env) }); }
  catch (error) { console.error('Noji due-card request failed', error); return c.json({ error: 'Noji review failed', message: error instanceof Error ? error.message : 'Unknown error' }, 502); }
});
api.post('/api/review/answer', async c => {
  try { return c.json(await answerNojiCard(c.env, reviewAnswerSchema.parse(await c.req.json()))); }
  catch (error) {
    console.error('Noji answer failed', error);
    if (error instanceof z.ZodError) return c.json({ error: 'Validation error', message: error.errors.map(issue => issue.message).join(', ') }, 400);
    return c.json({ error: 'Noji review failed', message: error instanceof Error ? error.message : 'Unknown error' }, 502);
  }
});

api.post('/api/conversations', async c => {
  try { return c.json({ conversation: await createConversation(c.env) }); }
  catch (error) { console.error('Conversation generation failed', error); return c.json({ error: 'Conversation failed', message: error instanceof Error ? error.message : 'Unknown error' }, 502); }
});
api.post('/api/conversations/audio', async c => {
  try { return await synthesizeConversation(c.env, audioSchema.parse(await c.req.json()).transcript); }
  catch (error) {
    console.error('Conversation audio failed', error);
    if (error instanceof z.ZodError) return c.json({ error: 'Validation error', message: error.errors.map(issue => issue.message).join(', ') }, 400);
    return c.json({ error: 'Audio failed', message: error instanceof Error ? error.message : 'Unknown error' }, 502);
  }
});

