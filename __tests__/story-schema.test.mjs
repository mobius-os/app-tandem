// Unit tests for the pure story-schema helpers. Run with:
//   node --test __tests__/story-schema.test.mjs
// (No loader needed — story-schema.mjs is React-free.)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  CEFR_LEVELS,
  adaptLevel,
  lookupGlossary,
  normalizeStory,
  buildIndexEntry,
} from '../story-schema.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Sync guard: index.jsx ships an INLINED copy of these helpers. If the
// canonical source changes but the inline doesn't, the shipped app silently
// diverges. Assert that the distinctive function bodies appear verbatim
// (whitespace-normalised) inside index.jsx.
// ---------------------------------------------------------------------------
test('inlined schema in index.jsx stays in sync with story-schema.mjs', () => {
  const norm = (s) => s.replace(/\s+/g, ' ')
  const index = norm(readFileSync(join(HERE, '..', 'index.jsx'), 'utf8'))
  const distinctive = [
    "const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']",
    'if (score > 0) return CEFR_LEVELS[Math.min(idx + 1, CEFR_LEVELS.length - 1)]',
    'if (score < 0) return CEFR_LEVELS[Math.max(idx - 1, 0)]',
    "if (typeof entry.word_a === 'string' && entry.word_a.toLowerCase().includes(needle)) return true",
    "if (typeof entry.word_b === 'string' && entry.word_b.toLowerCase().includes(needle)) return true",
    "const level = CEFR_LEVELS.includes(story.level) ? story.level : 'B1'",
    "id: story.id,",
  ]
  for (const snippet of distinctive) {
    assert.ok(
      index.includes(norm(snippet)),
      `index.jsx inline drifted: missing "${snippet}"`,
    )
  }
})

// ---------------------------------------------------------------------------
// CEFR_LEVELS
// ---------------------------------------------------------------------------
test('CEFR_LEVELS contains exactly the six canonical levels in order', () => {
  assert.deepEqual(CEFR_LEVELS, ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
})

// ---------------------------------------------------------------------------
// adaptLevel
// ---------------------------------------------------------------------------
test('adaptLevel returns currentLevel when feedbackHistory is empty', () => {
  assert.equal(adaptLevel('B1', []), 'B1')
  assert.equal(adaptLevel('B1', null), 'B1')
  assert.equal(adaptLevel('B1', undefined), 'B1')
})

test('adaptLevel moves level up when recent feedback is mostly too_simple', () => {
  const history = [
    { verdict: 'too_simple' },
    { verdict: 'too_simple' },
    { verdict: 'just_right' },
  ]
  assert.equal(adaptLevel('B1', history), 'B2')
})

test('adaptLevel moves level down when recent feedback is mostly too_complex', () => {
  const history = [
    { verdict: 'too_complex' },
    { verdict: 'too_complex' },
    { verdict: 'just_right' },
  ]
  assert.equal(adaptLevel('B1', history), 'A2')
})

test('adaptLevel stays at current level when feedback is balanced', () => {
  const history = [
    { verdict: 'too_simple' },
    { verdict: 'too_complex' },
    { verdict: 'just_right' },
  ]
  assert.equal(adaptLevel('B1', history), 'B1')
})

test('adaptLevel does not go above C2', () => {
  const history = [{ verdict: 'too_simple' }, { verdict: 'too_simple' }]
  assert.equal(adaptLevel('C2', history), 'C2')
})

test('adaptLevel does not go below A1', () => {
  const history = [{ verdict: 'too_complex' }, { verdict: 'too_complex' }]
  assert.equal(adaptLevel('A1', history), 'A1')
})

test('adaptLevel only considers the last 3 entries', () => {
  // 5 "too_complex" entries, but only the last 3 matter:
  // last 3 = [just_right, just_right, too_simple] → score = +1 → up
  const history = [
    { verdict: 'too_complex' },
    { verdict: 'too_complex' },
    { verdict: 'just_right' },
    { verdict: 'just_right' },
    { verdict: 'too_simple' },
  ]
  assert.equal(adaptLevel('B1', history), 'B2')
})

test('adaptLevel returns currentLevel for unknown level string', () => {
  assert.equal(adaptLevel('D9', [{ verdict: 'too_simple' }]), 'D9')
})

// ---------------------------------------------------------------------------
// lookupGlossary
// ---------------------------------------------------------------------------
const SAMPLE_PARA = {
  a: 'The cat sat on the mat.',
  b: 'Le chat était assis sur le tapis.',
  glossary: [
    { word_a: 'cat', word_b: 'chat', note: 'common masculine noun' },
    { word_a: 'mat', word_b: 'tapis' },
  ],
}

test('lookupGlossary finds entry by word_a (case-insensitive)', () => {
  const entry = lookupGlossary(SAMPLE_PARA, 'Cat')
  assert.ok(entry)
  assert.equal(entry.word_b, 'chat')
})

test('lookupGlossary finds entry by word_b (case-insensitive)', () => {
  const entry = lookupGlossary(SAMPLE_PARA, 'Tapis')
  assert.ok(entry)
  assert.equal(entry.word_a, 'mat')
})

test('lookupGlossary returns null for a word not in the glossary', () => {
  assert.equal(lookupGlossary(SAMPLE_PARA, 'elephant'), null)
})

test('lookupGlossary returns null for empty/null input', () => {
  assert.equal(lookupGlossary(null, 'cat'), null)
  assert.equal(lookupGlossary(SAMPLE_PARA, ''), null)
  assert.equal(lookupGlossary(SAMPLE_PARA, null), null)
})

test('lookupGlossary returns null when glossary is missing', () => {
  assert.equal(lookupGlossary({ a: 'x', b: 'y' }, 'cat'), null)
})

// ---------------------------------------------------------------------------
// normalizeStory
// ---------------------------------------------------------------------------
const GOOD_STORY = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  title_a: 'The Lost Key',
  title_b: 'La Clave Perdida',
  lang_a: 'English',
  lang_b: 'Spanish',
  level: 'B1',
  created: '2026-06-10T12:00:00Z',
  paragraphs: [
    {
      a: 'Maria looked everywhere for her key.',
      b: 'María buscó su llave por todas partes.',
      glossary: [
        { word_a: 'key', word_b: 'llave', note: 'feminine noun' },
        { word_a: 'looked', word_b: 'buscó' },
      ],
    },
  ],
}

