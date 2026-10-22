import { nextSchedule, type CardState, type Rating } from './srs';
import { normalizeText, startOfLearningDay } from './text';


export type Card = {
  id: number;
  examples: string[];
  phrase: string;
  explanation: string;
  keyExpression: string;
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
  id: number; examples: string; phrase: string; explanation: string; key_expression: string;
  original_input: string | null; context: string | null;
  state: CardState; due_at: string; interval_days: number; ease: number; reps: number; lapses: number;
  last_reviewed_at: string | null;
  created_at: string;
};

export type NewCard = {
  phrase: string; explanation: string; keyExpression: string;
  originalInput: string | null; context: string | null; examples: string[];
};

function fromRow(row: CardRow): Card {
  return {
    id: row.id, examples: JSON.parse(row.examples || '[]') as string[], phrase: row.phrase, explanation: row.explanation, keyExpression: row.key_expression,
    originalInput: row.original_input, context: row.context, state: row.state, dueAt: row.due_at,
    intervalDays: row.interval_days, ease: row.ease, reps: row.reps, lapses: row.lapses,
    lastReviewedAt: row.last_reviewed_at, createdAt: row.created_at,
  };
}

export async function insertCard(db: D1Database, card: NewCard): Promise<Card> {
  const now = new Date().toISOString();
  const result = await db.prepare(`
    INSERT INTO cards (phrase, normalized_phrase, explanation, key_expression, examples, original_input, context, due_at, created_at, updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8,?8)
  `).bind(card.phrase, normalizeText(card.phrase), card.explanation, card.keyExpression, JSON.stringify(card.examples),
    card.originalInput, card.context, now).run();
  const id = Number(result.meta.last_row_id);
  const created = await getCard(db, id);
  if (!created) throw new Error('D1 did not return the newly created card');
  return created;
}

export async function getCard(db: D1Database, id: number): Promise<Card | null> {
  const row = await db.prepare('SELECT * FROM cards WHERE id = ?1').bind(id).first<CardRow>();
  return row ? fromRow(row) : null;
}

export async function deleteCard(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare('DELETE FROM cards WHERE id = ?1').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
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

// "Memorized" = a review interval of three weeks or more (a mature card in SRS terms).
export const MEMORIZED_DAYS = 21;

// Cards still being learned, soonest-due first; stories are built from these.
export async function getUnmemorizedCards(db: D1Database, limit = 60): Promise<Card[]> {
  const result = await db.prepare('SELECT * FROM cards WHERE interval_days < ?1 ORDER BY due_at LIMIT ?2').bind(MEMORIZED_DAYS, limit).all<CardRow>();
  return result.results.map(fromRow);
}

export async function reviewCard(db: D1Database, card: Card, rating: Rating, review: { durationMs: number; accuracy?: number }): Promise<Card> {
  const now = new Date();
  const next = nextSchedule(card, rating, now);
  await db.batch([
    db.prepare('UPDATE cards SET state=?1, interval_days=?2, ease=?3, reps=?4, lapses=?5, due_at=?6, last_reviewed_at=?7, updated_at=?7 WHERE id=?8')
      .bind(next.state, next.intervalDays, next.ease, next.reps, next.lapses, next.dueAt.toISOString(), now.toISOString(), card.id),
    db.prepare('INSERT INTO reviews (card_id, rating, state_before, interval_before, interval_after, duration_ms, accuracy, reviewed_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)')
      .bind(card.id, rating, card.state, card.intervalDays, next.intervalDays, review.durationMs, review.accuracy ?? null, now.toISOString()),
  ]);
  const updated = await getCard(db, card.id);
  if (!updated) throw new Error('Card disappeared during review');
  return updated;
}

export type Overview = { reviewed: number; due: number; total: number; mature: number };

// The Today page's numbers: typed today, due now, all cards, memorized cards.
export async function getOverview(db: D1Database): Promise<Overview> {
  const row = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM reviews WHERE reviewed_at >= ?1) AS reviewed,
      (SELECT COUNT(*) FROM cards WHERE due_at <= ?2) AS due,
      (SELECT COUNT(*) FROM cards) AS total,
      (SELECT COUNT(*) FROM cards WHERE interval_days >= ?3) AS mature
  `).bind(startOfLearningDay(), new Date().toISOString(), MEMORIZED_DAYS).first<Overview>();
  return { reviewed: row?.reviewed ?? 0, due: row?.due ?? 0, total: row?.total ?? 0, mature: row?.mature ?? 0 };
}
