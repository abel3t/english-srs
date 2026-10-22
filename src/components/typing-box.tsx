import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';

export type TypingResult = { accuracy: number; wpm: number; errors: number; seconds: number };
// Lets the page give the focus back to the typing (e.g. after the learner clicks the audio player).
export type TypingHandle = { focus: () => void };

// Case, curly quotes and dash styles never count as mistakes: the point is the English, not the keyboard.
const canonical = (char: string | undefined) => (char ?? '').toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/ /g, ' ');
const same = (a: string | undefined, b: string | undefined) => canonical(a) === canonical(b);

/**
 * Monkeytype-style typing over a target text. In blank mode the characters inside `blanks` are hidden
 * (shown as "_") until typed, so the learner recalls the phrase instead of copying it.
 */
export function TypingBox({ text, blanks = [], onDone, autoFocus = true, handle }: {
  text: string; blanks?: Array<{ start: number; end: number }>; onDone: (result: TypingResult) => void; autoFocus?: boolean; handle?: Ref<TypingHandle>;
}) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(handle, () => ({ focus: () => input.current?.focus() }), []);
  const [typed, setTyped] = useState('');
  const [errors, setErrors] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const done = typed.length >= text.length;
  const hidden = useMemo(() => {
    const set = new Set<number>();
    for (const span of blanks) for (let i = span.start; i < span.end; i++) if (text[i] !== ' ') set.add(i);
    return set;
  }, [blanks, text]);

  // Characters grouped by word (with their trailing space) so lines only wrap between words.
  const words = useMemo(() => [...text.matchAll(/\S+\s*|\s+/g)].map(match => ({ start: match.index!, end: match.index! + match[0].length })), [text]);
  const box = useRef<HTMLDivElement>(null);
  const chars = useRef<Array<HTMLSpanElement | null>>([]);
  const [caret, setCaret] = useState<{ left: number; top: number; height: number } | null>(null);
  const [typing, setTyping] = useState(false);
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);
  useEffect(() => () => clearTimeout(idle.current), []);

  // The caret is one element that glides to the next character (like Monkeytype) instead of jumping between spans.
  useLayoutEffect(() => {
    let active = true;
    const place = () => {
      if (!active) return;
      const char = chars.current[typed.length];
      const container = box.current;
      if (!char || !container) { setCaret(null); return; }
      const rect = char.getBoundingClientRect();
      const bounds = container.getBoundingClientRect();
      setCaret({
        left: rect.left - bounds.left - container.clientLeft,
        top: rect.top - bounds.top - container.clientTop,
        height: rect.height,
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (box.current) observer.observe(box.current);
    // The web font can change character widths without resizing a single-line box.
    void document.fonts.ready.then(place);
    return () => { active = false; observer.disconnect(); };
  }, [typed.length, text]);

  function change(value: string) {
    if (done) return;
    const next = value.slice(0, text.length);
    const start = startedAt ?? Date.now();
    if (startedAt === null && next) setStartedAt(start);
    // Every wrongly typed character counts, even if fixed later (like Monkeytype's accuracy).
    const added = next.length > typed.length ? next.slice(typed.length) : '';
    const totalErrors = errors + [...added].filter((char, offset) => !same(char, text[typed.length + offset])).length;
    setErrors(totalErrors);
    setTyped(next);
    // The caret stays solid while typing and blinks once the learner pauses.
    setTyping(true);
    clearTimeout(idle.current);
    idle.current = setTimeout(() => setTyping(false), 600);
    if (next.length >= text.length) {
      const seconds = Math.max(1, (Date.now() - start) / 1000);
      const correct = [...next].filter((char, index) => same(char, text[index])).length;
      onDone({ accuracy: Math.max(0, 1 - totalErrors / text.length), wpm: Math.round((correct / 5) / (seconds / 60)), errors: totalErrors, seconds });
    }
  }

  return (
    <div className="grid gap-2">
      <div ref={box} role="textbox" aria-label="Type the text" onClick={() => input.current?.focus()}
        className={`typing-text relative cursor-text rounded-xl bg-muted/20 p-5 transition-shadow sm:p-6 ${focused ? 'ring-1 ring-primary/15' : ''}`}>
        {words.map(word => (
          <span key={word.start} className="inline-block max-w-full whitespace-pre-wrap [overflow-wrap:anywhere]">
            {[...text.slice(word.start, word.end)].map((char, offset) => {
              const index = word.start + offset;
              const typedChar = typed[index];
              const shown = typedChar !== undefined ? char : hidden.has(index) ? '_' : char;
              const color = typedChar === undefined ? (hidden.has(index) ? 'text-amber-600' : 'text-muted-foreground/80')
                : same(typedChar, char) ? 'text-foreground' : 'rounded-sm bg-red-100 text-red-700';
              return (
                <span key={index} ref={element => { chars.current[index] = element; }} className={`transition-colors duration-100 ${color}`}>
                  {typedChar !== undefined && !same(typedChar, char) && char === ' ' ? '·' : shown}
                </span>
              );
            })}
          </span>
        ))}
        {caret && focused && !done && (
          <span aria-hidden style={{ height: caret.height * 1.05, transform: `translate3d(${caret.left - 1.5}px, ${caret.top - caret.height * 0.025}px, 0)` }}
            className={`pointer-events-none absolute top-0 left-0 w-[3px] rounded-full bg-amber-500 transition-transform duration-[120ms] ease-out will-change-transform motion-reduce:transition-none ${typing ? '' : 'animate-caret-blink'}`} />
        )}
      </div>
      <input ref={input} value={typed} onChange={event => change(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}
        className="sr-only" autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false} aria-label="Typing input" />
      <p className="text-xs text-muted-foreground">{focused ? 'Read it aloud as you type.' : 'Click the text to start typing.'} {errors ? `· ${errors} mistake${errors === 1 ? '' : 's'}` : ''}</p>
    </div>
  );
}
