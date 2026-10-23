// The review schedule. A new card is first drilled: every text (the phrase and each example) typed DRILL_TIMES
// times, read aloud. Then it climbs a ladder of growing gaps, the forgetting curve's spacing (Leitner/Pimsleur-like):
// each review moves it up or down depending on how well it was remembered. Dependency-free so the browser can show
// the next intervals too.
export type Rating = 'again' | 'hard' | 'good' | 'easy';
export type CardState = 'new' | 'learning' | 'review';

export const ratings: Rating[] = ['again', 'hard', 'good', 'easy'];

// Typings of each text before a new card counts as learned.
export const DRILL_TIMES = 10;

// When a card turns 1, 3, 6 and 12 months old, its next review is rated only once every text (the phrase and each
// example) is typed, so a phrase learned a while ago is not just skimmed; any other review needs one typing.
const TYPE_ALL_AGES_DAYS = [30, 91, 182, 365];
export function typeAllTexts(card: { createdAt: string; lastReviewedAt: string | null }, now = new Date()): boolean {
  const age = (at: Date) => (at.getTime() - new Date(card.createdAt).getTime()) / 86_400_000;
  const before = card.lastReviewedAt ? age(new Date(card.lastReviewedAt)) : 0;
  return TYPE_ALL_AGES_DAYS.some(days => before < days && age(now) >= days);
}

const HOUR = 1 / 24;
// Gaps in days after each step: 1 hour, 1 day, 3 days, a week, 2 weeks, a month, 2 months, then 4, 8 months, a year.
export const LADDER = [HOUR, 1, 3, 7, 14, 30, 60, 120, 240, 365] as const;

type Schedule = { state: CardState; step: number; reps: number; lapses: number };
type NextSchedule = Schedule & { intervalDays: number; dueAt: Date };

const at = (step: number, now: Date) => ({ intervalDays: LADDER[step], dueAt: new Date(now.getTime() + LADDER[step] * 86_400_000) });

// The drill is done: first review an hour later.
export function afterDrill(current: Pick<Schedule, 'reps' | 'lapses'>, now = new Date()): NextSchedule {
  return { state: 'learning', step: 0, reps: current.reps + 1, lapses: current.lapses, ...at(0, now) };
}

// Didn't know: back to the first step (an hour). Unsure: the same gap again. Confident: one step up. Easy: two.
export function nextSchedule(current: Schedule, rating: Rating, now = new Date()): NextSchedule {
  const top = LADDER.length - 1;
  const step = rating === 'again' ? 0 : rating === 'hard' ? current.step : Math.min(top, current.step + (rating === 'easy' ? 2 : 1));
  return {
    state: step === 0 ? 'learning' : 'review',
    step,
    reps: current.reps + 1,
    lapses: current.lapses + (rating === 'again' && current.step > 0 ? 1 : 0),
    ...at(step, now),
  };
}

// The step whose gap is closest to (not above) a number of days, e.g. 30 → the month step.
export function stepFor(days: number): number {
  let step = 0;
  LADDER.forEach((gap, index) => { if (gap <= days + 1e-9) step = index; });
  return step;
}

export function formatInterval(days: number): string {
  const minutes = Math.round(days * 24 * 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30).toFixed(1).replace(/\.0$/, '')}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y`;
}
