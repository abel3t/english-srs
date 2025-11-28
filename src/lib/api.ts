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

// Log errors
nojiApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      apiLogger.error({
        url: error.config?.url,
        status: error.response.status,
        data: error.response.data
      }, 'API Error');
    }
    return Promise.reject(error);
  }
);
