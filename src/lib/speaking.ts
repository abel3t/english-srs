import { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { Bindings } from '../bindings';
import { GEMINI_COACH_FALLBACK_MODEL, GEMINI_COACH_MODEL, getSpeakingFeedbackPrompt, getSpeakingQuestionPrompt } from '../constants';
import { getPracticeCards } from './cards-db';
import { generateWithOllama } from './ollama';
import { MAX_RECORDING_SECONDS, speakingMetrics } from './practice';

const score = z.number().min(1).max(5).transform(Math.round);
export const feedbackSchema = z.object({
  transcript: z.string(),
  corrections: z.array(z.object({ original: z.string(), better: z.string(), why: z.string() })).max(5).default([]),
  phrases: z.array(z.object({ phrase: z.string(), used: z.boolean(), correct: z.boolean(), note: z.string().default('') })).default([]),
  pronunciation: z.array(z.object({ word: z.string(), issue: z.string(), tip: z.string() })).max(5).default([]),
  improvedAnswer: z.string().default(''),
  scores: z.object({ grammar: score, vocabulary: score, fluency: score, clarity: score }),
  summary: z.string().default(''),
  vietnamese: z.string().default(''),
});
export type SpeakingFeedback = z.infer<typeof feedbackSchema>;

export type SpeakingAttempt = {
  id: number; sessionId: string; attempt: number; question: string; targetPhrases: string[];
  durationSeconds: number; feedback: SpeakingFeedback; metrics: ReturnType<typeof speakingMetrics>; createdAt: string;
};

type AttemptRow = {
  id: number; session_id: string; attempt: number; question: string; target_phrases: string; duration_seconds: number;
  transcript: string; feedback: string; created_at: string;
};

function fromRow(row: AttemptRow): SpeakingAttempt {
  const feedback = feedbackSchema.parse(JSON.parse(row.feedback));
  return {
    id: row.id, sessionId: row.session_id, attempt: row.attempt, question: row.question, targetPhrases: JSON.parse(row.target_phrases),
    durationSeconds: row.duration_seconds, feedback, metrics: speakingMetrics(row.transcript, row.duration_seconds), createdAt: row.created_at,
  };
}

const parseJson = (raw: string) => JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}

