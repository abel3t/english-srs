import { DRILL_TIMES, LADDER, afterDrill, nextSchedule, stepFor, type CardState, type Rating } from './srs';
import { normalizeText } from './text';

// A learner's cards. Every function takes the user it works for and never reads or changes another user's cards.
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
  step: number;
  // Typings of each text in the first drill (only while the card is new).
  drill: number[];
  reps: number;
  lapses: number;
  lastReviewedAt: string | null;
  createdAt: string;
};

type CardRow = Omit<Card, 'examples' | 'drill'> & { examples: string; drill: string };

// knownForDays: the learner already knows it, so it skips the drill and starts on the ladder rung for that many days.
type NewCard = {
  phrase: string; explanation: string; keyExpression: string;
  originalInput: string | null; context: string | null; examples: string[]; knownForDays?: number;
};

const COLUMNS = 'id, examples, phrase, explanation, keyExpression, originalInput, context, state, dueAt, intervalDays, step, drill, reps, lapses, lastReviewedAt, createdAt';
const fromRow = (row: CardRow): Card => ({ ...row, examples: JSON.parse(row.examples || '[]') as string[], drill: JSON.parse(row.drill || '[]') as number[] });

// What is typed for a card: its phrase, then its examples.
export const cardTexts = (card: Pick<Card, 'phrase' | 'examples'>) => [card.phrase, ...card.examples].filter(Boolean);

export async function insertCard(db: D1Database, userId: string, card: NewCard): Promise<Card> {
  const now = new Date();
  const step = card.knownForDays ? stepFor(card.knownForDays) : 0;
  const days = card.knownForDays ? LADDER[step] : 0;
  const row = await db.prepare(`
    INSERT INTO Cards (userId, phrase, normalizedPhrase, explanation, keyExpression, examples, originalInput, context, state, intervalDays, step, dueAt, createdAt, updatedAt)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13) RETURNING ${COLUMNS}
  `).bind(userId, card.phrase, normalizeText(card.phrase), card.explanation, card.keyExpression, JSON.stringify(card.examples),
    card.originalInput, card.context, days ? 'review' : 'new', days, step, new Date(now.getTime() + days * 86_400_000).toISOString(), now.toISOString()).first<CardRow>();
  if (!row) throw new Error('D1 did not return the newly created card');
  return fromRow(row);
}

