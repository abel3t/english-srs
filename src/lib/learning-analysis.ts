import { z } from 'zod';
import type { Bindings } from '../bindings';
import { OLLAMA_MODEL, PROMPT_VERSION, getPrompt } from '../constants';
import { generateWithOllama } from './ollama';
import { findRelatedCards, type Card } from './cards-db';
import { learningDateKey } from './text';

export type Recommendation = 'memorize' | 'optional' | 'understand_only' | 'needs_context' | 'review_existing';

const relationshipSchema = z.enum(['exact_duplicate', 'same_meaning', 'shared_pattern', 'related_but_different', 'unrelated']);
const generatedAnalysisSchema = z.object({
  mainSentence: z.string().min(1), meaning: z.string().min(1), correction: z.string().nullable(),
  keyExpression: z.string(), americanIpa: z.string().nullish().transform(value => value ?? null), grammarPattern: z.string(), realWorldUse: z.string().min(1),
  toneAndRegister: z.string().min(1), examples: z.array(z.string().min(1)).max(2), avoid: z.string().nullable(),
  vietnamese: z.string().nullable(), culturalNote: z.string().nullable(), baseScore: z.number().int().min(0).max(10),
  recommendationReason: z.string().min(1), needsMoreContext: z.boolean(), contextQuestion: z.string().nullable(),
  historyRelationships: z.array(z.object({ id: z.number().int().positive(), relationship: relationshipSchema })),
});

export type AnalyzeInput = { text: string; context?: string; confusingPart?: string; intendedMeaning?: string };

function parseGeneratedJson(raw: string): z.infer<typeof generatedAnalysisSchema> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return generatedAnalysisSchema.parse(JSON.parse(cleaned));
  } catch (error) {
    throw new Error(`Ollama returned an invalid analysis format: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function buildExplanation(analysis: z.infer<typeof generatedAnalysisSchema>): string {
  const sections: Array<[string, string | null | undefined]> = [
    ['Meaning', analysis.meaning], ['Key expression', analysis.keyExpression || null],
    ['American IPA', analysis.americanIpa],
    ['Pattern', analysis.grammarPattern || null], ['Real-world use', analysis.realWorldUse],
    ['Tone and register', analysis.toneAndRegister],
    ['Examples', analysis.examples.length ? analysis.examples.map(example => `• ${example}`).join('\n') : null],
    ['Be careful', analysis.avoid], ['Vietnamese', analysis.vietnamese],
    ['Cultural note', analysis.culturalNote], ['Correction', analysis.correction],
  ];
  return sections.filter((section): section is [string, string] => Boolean(section[1]))
    .map(([title, content]) => `**${title}**\n${content}`).join('\n\n');
}

function resolveRecommendation(analysis: z.infer<typeof generatedAnalysisSchema>, related: Card[]) {
  const validIds = new Set(related.map(card => card.id));
  const relevant = analysis.historyRelationships.filter(item => validIds.has(item.id) && item.relationship !== 'unrelated');
  const duplicate = relevant.find(item => item.relationship === 'exact_duplicate' || item.relationship === 'same_meaning');
  const relatedCardId = (duplicate ?? relevant[0])?.id ?? null;

  if (analysis.needsMoreContext) {
    return { recommendation: 'needs_context' as Recommendation, score: 0, reason: analysis.contextQuestion || analysis.recommendationReason, relatedCardId };
  }
  const existing = duplicate ? related.find(card => card.id === duplicate.id) : undefined;
  if (existing) {
    return { recommendation: 'review_existing' as Recommendation, score: analysis.baseScore, reason: `You already have a card with the same meaning: “${existing.phrase}”`, relatedCardId };
  }
  const score = analysis.baseScore;
  const recommendation: Recommendation = score >= 8 ? 'memorize' : score >= 5 ? 'optional' : 'understand_only';
  return { recommendation, score, reason: analysis.recommendationReason, relatedCardId };
}

export type Analysis = {
  mainSentence: string; explanation: string; keyExpression: string; grammarPattern: string;
  recommendation: Recommendation; score: number; reason: string; relatedCardId: number | null;
  model: string; promptVersion: string;
};

// Analysis is a preview only: nothing is written to D1 until the learner saves it as a card.
export async function analyzeLearningInput(env: Bindings, input: AnalyzeInput): Promise<Analysis> {
  const related = await findRelatedCards(env.DB, input.text);
  const prompt = getPrompt(input.text, input.context, input.confusingPart, input.intendedMeaning, related.map(card => ({
    id: card.id, phrase: card.phrase, keyExpression: card.keyExpression, grammarPattern: card.grammarPattern, addedOn: learningDateKey(card.createdAt),
  })));
  const generated = parseGeneratedJson(await generateWithOllama(env, prompt));
  const resolved = resolveRecommendation(generated, related);
  return {
    mainSentence: generated.mainSentence.trim(), explanation: buildExplanation(generated),
    keyExpression: generated.keyExpression.trim(), grammarPattern: generated.grammarPattern.trim(),
    recommendation: resolved.recommendation, score: resolved.score, reason: resolved.reason, relatedCardId: resolved.relatedCardId,
    model: OLLAMA_MODEL, promptVersion: PROMPT_VERSION,
  };
}
