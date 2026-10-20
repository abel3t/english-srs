declare global {
  namespace Cloudflare {
    // Secrets are not in wrangler.jsonc, so `wrangler types` cannot see them.
    interface Env {
      OLLAMA_API_KEY: string;
      NOJI_EMAIL: string;
      NOJI_PASSWORD: string;
      NOJI_DECK_ID: string;
      GEMINI_API_KEY: string;
    }
  }
}

export type Bindings = Cloudflare.Env;
