-- Books are now kept (as text, split into ~1,000-word parts) so a cron job can let the AI go through them part
-- by part, within the Ollama quota. Candidates remember the part they came from and the AI's pick.
CREATE TABLE books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT,
  format TEXT NOT NULL CHECK (format IN ('pdf', 'epub')),
  created_at TEXT NOT NULL
);

CREATE TABLE book_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  chapter_title TEXT NOT NULL,
  text TEXT NOT NULL,
  words INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  processed_at TEXT,
  UNIQUE (book_id, position)
);

CREATE INDEX idx_book_parts_status ON book_parts(status, book_id, position);

ALTER TABLE candidates ADD COLUMN part_id INTEGER REFERENCES book_parts(id) ON DELETE SET NULL;
-- 1..13 = the AI's rank within its part (lower is better); NULL = not picked or not yet reviewed.
ALTER TABLE candidates ADD COLUMN ai_rank INTEGER;
ALTER TABLE candidates ADD COLUMN ai_reason TEXT;

CREATE INDEX idx_candidates_part ON candidates(part_id);
