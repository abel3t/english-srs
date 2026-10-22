import type { Bindings } from '../bindings';
import { CLIP_VERSION, CONVERSATION_SPEAKERS, type StoryKind } from '../constants';
import { speakStory } from './speech';

export type StoryLine = { speaker: string | null; text: string };
export type Story = { id: number; kind: StoryKind; title: string; lines: StoryLine[]; phrases: string[]; hasAudio: boolean; createdAt: string };

type StoryRow = { id: number; kind: StoryKind; title: string; lines: string; phrases: string; audio_key: string | null; created_at: string };
const fromRow = (row: StoryRow): Story => ({
  id: row.id, kind: row.kind, title: row.title, lines: JSON.parse(row.lines), phrases: JSON.parse(row.phrases),
  hasAudio: !!row.audio_key, createdAt: row.created_at,
});

// Written by Claude or ChatGPT through the connector (save_story); conversations use the two known voices.
export async function saveStory(db: D1Database, story: { kind: StoryKind; title: string; lines: StoryLine[]; phrases: string[] }): Promise<Story> {
  const speakers: string[] = CONVERSATION_SPEAKERS.map(speaker => speaker.name);
  const lines = story.lines.map(line => ({ speaker: story.kind === 'conversation' ? line.speaker : null, text: line.text.trim() }));
  if (story.kind === 'conversation' && lines.some(line => !speakers.includes(line.speaker ?? ''))) throw new Error(`Every line of a conversation needs a speaker: ${speakers.join(' or ')}.`);
  const row = await db.prepare('INSERT INTO stories (kind, title, lines, phrases, model, created_at) VALUES (?1,?2,?3,?4,?5,?6) RETURNING *')
    .bind(story.kind, story.title.trim(), JSON.stringify(lines), JSON.stringify(story.phrases), 'connector', new Date().toISOString())
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

// Audio is made on first play (ElevenLabs, or Aura-2 when its credits are used up) and then served from R2.
export async function getStoryAudio(env: Bindings, story: Story): Promise<{ body: ReadableStream | Uint8Array<ArrayBuffer>; contentType: string }> {
  const key = `stories/${story.id}-v${CLIP_VERSION}`;
  const cached = await env.AUDIO.get(key);
  if (cached) return { body: cached.body, contentType: cached.httpMetadata?.contentType ?? 'audio/mpeg' };
  const audio = await speakStory(env, story.lines);
  await env.AUDIO.put(key, audio.bytes, { httpMetadata: { contentType: audio.contentType }, customMetadata: { provider: audio.provider } });
  await env.DB.prepare('UPDATE stories SET audio_key = ?1 WHERE id = ?2').bind(key, story.id).run();
  return { body: audio.bytes, contentType: audio.contentType };
}
