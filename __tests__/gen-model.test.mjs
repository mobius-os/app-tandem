// Unit tests for the generation-agent helpers (settings sheet + prefs).
// Run with: node --test __tests__/gen-model.test.mjs
// (No loader needed — gen-model.mjs is React-free.)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  DEFAULT_MODEL_ID,
  DEFAULT_PROVIDER,
  CONCRETE_DEFAULT_PROVIDER,
  CONCRETE_DEFAULT_MODEL_ID,
  PROVIDER_ORDER,
  FALLBACK_GROUPS,
  normalizeGenProvider,
  normalizeGenModel,
  needsGenPrefsMigration,
  migrateGenPrefs,
  buildProviderGroups,
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
    "const DEFAULT_PROVIDER = ''",
    'const CONCRETE_DEFAULT_PROVIDER = FALLBACK_GROUPS[0].key',
    'const CONCRETE_DEFAULT_MODEL_ID = FALLBACK_GROUPS[0].models[0].id',
    'return model === \'\' || model.toLowerCase() === \'default\'',
    'if (!needsGenPrefsMigration(prefs)) return prefs',
    'gen_provider: CONCRETE_DEFAULT_PROVIDER,',
    'gen_model: CONCRETE_DEFAULT_MODEL_ID,',
    "{ key: 'claude', label: 'Claude Code' },",
    "{ key: 'codex', label: 'OpenAI Codex' },",
    "if (typeof v !== 'string') return DEFAULT_MODEL_ID",
    "if (t === 'claude' || t === 'codex') return t",
    "return normalizeGenModel(prefs) ? 'claude' : DEFAULT_PROVIDER",
    'const rows = Array.isArray(payload[meta.key]) ? payload[meta.key] : null',
    '.map((r) => ({ id: r.id, name: r.name || r.id })),',
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

test('gen_model values are trimmed', () => {
  assert.equal(normalizeGenModel({ gen_model: '  claude-sonnet-4-6  ' }), 'claude-sonnet-4-6')
})

test('gen_provider + gen_model round-trip the way the app writes them', () => {
  const base = { lang_a: 'English', lang_b: 'Spanish', level: 'B1' }
  // Select a Claude model: the app sets both keys.
  const withClaude = { ...base, gen_provider: 'claude', gen_model: 'claude-opus-4-8' }
  assert.equal(normalizeGenProvider(withClaude), 'claude')
  assert.equal(normalizeGenModel(withClaude), 'claude-opus-4-8')
  // Select a Codex model.
  const withCodex = { ...base, gen_provider: 'codex', gen_model: 'gpt-5.5' }
  assert.equal(normalizeGenProvider(withCodex), 'codex')
  assert.equal(normalizeGenModel(withCodex), 'gpt-5.5')
  // Select Default: the app deletes both keys.
  const backToDefault = { ...withClaude }
  delete backToDefault.gen_provider
  delete backToDefault.gen_model
  assert.equal(normalizeGenProvider(backToDefault), DEFAULT_PROVIDER)
  assert.equal(normalizeGenModel(backToDefault), DEFAULT_MODEL_ID)
  assert.deepEqual(backToDefault, base)
})

// ---------------------------------------------------------------------------
// migrateGenPrefs — the Default picker row was removed. A user sitting on the
// old "unset" selection (no/empty gen_model) must be rewritten ONCE to a
// concrete real model so the picker shows a selected row and generation never
// crashes on a null/empty selection.
// ---------------------------------------------------------------------------
test('CONCRETE_DEFAULT_* point at the first real Claude model the picker offers', () => {
  assert.equal(CONCRETE_DEFAULT_PROVIDER, FALLBACK_GROUPS[0].key)
  assert.equal(CONCRETE_DEFAULT_MODEL_ID, FALLBACK_GROUPS[0].models[0].id)
  // And those are concrete, non-empty values — the whole point of the migration.
  assert.equal(CONCRETE_DEFAULT_PROVIDER, 'claude')
  assert.ok(CONCRETE_DEFAULT_MODEL_ID && CONCRETE_DEFAULT_MODEL_ID !== DEFAULT_MODEL_ID)
})

