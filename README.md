# English SRS

A personal English learning system on Cloudflare Workers. It finds phrases worth learning in the books and PDFs you read, lets you analyze any phrase you meet, and schedules your reviews.

## Learning workflow

1. **Import** a PDF or EPUB and pick chapters. The browser parses the file and finds phrases without AI (see *Phrase finder* below) — free and instant, even for a whole book. Only the phrases and their example sentences are stored, never the book. *Use AI instead* sends ~1,000-word chunks to Ollama.
2. **Phrases** (and the prompt on **Today**) asks about the best waiting phrase. Choose *I use it* (known; sometimes checked with a quick fill-in-the-gap), *I recognize it* (becomes a card to practice using; preferred in Speak), *New to me* (opens Learn for a full analysis), *Not useful*, or *later*. Keys 1–4 and L. Your choices estimate what you already use, so likely-known phrases are offered later. Phrases captured with the Chrome extension wait here too.
3. **Learn** analyzes a phrase (meaning, use, tone, IPA, examples). Analysis is a preview only; nothing is stored until you press **Save card**.
4. Saved cards live in D1 with their own review schedule (SM-2 style).
5. **Review** due cards in one of three modes, then rate Again/Hard/Good/Easy (keys 1–4):
   - **Recall** — fill in the blank in your head, reveal the phrase with audio, read the explanation.
   - **Dictation** — hear the sentence (normal or slow), type it, and see missed/wrong words with listening tips (unstressed small words, word endings, contractions).
   - **Type it** — see the meaning and the sentence with a gap, type the missing expression from memory with letter-by-letter feedback.
   Dictation and Type it suggest a rating from your accuracy; each review records its mode and accuracy.
6. **Speak**: get an interview-style question that invites two of your phrases, record a 60–90 second answer, and get a verbatim transcript (fillers highlighted), the top 3 corrections, phrase usage, pronunciation tips, 1–5 scores, and a native-speaker version you can play sentence by sentence for shadowing. Record again to compare attempts. Silent recordings are rejected before they reach the model.
7. **Listen** to conversations built from the phrases you are learning.

## Runtime architecture

```text
Cloudflare Worker (src/server.ts)
├── /api/*, /health  → Hono JSON API (src/api/app.ts), also used by the Chrome extension
└── everything else  → TanStack Start (React + shadcn/ui) pages in src/routes
    ├── Ollama Cloud analysis and conversation writing
    └── Gemini TTS (sentence clips and two-speaker conversations)

Cloudflare D1
└── Cards, review history, and phrases waiting to be offered (books are never stored)

Cloudflare R2 (english-srs-audio)
├── One saved audio clip per sentence, so each is synthesized only once
└── Your speaking recordings, to compare attempts over time
```

There is no Node server, PM2, local SQLite file, Qdrant, or persistent filesystem.

## Local development

Requirements: Node.js 20+ and pnpm.

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev
```

Vite (with the Cloudflare plugin, so D1 and secrets behave like production) serves the application at `http://localhost:8787`.

Fill `.dev.vars` with local secrets:

```env
OLLAMA_API_KEY=...
GEMINI_API_KEY=...
```

`.dev.vars`, `.env`, and Wrangler local state are excluded from Git.

## First Cloudflare deployment

Authenticate Wrangler:

```bash
pnpm exec wrangler login
```

Create D1:

```bash
pnpm exec wrangler d1 create english-srs
```

Create the R2 bucket for saved audio clips (R2 must be enabled on the account; the free tier includes 10 GB):

```bash
pnpm exec wrangler r2 bucket create english-srs-audio
```

Copy the D1 `database_id` into `wrangler.jsonc`, replacing:

```text
REPLACE_WITH_D1_DATABASE_ID
```

Add production secrets one at a time:

```bash
pnpm exec wrangler secret put OLLAMA_API_KEY
pnpm exec wrangler secret put GEMINI_API_KEY
```

Apply the schema and deploy:

```bash
pnpm db:migrate:remote
pnpm run deploy
```

Future deployments only require:

```bash
git pull
pnpm install --frozen-lockfile
pnpm db:migrate:remote
pnpm run deploy
```

## Verification

```bash
pnpm build                          # vite build + tsc --noEmit
pnpm eval:phrases                   # phrase finder recall/precision on eval/phrases
pnpm exec wrangler deploy --dry-run # validate the generated Worker config without uploading
```

After changing `wrangler.jsonc`, run `pnpm cf-typegen` to refresh `worker-configuration.d.ts`.

After deployment:

```bash
curl https://YOUR-WORKER.workers.dev/health
```

Then open:

```text
https://YOUR-WORKER.workers.dev/
```

## Routes

