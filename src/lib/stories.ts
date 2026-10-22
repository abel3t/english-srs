import type { Bindings } from '../bindings';
import { STORY_AUDIO_VERSION, CONVERSATION_SPEAKERS, type StoryKind } from '../constants';
import { speakStory } from './speech';
import { withoutAudioTags } from './text';

// text = what is shown and typed; spoken = the same with its audio tags ("[laughs]"), for the voices.
type StoryLine = { speaker: string | null; text: string; spoken: string };
export type Story = { id: number; kind: StoryKind; title: string; lines: StoryLine[]; phrases: string[]; hasAudio: boolean; createdAt: string };

type StoryRow = { id: number; kind: StoryKind; title: string; lines: string; phrases: string; audioKey: string | null; createdAt: string };
const COLUMNS = 'id, kind, title, lines, phrases, audioKey, createdAt';
const fromRow = (row: StoryRow): Story => ({
  id: row.id, kind: row.kind, title: row.title, phrases: JSON.parse(row.phrases),
  lines: (JSON.parse(row.lines) as Array<{ speaker: string | null; text: string }>).map(line => ({ speaker: line.speaker, text: withoutAudioTags(line.text), spoken: line.text })),
  hasAudio: !!row.audioKey, createdAt: row.createdAt,
});

// Written by Claude or ChatGPT through the connector (save_story); conversations use the two known voices.
// Every function works for one user's stories only.
export async function saveStory(db: D1Database, userId: string, story: { kind: StoryKind; title: string; lines: Array<{ speaker: string | null; text: string }>; phrases: string[] }): Promise<Story> {
  const speakers: string[] = CONVERSATION_SPEAKERS.map(speaker => speaker.name);
  const lines = story.lines.map(line => ({ speaker: story.kind === 'conversation' ? line.speaker : null, text: line.text.trim() }));
  if (story.kind === 'conversation' && lines.some(line => !speakers.includes(line.speaker ?? ''))) throw new Error(`Every line of a conversation needs a speaker: ${speakers.join(' or ')}.`);
  // A line is typed without its audio tags, so it needs words too.
  if (lines.some(line => !withoutAudioTags(line.text))) throw new Error('A line has only audio tags: put them inside a line with words, e.g. "[laughs] No way."');
  const row = await db.prepare(`INSERT INTO Stories (userId, kind, title, lines, phrases, createdAt) VALUES (?1,?2,?3,?4,?5,?6) RETURNING ${COLUMNS}`)
    .bind(userId, story.kind, story.title.trim(), JSON.stringify(lines), JSON.stringify(story.phrases), new Date().toISOString())
    .first<StoryRow>();
  if (!row) throw new Error('D1 did not return the new story');
  return fromRow(row);
}

export async function listStories(db: D1Database, userId: string, limit = 30): Promise<Story[]> {
  const result = await db.prepare(`SELECT ${COLUMNS} FROM Stories WHERE userId = ?1 ORDER BY createdAt DESC LIMIT ?2`).bind(userId, limit).all<StoryRow>();
  return result.results.map(fromRow);
}

export async function getStory(db: D1Database, userId: string, id: number): Promise<Story | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM Stories WHERE id = ?1 AND userId = ?2`).bind(id, userId).first<StoryRow>();
  return row ? fromRow(row) : null;
}

export async function deleteStory(env: Bindings, userId: string, id: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT audioKey FROM Stories WHERE id = ?1 AND userId = ?2').bind(id, userId).first<{ audioKey: string | null }>();
  if (!row) return false;
  if (row.audioKey) await env.AUDIO.delete(row.audioKey);
  await env.DB.prepare('DELETE FROM Stories WHERE id = ?1 AND userId = ?2').bind(id, userId).run();
  return true;
}

// Audio is made once (requires the user's ElevenLabs key) and then served from R2. `story` comes from
// getStory/saveStory, so it is the user's own.
export async function getStoryAudio(env: Bindings, userId: string, story: Story): Promise<{ body: ReadableStream | Uint8Array<ArrayBuffer>; contentType: string }> {
  // The user id keeps keys unique even when story ids start again (a new database).
  const key = `stories/${userId}/${story.id}-v${STORY_AUDIO_VERSION}`;
  const cached = await env.AUDIO.get(key);
  if (cached) return { body: cached.body, contentType: cached.httpMetadata?.contentType ?? 'audio/mpeg' };
  const audio = await speakStory(env, userId, story.lines.map(line => ({ speaker: line.speaker, text: line.spoken })));
  await env.AUDIO.put(key, audio.bytes, { httpMetadata: { contentType: audio.contentType } });
  await env.DB.prepare('UPDATE Stories SET audioKey = ?1 WHERE id = ?2').bind(key, story.id).run();
  return { body: audio.bytes, contentType: audio.contentType };
}