test('needsGenPrefsMigration flags the old Default / unset states', () => {
  assert.equal(needsGenPrefsMigration({}), true) // no key at all
  assert.equal(needsGenPrefsMigration({ gen_model: '' }), true)
  assert.equal(needsGenPrefsMigration({ gen_model: '   ' }), true)
  assert.equal(needsGenPrefsMigration({ gen_model: 'Default' }), true)
  assert.equal(needsGenPrefsMigration({ gen_model: 'default' }), true)
  assert.equal(needsGenPrefsMigration({ gen_provider: '', gen_model: '' }), true)
  // A provider with no model is still unset (picker only selects them together).
  assert.equal(needsGenPrefsMigration({ gen_provider: 'claude' }), true)
})

test('needsGenPrefsMigration leaves a real model selection alone', () => {
  assert.equal(needsGenPrefsMigration({ gen_provider: 'claude', gen_model: 'claude-opus-4-8' }), false)
  assert.equal(needsGenPrefsMigration({ gen_provider: 'codex', gen_model: 'gpt-5.5' }), false)
  // Non-object / null inputs never need migration (and never throw).
  assert.equal(needsGenPrefsMigration(null), false)
  assert.equal(needsGenPrefsMigration(undefined), false)
  assert.equal(needsGenPrefsMigration('prefs'), false)
})

test('migrateGenPrefs rewrites a Default user onto a concrete real model', () => {
  const base = { lang_a: 'English', lang_b: 'Bosnian', level: 'B1' }
  const migrated = migrateGenPrefs(base)
  assert.notEqual(migrated, base) // new object — caller persists it
  assert.equal(migrated.gen_provider, CONCRETE_DEFAULT_PROVIDER)
  assert.equal(migrated.gen_model, CONCRETE_DEFAULT_MODEL_ID)
  // Other prefs are preserved untouched.
  assert.equal(migrated.lang_a, 'English')
  assert.equal(migrated.lang_b, 'Bosnian')
  assert.equal(migrated.level, 'B1')
  // And the migrated result now reads back as a real, non-empty selection — so
  // the picker highlights a row and generate.sh gets a concrete --model.
  assert.equal(normalizeGenProvider(migrated), CONCRETE_DEFAULT_PROVIDER)
  assert.equal(normalizeGenModel(migrated), CONCRETE_DEFAULT_MODEL_ID)
})

test('migrateGenPrefs maps a literal "Default" string too', () => {
  const migrated = migrateGenPrefs({ gen_provider: '', gen_model: 'Default' })
  assert.equal(migrated.gen_provider, CONCRETE_DEFAULT_PROVIDER)
  assert.equal(migrated.gen_model, CONCRETE_DEFAULT_MODEL_ID)
})

test('migrateGenPrefs is idempotent and identity-stable for a real selection', () => {
  const real = { lang_a: 'English', gen_provider: 'codex', gen_model: 'gpt-5.5' }
  const out = migrateGenPrefs(real)
  assert.equal(out, real) // SAME reference — caller skips the redundant write
  // Running it again on an already-migrated object is a no-op.
  const once = migrateGenPrefs({})
  assert.equal(migrateGenPrefs(once), once)
})

test('migrateGenPrefs never throws on bad input (returns it unchanged)', () => {
  assert.equal(migrateGenPrefs(null), null)
  assert.equal(migrateGenPrefs(undefined), undefined)
  assert.equal(migrateGenPrefs('nope'), 'nope')
})

// ---------------------------------------------------------------------------
// normalizeGenProvider — lenient read + legacy routing.
// ---------------------------------------------------------------------------
test('Default (no provider, no model) reads as the empty provider', () => {
  assert.equal(normalizeGenProvider({}), DEFAULT_PROVIDER)
  assert.equal(normalizeGenProvider(null), DEFAULT_PROVIDER)
  assert.equal(normalizeGenProvider({ lang_a: 'English' }), DEFAULT_PROVIDER)
})

