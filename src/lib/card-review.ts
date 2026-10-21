import { z } from 'zod';
import type { Bindings } from '../bindings';
import { getReviewPrompt, type ReviewInput } from '../constants';
import { generateJsonWithGemini } from './gemini';

const reviewSchema = z.object({
  score: z.number().min(0).max(10).transform(Math.round),
  verdict: z.enum(['learn', 'skip']),
  reason: z.string().default(''),
  issues: z.array(z.string()).max(6).default([]),
  correctedMeaning: z.string().nullish().transform(value => value?.trim() || null),
  examples: z.array(z.string().min(1)).max(6).default([]),
});
export type CardReview = z.infer<typeof reviewSchema> & { model: string };

// Second opinion on Ollama's card, asked only when the learner wants to keep the phrase.
export async function reviewCardWithGemini(env: Bindings, input: ReviewInput): Promise<CardReview> {
  const { text, model } = await generateJsonWithGemini(env, getReviewPrompt(input));
  try {
    const review = reviewSchema.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));
    return { ...review, examples: review.examples.map(example => example.trim()).slice(0, 4), model };
  } catch (error) {
    throw new Error(`Gemini returned an invalid review: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
