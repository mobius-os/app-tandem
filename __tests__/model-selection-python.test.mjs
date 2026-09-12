import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('scheduled migration rewrites the persisted and pending choice once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tandem-model-'))
  const path = join(dir, 'prefs.json')
  writeFileSync(path, JSON.stringify({
    gen_model: 'claude-opus-4-6-20251015',
    next_request: { model: 'claude-sonnet-4-7-20251215', prompt: 'continue' },
    keep: 7,
  }))
  assert.equal(execFileSync('python3', ['model_selection.py', path], { encoding: 'utf8' }).trim(), 'changed')
  assert.deepEqual(JSON.parse(readFileSync(path)), {
    gen_model: 'claude-opus-4-6',
    next_request: { model: 'claude-sonnet-4-6', prompt: 'continue' },
    keep: 7,
  })
  assert.equal(execFileSync('python3', ['model_selection.py', path], { encoding: 'utf8' }).trim(), 'unchanged')
})
