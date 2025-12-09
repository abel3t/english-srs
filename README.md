# English SRS

Automated English learning system that sends vocabulary cards from Noji to Telegram every minute.

## Features

- 🔐 **Smart Authentication**: Automatic token caching with expiry handling (refreshes every 23 hours)
- 📦 **Daily Card Caching**: Fetches cards from Noji once per day to avoid rate limiting
- ⏱️ **Automated Delivery**: Cronjob runs every minute, sends a card with 1/5 probability (~1 card every 5 minutes)
- 🔔 **Multi-device Notifications**: Receive learning cards on all your devices via Telegram
- 🌐 **API Endpoints**: Manage cache and trigger cards via HTTP API
- 🎨 **Auto-formatting**: Automatically formats cards with proper spacing and bold headers

## Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in your credentials in `.env`:
   - `NOJI_EMAIL`: Your Noji account email
   - `NOJI_PASSWORD`: Your Noji account password
   - `TELEGRAM_BOT_TOKEN`: Your Telegram bot token (get from @BotFather)
   - `TELEGRAM_CHAT_ID`: Your Telegram group chat ID

3. Install dependencies:
   ```bash
   pnpm install
   ```

4. Run the service:
   ```bash
   pnpm dev
   ```

## How It Works

1. **Authentication**: On first run, logs into Noji and caches the token for 23 hours
2. **Card Fetching**: Once per day, fetches all cards from your Noji deck and caches them
3. **Cronjob**: Runs every minute, randomly sends a card with 1/5 probability (~1 card per 5 minutes)
4. **Auto-refresh**: Token and cards are automatically refreshed when expired
5. **API Server**: Hono.js server runs on port 3000 for cache management

## API Endpoints

The service runs a REST API server (default port 3000):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/cache` | GET | Get cache info (date, count) |
| `/cache/clear` | POST | Clear the card cache |
| `/cache/refresh` | POST | Force refresh cache from Noji |
| `/send` | POST | Manually send a card to Telegram |
| `/cards?q=word` | GET | Generate card definition using Gemini AI |

### Examples

```bash
# Check cache status
curl http://localhost:3000/cache

# Clear cache
curl -X POST http://localhost:3000/cache/clear

# Force refresh cache
curl -X POST http://localhost:3000/cache/refresh

# Send a card immediately
curl -X POST http://localhost:3000/send

# Generate card definition with AI
curl "http://localhost:3000/cards?q=break%20the%20ice"
```

## Card Structure

The system auto-formats cards with these recognized keywords (auto-bold and line breaks):

- `IPA:`, `Pronunciation:` - Phonetic information
- `Meaning:`, `Definition:` - Word meaning
- `Examples:` - Usage examples
- `Usage:` - Usage notes
- `Collocations:` - Common word combinations
- `Synonyms:`, `Antonyms:` - Related words
- `Grammar:` - Grammar notes
- `Common mistakes:` - Things to avoid

### Example Card in Noji

**Front:** `break the ice`

**Back:**
```
idiom to make people feel comfortable (phá vỡ sự ngại ngùng) Examples: • He told a joke to break the ice. → Anh ấy kể chuyện cười để phá tan bầu không khí. • Playing games helps break the ice. → Chơi trò chơi giúp mọi người thoải mái hơn. Usage: Often used at meetings, parties, or when meeting new people.
```

**Displays in Telegram as:**
```
📚 break the ice

idiom to make people feel comfortable (phá vỡ sự ngại ngùng)

*Examples:*
• He told a joke to break the ice.
→ Anh ấy kể chuyện cười để phá tan bầu không khí.
• Playing games helps break the ice.
→ Chơi trò chơi giúp mọi người thoải mái hơn.

*Usage:*
Often used at meetings, parties, or when meeting new people.
```

## Project Structure

```
src/
├── config/
│   └── env.ts           # Environment variables validation (Zod)
├── lib/
│   ├── api.ts           # Shared axios instance with Noji headers
│   ├── auth.ts          # Authentication and token caching
│   ├── cards.ts         # Card fetching and caching
│   └── logger.ts        # Pino logger configuration
├── constants/
│   └── index.ts         # Application constants & prompts
├── types/
│   └── index.ts         # TypeScript type definitions
├── index.ts             # Entry point (Hono server + cronjob)
└── cronjob.ts           # Cronjob logic for sending cards
```

## Key Features

### Environment Validation (Zod)
All environment variables are validated at startup:
```typescript
import { env } from './config/env';
env.NOJI_EMAIL // Type-safe, validated email
```

### Shared Axios Instance
Centralized API configuration with automatic headers:
```typescript
import { nojiApi } from './lib/api';
// Automatically includes Noji headers and timestamps
```

### Constants Management
All magic numbers and configurations in one place:
```typescript
import { INTERVALS, PROBABILITIES, API } from './constants';
```

### Structured Logging (Pino)
Professional logging with pino and pino-pretty:
```typescript
import { logger, authLogger, cacheLogger, apiLogger, cronLogger } from './lib/logger';

// Use child loggers for different modules
authLogger.info('Login successful');
cacheLogger.info({ count: 150 }, 'Cards cached');
apiLogger.error({ err: error }, 'API request failed');
```

**Features:**
- Colored output in development with pino-pretty
- Structured JSON logs in production
- Module-specific child loggers
- Automatic timestamp formatting
- Performance optimized
