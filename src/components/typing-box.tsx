import { useEffect, useMemo, useRef, useState } from 'react';

export type TypingResult = { accuracy: number; wpm: number; errors: number; seconds: number };

// Case, curly quotes and dash styles never count as mistakes: the point is the English, not the keyboard.
const canonical = (char: string | undefined) => (char ?? '').toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/ /g, ' ');
const same = (a: string | undefined, b: string | undefined) => canonical(a) === canonical(b);

/**
 * Monkeytype-style typing over a target text. In blank mode the characters inside `blanks` are hidden
 * (shown as "_") until typed, so the learner recalls the phrase instead of copying it.
 */
export function TypingBox({ text, blanks = [], onDone, autoFocus = true }: {
  text: string; blanks?: Array<{ start: number; end: number }>; onDone: (result: TypingResult) => void; autoFocus?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
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

  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);

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
    if (next.length >= text.length) {
      const seconds = Math.max(1, (Date.now() - start) / 1000);
      const correct = [...next].filter((char, index) => same(char, text[index])).length;
      onDone({ accuracy: Math.max(0, 1 - totalErrors / text.length), wpm: Math.round((correct / 5) / (seconds / 60)), errors: totalErrors, seconds });
    }
  }

  return (
    <div className="grid gap-2">
      <div role="textbox" aria-label="Type the text" onClick={() => input.current?.focus()}
        className={`cursor-text rounded-lg border bg-background p-4 font-mono text-xl leading-relaxed tracking-wide break-words ${focused ? 'ring-2 ring-primary/30' : ''}`}>
        {[...text].map((char, index) => {
          const typedChar = typed[index];
          const caret = index === typed.length && focused && !done;
          const shown = typedChar !== undefined ? char : hidden.has(index) ? '_' : char;
          const color = typedChar === undefined ? (hidden.has(index) ? 'text-amber-600' : 'text-muted-foreground/60')
            : same(typedChar, char) ? 'text-foreground' : 'rounded-sm bg-red-100 text-red-700';
          return (
            <span key={index} className={`${color} ${caret ? 'border-l-2 border-primary' : 'border-l-2 border-transparent'}`}>
              {typedChar !== undefined && !same(typedChar, char) && char === ' ' ? '·' : shown}
            </span>
          );
        })}
      </div>
      <input ref={input} value={typed} onChange={event => change(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}
        className="sr-only" autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false} aria-label="Typing input" />
      <p className="text-xs text-muted-foreground">{focused ? 'Read it aloud as you type.' : 'Click the text to start typing.'} {errors ? `· ${errors} mistake${errors === 1 ? '' : 's'}` : ''}</p>
    </div>
  );
}
