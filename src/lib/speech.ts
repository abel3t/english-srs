import type { Bindings } from '../bindings';
import { AURA_MODEL, CONVERSATION_SPEAKERS, CLIP_VOICE, ELEVENLABS_MODEL, STORY_VOICE } from '../constants';
import { getApiKey } from './settings';

type Audio = { bytes: Uint8Array<ArrayBuffer>; contentType: string };
type Line = { speaker: string | null; text: string };

// Each ElevenLabs request stays under its 2,000-character limit; MP3 parts can simply be joined.
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

// Aura-2 starts speaking ~0.05 s into a clip and stops ~0.2 s before its end. A phone (Bluetooth above all) takes a
// moment to wake its audio output for each new clip or story, and the mini player loads the next one the moment one
// ends, dropping what the output had not played yet: the first or the last word was lost. Silent MP3 frames, copied
// from the audio's own first frame header so they always match its format, are what gets dropped instead.
const LEAD_SILENCE_SECONDS = 0.35;
const TAIL_SILENCE_SECONDS = 0.6;
// Layer III bitrates in kbps, by header bitrate index: MPEG-1, then MPEG-2/2.5.
const MP3_BITRATES = [[0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]];
const MP3_SAMPLE_RATES = [44100, 48000, 32000];

// ElevenLabs puts an ID3 tag (10-byte header, syncsafe size, optional 10-byte footer) before the first frame.
function firstFrame(mp3: Uint8Array): number {
  if (mp3[0] !== 0x49 || mp3[1] !== 0x44 || mp3[2] !== 0x33) return 0;
  return 10 + ((mp3[6] << 21) | (mp3[7] << 14) | (mp3[8] << 7) | mp3[9]) + (mp3[5] & 0x10 ? 10 : 0);
}

function silentFrames(mp3: Uint8Array, seconds: number): Uint8Array {
  const start = firstFrame(mp3);
  const [sync, flags, info, mode] = mp3.subarray(start, start + 4);
  // Only Layer III is padded; anything else is played as it came.
  if (sync !== 0xFF || (flags & 0xE6) !== 0xE2) return new Uint8Array();
  const version = (flags >> 3) & 3; // 3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5
  const bitrate = MP3_BITRATES[version === 3 ? 0 : 1][info >> 4] * 1000;
  const sampleRate = MP3_SAMPLE_RATES[(info >> 2) & 3] / (version === 3 ? 1 : version === 2 ? 2 : 4);
  if (!bitrate || !sampleRate) return new Uint8Array();
  const samplesPerFrame = version === 3 ? 1152 : 576;
  const frameLength = Math.floor((samplesPerFrame / 8) * bitrate / sampleRate);
  // Header without CRC or padding; all-zero side info and main data decode to silence.
  const frame = new Uint8Array(frameLength);
  frame.set([0xFF, flags | 1, info & ~2, mode]);
  const count = Math.ceil(seconds * sampleRate / samplesPerFrame);
  const frames = new Uint8Array(frameLength * count);
  for (let index = 0; index < count; index++) frames.set(frame, index * frameLength);
  return frames;
}

export async function speakClip(env: Bindings, text: string): Promise<Audio> {
  const speech = await aura(env, text, CLIP_VOICE.aura);
  return joinMp3([silentFrames(speech, LEAD_SILENCE_SECONDS), speech, silentFrames(speech, TAIL_SILENCE_SECONDS)]);
}

// The key is missing, refused or out of credits: the learner sets another key in Settings and tries again.
export class ElevenLabsKeyError extends Error {}

async function elevenLabsDialogue(apiKey: string, lines: Line[]): Promise<Uint8Array> {
  const voiceOf = (speaker: string | null) => (CONVERSATION_SPEAKERS.find(item => item.name === speaker) ?? STORY_VOICE).elevenLabs;
  const response = await fetch('https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({ model_id: ELEVENLABS_MODEL, inputs: lines.map(line => ({ text: line.text, voice_id: voiceOf(line.speaker) })) }),
  });
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401 && !/quota|credit/i.test(body)) throw new ElevenLabsKeyError('ElevenLabs refused your API key. Set another key in Settings, then try again.');
    if (response.status === 402 || response.status === 429 || /quota|credit/i.test(body)) throw new ElevenLabsKeyError('Your ElevenLabs credits are used up. Set another API key in Settings, then try again.');
    throw new Error(`ElevenLabs failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

// Story audio is made only with the user's ElevenLabs key; when it fails nothing is saved, so the next play tries again.
export async function speakStory(env: Bindings, userId: string, lines: Line[]): Promise<Audio> {
  const apiKey = await getApiKey(env.DB, userId, 'elevenlabs');
  if (!apiKey) throw new ElevenLabsKeyError('Add your ElevenLabs API key in Settings to create story audio.');
  const parts: Uint8Array[] = [];
  // Each part's ID3 tag is dropped: in the middle of the joined audio it is data the decoder cannot read.
  for (const chunk of chunkLines(lines)) { const part = await elevenLabsDialogue(apiKey, chunk); parts.push(part.subarray(firstFrame(part))); }
  return joinMp3([silentFrames(parts[0], LEAD_SILENCE_SECONDS), ...parts, silentFrames(parts[0], TAIL_SILENCE_SECONDS)]);
}
