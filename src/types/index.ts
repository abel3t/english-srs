// Card types
export type Card = {
  word: string;
  definition: string;
  nextReviewAt?: number; // Unix timestamp in seconds
};

export type CardCache = {
  cards: Card[];
  expiresAt: number; // Timestamp
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
  nextReviewAt?: number; // Unix timestamp in seconds
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
  expiresAt?: number;
  expiresIn?: string; // Human-readable time remaining
  count?: number;
};
