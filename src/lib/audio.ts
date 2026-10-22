// Browser-side audio shared by every player: one playback speed for all of them (remembered on this device), only
// one sound at a time, and the URL of a sentence's saved clip.
import { useSyncExternalStore } from 'react';
import { CLIP_VERSION, CLIP_VOICE } from '@/constants';
import { recordListening } from './activity';

// The voice in the URL keeps the browser cache in step with voice changes (the server's R2 key includes it too).
export const clipUrl = (text: string) => `/api/audio?v=${CLIP_VERSION}-${CLIP_VOICE.aura}&text=${encodeURIComponent(text.replace(/\s+/g, ' ').trim())}`;

// ---------- speed ----------

// Slower than 0.75× distorts the voice; 0.05 steps leave room for fine choices just below normal speed.
export const SPEED_MIN = 0.75;
export const SPEED_MAX = 2;
export const SPEED_STEP = 0.05;

const STORAGE_KEY = 'audio-speed';
const clamp = (value: number) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(value / SPEED_STEP) * SPEED_STEP));
const listeners = new Set<() => void>();
let speed: number | null = null;

export function getAudioSpeed(): number {
  if (speed === null) {
    try { speed = clamp(Number(localStorage.getItem(STORAGE_KEY)) || 1); } catch { speed = 1; }
  }
  return speed;
}

export function setAudioSpeed(value: number) {
  speed = Math.round(clamp(value) * 100) / 100;
  try { localStorage.setItem(STORAGE_KEY, String(speed)); } catch { /* private mode: kept for this visit only */ }
  for (const element of elements) applySpeed(element);
  for (const listener of listeners) listener();
}

export function useAudioSpeed(): number {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, getAudioSpeed, () => 1);
}

export const formatSpeed = (value: number) => `${Number(value.toFixed(2))}×`;

// ---------- one sound at a time ----------

const elements = new Set<HTMLAudioElement>();

// Loading a new source resets playbackRate to defaultPlaybackRate, so both are set: a new sentence keeps the speed.
function applySpeed(element: HTMLAudioElement) {
  element.defaultPlaybackRate = getAudioSpeed();
  element.playbackRate = getAudioSpeed();
}

// Every player registers its <audio>: it follows the shared speed, starting it pauses whatever else was playing, and
// what it plays counts as listening, never inflated: the time actually spent listening when faster than normal
// (40 s at 1.5× counts 40 s), the audio's own length when slower (80 s for a 60 s clip at 0.75× counts 60 s).
// Paused time and what was skipped by seeking never count.
export function registerAudio(element: HTMLAudioElement): () => void {
  elements.add(element);
  applySpeed(element);
  let last = element.currentTime;
  let heard = 0;
  // Seeks are recognised by their own events (below), not by the size of the jump: with the screen locked the browser
  // may report the position only every few seconds, and that playback must still count. A jump back (a loop) never
  // counts; MAX_STEP only guards against a missed seek event.
  const MAX_STEP = 30;
  const advance = () => {
    const delta = element.currentTime - last;
    last = element.currentTime;
    if (delta > 0 && delta <= MAX_STEP) heard += delta / Math.max(1, element.playbackRate);
  };
  const report = () => { advance(); recordListening(heard); heard = 0; };
  const listeners: Array<[keyof HTMLMediaElementEventMap, () => void]> = [
    ['play', () => { applySpeed(element); last = element.currentTime; for (const other of elements) if (other !== element && !other.paused) other.pause(); }],
    ['timeupdate', () => { if (!element.paused) advance(); }],
    // By the time 'seeking' fires the position has already jumped: start counting again from there.
    ['seeking', () => { last = element.currentTime; }],
    ['seeked', () => { last = element.currentTime; }],
    ['pause', report],
    ['ended', () => { if (Number.isFinite(element.duration)) { const rest = element.duration - last; if (rest > 0 && rest <= MAX_STEP) heard += rest / Math.max(1, element.playbackRate); last = element.duration; } report(); }],
    // A new source (the next clip of a playlist) starts from zero.
    ['loadstart', () => { report(); last = 0; }],
  ];
  for (const [type, listener] of listeners) element.addEventListener(type, listener);
  return () => {
    for (const [type, listener] of listeners) element.removeEventListener(type, listener);
    element.pause();
    report();
    elements.delete(element);
  };
}

// An <audio> element never says why its request failed; asking again returns the server's message, e.g. that the
// ElevenLabs credits are used up. Only for story audio: asking again can make it, and that is what the play wanted.
export async function audioErrorMessage(src: string): Promise<string> {
  const fallback = 'The audio could not be loaded. Try again.';
  try {
    const response = await fetch(src, { headers: { Range: 'bytes=0-0' } });
    if (response.ok) { void response.body?.cancel(); return fallback; }
    return ((await response.json()) as { message?: string }).message || fallback;
  } catch { return fallback; }
}

export const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '--:--';
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};
