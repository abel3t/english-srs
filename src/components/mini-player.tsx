import { Headphones, LoaderCircle, MessagesSquare, Pause, Play, Repeat, SkipBack, SkipForward, X } from 'lucide-react';
import { Equalizer } from '@/components/equalizer';
import { SpeedControl } from '@/components/speed-control';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { formatTime } from '@/lib/audio';
import { player, usePlayer } from '@/lib/player';

// The listening player at the bottom of every page, shown while it has something to play. On phones it sits just
// above the tab bar; on larger screens it floats at the bottom with a seek bar.
export function MiniPlayer() {
  const { tracks, index, status, loop, time, duration, error } = usePlayer();
  if (!tracks.length) return null;
  const track = tracks[index];
  const playing = status === 'playing';
  const known = Number.isFinite(duration) && duration > 0;
  const progress = known ? Math.min(1, time / duration) : 0;

  return (
    <section aria-label="Player"
      className="fixed inset-x-2 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 overflow-hidden rounded-2xl border bg-card/95 shadow-lg backdrop-blur animate-in fade-in slide-in-from-bottom-4 duration-200 motion-reduce:animate-none sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:w-[min(44rem,calc(100%-2rem))] sm:-translate-x-1/2">
      {/* Phones: a thin progress line; larger screens get the seek bar below. */}
      <div className="h-0.5 bg-muted sm:hidden" aria-hidden><div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${progress * 100}%` }} /></div>
      <div className="flex items-center gap-1 p-2 sm:gap-2 sm:px-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-foreground text-background" aria-hidden>
          {playing ? <Equalizer playing className="h-4" />
            : track.kind === 'story' ? <MessagesSquare className="size-4" /> : <Headphones className="size-4" />}
        </div>
        <div className="min-w-0 flex-1 px-1.5">
          <p className="truncate text-sm font-medium">{track.title}</p>
          <p className="truncate text-xs text-muted-foreground tabular-nums">{tracks.length > 1 ? `${index + 1} of ${tracks.length}` : ''}{track.subtitle ? `${tracks.length > 1 ? ' · ' : ''}${track.subtitle}` : ''}</p>
        </div>
        <Button variant="ghost" size="icon" className="hidden size-8 shrink-0 rounded-full sm:inline-flex" aria-label="Previous" onClick={player.previous} disabled={tracks.length < 2 && time < 1}>
          <SkipBack className="size-4 fill-current" aria-hidden />
        </Button>
        <Button size="icon" className="size-10 shrink-0 rounded-full" aria-label={playing ? 'Pause' : 'Play'} onClick={player.toggle}>
          {status === 'loading' ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
            : playing ? <Pause className="fill-current" aria-hidden /> : <Play className="ml-0.5 fill-current" aria-hidden />}
        </Button>
        <Button variant="ghost" size="icon" className="size-8 shrink-0 rounded-full" aria-label="Next" onClick={player.next} disabled={tracks.length < 2}>
          <SkipForward className="size-4 fill-current" aria-hidden />
        </Button>
        <SpeedControl />
        <Button variant="ghost" size="icon" aria-label="Loop" aria-pressed={loop} onClick={() => player.setLoop(!loop)}
          className={`hidden size-8 shrink-0 rounded-full sm:inline-flex ${loop ? 'bg-primary/10 text-primary hover:bg-primary/15' : 'text-muted-foreground'}`}>
          <Repeat className="size-4" aria-hidden />
        </Button>
        <Button variant="ghost" size="icon" className="size-8 shrink-0 rounded-full text-muted-foreground" aria-label="Close player" onClick={player.stop}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      {error && <p role="alert" className="px-4 pb-2 text-xs text-destructive">{error}</p>}
      <div className="hidden items-center gap-2 px-4 pb-2.5 sm:flex">
        <span className="w-10 shrink-0 text-right font-mono text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">{formatTime(time)}</span>
        <Slider min={0} max={known ? duration : 1} step={0.1} value={[known ? Math.min(time, duration) : 0]} disabled={!known} aria-label="Position"
          onValueChange={([value]) => player.seek(value)} />
        <span className="w-10 shrink-0 font-mono text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">{known ? formatTime(duration) : '--:--'}</span>
      </div>
    </section>
  );
}
