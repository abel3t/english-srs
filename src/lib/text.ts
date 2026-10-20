export function normalizeText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

const TIME_ZONE = 'Asia/Ho_Chi_Minh';

export function learningDateKey(timestamp: string | Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(typeof timestamp === 'string' ? new Date(timestamp) : timestamp);
}

// Vietnam has no daylight saving time, so the learner's day always starts at 00:00 UTC+7.
export function startOfLearningDay(now = new Date()): string {
  const offset = 7 * 3_600_000;
  return new Date(Math.floor((now.getTime() + offset) / 86_400_000) * 86_400_000 - offset).toISOString();
}

export function ftsQuery(input: string): string {
  const stop = new Set(['the','a','an','to','of','in','on','at','for','and','or','is','are','was','were','be','this','that','it','i','you']);
  return [...new Set(normalizeText(input).split(' ').filter(token => token.length > 2 && !stop.has(token)))]
    .sort((a, b) => b.length - a.length).slice(0, 6).map(token => `"${token.replace(/"/g, '""')}"`).join(' OR ');
}
