// Browser-side calls to the Hono JSON API in src/api/app.ts.
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json() as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(body.message || body.error || 'Request failed');
  return body;
}

export const postJson = <T>(path: string, data?: unknown) => apiRequest<T>(path, {
  method: 'POST',
  ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
});

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Unknown error';
