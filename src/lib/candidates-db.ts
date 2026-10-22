import { MEMORIZED_DAYS } from './cards-db';
import { findPhraseSpan } from './practice';
import { normalizeText } from './text';

// Cards written by Claude or ChatGPT (through the connector), waiting in the learner's Queue for "Learn it",
// "I know it" or "Not useful". `kind`: 'ai' = found in the reading, 'capture' = a phrase the learner asked to add.
// Every function works for one user only.
type CandidateKind = 'ai' | 'capture';
type CandidateStatus = 'pending' | 'learned' | 'dismissed';
export type SkipReason = 'known' | 'not_useful';
// register and usage: missing on cards written before they were asked for.
export type CardDraft = {
  front: string; keyExpression: string; meaning: string; explanation: string; examples: string[]; score: number; reason: string;
  register?: 'formal' | 'neutral' | 'casual' | 'slang'; usage?: string;
};
export type Candidate = {
  id: number; phrase: string; example: string | null; source: string | null; kind: CandidateKind;
  status: CandidateStatus; draft: CardDraft; createdAt: string;
};
// allowSimilar: the connector checked the similar phrases (check_phrases) and this one means something different.
type NewCandidate = { phrase: string; example: string | null; source: string | null; kind: CandidateKind; partId: number | null; draft: CardDraft; allowSimilar?: boolean };

type CandidateRow = Omit<Candidate, 'draft'> & { draft: string };
const COLUMNS = 'id, phrase, example, source, kind, status, draft, createdAt';
const fromRow = (row: CandidateRow): Candidate => ({ ...row, draft: JSON.parse(row.draft) });

// Every phrase the learner has met: their cards (learning or memorized; "I know it" ones are memorized cards),
// cards waiting in the Queue, and skipped ones.
type PhraseStatus = 'learning' | 'memorized' | 'waiting' | 'not useful' | 'skipped';
type KnownPhrase = { phrase: string; keyExpression: string; meaning: string; status: PhraseStatus };

export async function getKnownPhrases(db: D1Database, userId: string): Promise<KnownPhrase[]> {
  const [cards, candidates] = await db.batch<{ phrase: string; keyExpression: string | null; meaning: string | null; status: PhraseStatus }>([
    db.prepare(`SELECT phrase, keyExpression, substr(replace(explanation, '**Meaning**' || char(10), ''), 1, 200) AS meaning,
      CASE WHEN intervalDays >= ?2 THEN 'memorized' ELSE 'learning' END AS status FROM Cards WHERE userId = ?1`).bind(userId, MEMORIZED_DAYS),
    // Learned and "I know it" candidates are cards, listed above.
    db.prepare(`SELECT phrase, json_extract(draft, '$.keyExpression') AS keyExpression, json_extract(draft, '$.meaning') AS meaning,
      CASE WHEN status = 'pending' THEN 'waiting' WHEN skipReason = 'not_useful' THEN 'not useful' ELSE 'skipped' END AS status
      FROM Candidates WHERE userId = ?1 AND (status = 'pending' OR (status = 'dismissed' AND skipReason IS NOT 'known'))`).bind(userId),
  ]);
  return [...cards.results, ...candidates.results].map(row => ({ phrase: row.phrase, keyExpression: row.keyExpression ?? '', meaning: (row.meaning ?? '').split('\n')[0], status: row.status }));
}

// Exact = the same words. Similar = one contains the other's key words, inflections included ("boil down to" in
// "it boils down to"); it may still mean something else, so the connector decides.
type PhraseCheck = { phrase: string; result: 'new' | 'exact' | 'similar'; matches: KnownPhrase[] };

export function checkPhrase(phrase: string, known: KnownPhrase[]): PhraseCheck {
  const normalized = normalizeText(phrase);
  const forms = (entry: KnownPhrase) => [entry.keyExpression, entry.phrase].filter(Boolean);
  const exact = known.filter(entry => forms(entry).some(form => normalizeText(form) === normalized));
  if (exact.length) return { phrase, result: 'exact', matches: exact.slice(0, 5) };
  const similar = known.filter(entry => forms(entry).some(form => findPhraseSpan(form, phrase) || findPhraseSpan(phrase, form)));
  return { phrase, result: similar.length ? 'similar' : 'new', matches: similar.slice(0, 5) };
}

