import { LoaderCircle, Pause, Play, Repeat } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { SpeedControl } from '@/components/speed-control';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { audioErrorMessage, formatTime, registerAudio } from '@/lib/audio';
import { describe } from '@/lib/player';
import { toast } from 'sonner';

interface AudioPlayerProps {
  src: string;
  /** Shown on the lock screen while it plays. */
  title: string;
  /** Called after play/pause/seek/speed so the parent can refocus (e.g. the typing box). */
  onInteraction?: () => void;
}

export interface AudioPlayerHandle {
  toggle: () => void;
}

type Status = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

// A story's or conversation's audio: play/pause, a seek bar with times, the shared speed and loop. Nothing is
// downloaded (or made) until the first play.
export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer({ src, title, onInteraction }, ref) {
  const audio = useRef<HTMLAudioElement>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(Number.NaN);
  const [loop, setLoop] = useState(false);

  useEffect(() => (audio.current ? registerAudio(audio.current) : undefined), []);
  useEffect(() => { if (audio.current) audio.current.loop = loop; }, [loop]);

  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) {
      // After a failure (e.g. a new key was set since) the audio is requested again.
      if (element.error) element.load();
      setStatus('loading');
      void element.play().catch(() => setStatus(current => (current === 'error' ? current : 'paused')));
    } else element.pause();
  };
  useImperativeHandle(ref, () => ({ toggle }), []);

  const playing = status === 'playing';
  const known = Number.isFinite(duration) && duration > 0;

  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2 rounded-2xl border bg-card py-1.5 pr-1.5 pl-1.5 shadow-xs sm:gap-3">
        <Button size="icon" className="size-10 shrink-0 rounded-full" aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => { toggle(); onInteraction?.(); }}>
          {status === 'loading' ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
            : playing ? <Pause className="fill-current" aria-hidden /> : <Play className="ml-0.5 fill-current" aria-hidden />}
        </Button>
        <span className="hidden w-10 shrink-0 text-right font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums sm:inline">{formatTime(time)}</span>
        <Slider className="min-w-0 flex-1" min={0} max={known ? duration : 1} step={0.1} value={[known ? Math.min(time, duration) : 0]} disabled={!known}
          aria-label="Position" onValueChange={([value]) => { if (audio.current) audio.current.currentTime = value; setTime(value); }} onValueCommit={() => onInteraction?.()} />
        {/* Phones show where it is; larger screens show both ends of the bar. */}
        <span className="w-10 shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums sm:hidden">{formatTime(time)}</span>
        <span className="hidden w-10 shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums sm:inline">{known ? formatTime(duration) : '--:--'}</span>
        <SpeedControl onDone={onInteraction} />
        <Button variant="ghost" size="icon" aria-label="Loop" aria-pressed={loop} onClick={() => { setLoop(on => !on); onInteraction?.(); }}
          className={`size-8 shrink-0 rounded-full ${loop ? 'bg-primary/10 text-primary hover:bg-primary/15' : 'text-muted-foreground'}`}>
          <Repeat className="size-4" aria-hidden />
        </Button>
      </div>
      <audio ref={audio} preload="none" src={src} className="hidden"
        onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
        onDurationChange={event => setDuration(event.currentTarget.duration)}
        onPlay={() => describe({ title, subtitle: 'Story', kind: 'story' })}
        onWaiting={() => setStatus('loading')} onPlaying={() => setStatus('playing')}
        onPause={() => setStatus(current => (current === 'error' ? current : 'paused'))}
        onEnded={() => setStatus('idle')} onError={() => { setStatus('error'); void audioErrorMessage(src).then(message => toast.error(message)); }} />
    </div>
  );
});
