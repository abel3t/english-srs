import { nojiApi } from './api';
import { getValidToken } from './auth';
import { env } from '../config/env';
import { API, CARD_SECTIONS } from '../constants';
import type { Card, CardCache, CacheInfo, NojiNote } from '../types';
import { cacheLogger, apiLogger } from './logger';

let cardCache: CardCache | null = null;

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

function formatDefinition(text: string): string {
  // If already has newlines, return as is (from content field)
  if (text.includes('\n')) {
    // Convert markdown asterisks to HTML bold
    return text.replace(/\*([^*]+)\*/g, '<b>$1</b>');
  }

  // Format preview text (no newlines) by adding line breaks and bold
  let formatted = text;

  // Add bold and line breaks to section headers
  for (const header of CARD_SECTIONS) {
    const regex = new RegExp(`\\s+(${header}:)\\s*`, 'gi');
    formatted = formatted.replace(regex, '\n\n<b>$1</b>\n');
  }

  // Add newline before translations (before →)
  formatted = formatted
    .replace(/\s+(→)/g, '\n$1')
    // Add newline between bullet points (after translation before next •)
    .replace(/(→[^•]+?)\s+•/g, '$1\n• ')
    // Add newline before section headers that come after bullets
    .replace(/(→[^•]+?)\s+\*([A-Z])/g, '$1\n\n<b>$2');

  // Convert remaining markdown asterisks to HTML bold
  formatted = formatted.replace(/\*([^*]+)\*/g, '<b>$1</b>');

  return formatted.trim();
}

async function fetchCardsFromDeck(token: string, deckId: string): Promise<Card[]> {
  const cards: Card[] = [];
  let offset = 0;

  apiLogger.info({ deckId }, 'Fetching cards from deck...');

  while (true) {
    const { data } = await nojiApi.get('/notes', {
      params: {
        deck_id: deckId,
        frozen: false,
        learning_state: 'learning',
        limit: API.NOTES_LIMIT,
        offset,
        order: 'DESC',
        sort_by: 'created_at'
      },
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    if (data.length === 0) break;

    const batch = data
      .map((card: NojiNote) => {
        const word = card.front?.content?.[0]?.text || card.front?.preview || card.term || '';
        const rawDefinition = card.back?.content?.[0]?.text || card.back?.preview || card.meaning || '';

        // Format definition (adds line breaks if needed)
        const definition = formatDefinition(rawDefinition);

        return { word, definition };
      })
      .filter((c: Card) => c.word && c.definition);

    cards.push(...batch);
    offset += API.NOTES_LIMIT;

    if (data.length < API.NOTES_LIMIT) break;
  }

  apiLogger.info({ deckId, count: cards.length }, 'Fetched cards from deck');
  return cards;
}

export async function getTodayCards(): Promise<Card[]> {
  const today = getTodayDate();

  // Check if we have cached cards for today
  if (cardCache) {
    cacheLogger.debug({ date: cardCache.date, today, count: cardCache.cards.length }, 'Checking cache');

    if (cardCache.date === today && cardCache.cards.length > 0) {
      cacheLogger.info({ count: cardCache.cards.length }, 'Using cached cards - No API call');
      return cardCache.cards;
    }

    cacheLogger.info('Cache expired or empty, fetching fresh data...');
  } else {
    cacheLogger.info('No cache found, fetching from API...');
  }

  // Fetch cards from Noji API
  apiLogger.info('Fetching cards from Noji API...');
  const token = await getValidToken();
  const deckIds = env.NOJI_DECK_ID;

  // Support multiple deck IDs (comma-separated)
  const deckIdList = deckIds.split(',').map(id => id.trim()).filter(id => id);

  if (deckIdList.length === 0) {
    throw new Error('At least one NOJI_DECK_ID is required');
  }

  apiLogger.info({ deckCount: deckIdList.length }, 'Fetching from multiple decks...');

  // Fetch cards from all decks
  const allCards: Card[] = [];
  for (const deckId of deckIdList) {
    const cards = await fetchCardsFromDeck(token, deckId);
    allCards.push(...cards);
  }

  apiLogger.info({ totalCards: allCards.length }, 'Total cards fetched from all decks');

  // Cache cards for today
  cardCache = {
    cards: allCards,
    date: today
  };

  cacheLogger.info({ date: today, count: allCards.length }, 'Cards cached');

  return allCards;
}

export function getRandomCard(cards: Card[]): Card {
  return cards[Math.floor(Math.random() * cards.length)];
}

export function clearCache(): void {
  if (cardCache) {
    cacheLogger.info({ count: cardCache.cards.length, date: cardCache.date }, 'Clearing cache');
    cardCache = null;
  } else {
    cacheLogger.info('No cache to clear');
  }
}

export function getCacheInfo(): CacheInfo {
  if (cardCache) {
    return {
      cached: true,
      date: cardCache.date,
      count: cardCache.cards.length
    };
  }
  return { cached: false };
}
