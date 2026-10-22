import type { Bindings } from '../bindings';
import { AURA_MODEL, CLIP_VERSION, CLIP_VOICE, MAX_CLIP_CHARS } from '../constants';
import { speakClip } from './speech';

export const normalizeClipText = (text: string) => text.replace(/\s+/g, ' ').trim();

async function clipKey(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`v${CLIP_VERSION}|${AURA_MODEL}|${CLIP_VOICE.aura}|${text}`));
  return `clips/${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

type Clip = { body: ReadableStream | Uint8Array<ArrayBuffer>; contentType: string };

async function makeClip(env: Bindings, key: string, text: string) {
  const audio = await speakClip(env, text);
  await env.AUDIO.put(key, audio.bytes, { httpMetadata: { contentType: audio.contentType }, customMetadata: { text: text.slice(0, 500) } });
  return audio;
}

// Each sentence is synthesized once and then served from R2, which keeps TTS cost near zero.
export async function getClip(env: Bindings, rawText: string): Promise<Clip> {
  const text = normalizeClipText(rawText);
  const key = await clipKey(text);
  const cached = await env.AUDIO.get(key);
  if (cached) return { body: cached.body, contentType: cached.httpMetadata?.contentType ?? 'audio/mpeg' };
  const audio = await makeClip(env, key, text);
  return { body: audio.bytes, contentType: audio.contentType };
}

// Makes the clips a new card will play (its phrase and examples) ahead of time, one after another to stay gentle
// on the Workers AI allowance. Runs after the response; a clip that fails is simply made on its first play instead.
export async function prepareClips(env: Bindings, texts: string[]): Promise<void> {
  for (const rawText of new Set(texts.map(normalizeClipText))) {
    if (!rawText || rawText.length > MAX_CLIP_CHARS) continue;
    try {
      const key = await clipKey(rawText);
      if (!await env.AUDIO.head(key)) await makeClip(env, key, rawText);
    } catch (error) { console.warn('Could not prepare a clip', error); }
  }
}
