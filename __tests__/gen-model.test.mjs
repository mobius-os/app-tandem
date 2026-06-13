// Unit tests for the generation-model helpers (settings sheet + prefs).
// Run with: node --test __tests__/gen-model.test.mjs
// (No loader needed — gen-model.mjs is React-free.)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  DEFAULT_MODEL_ID,
  normalizeGenModel,
  modelOptionsFrom,
} from '../gen-model.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Sync guard: index.jsx ships an INLINED copy of these helpers (same pattern
// as story-schema). Assert the distinctive lines appear verbatim.
// ---------------------------------------------------------------------------
test('inlined gen-model helpers in index.jsx stay in sync with gen-model.mjs', () => {
  const norm = (s) => s.replace(/\s+/g, ' ')
  const index = norm(readFileSync(join(HERE, '..', 'index.jsx'), 'utf8'))
  const distinctive = [
    "const DEFAULT_MODEL_ID = ''",
    'if (typeof v !== \'string\') return DEFAULT_MODEL_ID',
    "const options = [{ id: DEFAULT_MODEL_ID, label: 'Default' }]",
    'if (entry.available === false && !isCurrent) continue',
    'const curated = label && label !== entry.id',
    'if (!curated && !isCurrent) continue',
    'options.push({ id: entry.id, label: curated ? label : entry.id })',
    'if (currentId && !options.some((o) => o.id === currentId)) {',
    'options.push({ id: currentId, label: currentId })',
  ]
  for (const snippet of distinctive) {
    assert.ok(
      index.includes(norm(snippet)),
      `index.jsx inline drifted: missing "${snippet}"`,
    )
  }
})

// ---------------------------------------------------------------------------
// normalizeGenModel — the LENIENT-READ contract. Prefs written by any past
// version (no gen_model key) and any malformed value must read as Default.
// ---------------------------------------------------------------------------
test('old prefs without gen_model read as the default', () => {
  assert.equal(normalizeGenModel({ lang_a: 'English', lang_b: 'Spanish', level: 'B1' }), DEFAULT_MODEL_ID)
  assert.equal(normalizeGenModel({}), DEFAULT_MODEL_ID)
})

test('missing or non-object prefs read as the default', () => {
  assert.equal(normalizeGenModel(null), DEFAULT_MODEL_ID)
  assert.equal(normalizeGenModel(undefined), DEFAULT_MODEL_ID)
  assert.equal(normalizeGenModel('prefs'), DEFAULT_MODEL_ID)
})

test('non-string and whitespace gen_model values read as the default', () => {
  assert.equal(normalizeGenModel({ gen_model: 42 }), DEFAULT_MODEL_ID)
  assert.equal(normalizeGenModel({ gen_model: { id: 'x' } }), DEFAULT_MODEL_ID)
  assert.equal(normalizeGenModel({ gen_model: '   ' }), DEFAULT_MODEL_ID)
})

test('gen_model round-trips through prefs the way the app writes it', () => {
  // Select a model: the app sets the key on a prefs copy.
  const base = { lang_a: 'English', lang_b: 'Spanish', level: 'B1' }
  const withModel = { ...base, gen_model: 'claude-opus-4-8' }
  assert.equal(normalizeGenModel(withModel), 'claude-opus-4-8')
  // Select Default: the app deletes the key entirely.
  const backToDefault = { ...withModel }
  delete backToDefault.gen_model
  assert.equal(normalizeGenModel(backToDefault), DEFAULT_MODEL_ID)
  // Other prefs keys survive the round-trip untouched.
  assert.deepEqual(backToDefault, base)
})

test('gen_model values are trimmed', () => {
  assert.equal(normalizeGenModel({ gen_model: '  claude-sonnet-4-6  ' }), 'claude-sonnet-4-6')
})

// ---------------------------------------------------------------------------
// modelOptionsFrom — registry parsing + graceful degradation.
// ---------------------------------------------------------------------------
// A realistic /api/models registry: curated entries (polished label distinct
// from the id) interleaved with the raw, dated aliases the shell hides — same
// model surfaced under a bare id (label === id, or no label at all). Curation
// keeps the polished rows and drops the raw ones.
const REGISTRY = {
  providers: {
    claude: [
      { id: 'claude-opus-4-8', label: 'Opus 4.8', provider: 'claude', available: true },
      { id: 'claude-opus-4-8-20260115', label: 'claude-opus-4-8-20260115', provider: 'claude', available: true },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', provider: 'claude', available: true },
      { id: 'claude-fable-5', provider: 'claude', available: true }, // no label at all
      { id: 'claude-sonnet-4-6-20251101', provider: 'claude', available: true }, // raw dated alias
      { id: 'claude-old-model', label: 'Old Model', provider: 'claude', available: false },
    ],
    codex: [
      { id: 'gpt-5.5', label: 'gpt-5.5', provider: 'codex', available: true },
    ],
  },
}

test('failed fetch (null registry) still offers Default', () => {
  assert.deepEqual(modelOptionsFrom(null, ''), [{ id: '', label: 'Default' }])
})