type SaveResult = { saved: string[]; duplicates: string[]; similar: Array<{ phrase: string; similarTo: KnownPhrase[] }> };

// Never saves a phrase the learner already met (exact), nor a similar one unless the connector said it differs.
// Each accepted phrase counts as met for the rest of the batch, so two forms of one phrase are not both saved.
export async function addCandidates(db: D1Database, userId: string, candidates: NewCandidate[]): Promise<SaveResult> {
  const known = await getKnownPhrases(db, userId);
  const result: SaveResult = { saved: [], duplicates: [], similar: [] };
  const accepted = candidates.filter(candidate => {
    const check = checkPhrase(candidate.phrase, known);
    if (check.result === 'exact' || !normalizeText(candidate.phrase)) result.duplicates.push(candidate.phrase);
    else if (check.result === 'similar' && !candidate.allowSimilar) result.similar.push({ phrase: candidate.phrase, similarTo: check.matches });
    else {
      known.push({ phrase: candidate.phrase, keyExpression: candidate.draft.keyExpression, meaning: candidate.draft.meaning, status: 'waiting' });
      return true;
    }
    return false;
  });
  if (!accepted.length) return result;
  // The unique (userId, normalizedPhrase) index still guards against two saves running at once.
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO Candidates (userId, phrase, normalizedPhrase, example, source, kind, partId, draft, createdAt)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT (userId, normalizedPhrase) DO NOTHING
  `);
  const results = await db.batch(accepted.map(candidate => insert.bind(
    userId, candidate.phrase, normalizeText(candidate.phrase), candidate.example, candidate.source, candidate.kind, candidate.partId, JSON.stringify(candidate.draft), now)));
  accepted.forEach((candidate, index) => ((results[index].meta.changes ?? 0) > 0 ? result.saved : result.duplicates).push(candidate.phrase));
  return result;
}

// What the learner's skips say about them, for the connector: phrases they already knew, and ones not worth it.
export async function getSkipFeedback(db: D1Database, userId: string, limit = 30): Promise<{ alreadyKnew: string[]; notUseful: string[] }> {
  const recent = (reason: SkipReason) => db.prepare("SELECT phrase FROM Candidates WHERE userId = ?1 AND status = 'dismissed' AND skipReason = ?2 ORDER BY decidedAt DESC LIMIT ?3").bind(userId, reason, limit);
  const [known, notUseful] = await db.batch<{ phrase: string }>([recent('known'), recent('not_useful')]);
  return { alreadyKnew: known.results.map(row => row.phrase), notUseful: notUseful.results.map(row => row.phrase) };
}

// The queue: waiting cards in the order they were written (reading order for documents), oldest first.
export async function getReadyCandidates(db: D1Database, userId: string, limit: number): Promise<Candidate[]> {
  const result = await db.prepare(`SELECT ${COLUMNS} FROM Candidates WHERE userId = ?1 AND status = 'pending' ORDER BY id LIMIT ?2`).bind(userId, limit).all<CandidateRow>();
  return result.results.map(fromRow);
}

export async function countPending(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM Candidates WHERE userId = ?1 AND status = 'pending'").bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getCandidate(db: D1Database, userId: string, id: number): Promise<Candidate | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM Candidates WHERE id = ?1 AND userId = ?2`).bind(id, userId).first<CandidateRow>();
  return row ? fromRow(row) : null;
}

// Decides a waiting card in one step, so a double click or a second tab can never decide it twice.
// False when it is not waiting (already decided, or not this user's).
export async function decideCandidate(db: D1Database, userId: string, id: number, status: 'learned' | 'dismissed', skipReason: SkipReason | null = null): Promise<boolean> {
  const result = await db.prepare("UPDATE Candidates SET status = ?1, skipReason = ?2, decidedAt = ?3 WHERE id = ?4 AND userId = ?5 AND status = 'pending'")
    .bind(status, skipReason, new Date().toISOString(), id, userId).run();
  return (result.meta.changes ?? 0) > 0;
}

// Undoes decideCandidate when what followed it failed, so the card waits in the Queue again.
export async function reopenCandidate(db: D1Database, userId: string, id: number): Promise<void> {
  await db.prepare("UPDATE Candidates SET status = 'pending', skipReason = NULL, decidedAt = NULL WHERE id = ?1 AND userId = ?2").bind(id, userId).run();
}
