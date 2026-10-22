// The whole D1 schema. `pnpm db:generate` (drizzle-kit) turns changes into SQL migrations in ./migrations, which
// wrangler applies (`pnpm db:migrate:local` / `db:migrate:remote`). Every learner's data belongs to their user and
// is deleted with it. The app's own queries are plain D1 SQL; Better Auth uses these tables through Drizzle.
// Naming: tables PascalCase plural (Users), columns camelCase (userId).
import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ---------- accounts (Better Auth, with its admin plugin: role, bans, impersonation) ----------

export const Users = sqliteTable('Users', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer({ mode: 'boolean' }).notNull().default(false),
  image: text(),
  // 'admin' can create and manage accounts (there is no sign-up page); everyone else is 'user'.
  role: text(),
  banned: integer({ mode: 'boolean' }).default(false),
  banReason: text(),
  banExpires: integer({ mode: 'timestamp_ms' }),
  createdAt: integer({ mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer({ mode: 'timestamp_ms' }).notNull(),
});

export const Sessions = sqliteTable('Sessions', {
  id: text().primaryKey(),
  expiresAt: integer({ mode: 'timestamp_ms' }).notNull(),
  token: text().notNull().unique(),
  ipAddress: text(),
  userAgent: text(),
  userId: text().notNull().references(() => Users.id, { onDelete: 'cascade' }),
  impersonatedBy: text(),
  createdAt: integer({ mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer({ mode: 'timestamp_ms' }).notNull(),
}, table => [index('idx_session_user').on(table.userId)]);

// The password lives here (provider 'credential').
export const Accounts = sqliteTable('Accounts', {
  id: text().primaryKey(),
  accountId: text().notNull(),
  providerId: text().notNull(),
  userId: text().notNull().references(() => Users.id, { onDelete: 'cascade' }),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: integer({ mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer({ mode: 'timestamp_ms' }),
  scope: text(),
  password: text(),
  createdAt: integer({ mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer({ mode: 'timestamp_ms' }).notNull(),
}, table => [index('idx_account_user').on(table.userId)]);

export const Verifications = sqliteTable('Verifications', {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: integer({ mode: 'timestamp_ms' }).notNull(),
  createdAt: integer({ mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer({ mode: 'timestamp_ms' }).notNull(),
}, table => [index('idx_verification_identifier').on(table.identifier)]);

// ---------- per-user settings ----------

// API keys set on the Settings page (write-only: only the last 4 characters are ever shown).
export const UserSettings = sqliteTable('UserSettings', {
  userId: text().notNull().references(() => Users.id, { onDelete: 'cascade' }),
  key: text().notNull(),
  value: text().notNull(),
  updatedAt: text().notNull(),
}, table => [primaryKey({ columns: [table.userId, table.key] })]);

// The connector (MCP) link for Claude or ChatGPT carries a random token; only its hash is kept. One per user.
export const ConnectorTokens = sqliteTable('ConnectorTokens', {
  tokenHash: text().primaryKey(),
  userId: text().notNull().unique().references(() => Users.id, { onDelete: 'cascade' }),
  createdAt: text().notNull(),
});

// ---------- reading ----------

// Imported reading (books, documents, pasted text), kept as short text parts (~250 words) read in order through
// the connector.
export const Documents = sqliteTable('Documents', {
  id: integer().primaryKey({ autoIncrement: true }),
  userId: text().notNull().references(() => Users.id, { onDelete: 'cascade' }),
  title: text().notNull(),
  author: text(),
  format: text({ enum: ['pdf', 'epub', 'docx', 'text'] }).notNull(),
  createdAt: text().notNull(),
}, table => [
  index('idx_documents_user').on(table.userId, table.createdAt),
  check('documents_format', sql`${table.format} IN ('pdf', 'epub', 'docx', 'text')`),
]);

export const DocumentParts = sqliteTable('DocumentParts', {
  id: integer().primaryKey({ autoIncrement: true }),
  documentId: integer().notNull().references(() => Documents.id, { onDelete: 'cascade' }),
  position: integer().notNull(),
  chapterTitle: text().notNull(),
  text: text().notNull(),
  words: integer().notNull(),
  // 'done' = given to the connector and its cards saved.
  status: text({ enum: ['pending', 'done'] }).notNull().default('pending'),
  processedAt: text(),
}, table => [
  uniqueIndex('document_parts_position').on(table.documentId, table.position),
  index('idx_document_parts_status').on(table.status, table.documentId, table.position),
  check('document_parts_status', sql`${table.status} IN ('pending', 'done')`),
]);

// ---------- cards ----------

// Cards written through the connector, waiting in the Queue for "Learn it", "I know it" or "Not useful".
// A phrase is never suggested twice to a learner: decided rows stay (the phrase is unique per user).
export const Candidates = sqliteTable('Candidates', {
  id: integer().primaryKey({ autoIncrement: true }),
  userId: text().notNull().references(() => Users.id, { onDelete: 'cascade' }),
  phrase: text().notNull(),
  normalizedPhrase: text().notNull(),
  example: text(),
  source: text(),
  // 'ai' = found in the reading, 'capture' = a phrase the learner asked to add.
  kind: text({ enum: ['ai', 'capture'] }).notNull(),
  partId: integer().references(() => DocumentParts.id, { onDelete: 'set null' }),
  // JSON: front, keyExpression, meaning, explanation, examples, score, reason, register, usage.
  draft: text().notNull(),
  status: text({ enum: ['pending', 'learned', 'dismissed'] }).notNull().default('pending'),
  // Why it was skipped: 'known' = the learner already knows it (stored as a memorized card), 'not_useful' = not
  // worth learning. Both are shown to Claude or ChatGPT so it picks better phrases next time.
  skipReason: text({ enum: ['known', 'not_useful'] }),
  decidedAt: text(),
  createdAt: text().notNull(),
}, table => [
  uniqueIndex('candidates_user_phrase').on(table.userId, table.normalizedPhrase),
  index('idx_candidates_status').on(table.userId, table.status),
  index('idx_candidates_part').on(table.partId),
  check('candidates_kind', sql`${table.kind} IN ('ai', 'capture')`),
  check('candidates_status', sql`${table.status} IN ('pending', 'learned', 'dismissed')`),
  check('candidates_skip_reason', sql`${table.skipReason} IN ('known', 'not_useful')`),
]);

// The learner's cards and their review schedule (SM-2 style; memorized = interval of 21 days or more).
export const Cards = sqliteTable('Cards', {
  id: integer().primaryKey({ autoIncrement: true }),
  userId: text().notNull().references(() => Users.id, { onDelete: 'cascade' }),
  phrase: text().notNull(),
  normalizedPhrase: text().notNull(),
  explanation: text().notNull(),
  keyExpression: text().notNull().default(''),
  // JSON array of the sentences to type.
  examples: text().notNull().default('[]'),
  originalInput: text(),
  context: text(),
  state: text({ enum: ['new', 'learning', 'review'] }).notNull().default('new'),
  dueAt: text().notNull(),
  intervalDays: real().notNull().default(0),
  // Rung of the review ladder (see srs.ts): 0 = an hour, 1 = a day, … 9 = a year.
  step: integer().notNull().default(0),
  // While new: how many times each text (phrase, then examples) was typed in the first drill, e.g. [10, 10, 4, 3].
  drill: text().notNull().default('[]'),
  reps: integer().notNull().default(0),
  lapses: integer().notNull().default(0),
  lastReviewedAt: text(),
  createdAt: text().notNull(),
  updatedAt: text().notNull(),
}, table => [
  index('idx_cards_due').on(table.userId, table.dueAt),
  index('idx_cards_normalized').on(table.userId, table.normalizedPhrase),
  index('idx_cards_created').on(table.userId, table.createdAt),
  check('cards_state', sql`${table.state} IN ('new', 'learning', 'review')`),
]);

// One row per typed card and the confidence the learner chose.
export const Reviews = sqliteTable('Reviews', {
  id: integer().primaryKey({ autoIncrement: true }),
  cardId: integer().notNull().references(() => Cards.id, { onDelete: 'cascade' }),
  rating: text({ enum: ['again', 'hard', 'good', 'easy'] }).notNull(),
  stateBefore: text().notNull(),
  intervalBefore: real().notNull(),
  intervalAfter: real().notNull(),
  durationMs: integer().notNull().default(0),
  accuracy: real(),
  reviewedAt: text().notNull(),
}, table => [
  index('idx_reviews_card').on(table.cardId),
  index('idx_reviews_reviewed').on(table.reviewedAt),
  check('reviews_rating', sql`${table.rating} IN ('again', 'hard', 'good', 'easy')`),
]);

// ---------- stories ----------

// Stories and conversations written through the connector; audio_key = its audio in R2.
export const Stories = sqliteTable('Stories', {
  id: integer().primaryKey({ autoIncrement: true }),
  userId: text().notNull().references(() => Users.id, { onDelete: 'cascade' }),
  kind: text({ enum: ['story', 'conversation'] }).notNull(),
  title: text().notNull(),
  // JSON array of {speaker: string | null, text: string} (text may carry audio tags)
  lines: text().notNull(),
  // JSON array of the learner's phrases used in it
  phrases: text().notNull().default('[]'),
  audioKey: text(),
  createdAt: text().notNull(),
}, table => [
  index('idx_stories_created').on(table.userId, table.createdAt),
  check('stories_kind', sql`${table.kind} IN ('story', 'conversation')`),
]);

// ---------- study activity ----------

// What the learner did, for the Today dashboard: every sentence typed to the end (rated or not, retypes included)
// and every stretch of audio heard. studySeconds is the time that amount is worth, not the clock time spent:
// typing at a reference speed, listening as the time spent, capped at the audio's own length.
export const Activities = sqliteTable('Activities', {
  id: integer().primaryKey({ autoIncrement: true }),
  userId: text().notNull().references(() => Users.id, { onDelete: 'cascade' }),
  kind: text({ enum: ['typing', 'listening'] }).notNull(),
  // Standard words: characters / 5 for typing; heard at about 150 a minute for listening.
  words: real().notNull(),
  studySeconds: real().notNull(),
  accuracy: real(),
  createdAt: text().notNull(),
}, table => [
  index('idx_activities_user').on(table.userId, table.createdAt),
  check('activities_kind', sql`${table.kind} IN ('typing', 'listening')`),
]);