test('known providers pass through (trimmed)', () => {
  assert.equal(normalizeGenProvider({ gen_provider: 'claude' }), 'claude')
  assert.equal(normalizeGenProvider({ gen_provider: 'codex' }), 'codex')
  assert.equal(normalizeGenProvider({ gen_provider: '  codex  ' }), 'codex')
})

test('a legacy install with only gen_model (no provider) routes to claude', () => {
  // Pre-provider versions wrote gen_model alone; that selection must still
  // route to the claude CLI, not silently drop to Default.
  assert.equal(normalizeGenProvider({ gen_model: 'claude-sonnet-4-6' }), 'claude')
})

test('an unknown provider string falls back: claude when a model is set, else Default', () => {
  assert.equal(normalizeGenProvider({ gen_provider: 'gemini', gen_model: 'x' }), 'claude')
  assert.equal(normalizeGenProvider({ gen_provider: 'gemini' }), DEFAULT_PROVIDER)
  assert.equal(normalizeGenProvider({ gen_provider: 42, gen_model: 'x' }), 'claude')
  assert.equal(normalizeGenProvider({ gen_provider: 42 }), DEFAULT_PROVIDER)
})

// ---------------------------------------------------------------------------
// buildProviderGroups — stitch the /api/auth/providers/models payload onto the
// PROVIDER_ORDER scaffold; degrade to FALLBACK_GROUPS.
// ---------------------------------------------------------------------------
test('PROVIDER_ORDER + FALLBACK_GROUPS expose Claude then Codex', () => {
  assert.deepEqual(PROVIDER_ORDER.map((p) => p.key), ['claude', 'codex'])
  assert.deepEqual(FALLBACK_GROUPS.map((g) => g.key), ['claude', 'codex'])
  for (const g of FALLBACK_GROUPS) {
    assert.ok(g.models.length >= 1, `${g.key} fallback has at least one model`)
    assert.ok(typeof g.models[0].id === 'string' && g.models[0].id)
  }
})

test('null / malformed payloads fall back to FALLBACK_GROUPS', () => {
  for (const bad of [null, undefined, 'nope', 42]) {
    assert.deepEqual(buildProviderGroups(bad), FALLBACK_GROUPS)
  }
})

