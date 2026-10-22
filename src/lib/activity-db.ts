import { MAX_LISTENING_SECONDS, listeningWords, typingStudySeconds, typingWords } from './study';

// The learner's study activity: sentences typed and audio heard, and the Today dashboard built from them.
// Days are the learner's days in Vietnam (UTC+7, no daylight saving time).
export type ActivityInput = { kind: 'typing'; characters: number; accuracy?: number } | { kind: 'listening'; seconds: number };

export async function recordActivities(db: D1Database, userId: string, items: ActivityInput[]): Promise<void> {
  if (!items.length) return;
  const now = new Date().toISOString();
  const insert = db.prepare('INSERT INTO Activities (userId, kind, words, studySeconds, accuracy, createdAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6)');
  await db.batch(items.map(item => (item.kind === 'typing'
    ? insert.bind(userId, 'typing', typingWords(item.characters), typingStudySeconds(item.characters), item.accuracy ?? null, now)
    : insert.bind(userId, 'listening', listeningWords(Math.min(item.seconds, MAX_LISTENING_SECONDS)), Math.min(item.seconds, MAX_LISTENING_SECONDS), null, now))));
}

export type StudyDay = { day: string; typingSeconds: number; listeningSeconds: number; sentences: number };
type StudyStats = { today: StudyDay; days: StudyDay[]; streak: number; weekSeconds: number };

const DAYS_SHOWN = 14;
const OFFSET = 7 * 3_600_000;
const dayKey = (time: number) => new Date(time + OFFSET).toISOString().slice(0, 10);
const empty = (day: string): StudyDay => ({ day, typingSeconds: 0, listeningSeconds: 0, sentences: 0 });

export async function getStudyStats(db: D1Database, userId: string, now = Date.now()): Promise<StudyStats> {
  const keys = Array.from({ length: DAYS_SHOWN }, (_, index) => dayKey(now - (DAYS_SHOWN - 1 - index) * 86_400_000));
  const since = new Date(Date.parse(`${keys[0]}T00:00:00Z`) - OFFSET).toISOString();
  const [totals, activeDays] = await db.batch<{ day: string; kind: 'typing' | 'listening'; seconds: number; count: number }>([
    db.prepare(`SELECT date(createdAt, '+7 hours') AS day, kind, SUM(studySeconds) AS seconds, COUNT(*) AS count
      FROM Activities WHERE userId = ?1 AND createdAt >= ?2 GROUP BY day, kind`).bind(userId, since),
    db.prepare(`SELECT DISTINCT date(createdAt, '+7 hours') AS day FROM Activities WHERE userId = ?1 ORDER BY day DESC LIMIT 400`).bind(userId),
  ]);
  const byDay = new Map(keys.map(key => [key, empty(key)]));
  for (const row of totals.results) {
    const day = byDay.get(row.day);
    if (!day) continue;
    if (row.kind === 'typing') { day.typingSeconds = row.seconds; day.sentences = row.count; } else day.listeningSeconds = row.seconds;
  }
  const days = keys.map(key => byDay.get(key)!);

  // Days in a row with some study, ending today (or yesterday, so the streak is not lost before today's practice).
  const active = new Set(activeDays.results.map(row => row.day));
  let streak = 0;
  let cursor = now - (active.has(dayKey(now)) ? 0 : 86_400_000);
  while (active.has(dayKey(cursor))) { streak += 1; cursor -= 86_400_000; }

  const weekSeconds = days.slice(-7).reduce((total, day) => total + day.typingSeconds + day.listeningSeconds, 0);
  return { today: days[days.length - 1], days, streak, weekSeconds };
}
