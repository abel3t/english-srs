import { Telegraf } from 'telegraf';
import { getTodayCards, getRandomCard } from './lib/cards';
import { env } from './config/env';
import { PROBABILITIES } from './constants';
import { cronLogger } from './lib/logger';
import { getDay, getHours, format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
const CHAT_ID = env.TELEGRAM_CHAT_ID;
const VIETNAM_TIMEZONE = 'Asia/Saigon';

function isWithinWorkingHours(): {
  isWithinHours: boolean;
  vietnamTime: Date;
  day: number;
  hour: number;
  dayName: string;
} {
  // Get current time in Vietnamese timezone
  const now = new Date();
  const vietnamTime = toZonedTime(now, VIETNAM_TIMEZONE);

  const day = getDay(vietnamTime); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const hour = getHours(vietnamTime);

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[day];

  // Check if it's Monday (1) to Friday (5)
  const isWeekday = day >= 1 && day <= 5;

  // Check if it's between 9 AM (9) and 6 PM (18)
  const isWorkingHour = hour >= 9 && hour < 18;

  return {
    isWithinHours: isWeekday && isWorkingHour,
    vietnamTime,
    day,
    hour,
    dayName
  };
}

export async function sendRandomCard({ isForce = false }: { isForce?: boolean } = {}) {
  try {
    const { isWithinHours, vietnamTime, dayName, hour } = isWithinWorkingHours();
    const vnTimeFormatted = format(vietnamTime, 'yyyy-MM-dd HH:mm:ss');

    cronLogger.info({
      vietnamTime: vnTimeFormatted,
      day: dayName,
      hour: `${hour}:00`,
      isForce
    }, 'Cronjob triggered');

    // Check if within working hours
    if (!isWithinHours && !isForce) {
      cronLogger.info({
        vietnamTime: vnTimeFormatted,
        day: dayName,
        hour: `${hour}:00`,
        reason: 'Outside working hours (Mon-Fri 9AM-6PM)'
      }, 'Card NOT sent - Outside working hours');
      return;
    }

    // Random probability to send a card
    const randomValue = Math.random();
    const shouldSend = randomValue < PROBABILITIES.SEND_CARD;

    if (!shouldSend && !isForce) {
      cronLogger.info({
        vietnamTime: vnTimeFormatted,
        randomValue: randomValue.toFixed(3),
        threshold: PROBABILITIES.SEND_CARD,
        reason: 'Random probability check failed'
      }, 'Card NOT sent - Probability check (1/5 chance)');
      return;
    }

    cronLogger.info({
      vietnamTime: vnTimeFormatted,
      randomValue: randomValue.toFixed(3),
      threshold: PROBABILITIES.SEND_CARD
    }, 'Probability check passed - Proceeding to send card');

    // Get today's cards (cached if already fetched today)
    const cards = await getTodayCards();

    if (cards.length === 0) {
      cronLogger.warn({
        vietnamTime: vnTimeFormatted,
        reason: 'No cards available in database'
      }, 'Card NOT sent - No cards available');
      return;
    }

    // Get a random card
    const card = getRandomCard(cards);

    // Format the message
    const message = `📚 <b>${card.word}</b>\n\n${card.definition}`;

    // Send to Telegram group
    await bot.telegram.sendMessage(CHAT_ID, message, { parse_mode: 'HTML' });
    cronLogger.info({
      vietnamTime: vnTimeFormatted,
      word: card.word,
      totalCardsAvailable: cards.length
    }, 'Card SENT successfully');

  } catch (error) {
    cronLogger.error({ err: error }, 'Error in cronjob execution');
  }
}
