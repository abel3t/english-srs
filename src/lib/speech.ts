import type { Bindings } from '../bindings';
import { AURA_MODEL, CONVERSATION_SPEAKERS, CLIP_VOICE, ELEVENLABS_MODEL, STORY_VOICE } from '../constants';
import { getApiKey } from './settings';
import { withoutAudioTags } from './text';

type Audio = { bytes: Uint8Array<ArrayBuffer>; contentType: string };
type Line = { speaker: string | null; text: string };

// Each request stays under both providers' 2,000-character limit; MP3 parts can simply be joined.
const MAX_REQUEST_CHARS = 1800;

function chunkLines(lines: Line[]): Line[][] {
  const chunks: Line[][] = [];
  let size = Infinity;
  for (const line of lines) {
    if (size + line.text.length > MAX_REQUEST_CHARS) { chunks.push([]); size = 0; }
    chunks.at(-1)!.push(line);
    size += line.text.length;
  }
  return chunks;
}

function joinMp3(parts: Uint8Array[]): Audio {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  parts.reduce((offset, part) => { bytes.set(part, offset); return offset + part.length; }, 0);
  return { bytes, contentType: 'audio/mpeg' };
}

// Deepgram Aura-2 on Workers AI: free within the daily Workers AI allowance. Used for phrase and sentence clips.
async function aura(env: Bindings, text: string, speaker: Ai_Cf_Deepgram_Aura_2_En_Input['speaker']): Promise<Uint8Array> {
  const response = await env.AI.run(AURA_MODEL, { text, speaker, encoding: 'mp3' }, { returnRawResponse: true });
  if (!response.ok) throw new Error(`Aura-2 failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function speakClip(env: Bindings, text: string): Promise<Audio> {
  return joinMp3([await aura(env, text, CLIP_VOICE.aura)]);
}

class QuotaError extends Error {}

export class MissingElevenLabsKeyError extends Error {
  constructor() { super('Add your ElevenLabs API key in Settings to create story audio.'); }
}

async function elevenLabsDialogue(apiKey: string, lines: Line[]): Promise<Uint8Array> {
  const voiceOf = (speaker: string | null) => (CONVERSATION_SPEAKERS.find(item => item.name === speaker) ?? STORY_VOICE).elevenLabs;
  const response = await fetch('https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({ model_id: ELEVENLABS_MODEL, inputs: lines.map(line => ({ text: line.text, voice_id: voiceOf(line.speaker) })) }),
  });
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 429 || /quota/i.test(body)) throw new QuotaError(body);
    throw new Error(`ElevenLabs failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

// Story generation requires the user's ElevenLabs key. Aura-2 is only a fallback for an exhausted quota.
export async function speakStory(env: Bindings, userId: string, lines: Line[]): Promise<Audio & { provider: 'elevenlabs' | 'aura' }> {
  const apiKey = await getApiKey(env.DB, userId, 'elevenlabs');
  if (!apiKey) throw new MissingElevenLabsKeyError();
  try {
    const parts: Uint8Array[] = [];
    for (const chunk of chunkLines(lines)) parts.push(await elevenLabsDialogue(apiKey, chunk));
    return { ...joinMp3(parts), provider: 'elevenlabs' };
  } catch (error) {
    if (!(error instanceof QuotaError)) throw error;
    console.warn('ElevenLabs credits are used up; using Aura-2 for this story');
  }
  const auraVoiceOf = (speaker: string | null) => (CONVERSATION_SPEAKERS.find(item => item.name === speaker) ?? STORY_VOICE).aura;
  const parts: Uint8Array[] = [];
  // One request per speaker turn (Aura has one voice per request); a story's lines are read in chunks.
  const groups = lines.some(line => line.speaker) ? lines.map(line => [line]) : chunkLines(lines);
  // Aura would read audio tags aloud.
  for (const group of groups) parts.push(await aura(env, withoutAudioTags(group.map(line => line.text).join(' ')), auraVoiceOf(group[0].speaker)));
  return { ...joinMp3(parts), provider: 'aura' };
}
