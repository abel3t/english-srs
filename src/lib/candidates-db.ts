import { normalizeText } from './text';

// Cards written by Claude or ChatGPT (through the connector), waiting on Today for the learner to choose
// "Learn it" or "Skip". `kind`: 'ai' = found in a book, 'capture' = a phrase the learner asked to add.
export type CandidateKind = 'ai' | 'capture';
export type CandidateStatus = 'pending' | 'learned' | 'dismissed';
export type CardDraft = { front: string; keyExpression: string; meaning: string; explanation: string; examples: string[]; score: number; reason: string };
export type Candidate = {
  id: number; phrase: string; example: string | null; source: string | null; kind: CandidateKind;
  status: CandidateStatus; draft: CardDraft; createdAt: string;
};
export type NewCandidate = { phrase: string; example: string | null; source: string | null; kind: CandidateKind; partId: number | null; draft: CardDraft };

type CandidateRow = {
  id: number; phrase: string; example: string | null; source: string | null; kind: CandidateKind;
  status: CandidateStatus; draft: string; created_at: string;
};
const fromRow = (row: CandidateRow): Candidate => ({
  id: row.id, phrase: row.phrase, example: row.example, source: row.source, kind: row.kind,
  status: row.status, draft: JSON.parse(row.draft), createdAt: row.created_at,
});

// Skips phrases that are already waiting (or were decided before) or already saved as cards.
// Returns the phrases that were saved.
export async function addCandidates(db: D1Database, candidates: NewCandidate[]): Promise<string[]> {
  const unique = [...new Map(candidates.map(candidate => [normalizeText(candidate.phrase), candidate])).entries()].filter(([normalized]) => normalized);
  if (!unique.length) return [];
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO candidates (phrase, normalized_phrase, example, source, kind, part_id, draft, created_at)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE NOT EXISTS (SELECT 1 FROM cards WHERE normalized_phrase = ?2)
    ON CONFLICT (normalized_phrase) DO NOTHING
  `);
  const results = await db.batch(unique.map(([normalized, candidate]) => insert.bind(
    candidate.phrase, normalized, candidate.example, candidate.source, candidate.kind, candidate.partId, JSON.stringify(candidate.draft), now)));
  return unique.filter((_, index) => (results[index].meta.changes ?? 0) > 0).map(([, candidate]) => candidate.phrase);
}

// Waiting cards in the order they were written (reading order for books).
export async function getReadyCandidates(db: D1Database): Promise<Candidate[]> {
  const result = await db.prepare("SELECT * FROM candidates WHERE status = 'pending' AND draft IS NOT NULL ORDER BY id").all<CandidateRow>();
  return result.results.map(fromRow);
}

export async function countPending(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM candidates WHERE status = 'pending' AND draft IS NOT NULL").first<{ n: number }>();
  return row?.n ?? 0;
}

export async function setCandidateStatus(db: D1Database, id: number, status: 'pending' | 'learned' | 'dismissed'): Promise<boolean> {
  const result = await db.prepare('UPDATE candidates SET status = ?1, decided_at = ?2 WHERE id = ?3').bind(status, new Date().toISOString(), id).run();
  return (result.meta.changes ?? 0) > 0;
}
