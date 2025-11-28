import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { sendRandomCard } from './cronjob';
import { clearCache, getCacheInfo, getTodayCards } from './lib/cards';
import { env } from './config/env';
import { getPrompt, INTERVALS } from './constants';
import { logger } from './lib/logger';
import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({apiKey: env.GEMINI_API_KEY});


const app = new Hono();


// Health check endpoint
app.get('/', (c) => {
  return c.json({
    service: 'English SRS',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

// Get cache info
app.get('/cache', (c) => {
  const info = getCacheInfo();
  return c.json(info);
});

// Clear cache
app.post('/cache/clear', (c) => {
  clearCache();
  return c.json({ message: 'Cache cleared successfully' });
});

// Force fetch cards (clears cache and refetches)
app.post('/cache/refresh', async (c) => {
  clearCache();
  const cards = await getTodayCards();
  return c.json({
    message: 'Cache refreshed',
    count: cards.length
  });
});

// Manually trigger sending a card
app.post('/send', async (c) => {
  await sendRandomCard();
  return c.json({ message: 'Card sent successfully' });
});

app.get('/cards', async (c) => {
  const q = c.req.query('q')?.trim()

  if (!q) {
    return c.json({ error: 'Thiếu tham số q' }, 400)
  }

  try {
      const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: getPrompt(q),
  });

  const text = response.text?.trim() ?? "No result";
    logger.info({ query: q, responseLength: text.length }, 'Gemini response received');

return new Response(`<pre>${text.trim()}</pre>`, {
  status: 200,
  headers: {
    'Content-Type': 'text/html; charset=utf-8',   // đổi thành html
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, s-maxage=86400',
    'Access-Control-Allow-Origin': '*',
  },
})
  } catch (error: unknown) {
    logger.error({ err: error }, 'Gemini API error')
    return c.json({
      error: 'Lỗi Gemini API',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

// Start server
serve({
  fetch: app.fetch,
  port: env.PORT,
  hostname: '0.0.0.0'
}, (info) => {
  logger.info({ port: info.port, hostname: info.address }, 'Server running');
  logger.info('API Endpoints:');
  logger.info('  GET  /          - Health check');
  logger.info('  GET  /cache     - Cache info');
  logger.info('  POST /cache/clear - Clear cache');
  logger.info('  POST /cache/refresh - Refresh cache');
  logger.info('  POST /send      - Send card now');
});

// Start cronjob
logger.info('Cronjob started (runs every minute, 1/5 probability to send card)');
logger.info('Average: ~1 card every 5 minutes');

sendRandomCard(); // Run immediately
setInterval(sendRandomCard, INTERVALS.CRONJOB);
