"""Builds public/data/reference-ngrams.tsv and reference-words.tsv: how often phrases occur in spoken English
(OpenSubtitles sample) and written English (WikiText-103 sample), and how strongly their words belong together.

The phrase finder uses this to (1) discover fixed expressions that no dictionary lists, (2) score how useful
and how fixed a phrase is, and (3) tell general vocabulary from technical jargon (jargon is rare in speech).

Inputs (not committed):
  spoken.txt   e.g. the first ~30M words of https://object.pouta.csc.fi/OPUS-OpenSubtitles/v2018/mono/en.txt.gz
  written.txt  e.g. the first ~30M words of wiki.train.raw from https://wikitext.smerity.com/wikitext-103-raw-v1.zip
Usage: python3 scripts/build-reference-ngrams.py spoken.txt written.txt [max_words_per_corpus]
Set REF_CACHE=/path/counts.pickle to reuse the (slow) counts while tuning the selection.

fold() must stay identical to foldWord() in src/lib/reference-data.ts; compare both on the word list before changing either.
"""
import math, os, pickle, re, sys
from collections import Counter

IRREGULAR = {
    'was': 'be', 'were': 'be', 'is': 'be', 'are': 'be', 'am': 'be', 'been': 'be', 'being': 'be',
    'has': 'have', 'had': 'have', 'having': 'have', 'did': 'do', 'does': 'do', 'done': 'do', 'doing': 'do',
    'went': 'go', 'gone': 'go', 'goes': 'go', 'took': 'take', 'taken': 'take', 'made': 'make', 'came': 'come',
    'got': 'get', 'gotten': 'get', 'gave': 'give', 'given': 'give', 'ran': 'run', 'brought': 'bring',
    'thought': 'think', 'found': 'find', 'kept': 'keep', 'left': 'leave', 'led': 'lead', 'meant': 'mean',
    'said': 'say', 'saw': 'see', 'seen': 'see', 'knew': 'know', 'known': 'know', 'told': 'tell', 'felt': 'feel',
    'held': 'hold', 'stood': 'stand', 'understood': 'understand', 'became': 'become', 'began': 'begin',
    'begun': 'begin', 'chose': 'choose', 'chosen': 'choose', 'wrote': 'write', 'written': 'write', 'built': 'build',
    'sent': 'send', 'spent': 'spend', 'paid': 'pay', 'laid': 'lay', 'lost': 'lose', 'met': 'meet', 'sold': 'sell',
    'taught': 'teach', 'caught': 'catch', 'bought': 'buy', 'fought': 'fight', 'sought': 'seek', 'dealt': 'deal',
    'drew': 'draw', 'drawn': 'draw', 'grew': 'grow', 'grown': 'grow', 'threw': 'throw', 'thrown': 'throw',
    'broke': 'break', 'broken': 'break', 'spoke': 'speak', 'spoken': 'speak', 'rose': 'rise', 'risen': 'rise',
    'fell': 'fall', 'fallen': 'fall', 'drove': 'drive', 'driven': 'drive', 'children': 'child', 'men': 'man',
    'women': 'woman', 'better': 'good', 'best': 'good', 'worse': 'bad', 'worst': 'bad',
}

def fold(word):
    """Crude inflection folding: make/makes/making/made -> 'mak'. Only used as a lookup key."""
    w = IRREGULAR.get(word, word)
    if w.endswith('ies') and len(w) > 4: w = w[:-3] + 'y'
    elif w.endswith('ing') and len(w) > 5: w = w[:-3]
    elif w.endswith('ed') and len(w) > 4: w = w[:-2]
    elif w.endswith('es') and len(w) > 4 and w[-3] in 'sxzh': w = w[:-2]
    elif w.endswith('s') and len(w) > 3 and not w.endswith(('ss', 'us', 'is')): w = w[:-1]
    if len(w) > 3 and w[-1] == w[-2] and w[-1] not in 'lsz': w = w[:-1]
    if len(w) > 3 and w.endswith('e'): w = w[:-1]
    return w

TOKEN = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")
STOP = set("a an the to of and or for in on at by with from as is are was were be been being am it its this that these those i you he she we they me him her us them my your his our their not no do does did have has had will would can could should may might must shall so if than then but just also very there here what which who whom whose when where why how all any some each every one up out off over into about".split())
STOP_KEYS = {fold(word) for word in STOP}

