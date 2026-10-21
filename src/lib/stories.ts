import { z } from 'zod';
import type { Bindings } from '../bindings';
import { CLIP_VERSION, CONVERSATION_SPEAKERS, OLLAMA_MODEL, STORY_VOICE, getStoryPrompt, type StoryKind } from '../constants';
import { getCard, getUnmemorizedCards, type Card } from './cards-db';
import { synthesizeSpeech } from './gemini';
import { generateWithOllama } from './ollama';

export type StoryLine = { speaker: string | null; text: string };
export type Story = { id: number; kind: StoryKind; title: string; lines: StoryLine[]; phrases: string[]; hasAudio: boolean; createdAt: string };

type StoryRow = { id: number; kind: StoryKind; title: string; lines: string; phrases: string; audio_key: string | null; created_at: string };
const fromRow = (row: StoryRow): Story => ({
  id: row.id, kind: row.kind, title: row.title, lines: JSON.parse(row.lines), phrases: JSON.parse(row.phrases),
  hasAudio: !!row.audio_key, createdAt: row.created_at,
});

const speakers = CONVERSATION_SPEAKERS.map(speaker => speaker.name) as [string, string];
const generatedSchema = z.object({
  format: z.enum(['conversation', 'story']),
  title: z.string().min(1).max(120),
  lines: z.array(z.object({ speaker: z.string().nullish().transform(value => value ?? null), text: z.string().min(1) })).min(3).max(40),
  usedPhrases: z.array(z.string()).default([]),
});

const phraseOf = (card: Card) => card.keyExpression || card.phrase;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}

// Created only when the learner asks. Phrases: the cards they picked, or else a mix of cards still being learned.
// The model decides whether a conversation or a story fits the phrases best.
export async function createStory(env: Bindings, input: { cardIds: number[]; topic?: string }): Promise<Story> {
  const picked = input.cardIds.length
    ? (await Promise.all(input.cardIds.map(id => getCard(env.DB, id)))).filter((card): card is Card => !!card)
    : shuffle(await getUnmemorizedCards(env.DB)).slice(0, 8);
  const phrases = [...new Set(picked.map(phraseOf))];
  const raw = await generateWithOllama(env, getStoryPrompt(phrases, input.topic));
  let story: z.infer<typeof generatedSchema>;
  try { story = generatedSchema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))); }
  catch (error) { throw new Error(`Ollama returned an invalid story: ${error instanceof Error ? error.message : 'Unknown error'}`); }
  const kind: StoryKind = story.format;

  const lines: StoryLine[] = story.lines.map(line => ({
    // Conversations must alternate the two known voices; stories have no speakers.
    speaker: kind === 'conversation' ? (speakers.includes(line.speaker ?? '') ? line.speaker : null) : null,
    text: line.text.trim(),
  }));
  if (kind === 'conversation' && lines.some(line => !line.speaker)) throw new Error('Ollama wrote a conversation with unknown speakers. Please try again.');
  const used = phrases.filter(phrase => story.usedPhrases.some(usedPhrase => usedPhrase.toLowerCase() === phrase.toLowerCase()));
  const row = await env.DB.prepare('INSERT INTO stories (kind, title, lines, phrases, model, created_at) VALUES (?1,?2,?3,?4,?5,?6) RETURNING *')
    .bind(kind, story.title.trim(), JSON.stringify(lines), JSON.stringify(used.length ? used : phrases), OLLAMA_MODEL, new Date().toISOString())
    .first<StoryRow>();
  if (!row) throw new Error('D1 did not return the new story');
  return fromRow(row);
}

export async function listStories(db: D1Database, limit = 30): Promise<Story[]> {
  const result = await db.prepare('SELECT * FROM stories ORDER BY created_at DESC LIMIT ?1').bind(limit).all<StoryRow>();
  return result.results.map(fromRow);
}

export async function getStory(db: D1Database, id: number): Promise<Story | null> {
  const row = await db.prepare('SELECT * FROM stories WHERE id = ?1').bind(id).first<StoryRow>();
  return row ? fromRow(row) : null;
}

export async function deleteStory(env: Bindings, id: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT audio_key FROM stories WHERE id = ?1').bind(id).first<{ audio_key: string | null }>();
  if (!row) return false;
  if (row.audio_key) await env.AUDIO.delete(row.audio_key);
  await env.DB.prepare('DELETE FROM stories WHERE id = ?1').bind(id).run();
  return true;
}

// Audio is made on first play (one Gemini call per story) and then served from R2.
export async function getStoryAudio(env: Bindings, story: Story): Promise<{ body: ReadableStream | Uint8Array<ArrayBuffer>; contentType: string }> {
  const key = `stories/${story.id}-v${CLIP_VERSION}`;
  const cached = await env.AUDIO.get(key);
  if (cached) return { body: cached.body, contentType: cached.httpMetadata?.contentType ?? 'audio/wav' };
  const audio = story.kind === 'conversation'
    ? await synthesizeSpeech(env, story.lines.map(line => ({ speaker: line.speaker ?? CONVERSATION_SPEAKERS[0].name, text: line.text })), 'conversation')
    : await synthesizeSpeech(env, story.lines.map(line => line.text).join(' '), { single: STORY_VOICE });
  await env.AUDIO.put(key, audio.bytes, { httpMetadata: { contentType: audio.contentType } });
  await env.DB.prepare('UPDATE stories SET audio_key = ?1 WHERE id = ?2').bind(key, story.id).run();
  return { body: audio.bytes, contentType: audio.contentType };
}
