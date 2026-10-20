-- Start the learning system from scratch: cards and their review schedule live only in D1
-- (Noji is no longer used), and analysis no longer writes history.
-- Books are never stored; only the phrases extracted from them are kept as candidates.
DROP TABLE IF EXISTS learning_items_fts;
DROP TABLE IF EXISTS learning_items;

CREATE TABLE cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phrase TEXT NOT NULL,
  normalized_phrase TEXT NOT NULL,
  explanation TEXT NOT NULL,
  key_expression TEXT NOT NULL DEFAULT '',
  grammar_pattern TEXT NOT NULL DEFAULT '',
  original_input TEXT,
  context TEXT,
  state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'learning', 'review')),
  due_at TEXT NOT NULL,
  interval_days REAL NOT NULL DEFAULT 0,
  ease REAL NOT NULL DEFAULT 2.5,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_cards_due ON cards(due_at);
CREATE INDEX idx_cards_normalized ON cards(normalized_phrase);
CREATE INDEX idx_cards_created ON cards(created_at);

CREATE VIRTUAL TABLE cards_fts USING fts5(
  card_id UNINDEXED,
  phrase,
  key_expression,
  grammar_pattern,
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
  state_before TEXT NOT NULL,
  interval_before REAL NOT NULL,
  interval_after REAL NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  reviewed_at TEXT NOT NULL
);

CREATE INDEX idx_reviews_card ON reviews(card_id);
CREATE INDEX idx_reviews_reviewed ON reviews(reviewed_at);

-- Phrases worth learning, extracted from books/PDFs or captured by the Chrome extension.
-- The dashboard offers a random pending one; accepting it leads to a full analysis and a card.
CREATE TABLE candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phrase TEXT NOT NULL,
  normalized_phrase TEXT NOT NULL UNIQUE,
  example TEXT,
  meaning TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'learned', 'dismissed')),
  snoozed_until TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_candidates_status ON candidates(status, snoozed_until);
