// Regression for generate.sh's end-of-run prefs clear.
//
// The generation job may run for minutes. At the end it must re-fetch fresh
// prefs.json, remove only next_request, and PUT that fresh object rather than
// writing the startup snapshot over settings/rating changes made during the run.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const GENERATE_SH = readFileSync(join(HERE, '..', 'generate.sh'), 'utf8')

function extractPrefsClearer(script) {
  const anchor = 'prefs.pop("next_request", None)'
  const anchorIdx = script.indexOf(anchor)
  assert.ok(anchorIdx !== -1, 'generate.sh must remove next_request from fresh prefs')
  const invokeIdx = script.lastIndexOf('CLEAR_PREFS_CODE=$(python3', anchorIdx)
  assert.ok(invokeIdx !== -1, 'could not locate the prefs clear python invocation')
  const openIdx = script.indexOf("<<'PY'", invokeIdx)
  assert.ok(openIdx !== -1, 'could not locate the opening heredoc marker')
  const progStart = script.indexOf('\n', openIdx) + 1
  const progEnd = script.indexOf('\nPY\n', progStart)
  assert.ok(progEnd !== -1, 'could not locate the closing heredoc marker')
  return script.slice(progStart, progEnd)
}

const PREFS_CLEAR_SRC = extractPrefsClearer(GENERATE_SH)

function runPrefsClearer(prefs, status = '200') {
  const dir = mkdtempSync(join(tmpdir(), 'tandem-prefs-clear-'))
  try {
    const progPath = join(dir, 'clear.py')
    const prefsPath = join(dir, 'prefs.json')
    writeFileSync(progPath, PREFS_CLEAR_SRC)
    writeFileSync(prefsPath, JSON.stringify(prefs))
    const stdout = execFileSync('python3', [progPath, prefsPath, status], { encoding: 'utf8' })
    return JSON.parse(stdout)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('end-of-run prefs clear preserves concurrent settings and ratings', () => {
  const freshPrefs = {
    lang_a: 'English',
    lang_b: 'Spanish',
    level: 'B2',
    gen_provider: 'codex',
    gen_model: 'gpt-5.2-codex',
    feedback_history: [
      { story_id: '11111111-2222-4333-8444-555555555555', verdict: 'too_complex', ts: '2026-07-07T11:00:00Z' },
    ],
    next_request: { prompt: 'old prompt', lang_a: 'English', lang_b: 'Spanish' },
  }
  const cleared = runPrefsClearer(freshPrefs)

  assert.equal('next_request' in cleared, false, 'only the per-run request should be removed')
  assert.equal(cleared.gen_provider, 'codex')
  assert.equal(cleared.gen_model, 'gpt-5.2-codex')
  assert.deepEqual(cleared.feedback_history, freshPrefs.feedback_history)
  assert.equal(cleared.level, 'B2')
})

test('generate.sh fetches fresh prefs immediately before clearing next_request', () => {
  const clearIdx = GENERATE_SH.indexOf('CLEAR_PREFS_CODE=$(python3')
  const freshFetchIdx = GENERATE_SH.lastIndexOf('FRESH_PREFS_CODE=$(curl', clearIdx)
  const staleSnapshotRef = GENERATE_SH.slice(clearIdx, GENERATE_SH.indexOf('PREFS_PUT_CODE=', clearIdx))

  assert.ok(freshFetchIdx !== -1, 'fresh prefs fetch must happen before the clear step')
  assert.ok(staleSnapshotRef.includes('"$FRESH_PREFS_FILE" "$FRESH_PREFS_CODE"'),
    'the clear helper must consume the fresh prefs file, not the startup snapshot')
  assert.ok(!staleSnapshotRef.includes('"$PREFS_FILE" "$PREFS_CODE"'),
    'the clear helper must not consume the startup prefs snapshot')
})
