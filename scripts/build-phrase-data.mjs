// Builds the static data used by the in-browser phrase finder (public/data/*).
//
// Inputs (not committed; regenerate with the commands below):
//   wiktionary.json  {"<title>": "<kind>"} from the Wiktionary categories English_phrasal_verbs,
//                    English_idioms, English_prepositional_phrases, English_phrasal_prepositions and
//                    English_conjunctive_adverbs (MediaWiki API, list=categorymembers). CC BY-SA 4.0.
//   freq.json        [[word, zipf], ...] for the top 40,000 English words, exported with the Python package
//                    wordfreq (Apache-2.0 code, CC BY-SA 4.0 data):
//                    python -c "import wordfreq,json; json.dump([(w, round(wordfreq.zipf_frequency(w,'en'),2)) for w in wordfreq.top_n_list('en',40000)], open('freq.json','w'))"
//
// Usage: node scripts/build-phrase-data.mjs <wiktionary.json> <freq.json>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const [wiktionaryPath, freqPath] = process.argv.slice(2);
if (!wiktionaryPath || !freqPath) throw new Error('Usage: node scripts/build-phrase-data.mjs <wiktionary.json> <freq.json>');

// Hand-written workplace and interview language: what a senior developer uses to explain, compare,
// hedge, disagree, and negotiate. Matched with the highest priority.
const FRAMES = `
the main reason is|boil down to|in other words|that is to say|to put it simply|the bottom line is|the key point is|what this means is
on top of that|as a result|for that reason|this is because|due to the fact that|in terms of|when it comes to
as far as something is concerned|first of all|last but not least|to sum up|all in all|at the end of the day|in a nutshell
at the expense of|on the other hand|the downside is|the upside is|in contrast|compared to|trade-off between|pros and cons
it depends on|strike a balance between|in the long run|in the short term|in the long term|worth the effort|not worth it
it seems that|it is likely that|to some extent|in most cases|more or less|as far as i know|if i'm not mistaken|i'd argue that
it could be argued that|it's fair to say|generally speaking|for the most part|tend to|in theory|in practice|so to speak
i see your point|that's a fair point|i take your point|i'm not sure i agree|i see it differently|with all due respect
to be honest|meet someone halfway|find common ground|win-win|push back on|on the same page|come to an agreement
reach a compromise|compromise on|agree to disagree|fair enough|play devil's advocate|make a case for|have a point
take ownership of|take responsibility for|be accountable for|meet the deadline|miss the deadline|behind schedule
ahead of schedule|on track|keep track of|follow up on|reach out to|loop someone in|get buy-in|raise a concern|raise concerns
address the issue|deal with|come up with|figure out|roll out|roll back|scale up|break down|narrow down|rule out
sort out|carry out|set up|look into|point out|bring up|run into|end up|make sure|keep in mind|bear in mind
take into account|put in place|quick win|low-hanging fruit|move the needle|root cause|single point of failure
technical debt|edge case|best practice|rule of thumb|trial and error|proof of concept|sanity check|back and forth
get rid of|make a decision|make progress|make a difference|take a step back|the big picture|in hindsight|lessons learned
learn from|go wrong|work out|it turned out that|turn out|as expected|contrary to|to be fair|i was in charge of
my role was to|take the lead on|take the lead|one of my strengths is|looking back|what i learned from|under pressure
a tight deadline|on a tight deadline|cross-functional|keep someone in the loop|in the loop|get up to speed|bring someone up to speed
step up|stand out|walk someone through|go over|double down on|weigh up|weigh the pros and cons|think outside the box
on the fly|out of the box|from scratch|under the hood|up and running|in the meantime|so far|by and large|as of now
in a timely manner|on a case-by-case basis|a matter of|it is worth noting that|it's worth mentioning that|keep an eye on
`.split(/[|\n]/).map(entry => entry.trim()).filter(Boolean);

