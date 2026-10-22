import { useState } from 'react';
import type { StudyDay } from '@/lib/activity-db';
import { formatMinutes } from '@/lib/study';

// Validated pair (light surface): typing = slot 1 blue, listening = slot 2 orange.
const SERIES = [
  { key: 'typingSeconds', label: 'Typing', color: '#2a78d6' },
  { key: 'listeningSeconds', label: 'Listening', color: '#eb6834' },
] as const;

const CHART_HEIGHT = 120;
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
const dateLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Study minutes per day, typing and listening stacked, with a hover tooltip and a table for screen readers.
export function StudyChart({ days }: { days: StudyDay[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const totals = days.map(day => day.typingSeconds + day.listeningSeconds);
  // Round the scale up to whole 5 minutes so the top label is a clean number.
  const max = Math.max(5 * 60, Math.ceil(Math.max(...totals) / 300) * 300);
  const shown = hovered === null ? null : days[hovered];

  return (
    <figure className="grid gap-2">
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {SERIES.map(series => (
          <span key={series.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: series.color }} aria-hidden />{series.label}
          </span>
        ))}
        <span className="ml-auto tabular-nums">{formatMinutes(max)} max</span>
      </div>
      <div className="relative" onMouseLeave={() => setHovered(null)}>
        <div className="flex items-end gap-1 border-b border-border" style={{ height: CHART_HEIGHT }} aria-hidden>
          {days.map((day, index) => {
            const total = totals[index];
            return (
              // The hit target is the whole column, taller and wider than the bar.
              <div key={day.day} className="flex h-full flex-1 cursor-default items-end justify-center" onMouseEnter={() => setHovered(index)}>
                <div className={`flex w-full max-w-6 flex-col-reverse gap-[2px] transition-opacity ${hovered !== null && hovered !== index ? 'opacity-50' : ''}`}
                  style={{ height: `${(total / max) * 100}%` }}>
                  {SERIES.map(series => day[series.key] > 0 && (
                    <div key={series.key} className="w-full first:rounded-b-none last:rounded-t-[4px]"
                      style={{ background: series.color, flexGrow: day[series.key], minHeight: 2 }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex gap-1 text-[10px] text-muted-foreground" aria-hidden>
          {days.map((day, index) => (
            <span key={day.day} className="flex-1 text-center">{index === days.length - 1 ? 'Today' : index % 2 === (days.length - 1) % 2 ? weekday(day.day) : ''}</span>
          ))}
        </div>
        {shown && hovered !== null && (
          <div className="pointer-events-none absolute -top-2 z-10 w-44 -translate-y-full rounded-lg bg-popover p-2.5 text-xs shadow-md ring-1 ring-foreground/10"
            style={{ left: `clamp(0px, calc(${((hovered + 0.5) / days.length) * 100}% - 5.5rem), calc(100% - 11rem))` }}>
            <p className="font-medium">{hovered === days.length - 1 ? 'Today' : `${weekday(shown.day)} ${dateLabel(shown.day)}`}</p>
            {SERIES.map(series => (
              <p key={series.key} className="mt-1 flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: series.color }} aria-hidden />
                {series.label}<span className="ml-auto tabular-nums">{formatMinutes(shown[series.key])}</span>
              </p>
            ))}
            <p className="mt-1 flex text-muted-foreground">Sentences typed<span className="ml-auto tabular-nums">{shown.sentences}</span></p>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>Study minutes for the last {days.length} days</caption>
        <thead><tr><th>Day</th><th>Typing</th><th>Listening</th><th>Sentences typed</th></tr></thead>
        <tbody>
          {days.map(day => (
            <tr key={day.day}><td>{dateLabel(day.day)}</td><td>{formatMinutes(day.typingSeconds)}</td><td>{formatMinutes(day.listeningSeconds)}</td><td>{day.sentences}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
