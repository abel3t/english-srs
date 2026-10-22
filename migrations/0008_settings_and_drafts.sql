-- API keys set in the website (Settings) instead of only as Worker secrets, and the connector token's hash.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A card written ahead of time by Claude or ChatGPT (through the MCP connector), so Learn opens it instantly.
ALTER TABLE candidates ADD COLUMN draft TEXT;
