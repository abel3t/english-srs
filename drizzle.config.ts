import { defineConfig } from 'drizzle-kit';

// Schema in TypeScript, SQL migrations generated into ./migrations (where wrangler d1 applies them).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
});
