export type LearningDecision = 'pending' | 'saved' | 'skipped' | 'edited_then_saved';
export type Recommendation = 'memorize' | 'optional' | 'understand_only' | 'needs_context' | 'review_existing';

export type LearningItem = {
  id: number;
  originalInput: string;
  context: string | null;
  intendedMeaning: string | null;
  confusingPart: string | null;
  normalizedInput: string;
  mainSentence: string;
  keyExpression: string;
  grammarPattern: string;
  explanation: string;
  recommendation: Recommendation;
  recommendationScore: number;
  recommendationReason: string;
  userDecision: LearningDecision;
  relatedItemId: number | null;
  nojiNoteId: string | null;
  model: string;
  promptVersion: string;
  createdAt: string;
  updatedAt: string;
};

type LearningRow = {
  id: number; original_input: string; context: string | null; intended_meaning: string | null;
  confusing_part: string | null; normalized_input: string; main_sentence: string; key_expression: string;
  grammar_pattern: string; explanation: string; recommendation: Recommendation; recommendation_score: number;
  recommendation_reason: string; user_decision: LearningDecision; related_item_id: number | null;
  noji_note_id: string | null; model: string; prompt_version: string; created_at: string; updated_at: string;
};

export type NewLearningItem = Omit<LearningItem, 'id' | 'createdAt' | 'updatedAt' | 'userDecision' | 'nojiNoteId'>;

