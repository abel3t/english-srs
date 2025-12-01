import axios from 'axios';
import { apiLogger } from './logger';

export const nojiApi = axios.create({
  baseURL: 'https://api-de.noji.io/api',
  headers: {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.6',
    'app-features': 'clozeCardV2,hierarchySchemaV2,imageOcclusion,cardPresets',
    'app-language': 'en',
    'app-platform': 'Mac OS',
    'app-version': '2.14.0',
    'content-type': 'application/json',
    'origin': 'https://noji.io',
    'referer': 'https://noji.io/',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
  }
});

// Add current timestamp to each request
nojiApi.interceptors.request.use((config) => {
  config.headers['current-time'] = Math.floor(Date.now() / 1000).toString();
  return config;
});

// Auto-retry with fresh token on 401 errors
let isRefreshing = false;
let failedQueue: Array<{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> = [];

const processQueue = (error: unknown = null) => {
  for (const prom of failedQueue) {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(null);
    }
  }
  failedQueue = [];
};

nojiApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response) {
      apiLogger.error({
        url: error.config?.url,
        status: error.response.status,
        data: error.response.data
      }, 'API Error');

      // Handle 401 (unauthorized) or 422 (deck access issues) - token might be expired or permissions changed
      if ((error.response.status === 401 || error.response.status === 422) && !originalRequest._retry) {
        if (isRefreshing) {
          // Queue this request while token is being refreshed
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          }).then(() => {
            return nojiApi(originalRequest);
          });
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
          apiLogger.info(`Token expired or access issue (${error.response.status}), re-authenticating...`);
          // Dynamically import to avoid circular dependency
          const { getValidToken } = await import('./auth');
          const newToken = await getValidToken();

          // Update the failed request with new token
          originalRequest.headers.authorization = `Bearer ${newToken}`;

          processQueue();
          apiLogger.info('Re-authentication successful, retrying request');
          return nojiApi(originalRequest);
        } catch (refreshError) {
          processQueue(refreshError);
          apiLogger.error({ err: refreshError }, 'Re-authentication failed');
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      }
    }

    return Promise.reject(error);
  }
);