test('a live payload is stitched onto PROVIDER_ORDER, grouped and ordered', () => {
  const payload = {
    claude: [
      { id: 'claude-opus-4-8', name: 'Opus 4.8' },
      { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
    ],
    codex: [
      { id: 'gpt-5.5', name: 'gpt-5.5' },
    ],
  }
  const groups = buildProviderGroups(payload)
  assert.deepEqual(groups.map((g) => g.key), ['claude', 'codex'])
  assert.deepEqual(groups[0].models.map((m) => m.id), ['claude-opus-4-8', 'claude-sonnet-4-6'])
  assert.equal(groups[0].label, 'Claude Code')
  assert.equal(groups[1].label, 'OpenAI Codex')
  assert.deepEqual(groups[1].models, [{ id: 'gpt-5.5', name: 'gpt-5.5' }])
})

test('providers the backend omits are dropped; unknown keys ignored', () => {
  const groups = buildProviderGroups({ claude: [{ id: 'claude-x', name: 'X' }], gemini: [{ id: 'g' }] })
  assert.deepEqual(groups.map((g) => g.key), ['claude'])
})

test('a model row missing name falls back to its id', () => {
  const groups = buildProviderGroups({ claude: [{ id: 'claude-x' }] })
  assert.deepEqual(groups[0].models, [{ id: 'claude-x', name: 'claude-x' }])
})

test('rows without a string id are filtered out', () => {
  const groups = buildProviderGroups({
    claude: [{ name: 'no id' }, null, { id: 42 }, { id: 'claude-ok', name: 'OK' }],
  })
  assert.deepEqual(groups[0].models, [{ id: 'claude-ok', name: 'OK' }])
})

test('a provider whose array is empty is dropped entirely', () => {
  const groups = buildProviderGroups({ claude: [], codex: [{ id: 'gpt-5.5', name: 'gpt-5.5' }] })
  assert.deepEqual(groups.map((g) => g.key), ['codex'])
})

// ---------------------------------------------------------------------------
// generate.sh — provider + model must flow end-to-end and fail soft.
// ---------------------------------------------------------------------------
const GENERATE_SH = readFileSync(join(HERE, '..', 'generate.sh'), 'utf8')

test('generate.sh reads provider + model from next_request with prefs fallback', () => {
  assert.ok(
    GENERATE_SH.includes('next_req.get("provider") or prefs.get("gen_provider")'),
    'provider parser must prefer the per-run record and fall back to the persisted setting',
  )
  assert.ok(
    GENERATE_SH.includes('next_req.get("model") or prefs.get("gen_model")'),
    'model parser must prefer the per-run record and fall back to the persisted setting',
  )
})

test('generate.sh normalizes the provider to claude/codex (legacy → claude)', () => {
  assert.ok(GENERATE_SH.includes('if provider not in ("claude", "codex"):'))
  assert.ok(GENERATE_SH.includes('provider = "claude" if model else ""'),
    'unknown/empty provider with a model set routes to claude; otherwise platform default')
})

test('generate.sh sanitizes the model id before it reaches the CLI argv', () => {
  assert.ok(GENERATE_SH.includes('re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", model)'))
})

test('generate.sh routes to the codex CLI for the codex provider', () => {
  assert.ok(GENERATE_SH.includes('if [ "$GEN_PROVIDER" = "codex" ]; then'))
  assert.ok(GENERATE_SH.includes('exec --json --sandbox read-only'),
    'codex must run with the read-only sandbox (mirrors news/fetch.sh hardening)')
  assert.ok(GENERATE_SH.includes('codex "${codex_flags[@]}"'))
})

test('generate.sh routes to the claude CLI by default', () => {
  assert.ok(GENERATE_SH.includes('claude -p "$user_turn"'))
  assert.ok(GENERATE_SH.includes('env CLAUDE_CONFIG_DIR=/data/cli-auth/claude'))
})

test('generate.sh unwraps codex JSONL agent_message before extracting JSON', () => {
  assert.ok(GENERATE_SH.includes('if provider == "codex":'))
  assert.ok(GENERATE_SH.includes('msg.get("type") == "agent_message"'))
})

test('generate.sh passes --model only when a model is set, for both CLIs', () => {
  // Both run_agent branches guard --model on the non-empty $model local.
  assert.ok(GENERATE_SH.includes('flags+=( --model "$model" )'))
  assert.ok(GENERATE_SH.includes('codex_flags+=( --model "$model" )'))
  assert.ok((GENERATE_SH.match(/if \[ -n "\$model" \]; then/g) || []).length >= 2,
    'each provider branch must guard the --model flag — Default means NO flag')
})

test('generate.sh retries once on the provider default when a custom-model run fails', () => {
  assert.ok(GENERATE_SH.includes('for ATTEMPT_MODEL in ${GEN_MODEL:+"$GEN_MODEL"} ""'),
    'attempt list must be: chosen model (when set), then the provider default')
  assert.ok(GENERATE_SH.includes('Retrying with the default model.'))
})

test('generate.sh treats extraction, not exit code, as the success test', () => {
  // The CLI exits 0 with an error sentence for unknown model ids, so the
  // retry must fire on empty STORY_ID too — not only on CLI_EXIT != 0.
  assert.ok(GENERATE_SH.includes('STORY_ID=$(extract_story)'))
  assert.ok(GENERATE_SH.includes('if [ -n "$STORY_ID" ]; then'))
  assert.ok(GENERATE_SH.includes('if [ -z "$STORY_ID" ]; then'))
})
