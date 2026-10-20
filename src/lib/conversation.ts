import { z } from 'zod';
import type { Bindings } from '../bindings';
import { CONVERSATION_PHRASE_COUNT, CONVERSATION_SPEAKERS, GEMINI_TTS_MODEL, getConversationPrompt, getSpeechPrompt } from '../constants';
import { generateWithOllama, getDueCards } from './cloud-services';
import { listLearningItems } from './learning-db';

const speakerNames = CONVERSATION_SPEAKERS.map(speaker => speaker.name) as [string, string];
const generatedConversationSchema = z.object({
  title: z.string().min(1),
  lines: z.array(z.object({ speaker: z.enum(speakerNames), text: z.string().min(1) })).min(4).max(40),
  usedPhrases: z.array(z.string()),
});

export type Conversation = z.infer<typeof generatedConversationSchema> & { phrases: string[]; source: 'noji' | 'noji+history' | 'history' };

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Prefer cards Noji is currently scheduling; top up with saved D1 history when the deck has fewer due cards.
async function pickPhrases(env: Bindings): Promise<{ phrases: string[]; source: Conversation['source'] }> {
  const fromNoji = shuffle((await getDueCards(env, 50)).map(card => card.front)).slice(0, CONVERSATION_PHRASE_COUNT);
  if (fromNoji.length >= CONVERSATION_PHRASE_COUNT) return { phrases: fromNoji, source: 'noji' };

  const seen = new Set(fromNoji.map(phrase => phrase.toLowerCase()));
  const saved = (await listLearningItems(env.DB, { limit: 100 }))
    .filter(item => item.userDecision === 'saved' || item.userDecision === 'edited_then_saved')
    .map(item => item.mainSentence)
    .filter(phrase => !seen.has(phrase.toLowerCase()));
  const phrases = [...fromNoji, ...shuffle(saved)].slice(0, CONVERSATION_PHRASE_COUNT);
  if (!phrases.length) throw new Error('No Noji cards or saved phrases were found to build a conversation from.');
  return { phrases, source: fromNoji.length ? 'noji+history' : 'history' };
}

export async function createConversation(env: Bindings): Promise<Conversation> {
  const { phrases, source } = await pickPhrases(env);
  const raw = await generateWithOllama(env, getConversationPrompt(phrases));
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return { ...generatedConversationSchema.parse(JSON.parse(cleaned)), phrases, source };
  } catch (error) {
    throw new Error(`Ollama returned an invalid conversation format: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Returns Gemini's raw response stream so the Worker never decodes the (multi-megabyte) base64 audio itself;
// the browser turns the PCM data into a WAV file.
export async function synthesizeConversation(env: Bindings, transcript: string): Promise<Response> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: getSpeechPrompt(transcript) }] }],
      generationConfig: {
        temperature: 1,
        responseModalities: ['AUDIO'],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: CONVERSATION_SPEAKERS.map(speaker => ({
              speaker: speaker.name, voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker.voice } },
            })),
          },
        },
      },
    }),
  });
  if (!response.ok) {
    let message = `Gemini TTS request failed with status ${response.status}`;
    try { message = (await response.json() as { error?: { message?: string } }).error?.message ?? message; } catch { /* keep status message */ }
    throw new Error(message);
  }
  return new Response(response.body, { headers: { 'Content-Type': 'application/json' } });
}
