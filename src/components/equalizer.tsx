// Three bouncing bars that mean "playing now"; still (and low) when paused. Decorative: the button says what it does.
export function Equalizer({ playing, className = 'h-3.5' }: { playing: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-end gap-[2px] ${className}`} aria-hidden>
      {[0, 1, 2].map(bar => (
        <span key={bar} className={`w-[3px] origin-bottom rounded-full bg-current ${playing ? 'animate-equalizer motion-reduce:animate-none' : ''}`}
          style={{ height: playing ? '100%' : `${[40, 70, 50][bar]}%`, animationDelay: `${bar * -0.35}s` }} />
      ))}
    </span>
  );
}
