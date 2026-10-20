import { normalizeText } from './text';

export type CandidateStatus = 'pending' | 'learned' | 'dismissed';
export type Candidate = { id: number; phrase: string; example: string | null; meaning: string | null; source: string | null; status: CandidateStatus; createdAt: string };
export type NewCandidate = { phrase: string; example?: string | null; meaning?: string | null; source?: string | null };

type CandidateRow = { id: number; phrase: string; example: string | null; meaning: string | null; source: string | null; status: CandidateStatus; created_at: string };
const fromRow = (row: CandidateRow): Candidate => ({
  id: row.id, phrase: row.phrase, example: row.example, meaning: row.meaning, source: row.source, status: row.status, createdAt: row.created_at,
});

// Skips phrases that are already candidates (any status) or already saved as cards.
export async function addCandidates(db: D1Database, candidates: NewCandidate[]): Promise<number> {
  const unique = [...new Map(candidates.map(candidate => [normalizeText(candidate.phrase), candidate])).entries()].filter(([normalized]) => normalized);
  if (!unique.length) return 0;
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO candidates (phrase, normalized_phrase, example, meaning, source, created_at)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE NOT EXISTS (SELECT 1 FROM cards WHERE normalized_phrase = ?2)
    ON CONFLICT (normalized_phrase) DO NOTHING
  `);
  const results = await db.batch(unique.map(([normalized, candidate]) =>
    insert.bind(candidate.phrase, normalized, candidate.example ?? null, candidate.meaning ?? null, candidate.source ?? null, now)));
  return results.reduce((total, result) => total + (result.meta.changes ?? 0), 0);
}

export async function getCandidate(db: D1Database, id: number): Promise<Candidate | null> {
  const row = await db.prepare('SELECT * FROM candidates WHERE id = ?1').bind(id).first<CandidateRow>();
  return row ? fromRow(row) : null;
}

export async function getRandomCandidate(db: D1Database): Promise<Candidate | null> {
  const row = await db.prepare(`
    SELECT * FROM candidates WHERE status = 'pending' AND (snoozed_until IS NULL OR snoozed_until <= ?1)
    ORDER BY RANDOM() LIMIT 1
  `).bind(new Date().toISOString()).first<CandidateRow>();
  return row ? fromRow(row) : null;
}

export async function listCandidates(db: D1Database, limit = 100): Promise<Candidate[]> {
  const result = await db.prepare("SELECT * FROM candidates WHERE status = 'pending' ORDER BY created_at DESC LIMIT ?1").bind(limit).all<CandidateRow>();
  return result.results.map(fromRow);
}

export async function setCandidateStatus(db: D1Database, id: number, status: CandidateStatus): Promise<boolean> {
  const result = await db.prepare('UPDATE candidates SET status = ?1, snoozed_until = NULL WHERE id = ?2').bind(status, id).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function snoozeCandidate(db: D1Database, id: number, days = 3): Promise<boolean> {
  const until = new Date(Date.now() + days * 86_400_000).toISOString();
  const result = await db.prepare("UPDATE candidates SET snoozed_until = ?1 WHERE id = ?2 AND status = 'pending'").bind(until, id).run();
  return (result.meta.changes ?? 0) > 0;
}
