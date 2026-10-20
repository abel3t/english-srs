import { Buffer } from 'node:buffer';
import type { Bindings } from '../bindings';
import { CLIP_VERSION, CLIP_VOICE, GEMINI_TTS_MODEL, getClipPrompt } from '../constants';
import { buildAudio, geminiAudioParts, type GeminiAudioResponse } from './wav';

export const normalizeClipText = (text: string) => text.replace(/\s+/g, ' ').trim();

async function clipKey(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`v${CLIP_VERSION}|${GEMINI_TTS_MODEL}|${CLIP_VOICE}|${text}`));
  return `clips/${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

type Clip = { body: ReadableStream | Uint8Array<ArrayBuffer>; contentType: string };

async function synthesize(env: Bindings, text: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: getClipPrompt(text) }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: CLIP_VOICE } } } },
    }),
  });
  if (!response.ok) {
    let message = `Gemini TTS request failed with status ${response.status}`;
    try { message = (await response.json() as { error?: { message?: string } }).error?.message ?? message; } catch { /* keep status message */ }
    throw new Error(message);
  }
  // Clips are a sentence or two, so decoding here stays well within the Worker CPU budget.
  const { base64, mimeType } = geminiAudioParts(await response.json() as GeminiAudioResponse);
  return buildAudio(base64.map(data => new Uint8Array(Buffer.from(data, 'base64'))), mimeType);
}

// Each sentence is synthesized once and then served from R2, which keeps TTS cost near zero.
export async function getClip(env: Bindings, rawText: string): Promise<Clip> {
  const text = normalizeClipText(rawText);
  const key = await clipKey(text);
  const cached = await env.AUDIO.get(key);
  if (cached) return { body: cached.body, contentType: cached.httpMetadata?.contentType ?? 'audio/wav' };
  const audio = await synthesize(env, text);
  await env.AUDIO.put(key, audio.bytes, { httpMetadata: { contentType: audio.contentType }, customMetadata: { text: text.slice(0, 500) } });
  return { body: audio.bytes, contentType: audio.contentType };
}
