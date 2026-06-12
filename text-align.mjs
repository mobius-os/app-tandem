// Pure word/sentence alignment helpers for the inline word-tap highlight.
// No React, no DOM globals.
//
// CANONICAL SOURCE — edit here, then mirror the changes to the
// ===== INLINE-TEXT-ALIGN START / END ===== block inside index.jsx.
// __tests__/text-align.test.mjs asserts the inlined copy stays in sync.

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
      if (stripWordPunct(words[i + j].text).toLowerCase() !== target[j]) {
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
