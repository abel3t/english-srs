CREATE TABLE IF NOT EXISTS learning_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_input TEXT NOT NULL,
  context TEXT,
  intended_meaning TEXT,
  confusing_part TEXT,
  normalized_input TEXT NOT NULL,
  main_sentence TEXT NOT NULL,
  key_expression TEXT NOT NULL DEFAULT '',
  grammar_pattern TEXT NOT NULL DEFAULT '',
  explanation TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  recommendation_score INTEGER NOT NULL,
  recommendation_reason TEXT NOT NULL,
  user_decision TEXT NOT NULL DEFAULT 'pending',
  related_item_id INTEGER,
  noji_note_id TEXT,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (related_item_id) REFERENCES learning_items(id)
);

CREATE INDEX IF NOT EXISTS idx_learning_items_normalized ON learning_items(normalized_input);
CREATE INDEX IF NOT EXISTS idx_learning_items_created ON learning_items(created_at);
CREATE INDEX IF NOT EXISTS idx_learning_items_key_expression ON learning_items(key_expression);

CREATE VIRTUAL TABLE IF NOT EXISTS learning_items_fts USING fts5(
  learning_item_id UNINDEXED,
  original_input,
  main_sentence,
  key_expression,
  grammar_pattern,
  tokenize='unicode61 remove_diacritics 2'
);
