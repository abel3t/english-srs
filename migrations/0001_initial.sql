-- The whole schema, from the start. Claude or ChatGPT (through the connector) reads the imported books and
-- writes the cards; the website shows them, runs the typing practice and plays the stories.

-- Imported books, kept as short text parts (~250 words) read in order through the connector.
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
  -- 'done' = given to the connector and its cards saved.
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  processed_at TEXT,
  UNIQUE (book_id, position)
);

CREATE INDEX idx_book_parts_status ON book_parts(status, book_id, position);

-- Cards written through the connector, waiting on Today for "Learn it" or "Skip". A phrase is never suggested
-- twice: decided rows stay (normalized_phrase is unique).
CREATE TABLE candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phrase TEXT NOT NULL,
  normalized_phrase TEXT NOT NULL UNIQUE,
  example TEXT,
  source TEXT,
  -- 'ai' = found in a book, 'capture' = a phrase the learner asked to add.
  kind TEXT NOT NULL CHECK (kind IN ('ai', 'capture')),
  part_id INTEGER REFERENCES book_parts(id) ON DELETE SET NULL,
  -- JSON: front, keyExpression, meaning, explanation, examples, score, reason.
  draft TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'learned', 'dismissed')),
  decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_candidates_status ON candidates(status);
CREATE INDEX idx_candidates_part ON candidates(part_id);

-- The learner's cards and their review schedule (SM-2 style; memorized = interval of 21 days or more).
CREATE TABLE cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phrase TEXT NOT NULL,
  normalized_phrase TEXT NOT NULL,
  explanation TEXT NOT NULL,
  key_expression TEXT NOT NULL DEFAULT '',
  -- JSON array of the sentences to type.
  examples TEXT NOT NULL DEFAULT '[]',
  original_input TEXT,
  context TEXT,
  state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'learning', 'review')),
  due_at TEXT NOT NULL,
  interval_days REAL NOT NULL DEFAULT 0,
  ease REAL NOT NULL DEFAULT 2.5,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_cards_due ON cards(due_at);
CREATE INDEX idx_cards_normalized ON cards(normalized_phrase);
CREATE INDEX idx_cards_created ON cards(created_at);

-- One row per typed item and the confidence the learner chose.
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
  state_before TEXT NOT NULL,
  interval_before REAL NOT NULL,
  interval_after REAL NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  accuracy REAL,
  reviewed_at TEXT NOT NULL
);

CREATE INDEX idx_reviews_card ON reviews(card_id);
CREATE INDEX idx_reviews_reviewed ON reviews(reviewed_at);

-- Stories and conversations written through the connector; audio_key = its audio in R2.
CREATE TABLE stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('story', 'conversation')),
  title TEXT NOT NULL,
  -- JSON array of {speaker: string | null, text: string}
  lines TEXT NOT NULL,
  -- JSON array of the learner's phrases used in it
  phrases TEXT NOT NULL DEFAULT '[]',
  audio_key TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_stories_created ON stories(created_at);

-- API keys set on the Settings page (write-only) and the connector token's hash.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
