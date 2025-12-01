import { nojiApi } from './api';
import { getValidToken } from './auth';
import { env } from '../config/env';
import { API, INTERVALS } from '../constants';
import type { Card, CardCache, CacheInfo, NojiNote } from '../types';
import { cacheLogger, apiLogger } from './logger';

let cardCache: CardCache | null = null;

function formatDefinition(text: string): string {
  let formatted = text;

  // Convert markdown asterisks to HTML bold
  formatted = formatted.replace(/\*([^*]+)\*/g, '<b>$1</b>');

  // Add line breaks BEFORE section headers with colons (IPA:, Synonyms:, Antonyms:)
  // Match anywhere in text, not just at line start
  formatted = formatted.replace(/\s+(IPA|Synonyms?|Antonyms?)\s*:/g, '\n\n<b>$1:</b>');

  // Add line breaks BEFORE section headers WITHOUT colons (Examples, Collocations, Usage, Origin)
  // Match when preceded by whitespace
  formatted = formatted.replace(/\s+(Examples?|Collocations?|Usage|Origin)(\s+)/g, '\n\n<b>$1</b>\n');

  // Add newline before translations (before →)
  formatted = formatted
    .replace(/\s+(→)/g, '\n$1')
    // Add newline between bullet points
    .replace(/(→[^•]+?)\s+•/g, '$1\n• ');

  // Handle sound tags: ensure they're on their own line with proper spacing
  formatted = formatted.replace(/\s*(\[sound:[^\]]+\])\s*/g, '\n\n$1');

  // Clean up multiple consecutive newlines (max 2)
  formatted = formatted.replace(/\n{3,}/g, '\n\n');

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

        // Log full card data for debugging
        console.log('Card data:', { 
          word, 
          nextReviewAt: card.nextReviewAt,
          nextReviewDate: card.nextReviewAt ? new Date(card.nextReviewAt * 1000).toISOString() : null
        });

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
  const now = Date.now();

  // Check if we have valid cached cards
  if (cardCache) {
    const isExpired = cardCache.expiresAt <= now;
    const timeRemaining = Math.max(0, cardCache.expiresAt - now);
    const minutesRemaining = Math.floor(timeRemaining / 60000);

    cacheLogger.debug({
      expiresAt: new Date(cardCache.expiresAt).toISOString(),
      minutesRemaining,
      count: cardCache.cards.length
    }, 'Checking cache');

    if (!isExpired && cardCache.cards.length > 0) {
      cacheLogger.info({
        count: cardCache.cards.length,
        minutesRemaining
      }, 'Using cached cards - No API call');
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
  let retriedWithFreshToken = false;
  
  for (const deckId of deckIdList) {
    try {
      const cards = await fetchCardsFromDeck(token, deckId);
      allCards.push(...cards);
    } catch (error: unknown) {
      const axiosError = error as { response?: { status: number; data?: { error?: { title: string } } } };
      
      // Handle private deck errors
      if (axiosError.response?.status === 422 && axiosError.response?.data?.error?.title === 'This deck is private') {
        // If we haven't tried with a fresh token yet, force re-authentication and retry
        if (!retriedWithFreshToken) {
          apiLogger.info({ deckId }, 'Private deck error - attempting fresh login to get updated permissions');
          retriedWithFreshToken = true;
          
          // Force fresh login to get a new token with potentially updated permissions
          const freshToken = await getValidToken(true);
          
          try {
            const cards = await fetchCardsFromDeck(freshToken, deckId);
            allCards.push(...cards);
            apiLogger.info({ deckId }, 'Successfully accessed deck after fresh login');
            continue;
          } catch (retryError: unknown) {
            const retryAxiosError = retryError as { response?: { status: number; data?: { error?: { title: string } } } };
            if (retryAxiosError.response?.status === 422 && retryAxiosError.response?.data?.error?.title === 'This deck is private') {
              apiLogger.warn({ deckId, error: retryAxiosError.response.data.error }, 'Deck still private after fresh login - skipping');
              continue;
            }
            throw retryError;
          }
        } else {
          // Already retried with fresh token, skip this deck
          apiLogger.warn({ deckId, error: axiosError.response.data.error }, 'Skipping private deck');
          continue;
        }
      }
      
      // Re-throw other errors
      throw error;
    }
  }

  apiLogger.info({ totalCards: allCards.length }, 'Total cards fetched from all decks');

  // Cache cards with 1 hour expiration
  const expiresAt = now + INTERVALS.CARD_CACHE_DURATION;
  cardCache = {
    cards: allCards,
    expiresAt
  };

  cacheLogger.info({
    expiresAt: new Date(expiresAt).toISOString(),
    count: allCards.length,
    durationMinutes: INTERVALS.CARD_CACHE_DURATION / 60000
  }, 'Cards cached');

  return allCards;
}

export function getRandomCard(cards: Card[]): Card {
  return cards[Math.floor(Math.random() * cards.length)];
}

export function clearCache(): void {
  if (cardCache) {
    cacheLogger.info({
      count: cardCache.cards.length,
      expiresAt: new Date(cardCache.expiresAt).toISOString()
    }, 'Clearing cache');
    cardCache = null;
  } else {
    cacheLogger.info('No cache to clear');
  }
}

export function getCacheInfo(): CacheInfo {
  if (cardCache) {
    const now = Date.now();
    const timeRemaining = Math.max(0, cardCache.expiresAt - now);
    const minutesRemaining = Math.floor(timeRemaining / 60000);
    const secondsRemaining = Math.floor((timeRemaining % 60000) / 1000);

    return {
      cached: true,
      expiresAt: cardCache.expiresAt,
      expiresIn: `${minutesRemaining}m ${secondsRemaining}s`,
      count: cardCache.cards.length
    };
  }
  return { cached: false };
}
