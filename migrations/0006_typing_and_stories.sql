-- Simplified learning loop: phrases are reviewed by typing (the learner rates their confidence after each
-- item), each card carries example sentences to type, and stories/conversations are created on request.
ALTER TABLE cards ADD COLUMN examples TEXT NOT NULL DEFAULT '[]';
ALTER TABLE cards DROP COLUMN goal;

CREATE TABLE stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('story', 'conversation')),
  title TEXT NOT NULL,
  -- JSON array of {speaker: string | null, text: string}
  lines TEXT NOT NULL,
  -- JSON array of the phrases woven into it
  phrases TEXT NOT NULL DEFAULT '[]',
  audio_key TEXT,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_stories_created ON stories(created_at);

-- The speaking drill was removed.
DROP TABLE IF EXISTS speaking_attempts;
