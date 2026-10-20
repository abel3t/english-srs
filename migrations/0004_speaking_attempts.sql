-- Speaking drill: each recorded answer with its transcript and coach feedback. Attempts on the same
-- question share a session_id so a retry can be compared with the first try. Audio lives in R2.
CREATE TABLE speaking_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  question TEXT NOT NULL,
  target_phrases TEXT NOT NULL DEFAULT '[]',
  duration_seconds REAL NOT NULL,
  transcript TEXT NOT NULL,
  feedback TEXT NOT NULL,
  audio_key TEXT,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, attempt)
);

CREATE INDEX idx_speaking_created ON speaking_attempts(created_at);
