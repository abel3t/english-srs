-- Claude or ChatGPT (through the connector) now reads the books and writes the cards; Ollama, the cron job and the
-- in-browser phrase finder are gone. Phrases waiting without a written card are dropped, and every book part
-- becomes unread again so the connector reads it.
DELETE FROM candidates WHERE status = 'pending' AND draft IS NULL;
UPDATE book_parts SET status = 'pending', attempts = 0, error = NULL, processed_at = NULL;
