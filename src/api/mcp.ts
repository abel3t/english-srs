import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import type { Bindings } from '../bindings';
import { getCandidate, getSuggestions, setCandidateDraft, setCandidateStatus } from '../lib/candidates-db';
import { MEMORIZED_DAYS, listCards } from '../lib/cards-db';
import type { Analysis } from '../lib/learning-analysis';

// Lets Claude or ChatGPT (the learner's own subscription) write the cards for today's suggestions.
// The learner still decides: a saved card only appears in the Learn dialog, ready for "Learn it" or "Skip".
const instructions = `
This is the learner's English study app. The learner is an intermediate (B1) Vietnamese software developer who wants
to speak natural English at work and pass a Senior Developer interview in English. Each day the app suggests up to
10 phrases found in books they imported.

When asked to review or prepare today's suggestions:
1. Call get_suggestions.
2. For each phrase, decide if it is worth this learner's limited study time. Worth it: reusable in work conversations
   and interviews (frames, collocations, idioms, phrasal verbs, precise general words). Not worth it: technical terms a
   developer learns on the job (thrash, deploy), phrases used only literally in the book sentence, rare or archaic
   language, or language that is too basic. For those, call skip_suggestion.
3. For the others, call save_card with a correct meaning for the book's context and 3 to 4 natural, spoken American
   English examples (8 to 20 words each, mostly about software work and interviews, easy enough to say aloud).
4. Finish with a short summary: which phrases you prepared and which you skipped, and why.
Use list_cards to avoid duplicating a phrase the learner already has.
`.trim();

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }] });

function buildServer(env: Bindings): McpServer {
  const server = new McpServer({ name: 'english-srs', version: '1.0.0' }, { instructions });

  server.registerTool('get_suggestions', {
    title: "Today's suggestions",
    description: "Today's phrase suggestions (up to 10) from the learner's books, each with the sentence it came from. hasCard = a card was already saved.",
    annotations: { readOnlyHint: true },
  }, async () => {
    const { suggestions, handledToday } = await getSuggestions(env.DB);
    return json({
      handledToday,
      suggestions: suggestions.map(candidate => ({
        id: candidate.id, phrase: candidate.phrase, sentence: candidate.example, book: candidate.source,
        whyPicked: candidate.aiReason, hasCard: !!candidate.draft,
      })),
    });
  });

  server.registerTool('save_card', {
    title: 'Save a card for a suggestion',
    description: 'Saves the study card for one suggestion. The learner then sees it in the app and chooses Learn it or Skip.',
    inputSchema: {
      id: z.number().int().positive().describe('Suggestion id from get_suggestions'),
      front: z.string().trim().min(1).max(300).describe('What the learner types and memorizes: the phrase in a short, natural, reusable form'),
      keyExpression: z.string().trim().max(120).describe('The exact words to learn'),
      meaning: z.string().trim().min(1).max(600).describe('Simple English meaning, correct for the book sentence'),
      usage: z.string().trim().max(800).optional().describe('When and how to use it at work; tone; common mistakes'),
      vietnamese: z.string().trim().max(300).optional().describe('Short Vietnamese meaning'),
      examples: z.array(z.string().trim().min(1).max(300)).min(3).max(4).describe('3 to 4 natural spoken examples, 8 to 20 words each'),
      score: z.number().int().min(0).max(10).describe('Worth learning, 0 to 10'),
      reason: z.string().trim().min(1).max(300).describe('One short sentence: why this score'),
    },
  }, async input => {
    const candidate = await getCandidate(env.DB, input.id);
    if (!candidate || candidate.status !== 'pending') return { ...json({ error: 'No pending suggestion with this id.' }), isError: true };
    const sections: Array<[string, string | undefined]> = [
      ['Meaning', input.meaning], ['Key expression', input.keyExpression || undefined],
      ['Real-world use', input.usage], ['Vietnamese', input.vietnamese],
    ];
    const draft: Analysis = {
      mainSentence: input.front, meaning: input.meaning, keyExpression: input.keyExpression, grammarPattern: '',
      explanation: sections.filter(([, content]) => content).map(([title, content]) => `**${title}**\n${content}`).join('\n\n'),
      examples: input.examples, score: input.score, reason: input.reason, relatedCardId: null,
      recommendation: input.score >= 8 ? 'memorize' : input.score >= 5 ? 'optional' : 'understand_only',
      model: 'connector', promptVersion: 'connector-v1',
    };
    await setCandidateDraft(env.DB, input.id, draft);
    return json({ saved: true, id: input.id });
  });

  server.registerTool('skip_suggestion', {
    title: 'Skip a suggestion',
    description: 'Removes a suggestion that is not worth learning (jargon, literal use, too basic, rare). It counts toward today’s 10.',
    inputSchema: { id: z.number().int().positive().describe('Suggestion id from get_suggestions') },
    annotations: { destructiveHint: false },
  }, async ({ id }) => {
    const candidate = await getCandidate(env.DB, id);
    if (!candidate || candidate.status !== 'pending') return { ...json({ error: 'No pending suggestion with this id.' }), isError: true };
    await setCandidateStatus(env.DB, id, 'dismissed');
    return json({ skipped: true, id });
  });

  server.registerTool('list_cards', {
    title: "The learner's cards",
    description: 'Cards the learner is already learning (optionally filtered by a search text), to avoid duplicates.',
    inputSchema: { search: z.string().trim().max(100).optional() },
    annotations: { readOnlyHint: true },
  }, async ({ search }) => {
    const cards = await listCards(env.DB, { query: search, limit: 200 });
    return json(cards.map(card => ({ phrase: card.phrase, keyExpression: card.keyExpression, memorized: card.intervalDays >= MEMORIZED_DAYS })));
  });

  return server;
}

// Stateless: a new server per request, answered as plain JSON (no sessions to keep on a Worker).
export async function handleMcp(env: Bindings, request: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await buildServer(env).connect(transport);
  return transport.handleRequest(request);
}
