// How much study time an amount of practice is worth (shared by the browser and the server). It is estimated from
// what was done, not measured with a clock, so pauses, distractions and slow loading never count.

// Typing: a standard word is 5 characters (as in words per minute), worth one word at a calm 40 words a minute.
const CHARS_PER_WORD = 5;
const TYPING_REFERENCE_WPM = 40;
// Listening: the time actually spent listening, capped at the audio's own length, so a faster speed never adds
// time; spoken American English runs about 150 words a minute.
const SPEAKING_WPM = 150;
// Longest stretch counted from one report (a story is under 3 minutes; this only guards against bad input).
export const MAX_LISTENING_SECONDS = 30 * 60;

export const typingWords = (characters: number) => characters / CHARS_PER_WORD;
export const typingStudySeconds = (characters: number) => (typingWords(characters) / TYPING_REFERENCE_WPM) * 60;
export const listeningWords = (seconds: number) => (seconds / 60) * SPEAKING_WPM;

export const formatMinutes = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
};
