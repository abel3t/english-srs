-- Candidates now come mostly from the in-browser phrase finder: keep what kind of expression each one is,
-- its difficulty band (0 = built from very common words … 3 = rare words) and score, and the learner's
-- decision, which also feeds the estimate of what they already know.
-- SQLite cannot change a CHECK constraint in place, so the table is rebuilt.
CREATE TABLE candidates_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phrase TEXT NOT NULL,
  normalized_phrase TEXT NOT NULL UNIQUE,
  example TEXT,
  meaning TEXT,
  source TEXT,
  kind TEXT NOT NULL DEFAULT 'capture' CHECK (kind IN ('frame', 'phrasal_verb', 'idiom', 'prep_phrase', 'collocation', 'word', 'ai', 'capture')),
  band INTEGER NOT NULL DEFAULT 1 CHECK (band BETWEEN 0 AND 3),
  score REAL NOT NULL DEFAULT 2.5,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'learning', 'learned', 'known', 'dismissed')),
  decision TEXT CHECK (decision IN ('use', 'recognize', 'new', 'not_useful')),
  decided_at TEXT,
  snoozed_until TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO candidates_new (id, phrase, normalized_phrase, example, meaning, source, kind, status, snoozed_until, created_at)
SELECT id, phrase, normalized_phrase, example, meaning, source,
  CASE WHEN source = 'Chrome extension' THEN 'capture' ELSE 'ai' END, status, snoozed_until, created_at
FROM candidates;

DROP TABLE candidates;
ALTER TABLE candidates_new RENAME TO candidates;
CREATE INDEX idx_candidates_status ON candidates(status, snoozed_until);
CREATE INDEX idx_candidates_score ON candidates(score);

-- "use": the learner recognizes it but wants to start using it (prioritized in speaking practice).
ALTER TABLE cards ADD COLUMN goal TEXT NOT NULL DEFAULT 'understand' CHECK (goal IN ('understand', 'use'));
