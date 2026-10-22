import type { Bindings } from '../bindings';

// API keys are set on the Settings page (stored in D1) and fall back to the Worker secrets.
// They are write-only: the website only ever shows whether a key is set and its last 4 characters.
export const providers = ['elevenlabs'] as const;
export type Provider = (typeof providers)[number];
export type KeyStatus = { provider: Provider; source: 'settings' | 'secret' | null; last4: string | null; updatedAt: string | null };

const settingKey = (provider: Provider) => `${provider}_api_key`;
const secretOf = (env: Bindings, _provider: Provider) => env.ELEVENLABS_API_KEY || null;

export async function getApiKey(env: Bindings, provider: Provider): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?1').bind(settingKey(provider)).first<{ value: string }>();
  return row?.value || secretOf(env, provider);
}

export async function getKeyStatuses(env: Bindings): Promise<KeyStatus[]> {
  const rows = await env.DB.prepare("SELECT key, value, updated_at FROM settings WHERE key LIKE '%_api_key'").all<{ key: string; value: string; updated_at: string }>();
  return providers.map(provider => {
    const row = rows.results.find(item => item.key === settingKey(provider));
    const key = row?.value ?? secretOf(env, provider);
    return { provider, source: row ? 'settings' : key ? 'secret' : null, last4: key ? key.slice(-4) : null, updatedAt: row?.updated_at ?? null };
  });
}

export async function setApiKey(db: D1Database, provider: Provider, key: string | null): Promise<void> {
  if (key) await db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = ?2, updated_at = ?3').bind(settingKey(provider), key, new Date().toISOString()).run();
  else await db.prepare('DELETE FROM settings WHERE key = ?1').bind(settingKey(provider)).run();
}

// The connector (MCP) link carries a random token. Only its hash is kept, so the full link is shown once.
const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');

export async function createConnectorToken(db: D1Database): Promise<string> {
  const token = [...crypto.getRandomValues(new Uint8Array(24))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('mcp_token_hash', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?1, updated_at = ?2").bind(await sha256(token), new Date().toISOString()).run();
  return token;
}

export async function connectorCreatedAt(db: D1Database): Promise<string | null> {
  return (await db.prepare("SELECT updated_at FROM settings WHERE key = 'mcp_token_hash'").first<{ updated_at: string }>())?.updated_at ?? null;
}

export async function isConnectorToken(db: D1Database, token: string): Promise<boolean> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'mcp_token_hash'").first<{ value: string }>();
  return !!row && !!token && row.value === await sha256(token);
}

export async function removeConnectorToken(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM settings WHERE key = 'mcp_token_hash'").run();
}
