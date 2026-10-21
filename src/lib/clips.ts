import type { Bindings } from '../bindings';
import { CLIP_VERSION, CLIP_VOICE, GEMINI_TTS_MODEL } from '../constants';
import { synthesizeSpeech } from './gemini';

export const normalizeClipText = (text: string) => text.replace(/\s+/g, ' ').trim();

async function clipKey(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`v${CLIP_VERSION}|${GEMINI_TTS_MODEL}|${CLIP_VOICE}|${text}`));
  return `clips/${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

type Clip = { body: ReadableStream | Uint8Array<ArrayBuffer>; contentType: string };

// Each sentence is synthesized once and then served from R2, which keeps TTS cost near zero.
export async function getClip(env: Bindings, rawText: string): Promise<Clip> {
  const text = normalizeClipText(rawText);
  const key = await clipKey(text);
  const cached = await env.AUDIO.get(key);
  if (cached) return { body: cached.body, contentType: cached.httpMetadata?.contentType ?? 'audio/wav' };
  const audio = await synthesizeSpeech(env, text, { single: CLIP_VOICE });
  await env.AUDIO.put(key, audio.bytes, { httpMetadata: { contentType: audio.contentType }, customMetadata: { text: text.slice(0, 500) } });
  return { body: audio.bytes, contentType: audio.contentType };
}
