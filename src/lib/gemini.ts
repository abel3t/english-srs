import { Buffer } from 'node:buffer';
import type { Bindings } from '../bindings';
import { CONVERSATION_SPEAKERS, GEMINI_REVIEW_FALLBACK_MODEL, GEMINI_REVIEW_MODEL, GEMINI_TTS_MODEL } from '../constants';
import { buildAudio, geminiAudioParts, type GeminiAudioResponse } from './wav';

const endpoint = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

async function errorMessage(response: Response): Promise<string> {
  try { return (await response.json() as { error?: { message?: string } }).error?.message ?? `Gemini request failed with status ${response.status}`; }
  catch { return `Gemini request failed with status ${response.status}`; }
}

// Speech for one voice (a string), or a conversation (lines with speakers). The model reads any instruction
// aloud, so only the words to speak are sent; for conversations it needs each line as its own part, tagged
// with speechMetadata.speaker.
export async function synthesizeSpeech(env: Bindings, input: string | Array<{ speaker: string; text: string }>, voices: { single: string } | 'conversation'): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }> {
  const parts = typeof input === 'string' ? [{ text: input }] : input.map(line => ({ text: line.text, speechMetadata: { speaker: line.speaker } }));
  const speechConfig = voices === 'conversation'
    ? { multiSpeakerVoiceConfig: { speakerVoiceConfigs: CONVERSATION_SPEAKERS.map(speaker => ({ speaker: speaker.name, voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker.voice } } })) } }
    : { voiceConfig: { prebuiltVoiceConfig: { voiceName: voices.single } } };
  const response = await fetch(endpoint(GEMINI_TTS_MODEL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['AUDIO'], speechConfig } }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const { base64, mimeType } = geminiAudioParts(await response.json() as GeminiAudioResponse);
  // Native base64 decoding keeps a minute of audio well within the Worker CPU budget.
  return buildAudio(base64.map(data => new Uint8Array(Buffer.from(data, 'base64'))), mimeType);
}

const overloaded = (status: number, message: string) => [429, 503, 504].includes(status) || /high demand|overloaded|try again later/i.test(message);

async function generateText(env: Bindings, model: string, prompt: string, timeoutMs: number): Promise<{ ok: true; text: string } | { ok: false; status: number; message: string }> {
  let response: Response;
  try {
    response = await fetch(endpoint(model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) return { ok: false, status: 504, message: 'timed out' };
    throw error;
  }
  if (!response.ok) return { ok: false, status: response.status, message: await errorMessage(response) };
  const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return { ok: true, text: body.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('') ?? '' };
}

// JSON answer from Gemini; when the main model is overloaded or slow, the lighter fallback answers instead.
export async function generateJsonWithGemini(env: Bindings, prompt: string): Promise<{ text: string; model: string }> {
  let model: string = GEMINI_REVIEW_MODEL;
  let result = await generateText(env, model, prompt, 40_000);
  if (!result.ok && overloaded(result.status, result.message)) {
    model = GEMINI_REVIEW_FALLBACK_MODEL;
    result = await generateText(env, model, prompt, 60_000);
  }
  if (!result.ok) throw new Error(overloaded(result.status, result.message) ? 'Gemini is busy right now. Please try again in a minute.' : result.message);
  return { text: result.text, model };
}
