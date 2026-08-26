import type { Bindings } from '../bindings';
import { OLLAMA_MODEL } from '../constants';

type OllamaResponse = { response?: string; error?: string };
type NojiErrorBody = { error?: { title?: string; body?: string } };

const nojiBaseUrl = 'https://api-de.noji.io/api';
const nojiAppVersion = '26.31.2';

function nojiHeaders(token?: string): HeadersInit {
  return {
    Accept: '*/*',
    'Content-Type': 'application/json',
    'app-language': 'en',
    'app-platform': 'Web',
    'app-version': nojiAppVersion,
    'app-features': 'clozeCardV2,hierarchySchemaV2,imageOcclusion,cardPresets,separateExperiments',
    'current-time': Math.floor(Date.now() / 1000).toString(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function responseError(response: Response, service: string): Promise<Error> {
  let message = `${service} request failed with status ${response.status}`;
  try {
    const body = await response.json() as NojiErrorBody & { error?: { title?: string } | string };
    if (typeof body.error === 'string') message = body.error;
    else if (body.error?.title) message = body.error.title;
  } catch { /* keep status message */ }
  return new Error(message);
}

export async function generateWithOllama(env: Bindings, prompt: string): Promise<string> {
  const baseUrl = (env.OLLAMA_BASE_URL || 'https://ollama.com').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OLLAMA_API_KEY}` },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, options: { temperature: 0.2 } }),
  });
  const body = await response.json() as OllamaResponse;
  if (!response.ok) throw new Error(body.error ?? `Ollama request failed with status ${response.status}`);
  const result = body.response?.trim();
  if (!result) throw new Error('Ollama returned an empty response');
  return result;
}

async function getNojiToken(env: Bindings): Promise<string> {
  const response = await fetch(`${nojiBaseUrl}/authentication/login_with_provider`, {
    method: 'POST', headers: nojiHeaders(),
    body: JSON.stringify({ provider: 'email', email: env.NOJI_EMAIL, password: env.NOJI_PASSWORD }),
  });
  if (!response.ok) throw await responseError(response, 'Noji login');
  const body = await response.json() as { token?: string };
  if (!body.token) throw new Error('Noji login did not return a token');
  return body.token;
}

function markdownToHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>').replace(/\n/g, '<br>');
}

export async function createNojiNote(env: Bindings, front: string, back: string): Promise<string | null> {
  const token = await getNojiToken(env);
  const response = await fetch(`${nojiBaseUrl}/notes`, {
    method: 'POST', headers: nojiHeaders(token),
    body: JSON.stringify({ note: {
      template_id: 'front_to_back',
      fields: { front_side: `<p>${markdownToHtml(front)}</p>`, back_side: `<p>${markdownToHtml(back)}</p>` },
      deck_id: Number.parseInt(env.NOJI_DECK_ID), field_attachments_map: {}, reverse: false,
    } }),
  });
  if (!response.ok) throw await responseError(response, 'Noji save');
  const body = await response.json() as { id?: string | number; note?: { id?: string | number } };
  const id = body.id ?? body.note?.id;
  return id == null ? null : String(id);
}

type NojiAnswer = 'again' | 'hard' | 'good' | 'easy';
type NojiLearningCard = {
  card?: { id?: string | number; front?: { preview?: string; rawHtml?: string }; back?: { preview?: string; rawHtml?: string } };
  answerButtons?: Array<{ type?: string; repeat?: string }>;
};
export type DueCard = { cardId: string; deckId: number; sessionTimestamp: number; front: string; back: string; answerButtons: Array<{ type: NojiAnswer; repeat: string }> };

function plainCardText(side: { preview?: string; rawHtml?: string } | undefined): string {
  const value = side?.preview || side?.rawHtml || '';
  return value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

export async function getRandomDueCard(env: Bindings): Promise<DueCard | null> {
  const token = await getNojiToken(env);
  const deckId = Number.parseInt(env.NOJI_DECK_ID);
  const sessionTimestamp = Math.floor(Date.now() / 1000);
  const headers = nojiHeaders(token);
  const start = await fetch(`${nojiBaseUrl}/v2/learning/start?deck_id=${deckId}&learn_session_start_timestamp=${sessionTimestamp}`, { headers });
  if (!start.ok) throw await responseError(start, 'Noji learning session');
  const response = await fetch(`${nojiBaseUrl}/v2/learning/cards?deck_id=${deckId}&limit=20&learn_session_start_timestamp=${sessionTimestamp}`, { headers });
  if (!response.ok) throw await responseError(response, 'Noji due cards');
  const body = await response.json() as { cards?: NojiLearningCard[] };
  const cards = (body.cards ?? []).filter(item => item.card?.id != null && plainCardText(item.card.front) && plainCardText(item.card.back));
  if (!cards.length) return null;
  const selected = cards[Math.floor(Math.random() * cards.length)];
  const allowed = new Set<NojiAnswer>(['again', 'hard', 'good', 'easy']);
  return {
    cardId: String(selected.card!.id), deckId, sessionTimestamp,
    front: plainCardText(selected.card!.front), back: plainCardText(selected.card!.back),
    answerButtons: (selected.answerButtons ?? []).filter((button): button is { type: NojiAnswer; repeat: string } => allowed.has(button.type as NojiAnswer) && typeof button.repeat === 'string'),
  };
}

export async function answerNojiCard(env: Bindings, input: { cardId: string; sessionTimestamp: number; answer: NojiAnswer; reviewDurationMs: number }): Promise<{ status: string }> {
  const token = await getNojiToken(env);
  const reviewId = crypto.randomUUID();
  const response = await fetch(`${nojiBaseUrl}/v2/learning/answer?learn_session_start_timestamp=${input.sessionTimestamp}`, {
    method: 'POST', headers: nojiHeaders(token),
    body: JSON.stringify({ deck_id: Number.parseInt(env.NOJI_DECK_ID), card_id: input.cardId, answer: input.answer,
      review_duration_ms: Math.min(Math.max(input.reviewDurationMs, 0), 3_600_000), review_id: reviewId, reviewed_at_ms: Date.now() }),
  });
  if (!response.ok) throw await responseError(response, 'Noji review answer');
  const body = await response.json() as {
    review_id?: string; status?: string;
    data?: { review_id?: string; status?: string };
    reviews?: Array<{ review_id?: string; status?: string }>;
  };
  const result = body.review_id ? body : body.data?.review_id ? body.data : body.reviews?.find(review => review.review_id === reviewId);
  if (!result || result.status !== 'accepted') throw new Error(`Noji did not accept the review${result?.status ? ` (${result.status})` : ''}`);
  return { status: result.status };
}
