# English SRS

A personal English learning app on Cloudflare Workers: find phrases in the books and documents you read, learn a few each day, and practise them by typing (Monkeytype-style, reading aloud as you go), with stories and conversations built from what you are still memorizing.

## Learning workflow

1. **Library → Import** a PDF or EPUB. The browser reads it and the phrase finder (no AI) picks phrases with their original sentence. Only those are stored, never the book.
2. **Today** suggests at most 10 phrases a day (each one learned or skipped today counts; new ones come tomorrow). *Learn?* opens the Learn dialog; *Skip* drops it.
3. **Learn** (a dialog, opened from a suggestion or *Add a phrase*): Ollama (free) previews the meaning, a "worth learning?" score and 3–4 sentences to type → *Skip* or *ask Gemini* → Gemini checks the card (corrects the meaning, improves the sentences, gives its own score) → *Skip* or *Learn it*. Only then is the card stored. *Add a phrase* (Today or Library) lets you paste any phrase yourself.
4. **Practice**: type due cards — the phrase, its sentences, or a mix — Monkeytype-style. Turn on **Blanks** to hide the phrase and type it from memory. After each item choose how confident you were (Didn't know / Unsure / Confident / Easy); that drives the review schedule. A card counts as memorized once it is scheduled three weeks or more ahead.
5. **Stories**: click *Create* to get a short story or a conversation (Ollama) using phrases you are still memorizing — pick some, or let it choose. Listen (Gemini voices, made once and saved), then type it line by line, with or without blanks.

AI is only used when you choose to: previewing/reviewing a phrase you might learn, and creating a story.

## Runtime architecture

```text
Cloudflare Worker (src/server.ts)
├── /api/*, /health  → Hono JSON API (src/api/app.ts)
└── everything else  → TanStack Start (React + shadcn/ui) pages in src/routes
    ├── Ollama Cloud: card previews, stories and conversations
    └── Gemini: card review, speech for sentences and stories

Cloudflare D1
└── Cards (with sentences to type) and review history, suggested phrases, stories (books are never stored)

Cloudflare R2 (english-srs-audio)
└── Generated speech, made once per sentence or story
```

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
| `/` | GET | Today: due count, up to 10 suggestions a day, and the Learn dialog |
| `/practice` | GET | Typing practice for due cards, or a story (`?story=<id>`) |
| `/stories` | GET | Create, listen to and type stories/conversations |
| `/library` | GET | Import a book, add a phrase (Learn dialog), browse cards |
| `/health` | GET | Service health check |
| `/api/analyze` | POST | Ollama preview of a phrase; stores nothing |
| `/api/analyze/review` | POST | Gemini review of that preview; stores nothing |
| `/api/cards` | POST | Save a card with its sentences |
| `/api/cards/:id` | DELETE | Delete a card and its review history |
| `/api/practice/due` | GET | Due cards with their texts to type and next intervals |
| `/api/practice/answer` | POST | Record the confidence rating after typing |
| `/api/candidates/batch` | POST | Save phrases found by the in-browser phrase finder |
| `/api/candidates/:id/skip` | POST | Never suggest this phrase again |
| `/api/audio?text=` | GET | Saved speech for a sentence |
| `/api/stories` | POST | Create a story or conversation |
| `/api/stories/:id/audio` | GET | Saved speech for a story |
| `/api/stories/:id` | DELETE | Delete a story and its audio |
| `/api/stats` | GET | Today's added/typed/due counts |

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

## D1 backups

D1 Free includes point-in-time recovery, but periodic exports are still recommended:

```bash
pnpm exec wrangler d1 export english-srs --remote --output english-srs-backup.sql
```

## Security

Protect the deployed Worker with Cloudflare Access before using it as a personal application. Otherwise, anyone who discovers the URL could read your cards or use your Ollama and Gemini quota.