// Expressions every B1 learner already knows; never offered.
const BASIC = new Set(`a lot of|lots of|of course|in front of|at least|as well as|so that|such as|each other|at all|right now|in order to
as soon as|as well|at first|at last|at once|for example|for instance|in fact|kind of|sort of|and so on|thank you|you know|i mean
a little|a few|no one|one another|more than|less than|instead of|because of|next to|all right|of all|at home|at work|by the way
come back|go back|go out|get up|sit down|stand up|wake up|look at|look for|come on|go on|come in|get in|get out|find out|give up
pick up|put on|take off|turn on|turn off|try on|grow up|hurry up|calm down|log in|sign up|check in|check out|look after
have to|have got|have got to|be about|in on|that is|piece of|be going to|going to|used to|be able to|need to|want to|ought to|be to|be on|be in|be up|be out|be off|be over|be down|be back|be into|be for|do with|have on|get on|get to|go to|come to|go for|go with|end of|of the|on to|up to|out of`.split(/[|\n]/).map(entry => entry.trim()));

// Slots in idioms ("loop someone in"); words like "one" or "anything" stay literal ("one by one", "anything but").
const PLACEHOLDERS = new Set(["one's", 'oneself', 'someone', "someone's", 'somebody', "somebody's", 'something', 'sb', 'sth']);
const KIND_CODES = { frame: 0, phrasal_verb: 1, idiom: 2, prep_phrase: 3 };
const PARTICLES = new Set(['up', 'down', 'out', 'off', 'on', 'in', 'over', 'back', 'away', 'through', 'around', 'along', 'about', 'apart', 'aside', 'into', 'onto', 'across', 'forward', 'together', 'ahead', 'behind', 'by']);

const raw = JSON.parse(readFileSync(wiktionaryPath, 'utf8'));
const freq = JSON.parse(readFileSync(freqPath, 'utf8'));
const zipf = new Map(freq);
const entries = new Map();
const add = (title, kind) => {
  const text = title.toLowerCase().replace(/[’‘]/g, "'").replace(/[,.!?;:]/g, '').replace(/\s+/g, ' ').trim();
  if (entries.has(text) && kind !== 'frame') return;
  if (BASIC.has(text) || /[^a-z' -]/.test(text)) return;
  let words = text.split(' ');
  // A trailing slot matches any next word ("piece of someone" ~ "piece of reasoning"), so drop it.
  while (words.length && PLACEHOLDERS.has(words.at(-1)) && !words.at(-1).endsWith("'s")) words = words.slice(0, -1);
  const parts = words.flatMap(word => word.split('-')).filter(Boolean); // the finder matches "win-win" as two tokens
  if (parts.length < 2 || parts.length > 7) return;
  if (parts.filter(word => !PLACEHOLDERS.has(word)).length < 2) return;
  // Up to two very common real words ("of a", "with it", "have-not", "what someone said") are usually
  // literal text, not the idiom.
  const literal = parts.filter(word => !PLACEHOLDERS.has(word));
  if (kind !== 'frame' && literal.length <= 2 && literal.every(word => (zipf.get(word) ?? 0) >= 5.8)) return;
  if (BASIC.has(words.join(' '))) return;
  // Separable phrasal verbs ("take ... into account", "figure ... out"): allow a short object after the verb.
  const gap = words.length >= 2 && PARTICLES.has(words[1]) && !PLACEHOLDERS.has(words[0]) ? 1 : 0;
  entries.set(words.join(' '), [words.join(' '), KIND_CODES[kind], gap]);
};
for (const [title, rawKind] of Object.entries(raw)) {
  // Only the hand-written list counts as top-priority frames.
  const kind = rawKind === 'frame' ? 'idiom' : rawKind;
  if (/[A-Z]/.test(title.replace(/^I\b|\bI\b/g, ''))) continue; // proper nouns and names
  add(title, kind);
}
for (const frame of FRAMES) add(frame, 'frame');

mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/expressions.json', JSON.stringify({
  source: 'Wiktionary (CC BY-SA 4.0) phrasal verbs, idioms and prepositional phrases, plus hand-written workplace frames',
  kinds: Object.keys(KIND_CODES),
  entries: [...entries.values()],
}));
writeFileSync('public/data/word-freq.txt', `# Zipf word frequencies, top 40,000 English words. Source: wordfreq (CC BY-SA 4.0 data).\n${freq.map(([word, zipf]) => `${word}\t${zipf}`).join('\n')}\n`);
console.log(`expressions: ${entries.size} (${[...entries.values()].filter(entry => entry[1] === 0).length} frames) · words: ${freq.length}`);