export async function getCard(db: D1Database, userId: string, id: number): Promise<Card | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM Cards WHERE id = ?1 AND userId = ?2`).bind(id, userId).first<CardRow>();
  return row ? fromRow(row) : null;
}

export async function deleteCard(db: D1Database, userId: string, id: number): Promise<boolean> {
  const result = await db.prepare('DELETE FROM Cards WHERE id = ?1 AND userId = ?2').bind(id, userId).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function listCards(db: D1Database, userId: string, options: { query?: string; state?: CardState; learningOnly?: boolean; limit?: number } = {}): Promise<Card[]> {
  const conditions: string[] = ['userId = ?'];
  const values: unknown[] = [userId];
  if (options.query?.trim()) {
    conditions.push(`(phrase LIKE ? ESCAPE '\\' OR keyExpression LIKE ? ESCAPE '\\' OR originalInput LIKE ? ESCAPE '\\')`);
    const pattern = `%${options.query.trim().replace(/[\\%_]/g, '\\$&')}%`;
    values.push(pattern, pattern, pattern);
  }
  if (options.state) { conditions.push('state = ?'); values.push(options.state); }
  if (options.learningOnly) { conditions.push('intervalDays < ?'); values.push(MEMORIZED_DAYS); }
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const result = await db.prepare(`SELECT ${COLUMNS} FROM Cards WHERE ${conditions.join(' AND ')} ORDER BY createdAt DESC LIMIT ?`).bind(...values, limit).all<CardRow>();
  return result.results.map(fromRow);
}

// Reviews first (they are what keeps memories alive), then new cards to drill, each oldest first.
export async function getDueCards(db: D1Database, userId: string, limit = 20, now = new Date()): Promise<Card[]> {
  const result = await db.prepare(`SELECT ${COLUMNS} FROM Cards WHERE userId = ?1 AND dueAt <= ?2 ORDER BY state = 'new', dueAt LIMIT ?3`).bind(userId, now.toISOString(), limit).all<CardRow>();
  return result.results.map(fromRow);
}

// "Memorized" = a review interval of three weeks or more (a mature card in SRS terms).
export const MEMORIZED_DAYS = 21;

// Cards still being learned, soonest-due first; stories are built from these.
export async function getUnmemorizedCards(db: D1Database, userId: string, limit = 60): Promise<Card[]> {
  const result = await db.prepare(`SELECT ${COLUMNS} FROM Cards WHERE userId = ?1 AND intervalDays < ?2 ORDER BY dueAt LIMIT ?3`).bind(userId, MEMORIZED_DAYS, limit).all<CardRow>();
  return result.results.map(fromRow);
}

export async function reviewCard(db: D1Database, card: Card, rating: Rating, review: { durationMs: number; accuracy?: number }): Promise<Card> {
  const now = new Date();
  const next = nextSchedule(card, rating, now);
  const [, , updated] = await db.batch<CardRow>([
    db.prepare('UPDATE Cards SET state=?1, intervalDays=?2, step=?3, reps=?4, lapses=?5, dueAt=?6, lastReviewedAt=?7, updatedAt=?7 WHERE id=?8')
      .bind(next.state, next.intervalDays, next.step, next.reps, next.lapses, next.dueAt.toISOString(), now.toISOString(), card.id),
    db.prepare('INSERT INTO Reviews (cardId, rating, stateBefore, intervalBefore, intervalAfter, durationMs, accuracy, reviewedAt) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)')
      .bind(card.id, rating, card.state, card.intervalDays, next.intervalDays, review.durationMs, review.accuracy ?? null, now.toISOString()),
    db.prepare(`SELECT ${COLUMNS} FROM Cards WHERE id = ?1`).bind(card.id),
  ]);
  if (!updated.results[0]) throw new Error('Card disappeared during review');
  return fromRow(updated.results[0]);
}

// One typing in a new card's first drill. When every text has been typed DRILL_TIMES times the card is learned:
// it goes on the ladder (first review an hour later) and the drill counts as its first review.
export async function drillCard(db: D1Database, card: Card, textIndex: number, accuracy?: number): Promise<{ card: Card; learned: boolean }> {
  const counts = cardTexts(card).map((_, index) => card.drill[index] ?? 0);
  if (card.state !== 'new' || textIndex < 0 || textIndex >= counts.length) return { card, learned: false };
  counts[textIndex] = Math.min(DRILL_TIMES, counts[textIndex] + 1);
  const now = new Date();
  if (!counts.every(count => count >= DRILL_TIMES)) {
    await db.prepare('UPDATE Cards SET drill = ?1, updatedAt = ?2 WHERE id = ?3').bind(JSON.stringify(counts), now.toISOString(), card.id).run();
    return { card: { ...card, drill: counts }, learned: false };
  }
  const next = afterDrill(card, now);
  const [, , updated] = await db.batch<CardRow>([
    db.prepare('UPDATE Cards SET state=?1, intervalDays=?2, step=?3, reps=?4, drill=?5, dueAt=?6, lastReviewedAt=?7, updatedAt=?7 WHERE id=?8')
      .bind(next.state, next.intervalDays, next.step, next.reps, JSON.stringify(counts), next.dueAt.toISOString(), now.toISOString(), card.id),
    db.prepare("INSERT INTO Reviews (cardId, rating, stateBefore, intervalBefore, intervalAfter, durationMs, accuracy, reviewedAt) VALUES (?1, 'good', 'new', 0, ?2, 0, ?3, ?4)")
      .bind(card.id, next.intervalDays, accuracy ?? null, now.toISOString()),
    db.prepare(`SELECT ${COLUMNS} FROM Cards WHERE id = ?1`).bind(card.id),
  ]);
  return { card: fromRow(updated.results[0]), learned: true };
}

type Overview = { due: number; total: number; mature: number };

// The Today page's numbers: due now, all cards, memorized cards (what was studied comes from activity-db).
export async function getOverview(db: D1Database, userId: string): Promise<Overview> {
  const row = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM Cards WHERE userId = ?1 AND dueAt <= ?2) AS due,
      (SELECT COUNT(*) FROM Cards WHERE userId = ?1) AS total,
      (SELECT COUNT(*) FROM Cards WHERE userId = ?1 AND intervalDays >= ?3) AS mature
  `).bind(userId, new Date().toISOString(), MEMORIZED_DAYS).first<Overview>();
  return { due: row?.due ?? 0, total: row?.total ?? 0, mature: row?.mature ?? 0 };
}
