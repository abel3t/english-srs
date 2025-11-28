import 'dotenv/config';
import { z } from 'zod';
import pino from 'pino';

// Early logger for env validation (before main logger is configured)
const envLogger = pino({
  level: 'error',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname'
    }
  }
});

const envSchema = z.object({
  // Noji Configuration
  NOJI_EMAIL: z.string().email('Invalid email format'),
  NOJI_PASSWORD: z.string().min(1, 'Password is required'),
  NOJI_DECK_ID: z.string().min(1, 'At least one deck ID is required'),

  // Telegram Configuration
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'Telegram bot token is required'),
  TELEGRAM_CHAT_ID: z.string().min(1, 'Telegram chat ID is required'),

  // Server Configuration
  PORT: z.string().default('3000').transform(Number),

  // Optional: Node Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  GEMINI_API_KEY: z.string().min(1, 'Gemini API key is required')
});

type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      envLogger.error('Invalid environment variables:');
      for (const err of error.errors) {
        envLogger.error(`  - ${err.path.join('.')}: ${err.message}`);
      }
      process.exit(1);
    }
    throw error;
  }
}

export const env = validateEnv();