test('normalizeStory accepts a well-formed story', () => {
  const s = normalizeStory(GOOD_STORY)
  assert.ok(s)
  assert.equal(s.id, GOOD_STORY.id)
  assert.equal(s.title_a, 'The Lost Key')
  assert.equal(s.level, 'B1')
  assert.equal(s.paragraphs.length, 1)
  assert.equal(s.paragraphs[0].glossary.length, 2)
})

test('normalizeStory returns null for null/undefined input', () => {
  assert.equal(normalizeStory(null), null)
  assert.equal(normalizeStory(undefined), null)
  assert.equal(normalizeStory('string'), null)
})

test('normalizeStory returns null when id is missing', () => {
  assert.equal(normalizeStory({ ...GOOD_STORY, id: '' }), null)
})

test('normalizeStory returns null when titles are missing', () => {
  assert.equal(normalizeStory({ ...GOOD_STORY, title_a: '' }), null)
  assert.equal(normalizeStory({ ...GOOD_STORY, title_b: '' }), null)
})

test('normalizeStory returns null when paragraphs is empty after filtering', () => {
  assert.equal(normalizeStory({ ...GOOD_STORY, paragraphs: [] }), null)
  assert.equal(normalizeStory({ ...GOOD_STORY, paragraphs: [{ a: '', b: 'x' }] }), null)
})

test('normalizeStory defaults level to B1 for an unknown CEFR value', () => {
  const s = normalizeStory({ ...GOOD_STORY, level: 'Z9' })
  assert.ok(s)
  assert.equal(s.level, 'B1')
})

test('normalizeStory drops glossary entries missing word_a or word_b', () => {
  const story = {
    ...GOOD_STORY,
    paragraphs: [{
      ...GOOD_STORY.paragraphs[0],
      glossary: [
        { word_a: '', word_b: 'llave' },   // missing word_a — dropped
        { word_a: 'key', word_b: 'llave' }, // good
      ],
    }],
  }
  const s = normalizeStory(story)
  assert.equal(s.paragraphs[0].glossary.length, 1)
  assert.equal(s.paragraphs[0].glossary[0].word_a, 'key')
})

// ---------------------------------------------------------------------------
// buildIndexEntry
// ---------------------------------------------------------------------------
test('buildIndexEntry returns only the index-relevant fields', () => {
  const story = normalizeStory(GOOD_STORY)
  const entry = buildIndexEntry(story)
  assert.deepEqual(Object.keys(entry).sort(), [
    'created', 'id', 'lang_a', 'lang_b', 'level', 'title_a', 'title_b',
  ])
  assert.equal(entry.id, GOOD_STORY.id)
  // paragraphs should NOT be present
  assert.equal('paragraphs' in entry, false)
})
