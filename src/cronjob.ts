import { Telegraf } from 'telegraf';
import { getTodayCards, getRandomCard } from './lib/cards';
import { env } from './config/env';
import { PROBABILITIES } from './constants';
import { cronLogger } from './lib/logger';

const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
const CHAT_ID = env.TELEGRAM_CHAT_ID;

export async function sendRandomCard() {
  try {
    cronLogger.info('Cronjob triggered');

    // Random probability to send a card
    const shouldSend = Math.random() < PROBABILITIES.SEND_CARD;

    if (!shouldSend) {
      cronLogger.debug('Skipped (random probability: 1/5 chance)');
      return;
    }

    cronLogger.info('Selected to send card (1/5 probability)');

    // Get today's cards (cached if already fetched today)
    const cards = await getTodayCards();

    if (cards.length === 0) {
      cronLogger.warn('No cards available');
      return;
    }

    // Get a random card
    const card = getRandomCard(cards);

    // Format the message
    const message = `📚 *${card.word}*\n\n${card.definition}`;

    // Send to Telegram group
    await bot.telegram.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
    cronLogger.info({ word: card.word }, 'Card sent successfully');

  } catch (error) {
    cronLogger.error({ err: error }, 'Error in cronjob');
  }
}
