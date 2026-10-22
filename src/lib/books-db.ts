// Imported books, kept as short text parts (~250 words) so Claude or ChatGPT can be given just enough text
// for the number of phrases the learner asks for, in reading order.
export type BookFormat = 'pdf' | 'epub';
export type BookPart = { id: number; bookId: number; position: number; chapterTitle: string; text: string; bookTitle: string };
export type BookSummary = { id: number; title: string; author: string | null; parts: number; read: number; createdAt: string };

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

// About one phrase worth learning per 100 words of prose, so asking for 10 phrases gives about 1,000 words.
export const WORDS_PER_PHRASE = 100;

// The next unread parts (oldest book first, in reading order), just enough for the phrases asked for.
export async function nextReading(db: D1Database, phrases: number): Promise<BookPart[]> {
  const rows = await db.prepare(`
    SELECT p.id, p.book_id, p.position, p.chapter_title, p.text, p.words, b.title AS book_title FROM book_parts p JOIN books b ON b.id = p.book_id
    WHERE p.status = 'pending' ORDER BY b.created_at, b.id, p.position LIMIT 60
  `).all<{ id: number; book_id: number; position: number; chapter_title: string; text: string; words: number; book_title: string }>();
  const parts: BookPart[] = [];
  let words = 0;
  for (const row of rows.results) {
    if (words >= phrases * WORDS_PER_PHRASE || (parts.length && row.book_id !== parts[0].bookId)) break;
    parts.push({ id: row.id, bookId: row.book_id, position: row.position, chapterTitle: row.chapter_title, text: row.text, bookTitle: row.book_title });
    words += row.words;
  }
  return parts;
}

export async function markPartsRead(db: D1Database, ids: number[]): Promise<void> {
  if (!ids.length) return;
  const update = db.prepare("UPDATE book_parts SET status = 'done', processed_at = ?1 WHERE id = ?2");
  const now = new Date().toISOString();
  await db.batch(ids.map(id => update.bind(now, id)));
}

export async function listBooks(db: D1Database): Promise<BookSummary[]> {
  const rows = await db.prepare(`
    SELECT b.id, b.title, b.author, b.created_at, COUNT(p.id) AS parts,
      SUM(p.status = 'done') AS read
    FROM books b LEFT JOIN book_parts p ON p.book_id = b.id GROUP BY b.id ORDER BY b.created_at DESC
  `).all<{ id: number; title: string; author: string | null; created_at: string; parts: number; read: number | null }>();
  return rows.results.map(row => ({ id: row.id, title: row.title, author: row.author, parts: row.parts, read: row.read ?? 0, createdAt: row.created_at }));
}

// Removes the text and its cards still waiting in Today; learned cards stay.
export async function deleteBook(db: D1Database, id: number): Promise<boolean> {
  await db.prepare("DELETE FROM candidates WHERE status = 'pending' AND part_id IN (SELECT id FROM book_parts WHERE book_id = ?1)").bind(id).run();
  const result = await db.prepare('DELETE FROM books WHERE id = ?1').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}
