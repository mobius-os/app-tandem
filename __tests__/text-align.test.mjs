// Unit tests for the pure word/sentence alignment helpers. Run with:
//   node --test __tests__/text-align.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  tokenizeParagraph,
  sentenceCount,
  alignSentenceIndex,
  stripWordPunct,
  findPhraseTokenRange,
} from '../text-align.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Sync guard: index.jsx ships an INLINED copy of these helpers (the installer
// compiles only the entry file). Assert distinctive snippets appear verbatim
// (whitespace-normalised) inside index.jsx.
// ---------------------------------------------------------------------------
test('inlined text-align in index.jsx stays in sync with text-align.mjs', () => {
  const norm = (s) => s.replace(/\s+/g, ' ')
  const index = norm(readFileSync(join(HERE, '..', 'index.jsx'), 'utf8'))
  const distinctive = [
    "tokens.push({ text: part, isWord, wordIdx: isWord ? wordIdx : -1, sentIdx })",
    "if (SENTENCE_END_RE.test(part)) sentIdx += 1",
    "if (!Number.isInteger(dstCount) || dstCount < 1) return -1",
    "return Math.min(srcIdx, dstCount - 1)",
    "return token.replace(/^[^\\p{L}\\p{N}]+|[^\\p{L}\\p{N}]+$/gu, '')",
    "return { start: words[i].wordIdx, end: words[i + target.length - 1].wordIdx }",
  ]
  for (const snippet of distinctive) {
    assert.ok(
      index.includes(norm(snippet)),
      `index.jsx inline drifted: missing "${snippet}"`,
    )
  }
})

// ---------------------------------------------------------------------------
// tokenizeParagraph
// ---------------------------------------------------------------------------
test('tokenizeParagraph returns [] for empty/non-string input', () => {
  assert.deepEqual(tokenizeParagraph(''), [])
  assert.deepEqual(tokenizeParagraph(null), [])
  assert.deepEqual(tokenizeParagraph(undefined), [])
})

test('tokenizeParagraph splits words and whitespace, preserving the text', () => {
  const tokens = tokenizeParagraph('The cat sat.')
  assert.equal(tokens.map((t) => t.text).join(''), 'The cat sat.')
  const words = tokens.filter((t) => t.isWord)
  assert.deepEqual(words.map((t) => t.text), ['The', 'cat', 'sat.'])
  assert.deepEqual(words.map((t) => t.wordIdx), [0, 1, 2])
})

test('tokenizeParagraph gives whitespace tokens wordIdx -1', () => {
  const tokens = tokenizeParagraph('a b')
  const ws = tokens.find((t) => !t.isWord)
  assert.ok(ws)
  assert.equal(ws.wordIdx, -1)
})

test('tokenizeParagraph increments sentence index after . ! ? …', () => {
  const tokens = tokenizeParagraph('One. Two! Three? Four… Five')
  const words = tokens.filter((t) => t.isWord)
  assert.deepEqual(words.map((t) => t.sentIdx), [0, 1, 2, 3, 4])
})

test('tokenizeParagraph keeps multi-word sentences in one sentence index', () => {
  const tokens = tokenizeParagraph('Maria looked everywhere. She found nothing at all.')
  const words = tokens.filter((t) => t.isWord)
  assert.deepEqual(words.map((t) => t.sentIdx), [0, 0, 0, 1, 1, 1, 1, 1])
})

test('tokenizeParagraph handles sentence-final punctuation followed by a closing quote', () => {
  const tokens = tokenizeParagraph('"Stop!" she said.')
  const words = tokens.filter((t) => t.isWord)
  // "Stop!" ends sentence 0; she said. is sentence 1
  assert.deepEqual(words.map((t) => t.sentIdx), [0, 1, 1])
})

test('tokenizeParagraph handles CJK sentence enders', () => {
  const tokens = tokenizeParagraph('これは犬。 それは猫。')
  const words = tokens.filter((t) => t.isWord)
  assert.deepEqual(words.map((t) => t.sentIdx), [0, 1])
})

test('whitespace after a sentence end belongs to the NEXT sentence (no trailing-gap highlight)', () => {
  const tokens = tokenizeParagraph('One. Two.')
  // tokens: 'One.'(s0) ' '(?) 'Two.'(s1)
  const ws = tokens.find((t) => !t.isWord)
  assert.equal(ws.sentIdx, 1)
})

