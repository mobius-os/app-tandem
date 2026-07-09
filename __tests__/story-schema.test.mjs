// Unit tests for the pure story-schema helpers. Run with:
//   node --test __tests__/story-schema.test.mjs
// (No loader needed — story-schema.mjs is React-free.)
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CEFR_LEVELS,
  STORY_RATINGS,
  adaptLevel,
  lookupGlossary,
  normalizeStory,
  buildIndexEntry,
  removeStoryFromIndex,
  setRatingInIndex,
  totalGlossaryCount,
  meetsContentBar,
} from '../story-schema.mjs'

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

// Whole-word matching: tapping a short word must NOT substring-hit a longer
// unrelated glossary term. These are the reported mispairs from the field.
const SUBSTRING_PARA = {
  a: 'In a mill by the river there lived a tired miller.',
  b: 'V mlinu ob reki je živel pospan mlinar.',
  glossary: [
    { word_a: 'miller', word_b: 'mlinar' },
    { word_a: 'tired', word_b: 'pospanom' },
  ],
}

test('lookupGlossary: tapping "a" does NOT return the "pospanom" entry (substring trap)', () => {
  // "pospanom" contains "a"; the old substring match returned this entry.
  assert.equal(lookupGlossary(SUBSTRING_PARA, 'a'), null)
})

test('lookupGlossary: tapping "mill" does NOT match "miller" (not a whole word)', () => {
  // "miller"/"mlinar" both contain "mill" as a substring; whole-word must miss.
  assert.equal(lookupGlossary(SUBSTRING_PARA, 'mill'), null)
})

test('lookupGlossary: tapping "In" does NOT match "mlinar" (substring trap)', () => {
  // "mlinar" contains "in"; the old lowercase substring match returned it.
  assert.equal(lookupGlossary(SUBSTRING_PARA, 'In'), null)
})

test('lookupGlossary: an exact whole-word tap returns its pair', () => {
  const a = lookupGlossary(SUBSTRING_PARA, 'miller')
  assert.ok(a)
  assert.equal(a.word_b, 'mlinar')
  const b = lookupGlossary(SUBSTRING_PARA, 'mlinar')
  assert.ok(b)
  assert.equal(b.word_a, 'miller')
})

test('lookupGlossary: a tap with adjacent punctuation still matches its whole word', () => {
  // The render side strips punctuation; the lookup applies the same
  // normalization so "miller," / "miller." resolve to the same token.
  assert.equal(lookupGlossary(SUBSTRING_PARA, 'miller,').word_b, 'mlinar')
  assert.equal(lookupGlossary(SUBSTRING_PARA, 'miller.').word_b, 'mlinar')
})

test('lookupGlossary: a token inside a multi-word term matches by whole word', () => {
  const para = {
    a: 'She sat down.',
    b: 'Ella se sentó.',
    glossary: [{ word_a: 'sat down', word_b: 'se sentó' }],
  }
  // Tapping a single constituent token of a multi-word term resolves the pair.
  assert.equal(lookupGlossary(para, 'sat').word_b, 'se sentó')
  assert.equal(lookupGlossary(para, 'sentó').word_a, 'sat down')
  // But a substring of a token ("sent" within "sentó") must NOT match.
  assert.equal(lookupGlossary(para, 'sent'), null)
})

test('lookupGlossary accepts conservative longer-word inflections', () => {
  const para = {
    a: 'The fisherman waited.',
    b: 'Ribaru se činilo dugo.',
    glossary: [{ word_a: 'fisherman', word_b: 'ribar' }],
  }
  assert.equal(lookupGlossary(para, 'ribaru').word_a, 'fisherman')
  assert.equal(lookupGlossary(para, 'riba'), null)
})

// ---------------------------------------------------------------------------
// normalizeStory
// ---------------------------------------------------------------------------
const BASE_PARA = {
  a: 'Maria looked everywhere for her key.',
  b: 'María buscó su llave por todas partes.',
  glossary: [
    { word_a: 'key', word_b: 'llave', note: 'feminine noun' },
    { word_a: 'looked', word_b: 'buscó' },
  ],
}

const GOOD_STORY = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  title_a: 'The Lost Key',
  title_b: 'La Clave Perdida',
  lang_a: 'English',
  lang_b: 'Spanish',
  level: 'B1',
  created: '2026-06-10T12:00:00Z',
  // 10 paragraphs — meets the new minimum
  paragraphs: Array.from({ length: 10 }, () => ({ ...BASE_PARA, glossary: [...BASE_PARA.glossary] })),
}

