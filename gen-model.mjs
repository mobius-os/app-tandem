// Generation-model helpers — canonical, unit-tested copy. index.jsx ships an
// inlined copy (the installer compiles only the entry file; a relative import
// would 404 at compile time). Edit here first, then mirror the change in the
// INLINE-GEN-MODEL block; __tests__/gen-model.test.mjs asserts the sync.

// 'Default' is the empty model id: prefs carry no gen_model key and generate.sh
// omits the --model flag, so the chosen provider's own default model applies.
export const DEFAULT_MODEL_ID = ''

// Provider display order + UI labels. The model list inside each group is
// fetched at runtime from `GET /api/auth/providers/models` (mirrors app-news).
// One source of truth lives in mobius's `app.providers` — the only thing
// hard-coded here is the group order + the human label per provider; the model
// `id`s and per-model display names come from the backend.
export const PROVIDER_ORDER = [
  { key: 'claude', label: 'Claude Code' },
  { key: 'codex', label: 'OpenAI Codex' },
]

// Tiny fallback the picker falls back to when the fetch fails — older mobius
// without the endpoint, offline, etc. Just one model per provider so the user
// can still pick *something* and save; generate.sh passes --model through
// verbatim, so the CLI is the ultimate authority on what actually resolves.
export const FALLBACK_GROUPS = [
  {
    key: 'claude',
    label: 'Claude Code',
    models: [{ id: 'claude-opus-4-8', name: 'Opus 4.8' }],
  },
  {
    key: 'codex',
    label: 'OpenAI Codex',
    models: [{ id: 'gpt-5.5', name: 'gpt-5.5' }],
  },
]

// 'Default' (empty provider + empty model) is the un-set state: generate.sh
// runs the claude CLI with no --model flag, so the platform's own default
// applies. The picker always offers Default first so the owner can revert.
export const DEFAULT_PROVIDER = ''

// Reads the chosen generation provider out of prefs. Lenient by contract:
// prefs written before gen_provider existed, or carrying anything but a known
// provider key, read as the default (empty) — generation must never block on
// this preference. An empty/unknown provider with a stored model is treated as
// 'claude' so a pre-provider install (gen_model only) still routes sanely.
export function normalizeGenProvider(prefs) {
  if (!prefs || typeof prefs !== 'object') return DEFAULT_PROVIDER
  const v = prefs.gen_provider
  if (typeof v !== 'string') {
    // Legacy install: a stored gen_model with no provider routed to claude.
    return normalizeGenModel(prefs) ? 'claude' : DEFAULT_PROVIDER
  }
  const t = v.trim()
  if (t === 'claude' || t === 'codex') return t
  // Unknown provider string but a model is set → assume claude (legacy route).
  return normalizeGenModel(prefs) ? 'claude' : DEFAULT_PROVIDER
}

// Reads the chosen generation model out of prefs. Lenient by contract:
// prefs written before gen_model existed, or carrying a non-string value,
// read as the default — generation must never block on this preference.
export function normalizeGenModel(prefs) {
  if (!prefs || typeof prefs !== 'object') return DEFAULT_MODEL_ID
  const v = prefs.gen_model
  if (typeof v !== 'string') return DEFAULT_MODEL_ID
  return v.trim()
}

// Stitch the backend's `{claude: [...], codex: [...]}` payload onto the
// PROVIDER_ORDER scaffold, dropping providers the backend didn't return and
// ignoring unknown keys. Returns a list shaped like FALLBACK_GROUPS so the
// picker render path doesn't care where the data came from. (Same shape as
// app-news's buildProviderGroups.)
export function buildProviderGroups(payload) {
  if (!payload || typeof payload !== 'object') return FALLBACK_GROUPS
  const groups = []
  for (const meta of PROVIDER_ORDER) {
    const rows = Array.isArray(payload[meta.key]) ? payload[meta.key] : null
    if (!rows || rows.length === 0) continue
    // Defensive normalize: tolerate a missing `name` (fall back to id) so a
    // half-shaped row from a future backend never blanks a row.
    groups.push({
      key: meta.key,
      label: meta.label,
      models: rows
        .filter((r) => r && typeof r.id === 'string')
        .map((r) => ({ id: r.id, name: r.name || r.id })),
    })
  }
  return groups
}
