// BEHAVIORAL security tests for generate.sh's pass-1 id validation.
//
// The selection pass lets the agent return {"relevant_ids": [...]}; generate.sh
// then validates each id (canonical UUID v4 + membership in THIS app's index +
// cap ≤6) before loading any story file via the storage API. A string-match
// test (`GENERATE_SH.includes('...')`) only proves the guard TEXT exists — not
// that it FIRES. These tests EXECUTE the real validation block: we slice the
// exact python heredoc out of the live generate.sh and run it with crafted
// adversarial payloads. Because the program under test is extracted from the
// shipped script at run time, weakening the guard in generate.sh makes these
// tests fail — there is no copy to drift out of sync.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const GENERATE_SH = readFileSync(join(HERE, '..', 'generate.sh'), 'utf8')

// --- Extract the exact selection-validation program from the live script. ----
// The block is the `SELECT_JSON=$(python3 - ... <<'PY' ... PY` heredoc. We
// anchor on the unique argv-unpacking line inside it and slice between the
// opening `<<'PY'` and the closing `PY`. If the heredoc is restructured, this
// throws — which is the correct failure (the test must track the real code).
function extractSelectValidator(script) {
  const anchor = 'raw_path, index_path, provider = sys.argv[1], sys.argv[2], sys.argv[3]'
  const anchorIdx = script.indexOf(anchor)
  assert.ok(anchorIdx !== -1, 'could not locate the selection-validation block in generate.sh')
  const invokeIdx = script.lastIndexOf('SELECT_JSON=$(python3', anchorIdx)
  assert.ok(invokeIdx !== -1, 'could not locate the SELECT_JSON invocation')
  const openIdx = script.indexOf("<<'PY'", invokeIdx)
  assert.ok(openIdx !== -1, 'could not locate the opening heredoc marker')
  const progStart = script.indexOf('\n', openIdx) + 1
  const progEnd = script.indexOf('\nPY\n', progStart)
  assert.ok(progEnd !== -1, 'could not locate the closing heredoc marker')
  const program = script.slice(progStart, progEnd)
  assert.ok(program.includes(anchor), 'extracted program missing its anchor line')
  return program
}

const VALIDATOR_SRC = extractSelectValidator(GENERATE_SH)

