// Regression for generate.sh story extraction: model-supplied ids must be
// canonical lowercase UUID v4 ids, matching the continuation selector.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const GENERATE_SH = readFileSync(join(HERE, '..', 'generate.sh'), 'utf8')

function extractStoryExtractor(script) {
  const anchor = 'raw_path, out_path, lang_a, lang_b, level = sys.argv[1:6]'
  const anchorIdx = script.indexOf(anchor)
  assert.ok(anchorIdx !== -1, 'could not locate the story extraction block in generate.sh')
  const invokeIdx = script.lastIndexOf('python3 - "$RAW_OUTPUT"', anchorIdx)
  assert.ok(invokeIdx !== -1, 'could not locate the extract_story python invocation')
  const openIdx = script.indexOf("<<'PY'", invokeIdx)
  assert.ok(openIdx !== -1, 'could not locate the opening heredoc marker')
  const progStart = script.indexOf('\n', openIdx) + 1
  const progEnd = script.indexOf('\nPY\n', progStart)
  assert.ok(progEnd !== -1, 'could not locate the closing heredoc marker')
  return script.slice(progStart, progEnd)
}

const STORY_EXTRACT_SRC = extractStoryExtractor(GENERATE_SH)

function runStoryExtractor(story) {
  const dir = mkdtempSync(join(tmpdir(), 'tandem-story-extract-'))
  try {
    const progPath = join(dir, 'extract.py')
    const rawPath = join(dir, 'raw.out')
    const outPath = join(dir, 'story.json')
    writeFileSync(progPath, STORY_EXTRACT_SRC)
    writeFileSync(rawPath, JSON.stringify(story))
    const stdout = execFileSync(
      'python3',
      [progPath, rawPath, outPath, 'English', 'Spanish', 'B1', 'claude'],
      { encoding: 'utf8' },
    )
    return {
      printedId: stdout.trim(),
      story: JSON.parse(readFileSync(outPath, 'utf8')),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('model-returned non-v4 UUID is replaced with a continuable v4 id', () => {
  const v1 = '11111111-2222-1333-8444-555555555555'
  const result = runStoryExtractor({
    id: v1,
    title_a: 'The Door',
    title_b: 'La Puerta',
    lang_a: 'English',
    lang_b: 'Spanish',
    level: 'B1',
    paragraphs: [{ a: 'The door opened.', b: 'La puerta se abrió.', glossary: [] }],
  })

  assert.notEqual(result.printedId, v1)
  assert.equal(result.story.id, result.printedId)
  assert.match(result.story.id, V4_RE)
})

test('canonical v4 model id is preserved', () => {
  const v4 = '11111111-2222-4333-8444-555555555555'
  const result = runStoryExtractor({
    id: v4,
    title_a: 'The Door',
    title_b: 'La Puerta',
    lang_a: 'English',
    lang_b: 'Spanish',
    level: 'B1',
    paragraphs: [{ a: 'The door opened.', b: 'La puerta se abrió.', glossary: [] }],
  })

  assert.equal(result.printedId, v4)
  assert.equal(result.story.id, v4)
})
