// The app's one listening player (the mini player at the bottom): a list of tracks, the sentences of cards or a
// story's audio, that keeps playing while the learner moves between pages. Speed, one-sound-at-a-time and listening
// time come from registerAudio, like every other player.
import { useSyncExternalStore } from 'react';
import { clipUrl, registerAudio } from './audio';

export type Track = {
  src: string;
  /** What is heard, e.g. the sentence, or the story's title. */
  title: string;
  /** Where it comes from, e.g. "boil down to · Example 2". */
  subtitle?: string;
  kind: 'sentence' | 'story';
};
type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused';
type PlayerSnapshot = { tracks: Track[]; index: number; status: PlayerStatus; loop: boolean; time: number; duration: number };

const EMPTY: PlayerSnapshot = { tracks: [], index: 0, status: 'idle', loop: false, time: 0, duration: Number.NaN };
let snapshot = EMPTY;
const listeners = new Set<() => void>();
const update = (patch: Partial<PlayerSnapshot>) => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };

let audio: HTMLAudioElement | null = null;
// Clips that failed in a row; after a whole list of them the player stops instead of looping forever.
let failures = 0;

// While a track plays, the next sentence's clip is requested once, so the server makes it now (if it is new) and
// the list plays without a gap. Story audio is never fetched ahead: making it spends the learner's ElevenLabs credits.
const prepared = new Set<string>();
function prepareNext() {
  const { tracks, index, loop } = snapshot;
  const next = tracks[index + 1] ?? (loop ? tracks[0] : undefined);
  if (!next || !next.src.startsWith('/api/audio') || prepared.has(next.src)) return;
  prepared.add(next.src);
  // Only the server's work matters: the download itself is dropped as soon as it starts.
  fetch(next.src).then(response => response.body?.cancel()).catch(() => prepared.delete(next.src));
}

// ---------- lock screen, Control Center, headphones (Media Session) ----------

// Without it the phone shows the page title and a blurry favicon, and ±10 s buttons instead of previous/next.
const session = () => (typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null);

export function describe(track: Pick<Track, 'title' | 'subtitle' | 'kind'>) {
  const media = session();
  if (!media || typeof MediaMetadata === 'undefined') return;
  const art = track.kind === 'story' ? '/art-story.png' : '/art-sentence.png';
  media.metadata = new MediaMetadata({
    title: track.title, artist: track.subtitle ?? 'PhraseLoop', album: 'PhraseLoop',
    artwork: [{ src: art, sizes: '512x512', type: 'image/png' }],
  });
}

function reportPosition(player: HTMLAudioElement) {
  const media = session();
  if (!media?.setPositionState || !Number.isFinite(player.duration) || player.duration <= 0) return;
  try { media.setPositionState({ duration: player.duration, playbackRate: player.playbackRate, position: Math.min(player.currentTime, player.duration) }); } catch { /* not supported */ }
}

function connectSession() {
  const media = session();
  if (!media) return;
  const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
    ['play', () => player.toggle()],
    ['pause', () => player.toggle()],
    ['previoustrack', () => player.previous()],
    ['nexttrack', () => player.next()],
    ['stop', () => player.stop()],
    ['seekto', details => { if (details.seekTime !== undefined) player.seek(details.seekTime); }],
  ];
  for (const [action, handler] of handlers) {
    try { media.setActionHandler(action, handler); } catch { /* this browser lacks the action */ }
  }
}

// One element for the whole visit: iOS lets it go on to the next track only if it is the one the learner started.
function element(): HTMLAudioElement {
  if (audio) return audio;
  const created = new Audio();
  created.preload = 'auto';
  created.addEventListener('timeupdate', () => update({ time: created.currentTime }));
  created.addEventListener('durationchange', () => { update({ duration: created.duration }); reportPosition(created); });
  created.addEventListener('ratechange', () => reportPosition(created));
  created.addEventListener('seeked', () => reportPosition(created));
  created.addEventListener('play', () => { const media = session(); if (media) media.playbackState = 'playing'; });
  created.addEventListener('pause', () => { const media = session(); if (media) media.playbackState = 'paused'; });
  created.addEventListener('waiting', () => update({ status: 'loading' }));
  created.addEventListener('playing', () => { failures = 0; update({ status: 'playing' }); prepareNext(); });
  created.addEventListener('pause', () => { if (!created.ended && snapshot.tracks.length) update({ status: 'paused' }); });
  created.addEventListener('ended', () => advance());
  created.addEventListener('error', () => {
    if (!snapshot.tracks.length || !created.getAttribute('src')) return;
    failures += 1;
    if (failures >= snapshot.tracks.length) { update({ status: 'paused' }); return; }
    advance();
  });
  registerAudio(created);
  connectSession();
  audio = created;
  return created;
}

function load(index: number) {
  const track = snapshot.tracks[index];
  if (!track) return;
  const player = element();
  // The same source again (looping one story) fires no new durationchange, so its known length is kept.
  const same = player.getAttribute('src') === track.src;
  update({ index, status: 'loading', time: 0, duration: same ? player.duration : Number.NaN });
  describe(track);
  if (!same) player.setAttribute('src', track.src);
  player.currentTime = 0;
  player.play().catch((error: unknown) => {
    // Interrupted by the next load or by another player: nothing to do. Autoplay refused: wait for a tap.
    if (error instanceof DOMException && error.name === 'NotAllowedError') update({ status: 'paused' });
  });
}

// At the end of a track: the next one, back to the first when looping, or stop at the end of the list.
function advance() {
  const next = snapshot.index + 1;
  if (next < snapshot.tracks.length) load(next);
  else if (snapshot.loop) load(0);
  else update({ status: 'idle', time: 0 });
}

export const player = {
  play(tracks: Track[], start = 0) {
    if (!tracks.length) return;
    failures = 0;
    update({ tracks });
    load(start);
  },
  toggle() {
    if (!snapshot.tracks.length) return;
    if (snapshot.status === 'idle') { load(snapshot.index); return; }
    const player = element();
    if (player.paused) player.play().catch(() => update({ status: 'paused' }));
    else player.pause();
  },
  next() { if (snapshot.tracks.length) load((snapshot.index + 1) % snapshot.tracks.length); },
  // Like music players: back to the start of the track, or to the previous one when just started.
  previous() {
    if (!snapshot.tracks.length) return;
    if (snapshot.time > 3) { element().currentTime = 0; return; }
    load(Math.max(0, snapshot.index - 1));
  },
  seek(seconds: number) { if (audio) { audio.currentTime = seconds; update({ time: seconds }); } },
  setLoop(loop: boolean) { update({ loop }); },
  stop() {
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    const media = session();
    if (media) { media.metadata = null; media.playbackState = 'none'; }
    update({ ...EMPTY, loop: snapshot.loop });
  },
};

export function usePlayer(): PlayerSnapshot {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => snapshot, () => EMPTY);
}

// Tracks for typed sentences: their saved Aura-2 clips.
export const sentenceTrack = (text: string, subtitle?: string): Track => ({ src: clipUrl(text), title: text, subtitle, kind: 'sentence' });
