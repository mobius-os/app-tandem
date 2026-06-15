// Guards on the PERSISTENT series/storyline feature (v0.9.0).
//
// The contract: a chosen storyline must survive across generations, unlike a
// per-run `topic`. generate.sh wipes `next_request` after every run
// (`prefs["next_request"] = None`) so anything stored ONLY inside next_request
// is gone by the next generation. The storyline therefore lives at the TOP
// level of prefs (`prefs.storyline`), outside next_request, and only rides
// inside next_request as a per-run mirror for retry symmetry.
//
// There is no exported pure helper for this transition — the persistence is a
// property of the prefs SHAPE shared by index.jsx (the writer) and generate.sh
// (the wiper). These tests model that shape and the wipe as a pure transform.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const GENERATE_SH = readFileSync(join(HERE, '..', 'generate.sh'), 'utf8')

// The exact post-run wipe generate.sh performs on prefs: clear next_request,
// preserve everything else. Modeled as a pure transform so the persistence
// invariant can be asserted without standing up the shell pipeline.
function wipeNextRequest(prefs) {
  return { ...prefs, next_request: null }
}

// The shape index.jsx writes when the reader generates with a storyline set
// (mirrors LibraryTab.handleSheetGenerate): storyline at the top level AND
// inside next_request.
function prefsWithStoryline(base, storylineVal) {
  return {
    ...base,
    storyline: storylineVal,
    next_request: {
      topic: '',
      mode: 'free',
      lang_a: base.lang_a,
      lang_b: base.lang_b,
      ...(storylineVal ? { storyline: storylineVal } : {}),
    },
  }
}

// ---------------------------------------------------------------------------
// Prefs shape — storyline survives the next_request wipe
// ---------------------------------------------------------------------------
test('storyline at the top level survives the next_request wipe', () => {
  const before = prefsWithStoryline(
    { lang_a: 'English', lang_b: 'Spanish', level: 'B1' },
    'continue the adventures of Mira the cartographer',
  )
  // Sanity: it rode inside next_request before the wipe.
  assert.equal(before.next_request.storyline, 'continue the adventures of Mira the cartographer')

  const after = wipeNextRequest(before)
  assert.equal(after.next_request, null, 'next_request must be cleared by the wipe')
  assert.equal(
    after.storyline,
    'continue the adventures of Mira the cartographer',
    'the persistent storyline must remain at the top level after the wipe',
  )
})

test('a topic stored ONLY inside next_request does NOT survive the wipe', () => {
  // Contrast case: topic is per-run by design, so it is gone after the wipe.
  // This is what makes the top-level storyline placement load-bearing.
  const before = {
    lang_a: 'English',
    lang_b: 'Spanish',
    level: 'B1',
    next_request: { topic: 'a haunted lighthouse', mode: 'free' },
  }
  const after = wipeNextRequest(before)
  assert.equal(after.next_request, null)
  assert.equal('topic' in after, false, 'topic must not leak to the top level')
})

test('clearing the storyline persists the empty value (reverts to standalone)', () => {
  // Reader had a storyline, then cleared the field. The empty string must
  // persist so the next generation is standalone, not the stale storyline.
  const had = prefsWithStoryline(
    { lang_a: 'English', lang_b: 'French', level: 'A2' },
    'a sci-fi mystery serial',
  )
  const cleared = prefsWithStoryline({ ...had }, '')
  assert.equal(cleared.storyline, '')
  // Empty storyline must NOT ride inside next_request.
  assert.equal('storyline' in cleared.next_request, false)
  const after = wipeNextRequest(cleared)
  assert.equal(after.storyline, '', 'cleared storyline stays cleared after the wipe')
})

test('the wipe preserves the other persistent prefs alongside storyline', () => {
  const before = prefsWithStoryline(
    { lang_a: 'English', lang_b: 'German', level: 'B2', gen_model: 'sonnet' },
    'the Greenfield detective files',
  )
  const after = wipeNextRequest(before)
  assert.equal(after.lang_a, 'English')
  assert.equal(after.lang_b, 'German')
  assert.equal(after.level, 'B2')
  assert.equal(after.gen_model, 'sonnet')
  assert.equal(after.storyline, 'the Greenfield detective files')
})

// ---------------------------------------------------------------------------
// generate.sh — the read side honours the persistent-first precedence
// ---------------------------------------------------------------------------
test('generate.sh reads storyline from prefs first (so the wipe cannot clear it)', () => {
  // Must read the persistent pref, not only next_request.
  assert.ok(GENERATE_SH.includes('storyline = prefs.get("storyline")'),
    'storyline must be sourced from the persistent prefs')
})

test('generate.sh lets a per-run next_request.storyline override the persistent one', () => {
  assert.ok(GENERATE_SH.includes('nr_storyline = next_req.get("storyline")'),
    'a per-run next_request.storyline must be readable for retry symmetry')
})

test('generate.sh threads the storyline into the generation prompt', () => {
  assert.ok(GENERATE_SH.includes('"$STORYLINE"'),
    'the storyline shell variable must be interpolated into the prompt')
  assert.ok(GENERATE_SH.includes('Storyline / series'),
    'the prompt must carry the Storyline / series parameter line')
})

test('generate.sh surfaces the previous summary as series continuity when a storyline is set', () => {
  assert.ok(GENERATE_SH.includes('Previously in this series:'),
    'a set storyline should feed the previous story summary as continuity')
})