def count(path, max_words, counts):
    total, next_prune = 0, 2_000_000
    with open(path, encoding='utf-8', errors='ignore') as handle:
        for line in handle:
            line = line.lower().replace(' @-@ ', '-').replace(' @,@ ', ',').replace(' @.@ ', '.')
            for sentence in re.split(r'[.!?;:]', line):
                tokens = [fold(token) for token in TOKEN.findall(sentence)]
                total += len(tokens)
                for n in range(1, 5):
                    bucket = counts[n]
                    for i in range(len(tokens) - n + 1):
                        bucket[' '.join(tokens[i:i + n])] += 1
            if total >= max_words: break
            if total >= next_prune:  # drop n-grams seen once so far, to bound memory (slightly undercounts rare ones)
                next_prune += 2_000_000
                for n in (2, 3, 4):
                    counts[n] = Counter({key: value for key, value in counts[n].items() if value > 1})
    return total

TITLE = re.compile(r'^ = [^=].* = $')

def burstiness(path, max_words):
    """Average count per article that contains the word (Church & Gale). Topic words cluster in a few
    articles ("cache" ~ computing); general academic words spread thinly across many ("mitigate")."""
    count, documents, seen, total = Counter(), Counter(), set(), 0
    with open(path, encoding='utf-8', errors='ignore') as handle:
        for line in handle:
            if TITLE.match(line):
                seen = set()
                if total >= max_words: break
                continue
            for token in TOKEN.findall(line.lower().replace(' @-@ ', '-')):
                key = fold(token); count[key] += 1; total += 1
                if key not in seen: seen.add(key); documents[key] += 1
    return {key: count[key] / documents[key] for key in documents if documents[key] >= 3}

def main():
    spoken_path, written_path = sys.argv[1], sys.argv[2]
    max_words = int(sys.argv[3]) if len(sys.argv) > 3 else 30_000_000
    cache = os.environ.get('REF_CACHE')
    if cache and os.path.exists(cache):
        with open(cache, 'rb') as handle: spoken, written, spoken_total, written_total = pickle.load(handle)
    else:
        spoken = {n: Counter() for n in range(1, 5)}
        written = {n: Counter() for n in range(1, 5)}
        spoken_total = count(spoken_path, max_words, spoken)
        written_total = count(written_path, max_words, written)
        if cache:
            with open(cache, 'wb') as handle: pickle.dump((spoken, written, spoken_total, written_total), handle)
    total = spoken_total + written_total
    print(f'spoken {spoken_total:,} words, written {written_total:,} words', file=sys.stderr)
    combined = lambda key, n: spoken[n][key] + written[n][key]
    per_million = lambda value, corpus_total: round(value * 1e6 / corpus_total, 2)

    bursts = burstiness(written_path, max_words)
    with open('public/data/reference-words.tsv', 'w') as out:
        out.write('# folded word\tper million words in speech (OpenSubtitles)\tper million in writing (WikiText-103, CC BY-SA)\tburstiness in writing (0 = unknown)\n')
        words = sorted(set(spoken[1]) | set(written[1]), key=lambda key: -combined(key, 1))[:50_000]
        for key in words:
            out.write(f'{key}\t{per_million(spoken[1][key], spoken_total)}\t{per_million(written[1][key], written_total)}\t{round(bursts.get(key, 0), 2)}\n')

    rows = []
    for n in (2, 3, 4):
        for key in set(spoken[n]) | set(written[n]):
            c = combined(key, n)
            if c < 12: continue
            tokens = key.split(' ')
            if all(token in STOP_KEYS for token in tokens) or tokens[0] in ('and', 'or', 'but') or tokens[-1] in ('a', 'an', 'the', 'and', 'or'):
                continue
            # "Fair" normalized PMI (Silva & Lopes): compare the phrase with the average of all its binary splits,
            # so a leading or trailing function word ("in the context of") does not make the whole phrase look loose.
            p = c / total
            splits = [(combined(' '.join(tokens[:k]), k) / total) * (combined(' '.join(tokens[k:]), n - k) / total) for k in range(1, n)]
            average = sum(splits) / len(splits)
            if not average: continue
            npmi = math.log(p / average) / -math.log(p)
            if npmi >= 0.25: rows.append((key, per_million(spoken[n][key], spoken_total), per_million(written[n][key], written_total), round(npmi, 3), c))
    rows.sort(key=lambda row: -row[4])
    rows = rows[:200_000]
    with open('public/data/reference-ngrams.tsv', 'w') as out:
        out.write('# folded 2-4-gram\tper million in speech\tper million in writing\tnormalized PMI (weakest split)\n')
        for key, spoken_pm, written_pm, npmi, _ in rows:
            out.write(f'{key}\t{spoken_pm}\t{written_pm}\t{npmi}\n')
    print(f'{len(words):,} words, {len(rows):,} phrases', file=sys.stderr)

if __name__ == '__main__':
    main()
