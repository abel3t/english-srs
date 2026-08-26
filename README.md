# English SRS

A personal English learning assistant deployed on Cloudflare Workers. It analyzes English encountered in real life, recommends what is worth memorizing, stores learning history in D1, and saves approved cards to Noji.

## Learning workflow

1. Open `/learn` and paste at least three words.
2. Optionally provide context, the exact confusing part, and your interpretation in English or Vietnamese.
3. Gemma 4 improves the title without changing its contextual meaning and explains real-world use, tone, register, and cultural risk.
4. D1 history helps identify duplicate or recurring language.
5. Review and edit the preview, then choose **Save to Noji** or **Skip for now**.

Analysis never saves to Noji automatically. Skipped items remain in private D1 history so repeated encounters on different days can influence later recommendations.

## Runtime architecture

```text
Cloudflare Worker
├── Dashboard, learning form, history, and JSON APIs
├── Ollama Cloud analysis
└── Noji card creation

Cloudflare D1
└── Learning history, recommendations, recurrence, Save/Skip decisions
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

Wrangler normally serves the application at `http://localhost:8787`.

Fill `.dev.vars` with local secrets:

```env
OLLAMA_API_KEY=...
NOJI_EMAIL=...
NOJI_PASSWORD=...
NOJI_DECK_ID=...
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

Copy the returned `database_id` into `wrangler.jsonc`, replacing:

```text
REPLACE_WITH_D1_DATABASE_ID
```

Add production secrets one at a time:

```bash
pnpm exec wrangler secret put OLLAMA_API_KEY
pnpm exec wrangler secret put NOJI_EMAIL
pnpm exec wrangler secret put NOJI_PASSWORD
pnpm exec wrangler secret put NOJI_DECK_ID
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
pnpm typecheck
pnpm build
```

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
| `/` | GET | Learning dashboard |
| `/health` | GET | Service health check |
| `/learn` | GET | Analyze, preview, edit, Save/Skip interface |
| `/cards` | GET | Redirect to `/learn` for old bookmarks |
| `/history` | GET | Search and filter D1 learning history |
| `/api/analyze` | POST | Analyze and create a pending D1 item; never saves to Noji |
| `/api/learning-items/:id/save` | POST | Save an approved or edited item to Noji |
| `/api/learning-items/:id/skip` | POST | Keep an item in history without creating a Noji card |
| `/api/learning-items/:id` | DELETE | Permanently delete one D1 history row; does not delete a Noji card |
| `/api/stats` | GET | Today’s analyzed/saved/skipped counts |
| `/api/review/due` | GET | Start a Noji session and return one random due card |
| `/api/review/answer` | POST | Submit Again/Hard/Good/Easy to Noji's scheduler |

## Chrome capture extension

The unpacked Manifest V3 extension in `extension/` provides both a capture inbox and a compact Noji review flow. Review mode shows a random fill-in-the-blank prompt, then the full title, then the explanation and Noji's Again/Hard/Good/Easy choices with their real intervals.

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository's `extension` directory.
4. Pin **English SRS Capture** to the toolbar.
5. Confirm captured items later from `/history`, or use **Review due** to study Noji cards.

## D1 backups

D1 Free includes point-in-time recovery, but periodic exports are still recommended:

```bash
pnpm exec wrangler d1 export english-srs --remote --output english-srs-backup.sql
```

## Security

Protect the deployed Worker with Cloudflare Access before using it as a personal application. Otherwise, anyone who discovers the URL could read learning history, consume Ollama quota, create Noji cards, or alter Noji review progress.
