import handler from '@tanstack/react-start/server-entry';
import { api } from './api/app';
import type { Bindings } from './bindings';
import { runBookExtraction } from './lib/book-extraction';

// The JSON API and the MCP connector run on Hono; every other request renders the React app.
const apiPaths = new Set(['/health']);

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const response = pathname.startsWith('/api/') || pathname === '/mcp' || pathname.startsWith('/mcp/') || apiPaths.has(pathname)
      ? await api.fetch(request, env, ctx)
      : await handler.fetch(request);
    const secured = new Response(response.body, response);
    secured.headers.set('X-Content-Type-Options', 'nosniff');
    if (!secured.headers.has('Cache-Control')) secured.headers.set('Cache-Control', 'no-store');
    return secured;
  },
  // Cron (wrangler.jsonc "triggers"): the AI reviews the next imported book parts within the Ollama quota.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runBookExtraction(env).then(result => { if (result.reviewed || result.stoppedForQuota) console.log('Book extraction run', result); }));
  },
} satisfies ExportedHandler<Bindings>;
