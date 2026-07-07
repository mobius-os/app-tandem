// Guards on the v0.10 free-form-prompt contract (replaces the v0.9
// series/storyline persistence the GenerateSheet split topic + storyline into).
//
// The contract: the reader types ONE free-form prompt. It is PER-RUN by design
// -- it lives only inside next_request, which generate.sh removes after every run,
// so the next generation starts blank. There is
// no persistent storyline pref any more. Language/level still persist at the top
// level of prefs. A mid-upgrade run whose next_request still carries a legacy
// topic/storyline (but no prompt) must fold those into the prompt rather than
// drop them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const GENERATE_SH = readFileSync(join(HERE, '..', 'generate.sh'), 'utf8')

// The post-run wipe generate.sh performs on prefs: clear next_request only.
function wipeNextRequest(prefs) {
  const next = { ...prefs }
  delete next.next_request
  return next
}

// The shape index.jsx writes when the reader generates with a free-form prompt
// (mirrors LibraryTab.handleSheetGenerate): the prompt lives ONLY inside
// next_request, alongside the persisted language/level at the top level.
function prefsWithPrompt(base, promptVal) {
  return {
    ...base,
    next_request: {
      lang_a: base.lang_a,
      lang_b: base.lang_b,
      ...(promptVal ? { prompt: promptVal } : {}),
    },
  }
}

// ---------------------------------------------------------------------------
// Prefs shape -- the prompt is per-run and does NOT survive the wipe
// ---------------------------------------------------------------------------
test('the free-form prompt rides inside next_request before the wipe', () => {
  const before = prefsWithPrompt(
    { lang_a: 'English', lang_b: 'French', level: 'B1' },
    'continue the cartographer story but darker',
  )
  assert.equal(before.next_request.prompt, 'continue the cartographer story but darker')
})

test('the prompt does NOT survive the next_request wipe (per-run by design)', () => {
  const before = prefsWithPrompt(
    { lang_a: 'English', lang_b: 'French', level: 'B1' },
    'a sci-fi mystery',
  )
  const after = wipeNextRequest(before)
  assert.equal('next_request' in after, false, 'next_request must be removed by the wipe')
  assert.equal('prompt' in after, false, 'the prompt must not leak to the top level')
})

test('there is no persistent top-level storyline any more', () => {
  const before = prefsWithPrompt(
    { lang_a: 'English', lang_b: 'French', level: 'B1' },
    'continue X',
  )
  assert.equal('storyline' in before, false,
    'the GenerateSheet must not write a persistent storyline')
})

test('the wipe preserves the persistent language/level prefs', () => {
  const before = prefsWithPrompt(
    { lang_a: 'English', lang_b: 'German', level: 'B2', gen_model: 'sonnet' },
    'the Greenfield detective files',
  )
  const after = wipeNextRequest(before)
  assert.equal(after.lang_a, 'English')
  assert.equal(after.lang_b, 'German')
  assert.equal(after.level, 'B2')
  assert.equal(after.gen_model, 'sonnet')
})

// ---------------------------------------------------------------------------
// generate.sh -- reads the prompt, builds the index, migrates legacy fields
// ---------------------------------------------------------------------------
test('generate.sh reads the free-form prompt from next_request', () => {
  assert.ok(GENERATE_SH.includes('prompt = next_req.get("prompt")'),
    'the prompt must be sourced from next_request')
})

test('generate.sh folds a legacy topic/storyline into the prompt when no prompt is set', () => {
  // The lenient migration: old next_request.topic / next_request.storyline /
  // prefs.storyline collapse into the free-form prompt, newest first.
  assert.ok(GENERATE_SH.includes('next_req.get("topic")'),
    'a legacy next_request.topic must still be readable for migration')
  assert.ok(GENERATE_SH.includes('prefs.get("storyline")'),
    'a legacy persistent storyline must still be readable for migration')
})

test('generate.sh threads the prompt into the generation prompt under Reader request', () => {
  assert.ok(GENERATE_SH.includes('"$PROMPT_TEXT"'),
    'the prompt shell variable must be interpolated into the prompt file')
  assert.ok(GENERATE_SH.includes('## Reader request'),
    'the prompt file must carry a Reader request section')
})
