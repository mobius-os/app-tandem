// Unit tests for the pure word/sentence alignment helpers. Run with:
//   node --test __tests__/text-align.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  tokenizeParagraph,
  sentenceCount,
  alignSentenceIndex,
  stripWordPunct,
  findPhraseTokenRange,
  findPhraseTokenRangeAt,
  contextSentenceSpan,
  buildAlignedContext,
  locatePhraseRange,
} from '../text-align.mjs'

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

test('findPhraseTokenRange accepts conservative inflected forms, not substrings', () => {
  const tokens = tokenizeParagraph('Poštedi me, ribaru.')
  assert.deepEqual(findPhraseTokenRange(tokens, 'ribar'), { start: 2, end: 2 })
  assert.equal(findPhraseTokenRange(tokens, 'sent'), null)
})

test('findPhraseTokenRangeAt only matches the tapped occurrence', () => {
  const tokens = tokenizeParagraph('A cat watched a hundred birds.')
  assert.equal(findPhraseTokenRangeAt(tokens, 'a hundred', 0), null)
  assert.deepEqual(findPhraseTokenRangeAt(tokens, 'a hundred', 3), { start: 3, end: 4 })
  assert.deepEqual(findPhraseTokenRangeAt(tokens, 'a hundred', 4), { start: 3, end: 4 })
})

// ---------------------------------------------------------------------------
// contextSentenceIndex + buildAlignedContext (the lookup card's context line)
// ---------------------------------------------------------------------------
test('contextSentenceSpan prefers the located phrase sentence over the aligned index', () => {
  const tokens = tokenizeParagraph('One here. Two there. The cat sat down.')
  const range = findPhraseTokenRange(tokens, 'cat')
  assert.deepEqual(contextSentenceSpan(tokens, 0, range), { lo: 2, hi: 2 })
})

test('contextSentenceSpan falls back to the clamped aligned index without a range', () => {
  const tokens = tokenizeParagraph('One here. Two there.')
  assert.deepEqual(contextSentenceSpan(tokens, 0, null), { lo: 0, hi: 0 })
  assert.deepEqual(contextSentenceSpan(tokens, 5, null), { lo: 1, hi: 1 })
})

test('contextSentenceSpan covers every sentence a phrase straddles (abbreviation false split)', () => {
  const tokens = tokenizeParagraph('He greeted Sr. Garcia warmly today.')
  const range = findPhraseTokenRange(tokens, 'Sr. Garcia')
  assert.deepEqual(contextSentenceSpan(tokens, 0, range), { lo: 0, hi: 1 })
})

test('buildAlignedContext returns the aligned sentence with the phrase marked strong', () => {
  const runs = buildAlignedContext('It was hot. A thirsty crow flew over.', 1, 'thirsty')
  assert.ok(runs)
  assert.equal(runs.map((r) => r.text).join(''), 'A thirsty crow flew over.')
  const strong = runs.filter((r) => r.strong)
  assert.deepEqual(strong.map((r) => r.text), ['thirsty'])
})

test('buildAlignedContext without a phrase returns the aligned sentence, nothing strong', () => {
  const runs = buildAlignedContext('It was hot. A thirsty crow flew over.', 0, '')
  assert.ok(runs)
  assert.equal(runs.map((r) => r.text).join(''), 'It was hot.')
  assert.equal(runs.some((r) => r.strong), false)
})

test('buildAlignedContext follows the phrase into a non-aligned sentence', () => {
  const runs = buildAlignedContext('First one. The crow was thirsty.', 0, 'thirsty')
  assert.ok(runs)
  assert.equal(runs.map((r) => r.text).join(''), 'The crow was thirsty.')
  // Word tokens keep their trailing punctuation, matching the in-pane
  // .is-hit span, so the strong run carries the period too.
  assert.deepEqual(runs.filter((r) => r.strong).map((r) => r.text), ['thirsty.'])
})

test('buildAlignedContext handles multi-word phrases as one strong run', () => {
  const runs = buildAlignedContext('She sat down over there.', 0, 'sat down')
  assert.ok(runs)
  assert.deepEqual(runs.filter((r) => r.strong).map((r) => r.text), ['sat down'])
})

test('buildAlignedContext returns null for empty text', () => {
  assert.equal(buildAlignedContext('', 0, 'word'), null)
  assert.equal(buildAlignedContext(null, 0, ''), null)
})

test('locatePhraseRange prefers the occurrence nearest the aligned sentence', () => {
  const tokens = tokenizeParagraph('The cat slept. Then the cat ran.')
  // Tap came from source sentence 1 → aligned sentence 1 → the SECOND "cat".
  assert.deepEqual(locatePhraseRange(tokens, 'cat', 1), { start: 5, end: 5 })
  // From sentence 0 the first occurrence wins.
  assert.deepEqual(locatePhraseRange(tokens, 'cat', 0), { start: 1, end: 1 })
})

test('buildAlignedContext follows the nearest occurrence, not the first', () => {
  const runs = buildAlignedContext('The cat slept. Then the cat ran.', 1, 'cat')
  assert.ok(runs)
  assert.equal(runs.map((r) => r.text).join(''), 'Then the cat ran.')
  assert.deepEqual(runs.filter((r) => r.strong).map((r) => r.text), ['cat'])
})

test('buildAlignedContext keeps a phrase whole across an abbreviation false split', () => {
  const runs = buildAlignedContext('He greeted Sr. Garcia warmly today.', 0, 'Sr. Garcia')
  assert.ok(runs)
  assert.equal(runs.map((r) => r.text).join(''), 'He greeted Sr. Garcia warmly today.')
  assert.deepEqual(runs.filter((r) => r.strong).map((r) => r.text), ['Sr. Garcia'])
})
