import { Telegraf } from 'telegraf';
import { getTodayCards, getRandomCard, clearCache } from './lib/cards';
import { env } from './config/env';
import { PROBABILITIES, INTERVALS } from './constants';
import { cronLogger } from './lib/logger';
import { getDay, getHours, format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
const CHAT_ID = env.TELEGRAM_CHAT_ID;
const VIETNAM_TIMEZONE = 'Asia/Saigon';

// Track when the last card was sent to avoid long gaps
let lastCardSentTime: number | null = null;
const MAX_HOURS_WITHOUT_CARD = INTERVALS.MAX_HOURS_WITHOUT_CARD; // Force send if no card sent for 15+ minutes

function getVietnamTime(): {
  vietnamTime: Date;
  formatted: string;
  dayName: string;
  hour: number;
} {
  const now = new Date();
  const vietnamTime = toZonedTime(now, VIETNAM_TIMEZONE);
  const day = getDay(vietnamTime);
  const hour = getHours(vietnamTime);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return {
    vietnamTime,
    formatted: format(vietnamTime, 'yyyy-MM-dd HH:mm:ss'),
    dayName: dayNames[day],
    hour
  };
}

export async function sendRandomCard({ isForce = false }: { isForce?: boolean } = {}) {
  try {
    const { formatted: vnTimeFormatted, dayName, hour } = getVietnamTime();

    cronLogger.info({
      vietnamTime: vnTimeFormatted,
      day: dayName,
      hour: `${hour}:00`,
      isForce
    }, 'Cronjob triggered');

    // Clear cache when forced to get fresh data
    if (isForce) {
      clearCache();
      cronLogger.info('Force flag enabled - Cache cleared for fresh data');
    }

    // Get today's cards (cached if already fetched today) - fetch BEFORE probability check
    const cards = await getTodayCards();

    // Always log card count for debugging
    cronLogger.info({
      vietnamTime: vnTimeFormatted,
      totalCardsAvailable: cards.length,
      isForce
    }, 'Cards fetched from API');

    if (cards.length === 0) {
      cronLogger.warn({
        vietnamTime: vnTimeFormatted,
        reason: 'No cards available in database'
      }, 'Card NOT sent - No cards available');
      return;
    }

    // Check if we need to force send due to long gap
    const now = Date.now();
    const hoursSinceLastCard = lastCardSentTime ? (now - lastCardSentTime) / (1000 * 60 * 60) : null;
    const shouldForceDueToGap = hoursSinceLastCard !== null && hoursSinceLastCard >= MAX_HOURS_WITHOUT_CARD;

    if (shouldForceDueToGap) {
      cronLogger.info({
        vietnamTime: vnTimeFormatted,
        hoursSinceLastCard: hoursSinceLastCard.toFixed(1),
        maxHours: MAX_HOURS_WITHOUT_CARD
      }, 'Force sending card due to long gap');
      isForce = true;
    }

    // Random probability to send a card (skip if forced)
    if (!isForce) {
      const randomValue = Math.random();
      const shouldSend = randomValue < PROBABILITIES.SEND_CARD;

      if (!shouldSend) {
        cronLogger.info({
          vietnamTime: vnTimeFormatted,
          randomValue: randomValue.toFixed(3),
          threshold: PROBABILITIES.SEND_CARD,
          totalCardsAvailable: cards.length,
          hoursSinceLastCard: hoursSinceLastCard?.toFixed(1) || 'never',
          reason: 'Random probability check failed'
        }, 'Card NOT sent - Probability check (1/5 chance)');
        return;
      }

      cronLogger.info({
        vietnamTime: vnTimeFormatted,
        randomValue: randomValue.toFixed(3),
        threshold: PROBABILITIES.SEND_CARD,
        totalCardsAvailable: cards.length
      }, 'Probability check passed - Proceeding to send card');
    } else {
      cronLogger.info({
        vietnamTime: vnTimeFormatted,
        reason: shouldForceDueToGap ? `Long gap (${hoursSinceLastCard?.toFixed(1)}h)` : 'Force flag enabled',
        totalCardsAvailable: cards.length
      }, 'Force send - Bypassing probability check');
    }

    // Get a random card
    const card = getRandomCard(cards);

    // Format the message with card count info
    const message = `📚 <b>${card.word}</b> <i>(1/${cards.length})</i>\n\n${card.definition}`;

    // Send to Telegram group
    await bot.telegram.sendMessage(CHAT_ID, message, { parse_mode: 'HTML' });
    
    // Update last sent time
    lastCardSentTime = Date.now();
    
    cronLogger.info({
      vietnamTime: vnTimeFormatted,
      word: card.word,
      totalCardsAvailable: cards.length,
      selectionInfo: `Randomly selected 1 out of ${cards.length} cards`
    }, 'Card SENT successfully');

  } catch (error) {
    cronLogger.error({ err: error }, 'Error in cronjob execution');
  }
}