// ---------------------------------------------------------------------------
// sentenceCount
// ---------------------------------------------------------------------------
test('sentenceCount counts sentences from tokenized text', () => {
  assert.equal(sentenceCount(tokenizeParagraph('One. Two. Three.')), 3)
  assert.equal(sentenceCount(tokenizeParagraph('No terminal punctuation here')), 1)
  assert.equal(sentenceCount(tokenizeParagraph('')), 0)
})

// ---------------------------------------------------------------------------
// alignSentenceIndex — clamped sentence-by-index pane alignment
// ---------------------------------------------------------------------------
test('alignSentenceIndex passes the index through when in range', () => {
  assert.equal(alignSentenceIndex(0, 3), 0)
  assert.equal(alignSentenceIndex(1, 3), 1)
  assert.equal(alignSentenceIndex(2, 3), 2)
})

test('alignSentenceIndex clamps past-the-end indices to the last sentence', () => {
  assert.equal(alignSentenceIndex(5, 3), 2)
  assert.equal(alignSentenceIndex(99, 1), 0)
})

test('alignSentenceIndex returns -1 when the destination has no sentences', () => {
  assert.equal(alignSentenceIndex(0, 0), -1)
  assert.equal(alignSentenceIndex(2, -1), -1)
})

test('alignSentenceIndex returns -1 for invalid source indices', () => {
  assert.equal(alignSentenceIndex(-1, 3), -1)
  assert.equal(alignSentenceIndex(1.5, 3), -1)
  assert.equal(alignSentenceIndex(null, 3), -1)
})

// ---------------------------------------------------------------------------
// stripWordPunct
// ---------------------------------------------------------------------------
test('stripWordPunct strips surrounding punctuation, keeps inner letters', () => {
  assert.equal(stripWordPunct('sentó.'), 'sentó')
  assert.equal(stripWordPunct('"¿Hola?"'), 'Hola')
  assert.equal(stripWordPunct('cat'), 'cat')
  assert.equal(stripWordPunct("l'eau"), "l'eau")
})

test('stripWordPunct returns empty string for pure punctuation / non-strings', () => {
  assert.equal(stripWordPunct('—'), '')
  assert.equal(stripWordPunct(null), '')
})

// ---------------------------------------------------------------------------
// findPhraseTokenRange — glossary word/phrase → token range in the other pane
// ---------------------------------------------------------------------------
const PARA_B = 'Un gato se sentó en la alfombra. Luego se durmió.'

test('findPhraseTokenRange finds a single word (punctuation-insensitive)', () => {
  const tokens = tokenizeParagraph(PARA_B)
  const range = findPhraseTokenRange(tokens, 'alfombra')
  assert.deepEqual(range, { start: 6, end: 6 })
})

test('findPhraseTokenRange finds a multi-word phrase', () => {
  const tokens = tokenizeParagraph(PARA_B)
  const range = findPhraseTokenRange(tokens, 'se sentó')
  assert.deepEqual(range, { start: 2, end: 3 })
})

test('findPhraseTokenRange is case-insensitive', () => {
  const tokens = tokenizeParagraph(PARA_B)
  const range = findPhraseTokenRange(tokens, 'UN GATO')
  assert.deepEqual(range, { start: 0, end: 1 })
})

test('findPhraseTokenRange returns null when the phrase is absent', () => {
  const tokens = tokenizeParagraph(PARA_B)
  assert.equal(findPhraseTokenRange(tokens, 'elefante'), null)
})

test('findPhraseTokenRange returns null for empty phrase or empty tokens', () => {
  assert.equal(findPhraseTokenRange(tokenizeParagraph(PARA_B), ''), null)
  assert.equal(findPhraseTokenRange(tokenizeParagraph(PARA_B), null), null)
  assert.equal(findPhraseTokenRange([], 'gato'), null)
})

test('findPhraseTokenRange returns the FIRST match', () => {
  const tokens = tokenizeParagraph('se fue y se fue')
  const range = findPhraseTokenRange(tokens, 'se fue')
  assert.deepEqual(range, { start: 0, end: 1 })
})
