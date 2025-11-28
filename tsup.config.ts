import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: false,
  minify: false,
  bundle: true,
  external: [
    '@google/genai',
    '@hono/node-server',
    'hono',
    'axios',
    'dotenv',
    'pino',
    'telegraf',
    'zod',
    'pino-pretty'
  ],
});
