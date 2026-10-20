import { normalizeText } from './text';

export type CandidateKind = 'frame' | 'phrasal_verb' | 'idiom' | 'prep_phrase' | 'collocation' | 'word' | 'ai' | 'capture';
export type CandidateStatus = 'pending' | 'learning' | 'learned' | 'known' | 'dismissed';
export type Decision = 'use' | 'recognize' | 'new' | 'not_useful';
export type Candidate = {
  id: number; phrase: string; example: string | null; meaning: string | null; source: string | null;
  kind: CandidateKind; band: number; score: number; status: CandidateStatus; decision: Decision | null; createdAt: string;
};
export type NewCandidate = { phrase: string; example?: string | null; meaning?: string | null; source?: string | null; kind: CandidateKind; band?: number; score?: number };

type CandidateRow = {
  id: number; phrase: string; example: string | null; meaning: string | null; source: string | null; kind: CandidateKind;
  band: number; score: number; status: CandidateStatus; decision: Decision | null; created_at: string;
};
const fromRow = (row: CandidateRow): Candidate => ({
  id: row.id, phrase: row.phrase, example: row.example, meaning: row.meaning, source: row.source, kind: row.kind,
  band: row.band, score: row.score, status: row.status, decision: row.decision, createdAt: row.created_at,
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

// ---------- what the learner already knows ----------

// Starting guess that a phrase in each band is already in active use, before any decisions.
const BAND_PRIOR = [0.6, 0.4, 0.25, 0.15];
const BAND_LABELS = ['Very common words', 'Common words', 'Advanced words', 'Rare words'];
type Counts = { use: number; total: number };
export type KnowledgeModel = { probability: (kind: CandidateKind, band: number) => number; bands: Array<{ label: string; estimate: number; decisions: number }> };

// "I use it" counts as known; "recognize" and "new" as not yet in active use. Evidence is pooled per band
// across kinds, so a few decisions are enough to start adjusting.
export async function getKnowledgeModel(db: D1Database): Promise<KnowledgeModel> {
  const rows = await db.prepare(`
    SELECT kind, band, SUM(decision = 'use') AS use, COUNT(*) AS total FROM candidates
    WHERE decision IN ('use', 'recognize', 'new') GROUP BY kind, band
  `).all<{ kind: CandidateKind; band: number; use: number; total: number }>();
  const byKindBand = new Map<string, Counts>();
  const byBand: Counts[] = BAND_PRIOR.map(() => ({ use: 0, total: 0 }));
  for (const row of rows.results) {
    byKindBand.set(`${row.kind}:${row.band}`, { use: row.use, total: row.total });
    byBand[row.band].use += row.use; byBand[row.band].total += row.total;
  }
  const probability = (kind: CandidateKind, band: number) => {
    const own = byKindBand.get(`${kind}:${band}`) ?? { use: 0, total: 0 };
    const pooled = byBand[band] ?? { use: 0, total: 0 };
    return (own.use + 0.5 * pooled.use + 2 * BAND_PRIOR[band]) / (own.total + 0.5 * pooled.total + 2);
  };
  return {
    probability,
    bands: BAND_PRIOR.map((prior, band) => ({ label: BAND_LABELS[band], decisions: byBand[band].total, estimate: (byBand[band].use + 2 * prior) / (byBand[band].total + 2) })),
  };
}

// Best phrases first, discounted by how likely the learner already uses them.
export async function getSortQueue(db: D1Database, limit = 12): Promise<Array<Candidate & { knownChance: number }>> {
  const [model, rows] = await Promise.all([
    getKnowledgeModel(db),
    db.prepare(`SELECT * FROM candidates WHERE status = 'pending' AND (snoozed_until IS NULL OR snoozed_until <= ?1) ORDER BY score DESC LIMIT 300`)
      .bind(new Date().toISOString()).all<CandidateRow>(),
  ]);
  return rows.results.map(fromRow)
    .map(candidate => ({ ...candidate, knownChance: model.probability(candidate.kind, candidate.band) }))
    .sort((a, b) => b.score * (1 - b.knownChance) - a.score * (1 - a.knownChance))
    .slice(0, limit);
}

// The dashboard asks about one of the five best, so it does not always show the same phrase.
export async function getOfferedCandidate(db: D1Database): Promise<Candidate | null> {
  const queue = await getSortQueue(db, 5);
  return queue.length ? queue[Math.floor(Math.random() * queue.length)] : null;
}

export async function listQueuedToLearn(db: D1Database, limit = 50): Promise<Candidate[]> {
  const result = await db.prepare("SELECT * FROM candidates WHERE status = 'learning' ORDER BY decided_at DESC LIMIT ?1").bind(limit).all<CandidateRow>();
  return result.results.map(fromRow);
}

export async function countCandidates(db: D1Database): Promise<{ pending: number; learning: number; known: number }> {
  const row = await db.prepare(`
    SELECT SUM(status = 'pending') AS pending, SUM(status = 'learning') AS learning, SUM(status = 'known') AS known FROM candidates
  `).first<{ pending: number | null; learning: number | null; known: number | null }>();
  return { pending: row?.pending ?? 0, learning: row?.learning ?? 0, known: row?.known ?? 0 };
}

const STATUS_FOR: Record<Decision, CandidateStatus> = { use: 'known', recognize: 'learned', new: 'learning', not_useful: 'dismissed' };

export async function decideCandidate(db: D1Database, id: number, decision: Decision): Promise<boolean> {
  const result = await db.prepare("UPDATE candidates SET decision = ?1, status = ?2, decided_at = ?3, snoozed_until = NULL WHERE id = ?4 AND status IN ('pending', 'learning')")
    .bind(decision, STATUS_FOR[decision], new Date().toISOString(), id).run();
  return (result.meta.changes ?? 0) > 0;
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