// Two phrases from the cards being learned right now; the key expression is what should come out in speech.
export async function createQuestion(env: Bindings, topic?: string): Promise<{ question: string; tip: string; phrases: string[] }> {
  // Cards the learner recognizes but wants to start using come first.
  const cards = await getPracticeCards(env.DB, 20, { preferUse: true });
  const phrases = [...new Set(shuffle(cards).map(card => card.keyExpression || card.phrase))].filter(phrase => phrase.length <= 80).slice(0, 2);
  const raw = await generateWithOllama(env, getSpeakingQuestionPrompt(phrases, topic));
  try {
    const parsed = z.object({ question: z.string().min(5).max(500), tip: z.string().max(300).default('') }).parse(parseJson(raw));
    return { ...parsed, phrases };
  } catch (error) {
    throw new Error(`Ollama returned an invalid question: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Duration and loudness of the 16-bit mono WAV the browser wrote. A silent recording must never reach the
// model: given silence, it invents a fluent answer that fits the question.
function inspectRecording(audio: Uint8Array): { seconds: number; speechRatio: number } {
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  if (audio.length < 44 || String.fromCharCode(...audio.subarray(0, 4)) !== 'RIFF') throw new Error('Recording is not a WAV file.');
  const sampleRate = view.getUint32(24, true);
  const samples = Math.floor((audio.length - 44) / 2);
  const window = Math.max(1, Math.floor(sampleRate / 10));
  let loud = 0, windows = 0;
  for (let start = 0; start < samples; start += window, windows++) {
    let sum = 0, count = 0;
    // Every 4th sample is plenty for loudness and keeps CPU low.
    for (let i = start; i < Math.min(samples, start + window); i += 4, count++) { const value = view.getInt16(44 + i * 2, true); sum += value * value; }
    if (count && Math.sqrt(sum / count) > 300) loud++;
  }
  return { seconds: sampleRate ? samples / sampleRate : 0, speechRatio: windows ? loud / windows : 0 };
}

const overloaded = (status: number, message: string) => [429, 503, 504].includes(status) || /high demand|overloaded|try again later/i.test(message);

// When the model is under heavy load it can take minutes to answer; give up early and use the fallback instead.
async function coach(env: Bindings, model: string, body: string, timeoutMs: number): Promise<{ ok: true; text: string } | { ok: false; status: number; message: string }> {
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body, signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) return { ok: false, status: 504, message: 'timed out' };
    throw error;
  }
  const json = await response.json() as { error?: { message?: string }; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  if (!response.ok) return { ok: false, status: response.status, message: json.error?.message ?? `Gemini request failed with status ${response.status}` };
  return { ok: true, text: json.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('') ?? '' };
}

export async function assessAttempt(env: Bindings, input: { sessionId: string; attempt: number; question: string; phrases: string[]; audio: Uint8Array }): Promise<SpeakingAttempt> {
  const { seconds: durationSeconds, speechRatio } = inspectRecording(input.audio);
  if (durationSeconds < 3) throw new Error('The recording is too short. Speak for at least a few seconds.');
  if (durationSeconds > MAX_RECORDING_SECONDS + 5) throw new Error(`Recordings are limited to ${MAX_RECORDING_SECONDS} seconds.`);
  if (speechRatio < 0.1) throw new Error('No speech was detected in the recording. Check that the right microphone is selected and not muted, then try again.');

  const request = JSON.stringify({
      contents: [{ role: 'user', parts: [
        { text: getSpeakingFeedbackPrompt(input.question, input.phrases) },
        // Base64 via the native Buffer: a 90-second 16 kHz recording is ~3 MB, too much to encode in JS loops.
        { inlineData: { mimeType: 'audio/wav', data: Buffer.from(input.audio).toString('base64') } },
      ] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
  });
  let model: string = GEMINI_COACH_MODEL;
  let result = await coach(env, model, request, 40_000);
  if (!result.ok && overloaded(result.status, result.message)) {
    model = GEMINI_COACH_FALLBACK_MODEL;
    result = await coach(env, model, request, 60_000);
  }
  if (!result.ok) throw new Error(overloaded(result.status, result.message) ? 'Gemini is busy right now. Your recording was not saved; please try again in a minute.' : result.message);
  const text = result.text;
  let feedback: SpeakingFeedback;
  try { feedback = feedbackSchema.parse(parseJson(text)); }
  catch (error) { throw new Error(`Gemini returned invalid feedback: ${error instanceof Error ? error.message : 'Unknown error'}`); }
  if (!feedback.transcript.trim()) throw new Error('No speech was detected. Check your microphone and try again.');

  const audioKey = `recordings/${input.sessionId}/${input.attempt}.wav`;
  await env.AUDIO.put(audioKey, input.audio, { httpMetadata: { contentType: 'audio/wav' } });
  const row = await env.DB.prepare(`
    INSERT INTO speaking_attempts (session_id, attempt, question, target_phrases, duration_seconds, transcript, feedback, audio_key, model, created_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) RETURNING *
  `).bind(input.sessionId, input.attempt, input.question, JSON.stringify(input.phrases), durationSeconds, feedback.transcript,
    JSON.stringify(feedback), audioKey, model, new Date().toISOString()).first<AttemptRow>();
  if (!row) throw new Error('D1 did not return the saved attempt');
  return fromRow(row);
}

export async function listRecentAttempts(db: D1Database, limit = 20): Promise<SpeakingAttempt[]> {
  const result = await db.prepare('SELECT * FROM speaking_attempts ORDER BY created_at DESC LIMIT ?1').bind(limit).all<AttemptRow>();
  return result.results.map(fromRow);
}
