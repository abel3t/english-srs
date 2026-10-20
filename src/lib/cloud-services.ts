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
