// Pure word/sentence alignment helpers for the inline word-tap highlight.
// No React, no DOM globals.

// Sentence-final punctuation (Latin + CJK), optionally followed by closing
// quotes/brackets. Abbreviations ("Mr.") produce false splits; acceptable
// for highlight granularity.
const SENTENCE_END_RE = /[.!?…。！？](["'’”»)\]]*)$/

// Split paragraph text into render tokens. Each token is
//   { text, isWord, wordIdx, sentIdx }
// where wordIdx counts word tokens only (-1 for whitespace) and sentIdx
// groups tokens into sentences. Whitespace after a sentence-final word
// belongs to the NEXT sentence, so a sentence highlight never includes its
// trailing gap.
export function tokenizeParagraph(text) {
  if (typeof text !== 'string' || !text) return []
  const parts = text.split(/(\s+)/)
  const tokens = []
  let sentIdx = 0
  let wordIdx = 0
  for (const part of parts) {
    if (!part) continue
    const isWord = !/^\s+$/.test(part)
    tokens.push({ text: part, isWord, wordIdx: isWord ? wordIdx : -1, sentIdx })
    if (isWord) {
      wordIdx += 1
      if (SENTENCE_END_RE.test(part)) sentIdx += 1
    }
  }
  return tokens
}

// Number of sentences in a tokenized paragraph (0 for empty input).
export function sentenceCount(tokens) {
  let max = -1
  for (const t of tokens) {
    if (t.isWord && t.sentIdx > max) max = t.sentIdx
  }
  return max + 1
}

// Map a sentence index from the tapped paragraph onto the other pane's
// paragraph. Paragraphs are aligned 1:1 but their sentence counts can differ
// between languages, so the index is clamped into the destination range.
// Returns -1 when there is nothing to highlight.
export function alignSentenceIndex(srcIdx, dstCount) {
  if (!Number.isInteger(srcIdx) || srcIdx < 0) return -1
  if (!Number.isInteger(dstCount) || dstCount < 1) return -1
  return Math.min(srcIdx, dstCount - 1)
}

// Strip leading/trailing punctuation from a word token ("sentó." → "sentó").
// Unicode-aware so accented and non-Latin words survive.
export function stripWordPunct(token) {
  if (typeof token !== 'string') return ''
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

// Normalize a token for lookup. Diacritic folding lets a generated glossary
// that omits/keeps accents still match the tapped word, while the original
// text remains untouched for display.
export function normalizeLookupToken(token) {
  const stripped = stripWordPunct(token).toLowerCase()
  if (!stripped) return ''
  return stripped.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function lookupStems(norm) {
  if (!norm || norm.length < 5) return [norm].filter(Boolean)
  const stems = new Set([norm])
  const endings = [
    'ovima', 'evima', 'ama', 'ima',
    'ega', 'oga', 'om', 'em',
    'ih', 'og', 'oj', 'im',
    'es', 'os', 'as', 's',
    'a', 'e', 'i', 'o', 'u',
  ]
  for (const ending of endings) {
    if (norm.endsWith(ending) && norm.length - ending.length >= 4) {
      stems.add(norm.slice(0, -ending.length))
    }
  }
  // Spanish plural -ces often maps back to -z (lápices → lapiz).
  if (norm.endsWith('ces') && norm.length > 5) {
    stems.add(`${norm.slice(0, -3)}z`)
  }
  return [...stems]
}

// Conservative loose match for glossary lookup and highlighting. It catches
// common learner pain points — plural/case/conjugated surface forms — without
// allowing tiny function words to collide with unrelated longer words.
export function tokensLooselyMatch(a, b) {
  const left = normalizeLookupToken(a)
  const right = normalizeLookupToken(b)
  if (!left || !right) return false
  if (left === right) return true
  const shortest = left.length <= right.length ? left : right
  const longest = left.length > right.length ? left : right
  if (shortest.length >= 5 && longest.startsWith(shortest) && longest.length - shortest.length <= 3) {
    return true
  }
  const leftStems = lookupStems(left).filter((s) => s.length >= 5)
  const rightStems = new Set(lookupStems(right).filter((s) => s.length >= 5))
  return leftStems.some((stem) => rightStems.has(stem))
}

// Find the word-token range matching `phrase` (single word or multi-word,
// e.g. a glossary word_b like "se sentó"), comparing punctuation-stripped
// lowercased words. Returns { start, end } as inclusive wordIdx bounds of
// the first match, or null.
export function findPhraseTokenRange(tokens, phrase) {
  if (typeof phrase !== 'string' || !phrase.trim()) return null
  const target = phrase
    .trim()
    .split(/\s+/)
    .map((w) => stripWordPunct(w).toLowerCase())
    .filter(Boolean)
  if (target.length === 0) return null
  const words = tokens.filter((t) => t.isWord)
  for (let i = 0; i + target.length <= words.length; i++) {
    let match = true
    for (let j = 0; j < target.length; j++) {
      if (!tokensLooselyMatch(words[i + j].text, target[j])) {
        match = false
        break
      }
    }
    if (match) {
      return { start: words[i].wordIdx, end: words[i + target.length - 1].wordIdx }
    }
  }
  return null
}

// Find a phrase occurrence that contains a specific tapped word. A glossary
// phrase can contain a common word ("a hundred", "to pay attention") while
// that same word appears several other times in the paragraph. Looking up by
// word value alone makes every occurrence resolve to the phrase, even when the
// reader tapped an unrelated "a" or "to". This occurrence-aware variant only
// returns a match when the tapped token is actually inside the matched phrase.
export function findPhraseTokenRangeAt(tokens, phrase, wordIdx) {
  if (!Number.isInteger(wordIdx) || wordIdx < 0) return null
  if (typeof phrase !== 'string' || !phrase.trim()) return null
  const target = phrase
    .trim()
    .split(/\s+/)
    .map((w) => stripWordPunct(w).toLowerCase())
    .filter(Boolean)
  if (target.length === 0) return null
  const words = tokens.filter((t) => t.isWord)
  for (let i = 0; i + target.length <= words.length; i++) {
    const start = words[i].wordIdx
    const end = words[i + target.length - 1].wordIdx
    if (wordIdx < start || wordIdx > end) continue
    let match = true
    for (let j = 0; j < target.length; j++) {
      if (!tokensLooselyMatch(words[i + j].text, target[j])) {
        match = false
        break
      }
    }
    if (match) return { start, end }
  }
  return null
}

export function sentenceText(tokens, sentIdx) {
  if (!Array.isArray(tokens) || !Number.isInteger(sentIdx) || sentIdx < 0) return ''
  return tokens
    .filter((t) => t.sentIdx === sentIdx)
    .map((t) => t.text)
    .join('')
    .trim()
}

// Choose which sentence in the OTHER pane is the context for a tap. When the
// glossary translation was actually located in that pane (`range`), its own
// sentence is the honest context — the position-aligned index can disagree
// with it because sentence counts differ between the two languages. Without a
// located phrase, fall back to the position-aligned index (clamped).
export function contextSentenceIndex(tokens, srcSentIdx, range) {
  if (range) {
    const startTok = tokens.find((t) => t.isWord && t.wordIdx === range.start)
    if (startTok) return startTok.sentIdx
  }
  return alignSentenceIndex(srcSentIdx, sentenceCount(tokens))
}

// Build the lookup card's context line: the other-language sentence aligned to
// the tapped word, split into runs with the located glossary phrase marked
// strong. Returns plain {text, strong} runs (the card just maps over them), or
// null when there is no sentence to show.
export function buildAlignedContext(otherText, srcSentIdx, phrase) {
  const tokens = tokenizeParagraph(otherText)
  const range = phrase ? findPhraseTokenRange(tokens, phrase) : null
  const sentIdx = contextSentenceIndex(tokens, srcSentIdx, range)
  if (sentIdx < 0) return null
  const runs = []
  let lastWordIdx = -1
  for (const tok of tokens) {
    if (tok.isWord && tok.sentIdx !== sentIdx) lastWordIdx = tok.wordIdx
    if (tok.sentIdx !== sentIdx) continue
    let strong = false
    if (range) {
      // A whitespace gap is strong when it sits strictly INSIDE the phrase
      // (between two in-range words), so "sat down" renders as one run.
      strong = tok.isWord
        ? tok.wordIdx >= range.start && tok.wordIdx <= range.end
        : lastWordIdx >= range.start && lastWordIdx < range.end
    }
    if (tok.isWord) lastWordIdx = tok.wordIdx
    const last = runs[runs.length - 1]
    if (last && last.strong === strong) last.text += tok.text
    else runs.push({ text: tok.text, strong })
  }
  if (runs.length === 0) return null
  runs[0].text = runs[0].text.replace(/^\s+/, '')
  runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '')
  return runs.filter((run) => run.text !== '')
}
