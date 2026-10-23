# Notes

## Pending decision: daily study load (2026-10-23)

Not decided yet. Choose how many new cards a day and how many typings in the first drill, then set `DRILL_TIMES`
in `src/lib/srs.ts` (now 10).

- Simulator: https://claude.ai/artifact/Jx5ukr7FzTi6exV2Cr6pYa (pick minutes a day; every option is compared)
- My typing speed, from the 23/10 session (128 typings): ~52 wpm while typing steadily, ~38 wpm over the whole
  session. Cards have 4 texts: the phrase (~19 characters) and 3 examples (~60 characters).
- At 52 wpm, realistic ratings, heaviest 30 days of the first year:

  | Minutes a day | Suggested            | Peak    | Phrases a year |
  |---------------|----------------------|---------|----------------|
  | 20            | 2 cards, 3 typings   | 17 min  | 730            |
  | 30            | 3 cards, 3 typings   | 26 min  | 1,095          |
  | 45            | 5 cards, 3 typings   | 42 min  | 1,825          |
  | 60            | 6 cards, 5 typings   | 59 min  | 2,190          |

- 10 cards a day with 7 typings is ~115 min a day after a year: too much.
- New cards a day costs far more time than drill typings (+1 card ≈ +10 min a day).
- The number of new cards is kept by asking Claude/ChatGPT for that many phrases ("Find 3 new phrases").

Ideas not built yet:
- Save the real wpm of every typing (TypingResult already has it) so the estimate uses measured speed.
- Practice in short sessions (10–15 cards each) or a daily review cap, so due cards are not all at once.

## Not deployed yet

- Milestone reviews: when a card turns 1, 3, 6 and 12 months old, its next review needs every text typed once
  before rating (`typeAllTexts` in `src/lib/srs.ts`). Run `pnpm run deploy` to ship it.

## Workers AI daily limit

- Free plan: 10,000 neurons a day for Aura-2 clips. On 22/10 the fresh R2 bucket made every clip again (11,373
  neurons) and Workers AI returned 429 for the whole account; it was still blocked at 08:00 VN on 23/10 even
  though the dashboard showed 0/10k.
- The app now says so in a toast. Saved clips keep playing. Workers Paid ($5/month) removes the block.
