// Imported books, kept as ~1,000-word parts so the cron job can let the AI review them one part at a time.
export type BookFormat = 'pdf' | 'epub';
export type BookPart = { id: number; bookId: number; position: number; chapterTitle: string; text: string; bookTitle: string };
export type BookSummary = { id: number; title: string; author: string | null; parts: number; done: number; failed: number; createdAt: string };

export async function createBook(db: D1Database, book: { title: string; author: string | null; format: BookFormat }): Promise<number> {
  const row = await db.prepare('INSERT INTO books (title, author, format, created_at) VALUES (?1,?2,?3,?4) RETURNING id')
    .bind(book.title, book.author, book.format, new Date().toISOString()).first<{ id: number }>();
  if (!row) throw new Error('D1 did not return the new book');
  return row.id;
}

// Parts arrive in small batches so no single request has to parse a whole book (Workers CPU limits).
export async function addParts(db: D1Database, bookId: number, parts: Array<{ position: number; chapterTitle: string; text: string; words: number }>): Promise<void> {
  const insert = db.prepare('INSERT INTO book_parts (book_id, position, chapter_title, text, words) VALUES (?1,?2,?3,?4,?5) ON CONFLICT (book_id, position) DO NOTHING');
  await db.batch(parts.map(part => insert.bind(bookId, part.position, part.chapterTitle, part.text, part.words)));
}

export async function partIdsByPosition(db: D1Database, bookId: number): Promise<Map<number, number>> {
  const rows = await db.prepare('SELECT id, position FROM book_parts WHERE book_id = ?1').bind(bookId).all<{ id: number; position: number }>();
  return new Map(rows.results.map(row => [row.position, row.id]));
}

// Oldest book first, in reading order; parts that failed three times are left alone.
export async function nextPendingParts(db: D1Database, limit: number): Promise<BookPart[]> {
  const rows = await db.prepare(`
    SELECT p.id, p.book_id, p.position, p.chapter_title, p.text, b.title AS book_title FROM book_parts p JOIN books b ON b.id = p.book_id
    WHERE p.status = 'pending' AND p.attempts < 3 ORDER BY b.created_at, p.position LIMIT ?1
  `).bind(limit).all<{ id: number; book_id: number; position: number; chapter_title: string; text: string; book_title: string }>();
  return rows.results.map(row => ({ id: row.id, bookId: row.book_id, position: row.position, chapterTitle: row.chapter_title, text: row.text, bookTitle: row.book_title }));
}

export async function markPartDone(db: D1Database, id: number): Promise<void> {
  await db.prepare("UPDATE book_parts SET status = 'done', error = NULL, processed_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), id).run();
}

export async function markPartFailed(db: D1Database, id: number, error: string): Promise<void> {
  await db.prepare("UPDATE book_parts SET attempts = attempts + 1, error = ?1, status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'pending' END WHERE id = ?2")
    .bind(error.slice(0, 500), id).run();
}

export async function listBooks(db: D1Database): Promise<BookSummary[]> {
  const rows = await db.prepare(`
    SELECT b.id, b.title, b.author, b.created_at, COUNT(p.id) AS parts,
      SUM(p.status = 'done') AS done, SUM(p.status = 'failed') AS failed
    FROM books b LEFT JOIN book_parts p ON p.book_id = b.id GROUP BY b.id ORDER BY b.created_at DESC
  `).all<{ id: number; title: string; author: string | null; created_at: string; parts: number; done: number | null; failed: number | null }>();
  return rows.results.map(row => ({ id: row.id, title: row.title, author: row.author, parts: row.parts, done: row.done ?? 0, failed: row.failed ?? 0, createdAt: row.created_at }));
}

// Removes the text and the phrases still waiting to be suggested; learned cards stay.
export async function deleteBook(db: D1Database, id: number): Promise<boolean> {
  await db.prepare("DELETE FROM candidates WHERE status = 'pending' AND part_id IN (SELECT id FROM book_parts WHERE book_id = ?1)").bind(id).run();
  const result = await db.prepare('DELETE FROM books WHERE id = ?1').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}
