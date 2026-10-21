// Runs the book-extraction cron job once against the local D1 and .dev.vars (pnpm cron:local).
// Useful in development: the cron trigger only fires by itself once deployed.
import { getPlatformProxy } from 'wrangler';
import { runBookExtraction } from '../src/lib/book-extraction';

const proxy = await getPlatformProxy<Cloudflare.Env>();
try { console.log(await runBookExtraction(proxy.env as unknown as Cloudflare.Env)); }
finally { await proxy.dispose(); }
