import type { Bindings } from '../bindings';
import { AURA_MODEL, CLIP_VERSION, CLIP_VOICE } from '../constants';
import { speakClip } from './speech';

export const normalizeClipText = (text: string) => text.replace(/\s+/g, ' ').trim();

async function clipKey(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`v${CLIP_VERSION}|${AURA_MODEL}|${CLIP_VOICE.aura}|${text}`));
  return `clips/${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

type Clip = { body: ReadableStream | Uint8Array<ArrayBuffer>; contentType: string };

// Each sentence is synthesized once and then served from R2, which keeps TTS cost near zero.
export async function getClip(env: Bindings, rawText: string): Promise<Clip> {
  const text = normalizeClipText(rawText);
  const key = await clipKey(text);
  const cached = await env.AUDIO.get(key);
  if (cached) return { body: cached.body, contentType: cached.httpMetadata?.contentType ?? 'audio/mpeg' };
  const audio = await speakClip(env, text);
  await env.AUDIO.put(key, audio.bytes, { httpMetadata: { contentType: audio.contentType }, customMetadata: { text: text.slice(0, 500) } });
  return { body: audio.bytes, contentType: audio.contentType };
}
