import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { sendRandomCard } from './cronjob';
import { clearCache, getCacheInfo, getTodayCards } from './lib/cards';
import { env } from './config/env';
import { getPrompt, DECK_IDS } from './constants';
import { logger } from './lib/logger';
import { GoogleGenAI } from '@google/genai';
import { nojiApi } from './lib/api';
import { getValidToken } from './lib/auth';
import cron from 'node-cron';

const ai = new GoogleGenAI({apiKey: env.GEMINI_API_KEY});

const app = new Hono();

// Helper function to determine deck ID based on input type
function getDeckId(input: string): string {
  const words = input.trim().split(/\s+/);

  // If multiple words (2+), it's a sentence/phrase
  if (words.length >= 2) {
    return DECK_IDS.SENTENCE;
  }

  // Single word is a vocab
  return DECK_IDS.VOCAB;
}

// Helper function to convert markdown to HTML
function markdownToHtml(text: string): string {
  let html = text;

  // Convert **text** to <b>text</b>
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

  // Convert *text* to <i>text</i>
  html = html.replace(/\*([^*]+)\*/g, '<i>$1</i>');

  // Convert newlines to <br>
  html = html.replace(/\n/g, '<br>');

  return html;
}

// Helper function to create Noji note
async function createNojiNote(front: string, back: string, deckId: string): Promise<void> {
  try {
    const token = await getValidToken();

    // Convert markdown to HTML for both front and back
    const frontHtml = markdownToHtml(front);
    const backHtml = markdownToHtml(back);

    await nojiApi.post('/notes', {
      note: {
        template_id: 'front_to_back',
        fields: {
          front_side: `<p>${frontHtml}</p>`,
          back_side: `<p>${backHtml}</p>`,
        },
        deck_id: Number.parseInt(deckId),
        field_attachments_map: {},
        reverse: false,
      },
    }, {
      headers: {
        authorization: `Bearer ${token}`,
      }
    });

    logger.info({ front, deckId }, 'Note created in Noji');
  } catch (error) {
    logger.error({ err: error, front, deckId }, 'Failed to create Noji note');
    throw error;
  }
}

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
  await sendRandomCard({ isForce: true });
  return c.json({ message: 'Card sent successfully' });
});

app.get('/cards', async (c) => {
  const q = c.req.query('q')?.trim()

  if (!q) {
    // Return HTML form if no query
    return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Card Generator</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 50px auto;
      padding: 20px;
    }
    textarea {
      width: 100%;
      min-height: 150px;
      padding: 10px;
      font-size: 16px;
      border: 2px solid #ccc;
      border-radius: 4px;
    }
    button {
      margin-top: 10px;
      padding: 10px 20px;
      font-size: 16px;
      background-color: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    button:disabled {
      background-color: #ccc;
      cursor: not-allowed;
      opacity: 0.6;
    }
    button:hover:not(:disabled) {
      background-color: #0056b3;
    }
    #result {
      margin-top: 20px;
      padding: 15px;
      background-color: #f5f5f5;
      border-radius: 4px;
      white-space: pre-wrap;
      font-family: monospace;
    }
    #loading {
      display: none;
      margin-top: 10px;
      color: #007bff;
    }
  </style>
</head>
<body>
  <h1>Card Generator for Anki/Noji</h1>
  <p>Enter words or sentences separated by commas:</p>
  <form id="cardForm" autocomplete="off">
    <textarea id="input" placeholder="e.g., apple, beautiful, give up, How are you doing?" autocomplete="off" spellcheck="false"></textarea>
    <br>
    <button type="submit" id="generateBtn" disabled>Generate Cards</button>
  </form>
  <div id="loading">Loading...</div>
  <pre id="result"></pre>

  <script>
    const inputTextarea = document.getElementById('input');
    const generateBtn = document.getElementById('generateBtn');
    const resultDiv = document.getElementById('result');
    const loadingDiv = document.getElementById('loading');

    // Enable/disable button based on input
    inputTextarea.addEventListener('input', () => {
      generateBtn.disabled = !inputTextarea.value.trim();
    });

    document.getElementById('cardForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = inputTextarea.value.trim();

      if (!input) return;

      loadingDiv.style.display = 'block';
      resultDiv.textContent = '';
      generateBtn.disabled = true;

      try {
        const response = await fetch('/cards?q=' + encodeURIComponent(input));
        const text = await response.text();
        resultDiv.textContent = text;
      } catch (error) {
        resultDiv.textContent = 'Error: ' + error.message;
      } finally {
        loadingDiv.style.display = 'none';
        generateBtn.disabled = !inputTextarea.value.trim();
      }
    });
  </script>
</body>
</html>
    `)
  }

  try {
    // Split by comma and process each word/sentence
    const items = q.split(',').map(item => item.trim()).filter(item => item.length > 0);

    // Process all items in parallel
    const promises = items.map(async (item) => {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: getPrompt(item),
      });

      const definition = response.text?.trim() ?? "No result";
      logger.info({ query: item, responseLength: definition.length }, 'Gemini response received');

      // Extract the first line (e.g., "**apple** (noun) - A1") as front
      const lines = definition.split('\n');
      const front = lines[0] || item;
      const back = lines.slice(1).join('\n').trim();

      // Determine deck ID and create note in Noji
      const deckId = getDeckId(item);
      try {
        await createNojiNote(front, back, deckId);
      } catch (error) {
        logger.warn({ item, error }, 'Failed to create note in Noji, continuing...');
      }

      // Format as: front;\nback
      return `${front};\n${back}`;
    });

    const results = await Promise.all(promises);

    // Join with \n\n\n separator
    const finalOutput = results.join('\n\n\n');

    return new Response(finalOutput, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
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

// Start cronjob with Vietnam timezone
logger.info('Cronjob started: Monday-Friday, 9 AM - 6 PM');
logger.info('Probability: 1/5 chance per run (~1 card every 5 minutes)');
logger.info('Guarantee: Force send if no card for 15+ minutes');

// Run every minute, Monday-Friday, 9 AM to 5:59 PM (hour 9-17)
cron.schedule('* 9-17 * * 1-5', () => {
  sendRandomCard();
}, {
  timezone: 'Asia/Saigon'
});
