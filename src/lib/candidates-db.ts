import { normalizeText } from './text';

export type CandidateKind = 'frame' | 'phrasal_verb' | 'idiom' | 'prep_phrase' | 'collocation' | 'word' | 'ai' | 'capture';
export type CandidateStatus = 'pending' | 'learned' | 'dismissed';
export type Candidate = {
  id: number; phrase: string; example: string | null; meaning: string | null; source: string | null;
  kind: CandidateKind; band: number; score: number; status: CandidateStatus; createdAt: string;
};
export type NewCandidate = { phrase: string; example?: string | null; meaning?: string | null; source?: string | null; kind: CandidateKind; band?: number; score?: number };

type CandidateRow = {
  id: number; phrase: string; example: string | null; meaning: string | null; source: string | null; kind: CandidateKind;
  band: number; score: number; status: CandidateStatus; created_at: string;
};
const fromRow = (row: CandidateRow): Candidate => ({
  id: row.id, phrase: row.phrase, example: row.example, meaning: row.meaning, source: row.source, kind: row.kind,
  band: row.band, score: row.score, status: row.status, createdAt: row.created_at,
});

// Skips phrases that are already candidates (any status) or already saved as cards.
export async function addCandidates(db: D1Database, candidates: NewCandidate[]): Promise<number> {
  const unique = [...new Map(candidates.map(candidate => [normalizeText(candidate.phrase), candidate])).entries()].filter(([normalized]) => normalized);
  if (!unique.length) return 0;
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO candidates (phrase, normalized_phrase, example, meaning, source, kind, band, score, created_at)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE NOT EXISTS (SELECT 1 FROM cards WHERE normalized_phrase = ?2)
    ON CONFLICT (normalized_phrase) DO NOTHING
  `);
  const results = await db.batch(unique.map(([normalized, candidate]) => insert.bind(
    candidate.phrase, normalized, candidate.example ?? null, candidate.meaning ?? null, candidate.source ?? null,
    candidate.kind, candidate.band ?? 1, candidate.score ?? 2.5, now)));
  return results.reduce((total, result) => total + (result.meta.changes ?? 0), 0);
}

export async function getCandidate(db: D1Database, id: number): Promise<Candidate | null> {
  const row = await db.prepare('SELECT * FROM candidates WHERE id = ?1').bind(id).first<CandidateRow>();
  return row ? fromRow(row) : null;
}

// Today's suggestions: the best-scored phrases not yet learned or skipped.
export async function getSuggestions(db: D1Database, limit = 10): Promise<Candidate[]> {
  const result = await db.prepare("SELECT * FROM candidates WHERE status = 'pending' ORDER BY score DESC, id LIMIT ?1").bind(limit).all<CandidateRow>();
  return result.results.map(fromRow);
}

export async function countPending(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM candidates WHERE status = 'pending'").first<{ n: number }>();
  return row?.n ?? 0;
}

export async function setCandidateStatus(db: D1Database, id: number, status: 'pending' | 'learned' | 'dismissed'): Promise<boolean> {
  const result = await db.prepare('UPDATE candidates SET status = ?1, decided_at = ?2 WHERE id = ?3').bind(status, new Date().toISOString(), id).run();
  return (result.meta.changes ?? 0) > 0;
}
