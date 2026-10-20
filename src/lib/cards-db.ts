import { nextSchedule, type CardState, type Rating, type ReviewMode } from './srs';
import { ftsQuery, normalizeText, startOfLearningDay } from './text';


export type CardGoal = 'understand' | 'use';

export type Card = {
  id: number;
  goal: CardGoal;
  phrase: string;
  explanation: string;
  keyExpression: string;
  grammarPattern: string;
  originalInput: string | null;
  context: string | null;
  state: CardState;
  dueAt: string;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  lastReviewedAt: string | null;
  createdAt: string;
};

type CardRow = {
  id: number; goal: CardGoal; phrase: string; explanation: string; key_expression: string; grammar_pattern: string;
  original_input: string | null; context: string | null;
  state: CardState; due_at: string; interval_days: number; ease: number; reps: number; lapses: number;
  last_reviewed_at: string | null;
  created_at: string;
};

export type NewCard = {
  phrase: string; explanation: string; keyExpression: string; grammarPattern: string;
  originalInput: string | null; context: string | null; goal?: CardGoal;
  model: string; promptVersion: string;
};

function fromRow(row: CardRow): Card {
  return {
    id: row.id, goal: row.goal, phrase: row.phrase, explanation: row.explanation, keyExpression: row.key_expression,
    grammarPattern: row.grammar_pattern, originalInput: row.original_input, context: row.context, state: row.state, dueAt: row.due_at,
    intervalDays: row.interval_days, ease: row.ease, reps: row.reps, lapses: row.lapses,
    lastReviewedAt: row.last_reviewed_at, createdAt: row.created_at,
  };
}

export async function insertCard(db: D1Database, card: NewCard): Promise<Card> {
  const now = new Date().toISOString();
  const result = await db.prepare(`
    INSERT INTO cards (phrase, normalized_phrase, explanation, key_expression, grammar_pattern, original_input, context,
      due_at, model, prompt_version, created_at, updated_at, goal)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?8,?8,?11)
  `).bind(card.phrase, normalizeText(card.phrase), card.explanation, card.keyExpression, card.grammarPattern,
    card.originalInput, card.context, now, card.model, card.promptVersion, card.goal ?? 'understand').run();
  const id = Number(result.meta.last_row_id);
  await db.prepare('INSERT INTO cards_fts (card_id, phrase, key_expression, grammar_pattern) VALUES (?1,?2,?3,?4)')
    .bind(id, card.phrase, card.keyExpression, card.grammarPattern).run();
  const created = await getCard(db, id);
  if (!created) throw new Error('D1 did not return the newly created card');
  return created;
}

export async function getCard(db: D1Database, id: number): Promise<Card | null> {
  const row = await db.prepare('SELECT * FROM cards WHERE id = ?1').bind(id).first<CardRow>();
  return row ? fromRow(row) : null;
}