function fromRow(row: LearningRow): LearningItem {
  return {
    id: row.id, originalInput: row.original_input, context: row.context, intendedMeaning: row.intended_meaning,
    confusingPart: row.confusing_part, normalizedInput: row.normalized_input, mainSentence: row.main_sentence,
    keyExpression: row.key_expression, grammarPattern: row.grammar_pattern, explanation: row.explanation,
    recommendation: row.recommendation, recommendationScore: row.recommendation_score,
    recommendationReason: row.recommendation_reason, userDecision: row.user_decision,
    relatedItemId: row.related_item_id, nojiNoteId: row.noji_note_id, model: row.model,
    promptVersion: row.prompt_version, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function normalizeLearningText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function learningDateKey(timestamp: string | Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(typeof timestamp === 'string' ? new Date(timestamp) : timestamp);
}

function searchTerms(input: string): string {
  const stop = new Set(['the','a','an','to','of','in','on','at','for','and','or','is','are','was','were','be','this','that','it','i','you']);
  return [...new Set(normalizeLearningText(input).split(' ').filter(token => token.length > 2 && !stop.has(token)))]
    .sort((a, b) => b.length - a.length).slice(0, 6).map(token => `"${token.replace(/"/g, '""')}"`).join(' OR ');
}

export async function findHistoryCandidates(db: D1Database, input: string, limit = 3): Promise<LearningItem[]> {
  const normalized = normalizeLearningText(input);
  const exact = await db.prepare('SELECT * FROM learning_items WHERE normalized_input = ?1 ORDER BY created_at DESC LIMIT ?2')
    .bind(normalized, limit).all<LearningRow>();
  const items = exact.results.map(fromRow);
  if (items.length >= limit) return items;

  const match = searchTerms(input);
  if (!match) return items;
  const semantic = await db.prepare(`
    SELECT li.* FROM learning_items_fts f
    JOIN learning_items li ON li.id = f.learning_item_id
    WHERE learning_items_fts MATCH ?1 AND li.normalized_input != ?2
    ORDER BY bm25(learning_items_fts), li.created_at DESC LIMIT ?3
  `).bind(match, normalized, limit - items.length).all<LearningRow>();
  return [...items, ...semantic.results.map(fromRow)];
}

export async function insertLearningItem(db: D1Database, item: NewLearningItem): Promise<LearningItem> {
  const now = new Date().toISOString();
  const result = await db.prepare(`
    INSERT INTO learning_items (
      original_input, context, intended_meaning, confusing_part, normalized_input, main_sentence,
      key_expression, grammar_pattern, explanation, recommendation, recommendation_score,
      recommendation_reason, related_item_id, model, prompt_version, created_at, updated_at
    ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
  `).bind(item.originalInput, item.context, item.intendedMeaning, item.confusingPart, item.normalizedInput,
    item.mainSentence, item.keyExpression, item.grammarPattern, item.explanation, item.recommendation,
    item.recommendationScore, item.recommendationReason, item.relatedItemId, item.model, item.promptVersion,
    now, now).run();
  const id = Number(result.meta.last_row_id);
  await db.prepare(`INSERT INTO learning_items_fts (learning_item_id, original_input, main_sentence, key_expression, grammar_pattern) VALUES (?1,?2,?3,?4,?5)`)
    .bind(id, item.originalInput, item.mainSentence, item.keyExpression, item.grammarPattern).run();
  const created = await getLearningItem(db, id);
  if (!created) throw new Error('D1 did not return the newly created learning item');
  return created;
}

export async function getLearningItem(db: D1Database, id: number): Promise<LearningItem | null> {
  const row = await db.prepare('SELECT * FROM learning_items WHERE id = ?1').bind(id).first<LearningRow>();
  return row ? fromRow(row) : null;
}

export async function markLearningItem(db: D1Database, id: number, decision: LearningDecision, updates: { mainSentence?: string; explanation?: string; nojiNoteId?: string | null } = {}): Promise<LearningItem | null> {
  await db.prepare(`UPDATE learning_items SET user_decision=?1, main_sentence=COALESCE(?2,main_sentence), explanation=COALESCE(?3,explanation), noji_note_id=COALESCE(?4,noji_note_id), updated_at=?5 WHERE id=?6`)
    .bind(decision, updates.mainSentence ?? null, updates.explanation ?? null, updates.nojiNoteId ?? null, new Date().toISOString(), id).run();
  if (updates.mainSentence) {
    await db.prepare('UPDATE learning_items_fts SET main_sentence=?1 WHERE learning_item_id=?2').bind(updates.mainSentence, id).run();
  }
  return getLearningItem(db, id);
}

export async function deleteLearningItem(db: D1Database, id: number): Promise<boolean> {
  await db.prepare('UPDATE learning_items SET related_item_id = NULL WHERE related_item_id = ?1').bind(id).run();
  await db.prepare('DELETE FROM learning_items_fts WHERE learning_item_id = ?1').bind(id).run();
  const result = await db.prepare('DELETE FROM learning_items WHERE id = ?1').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function getDailyStats(db: D1Database): Promise<{ analyzed: number; saved: number; skipped: number }> {
  const rows = await db.prepare(`SELECT created_at,user_decision FROM learning_items WHERE created_at >= datetime('now','-2 days')`).all<{ created_at: string; user_decision: LearningDecision }>();
  const today = learningDateKey();
  const current = rows.results.filter(row => learningDateKey(row.created_at) === today);
  return {
    analyzed: current.length,
    saved: current.filter(row => row.user_decision === 'saved' || row.user_decision === 'edited_then_saved').length,
    skipped: current.filter(row => row.user_decision === 'skipped').length,
  };
}

export type LearningOverview = {
  total: number;
  saved: number;
  skipped: number;
  pending: number;
  thisWeek: number;
};

export async function getLearningOverview(db: D1Database): Promise<LearningOverview> {
  const row = await db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN user_decision IN ('saved','edited_then_saved') THEN 1 ELSE 0 END) AS saved,
      SUM(CASE WHEN user_decision = 'skipped' THEN 1 ELSE 0 END) AS skipped,
      SUM(CASE WHEN user_decision = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN created_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS this_week
    FROM learning_items
  `).first<{ total: number; saved: number; skipped: number; pending: number; this_week: number }>();
  return {
    total: row?.total ?? 0,
    saved: row?.saved ?? 0,
    skipped: row?.skipped ?? 0,
    pending: row?.pending ?? 0,
    thisWeek: row?.this_week ?? 0,
  };
}

export async function listLearningItems(
  db: D1Database,
  options: { query?: string; decision?: LearningDecision; limit?: number } = {},
): Promise<LearningItem[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (options.query?.trim()) {
    conditions.push(`(original_input LIKE ? OR main_sentence LIKE ? OR key_expression LIKE ?)`);
    const pattern = `%${options.query.trim().replace(/[\\%_]/g, '\\$&')}%`;
    values.push(pattern, pattern, pattern);
  }
  if (options.decision) {
    conditions.push('user_decision = ?');
    values.push(options.decision);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db.prepare(`SELECT * FROM learning_items ${where} ORDER BY created_at DESC LIMIT ?`)
    .bind(...values, limit).all<LearningRow>();
  return result.results.map(fromRow);
}