test('normalizeStory accepts a well-formed story', () => {
  const s = normalizeStory(GOOD_STORY)
  assert.ok(s)
  assert.equal(s.id, GOOD_STORY.id)
  assert.equal(s.title_a, 'The Lost Key')
  assert.equal(s.level, 'B1')
  assert.equal(s.paragraphs.length, 10)
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

test('normalizeStory accepts a story with fewer than 10 paragraphs (lenient read)', () => {
  const threePara = Array.from({ length: 3 }, () => ({ ...BASE_PARA, glossary: [...BASE_PARA.glossary] }))
  const s = normalizeStory({ ...GOOD_STORY, paragraphs: threePara })
  assert.ok(s, 'expected non-null for 3-paragraph story')
  assert.equal(s.paragraphs.length, 3)
})

test('normalizeStory returns null when paragraphs reduce to 0 valid entries', () => {
  // All paragraphs have missing a or b → all dropped → 0 valid → null
  const badParas = Array.from({ length: 5 }, () => ({ a: '', b: 'something', glossary: [] }))
  assert.equal(normalizeStory({ ...GOOD_STORY, paragraphs: badParas }), null)
})

test('normalizeStory defaults level to B1 for an unknown CEFR value', () => {
  const s = normalizeStory({ ...GOOD_STORY, level: 'Z9' })
  assert.ok(s)
  assert.equal(s.level, 'B1')
})

// LENIENT READ — the hard rule. Stories written before the glossary/rating
// fields existed must still open; a strict read validator once bricked the
// whole library.
test('normalizeStory accepts paragraphs with NO glossary field at all (old stories)', () => {
  const oldParas = Array.from({ length: 8 }, () => ({
    a: 'She walked to the harbour.',
    b: 'Ella caminó hasta el puerto.',
  }))
  const s = normalizeStory({ ...GOOD_STORY, paragraphs: oldParas })
  assert.ok(s, 'old glossary-less story must normalize')
  assert.equal(s.paragraphs.length, 8)
  for (const p of s.paragraphs) assert.deepEqual(p.glossary, [])
})

test('normalizeStory accepts a story with no rating field (old stories)', () => {
  const s = normalizeStory(GOOD_STORY)
  assert.ok(s)
  assert.equal('rating' in s, false)
})

test('normalizeStory preserves a valid rating on the story record', () => {
  for (const verdict of STORY_RATINGS) {
    const s = normalizeStory({ ...GOOD_STORY, rating: verdict })
    assert.ok(s)
    assert.equal(s.rating, verdict)
  }
})

test('normalizeStory drops an invalid rating value', () => {
  const s = normalizeStory({ ...GOOD_STORY, rating: 'amazing' })
  assert.ok(s)
  assert.equal('rating' in s, false)
})

test('normalizeStory drops glossary entries missing word_a or word_b', () => {
  // Need 10 paragraphs; vary the first one's glossary to test filtering
  const paragraphs = Array.from({ length: 10 }, (_, idx) =>
    idx === 0
      ? {
          ...BASE_PARA,
          glossary: [
            { word_a: '', word_b: 'llave' },   // missing word_a — dropped
            { word_a: 'key', word_b: 'llave' }, // good
          ],
        }
      : { ...BASE_PARA, glossary: [...BASE_PARA.glossary] },
  )
  const story = { ...GOOD_STORY, paragraphs }
  const s = normalizeStory(story)
  assert.ok(s)
  assert.equal(s.paragraphs[0].glossary.length, 1)
  assert.equal(s.paragraphs[0].glossary[0].word_a, 'key')
})

// ---------------------------------------------------------------------------
// totalGlossaryCount
// ---------------------------------------------------------------------------
test('totalGlossaryCount returns 0 for null/undefined', () => {
  assert.equal(totalGlossaryCount(null), 0)
  assert.equal(totalGlossaryCount(undefined), 0)
})

test('totalGlossaryCount returns 0 for a story with no paragraphs array', () => {
  assert.equal(totalGlossaryCount({}), 0)
  assert.equal(totalGlossaryCount({ paragraphs: null }), 0)
})

test('totalGlossaryCount returns 0 for a story with empty glossaries', () => {
  const story = { paragraphs: [{ glossary: [] }, { glossary: [] }] }
  assert.equal(totalGlossaryCount(story), 0)
})

test('totalGlossaryCount sums entries across all paragraphs', () => {
  const story = {
    paragraphs: [
      { glossary: [{ word_a: 'a', word_b: 'b' }, { word_a: 'c', word_b: 'd' }] },
      { glossary: [{ word_a: 'e', word_b: 'f' }] },
      { glossary: [] },
      { glossary: [{ word_a: 'g', word_b: 'h' }, { word_a: 'i', word_b: 'j' }, { word_a: 'k', word_b: 'l' }] },
    ],
  }
  assert.equal(totalGlossaryCount(story), 6)
})

test('totalGlossaryCount counts entries on a normalized GOOD_STORY', () => {
  const s = normalizeStory(GOOD_STORY)
  // 10 paragraphs × 2 glossary entries = 20
  assert.equal(totalGlossaryCount(s), 20)
})

// ---------------------------------------------------------------------------
// meetsContentBar
// ---------------------------------------------------------------------------
test('meetsContentBar returns false for null', () => {
  assert.equal(meetsContentBar(null), false)
})

test('meetsContentBar returns true for a story with ≥10 paragraphs and ≥15 total glossary entries', () => {
  const s = normalizeStory(GOOD_STORY) // 10 paras, 20 total glossary entries
  assert.ok(s)
  assert.equal(meetsContentBar(s), true)
})

test('meetsContentBar returns false when fewer than 10 paragraphs', () => {
  // Build a story with only 8 paragraphs (won't pass normalizeStory, use raw object)
  const story = {
    paragraphs: Array.from({ length: 8 }, () => ({
      glossary: [{ word_a: 'a', word_b: 'b' }, { word_a: 'c', word_b: 'd' }, { word_a: 'e', word_b: 'f' }],
    })),
  }
  assert.equal(meetsContentBar(story), false)
})

test('meetsContentBar returns false when 10 paragraphs but fewer than 15 total glossary entries', () => {
  // 10 paragraphs, only 1 glossary entry each = 10 total
  const story = {
    paragraphs: Array.from({ length: 10 }, () => ({
      glossary: [{ word_a: 'a', word_b: 'b' }],
    })),
  }
  assert.equal(meetsContentBar(story), false)
})

test('meetsContentBar returns true at the exact boundary (10 paras, 15 entries)', () => {
  // 10 paragraphs; first 5 have 3 entries each = 15 total
  const story = {
    paragraphs: Array.from({ length: 10 }, (_, i) => ({
      glossary: i < 5
        ? [{ word_a: 'a', word_b: 'b' }, { word_a: 'c', word_b: 'd' }, { word_a: 'e', word_b: 'f' }]
        : [],
    })),
  }
  assert.equal(meetsContentBar(story), true)
})

test('meetsContentBar returns false for a valid normalized 3-paragraph story', () => {
  const threePara = Array.from({ length: 3 }, () => ({
    ...BASE_PARA, glossary: [...BASE_PARA.glossary],
  }))
  const s = normalizeStory({ ...GOOD_STORY, paragraphs: threePara })
  assert.ok(s)
  assert.equal(meetsContentBar(s), false)
})

// ---------------------------------------------------------------------------
// removeStoryFromIndex — the index half of story deletion (the file half is
// a storage DELETE; this keeps stories/index.json consistent).
// ---------------------------------------------------------------------------
const SAMPLE_INDEX = [
  { id: 'aaa', title_a: 'One' },
  { id: 'bbb', title_a: 'Two' },
  { id: 'ccc', title_a: 'Three' },
]

test('removeStoryFromIndex removes exactly the matching entry', () => {
  const next = removeStoryFromIndex(SAMPLE_INDEX, 'bbb')
  assert.deepEqual(next.map((e) => e.id), ['aaa', 'ccc'])
})

test('removeStoryFromIndex leaves the index unchanged for an unknown id', () => {
  const next = removeStoryFromIndex(SAMPLE_INDEX, 'zzz')
  assert.deepEqual(next.map((e) => e.id), ['aaa', 'bbb', 'ccc'])
})

test('removeStoryFromIndex does not mutate the input array', () => {
  const input = [...SAMPLE_INDEX]
  removeStoryFromIndex(input, 'aaa')
  assert.equal(input.length, 3)
})

test('removeStoryFromIndex returns [] for a non-array index', () => {
  assert.deepEqual(removeStoryFromIndex(null, 'aaa'), [])
  assert.deepEqual(removeStoryFromIndex(undefined, 'aaa'), [])
  assert.deepEqual(removeStoryFromIndex({ id: 'aaa' }, 'aaa'), [])
})

test('removeStoryFromIndex tolerates malformed entries', () => {
  const messy = [null, 'junk', { id: 'aaa' }, { noId: true }]
  const next = removeStoryFromIndex(messy, 'aaa')
  assert.deepEqual(next, [null, 'junk', { noId: true }])
})

// ---------------------------------------------------------------------------
// setRatingInIndex — mirrors a rating onto the matching index entry so the
// library card can show/edit it without loading the story record.
// ---------------------------------------------------------------------------
test('setRatingInIndex stamps exactly the matching entry', () => {
  const next = setRatingInIndex(SAMPLE_INDEX, 'bbb', 'just_right')
  assert.equal(next.find((e) => e.id === 'bbb').rating, 'just_right')
  assert.equal(next.find((e) => e.id === 'aaa').rating, undefined)
  assert.equal(next.find((e) => e.id === 'ccc').rating, undefined)
})

test('setRatingInIndex replaces an existing rating', () => {
  const rated = [{ id: 'aaa', rating: 'too_simple' }]
  const next = setRatingInIndex(rated, 'aaa', 'too_complex')
  assert.equal(next[0].rating, 'too_complex')
})

test('setRatingInIndex does not mutate the input and tolerates junk', () => {
  const messy = [null, 'junk', { id: 'aaa' }]
  const next = setRatingInIndex(messy, 'aaa', 'just_right')
  assert.deepEqual(messy[2], { id: 'aaa' })
  assert.deepEqual(next, [null, 'junk', { id: 'aaa', rating: 'just_right' }])
  assert.deepEqual(setRatingInIndex(null, 'aaa', 'just_right'), [])
})

// ---------------------------------------------------------------------------
// buildIndexEntry
// ---------------------------------------------------------------------------
test('buildIndexEntry returns only the index-relevant fields', () => {
  const story = normalizeStory(GOOD_STORY)
  const entry = buildIndexEntry(story)
  assert.deepEqual(Object.keys(entry).sort(), [
    'created', 'id', 'lang_a', 'lang_b', 'level', 'summary', 'title_a', 'title_b',
  ])
  assert.equal(entry.id, GOOD_STORY.id)
  // paragraphs should NOT be present
  assert.equal('paragraphs' in entry, false)
})

// ---------------------------------------------------------------------------
// summary (v0.9.0) — the one-line premise that feeds the next generation's
// PREMISE-level anti-repeat list. LENIENT on read: a story or index entry
// without a summary must still normalize / build, so stories written before
// summaries existed keep opening.
// ---------------------------------------------------------------------------
test('normalizeStory carries a non-empty summary through', () => {
  const s = normalizeStory({ ...GOOD_STORY, summary: 'A cartographer races a rival to map an unexplored coast.' })
  assert.ok(s)
  assert.equal(s.summary, 'A cartographer races a rival to map an unexplored coast.')
})

test('normalizeStory trims a padded summary', () => {
  const s = normalizeStory({ ...GOOD_STORY, summary: '   A quiet village hides a clockwork secret.  ' })
  assert.ok(s)
  assert.equal(s.summary, 'A quiet village hides a clockwork secret.')
})

test('normalizeStory omits summary when absent (old stories still open)', () => {
  const s = normalizeStory(GOOD_STORY)
  assert.ok(s, 'a summary-less story must normalize')
  assert.equal('summary' in s, false)
})

test('normalizeStory omits an empty/blank or non-string summary', () => {
  for (const bad of ['', '   ', 42, { x: 1 }, null]) {
    const s = normalizeStory({ ...GOOD_STORY, summary: bad })
    assert.ok(s)
    assert.equal('summary' in s, false, `summary ${JSON.stringify(bad)} should be dropped`)
  }
})

test('buildIndexEntry projects a present summary onto the index entry', () => {
  const s = normalizeStory({ ...GOOD_STORY, summary: 'Two friends decode a letter found in an attic.' })
  const entry = buildIndexEntry(s)
  assert.equal(entry.summary, 'Two friends decode a letter found in an attic.')
})

test('buildIndexEntry defaults summary to "" for a summary-less story (stable shape)', () => {
  const s = normalizeStory(GOOD_STORY) // no summary
  const entry = buildIndexEntry(s)
  // Round-trips leniently: the key is present but empty, so the index entry
  // shape is stable whether or not the story carried a summary.
  assert.equal(entry.summary, '')
})
