import { Hono } from 'hono';
import { z } from 'zod';
import type { Bindings } from './bindings';
import { analyzeLearningInput } from './lib/learning-analysis';
import { deleteLearningItem, getDailyStats, getLearningItem, getLearningOverview, listLearningItems, markLearningItem, type LearningDecision } from './lib/learning-db';
import { answerNojiCard, createNojiNote, getRandomDueCard } from './lib/cloud-services';
import { cardsPage } from './pages/cards';
import { dashboardPage } from './pages/dashboard';
import { historyPage } from './pages/history';

const app = new Hono<{ Bindings: Bindings }>();

const analyzeSchema = z.object({
  text: z.string().trim().min(1).max(3000), context: z.string().trim().max(1500).optional(),
  confusingPart: z.string().trim().max(500).optional(), intendedMeaning: z.string().trim().max(1000).optional(),
});
const saveSchema = z.object({ mainSentence: z.string().trim().min(1).max(1000), explanation: z.string().trim().min(1).max(6000) });
const reviewAnswerSchema = z.object({ cardId: z.string().min(1).max(100), sessionTimestamp: z.number().int().positive(),
  answer: z.enum(['again', 'hard', 'good', 'easy']), reviewDurationMs: z.number().int().min(0).max(3_600_000) });
const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Cache-Control', 'no-store');
});

app.get('/', async c => c.html(dashboardPage(await getLearningOverview(c.env.DB), await listLearningItems(c.env.DB, { limit: 8 }))));
app.get('/health', c => c.json({ service: 'English SRS', status: 'running', runtime: 'cloudflare-workers', timestamp: new Date().toISOString() }));
app.get('/learn', c => c.html(cardsPage()));
app.get('/cards', c => c.redirect('/learn', 301));
app.get('/history', async c => {
  const query = c.req.query('q')?.trim() ?? '';
  const rawDecision = c.req.query('decision');
  const decisions: LearningDecision[] = ['pending', 'saved', 'skipped', 'edited_then_saved'];
  const decision = decisions.includes(rawDecision as LearningDecision) ? rawDecision as LearningDecision : undefined;
  return c.html(historyPage(await listLearningItems(c.env.DB, { query, decision, limit: 100 }), query, decision));
});

app.post('/api/analyze', async c => {
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

app.post('/api/learning-items/:id/save', async c => {
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

app.post('/api/learning-items/:id/skip', async c => {
  const id = Number.parseInt(c.req.param('id'));
  const existing = Number.isSafeInteger(id) ? await getLearningItem(c.env.DB, id) : null;
  if (!existing) return c.json({ error: 'Not found', message: 'Learning item was not found.' }, 404);
  if (existing.userDecision === 'saved' || existing.userDecision === 'edited_then_saved') return c.json({ error: 'Already saved', message: 'A saved item cannot be skipped.' }, 409);
  return c.json({ item: await markLearningItem(c.env.DB, id, 'skipped'), stats: await getDailyStats(c.env.DB) });
});

app.delete('/api/learning-items/:id', async c => {
  const id = Number.parseInt(c.req.param('id'));
  if (!Number.isSafeInteger(id)) return c.json({ error: 'Validation error', message: 'Invalid learning item ID.' }, 400);
  return await deleteLearningItem(c.env.DB, id)
    ? c.json({ deleted: true, id })
    : c.json({ error: 'Not found', message: 'Learning item was not found.' }, 404);
});

app.get('/api/stats', async c => c.json(await getDailyStats(c.env.DB)));
app.get('/api/review/due', async c => {
  try { return c.json({ card: await getRandomDueCard(c.env) }); }
  catch (error) { console.error('Noji due-card request failed', error); return c.json({ error: 'Noji review failed', message: error instanceof Error ? error.message : 'Unknown error' }, 502); }
});
app.post('/api/review/answer', async c => {
  try { return c.json(await answerNojiCard(c.env, reviewAnswerSchema.parse(await c.req.json()))); }
  catch (error) {
    console.error('Noji answer failed', error);
    if (error instanceof z.ZodError) return c.json({ error: 'Validation error', message: error.errors.map(issue => issue.message).join(', ') }, 400);
    return c.json({ error: 'Noji review failed', message: error instanceof Error ? error.message : 'Unknown error' }, 502);
  }
});

export default { fetch: app.fetch } satisfies ExportedHandler<Bindings>;
