# PhraseLoop

A personal English learning app on Cloudflare Workers: find phrases in the books and documents you read, learn a few each day, and practise them by typing (Monkeytype-style, reading aloud as you go), with stories and conversations built from what you are still memorizing.

## Learning workflow

Your Claude or ChatGPT subscription is the app's only AI, through a connector (MCP). The website imports what you read, shows the cards and runs the practice.

1. **Library → Import** (a dialog) a PDF, EPUB or Word (.docx) file, or paste or type some text. The browser reads it and saves its prose as ~250-word parts (kept privately in D1). The Library's Imported tab shows how far each one has been read, with a quick look at its text.
2. **Ask Claude or ChatGPT** (connected in Settings):
   - Generic requests such as "Create 10 cards with PhraseLoop" always use the imported reading below. Without unread text, the connector asks you to import more; it must not invent an unrelated phrase list. Saving reading cards requires valid `readingIds` and a source sentence from that passage. Capture mode is only for specific phrases you explicitly ask to add.
   - "Find 10 new phrases in PhraseLoop": 10 is a target, not a limit. It reads the unread text one ~200-word passage at a time (in reading order, each passage once), takes every phrase in it worth learning for a B1 developer who knows words but struggles to put them together (collocations, verb patterns, sentence frames, linkers…), checks them against the ones you already have (`check_phrases`), writes each card (meaning, register, usage note, 3–5 different sentences to type) and marks the passage read; then reads on until it has about 10.
   - "Add *circle back* to PhraseLoop": it writes a card for a phrase you met.
   - "Write me a story with my phrases": it picks phrases you are still memorizing and writes a natural conversation or a short story wherever they fit (work, a trip, a hobby…), with audio tags for the voices.
