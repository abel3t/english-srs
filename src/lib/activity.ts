// Browser side of study tracking: what was typed or heard is queued and sent in small batches (a few seconds
// after the last activity, or when the page is hidden), so practice never waits for the network.
import type { ActivityInput } from './activity-db';

const queue: ActivityInput[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
const FLUSH_AFTER_MS = 4000;

function flush(beacon = false) {
  clearTimeout(timer);
  if (!queue.length) return;
  const body = JSON.stringify({ items: queue.splice(0, 100) });
  // sendBeacon survives the tab closing; fetch with keepalive is the fallback.
  if (beacon && navigator.sendBeacon?.('/api/activity', new Blob([body], { type: 'application/json' }))) return;
  void fetch('/api/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
  if (queue.length) flush(beacon);
}

function push(item: ActivityInput) {
  queue.push(item);
  clearTimeout(timer);
  timer = setTimeout(flush, FLUSH_AFTER_MS);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
  window.addEventListener('pagehide', () => flush(true));
}

// A sentence typed to the end: counted even before a rating, and again for every retype.
export function recordTyping(text: string, accuracy: number) {
  if (text.trim()) push({ kind: 'typing', characters: Math.min(text.length, 2000), accuracy });
}

// Time spent listening, in seconds, never more than the audio's own length (see registerAudio).
export function recordListening(seconds: number) {
  if (seconds >= 0.5) push({ kind: 'listening', seconds: Math.min(seconds, 1800) });
}
