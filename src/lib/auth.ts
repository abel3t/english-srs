import { nojiApi } from './api';
import { env } from '../config/env';
import { INTERVALS } from '../constants';
import type { TokenCache, NojiLoginResponse } from '../types';
import { authLogger } from './logger';

let tokenCache: TokenCache | null = null;

export async function getValidToken(): Promise<string> {
  // Check if we have a valid cached token
  if (tokenCache) {
    const now = Date.now();
    const isExpired = tokenCache.expiresAt <= now;

    if (!isExpired) {
      authLogger.info('Using cached token');
      return tokenCache.token;
    }
    authLogger.info('Token expired, logging in again');
  }

  // Login to get a new token
  authLogger.info('Logging in to Noji API...');

  try {
    const { data } = await nojiApi.post<NojiLoginResponse>('/authentication/login_with_provider', {
      provider: 'email',
      email: env.NOJI_EMAIL,
      password: env.NOJI_PASSWORD
    });

    if (!data.token) {
      throw new Error('Login response did not contain a token');
    }

    // Cache token
    tokenCache = {
      token: data.token,
      expiresAt: Date.now() + INTERVALS.TOKEN_CACHE_DURATION
    };

    authLogger.info('Login successful, token cached');
    return data.token;
  } catch (error) {
    authLogger.error({ err: error }, 'Login failed');
    throw error;
  }
}
