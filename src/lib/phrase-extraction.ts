import { z } from 'zod';
import type { Bindings } from '../bindings';
import { MAX_PHRASES_PER_CHUNK, getExtractionPrompt } from '../constants';
import { addCandidates } from './candidates-db';
import { generateWithOllama } from './ollama';
import { normalizeText } from './text';

const extractionSchema = z.object({
  phrases: z.array(z.object({ phrase: z.string().trim().min(2).max(120), example: z.string().trim().max(600), meaning: z.string().trim().max(200) })),
});

// The passage is only sent to the model; it is never stored. Only the extracted phrases are kept.
export async function extractPhrases(env: Bindings, text: string, source?: string): Promise<{ found: number; added: number }> {
  const raw = await generateWithOllama(env, getExtractionPrompt(text, source));
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: z.infer<typeof extractionSchema>;
  try {
    parsed = extractionSchema.parse(JSON.parse(cleaned));
  } catch (error) {
    throw new Error(`Ollama returned an invalid phrase list: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Keep the example only when it really comes from the passage, so the learner always sees authentic context.
  const passage = normalizeText(text);
  const phrases = parsed.phrases.slice(0, MAX_PHRASES_PER_CHUNK).map(item => ({
    phrase: item.phrase, meaning: item.meaning || null, source: source || null,
    example: item.example && passage.includes(normalizeText(item.example)) ? item.example : null,
  }));
  return { found: phrases.length, added: await addCandidates(env.DB, phrases) };
}
