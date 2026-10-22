// Each user's own settings. API keys are set on the Settings page and are write-only: the website only ever shows
// whether a key is set and its last 4 characters. Story audio generation requires the user's key.
export const providers = ['elevenlabs'] as const;
export type Provider = (typeof providers)[number];
export type KeyStatus = { provider: Provider; last4: string | null; updatedAt: string | null };

const settingKey = (provider: Provider) => `${provider}ApiKey`;

export async function getApiKey(db: D1Database, userId: string, provider: Provider): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM UserSettings WHERE userId = ?1 AND key = ?2').bind(userId, settingKey(provider)).first<{ value: string }>();
  return row?.value || null;
}

export async function getKeyStatuses(db: D1Database, userId: string): Promise<KeyStatus[]> {
  const rows = await db.prepare('SELECT key, value, updatedAt FROM UserSettings WHERE userId = ?1').bind(userId).all<{ key: string; value: string; updatedAt: string }>();
  return providers.map(provider => {
    const row = rows.results.find(item => item.key === settingKey(provider));
    return { provider, last4: row ? row.value.slice(-4) : null, updatedAt: row?.updatedAt ?? null };
  });
}

export async function setApiKey(db: D1Database, userId: string, provider: Provider, key: string | null): Promise<void> {
  if (key) {
    await db.prepare('INSERT INTO UserSettings (userId, key, value, updatedAt) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (userId, key) DO UPDATE SET value = ?3, updatedAt = ?4')
      .bind(userId, settingKey(provider), key, new Date().toISOString()).run();
  } else {
    await db.prepare('DELETE FROM UserSettings WHERE userId = ?1 AND key = ?2').bind(userId, settingKey(provider)).run();
  }
}

// The connector (MCP) link carries a random token that says whose data Claude or ChatGPT works on. Only its hash is
// kept, so the full link is shown once; a new link replaces the user's old one.
const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');

export async function createConnectorToken(db: D1Database, userId: string): Promise<string> {
  const token = [...crypto.getRandomValues(new Uint8Array(24))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  await db.batch([
    db.prepare('DELETE FROM ConnectorTokens WHERE userId = ?1').bind(userId),
    db.prepare('INSERT INTO ConnectorTokens (tokenHash, userId, createdAt) VALUES (?1, ?2, ?3)').bind(await sha256(token), userId, new Date().toISOString()),
  ]);
  return token;
}

export async function connectorCreatedAt(db: D1Database, userId: string): Promise<string | null> {
  return (await db.prepare('SELECT createdAt FROM ConnectorTokens WHERE userId = ?1').bind(userId).first<{ createdAt: string }>())?.createdAt ?? null;
}

// The user a connector link belongs to (null when the link is unknown or was replaced). Banned users are refused.
export async function connectorUser(db: D1Database, token: string): Promise<string | null> {
  if (!token) return null;
  const row = await db.prepare('SELECT t.userId FROM ConnectorTokens t JOIN Users u ON u.id = t.userId WHERE t.tokenHash = ?1 AND NOT COALESCE(u.banned, 0)')
    .bind(await sha256(token)).first<{ userId: string }>();
  return row?.userId ?? null;
}

export async function removeConnectorToken(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM ConnectorTokens WHERE userId = ?1').bind(userId).run();
}
