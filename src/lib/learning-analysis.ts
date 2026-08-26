import { z } from 'zod';
import type { Bindings } from '../bindings';
import { OLLAMA_MODEL, PROMPT_VERSION, getPrompt } from '../constants';
import { generateWithOllama } from './cloud-services';
import { findHistoryCandidates, insertLearningItem, learningDateKey, normalizeLearningText, type LearningItem, type Recommendation } from './learning-db';

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

function resolveRecommendation(analysis: z.infer<typeof generatedAnalysisSchema>, candidates: LearningItem[]) {
  const validIds = new Set(candidates.map(candidate => candidate.id));
  const relevant = analysis.historyRelationships.filter(item => validIds.has(item.id) && item.relationship !== 'unrelated');
  const exact = relevant.find(item => item.relationship === 'exact_duplicate' || item.relationship === 'same_meaning');
  const related = exact ?? relevant[0];
  const existing = exact ? candidates.find(candidate => candidate.id === exact.id) : undefined;

  if (analysis.needsMoreContext) {
    return { recommendation: 'needs_context' as Recommendation, score: 0, reason: analysis.contextQuestion || analysis.recommendationReason, relatedItemId: related?.id ?? null };
  }
  if (existing?.userDecision === 'saved' || existing?.userDecision === 'edited_then_saved') {
    return { recommendation: 'review_existing' as Recommendation, score: analysis.baseScore, reason: `A card with the same meaning was already saved: “${existing.mainSentence}”`, relatedItemId: existing.id };
  }

  const distinctDays = new Set(relevant.map(relation => {
    const timestamp = candidates.find(item => item.id === relation.id)?.createdAt;
    return timestamp ? learningDateKey(timestamp) : null;
  }).filter((date): date is string => Boolean(date))).size;
  const bonus = distinctDays >= 2 ? 2 : distinctDays === 1 ? 1 : 0;
  const score = Math.min(10, analysis.baseScore + bonus);
  const recommendation: Recommendation = score >= 8 ? 'memorize' : score >= 5 ? 'optional' : 'understand_only';
  const recurrence = bonus ? ` Related language appeared on ${distinctDays} previous day${distinctDays === 1 ? '' : 's'}, adding ${bonus} recurrence point${bonus === 1 ? '' : 's'}.` : '';
  return { recommendation, score, reason: `${analysis.recommendationReason}${recurrence}`, relatedItemId: related?.id ?? null };
}

export async function analyzeLearningInput(env: Bindings, input: AnalyzeInput): Promise<LearningItem> {
  const candidates = await findHistoryCandidates(env.DB, input.text);
  const prompt = getPrompt(input.text, input.context, input.confusingPart, input.intendedMeaning, candidates.map(item => ({
    id: item.id, sentence: item.mainSentence, keyExpression: item.keyExpression,
    grammarPattern: item.grammarPattern, decision: item.userDecision, date: learningDateKey(item.createdAt),
  })));
  const generated = parseGeneratedJson(await generateWithOllama(env, prompt));
  const resolved = resolveRecommendation(generated, candidates);

  return insertLearningItem(env.DB, {
    originalInput: input.text, context: input.context?.trim() || null,
    intendedMeaning: input.intendedMeaning?.trim() || null, confusingPart: input.confusingPart?.trim() || null,
    normalizedInput: normalizeLearningText(input.text),
    mainSentence: generated.mainSentence.trim(), keyExpression: generated.keyExpression.trim(),
    grammarPattern: generated.grammarPattern.trim(), explanation: buildExplanation(generated),
    recommendation: resolved.recommendation, recommendationScore: resolved.score,
    recommendationReason: resolved.reason, relatedItemId: resolved.relatedItemId,
    model: OLLAMA_MODEL, promptVersion: PROMPT_VERSION,
  });
}
