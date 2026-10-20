import type { Bindings } from '../bindings';
import { OLLAMA_MODEL } from '../constants';

type OllamaResponse = { response?: string; error?: string };

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
