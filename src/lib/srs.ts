// A small SM-2 style scheduler. New/learning cards step through minutes before graduating to days;
// review cards grow by their ease factor. Kept dependency-free so the browser can preview intervals too.
export type Rating = 'again' | 'hard' | 'good' | 'easy';
export type CardState = 'new' | 'learning' | 'review';
export type Schedule = { state: CardState; intervalDays: number; ease: number; reps: number; lapses: number };
export type NextSchedule = Schedule & { dueAt: Date };

export const ratings: Rating[] = ['again', 'hard', 'good', 'easy'];

const MINUTE = 1 / (24 * 60);
const MIN_EASE = 1.3;
const MAX_INTERVAL = 365;

export function nextSchedule(current: Schedule, rating: Rating, now = new Date()): NextSchedule {
  let { state, intervalDays, ease, reps, lapses } = current;
  reps += 1;

  if (state !== 'review') {
    const steps: Record<Rating, [CardState, number]> = {
      again: ['learning', 1 * MINUTE], hard: ['learning', 10 * MINUTE], good: ['review', 1], easy: ['review', 4],
    };
    [state, intervalDays] = steps[rating];
    if (rating === 'easy') ease += 0.15;
  } else if (rating === 'again') {
    state = 'learning'; intervalDays = 10 * MINUTE; lapses += 1; ease -= 0.2;
  } else {
    const factor = rating === 'hard' ? 1.2 : rating === 'good' ? ease : ease * 1.3;
    const minimum = rating === 'hard' ? intervalDays : intervalDays + 1;
    intervalDays = Math.min(MAX_INTERVAL, Math.max(minimum, intervalDays * factor));
    if (rating === 'hard') ease -= 0.15;
    if (rating === 'easy') ease += 0.15;
  }

  ease = Math.max(MIN_EASE, Math.round(ease * 100) / 100);
  return { state, intervalDays, ease, reps, lapses, dueAt: new Date(now.getTime() + intervalDays * 86_400_000) };
}

export function formatInterval(days: number): string {
  const minutes = Math.round(days * 24 * 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30).toFixed(1).replace(/\.0$/, '')}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y`;
}