export async function deleteCard(db: D1Database, id: number): Promise<boolean> {
  await db.prepare('DELETE FROM cards_fts WHERE card_id = ?1').bind(id).run();
  const result = await db.prepare('DELETE FROM cards WHERE id = ?1').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

// Exact phrase matches first, then full-text matches, so the analyzer can flag duplicates and related cards.
export async function findRelatedCards(db: D1Database, input: string, limit = 3): Promise<Card[]> {
  const normalized = normalizeText(input);
  const exact = await db.prepare('SELECT * FROM cards WHERE normalized_phrase = ?1 ORDER BY created_at DESC LIMIT ?2')
    .bind(normalized, limit).all<CardRow>();
  const cards = exact.results.map(fromRow);
  const match = ftsQuery(input);
  if (cards.length >= limit || !match) return cards;
  const related = await db.prepare(`
    SELECT c.* FROM cards_fts f JOIN cards c ON c.id = f.card_id
    WHERE cards_fts MATCH ?1 AND c.normalized_phrase != ?2
    ORDER BY bm25(cards_fts), c.created_at DESC LIMIT ?3
  `).bind(match, normalized, limit - cards.length).all<CardRow>();
  return [...cards, ...related.results.map(fromRow)];
}

export async function listCards(db: D1Database, options: { query?: string; state?: CardState; limit?: number } = {}): Promise<Card[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (options.query?.trim()) {
    conditions.push(`(phrase LIKE ? ESCAPE '\\' OR key_expression LIKE ? ESCAPE '\\' OR original_input LIKE ? ESCAPE '\\')`);
    const pattern = `%${options.query.trim().replace(/[\\%_]/g, '\\$&')}%`;
    values.push(pattern, pattern, pattern);
  }
  if (options.state) { conditions.push('state = ?'); values.push(options.state); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const result = await db.prepare(`SELECT * FROM cards ${where} ORDER BY created_at DESC LIMIT ?`).bind(...values, limit).all<CardRow>();
  return result.results.map(fromRow);
}

export async function getDueCards(db: D1Database, limit = 20, now = new Date()): Promise<Card[]> {
  const result = await db.prepare('SELECT * FROM cards WHERE due_at <= ?1 ORDER BY due_at LIMIT ?2').bind(now.toISOString(), limit).all<CardRow>();
  return result.results.map(fromRow);
}

// Cards to practice outside review (e.g. listening): soonest-due first, so struggling phrases come up more.
export async function getPracticeCards(db: D1Database, limit: number, options: { preferUse?: boolean } = {}): Promise<Card[]> {
  const order = options.preferUse ? "goal = 'use' DESC, due_at" : 'due_at';
  const result = await db.prepare(`SELECT * FROM cards ORDER BY ${order} LIMIT ?1`).bind(limit).all<CardRow>();
  return result.results.map(fromRow);
}

export async function reviewCard(db: D1Database, card: Card, rating: Rating, review: { durationMs: number; mode: ReviewMode; accuracy?: number }): Promise<Card> {
  const now = new Date();
  const next = nextSchedule(card, rating, now);
  await db.batch([
    db.prepare('UPDATE cards SET state=?1, interval_days=?2, ease=?3, reps=?4, lapses=?5, due_at=?6, last_reviewed_at=?7, updated_at=?7 WHERE id=?8')
      .bind(next.state, next.intervalDays, next.ease, next.reps, next.lapses, next.dueAt.toISOString(), now.toISOString(), card.id),
    db.prepare('INSERT INTO reviews (card_id, rating, state_before, interval_before, interval_after, duration_ms, mode, accuracy, reviewed_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)')
      .bind(card.id, rating, card.state, card.intervalDays, next.intervalDays, review.durationMs, review.mode, review.accuracy ?? null, now.toISOString()),
  ]);
  const updated = await getCard(db, card.id);
  if (!updated) throw new Error('Card disappeared during review');
  return updated;
}

export type DailyStats = { added: number; reviewed: number; due: number };

export async function getDailyStats(db: D1Database): Promise<DailyStats> {
  const since = startOfLearningDay();
  const row = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM cards WHERE created_at >= ?1) AS added,
      (SELECT COUNT(*) FROM reviews WHERE reviewed_at >= ?1) AS reviewed,
      (SELECT COUNT(*) FROM cards WHERE due_at <= ?2) AS due
  `).bind(since, new Date().toISOString()).first<DailyStats>();
  return { added: row?.added ?? 0, reviewed: row?.reviewed ?? 0, due: row?.due ?? 0 };
}

export type Overview = DailyStats & { total: number; mature: number; candidates: number };

export async function getOverview(db: D1Database): Promise<Overview> {
  const row = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM cards) AS total,
      (SELECT COUNT(*) FROM cards WHERE state = 'review' AND interval_days >= 21) AS mature,
      (SELECT COUNT(*) FROM candidates WHERE status = 'pending') AS candidates
  `).first<Omit<Overview, keyof DailyStats>>();
  return { ...await getDailyStats(db), total: row?.total ?? 0, mature: row?.mature ?? 0, candidates: row?.candidates ?? 0 };
}
