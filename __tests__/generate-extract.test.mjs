// Tests for the JSON-extraction logic used in generate.sh.
// The logic is replicated here as a pure JS function so we can unit-test it
// without running the shell script.
import test from 'node:test'
import assert from 'node:assert/strict'

// Mirror the defensive extraction logic from generate.sh's Python block.
function extractStoryJSON(raw) {
  // Strip markdown code fences.
  const stripped = raw.replace(/```(?:json)?\s*/g, '').trim()
  const firstBrace = stripped.indexOf('{')
  const lastBrace = stripped.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null
  const candidate = stripped.slice(firstBrace, lastBrace + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

// Minimal valid story (1 paragraph).
const MINIMAL_STORY = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  title_a: 'The Cat',
  title_b: 'El Gato',
  lang_a: 'English',
  lang_b: 'Spanish',
  level: 'A1',
  created: '2026-01-01T00:00:00Z',
  paragraphs: [{ a: 'A cat sat.', b: 'Un gato se sentó.', glossary: [] }],
}

test('extractStoryJSON parses bare JSON (no fences)', () => {
  const raw = JSON.stringify(MINIMAL_STORY)
  const result = extractStoryJSON(raw)
  assert.ok(result)
  assert.equal(result.title_a, 'The Cat')
})

test('extractStoryJSON strips ```json ... ``` fences', () => {
  const raw = '```json\n' + JSON.stringify(MINIMAL_STORY) + '\n```'
  const result = extractStoryJSON(raw)
  assert.ok(result)
  assert.equal(result.title_a, 'The Cat')
})

test('extractStoryJSON strips plain ``` ... ``` fences', () => {
  const raw = '```\n' + JSON.stringify(MINIMAL_STORY) + '\n```'
  const result = extractStoryJSON(raw)
  assert.ok(result)
  assert.equal(result.title_a, 'The Cat')
})

test('extractStoryJSON handles prose before and after the JSON', () => {
  const raw = 'Here is the story:\n\n' + JSON.stringify(MINIMAL_STORY) + '\n\nThat is all.'
  const result = extractStoryJSON(raw)
  assert.ok(result)
  assert.equal(result.title_a, 'The Cat')
})

test('extractStoryJSON returns null for empty string', () => {
  assert.equal(extractStoryJSON(''), null)
})

test('extractStoryJSON returns null for prose with no JSON', () => {
  assert.equal(extractStoryJSON('I am sorry, I cannot generate a story.'), null)
})

test('extractStoryJSON returns null for malformed JSON', () => {
  assert.equal(extractStoryJSON('{ "id": "abc", "paragraphs": [BROKEN'), null)
})

test('extractStoryJSON handles JSON preceded by markdown fence and trailing text', () => {
  const raw = '```json\n' + JSON.stringify(MINIMAL_STORY) + '\n```\nSome trailing prose.'
  const result = extractStoryJSON(raw)
  assert.ok(result)
  assert.equal(result.lang_b, 'Spanish')
})
