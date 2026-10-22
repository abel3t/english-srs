import type { Analysis } from './learning-analysis';
import { normalizeText, startOfLearningDay } from './text';

export type CandidateKind = 'frame' | 'phrasal_verb' | 'idiom' | 'prep_phrase' | 'collocation' | 'word' | 'ai' | 'capture';
export type CandidateStatus = 'pending' | 'learned' | 'dismissed';
export type Candidate = {
  id: number; phrase: string; example: string | null; meaning: string | null; source: string | null;
  kind: CandidateKind; band: number; score: number; status: CandidateStatus; aiRank: number | null; aiReason: string | null; createdAt: string;
  // A card written ahead of time through the connector (Claude or ChatGPT); Learn opens it without a preview.
  draft: Analysis | null;
};
export type NewCandidate = { phrase: string; example?: string | null; meaning?: string | null; source?: string | null; kind: CandidateKind; band?: number; score?: number; partId?: number | null; aiRank?: number | null; aiReason?: string | null };

type CandidateRow = {
  id: number; phrase: string; example: string | null; meaning: string | null; source: string | null; kind: CandidateKind;
  band: number; score: number; status: CandidateStatus; ai_rank: number | null; ai_reason: string | null; created_at: string; draft: string | null;
};
const fromRow = (row: CandidateRow): Candidate => ({
  id: row.id, phrase: row.phrase, example: row.example, meaning: row.meaning, source: row.source, kind: row.kind,
  band: row.band, score: row.score, status: row.status, aiRank: row.ai_rank, aiReason: row.ai_reason, createdAt: row.created_at, draft: row.draft ? JSON.parse(row.draft) : null,
});

// Skips phrases that are already candidates (any status) or already saved as cards.
export async function addCandidates(db: D1Database, candidates: NewCandidate[]): Promise<number> {
  const unique = [...new Map(candidates.map(candidate => [normalizeText(candidate.phrase), candidate])).entries()].filter(([normalized]) => normalized);
  if (!unique.length) return 0;
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO candidates (phrase, normalized_phrase, example, meaning, source, kind, band, score, created_at, part_id, ai_rank, ai_reason)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12 WHERE NOT EXISTS (SELECT 1 FROM cards WHERE normalized_phrase = ?2)
    ON CONFLICT (normalized_phrase) DO NOTHING
  `);
  const results = await db.batch(unique.map(([normalized, candidate]) => insert.bind(
    candidate.phrase, normalized, candidate.example ?? null, candidate.meaning ?? null, candidate.source ?? null,
    candidate.kind, candidate.band ?? 1, candidate.score ?? 2.5, now, candidate.partId ?? null, candidate.aiRank ?? null, candidate.aiReason ?? null)));
  return results.reduce((total, result) => total + (result.meta.changes ?? 0), 0);
}

export async function getCandidate(db: D1Database, id: number): Promise<Candidate | null> {
  const row = await db.prepare('SELECT * FROM candidates WHERE id = ?1').bind(id).first<CandidateRow>();
  return row ? fromRow(row) : null;
}

export const DAILY_SUGGESTIONS = 10;

// Today's suggestions: at most 10 a day. Each phrase learned or skipped today uses one, so the list does not
// refill until tomorrow (the learner's day starts at 00:00 Vietnam time).
export async function getSuggestions(db: D1Database): Promise<{ suggestions: Candidate[]; handledToday: number }> {
  const handled = await db.prepare("SELECT COUNT(*) AS n FROM candidates WHERE status IN ('learned', 'dismissed') AND decided_at >= ?1")
    .bind(startOfLearningDay()).first<{ n: number }>();
  const handledToday = handled?.n ?? 0;
  const remaining = Math.max(0, DAILY_SUGGESTIONS - handledToday);
  if (!remaining) return { suggestions: [], handledToday };
  // AI picks first (in reading order, best first within a part); then phrases from parts the AI has not reviewed
  // yet (code ranking); phrases the AI reviewed and passed over come last.
  const result = await db.prepare(`
    SELECT c.* FROM candidates c LEFT JOIN book_parts p ON p.id = c.part_id
    WHERE c.status = 'pending'
    ORDER BY CASE WHEN c.ai_rank IS NOT NULL THEN 0 WHEN p.status IS NULL OR p.status != 'done' THEN 1 ELSE 2 END,
      p.book_id, p.position, c.ai_rank, c.score DESC, c.id
    LIMIT ?1
  `).bind(remaining).all<CandidateRow>();
  return { suggestions: result.results.map(fromRow), handledToday };
}

export async function countPending(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM candidates WHERE status = 'pending'").first<{ n: number }>();
  return row?.n ?? 0;
}

export async function setCandidateStatus(db: D1Database, id: number, status: 'pending' | 'learned' | 'dismissed'): Promise<boolean> {
  const result = await db.prepare('UPDATE candidates SET status = ?1, decided_at = ?2 WHERE id = ?3').bind(status, new Date().toISOString(), id).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function pendingCandidatesForPart(db: D1Database, partId: number): Promise<Candidate[]> {
  const result = await db.prepare("SELECT * FROM candidates WHERE part_id = ?1 AND status = 'pending' ORDER BY score DESC LIMIT 60").bind(partId).all<CandidateRow>();
  return result.results.map(fromRow);
}

export async function setAiPicks(db: D1Database, picks: Array<{ id: number; rank: number; reason: string | null }>): Promise<void> {
  if (!picks.length) return;
  const update = db.prepare('UPDATE candidates SET ai_rank = ?1, ai_reason = ?2 WHERE id = ?3');
  await db.batch(picks.map(pick => update.bind(pick.rank, pick.reason, pick.id)));
}

export async function setCandidateDraft(db: D1Database, id: number, draft: Analysis): Promise<boolean> {
  const result = await db.prepare("UPDATE candidates SET draft = ?1 WHERE id = ?2 AND status = 'pending'").bind(JSON.stringify(draft), id).run();
  return (result.meta.changes ?? 0) > 0;
}