// Run the REAL extracted validator: write it + a crafted index + a crafted raw
// agent output (a {"relevant_ids": [...]} payload) to a temp dir, then exec it
// exactly as generate.sh does (python3 prog raw index provider). Returns the
// list of ids the validator deemed loadable.
function runValidator(indexEntries, relevantIds, provider = 'claude', rawOverride = null) {
  const dir = mkdtempSync(join(tmpdir(), 'tandem-select-'))
  try {
    const progPath = join(dir, 'validate.py')
    const rawPath = join(dir, 'raw.out')
    const idxPath = join(dir, 'index.json')
    writeFileSync(progPath, VALIDATOR_SRC)
    const raw = rawOverride !== null
      ? rawOverride
      : JSON.stringify({ relevant_ids: relevantIds })
    writeFileSync(rawPath, raw)
    writeFileSync(idxPath, JSON.stringify(indexEntries))
    const stdout = execFileSync('python3', [progPath, rawPath, idxPath, provider], {
      encoding: 'utf8',
    })
    return JSON.parse(stdout || '[]')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// A canonical, lowercase UUID v4 — the exact shape generate.sh mints via
// uuid_mod.uuid4(). These are the only ids that legitimately exist in a library.
const GOOD = '11111111-2222-4333-8444-555555555555'
const GOOD2 = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee'

test('genuine in-index canonical v4 id is ACCEPTED', () => {
  const out = runValidator([{ id: GOOD }, { id: GOOD2 }], [GOOD])
  assert.deepEqual(out, [GOOD], 'a real, in-index v4 id must load')
})

test('path-traversal strings are REJECTED', () => {
  for (const evil of ['../secret', '../../cli-auth/x', '/etc/passwd', `${GOOD}/../etc`]) {
    const out = runValidator([{ id: GOOD }], [evil])
    assert.deepEqual(out, [], `path-like id must be rejected: ${evil}`)
  }
})

test('a valid-shape v4 UUID that is NOT in the index is REJECTED', () => {
  const notInIndex = '99999999-2222-4333-8444-555555555555'
  const out = runValidator([{ id: GOOD }], [notInIndex])
  assert.deepEqual(out, [], 'membership gate must reject a stranger v4 id')
})

test('non-v4 UUIDs are REJECTED even if smuggled into the index', () => {
  // v1 (version nibble 1) and a bad variant nibble (not 8/9/a/b). Story ids are
  // only ever minted as v4, so the shape gate must refuse these regardless.
  const v1 = '11111111-2222-1333-8444-555555555555'
  const badVariant = '11111111-2222-4333-c444-555555555555'
  assert.deepEqual(runValidator([{ id: v1 }], [v1]), [], 'a v1 UUID must be rejected')
  assert.deepEqual(
    runValidator([{ id: badVariant }], [badVariant]), [],
    'a bad-variant UUID must be rejected',
  )
})

test('non-canonical forms (brace-wrapped, query/CRLF junk) are REJECTED', () => {
  // uuid.UUID() accepts braces and surrounding junk; the canonical-form check is
  // the belt that catches them.
  assert.deepEqual(runValidator([{ id: GOOD }], [`{${GOOD}}`]), [],
    'brace-wrapped uuid must be rejected')
  assert.deepEqual(runValidator([{ id: GOOD }], [`${GOOD}?x=1`]), [],
    'trailing ?query junk must be rejected')
  assert.deepEqual(runValidator([{ id: GOOD }], [`${GOOD}\n../secret`]), [],
    'embedded newline + path must be rejected')
})

test('more than 6 valid in-index ids are CAPPED to 6', () => {
  // v0.12 raised the loaded-story cap from 3 to 6 so the agent can reference a
  // genuinely-relevant series; the membership + canonical-v4 gates are unchanged.
  const ids = Array.from({ length: 8 }, (_, i) =>
    `${i.toString(16).padStart(8, '0')}-2222-4333-8444-555555555555`)
  const out = runValidator(ids.map((id) => ({ id })), ids)
  assert.equal(out.length, 6, 'the loaded-story set must be capped at 6')
  // and every survivor is one of the requested in-index ids
  for (const id of out) assert.ok(ids.includes(id), `unexpected id survived: ${id}`)
})

test('exactly 6 valid in-index ids all survive (boundary)', () => {
  const ids = Array.from({ length: 6 }, (_, i) =>
    `${i.toString(16).padStart(8, '0')}-2222-4333-8444-555555555555`)
  const out = runValidator(ids.map((id) => ({ id })), ids)
  assert.equal(out.length, 6, 'a set of exactly 6 in-index ids must all load')
})

test('a mixed adversarial payload keeps ONLY the in-index canonical v4 ids', () => {
  const out = runValidator(
    [{ id: GOOD }, { id: GOOD2 }],
    [
      '../../cli-auth/x', // traversal
      '11111111-2222-1333-8444-555555555555', // v1
      '99999999-2222-4333-8444-555555555555', // v4 but not in index
      `{${GOOD2}}`, // brace junk
      GOOD, // genuine
      `${GOOD}?q=1`, // query junk on a real id
    ],
  )
  assert.deepEqual(out, [GOOD], 'only the clean in-index v4 id may survive a mixed attack')
})

// --- Non-vacuity guard ------------------------------------------------------
// Prove these tests EXERCISE the logic rather than string-match it: run the
// SAME crafted attack against a deliberately WEAKENED copy of the validator
// (membership + shape gates stripped) and assert it would let the attack
// through. If our tests passed against weak code, they would be vacuous.
test('the suite is non-vacuous: a weakened validator WOULD admit the attack', () => {
  // Defang both gates in place (indentation-preserving): make the shape check
  // always pass and the membership check never fire. The loop body is otherwise
  // untouched, so a leak here can only mean the gates — not some other line —
  // are what stops the attack in the real code.
  const weakened = VALIDATOR_SRC
    .replace('if not is_canonical_v4(rid):    # must be a canonical UUID v4 story-id',
      'if False:    # weakened: shape gate disabled')
    .replace("if rid not in known:            # must be a member of this app's index",
      'if False:            # weakened: membership gate disabled')
  assert.ok(!weakened.includes('if not is_canonical_v4(rid):'),
    'failed to weaken the shape gate for the meta-test')
  assert.ok(!weakened.includes('if rid not in known:'),
    'failed to weaken the membership gate for the meta-test')
  assert.notEqual(weakened, VALIDATOR_SRC, 'failed to weaken the validator for the meta-test')

  const dir = mkdtempSync(join(tmpdir(), 'tandem-weak-'))
  try {
    const progPath = join(dir, 'weak.py')
    const rawPath = join(dir, 'raw.out')
    const idxPath = join(dir, 'index.json')
    writeFileSync(progPath, weakened)
    writeFileSync(rawPath, JSON.stringify({ relevant_ids: ['../secret'] }))
    writeFileSync(idxPath, JSON.stringify([{ id: GOOD }]))
    const out = JSON.parse(
      execFileSync('python3', [progPath, rawPath, idxPath, 'claude'], { encoding: 'utf8' }) || '[]',
    )
    assert.deepEqual(out, ['../secret'],
      'with the gates removed the traversal string must leak through — confirming the real gates are what stops it')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
