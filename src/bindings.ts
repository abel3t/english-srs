declare global {
  namespace Cloudflare {
    // Secrets are not in wrangler.jsonc, so `wrangler types` cannot see them.
    interface Env {
      OLLAMA_API_KEY: string;
      GEMINI_API_KEY: string;
    }
  }
}

export type Bindings = Cloudflare.Env;