test('malformed registries still offer Default', () => {
  for (const bad of [undefined, {}, { providers: {} }, { providers: { claude: 'nope' } }]) {
    assert.deepEqual(modelOptionsFrom(bad, ''), [{ id: '', label: 'Default' }])
  }
})

test('Default is always first; only curated (polished-label) claude models follow', () => {
  const options = modelOptionsFrom(REGISTRY, '')
  assert.deepEqual(options.map((o) => o.id), ['', 'claude-opus-4-8', 'claude-sonnet-4-6'])
  assert.equal(options[0].label, 'Default')
  assert.equal(options[1].label, 'Opus 4.8')
  assert.equal(options[2].label, 'Sonnet 4.6')
})

test('raw-id entries (label === id, or no label) are excluded from the curated list', () => {
  const ids = modelOptionsFrom(REGISTRY, '').map((o) => o.id)
  assert.ok(!ids.includes('claude-opus-4-8-20260115'), 'dated alias whose label echoes its id is dropped')
  assert.ok(!ids.includes('claude-fable-5'), 'entry with no label is dropped')
  assert.ok(!ids.includes('claude-sonnet-4-6-20251101'), 'raw dated alias is dropped')
})

test('codex models are excluded — generate.sh runs the Claude CLI', () => {
  const options = modelOptionsFrom(REGISTRY, '')
  assert.ok(!options.some((o) => o.id === 'gpt-5.5'))
})

test('retired (available: false) models are dropped unless currently selected', () => {
  assert.ok(!modelOptionsFrom(REGISTRY, '').some((o) => o.id === 'claude-old-model'))
  const withRetiredCurrent = modelOptionsFrom(REGISTRY, 'claude-old-model')
  const retired = withRetiredCurrent.find((o) => o.id === 'claude-old-model')
  assert.ok(retired, 'the current selection must stay visible even when retired')
  assert.equal(retired.label, 'Old Model')
})

test('a current raw-id selection stays visible even though curation would drop it', () => {
  // The user picked a dated alias before curation landed; it must remain
  // selectable so they can see and change the stale choice.
  const options = modelOptionsFrom(REGISTRY, 'claude-fable-5')
  const kept = options.find((o) => o.id === 'claude-fable-5')
  assert.ok(kept, 'current raw-id selection must survive curation')
  assert.equal(kept.label, 'claude-fable-5', 'falls back to the raw id as its label')
})

test('a current selection missing from the registry is appended with its raw id', () => {
  const options = modelOptionsFrom(REGISTRY, 'claude-future-9')
  const appended = options[options.length - 1]
  assert.deepEqual(appended, { id: 'claude-future-9', label: 'claude-future-9' })
})

test('entries without a usable id are skipped; curated labels survive', () => {
  const registry = {
    providers: {
      claude: [
        { id: '', label: 'Empty' },
        { label: 'No id' },
        null,
        { id: 'claude-x' }, // no label → raw, dropped from the curated list
        { id: 'claude-y', label: '' }, // empty label → raw, dropped
        { id: 'claude-z', label: 'Claude Z' }, // curated, kept
      ],
    },
  }
  const options = modelOptionsFrom(registry, '')
  assert.deepEqual(options.map((o) => o.id), ['', 'claude-z'])
  assert.equal(options[1].label, 'Claude Z')
})

// ---------------------------------------------------------------------------
// generate.sh — the model must flow end-to-end and fail soft.
// ---------------------------------------------------------------------------
const GENERATE_SH = readFileSync(join(HERE, '..', 'generate.sh'), 'utf8')

test('generate.sh reads the model from next_request with a prefs.gen_model fallback', () => {
  assert.ok(
    GENERATE_SH.includes('next_req.get("model") or prefs.get("gen_model")'),
    'parser must prefer the per-run record and fall back to the persisted setting',
  )
})

test('generate.sh sanitizes the model id before it reaches the CLI argv', () => {
  assert.ok(GENERATE_SH.includes('re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", model)'))
})

test('generate.sh passes --model only when a model is set', () => {
  assert.ok(GENERATE_SH.includes('flags+=( --model "$1" )'))
  assert.ok(GENERATE_SH.includes('if [ -n "$1" ]; then'),
    'the --model flag must be guarded — Default means NO flag (platform default)')
})

test('generate.sh retries once on the default model when a custom-model run fails', () => {
  assert.ok(GENERATE_SH.includes('for ATTEMPT_MODEL in ${GEN_MODEL:+"$GEN_MODEL"} ""'),
    'attempt list must be: chosen model (when set), then platform default')
  assert.ok(GENERATE_SH.includes('Retrying with the default model.'))
})

test('generate.sh treats extraction, not exit code, as the success test', () => {
  // The CLI exits 0 with an error sentence for unknown model ids, so the
  // retry must fire on empty STORY_ID too — not only on CLI_EXIT != 0.
  assert.ok(GENERATE_SH.includes('STORY_ID=$(extract_story)'))
  assert.ok(GENERATE_SH.includes('if [ -n "$STORY_ID" ]; then'))
  assert.ok(GENERATE_SH.includes('if [ -z "$STORY_ID" ]; then'))
})
