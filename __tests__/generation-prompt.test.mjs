// Guards on the GENERATION side of the contract: system-prompt.md and
// generate.sh must ask for the longer stories, full glossary coverage, and
// difficulty-rating steering. These are generation-only requirements — the
// read path (normalizeStory) must stay lenient and is tested separately.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SYSTEM_PROMPT = readFileSync(join(HERE, '..', 'system-prompt.md'), 'utf8')
const GENERATE_SH = readFileSync(join(HERE, '..', 'generate.sh'), 'utf8')

// ---------------------------------------------------------------------------
// system-prompt.md
// ---------------------------------------------------------------------------
test('system prompt targets 14–20 paragraph pairs', () => {
  assert.ok(SYSTEM_PROMPT.includes('14–20 paragraph pairs'),
    'expected the global 14–20 paragraph target')
  // No CEFR band may still carry the old short targets.
  assert.ok(!/1[0-3]–1[0-6] paragraph pairs/.test(SYSTEM_PROMPT),
    'found a stale 10–16-range paragraph target')
})

test('system prompt demands glossary coverage of all non-trivial content words', () => {
  assert.match(SYSTEM_PROMPT, /ALL non-trivial content words/i)
  assert.ok(SYSTEM_PROMPT.includes('4–8 entries per paragraph'))
})

test('system prompt requires glossary words verbatim from the paragraph text', () => {
  assert.match(SYSTEM_PROMPT, /VERBATIM/i)
})

test('system prompt explains difficulty-rating steering', () => {
  assert.match(SYSTEM_PROMPT, /recent difficulty ratings/i)
  assert.match(SYSTEM_PROMPT, /too hard/)
  assert.match(SYSTEM_PROMPT, /too easy/)
})

// ---------------------------------------------------------------------------
// generate.sh
// ---------------------------------------------------------------------------
test('generate.sh surfaces recent ratings into the prompt parameters', () => {
  assert.ok(GENERATE_SH.includes('Recent difficulty ratings from the reader'),
    'prompt must carry the recent ratings line')
  assert.ok(GENERATE_SH.includes('"$RATINGS"'),
    'the ratings shell variable must be interpolated into the prompt')
})

test('generate.sh maps stored verdicts to reader-facing labels', () => {
  for (const pair of ['"too_simple": "too easy"', '"just_right": "just right"', '"too_complex": "too hard"']) {
    assert.ok(GENERATE_SH.includes(pair), `missing verdict mapping ${pair}`)
  }
})

test('generate.sh still adapts the CEFR level from the last 3 ratings', () => {
  assert.ok(GENERATE_SH.includes('history[-3:]'))
  assert.ok(GENERATE_SH.includes('CEFR[min(idx + 1, len(CEFR) - 1)]'))
  assert.ok(GENERATE_SH.includes('CEFR[max(idx - 1, 0)]'))
})

test('generate.sh read-side validation stays lenient (no glossary/length requirement)', () => {
  // The extraction block keeps paragraphs with any a/b text and tolerates
  // missing glossaries — it must never require the generation-side targets.
  assert.ok(GENERATE_SH.includes('if len(clean_paragraphs) < 1:'),
    'only the ≥1-paragraph floor may be enforced on extraction')
  assert.ok(!GENERATE_SH.includes('len(clean_paragraphs) < 10'),
    'extraction must not enforce a paragraph-count bar')
})
