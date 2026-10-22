// PhraseLoop's mark: a loop (phrases come back until they stick) around the amber dot of the typing caret.
// The same drawing is public/favicon.svg.
export function Logo({ className = 'size-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-foreground" />
      <g fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="stroke-background">
        <path d="M9.5 13.5V12a3 3 0 0 1 3-3h9.5" />
        <path d="m19 6 3 3-3 3" />
        <path d="M22.5 18.5V20a3 3 0 0 1-3 3H10" />
        <path d="m13 26-3-3 3-3" />
      </g>
      <circle cx="16" cy="16" r="2.6" fill="#f59e0b" />
    </svg>
  );
}