3. **Queue** shows the new cards one at a time (edit them if you like): *Learn it* (L) adds it to your practice schedule, *I know it* (K) keeps it as a memorized card checked again in a month, *Not useful* (N) drops it. Today shows how many are waiting.
4. **Practice**: *Start practice* on Today opens a dialog: type the phrases, their sentences, a mix, or a story, Monkeytype-style, with **Blanks** on or off (hides the phrases so you type them from memory). The choice is remembered; *Change* on the Practice page reopens it. The schedule is per card: each review shows its next sentence; Enter types it again, Tab switches sentence. Then choose how confident you were (Didn't know / Unsure / Confident / Easy, keys 1–4); that drives the review schedule. A card counts as memorized once it is scheduled three weeks or more ahead.
5. **Stories**: type stories line by line, with or without blanks. Creating story/conversation audio requires your own ElevenLabs API key in Settings. Audio is made once and saved; existing audio remains playable after removing the key. When the key is missing, refused or out of credits, story audio is not made: set another key in Settings and play it again. Phrase and sentence clips use Aura-2 without an ElevenLabs key.
6. **Settings**: change your password, create a connector link for Claude or ChatGPT, and save your own ElevenLabs API key (stored in D1; only its last four characters are shown).

## Accounts and Admin

Sign in at `/login` with an email and password. Public sign-up is disabled. On the first visit to the sign-in page, when no admin exists, the app creates a superadmin from `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD`.

Superadmins use `/admin` to create learners or other superadmins, reset passwords, block or unblock accounts, and delete accounts with their learning data. Blocking signs the user out and disables their connector. Users can change their own password in Settings and sign out from the navigation bar.

Cards, Queue, imported documents, stories, review history, ElevenLabs keys and connector links belong to each account. Each connector can access only its owner's data.

## Runtime architecture

```text
Cloudflare Worker (src/server.ts)
├── /api/*, /health  → Hono JSON API (src/api/app.ts)
├── /mcp/<token>     → MCP connector for Claude or ChatGPT (src/api/mcp.ts)
└── everything else  → TanStack Start (React + shadcn/ui) pages in src/routes
    ├── Workers AI (Deepgram Aura-2): speech for phrases and sentences (free daily allowance)
    └── ElevenLabs (eleven_v3): speech for stories (free plan: ~4 stories a month)

Cloudflare D1
└── Cards (with sentences to type) and review history, suggested phrases, stories, imported reading as text parts

Cloudflare R2 (english-srs-audio)
└── Generated speech, made once per sentence or story
```

## Local development

Requirements: Node.js 20+ and pnpm.

```bash
pnpm install
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` before starting: set `BETTER_AUTH_SECRET` to a random value (generate one with `openssl rand -base64 32`), plus `SUPERADMIN_EMAIL` and a strong `SUPERADMIN_PASSWORD` of at least eight characters. Authenticate with `pnpm exec wrangler login`; the Workers AI binding requires Cloudflare access during development.

```bash
pnpm db:migrate:local
pnpm dev
```

Vite (with the Cloudflare plugin, so D1 and secrets behave like production) serves the application at `http://localhost:8787`.

Open `/login`, sign in with the superadmin credentials from `.dev.vars`, then create a test learner at `/admin`. Each user can optionally add their own ElevenLabs key in Settings.

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

Set the production authentication secrets (use a separate random secret and password from local development):

```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put SUPERADMIN_EMAIL
pnpm exec wrangler secret put SUPERADMIN_PASSWORD
```

Apply the schema and deploy:

```bash
pnpm db:migrate:remote
pnpm run deploy
```

Visit `/login` to create the first superadmin, then use `/admin` to create accounts. Each user adds their own optional ElevenLabs key in Settings; there is no shared Worker key.

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
pnpm exec wrangler deploy --dry-run # validate the generated Worker config without uploading
```

After changing `wrangler.jsonc`, run `pnpm cf-typegen` to refresh `worker-configuration.d.ts`.

## Database changes

Edit `src/db/schema.ts`, then generate SQL with Drizzle:

```bash
pnpm db:generate --name describe_your_change
pnpm db:migrate:local
```

Commit the generated SQL and `migrations/meta` files together. Tables use plural PascalCase names and columns use camelCase. Test locally before applying migrations to production with `pnpm db:migrate:remote`.

The initial multi-user migration replaces the old single-user schema and requires a one-time database reset. Export a backup first, inspect the actual tables, drop the old application tables in foreign-key dependency order and clear `d1_migrations`, then apply `pnpm db:migrate:remote`. This deletes existing learning data; ordinary future migrations do not require a reset.

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
| `/login` | GET | Email/password sign-in; first superadmin bootstrap |
| `/admin` | GET | Superadmins only: create and manage accounts |
| `/api/auth/*` | GET, POST | Better Auth sign-in, sessions, password changes and admin operations |
| `/` | GET | Today: progress, Start practice, how many new cards wait in the Queue |
| `/queue` | GET | Review new cards written by the connector, one at a time |
| `/practice` | GET | Typing practice; `?mode=mixed\|phrase\|sentences\|story&blank=true&story=<id>` |
| `/stories` | GET | Create, listen to and type stories/conversations |
| `/library` | GET | Cards tab (search and browse) and Imported tab (paged, with a quick look at each), Import dialog |
| `/settings` | GET | Password change, personal API keys and the Claude/ChatGPT connector link |
| `/health` | GET | Service health check |
| `/api/cards` | POST | Save a card with its sentences |
| `/api/cards/:id` | DELETE | Delete a card and its review history |
| `/api/practice/due` | GET | Due cards with their texts to type and next intervals |
| `/api/practice/answer` | POST | Record the confidence rating after typing |
| `/api/documents` | POST | Create an imported document (then `/api/documents/:id/parts` with its text parts) |
| `/api/documents/:id/preview` | GET | Its first part and the part read next |
| `/api/documents/:id` | DELETE | Delete a document's text and its waiting phrases (cards stay) |
| `/api/candidates/:id/skip` | POST | Skip a new card: `known` (kept as a memorized card) or `not_useful`; never suggested again |
| `/api/audio?text=` | GET | Saved speech for a sentence |
| `/api/stories` | GET | Stories to pick from when starting practice |
| `/api/stories/:id/audio` | GET | Saved speech for a story |
| `/api/stories/:id` | DELETE | Delete a story and its audio |
| `/api/settings/keys/elevenlabs` | PUT, DELETE | Save or remove the ElevenLabs key |
| `/api/settings/connector` | POST, DELETE | Create (returned once) or remove the connector link |
| `/mcp/<token>` | POST | MCP tools: `get_reading`, `check_phrases`, `save_cards`, `list_cards`, `save_story` |

## D1 backups

D1 Free includes point-in-time recovery, but periodic exports are still recommended:

```bash
pnpm exec wrangler d1 export english-srs --remote --output english-srs-backup.sql
```

## Security

The app uses Better Auth email/password sessions. Pages require sign-in except `/login`; application APIs and server functions check the session and scope data to its owner. Better Auth handles its own authentication and admin endpoints; `/health` is public. Passwords are hashed with Web Crypto PBKDF2. Keep `.dev.vars` and production secrets private.

Cloudflare Access is optional. If you enable it, add an Access **Bypass** rule for `/mcp/*` so Claude and ChatGPT can reach the connector. Each connector has its own secret link, only a hash is stored, and it can access only its owner's data. Creating a new link in Settings revokes the old one; blocking or deleting an account disables its connector.
