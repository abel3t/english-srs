-- Reviews can now be done by listening (dictation) or typing from memory; keep how each review
-- was done and how accurate it was, for progress tracking.
ALTER TABLE reviews ADD COLUMN mode TEXT NOT NULL DEFAULT 'classic' CHECK (mode IN ('classic', 'dictation', 'typing'));
ALTER TABLE reviews ADD COLUMN accuracy REAL;
