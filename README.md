# English SRS

A personal English learning app on Cloudflare Workers: find phrases in the books and documents you read, learn a few each day, and practise them by typing (Monkeytype-style, reading aloud as you go), with stories and conversations built from what you are still memorizing.

## Learning workflow

Your Claude or ChatGPT subscription is the app's only AI, through a connector (MCP). The website imports books, shows the cards and runs the practice.

1. **Library → Import** (a dialog) a PDF or EPUB. The browser reads it and saves its prose as ~250-word parts (kept privately in D1). The Library shows how far each book has been read.
2. **Ask Claude or ChatGPT** (connected in Settings):
   - "Find 10 new phrases in my English app": it gets just enough unread text for that many phrases (about 100 words per phrase, in reading order), picks the phrases most worth learning for a B1 developer, and writes each card (meaning, notes, 3–4 sentences to type). That text is then marked as read.
   - "Add *circle back* to my English app": it writes a card for a phrase you met.
   - "Write me a story with my phrases": it picks phrases you are still memorizing and writes a conversation or a short story.
3. **Today** lists the new cards. *Learn?* opens the card (edit it if you like) → *Learn it* adds it to your practice schedule; *Skip* drops it for good.
4. **Practice**: *Start practice* on Today opens a dialog: type the phrases, their sentences, a mix, or a story, Monkeytype-style, with **Blanks** on or off (hides the phrases so you type them from memory). The choice is remembered; *Change* on the Practice page reopens it. After each item choose how confident you were (Didn't know / Unsure / Confident / Easy); that drives the review schedule. A card counts as memorized once it is scheduled three weeks or more ahead.
5. **Stories**: listen (ElevenLabs voices, or the free Aura-2 voice when there is no key or the month's credits are used up; made once and saved), then type it line by line, with or without blanks.
6. **Settings**: the connector link for Claude or ChatGPT, and the ElevenLabs API key (stored in D1, write-only; the Worker secret is the fallback).

## Runtime architecture

```text
Cloudflare Worker (src/server.ts)
├── /api/*, /health  → Hono JSON API (src/api/app.ts)
├── /mcp/<token>     → MCP connector for Claude or ChatGPT (src/api/mcp.ts)
└── everything else  → TanStack Start (React + shadcn/ui) pages in src/routes
    ├── Workers AI (Deepgram Aura-2): speech for phrases and sentences (free daily allowance)
    └── ElevenLabs (eleven_v3): speech for stories (free plan: ~4 stories a month)

Cloudflare D1
└── Cards (with sentences to type) and review history, suggested phrases, stories, imported books as text parts

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

Add the ElevenLabs key on the Settings page, or as a local secret in `.dev.vars` (optional):

```env
ELEVENLABS_API_KEY=...
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

Add the ElevenLabs key on the deployed Settings page, or as a production secret (optional):

```bash
pnpm exec wrangler secret put ELEVENLABS_API_KEY
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
| `/` | GET | Today: progress, Start practice, new cards written by the connector (Learn dialog) |
| `/practice` | GET | Typing practice; `?mode=mixed\|phrase\|sentences\|story&blank=true&story=<id>` |
| `/stories` | GET | Create, listen to and type stories/conversations |
| `/library` | GET | Import and Add a phrase dialogs, search and browse cards |
| `/settings` | GET | API keys and the Claude/ChatGPT connector link |
| `/health` | GET | Service health check |
| `/api/cards` | POST | Save a card with its sentences |
| `/api/cards/:id` | DELETE | Delete a card and its review history |
| `/api/practice/due` | GET | Due cards with their texts to type and next intervals |
| `/api/practice/answer` | POST | Record the confidence rating after typing |
| `/api/books` | POST | Create a book (then `/api/books/:id/parts` with its text parts) |
| `/api/books/:id` | DELETE | Delete a book's text and its waiting phrases (cards stay) |
| `/api/candidates/:id/skip` | POST | Skip a new card (never suggested again) |
| `/api/audio?text=` | GET | Saved speech for a sentence |
| `/api/stories` | GET | Stories to pick from when starting practice |
| `/api/stories/:id/audio` | GET | Saved speech for a story |
| `/api/stories/:id` | DELETE | Delete a story and its audio |
| `/api/stats` | GET | Today's added/typed/due counts |
| `/api/settings` | GET | Which API keys are set (last 4 characters only) |
| `/api/settings/keys/elevenlabs` | PUT, DELETE | Save or remove the ElevenLabs key |
| `/api/settings/connector` | POST, DELETE | Create (returned once) or remove the connector link |
| `/mcp/<token>` | POST | MCP tools: `get_reading`, `save_cards`, `list_cards`, `save_story` |

## Phrase finder (not used by the app)

The app no longer runs it: Claude or ChatGPT reads the text instead. It is kept with its data and evaluation in case code ranking is wanted again (for example to give the connector hints). `src/lib/phrase-finder.ts` ran in a Web Worker on the Import page. It first finds candidates broadly, then filters and ranks them:

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

Protect the deployed Worker with Cloudflare Access before using it as a personal application. Otherwise, anyone who discovers the URL could read your cards, change your API keys or use your quota. Add an Access **Bypass** rule for the path `/mcp/*` so Claude and ChatGPT can reach the connector; it is protected by its own secret link (only a hash is stored; create a new link in Settings to revoke the old one).
