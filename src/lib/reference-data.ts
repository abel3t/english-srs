// Reference statistics from spoken (OpenSubtitles) and written (WikiText-103) English, built by
// scripts/build-reference-ngrams.py. foldWord() must stay identical to fold() in that script.
export type ReferencePhrase = { spoken: number; written: number; npmi: number };
// burstiness: average count per Wikipedia article containing the word (0 = unknown); topic words are bursty.
export type ReferenceWord = { spoken: number; written: number; burstiness: number };
export type ReferenceData = { phrases: Map<string, ReferencePhrase>; words: Map<string, ReferenceWord> };

// A Map, not an object literal: words like "constructor" must not hit Object.prototype.
const IRREGULAR = new Map(Object.entries({
  was: 'be', were: 'be', is: 'be', are: 'be', am: 'be', been: 'be', being: 'be',
  has: 'have', had: 'have', having: 'have', did: 'do', does: 'do', done: 'do', doing: 'do',
  went: 'go', gone: 'go', goes: 'go', took: 'take', taken: 'take', made: 'make', came: 'come',
  got: 'get', gotten: 'get', gave: 'give', given: 'give', ran: 'run', brought: 'bring',
  thought: 'think', found: 'find', kept: 'keep', left: 'leave', led: 'lead', meant: 'mean',
  said: 'say', saw: 'see', seen: 'see', knew: 'know', known: 'know', told: 'tell', felt: 'feel',
  held: 'hold', stood: 'stand', understood: 'understand', became: 'become', began: 'begin',
  begun: 'begin', chose: 'choose', chosen: 'choose', wrote: 'write', written: 'write', built: 'build',
  sent: 'send', spent: 'spend', paid: 'pay', laid: 'lay', lost: 'lose', met: 'meet', sold: 'sell',
  taught: 'teach', caught: 'catch', bought: 'buy', fought: 'fight', sought: 'seek', dealt: 'deal',
  drew: 'draw', drawn: 'draw', grew: 'grow', grown: 'grow', threw: 'throw', thrown: 'throw',
  broke: 'break', broken: 'break', spoke: 'speak', spoken: 'speak', rose: 'rise', risen: 'rise',
  fell: 'fall', fallen: 'fall', drove: 'drive', driven: 'drive', children: 'child', men: 'man',
  women: 'woman', better: 'good', best: 'good', worse: 'bad', worst: 'bad',
}));

// Crude inflection folding (make/makes/making/made -> "mak"); only a lookup key, never shown.
export function foldWord(word: string): string {
  let w = IRREGULAR.get(word) ?? word;
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('es') && w.length > 4 && 'sxzh'.includes(w[w.length - 3])) w = w.slice(0, -2);
  else if (w.endsWith('s') && w.length > 3 && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) w = w.slice(0, -1);
  if (w.length > 3 && w[w.length - 1] === w[w.length - 2] && !'lsz'.includes(w[w.length - 1])) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

export function parseReferenceData(phrases: string, words: string): ReferenceData {
  const data: ReferenceData = { phrases: new Map(), words: new Map() };
  for (const line of phrases.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [key, spoken, written, npmi] = line.split('\t');
    data.phrases.set(key, { spoken: Number(spoken), written: Number(written), npmi: Number(npmi) });
  }
  for (const line of words.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [key, spoken, written, burstiness] = line.split('\t');
    data.words.set(key, { spoken: Number(spoken), written: Number(written), burstiness: Number(burstiness ?? 0) });
  }
  return data;
}
