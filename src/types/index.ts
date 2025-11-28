// Card types
export type Card = {
  word: string;
  definition: string;
};

export type CardCache = {
  cards: Card[];
  date: string; // YYYY-MM-DD
};

// Noji API types
export type NojiNote = {
  front?: {
    content?: Array<{ text: string }>;
    preview?: string;
  };
  term?: string;
  back?: {
    content?: Array<{ text: string }>;
    preview?: string;
  };
  meaning?: string;
};

export type NojiLoginResponse = {
  token: string;
};

// Token cache
export type TokenCache = {
  token: string;
  expiresAt: number;
};

// Cache info response
export type CacheInfo = {
  cached: boolean;
  date?: string;
  count?: number;
};
