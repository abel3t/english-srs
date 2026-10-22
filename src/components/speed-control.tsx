import { Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { SPEED_MAX, SPEED_MIN, SPEED_STEP, formatSpeed, setAudioSpeed, useAudioSpeed } from '@/lib/audio';

// Marks under the slider; tapping one jumps there.
const MARKS = [0.75, 1, 1.5, 2] as const;
const position = (speed: number) => ((speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100;

// YouTube-style speed: one slider from 0.75× to 2× in 0.05 steps, with marks. One speed for every player, remembered
// on this device. onDone gives the focus back (e.g. to the typing box) when the panel closes.
export function SpeedControl({ onDone }: { onDone?: () => void }) {
  const speed = useAudioSpeed();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Playback speed ${formatSpeed(speed)}`}
          className={`h-8 shrink-0 gap-1 rounded-full px-2.5 font-mono text-xs tabular-nums ${speed !== 1 ? 'text-primary' : 'text-muted-foreground'}`}>
          <Gauge className="size-3.5" aria-hidden />{formatSpeed(speed)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 px-4 pt-3 pb-2" onCloseAutoFocus={event => { if (onDone) { event.preventDefault(); onDone(); } }}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Speed</span>
          <div className="flex items-center gap-1">
            {speed !== 1 && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setAudioSpeed(1)}>Reset</Button>}
            <span className="min-w-14 text-right font-mono text-lg font-semibold tabular-nums">{formatSpeed(speed)}</span>
          </div>
        </div>
        <Slider className="mt-4" min={SPEED_MIN} max={SPEED_MAX} step={SPEED_STEP} value={[speed]} onValueChange={([value]) => setAudioSpeed(value)} aria-label="Playback speed" />
        <div className="relative mt-1.5 h-6" >
          {MARKS.map(mark => (
            <button key={mark} type="button" onClick={() => setAudioSpeed(mark)} aria-label={`Set speed to ${formatSpeed(mark)}`}
              className={`absolute -translate-x-1/2 rounded px-1 font-mono text-[11px] tabular-nums transition-colors hover:text-foreground ${Math.abs(mark - speed) < 0.001 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
              style={{ left: `clamp(0.75rem, ${position(mark)}%, calc(100% - 0.75rem))` }}>
              {mark === 1 ? '1×' : mark}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
