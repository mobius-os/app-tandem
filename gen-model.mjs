// Generation-model helpers — canonical, unit-tested copy. index.jsx ships an
// inlined copy (the installer compiles only the entry file; a relative import
// would 404 at compile time). Edit here first, then mirror the change in the
// INLINE-GEN-MODEL block; __tests__/gen-model.test.mjs asserts the sync.

// 'Default' is the empty id: prefs carry no gen_model key and generate.sh
// omits the --model flag, so the platform's own default model applies.
export const DEFAULT_MODEL_ID = ''

// Reads the chosen generation model out of prefs. Lenient by contract:
// prefs written before gen_model existed, or carrying a non-string value,
// read as the default — generation must never block on this preference.
export function normalizeGenModel(prefs) {
  if (!prefs || typeof prefs !== 'object') return DEFAULT_MODEL_ID
  const v = prefs.gen_model
  if (typeof v !== 'string') return DEFAULT_MODEL_ID
  return v.trim()
}

// Builds the settings-sheet option list from the GET /api/models response
// ({ providers: { claude: [{id, label, provider, available}], ... } }).
// generate.sh runs the Claude CLI, so only Claude-provider models apply.
//
// CURATION: the registry mixes the curated set the shell shows by default
// (entries carrying a polished label distinct from the id) with raw, dated
// aliases that surface the same model under its bare id (label === id, or no
// label at all). The owner asked to "select from the list of preselected
// agents we generally use, instead of the full list" — so only the curated
// entries (available, with a polished label) are offered.
//
// Three invariants survive curation: Default is always first; a retired or
// raw-id entry that happens to be the CURRENT selection still appears, so the
// user can see and change a stale choice; and a current selection the registry
// no longer lists at all is appended with its raw id.
export function modelOptionsFrom(registry, currentId) {
  const options = [{ id: DEFAULT_MODEL_ID, label: 'Default' }]
  const claude = registry && registry.providers && registry.providers.claude
  const entries = Array.isArray(claude) ? claude : []
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) continue
    const isCurrent = entry.id === currentId
    if (entry.available === false && !isCurrent) continue
    // A polished label (present and not just the id echoed back) marks a
    // curated model. Raw-id entries are dropped unless currently selected.
    const label = typeof entry.label === 'string' ? entry.label : ''
    const curated = label && label !== entry.id
    if (!curated && !isCurrent) continue
    options.push({ id: entry.id, label: curated ? label : entry.id })
  }
  if (currentId && !options.some((o) => o.id === currentId)) {
    options.push({ id: currentId, label: currentId })
  }
  return options
}
