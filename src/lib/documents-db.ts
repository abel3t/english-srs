// Imported reading (books, documents, pasted text), kept as short text parts (~250 words) so Claude or ChatGPT can
// be given one short passage at a time, in reading order. Every function works for one user only.
export const DOCUMENT_FORMATS = ['pdf', 'epub', 'docx', 'text'] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];
type DocumentPart = { id: number; documentId: number; position: number; chapterTitle: string; text: string; words: number; documentTitle: string };
export type DocumentSummary = {
  id: number; title: string; author: string | null; format: DocumentFormat; parts: number; read: number; words: number; createdAt: string;
};

export async function createDocument(db: D1Database, userId: string, document: { title: string; author: string | null; format: DocumentFormat }): Promise<number> {
  const row = await db.prepare('INSERT INTO Documents (userId, title, author, format, createdAt) VALUES (?1,?2,?3,?4,?5) RETURNING id')
    .bind(userId, document.title, document.author, document.format, new Date().toISOString()).first<{ id: number }>();
  if (!row) throw new Error('D1 did not return the new document');
  return row.id;
}

// Parts arrive in small batches so no single request has to parse a whole book (Workers CPU limits).
// False when the document is not this user's.
export async function addParts(db: D1Database, userId: string, documentId: number, parts: Array<{ position: number; chapterTitle: string; text: string; words: number }>): Promise<boolean> {
  if (!await db.prepare('SELECT 1 FROM Documents WHERE id = ?1 AND userId = ?2').bind(documentId, userId).first()) return false;
  const insert = db.prepare('INSERT INTO DocumentParts (documentId, position, chapterTitle, text, words) VALUES (?1,?2,?3,?4,?5) ON CONFLICT (documentId, position) DO NOTHING');
  await db.batch(parts.map(part => insert.bind(documentId, part.position, part.chapterTitle, part.text, part.words)));
  return true;
}

// The connector reads one short passage at a time, closely, and asks for the next one only when it needs more phrases:
// a passage is read once, so it is small enough to be read thoroughly.
const PASSAGE_WORDS = 200;

// The next unread passage: parts of one document (oldest first, in reading order) until it has PASSAGE_WORDS words.
export async function nextReading(db: D1Database, userId: string): Promise<DocumentPart[]> {
  const rows = await db.prepare(`
    SELECT p.id, p.documentId, p.position, p.chapterTitle, p.text, p.words, d.title AS documentTitle FROM DocumentParts p JOIN Documents d ON d.id = p.documentId
    WHERE d.userId = ?1 AND p.status = 'pending' ORDER BY d.createdAt, d.id, p.position LIMIT 10
  `).bind(userId).all<DocumentPart>();
  const parts: DocumentPart[] = [];
  let words = 0;
  for (const row of rows.results) {
    if (words >= PASSAGE_WORDS || (parts.length && row.documentId !== parts[0].documentId)) break;
    parts.push(row);
    words += row.words;
  }
  return parts;
}

export async function countUnreadWords(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare("SELECT COALESCE(SUM(p.words), 0) AS n FROM DocumentParts p JOIN Documents d ON d.id = p.documentId WHERE d.userId = ?1 AND p.status = 'pending'")
    .bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

// The user's parts among these ids, with their document's title (save_cards links each card to its part).
export async function getParts(db: D1Database, userId: string, ids: number[]): Promise<Array<{ id: number; text: string; title: string }>> {
  if (!ids.length) return [];
  const result = await db.prepare(`SELECT p.id, p.text, d.title FROM DocumentParts p JOIN Documents d ON d.id = p.documentId WHERE d.userId = ? AND p.id IN (${ids.map(() => '?').join(',')})`)
    .bind(userId, ...ids).all<{ id: number; text: string; title: string }>();
  return result.results;
}

export async function markPartsRead(db: D1Database, userId: string, ids: number[]): Promise<void> {
  if (!ids.length) return;
  const update = db.prepare("UPDATE DocumentParts SET status = 'done', processedAt = ?1 WHERE id = ?2 AND documentId IN (SELECT id FROM Documents WHERE userId = ?3)");
  const now = new Date().toISOString();
  await db.batch(ids.map(id => update.bind(now, id, userId)));
}

// Newest first, one page at a time, with how far Claude or ChatGPT has read each one.
export async function listDocuments(db: D1Database, userId: string, page: { limit: number; offset: number }): Promise<{ documents: DocumentSummary[]; total: number }> {
  const [rows, count] = await db.batch<Record<string, unknown>>([
    db.prepare(`
      SELECT d.id, d.title, d.author, d.format, d.createdAt, COUNT(p.id) AS parts, COALESCE(SUM(p.status = 'done'), 0) AS read, COALESCE(SUM(p.words), 0) AS words
      FROM Documents d LEFT JOIN DocumentParts p ON p.documentId = d.id WHERE d.userId = ?1 GROUP BY d.id ORDER BY d.createdAt DESC, d.id DESC LIMIT ?2 OFFSET ?3
    `).bind(userId, page.limit, page.offset),
    db.prepare('SELECT COUNT(*) AS n FROM Documents WHERE userId = ?1').bind(userId),
  ]);
  return { documents: rows.results as DocumentSummary[], total: Number((count.results[0] as { n: number } | undefined)?.n ?? 0) };
}

// A quick look at a document: its first part and the part Claude or ChatGPT reads next.
export type DocumentPreview = { start: { chapterTitle: string; text: string } | null; next: { chapterTitle: string; text: string } | null };

export async function previewDocument(db: D1Database, userId: string, id: number): Promise<DocumentPreview | null> {
  if (!await db.prepare('SELECT 1 FROM Documents WHERE id = ?1 AND userId = ?2').bind(id, userId).first()) return null;
  const part = (where: string) => db.prepare(`SELECT chapterTitle, text FROM DocumentParts WHERE documentId = ?1 ${where} ORDER BY position LIMIT 1`).bind(id);
  const [start, next] = await db.batch<{ chapterTitle: string; text: string }>([part(''), part("AND status = 'pending' AND position > 0")]);
  return { start: start.results[0] ?? null, next: next.results[0] ?? null };
}

// False when the document is not this user's.
export async function renameDocument(db: D1Database, userId: string, id: number, title: string): Promise<boolean> {
  const result = await db.prepare('UPDATE Documents SET title = ?1 WHERE id = ?2 AND userId = ?3').bind(title, id, userId).run();
  return result.meta.changes > 0;
}

// Removes the text and its cards still waiting in the Queue; learned cards stay.
export async function deleteDocument(db: D1Database, userId: string, id: number): Promise<boolean> {
  const [, deleted] = await db.batch([
    db.prepare("DELETE FROM Candidates WHERE userId = ?2 AND status = 'pending' AND partId IN (SELECT p.id FROM DocumentParts p JOIN Documents d ON d.id = p.documentId WHERE d.id = ?1 AND d.userId = ?2)").bind(id, userId),
    db.prepare('DELETE FROM Documents WHERE id = ?1 AND userId = ?2').bind(id, userId),
  ]);
  return (deleted.meta.changes ?? 0) > 0;
}