| Route | Method | Purpose |
|---|---:|---|
| `/` | GET | Today: due count, random "learn this phrase?" prompt, recent cards |
| `/review` | GET | Review due cards |
| `/learn` | GET | Analyze → edit → save as a card (`?candidate=<id>` pre-fills a suggested phrase) |
| `/import` | GET | Parse a PDF/EPUB in the browser and find phrases |
| `/phrases` | GET | Sort found phrases (use / recognize / new / not useful) and see the knowledge estimate |
| `/speak` | GET | Speaking drill: question → record → feedback → shadow → retry |
| `/listen` | GET | Two-speaker conversation from your cards, with Gemini TTS |
| `/cards` | GET | Search cards, see their schedule, delete |
| `/health` | GET | Service health check |
| `/api/analyze` | POST | Analyze text; stores nothing |
| `/api/cards` | POST | Save a card |
| `/api/cards/:id` | DELETE | Delete a card and its review history |
| `/api/review/due` | GET | One random due card with interval previews |
| `/api/review/answer` | POST | Record Again/Hard/Good/Easy (with review mode and accuracy) and reschedule |
| `/api/candidates` | POST | Capture a phrase for later (Chrome extension) |
| `/api/candidates/batch` | POST | Save phrases found by the in-browser phrase finder |
| `/api/candidates/:id/decide` | POST | `use` / `recognize` (creates a card) / `new` / `not_useful` |
| `/api/candidates/:id/snooze` | POST | Ask again in 3 days |
| `/api/import/extract` | POST | AI extraction from one chunk of book text (optional) |
| `/api/audio?text=` | GET | Saved audio clip for a sentence (made with Gemini on first request) |
| `/api/speaking/question` | POST | Interview-style question inviting two of your phrases |
| `/api/speaking/attempts` | POST | Multipart `meta` + `audio` (16 kHz WAV): transcript, feedback, and scores |
| `/api/speaking/recordings/:session/:attempt` | GET | Your saved recording |
| `/api/conversations` | POST | Write a conversation from ~10 cards |
| `/api/conversations/audio` | POST | Proxy a transcript to Gemini multi-speaker TTS |
| `/api/stats` | GET | Today's added/reviewed/due counts |

## Phrase finder

`src/lib/phrase-finder.ts` runs in a Web Worker on the Import page. It first finds candidates broadly, then filters and ranks them:

1. **Dictionary** — ~16,000 Wiktionary phrasal verbs, idioms and prepositional phrases plus hand-written workplace/interview frames, matched on lemmas ([compromise](https://github.com/spencermountain/compromise)), with slots (“loop *someone* in”) and separable verbs (“figure *it* out”, “take *X* into account”; never two-word verb + preposition like “build … on”).
2. **Reference phrases** — any 2–4-word stretch that is a strongly associated phrase in 50M words of reference English (fair normalized PMI), so fixed phrases no dictionary lists are found too (“in the context of”, “a large amount of”, “side effect”).
3. **Patterns** — light verb + noun (“take place”), adjective + dependent preposition (“resilient to”), intensifier + adjective (“loosely coupled”), complex prepositions (“in the case of”), statistically associated verb + noun pairs, linking words, and advanced single words.
4. **Filters and ranking** — very common spoken phrases are basic for B1 and skipped; names (capitalized mid-sentence), book topic terms (far more frequent than in general English) and bursty Wikipedia vocabulary (“cache”) are pushed down; dictionary entries never seen in the reference are usually literal and pushed down. Score = type + frequency + spread across chapters + difficulty + reference usefulness/fixedness, plus the most dictionary-like example sentence.

### Measuring it

`pnpm eval:phrases [--details] [--no-reference]` scores the finder against hand-annotated chapters in `eval/phrases/` (CC BY 3.0 texts from *The Architecture of Open Source Applications*):

| | Held-out chapter (annotated blind) | | Tuning chapters (×3) | |
|---|---|---|---|---|
| | recall | precision@50 | recall | precision@50 |
| Original finder | 20% | 64% | 27% | 57% |
| Current finder | **52%** | **70%** | 74% | 79% |

Recall on the tuning chapters is optimistic (its gold set was grown from judged finder output); the held-out chapter is the honest number. Add your own chapters (`*.txt` plus a `gold.json` entry; set `"blind": true` if you annotate before running) to measure on your reading.

### Data

`public/data/` is generated, not hand-edited:

- `expressions.json` — `scripts/build-phrase-data.mjs`; titles from Wiktionary categories, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), filtered and normalized.
- `word-freq.txt` — Zipf frequencies of the top 40,000 English words from [wordfreq](https://github.com/rspeer/wordfreq) (data CC BY-SA 4.0).
- `reference-ngrams.tsv`, `reference-words.tsv` — `scripts/build-reference-ngrams.py`; aggregate counts only (no text) from 25M words of OpenSubtitles 2018 via [OPUS](https://opus.nlpl.eu/OpenSubtitles.php) (P. Lison and J. Tiedemann, 2016) and 25M words of [WikiText-103](https://blog.salesforceairesearch.com/the-wikitext-long-term-dependency-language-modeling-dataset/) (CC BY-SA).

## Chrome capture extension

The unpacked Manifest V3 extension in `extension/` captures phrases for later (they appear on **Today**) and offers a compact review of due cards: a fill-in-the-blank prompt, then the full phrase, then the explanation and Again/Hard/Good/Easy with their next intervals.

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository's `extension` directory.
4. Pin **English SRS Capture** to the toolbar.
5. Captured phrases are offered on the dashboard; use **Review due** to study due cards.

## D1 backups

D1 Free includes point-in-time recovery, but periodic exports are still recommended:

```bash
pnpm exec wrangler d1 export english-srs --remote --output english-srs-backup.sql
```

## Security

Protect the deployed Worker with Cloudflare Access before using it as a personal application. Otherwise, anyone who discovers the URL could read your cards or consume your Ollama and Gemini quota.
