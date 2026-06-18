import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

// ===== INLINE-SCHEMA START (canonical source: story-schema.mjs) =====
// The Möbius installer fetches and compiles ONLY the entry file (index.jsx)
// — a relative `import './story-schema.mjs'` would 404 at compile time.
// story-schema.mjs is the canonical, unit-tested copy; the inline block
// here must stay in sync. __tests__/story-schema.test.mjs asserts this.
// Edit story-schema.mjs first, then mirror the change here.

const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

// Difficulty verdicts a reader can give a story. Stored both on the story
// record (story.rating) and in prefs.feedback_history; generate.sh feeds the
// recent ones back into the next generation prompt.
const STORY_RATINGS = ['too_simple', 'just_right', 'too_complex']

const RATE_OPTIONS = [
  { verdict: 'too_simple', label: 'Too easy' },
  { verdict: 'just_right', label: 'Just right' },
  { verdict: 'too_complex', label: 'Too hard' },
]
const RATE_LABELS = Object.fromEntries(RATE_OPTIONS.map((o) => [o.verdict, o.label]))

function adaptLevel(currentLevel, feedbackHistory) {
  if (!Array.isArray(feedbackHistory) || feedbackHistory.length === 0) {
    return currentLevel
  }
  const recent = feedbackHistory.slice(-3)
  let score = 0
  for (const entry of recent) {
    if (entry.verdict === 'too_simple') score += 1
    else if (entry.verdict === 'too_complex') score -= 1
  }
  const idx = CEFR_LEVELS.indexOf(currentLevel)
  if (idx === -1) return currentLevel
  if (score > 0) return CEFR_LEVELS[Math.min(idx + 1, CEFR_LEVELS.length - 1)]
  if (score < 0) return CEFR_LEVELS[Math.max(idx - 1, 0)]
  return currentLevel
}

function lookupGlossary(para, word) {
  if (!para || !Array.isArray(para.glossary)) return null
  if (typeof word !== 'string' || !word.trim()) return null
  const needle = stripWordPunct(word).toLowerCase()
  if (!needle) return null
  const tokensOf = (term) =>
    String(term).split(/\s+/).map((w) => stripWordPunct(w).toLowerCase()).filter(Boolean)
  return para.glossary.find((entry) =>
    (typeof entry.word_a === 'string' && tokensOf(entry.word_a).includes(needle)) ||
    (typeof entry.word_b === 'string' && tokensOf(entry.word_b).includes(needle)),
  ) || null
}

function normalizeStory(story) {
  if (!story || typeof story !== 'object') return null
  const id = typeof story.id === 'string' ? story.id.trim() : ''
  if (!id) return null
  const title_a = typeof story.title_a === 'string' ? story.title_a.trim() : ''
  const title_b = typeof story.title_b === 'string' ? story.title_b.trim() : ''
  if (!title_a || !title_b) return null
  const lang_a = typeof story.lang_a === 'string' ? story.lang_a.trim() : ''
  const lang_b = typeof story.lang_b === 'string' ? story.lang_b.trim() : ''
  if (!lang_a || !lang_b) return null
  const level = CEFR_LEVELS.includes(story.level) ? story.level : 'B1'
  const created = typeof story.created === 'string' ? story.created.trim() : ''
  const paragraphs = []
  for (const p of Array.isArray(story.paragraphs) ? story.paragraphs : []) {
    if (!p || typeof p !== 'object') continue
    const a = typeof p.a === 'string' ? p.a.trim() : ''
    const b = typeof p.b === 'string' ? p.b.trim() : ''
    if (!a || !b) continue
    const glossary = []
    for (const g of Array.isArray(p.glossary) ? p.glossary : []) {
      if (!g || typeof g !== 'object') continue
      const word_a = typeof g.word_a === 'string' ? g.word_a.trim() : ''
      const word_b = typeof g.word_b === 'string' ? g.word_b.trim() : ''
      if (!word_a || !word_b) continue
      const entry = { word_a, word_b }
      if (typeof g.note === 'string' && g.note.trim()) entry.note = g.note.trim()
      glossary.push(entry)
    }
    paragraphs.push({ a, b, glossary })
  }
  if (paragraphs.length < 1) return null
  const normalized = { id, title_a, title_b, lang_a, lang_b, level, created, paragraphs }
  const summary = typeof story.summary === 'string' ? story.summary.trim() : ''
  if (summary) normalized.summary = summary
  if (STORY_RATINGS.includes(story.rating)) normalized.rating = story.rating
  return normalized
}

function totalGlossaryCount(story) {
  if (!story || !Array.isArray(story.paragraphs)) return 0
  return story.paragraphs.reduce((n, p) => n + (Array.isArray(p.glossary) ? p.glossary.length : 0), 0)
}

function meetsContentBar(story) {
  if (!story) return false
  return story.paragraphs.length >= 10 && totalGlossaryCount(story) >= 15
}

function removeStoryFromIndex(index, storyId) {
  if (!Array.isArray(index)) return []
  return index.filter((e) => !(e && typeof e === 'object' && e.id === storyId))
}

// Mirror a rating onto the story's index entry so the library card can show
// and edit it without loading the full story record.
function setRatingInIndex(index, storyId, verdict) {
  if (!Array.isArray(index)) return []
  return index.map((e) =>
    e && typeof e === 'object' && e.id === storyId ? { ...e, rating: verdict } : e,
  )
}

function buildIndexEntry(story) {
  return {
    id: story.id,
    title_a: story.title_a,
    title_b: story.title_b,
    lang_a: story.lang_a,
    lang_b: story.lang_b,
    level: story.level,
    created: story.created,
    summary: story.summary || '',
  }
}
// ===== INLINE-SCHEMA END =====

// ===== INLINE-TEXT-ALIGN START (canonical source: text-align.mjs) =====
// Same inlining rationale as the schema block above: the installer compiles
// only index.jsx. text-align.mjs is the canonical, unit-tested copy.

const SENTENCE_END_RE = /[.!?…。！？](["'’”»)\]]*)$/

function tokenizeParagraph(text) {
  if (typeof text !== 'string' || !text) return []
  const parts = text.split(/(\s+)/)
  const tokens = []
  let sentIdx = 0
  let wordIdx = 0
  for (const part of parts) {
    if (!part) continue
    const isWord = !/^\s+$/.test(part)
    tokens.push({ text: part, isWord, wordIdx: isWord ? wordIdx : -1, sentIdx })
    if (isWord) {
      wordIdx += 1
      if (SENTENCE_END_RE.test(part)) sentIdx += 1
    }
  }
  return tokens
}

function sentenceCount(tokens) {
  let max = -1
  for (const t of tokens) {
    if (t.isWord && t.sentIdx > max) max = t.sentIdx
  }
  return max + 1
}

function alignSentenceIndex(srcIdx, dstCount) {
  if (!Number.isInteger(srcIdx) || srcIdx < 0) return -1
  if (!Number.isInteger(dstCount) || dstCount < 1) return -1
  return Math.min(srcIdx, dstCount - 1)
}

function stripWordPunct(token) {
  if (typeof token !== 'string') return ''
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

function findPhraseTokenRange(tokens, phrase) {
  if (typeof phrase !== 'string' || !phrase.trim()) return null
  const target = phrase
    .trim()
    .split(/\s+/)
    .map((w) => stripWordPunct(w).toLowerCase())
    .filter(Boolean)
  if (target.length === 0) return null
  const words = tokens.filter((t) => t.isWord)
  for (let i = 0; i + target.length <= words.length; i++) {
    let match = true
    for (let j = 0; j < target.length; j++) {
      if (stripWordPunct(words[i + j].text).toLowerCase() !== target[j]) {
        match = false
        break
      }
    }
    if (match) {
      return { start: words[i].wordIdx, end: words[i + target.length - 1].wordIdx }
    }
  }
  return null
}
// ===== INLINE-TEXT-ALIGN END =====

// ===== INLINE-GEN-MODEL START (canonical source: gen-model.mjs) =====
// Same inlining rationale as the schema block above: the installer compiles
// only index.jsx. gen-model.mjs is the canonical, unit-tested copy.

// '' is the internal "unset" model id (the "Default" picker row was removed).
// It still flows through generate.sh as "no --model flag", but the UI no longer
// lands a user here — migrateGenPrefs rewrites an unset selection onto a real model.
const DEFAULT_MODEL_ID = ''

// Provider display order + UI labels. The model list inside each group is
// fetched at runtime from `GET /api/auth/providers/models` (mirrors app-news).
const PROVIDER_ORDER = [
  { key: 'claude', label: 'Claude Code' },
  { key: 'codex', label: 'OpenAI Codex' },
]

// Tiny fallback the picker falls back to when the fetch fails — older mobius
// without the endpoint, offline, etc. One model per provider so the user can
// still pick something; generate.sh passes --model through verbatim.
const FALLBACK_GROUPS = [
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

// '' is the internal "unset" provider (empty provider + empty model = the old
// "Default" state). The picker no longer offers a Default row; migrateGenPrefs
// converts a stored unset selection to a concrete one.
const DEFAULT_PROVIDER = ''

// The concrete default a fresh/migrated install lands on — the first real
// Claude model the picker always offers (single source of truth for "what
// Default becomes"). generate.sh still resolves it through the CLI, with a
// retry on the provider default if unknown, so the migration can't wedge gen.
const CONCRETE_DEFAULT_PROVIDER = FALLBACK_GROUPS[0].key
const CONCRETE_DEFAULT_MODEL_ID = FALLBACK_GROUPS[0].models[0].id

// True when prefs carry no usable generation selection — the old "Default"
// state (missing/empty/whitespace model, or the literal 'Default' sentinel).
function needsGenPrefsMigration(prefs) {
  if (!prefs || typeof prefs !== 'object') return false
  const model = normalizeGenModel(prefs)
  return model === '' || model.toLowerCase() === 'default'
}

// One-time, idempotent migration: rewrite an unset selection to the concrete
// default. Returns a NEW object when it changes anything, else the SAME object
// (reference-equal) so the caller can skip a redundant write. Never throws.
function migrateGenPrefs(prefs) {
  if (!prefs || typeof prefs !== 'object') return prefs
  if (!needsGenPrefsMigration(prefs)) return prefs
  return {
    ...prefs,
    gen_provider: CONCRETE_DEFAULT_PROVIDER,
    gen_model: CONCRETE_DEFAULT_MODEL_ID,
  }
}

function normalizeGenProvider(prefs) {
  if (!prefs || typeof prefs !== 'object') return DEFAULT_PROVIDER
  const v = prefs.gen_provider
  if (typeof v !== 'string') {
    return normalizeGenModel(prefs) ? 'claude' : DEFAULT_PROVIDER
  }
  const t = v.trim()
  if (t === 'claude' || t === 'codex') return t
  return normalizeGenModel(prefs) ? 'claude' : DEFAULT_PROVIDER
}

function normalizeGenModel(prefs) {
  if (!prefs || typeof prefs !== 'object') return DEFAULT_MODEL_ID
  const v = prefs.gen_model
  if (typeof v !== 'string') return DEFAULT_MODEL_ID
  return v.trim()
}

function buildProviderGroups(payload) {
  if (!payload || typeof payload !== 'object') return FALLBACK_GROUPS
  const groups = []
  for (const meta of PROVIDER_ORDER) {
    const rows = Array.isArray(payload[meta.key]) ? payload[meta.key] : null
    if (!rows || rows.length === 0) continue
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
// ===== INLINE-GEN-MODEL END =====

// ---------------------------------------------------------------------------
// Storage helpers — route through window.mobius.storage when available (for
// offline queuing + SWR), fall back to direct fetch. Pattern mirrors app-news.
// ---------------------------------------------------------------------------
function getRuntimeStorage() {
  return (typeof window !== 'undefined' && window.mobius?.storage) || null
}

function storagePathFromUrl(url, appId) {
  if (appId == null) return null
  const prefix = `/api/storage/apps/${appId}/`
  return url.startsWith(prefix) ? url.slice(prefix.length) : null
}

async function getJSON(url, token, appId) {
  const path = storagePathFromUrl(url, appId)
  const native = path ? getRuntimeStorage() : null
  if (native && typeof native.get === 'function') {
    try {
      const data = await native.get(path)
      if (data === null || data === undefined) return { ok: false, status: 404 }
      return { ok: true, data }
    } catch { /* fall through */ }
  }
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return { ok: false, status: r.status }
    try { return { ok: true, data: await r.json() } }
    catch { return { ok: false, status: 500 } }
  } catch {
    return { ok: false, status: 0 }
  }
}

async function putJSON(url, token, obj, appId) {
  const path = storagePathFromUrl(url, appId)
  const native = path ? getRuntimeStorage() : null
  if (native && typeof native.set === 'function') {
    try { return await native.set(path, obj) }
    catch { /* fall through */ }
  }
  try {
    const r = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(obj),
    })
    if (r.ok) return { synced: true }
    return { ok: false, status: r.status }
  } catch {
    return { ok: false, status: 0 }
  }
}

async function deleteJSON(url, token, appId) {
  const path = storagePathFromUrl(url, appId)
  const native = path ? getRuntimeStorage() : null
  if (native) {
    const fn = native.remove || native.del
    if (typeof fn === 'function') {
      try { await fn.call(native, path); return { ok: true } }
      catch { /* fall through */ }
    }
  }
  try {
    const r = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    // 404 counts as deleted — the file is gone either way.
    return { ok: r.ok || r.status === 404, status: r.status }
  } catch {
    return { ok: false, status: 0 }
  }
}

// List story entries from storage; returns [] on network failure.
async function loadStoryIndex(appId, token) {
  const res = await getJSON(
    `/api/storage/apps/${appId}/stories/index.json`, token, appId,
  )
  if (!res.ok) return []
  return Array.isArray(res.data) ? res.data : []
}

async function loadStory(appId, token, storyId) {
  const res = await getJSON(
    `/api/storage/apps/${appId}/stories/${storyId}.json`, token, appId,
  )
  return res.ok ? normalizeStory(res.data) : null
}

async function loadPrefs(appId, token) {
  const res = await getJSON(
    `/api/storage/apps/${appId}/prefs.json`, token, appId,
  )
  return res.ok && res.data ? res.data : {}
}

async function savePrefs(appId, token, prefs) {
  return putJSON(`/api/storage/apps/${appId}/prefs.json`, token, prefs, appId)
}

// Provider/model registry for the settings sheet — platform routes (NOT app
// storage), so they go through fetch directly. Mirrors app-news:
//   - GET /api/auth/providers/models → { claude: [{id,name}], codex: [...] }
//   - GET /api/auth/providers/status → { claude: {authenticated}, ... }
// Each returns null on ANY failure; the sheet then degrades (fallback groups,
// "show everything as connected") and generation proceeds unblocked — this
// preference must never gate the app.
async function loadProviderModels(token) {
  try {
    const r = await fetch('/api/auth/providers/models', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

async function loadProviderStatus(token) {
  try {
    const r = await fetch('/api/auth/providers/status', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Generation — app-level, storage-backed.
//
// Generation state must NOT live in any view's component state: a view that
// unmounts (navigation, reader overlay, app reload) would orphan the poll and
// the "Generating…" indicator with it. Instead a pending record is persisted
// to storage (generation-pending.json: { started_at, params, known_ids }) and
// the poll loop is owned by the root App component, which never unmounts
// while the app is open. On mount the hook re-reads the pending record, so
// even a full app reload resumes the indicator and the poll.
//
// The actual generation runs server-side (generate.sh via POST run-job), so
// no chat mount is needed — the pending record + index poll is the whole
// contract. The poll detects completion by diffing the story index against
// the ids known when generation started (stored in the record, so a resume
// after reload still diffs correctly).
// ---------------------------------------------------------------------------
const GEN_POLL_MS = 4000
// generate.sh self-kills at TANDEM_TIMEOUT (300s); past this we stop trusting
// the run and surface an error so a stuck generation never reads as an
// infinite spinner (the owner hit a silent "took forever, nothing generated"
// when a transient rate limit ate the run). Slightly past the script's own
// timeout to give a genuinely-late story room to land first.
const GEN_TIMEOUT_MS = 6 * 60_000
// The default user-facing message when a run produces no story past the
// timeout and generate.sh left no failure marker to explain why. Rate limits
// are the common cause and self-heal, so the copy invites a retry.
const GEN_TIMEOUT_MESSAGE =
  'Generation failed — the model may be rate-limited. Try again shortly.'

function pendingUrl(appId) {
  return `/api/storage/apps/${appId}/generation-pending.json`
}

// generate.sh may drop a failure marker { message } when a run can't produce a
// story (e.g. the agent erred or returned nothing). When present the app reads
// it and surfaces the body verbatim instead of the generic timeout copy.
function failedUrl(appId) {
  return `/api/storage/apps/${appId}/generation-failed.json`
}

// Pulls a human message out of whatever shape generate.sh wrote: a bare string,
// or an object with a message/body/error field. Falls back to the generic
// timeout copy so the UI always has something concrete to show.
function failureMessageFrom(data) {
  if (typeof data === 'string' && data.trim()) return data.trim()
  if (data && typeof data === 'object') {
    for (const key of ['message', 'body', 'error']) {
      const v = data[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  }
  return GEN_TIMEOUT_MESSAGE
}

function useGeneration({ appId, token, onStoryReady }) {
  const [gen, setGen] = useState({ phase: 'idle', startedAt: 0, params: null, error: '' })
  const pollRef = useRef(null)
  const toastRef = useRef(null)
  const onReadyRef = useRef(onStoryReady)
  onReadyRef.current = onStoryReady

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  // Ends the run in the error phase and clears the pending record so the next
  // attempt starts clean. The pending record is cleared but the failure marker
  // (if any) is left for diagnostics — a Retry overwrites it on the next run.
  const failGeneration = useCallback(async (startedAt, params, message) => {
    stopPolling()
    await deleteJSON(pendingUrl(appId), token, appId)
    setGen({ phase: 'error', startedAt, params, error: message })
  }, [appId, token, stopPolling])

  const beginPolling = useCallback((pending) => {
    stopPolling()
    const startedAt = Date.parse(pending.started_at) || Date.now()
    const known = new Set(Array.isArray(pending.known_ids) ? pending.known_ids : [])
    const params = pending.params || null
    setGen({ phase: 'running', startedAt, params, error: '' })
    pollRef.current = setInterval(async () => {
      // A story landing always wins, even if a stale failure marker lingers.
      const entries = await loadStoryIndex(appId, token)
      const fresh = entries.find((e) => e && !known.has(e.id))
      if (fresh) {
        stopPolling()
        await deleteJSON(pendingUrl(appId), token, appId)
        await deleteJSON(failedUrl(appId), token, appId)
        setGen({ phase: 'done', startedAt, params, error: '' })
        onReadyRef.current?.(entries)
        // Cosmetic toast auto-hide only — the story is already delivered.
        if (toastRef.current) clearTimeout(toastRef.current)
        toastRef.current = setTimeout(() => {
          setGen((g) => (g.phase === 'done' ? { ...g, phase: 'idle' } : g))
        }, 3500)
        return
      }
      // generate.sh told us it failed: surface its message immediately rather
      // than spinning until the timeout.
      const marker = await getJSON(failedUrl(appId), token, appId)
      if (marker.ok && marker.data !== undefined) {
        await deleteJSON(failedUrl(appId), token, appId)
        await failGeneration(startedAt, params, failureMessageFrom(marker.data))
        return
      }
      // No story, no marker, but the run has outlived the script's own
      // timeout — treat it as failed instead of an endless spinner.
      if (Date.now() - startedAt > GEN_TIMEOUT_MS) {
        await failGeneration(startedAt, params, GEN_TIMEOUT_MESSAGE)
      }
    }, GEN_POLL_MS)
  }, [appId, token, stopPolling, failGeneration])

  // Resume a pending generation across mounts / reloads.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await getJSON(pendingUrl(appId), token, appId)
      if (cancelled) return
      if (res.ok && res.data && typeof res.data === 'object' && res.data.started_at) {
        beginPolling(res.data)
      }
    })()
    return () => {
      cancelled = true
      stopPolling()
      if (toastRef.current) clearTimeout(toastRef.current)
    }
  }, [appId, token, beginPolling, stopPolling])

  const start = useCallback(async (params, currentIndex) => {
    if (pollRef.current) return
    const pending = {
      started_at: new Date().toISOString(),
      params,
      known_ids: (currentIndex || []).map((e) => e.id),
    }
    // Clear any marker left by a prior failed run BEFORE polling resumes —
    // otherwise a Retry would re-read the old marker and fail instantly.
    await deleteJSON(failedUrl(appId), token, appId)
    // Persist BEFORE kicking the job so a navigation right after the tap
    // can't lose the record.
    await putJSON(pendingUrl(appId), token, pending, appId)
    let failure = ''
    try {
      const r = await fetch(`/api/apps/${appId}/run-job`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) failure = `Could not start generation (HTTP ${r.status}).`
    } catch {
      failure = 'Could not reach the server.'
    }
    if (failure) {
      await deleteJSON(pendingUrl(appId), token, appId)
      setGen({ phase: 'error', startedAt: 0, params, error: failure })
      return
    }
    beginPolling(pending)
  }, [appId, token, beginPolling])

  const dismiss = useCallback(async () => {
    stopPolling()
    await deleteJSON(pendingUrl(appId), token, appId)
    setGen({ phase: 'idle', startedAt: 0, params: null, error: '' })
  }, [appId, token, stopPolling])

  return { ...gen, start, dismiss }
}

// ---------------------------------------------------------------------------
// Story index — single owner of stories/index.json, with serialized writes.
//
// stories/index.json is a whole-array file written last-write-wins (no CAS).
// Three writers mutate it: rating (setRatingInIndex), delete
// (removeStoryFromIndex), and server-side generation (generate.sh appends the
// new story). Rating and delete used to transform a STALE in-memory copy and
// PUT the whole array, so two near-simultaneous client mutations clobbered
// each other:
//
//   client A reads [X,Y,Z] in memory; deletes Z   -> PUT [X,Y]
//   client B reads [X,Y,Z] in memory; rates  Y    -> PUT [X,Y(rated),Z]  // Z back
//
// A rating right after a delete resurrected the deleted entry; a delete right
// after a rating dropped the rating; a client mutation built on a pre-
// generation snapshot dropped the just-appended story.
//
// mutate(transform) serializes every CLIENT index write on one promise chain
// and RE-READS the freshest index immediately before applying the pure
// transform, then PUTs THAT. So a delete-then-rate reads the post-delete index
// (the entry is gone -> setRatingInIndex is a no-op), a rate-then-delete reads
// the post-rate index, and a client write reads any server-appended story
// first instead of overwriting it. Transforms must be pure and idempotent.
//
// The unavoidable residue: generate.sh's server-side read-append-write can
// still interleave a client PUT (whole-file LWW, no ETag) — serializing only
// the client writers can't order the server writer. To shrink that window,
// mutate() re-reads once more right after its PUT and reconciles, and the
// generation poll keeps reading the fresh server index. A still-running
// generation re-appending a just-deleted story is expected under this storage
// model (no server-side tombstone); the delete is best-effort against it.
function useStoryIndex({ appId, token }) {
  const [index, setIndex] = useState(null) // null = loading, [] = empty
  const chainRef = useRef(Promise.resolve())

  // Authoritative read that distinguishes a genuine empty index ([]) from a
  // failed read (null). The queue must NEVER transform-and-PUT a failed read —
  // that would wipe the whole index over a network blip.
  const readFresh = useCallback(async () => {
    const res = await getJSON(
      `/api/storage/apps/${appId}/stories/index.json`, token, appId,
    )
    if (!res.ok) {
      // 404 means the file genuinely doesn't exist yet — an empty index.
      return res.status === 404 ? [] : null
    }
    return Array.isArray(res.data) ? res.data : []
  }, [appId, token])

  // Apply a pure transform (current -> next) to stories/index.json, serialized
  // against every other client mutation and computed from a FRESH read. Returns
  // the written array, or null if the op was skipped (failed read).
  const mutate = useCallback((transform) => {
    const run = chainRef.current.then(async () => {
      // Re-read the freshest index INSIDE the queue. A prior op in the chain
      // may have just changed it; reading here (not from the stale prop) is
      // what makes delete and rate commute.
      const fresh = await readFresh()
      if (fresh === null) return null // read failed — don't clobber with [].
      const next = transform(fresh)
      const res = await putJSON(
        `/api/storage/apps/${appId}/stories/index.json`, token, next, appId,
      )
      if (res && res.ok === false) return null // write failed — leave state.
      setIndex(next)
      return next
    })
    // Keep the chain alive past a failure so one error can't wedge later writes.
    chainRef.current = run.catch(() => {})
    return run
  }, [appId, token, readFresh])

  return { index, setIndex, mutate }
}

// ---------------------------------------------------------------------------
// Online detection — mirrors app-news pattern.
// ---------------------------------------------------------------------------
function useOnline() {
  const initial = (() => {
    if (typeof window === 'undefined') return true
    if (typeof window.mobius?.online === 'boolean') return window.mobius.online
    return navigator.onLine !== false
  })()
  const [online, setOnline] = useState(initial)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onUp = () => setOnline(true)
    const onDown = () => setOnline(false)
    window.addEventListener('online', onUp)
    window.addEventListener('offline', onDown)
    let mobiusUnsub = null
    if (window.mobius && typeof window.mobius.onChange === 'function') {
      mobiusUnsub = window.mobius.onChange((s) => {
        if (typeof s?.online === 'boolean') setOnline(s.online)
      })
    }
    return () => {
      window.removeEventListener('online', onUp)
      window.removeEventListener('offline', onDown)
      if (mobiusUnsub) mobiusUnsub()
    }
  }, [])
  return online
}

// ---------------------------------------------------------------------------
// Stylesheet — prefix `tn-`. One const, rendered once.
// ---------------------------------------------------------------------------
const CSS = `
/* mobius-ui:Root v1 — keep in sync; library candidate. Diverge below the marker only. */
.tn-root {
  position: relative;
  display: flex; flex-direction: column;
  height: 100%; width: 100%; max-width: 100%;
  overflow: hidden;
  background: var(--bg); color: var(--text); font-family: var(--font);
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}
.tn-scroll {
  flex: 1; min-height: 0;
  overflow-y: auto; overflow-x: hidden;
  overscroll-behavior: contain;
  word-break: break-word; overflow-wrap: anywhere;
}
/* /mobius-ui:Root */

/* mobius-ui:Header v1 — keep in sync; library candidate. Diverge below the marker only. */
.tn-header {
  flex: 0 0 auto;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  min-height: 48px; padding: 12px 16px;
  background: var(--surface); border-bottom: 1px solid var(--border);
}
.tn-brand { display: flex; align-items: center; gap: 11px; min-width: 0; }
/* Brand mark = the real app icon, downscaled + cached server-side. */
.tn-brand-icon {
  flex: 0 0 auto; width: 34px; height: 34px; border-radius: 6px;
  object-fit: cover; display: block;
}
/* Accent-dot fallback shown (via onError) when the install has no custom icon. */
.tn-brand-fallback {
  flex: 0 0 auto; width: 34px; height: 34px; border-radius: 6px;
  align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent); font-size: 18px; font-weight: 700; line-height: 1;
}
.tn-header-right { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
/* App name + static tagline beside the icon (replaces the bare icon-only bar). */
.tn-brand-text {
  display: flex; flex-direction: column; justify-content: center;
  min-width: 0; line-height: 1.2;
}
.tn-brand-name {
  font-size: 15px; font-weight: 700; color: var(--text);
  letter-spacing: -0.01em;
}
.tn-brand-tagline {
  font-size: 11.5px; font-weight: 500; color: var(--muted);
  letter-spacing: 0; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
/* /mobius-ui:Header */

/* mobius-ui:Empty v1 — keep in sync; library candidate. Diverge below the marker only. */
.tn-empty {
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px;
  max-width: 440px; margin: auto; padding: 48px 24px; color: var(--muted);
}
.tn-empty-mark {
  width: 64px; height: 64px; margin-bottom: 10px; border-radius: 18px;
  display: flex; align-items: center; justify-content: center; font-size: 30px; line-height: 1;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
}
.tn-empty-title { font-size: 17px; font-weight: 700; color: var(--text); letter-spacing: -0.01em; }
.tn-empty-text { margin: 0; font-size: 14px; line-height: 1.6; }
/* /mobius-ui:Empty */

/* mobius-ui:Card v1 — keep in sync; library candidate. Diverge below the marker only. */
.tn-card {
  display: flex; align-items: center; gap: 14px; width: 100%; min-height: 44px;
  padding: 15px 16px; text-align: left;
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: 12px; font-family: var(--font);
  transition: border-color 0.16s ease, transform 0.12s ease, background 0.16s ease;
}
button.tn-card { cursor: pointer; }
@media (hover: hover) {
  button.tn-card:hover { border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); }
}
button.tn-card:active { transform: scale(0.992); }
button.tn-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tn-card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.tn-card-title { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
.tn-card-sub { font-size: 12px; font-weight: 500; color: var(--muted); }
.tn-card-badge {
  flex: 0 0 auto; font-size: 11px; font-weight: 700; padding: 3px 8px;
  border-radius: 6px; background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent); letter-spacing: 0.03em;
}
/* /mobius-ui:Card */

/* mobius-ui:Button v1 — keep in sync; library candidate. Diverge below the marker only. */
.tn-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 44px; padding: 10px 16px; border-radius: 10px;
  border: 1px solid var(--border); background: var(--surface); color: var(--text);
  font-family: var(--font); font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap;
  transition: background 0.14s ease, border-color 0.14s ease, transform 0.1s ease;
  touch-action: manipulation; user-select: none;
}
.tn-btn:active { transform: scale(0.97); }
.tn-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tn-btn:disabled { opacity: 0.5; cursor: default; transform: none; }
.tn-btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
@media (hover: hover) { .tn-btn-primary:hover { filter: brightness(1.06); } }
.tn-btn-secondary { background: var(--surface2, var(--surface)); }
@media (hover: hover) { .tn-btn-secondary:hover { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); } }
.tn-btn-ghost { background: transparent; border-color: transparent; color: var(--accent); }
@media (hover: hover) { .tn-btn-ghost:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); } }
.tn-btn-icon { width: 44px; padding: 0; border-radius: 8px; font-size: 18px; }
/* /mobius-ui:Button */

/* mobius-ui:Input v1 — keep in sync; library candidate. Diverge below the marker only. */
.tn-input, .tn-select {
  display: block; width: 100%; box-sizing: border-box; min-height: 44px; padding: 11px 12px;
  background: var(--surface); color: var(--text); border: 1px solid var(--border);
  border-radius: 8px; outline: none; font-family: var(--font);
  font-size: 16px;
  line-height: 1.5; transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.tn-input::placeholder { color: var(--muted); }
.tn-input:focus, .tn-select:focus { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
/* /mobius-ui:Input */

/* Free-form prompt textarea — same visual language as .tn-input, taller and
   resizable for a multi-sentence ask. */
.tn-textarea {
  display: block; width: 100%; box-sizing: border-box; min-height: 76px;
  padding: 11px 12px; resize: vertical;
  background: var(--surface); color: var(--text); border: 1px solid var(--border);
  border-radius: 8px; outline: none; font-family: var(--font);
  font-size: 16px; line-height: 1.5;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.tn-textarea::placeholder { color: var(--muted); }
.tn-textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }

/* mobius-ui:Sheet v1 — keep in sync; library candidate. Diverge below the marker only. */
.tn-scrim {
  position: absolute; inset: 0; z-index: 100;
  display: flex; align-items: flex-end; justify-content: center;
  padding: 16px; background: rgba(0, 0, 0, 0.5);
}
.tn-sheet {
  width: 100%; max-width: 480px; max-height: 85vh; overflow-y: auto;
  padding: 24px; background: var(--surface); border: 1px solid var(--border);
  border-radius: 16px 16px 0 0; box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.3);
  display: flex; flex-direction: column; gap: 12px;
  overscroll-behavior: contain;
}
.tn-sheet-title { margin: 0 0 4px; font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }
.tn-sheet-sub { margin: 0 0 8px; font-size: 14px; color: var(--muted); line-height: 1.5; }
.tn-sheet-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
.tn-sheet-actions .tn-btn { flex: 1; }
/* /mobius-ui:Sheet */

/* NativeTouch — full native-feel block */
.tn-root *,
.tn-root *::before,
.tn-root *::after {
  box-sizing: border-box;
}
/* story text is selectable — language learners copy words */
.tn-para-text { user-select: text; -webkit-user-select: text; }
/* chrome elements (labels, marks, headers) are not */
.tn-root h1, .tn-root h2, .tn-root h3,
.tn-brand, .tn-brand-fallback, .tn-card-badge,
.tn-level-pill, .tn-rate-row {
  user-select: none; -webkit-user-select: none;
}
/* buttons / interactive: manipulation for fast tap, contain for scroll bounce */
.tn-root button, .tn-root select, .tn-root input {
  touch-action: manipulation;
}
.tn-scroll { overscroll-behavior: contain; }
/* end NativeTouch */

/* ---------- App-specific styles ---------- */

/* Story list */
.tn-list-wrap { padding: 14px 16px 32px; display: flex; flex-direction: column; gap: 8px; }
.tn-divider { height: 1px; background: var(--border); margin: 4px 0 10px; }
.tn-top-row {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-bottom: 6px;
}
.tn-generate-btn {
  min-height: 44px; padding: 10px 16px; border-radius: 10px;
  background: var(--accent); border: 1px solid var(--accent); color: #fff;
  font-family: var(--font); font-size: 14px; font-weight: 600; cursor: pointer;
  white-space: nowrap; touch-action: manipulation; user-select: none;
  transition: filter 0.14s ease, transform 0.1s ease;
}
@media (hover: hover) { .tn-generate-btn:not(:disabled):hover { filter: brightness(1.08); } }
.tn-generate-btn:active { transform: scale(0.97); }
.tn-generate-btn:disabled { background: var(--surface); border-color: var(--border); color: var(--muted); cursor: default; pointer-events: none; }
.tn-status-hint { font-size: 12px; color: var(--muted); }
.tn-error-hint { font-size: 12px; color: var(--danger); }
.tn-stale-actions { display: inline-flex; gap: 6px; }
.tn-stale-btn {
  min-height: 32px; padding: 4px 10px; border-radius: 8px;
  border: 1px solid var(--border); background: transparent;
  color: var(--accent); font-family: var(--font); font-size: 12px; font-weight: 650;
  cursor: pointer; touch-action: manipulation; user-select: none;
}
@media (hover: hover) { .tn-stale-btn:hover { border-color: var(--accent); } }

/* Library card: the card itself is a row container; the open affordance and
   the delete affordance are sibling buttons (no nested-button markup). */
.tn-card-open {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 14px;
  padding: 0; margin: 0; border: none; background: transparent;
  color: inherit; font-family: inherit; text-align: left; cursor: pointer;
  touch-action: manipulation;
}
.tn-card-open:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }
@media (hover: hover) {
  .tn-card:has(.tn-card-open:hover) { border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); }
}
.tn-card:has(.tn-card-open:active) { transform: scale(0.992); }
.tn-card-del {
  flex: 0 0 auto; width: 36px; height: 36px; margin-right: -6px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 8px; background: transparent;
  color: var(--muted); cursor: pointer;
  touch-action: manipulation; user-select: none;
  transition: color 0.14s ease, background 0.14s ease;
}
@media (hover: hover) {
  .tn-card-del:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }
}
.tn-card-del:active { transform: scale(0.92); }
.tn-card-del:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
/* Rated cards grow a quiet second row: the rating, tappable to change. */
.tn-card.has-rate { flex-direction: column; align-items: stretch; gap: 10px; }
.tn-card-row { display: flex; align-items: center; gap: 14px; min-width: 0; }
.tn-card-rate-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tn-card-rating {
  min-height: 32px; padding: 4px 12px; border-radius: 16px;
  border: 1px solid var(--border); background: transparent;
  color: var(--muted); font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: var(--font);
  touch-action: manipulation; user-select: none;
}
@media (hover: hover) { .tn-card-rating:hover { border-color: var(--accent); color: var(--text); } }
.tn-card-rating:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.tn-offline-banner {
  margin: 0 0 12px; padding: 8px 12px; border-radius: 8px;
  background: var(--accent-dim, color-mix(in srgb, var(--accent) 12%, transparent));
  border: 1px solid var(--border); color: var(--text); font-size: 12.5px; line-height: 1.45;
}

/* Level pill on list cards */
.tn-level-pill {
  font-size: 11px; font-weight: 700; padding: 2px 7px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent); letter-spacing: 0.04em;
}

/* Reader — full-bleed overlay anchored to the app root */
.tn-reader {
  position: absolute; inset: 0; z-index: 5;
  display: flex; flex-direction: column;
  background: var(--bg);
}
.tn-reader-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-bottom: 1px solid var(--border);
  background: var(--surface); flex-shrink: 0;
}
.tn-reader-back {
  min-height: 44px; padding: 7px 12px; border-radius: 9px;
  border: 1px solid var(--border); background: var(--bg);
  color: var(--text); font-size: 13px; font-weight: 650;
  cursor: pointer; font-family: var(--font);
  touch-action: manipulation; user-select: none;
}
@media (prefers-reduced-motion: no-preference) {
  .tn-reader-back:active { opacity: 0.75; }
}
.tn-reader-title-wrap { flex: 1; min-width: 0; }
.tn-reader-title {
  font-size: 14px; font-weight: 750;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  user-select: none;
}
.tn-reader-subtitle { font-size: 11px; color: var(--muted); user-select: none; }
.tn-reader-controls { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }

/* Language-toggle pill */
.tn-lang-toggle {
  display: inline-flex; align-items: center; gap: 4px;
  min-height: 36px; padding: 5px 12px; border-radius: 20px;
  border: 1px solid var(--border); background: var(--surface);
  color: var(--text); font-size: 12px; font-weight: 650; cursor: pointer;
  touch-action: manipulation; user-select: none;
}
@media (hover: hover) { .tn-lang-toggle:hover { border-color: var(--accent); } }
.tn-lang-toggle:active { transform: scale(0.96); }
.tn-lang-toggle-arrow { color: var(--muted); font-size: 10px; }

/* Split-pane reader */
.tn-reader-body {
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
  overflow: hidden;
  position: relative;
}
.tn-pane {
  overflow-y: auto; overflow-x: hidden;
  overscroll-behavior: contain;
  padding: 0 0 32px;
  min-height: 0;
  /* The word-tap sync sets pane.scrollTop to a paragraph's offsetTop
     (computeParaOffsets + the highlight effect). offsetTop is measured
     from the nearest POSITIONED ancestor, so each pane MUST be that
     ancestor. Without this, both panes' paragraphs resolve against
     .tn-reader-body and the BOTTOM pane's offsets are inflated by the
     top pane's height, so a top-pane tap scrolls the bottom follower
     PAST the matching paragraph (out of view), while a bottom-pane tap
     works because the top pane is first in flow. position relative
     makes offsetTop pane-relative, fixing the asymmetry for both. */
  position: relative;
}
.tn-pane::-webkit-scrollbar { width: 9px; height: 9px; }
.tn-pane::-webkit-scrollbar-thumb {
  background: var(--border); border-radius: 999px;
  border: 2px solid transparent; background-clip: padding-box;
}
.tn-pane::-webkit-scrollbar-track { background: transparent; }

.tn-pane-top { border-bottom: 1px solid var(--border); }
.tn-pane-bottom {}

/* Draggable divider: a SLIM 10px visual bar; the ::before overlay extends
   the pointer hit area to ~26px without adding visual weight. z-index keeps
   the overlay above the adjacent panes so the extra hit area actually
   receives the pointer. (Same recipe as app-latex / app-webstudio.) */
.tn-divider-handle {
  flex: 0 0 10px; height: 10px;
  box-sizing: border-box;
  position: relative; z-index: 5;
  display: flex; align-items: center; justify-content: center;
  cursor: row-resize; background: var(--surface);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  user-select: none; -webkit-user-select: none; touch-action: none;
}
.tn-divider-handle::before {
  content: ''; position: absolute;
  left: 0; right: 0; top: -8px; bottom: -8px;
}
.tn-divider-handle:hover,
.tn-divider-handle:focus-visible {
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
}
.tn-divider-pip {
  width: 44px; height: 4px; border-radius: 999px;
  background: color-mix(in srgb, var(--muted) 65%, transparent);
  pointer-events: none;
}

/* Story head inside each pane */
.tn-story-head {
  padding: 16px 18px 10px;
  border-bottom: 1px solid var(--border-light, var(--border));
}
.tn-story-title-a {
  font-size: 20px; font-weight: 800; letter-spacing: -0.02em;
  line-height: 1.2; margin: 0 0 3px;
}
.tn-story-title-b {
  font-size: 13px; font-weight: 500; color: var(--muted);
  margin: 0; line-height: 1.4;
}

/* Paragraphs in each pane — continuous prose, like a normal story:
   no divider lines or boxed blocks, just standard paragraph spacing.
   The .tn-para wrapper stays as the per-paragraph anchor the word-tap
   sync measures (offsetTop); only its visual separation is dropped. */
.tn-para {
  padding: 0 18px;
}
.tn-para:first-of-type {
  padding-top: 14px;
}
.tn-para-text {
  font-size: 15px; line-height: 1.72; margin: 0 0 1em;
  color: var(--text);
}

/* Word tap target — wraps each "word" in the paragraph text */
.tn-word {
  cursor: pointer; border-radius: 3px;
  transition: background 0.12s ease;
  /* language learners need to be able to select text */
  user-select: text; -webkit-user-select: text;
}
@media (hover: hover) {
  .tn-word:hover {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
}
.tn-word:active {
  background: color-mix(in srgb, var(--accent) 30%, transparent);
}

/* Inline tap highlight: the tapped word (and its glossary translation in the
   other pane) gets the strong accent; the surrounding sentence — in BOTH
   panes, aligned sentence-by-index — gets the soft accent. The aligned
   context is deliberately emphatic so the tapped/translated context reads at
   a glance: a tinted band with a faint accent underline on the sentence, and
   a high-contrast pill + ring on the hit word. All accent-token driven so it
   tracks the active theme instead of fighting it. */
.tn-ctx {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--accent) 45%, transparent);
}
.tn-word.is-hit {
  background: color-mix(in srgb, var(--accent) 52%, transparent);
  color: var(--text); font-weight: 700;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 70%, transparent);
}

/* Difficulty bar — floats over the reader bottom edge, outside both panes.
   Slides up when an unrated story is read to the end; the noted state fades
   itself out (pure CSS animation; onAnimationEnd unmounts it). */
.tn-rate-bar {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 8;
  display: flex; align-items: center; justify-content: center;
  gap: 8px; flex-wrap: wrap;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px));
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  border-top: 1px solid var(--border);
  font-size: 13px; color: var(--muted);
  animation: tn-rate-bar-in 0.22s ease-out;
}
@keyframes tn-rate-bar-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
.tn-rate-bar.is-noted {
  animation: tn-rate-bar-noted 1.8s ease forwards;
}
@keyframes tn-rate-bar-noted {
  0% { opacity: 1; }
  70% { opacity: 1; }
  100% { opacity: 0; transform: translateY(100%); }
}
.tn-rate-label { font-weight: 600; }
.tn-rate-chip {
  min-height: 36px; padding: 5px 13px; border-radius: 18px;
  border: 1px solid var(--border); background: transparent;
  color: var(--muted); font-size: 12.5px; font-weight: 600;
  cursor: pointer; font-family: var(--font);
  touch-action: manipulation; user-select: none;
  transition: border-color 0.14s, color 0.14s, background 0.14s;
}
@media (hover: hover) { .tn-rate-chip:hover { border-color: var(--accent); color: var(--text); } }
.tn-rate-chip:active { transform: scale(0.96); }
.tn-rate-chip.is-selected {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-color: var(--accent); color: var(--accent);
}
.tn-rate-note { font-size: 12px; }

/* First-run / setup state */
.tn-setup-wrap { padding: 24px 18px 32px; display: flex; flex-direction: column; gap: 16px; max-width: 480px; margin: 0 auto; }
.tn-setup-label { font-size: 14px; font-weight: 700; color: var(--text); margin: 0 0 6px; display: block; }
.tn-setup-note { font-size: 12px; color: var(--muted); line-height: 1.5; margin: 0 0 8px; }
.tn-setup-row { margin-bottom: 16px; }

/* Toasts + destructive button */
.tn-error-toast { font-size: 12px; color: var(--danger); }
.tn-btn-danger { background: var(--danger); border-color: var(--danger); color: #fff; }
@media (hover: hover) { .tn-btn-danger:hover { filter: brightness(1.08); } }

/* Spinners + loading */
@keyframes tn-spin { to { transform: rotate(360deg); } }
.tn-spinner {
  width: 24px; height: 24px; border-radius: 50%;
  border: 2.5px solid color-mix(in srgb, var(--accent) 18%, transparent);
  border-top-color: var(--accent);
  animation: tn-spin 0.8s linear infinite;
}
@media (prefers-reduced-motion: reduce) { .tn-spinner { animation: none; } }
.tn-loading { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 48px 24px; color: var(--muted); font-size: 13px; }

/* Scrollskin */
.tn-scroll::-webkit-scrollbar { width: 9px; height: 9px; }
.tn-scroll::-webkit-scrollbar-thumb {
  background: var(--border); border-radius: 999px;
  border: 2px solid transparent; background-clip: padding-box;
}
.tn-scroll::-webkit-scrollbar-track { background: transparent; }

/* Settings sheet — provider-grouped model picker (mirrors app-news) */
.tn-model-list { display: flex; flex-direction: column; gap: 10px; }
.tn-model-group { display: flex; flex-direction: column; gap: 6px; }
.tn-model-group-header {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.6px;
  color: var(--muted); margin: 2px 2px 2px;
  user-select: none;
}
.tn-model-group-hint {
  font-size: 12px; font-weight: 500;
  text-transform: none; letter-spacing: 0;
  color: var(--muted); opacity: 0.85;
}
.tn-model-row {
  display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px;
  padding: 10px 12px; border-radius: 10px; text-align: left;
  border: 1px solid var(--border); background: var(--surface);
  color: var(--text); font-family: var(--font); font-size: 14px; font-weight: 600;
  cursor: pointer; touch-action: manipulation; user-select: none;
  transition: border-color 0.14s, background 0.14s;
}
@media (hover: hover) { .tn-model-row:not(:disabled):not(.is-selected):hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); } }
.tn-model-row:not(:disabled):active { transform: scale(0.99); }
.tn-model-row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tn-model-row:disabled { cursor: not-allowed; opacity: 0.55; pointer-events: none; }
.tn-model-row.is-selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
}
.tn-model-row-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.tn-model-row-title { font-weight: 700; }
.tn-model-row-sub {
  font-size: 12px; font-weight: 500; color: var(--muted); font-family: var(--mono, monospace);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tn-model-check { flex: 0 0 auto; color: var(--accent); font-weight: 700; }
.tn-model-loading { display: flex; justify-content: center; padding: 16px 0; }
.tn-spinner-sm { width: 20px; height: 20px; border-width: 2px; flex: 0 0 auto; }

/* Generating placeholder card — sits at the top of the library list while a
   story is being written, so the in-progress state lives where the result
   will appear (the small hint next to the button was easy to miss). */
.tn-gen-card { border-style: dashed; }
/* The failed-run variant: a danger-tinted card so the error reads as a state,
   not a passing toast, and the Retry/Dismiss actions are obviously the way out. */
.tn-gen-card-error {
  border-style: solid;
  border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
  background: color-mix(in srgb, var(--danger) 8%, transparent);
}

`

// ---------------------------------------------------------------------------
// ParaText — one paragraph rendered as tappable word spans with the inline
// tap highlight. No bottom sheet: the tapped word gets the strong accent,
// its sentence the soft accent, and the OTHER pane shows the aligned
// sentence (index-clamped) plus — when the glossary maps the word — the
// exact translated word, also strong.
//
// `highlight` is the reader-level state:
//   { paraIdx, lang, wordIdx, sentIdx, otherWord }
// This component renders both roles: when its (paraIdx, paneLang) matches
// the tapped side it shows the tapped word; when it's the same paragraph in
// the other pane it shows the aligned context.
//
// Language learners need to be able to SELECT text (copy/paste), so
// user-select stays `text` on .tn-para-text.
// ---------------------------------------------------------------------------
function ParaText({ text, paraIdx, paneLang, highlight, onWordTap }) {
  const tokens = useMemo(() => tokenizeParagraph(text), [text])
  const inPara = highlight && highlight.paraIdx === paraIdx
  const isTappedPane = inPara && highlight.lang === paneLang

  let ctxSentIdx = -1
  let strongStart = -1
  let strongEnd = -1
  if (isTappedPane) {
    ctxSentIdx = highlight.sentIdx
    strongStart = strongEnd = highlight.wordIdx
  } else if (inPara) {
    ctxSentIdx = alignSentenceIndex(highlight.sentIdx, sentenceCount(tokens))
    if (highlight.otherWord) {
      const range = findPhraseTokenRange(tokens, highlight.otherWord)
      if (range) { strongStart = range.start; strongEnd = range.end }
    }
  }

  return (
    <p className="tn-para-text">
      {tokens.map((tok, i) => {
        const inCtx = ctxSentIdx >= 0 && tok.sentIdx === ctxSentIdx
        if (!tok.isWord) {
          return inCtx ? <span key={i} className="tn-ctx">{tok.text}</span> : tok.text
        }
        const isHit = strongStart >= 0 && tok.wordIdx >= strongStart && tok.wordIdx <= strongEnd
        return (
          <span
            key={i}
            className={`tn-word${inCtx ? ' tn-ctx' : ''}${isHit ? ' is-hit' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => onWordTap(paraIdx, paneLang, tok)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onWordTap(paraIdx, paneLang, tok) } }}
          >
            {tok.text}
          </span>
        )
      })}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Scroll-sync pure functions (see scroll-sync.mjs for the unit-tested canonical version).
// ---------------------------------------------------------------------------
function computeParaOffsets(paraRefs) {
  const offsets = []
  for (const ref of paraRefs) {
    if (!ref || !ref.current) return null
    offsets.push({
      top: ref.current.offsetTop,
      height: ref.current.offsetHeight || 1,
    })
  }
  return offsets
}

function computeSyncScrollTop(scrollTop, srcOffsets, dstOffsets) {
  if (!srcOffsets || !dstOffsets || srcOffsets.length !== dstOffsets.length) return null
  const n = srcOffsets.length
  if (n === 0) return null

  // Find anchor paragraph: last para whose top <= scrollTop
  let anchorIdx = 0
  for (let i = 0; i < n; i++) {
    if (srcOffsets[i].top <= scrollTop) anchorIdx = i
    else break
  }

  const src = srcOffsets[anchorIdx]
  const dst = dstOffsets[anchorIdx]

  // Intra-paragraph fraction (clamp 0–1)
  const frac = Math.min(1, Math.max(0, (scrollTop - src.top) / src.height))

  // Target scrollTop: dst para top + same fraction of dst para height
  return dst.top + frac * dst.height
}

// Proportional driver→follower mapping. follower.scrollTop =
// (driver.scrollTop / driverMax) * followerMax, with each max = scrollHeight -
// clientHeight. Aligns the EXTREMES (0→0, max→max) so the follower can always
// reach the top and bottom even when the two languages have different total
// heights. Returns null when a pane isn't scrollable (avoids /0). Canonical +
// tested in scroll-sync.mjs.
function computeProportionalScrollTop(driver, follower) {
  if (!driver || !follower) return null
  const driverMax = driver.scrollHeight - driver.clientHeight
  const followerMax = follower.scrollHeight - follower.clientHeight
  if (driverMax <= 0 || followerMax <= 0) return null
  const ratio = Math.min(1, Math.max(0, driver.scrollTop / driverMax))
  return ratio * followerMax
}

// Pad a raw word-tap target so the matched paragraph lands COMFORTABLY in view
// (≈margin of the way down, default a quarter), not flush against the top edge.
// Clamped to [0, scrollHeight - clientHeight] so matches near the start/end stay
// on-screen at either extreme. Canonical + tested in scroll-sync.mjs.
function clampScrollTargetToView(rawTarget, clientHeight, scrollHeight, margin = 0.25) {
  if (rawTarget == null || !Number.isFinite(rawTarget)) return null
  if (!Number.isFinite(clientHeight) || !Number.isFinite(scrollHeight)) return null
  const maxScroll = Math.max(0, scrollHeight - clientHeight)
  const padded = rawTarget - clientHeight * margin
  return Math.min(maxScroll, Math.max(0, padded))
}

function StoryReader({ story, onClose, onRate }) {
  // The TARGET language (lang_b, the one being learned) leads by default — it
  // sits in the top pane and titles, with the base language (lang_a) below as
  // the translation aid. The toggle still lets a reader swap which leads.
  const [bLead, setBLead] = useState(true)
  const [rating, setRating] = useState(story.rating || null)
  // The difficulty bar lives OUTSIDE the two language panes (it can't fairly
  // belong to either split). It appears once the reader reaches the end of an
  // UNRATED story; after rating, it shows a brief note and goes away — from
  // then on the rating is edited from the story's library card.
  const [atEnd, setAtEnd] = useState(false)
  const [showNoted, setShowNoted] = useState(false)
  const atEndRef = useRef(false)
  const [splitRatio, setSplitRatio] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem('tn-split-ratio'))
      if (v >= 0.2 && v <= 0.8) return v
    } catch {}
    return 0.5
  })
  // Inline word-tap highlight: { paraIdx, lang, wordIdx, sentIdx, otherWord }
  const [highlight, setHighlight] = useState(null)

  const topPaneRef = useRef(null)
  const botPaneRef = useRef(null)
  const readerBodyRef = useRef(null)
  // Driver/follower sync (replaces the old reciprocal isSyncingRef guard).
  // activePaneRef names the pane the user is actively scrolling ('top' | 'bot').
  // ONLY the active pane's onScroll drives the other; the follower's resulting
  // onScroll is ignored because it isn't the active pane — so there is no
  // reciprocal feedback loop to debounce, and no jitter. A pointer/wheel/touch
  // interaction over a pane (re)claims it as the driver; the claim simply gets
  // reassigned by the next interaction (no timer to expire).
  const activePaneRef = useRef(null)
  const rafRef = useRef(null)

  // Stable per-paragraph ref arrays (one object per paragraph, reused across renders)
  const topParaRefs = useMemo(
    () => story.paragraphs.map(() => ({ current: null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [story.paragraphs.length],
  )
  const botParaRefs = useMemo(
    () => story.paragraphs.map(() => ({ current: null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [story.paragraphs.length],
  )

  // Persist split ratio
  useEffect(() => {
    try { localStorage.setItem('tn-split-ratio', String(splitRatio)) } catch {}
  }, [splitRatio])

  // Cleanup rAF on unmount
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  // Latch "reached the end" — once true it stays true for this story, so the
  // rate bar doesn't flicker as the reader scrolls back up.
  const maybeLatchEnd = useCallback((pane) => {
    if (atEndRef.current || !pane) return
    if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 48) {
      atEndRef.current = true
      setAtEnd(true)
    }
  }, [])

  // A story short enough to not scroll counts as "at end" immediately.
  useEffect(() => {
    atEndRef.current = false
    setAtEnd(false)
    setShowNoted(false)
    const raf = requestAnimationFrame(() => {
      const pane = botPaneRef.current
      if (pane && pane.scrollHeight <= pane.clientHeight + 4) {
        atEndRef.current = true
        setAtEnd(true)
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [story.id])

  // The single rAF-throttled sync. Whichever pane is the active driver maps its
  // scroll position PROPORTIONALLY onto the follower (extremes align: top→top,
  // bottom→bottom). The follower's own onScroll re-enters here but is dropped
  // because the follower is never the active pane — the feedback loop is gone,
  // so there is nothing to debounce and nothing to jitter.
  const syncFromActive = useCallback((source) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      // Use the `source` captured when the scroll fired, NOT a live re-read of
      // activePaneRef. A driver-claim (onMouseEnter over the other pane) can land
      // between the handler's gate check and this frame; re-reading the ref here
      // would then sync from the wrong pane — the exact jitter this design fixes.
      if (!source) return
      const topPane = topPaneRef.current
      const botPane = botPaneRef.current
      if (!topPane || !botPane) return
      const driver = source === 'top' ? topPane : botPane
      const follower = source === 'top' ? botPane : topPane
      maybeLatchEnd(driver)
      const target = computeProportionalScrollTop(driver, follower)
      if (target === null) return
      // Instant assignment (no smooth tween): the follower lands in one frame so
      // it can never lag/jitter behind an animation, and its echo onScroll is a
      // no-op anyway (follower isn't the active pane).
      follower.scrollTop = target
    })
  }, [maybeLatchEnd])

  // A pointer/wheel/touch over a pane claims it as the scroll driver. Cheap and
  // idempotent; the next interaction over the other pane simply reassigns it.
  const claimTop = useCallback(() => { activePaneRef.current = 'top' }, [])
  const claimBot = useCallback(() => { activePaneRef.current = 'bot' }, [])

  const handleTopScroll = useCallback(() => {
    // Only drive when the top pane is the active driver; otherwise this is the
    // follower echoing a top-driven (or word-tap-driven) move — ignore it.
    if (activePaneRef.current !== 'top') { maybeLatchEnd(topPaneRef.current); return }
    syncFromActive('top')
  }, [syncFromActive, maybeLatchEnd])

  const handleBotScroll = useCallback(() => {
    if (activePaneRef.current !== 'bot') { maybeLatchEnd(botPaneRef.current); return }
    syncFromActive('bot')
  }, [syncFromActive, maybeLatchEnd])

  const handleDividerPointerDown = useCallback((e) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const handleDividerPointerMove = useCallback((e) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const body = readerBodyRef.current
    if (!body) return
    const rect = body.getBoundingClientRect()
    const newRatio = (e.clientY - rect.top) / rect.height
    setSplitRatio(Math.min(0.8, Math.max(0.2, newRatio)))
  }, [])

  const handleDividerPointerUp = useCallback((e) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  const handleWordTap = useCallback((paraIdx, lang, tok) => {
    setHighlight((prev) => {
      // Tapping the same word again clears the highlight.
      if (prev && prev.paraIdx === paraIdx && prev.lang === lang && prev.wordIdx === tok.wordIdx) {
        return null
      }
      const para = story.paragraphs[paraIdx]
      const word = stripWordPunct(tok.text)
      const entry = word ? lookupGlossary(para, word) : null
      const otherWord = entry ? (lang === 'a' ? entry.word_b : entry.word_a) : null
      return { paraIdx, lang, wordIdx: tok.wordIdx, sentIdx: tok.sentIdx, otherWord }
    })
  }, [story])

  // Tapping anywhere that isn't a word clears the highlight.
  const handlePaneClick = useCallback((e) => {
    if (e.target.closest && e.target.closest('.tn-word')) return
    setHighlight(null)
  }, [])

  // After a tap, bring the aligned paragraph in the OTHER pane into view so the
  // highlighted context is visible — WITHOUT moving the pane the reader just
  // tapped. scrollIntoView walks every scrollable ancestor and so nudges the
  // tapped pane (and the reader body) too; instead we compute the other pane's
  // aligned scrollTop directly (paragraph-offset math — proportional mapping
  // wouldn't land the SAME paragraph, which is the whole point of a word tap)
  // and assign it on that one element. Runs post-render, no timers.
  //
  // Driver/follower keeps this from regressing into a self-nudge: we mark the
  // TAPPED pane as the active driver, then write the OTHER (follower) pane. The
  // follower's resulting onScroll re-enters handleTop/BotScroll, sees it is not
  // the active pane, and is dropped — so this targeted move is never misread as
  // a user scroll that would drag the tapped pane back. The move is instant
  // (no smooth tween) so the follower settles in one frame.
  useEffect(() => {
    if (!highlight) return
    const tappedIsTop = (highlight.lang === 'a' && !bLead) || (highlight.lang === 'b' && bLead)
    const tappedPane = tappedIsTop ? topPaneRef.current : botPaneRef.current
    const otherPane = tappedIsTop ? botPaneRef.current : topPaneRef.current
    const tappedParaRefs = tappedIsTop ? topParaRefs : botParaRefs
    const otherParaRefs = tappedIsTop ? botParaRefs : topParaRefs
    if (!tappedPane || !otherPane) return
    // Anchor from the tapped paragraph's own top so the SAME paragraph aligns
    // in the other pane, regardless of where the tapped pane happens to be
    // scrolled. Fall back to the tapped pane's current scrollTop if the tapped
    // paragraph element isn't measurable yet.
    const tappedParaEl = tappedParaRefs[highlight.paraIdx]?.current
    const anchorTop = tappedParaEl ? tappedParaEl.offsetTop : tappedPane.scrollTop
    const srcOffsets = computeParaOffsets(tappedParaRefs)
    const dstOffsets = computeParaOffsets(otherParaRefs)
    const aligned = computeSyncScrollTop(anchorTop, srcOffsets, dstOffsets)
    if (aligned === null) return
    // Pull the aligned paragraph down off the top edge into the comfortable
    // top-third, clamped so a match near the story start/end can't overscroll.
    // This is what makes both tap directions land the match ON-SCREEN.
    const target = clampScrollTargetToView(aligned, otherPane.clientHeight, otherPane.scrollHeight)
    if (target === null) return
    activePaneRef.current = tappedIsTop ? 'top' : 'bot' // tapped pane is the driver
    otherPane.scrollTop = target // instant; the follower's echo onScroll is ignored
  }, [highlight, bLead, topParaRefs, botParaRefs])

  const handleRate = useCallback((verdict) => {
    setRating(verdict)
    setShowNoted(true)
    onRate(story, verdict)
  }, [story, onRate])

  const langA = story.lang_a
  const langB = story.lang_b

  return (
    <div className="tn-reader">
      <div className="tn-reader-bar">
        <button type="button" className="tn-reader-back" onClick={onClose}
          aria-label="Back to story list">← Back</button>
        <div className="tn-reader-title-wrap">
          <div className="tn-reader-title">{bLead ? story.title_b : story.title_a}</div>
          <div className="tn-reader-subtitle">{langA} / {langB} · {story.level}</div>
        </div>
        <div className="tn-reader-controls">
          <button
            type="button"
            className="tn-lang-toggle"
            onClick={() => setBLead((v) => !v)}
            aria-label={`Switch leading language. Currently: ${bLead ? langB : langA}`}
            title="Swap which language leads"
          >
            <span>{bLead ? langB : langA}</span>
            <span className="tn-lang-toggle-arrow" aria-hidden="true">⇄</span>
          </button>
        </div>
      </div>

      <div className="tn-reader-body" ref={readerBodyRef}>
        {/* TOP PANE */}
        <div
          className="tn-pane tn-pane-top"
          ref={topPaneRef}
          style={{ height: `${splitRatio * 100}%` }}
          onScroll={handleTopScroll}
          onClick={handlePaneClick}
          onPointerDown={claimTop}
          onWheel={claimTop}
          onTouchStart={claimTop}
          onMouseEnter={claimTop}
        >
          <div className="tn-story-head">
            <p className="tn-story-title-a">{bLead ? story.title_b : story.title_a}</p>
            <p className="tn-story-title-b">{bLead ? langB : langA}</p>
          </div>
          {story.paragraphs.map((para, i) => (
            <div
              key={i}
              ref={(el) => { topParaRefs[i].current = el }}
              className="tn-para"
            >
              <ParaText
                text={bLead ? para.b : para.a}
                paraIdx={i}
                paneLang={bLead ? 'b' : 'a'}
                highlight={highlight}
                onWordTap={handleWordTap}
              />
            </div>
          ))}
        </div>

        {/* DIVIDER */}
        <div
          className="tn-divider-handle"
          onPointerDown={handleDividerPointerDown}
          onPointerMove={handleDividerPointerMove}
          onPointerUp={handleDividerPointerUp}
          onPointerCancel={handleDividerPointerUp}
          aria-label="Drag to resize panes"
          role="separator"
          aria-orientation="horizontal"
        >
          <div className="tn-divider-pip" />
        </div>

        {/* BOTTOM PANE */}
        <div
          className="tn-pane tn-pane-bottom"
          ref={botPaneRef}
          style={{ height: `${(1 - splitRatio) * 100}%` }}
          onScroll={handleBotScroll}
          onClick={handlePaneClick}
          onPointerDown={claimBot}
          onWheel={claimBot}
          onTouchStart={claimBot}
          onMouseEnter={claimBot}
        >
          <div className="tn-story-head">
            <p className="tn-story-title-a">{bLead ? story.title_a : story.title_b}</p>
            <p className="tn-story-title-b">{bLead ? langA : langB} (translated)</p>
          </div>
          {story.paragraphs.map((para, i) => (
            <div
              key={i}
              ref={(el) => { botParaRefs[i].current = el }}
              className="tn-para"
            >
              <ParaText
                text={bLead ? para.a : para.b}
                paraIdx={i}
                paneLang={bLead ? 'a' : 'b'}
                highlight={highlight}
                onWordTap={handleWordTap}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Difficulty bar — floats over the reader, belonging to NEITHER pane.
          Shows only when an unrated story has been read to the end; after
          rating it confirms briefly and retires (edit later from the card). */}
      {!rating && atEnd && (
        <div className="tn-rate-bar" role="group" aria-label="Rate story difficulty">
          <span className="tn-rate-label">How was it?</span>
          {RATE_OPTIONS.map(({ verdict, label }) => (
            <button
              key={verdict}
              type="button"
              className="tn-rate-chip"
              onClick={() => handleRate(verdict)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {rating && showNoted && (
        <div
          className="tn-rate-bar is-noted"
          onAnimationEnd={() => setShowNoted(false)}
        >
          <span className="tn-rate-note">Noted — the next story will adapt.</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// GenerateSheet — bottom sheet for the ONE free-form prompt + languages/level.
// The prompt replaces the old Topic + Series/storyline + genre split (v0.10):
// the reader types a single natural-language ask and the generation agent
// interprets it (fresh story, or continue/sequel an existing one — loading the
// relevant stories from the library itself). We GUIDE the reader with example
// phrasings in the textarea placeholder + a hint line below it (covering
// classic / travel / daily-life / sci-fi / continue / sequel asks) rather than
// clickable chips, so the prompt stays a single free-form field with no
// structured mode-picker to tap. `recentTitle` is the newest story's title,
// woven into the placeholder as a "continue <title>" example when there is one.
// ---------------------------------------------------------------------------
function GenerateSheet({ onGenerate, onCancel, initialLangA, initialLangB, initialLevel, recentTitle }) {
  const [promptInput, setPromptInput] = useState('')
  const [langA, setLangA] = useState(initialLangA || 'English')
  const [langB, setLangB] = useState(initialLangB || '')
  const [level, setLevel] = useState(CEFR_LEVELS.includes(initialLevel) ? initialLevel : 'B1')

  // Examples are TEXT, not buttons. The placeholder shows a couple of full
  // phrasings; when there is a recent story we tail it with a context-aware
  // "continue <that title>" example. The hint line below lists more genres in
  // plain text the reader can copy the shape of.
  const promptPlaceholder = recentTitle
    ? `e.g. “a sci-fi mystery in a floating city”, or continue an earlier story: “continue “${recentTitle}”, but darker”`
    : 'e.g. “a classic fable”, “a travel adventure in Japan”, or “a sci-fi mystery in a floating city”'

  const handleGenerate = () => {
    onGenerate({
      prompt: promptInput.trim(),
      lang_a: langA.trim() || (initialLangA || 'English'),
      lang_b: langB.trim() || (initialLangB || ''),
      level,
    })
  }

  return (
    <div className="tn-scrim" onClick={onCancel} role="dialog" aria-modal="true" aria-label="Generate story">
      <div className="tn-sheet" onClick={(e) => e.stopPropagation()}>
        <p className="tn-sheet-title">Generate a story</p>
        <div>
          <label className="tn-setup-label" htmlFor="tn-gen-lang-a">Language you know</label>
          <input
            id="tn-gen-lang-a"
            className="tn-input"
            value={langA}
            onChange={(e) => setLangA(e.target.value)}
            placeholder="e.g. English"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="tn-setup-label" htmlFor="tn-gen-lang-b">Language you're learning</label>
          <input
            id="tn-gen-lang-b"
            className="tn-input"
            value={langB}
            onChange={(e) => setLangB(e.target.value)}
            placeholder="e.g. Spanish, French, Japanese"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="tn-setup-label" htmlFor="tn-gen-level">Level (CEFR)</label>
          <select
            id="tn-gen-level"
            className="tn-select"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="A1">A1 — Beginner</option>
            <option value="A2">A2 — Elementary</option>
            <option value="B1">B1 — Intermediate</option>
            <option value="B2">B2 — Upper intermediate</option>
            <option value="C1">C1 — Advanced</option>
            <option value="C2">C2 — Mastery</option>
          </select>
        </div>
        <div>
          <label className="tn-setup-label" htmlFor="tn-gen-prompt">What story would you like? (optional)</label>
          <textarea
            id="tn-gen-prompt"
            className="tn-textarea"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            placeholder={promptPlaceholder}
            rows={3}
            aria-describedby="tn-gen-prompt-hint"
          />
          <p id="tn-gen-prompt-hint" className="tn-setup-note" style={{ margin: '6px 0 0' }}>
            Describe whatever you like — for example: “a classic fable”, “a travel
            adventure”, “a daily-life scene”, “a sci-fi mystery”, “continue{' '}
            {recentTitle ? `“${recentTitle}”` : 'a recent story'}”, or “a sequel
            to {recentTitle ? `“${recentTitle}”` : 'an earlier story'}”. Continue
            or sequel by title or character. Leave blank to be surprised.
          </p>
        </div>
        <div className="tn-sheet-actions">
          <button type="button" className="tn-btn tn-btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="tn-btn tn-btn-primary" onClick={handleGenerate}>Generate</button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DeleteConfirmModal — browser modal dialogs (window.confirm) silently no-op
// inside the AppCanvas iframe (sandbox lacks `allow-modals`), so we ship our
// own confirmation.
// ---------------------------------------------------------------------------
function DeleteConfirmModal({ entry, busy, onConfirm, onCancel }) {
  return (
    <div className="tn-scrim" onClick={busy ? undefined : onCancel}
      role="dialog" aria-modal="true" aria-label="Confirm delete">
      <div className="tn-sheet" onClick={(e) => e.stopPropagation()}>
        <p className="tn-sheet-title">Delete “{entry.title_b}”?</p>
        <p className="tn-sheet-sub">
          This removes the story permanently. It cannot be undone.
        </p>
        <div className="tn-sheet-actions">
          <button type="button" className="tn-btn tn-btn-secondary"
            onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="tn-btn tn-btn-danger"
            onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SettingsSheet — the app's one settings surface (everything else moved into
// the generate sheet). Holds only the story-generation agent: a provider-grouped
// model picker (Claude / OpenAI Codex), matching app-news. Models are fetched
// from `GET /api/auth/providers/models`; provider connection state from
// `GET /api/auth/providers/status`. A tap selects AND persists immediately
// (prefs.gen_provider + prefs.gen_model); Done just closes. Endpoint failure
// degrades to FALLBACK_GROUPS / "Default only" — never blocks anything.
// ---------------------------------------------------------------------------
function SettingsSheet({ token, prefs, onSelectModel, onClose }) {
  const storedProvider = normalizeGenProvider(prefs)
  const storedModel = normalizeGenModel(prefs)
  // null = still loading; otherwise the provider groups (FALLBACK_GROUPS or the
  // stitched live list).
  const [providerGroups, setProviderGroups] = useState(null)
  // Whether the live models fetch actually succeeded (false → fallback list is
  // showing; surface a soft hint).
  const [modelsFailed, setModelsFailed] = useState(false)
  // null = treat everything as connected (status fetch failed / older mobius);
  // otherwise a Set of authenticated provider ids.
  const [connectedProviders, setConnectedProviders] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [models, status] = await Promise.all([
        loadProviderModels(token),
        loadProviderStatus(token),
      ])
      if (cancelled) return
      setProviderGroups(models ? buildProviderGroups(models) : FALLBACK_GROUPS)
      setModelsFailed(!models)
      if (status && typeof status === 'object') {
        setConnectedProviders(new Set(
          Object.entries(status)
            .filter(([, v]) => v && v.authenticated)
            .map(([k]) => k),
        ))
      }
    })()
    return () => { cancelled = true }
  }, [token])

  // Self-heal the highlighted row against the LIVE model list. migrateGenPrefs
  // anchors the stored selection to the hard-coded FALLBACK id; if the backend
  // ever stops returning exactly that id, the stored gen_model is present in no
  // loaded group and every row renders unselected. Once the groups load, if the
  // stored model isn't in any of them, fall back to the stored provider's first
  // available model (or, if that provider is gone too, the first group's first
  // model) — purely a display choice for which row reads as "current"; the
  // persisted prefs are untouched until the user actually taps a row. While the
  // groups are still loading we keep the stored values so nothing flickers.
  let currentProvider = storedProvider
  let currentModel = storedModel
  if (providerGroups !== null) {
    const inSomeGroup = providerGroups.some(
      (g) => g.key === storedProvider && g.models.some((m) => m.id === storedModel),
    )
    if (!inSomeGroup) {
      const sameProvider = providerGroups.find((g) => g.key === storedProvider && g.models.length > 0)
      const fallbackGroup = sameProvider || providerGroups.find((g) => g.models.length > 0)
      if (fallbackGroup) {
        currentProvider = fallbackGroup.key
        currentModel = fallbackGroup.models[0].id
      }
    }
  }

  return (
    <div className="tn-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label="Settings">
      <div className="tn-sheet" onClick={(e) => e.stopPropagation()}>
        <p className="tn-sheet-title">Settings</p>
        <div>
          <div className="tn-setup-label">Story generation agent</div>
          <p className="tn-setup-note">
            Which model writes new stories. The list follows your chat model
            visibility settings.
          </p>
          {providerGroups === null ? (
            <div className="tn-model-loading">
              <div className="tn-spinner tn-spinner-sm" role="status" aria-label="Loading models" />
            </div>
          ) : (
            <div className="tn-model-list" role="radiogroup" aria-label="Story generation agent">
              {providerGroups.map((group) => {
                const connected = !connectedProviders || connectedProviders.has(group.key)
                return (
                  <div key={group.key} className="tn-model-group">
                    <div className="tn-model-group-header">
                      <span>{group.label}</span>
                      {!connected && <span className="tn-model-group-hint">not connected</span>}
                    </div>
                    {group.models.map((m) => {
                      const on = currentProvider === group.key && currentModel === m.id
                      const disabled = !connected && !on
                      return (
                        <button
                          key={`${group.key}-${m.id}`}
                          type="button"
                          className={`tn-model-row${on ? ' is-selected' : ''}`}
                          role="radio"
                          aria-checked={on}
                          disabled={disabled}
                          onClick={() => onSelectModel(group.key, m.id)}
                        >
                          <div className="tn-model-row-main">
                            <span className="tn-model-row-title">{m.name}</span>
                            <span className="tn-model-row-sub">{m.id}</span>
                          </div>
                          {on && <span className="tn-model-check" aria-hidden="true">✓</span>}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
          {modelsFailed && providerGroups !== null && (
            <p className="tn-setup-note" style={{ marginTop: 8 }}>
              Couldn&apos;t load the live model list — showing a short fallback.
              New stories still generate fine.
            </p>
          )}
        </div>
        <div className="tn-sheet-actions">
          <button type="button" className="tn-btn tn-btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

const GearIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

const TrashIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
)

// ---------------------------------------------------------------------------
// LibraryTab — story list + generate button. The story index and the
// generation engine live in App (they must outlive any view), so they arrive
// as props.
// ---------------------------------------------------------------------------
function LibraryTab({ appId, token, online, prefs, onPrefsChange, index, onIndexChange, mutateIndex, gen }) {
  const [stories, setStories] = useState({})
  const [activeStory, setActiveStory] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [showGenerateSheet, setShowGenerateSheet] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [rateEditId, setRateEditId] = useState(null)
  const navRef = useRef(null)
  const errTimerRef = useRef(null)

  useEffect(() => () => {
    if (errTimerRef.current) clearTimeout(errTimerRef.current)
    try { navRef.current?.close?.() } catch {}
  }, [])

  const flashError = useCallback((msg) => {
    setErrorMsg(msg)
    if (errTimerRef.current) clearTimeout(errTimerRef.current)
    errTimerRef.current = setTimeout(() => setErrorMsg(''), 3000)
  }, [])

  const openStory = useCallback(async (entry) => {
    // Register back nav if available.
    if (window.mobius?.nav?.open) {
      const handle = window.mobius.nav.open('tandem-reader', () => {
        navRef.current = null
        setActiveStory(null)
      })
      navRef.current = handle
      await handle.ready?.catch(() => false)
      if (navRef.current !== handle) return
    }
    // Load the full story if not already cached.
    if (!stories[entry.id]) {
      const story = await loadStory(appId, token, entry.id)
      if (story) {
        setStories((prev) => ({ ...prev, [story.id]: story }))
        setActiveStory(story)
      } else {
        flashError('Could not load story.')
      }
    } else {
      setActiveStory(stories[entry.id])
    }
  }, [appId, token, stories, flashError])

  const closeStory = useCallback(() => {
    try { navRef.current?.close?.() } catch {}
    navRef.current = null
    setActiveStory(null)
  }, [])

  // A rating lands in two places: on the story record itself (so reopening
  // the story shows it) and in prefs.feedback_history (generate.sh steers
  // the next story's difficulty from the recent entries).
  const handleRate = useCallback(async (story, verdict) => {
    const updated = { ...story, rating: verdict }
    setStories((prev) => ({ ...prev, [story.id]: updated }))
    await putJSON(`/api/storage/apps/${appId}/stories/${story.id}.json`, token, updated, appId)
    // Mirror onto the index entry so the library card shows the rating
    // (and can edit it) without loading the full story record. Serialized +
    // fresh-read: a delete that landed first leaves no entry to rate (the map
    // is a no-op over the post-delete array), so a rate can't resurrect a
    // deleted story, and a story the server appended mid-rate survives.
    await mutateIndex((fresh) => setRatingInIndex(fresh, story.id, verdict))
    const history = [...(prefs.feedback_history || [])]
    // Re-rating the same story replaces its last entry instead of stacking.
    if (history.length && history[history.length - 1]?.story_id === story.id) history.pop()
    history.push({ story_id: story.id, verdict, ts: new Date().toISOString() })
    const next = { ...prefs, feedback_history: history }
    onPrefsChange(next)
    await savePrefs(appId, token, next)
  }, [appId, token, prefs, onPrefsChange, mutateIndex])

  // Rate (or re-rate) straight from a library card — loads the story record
  // on demand since cards only carry index entries.
  const rateFromCard = useCallback(async (entry, verdict) => {
    setRateEditId(null)
    let story = stories[entry.id]
    if (!story) {
      story = await loadStory(appId, token, entry.id)
      if (!story) {
        flashError('Could not load story.')
        return
      }
      setStories((prev) => ({ ...prev, [story.id]: story }))
    }
    await handleRate(story, verdict)
  }, [stories, appId, token, handleRate, flashError])

  const handleSheetGenerate = useCallback(async ({ prompt, lang_a, lang_b, level }) => {
    setShowGenerateSheet(false)
    // Persist language/level back to prefs so the next sheet opens with the same
    // defaults, and save next_request so generate.sh picks it up. The free-form
    // prompt is PER-RUN by design: it lives only inside next_request, which
    // generate.sh wipes after the run, so the next generation starts blank
    // (there is no persistent storyline to manage any more). The generation
    // model rides along in next_request so the per-run record is self-contained
    // (a settings change mid-run won't retro-affect a retry); generate.sh also
    // falls back to prefs.gen_model for runs that have no next_request (e.g.
    // scheduled ones).
    const updatedLangA = lang_a || prefs.lang_a
    const updatedLangB = lang_b || prefs.lang_b
    const updatedLevel = CEFR_LEVELS.includes(level) ? level : (prefs.level || 'B1')
    const genProvider = normalizeGenProvider(prefs)
    const genModel = normalizeGenModel(prefs)
    const promptVal = (prompt || '').trim()
    const params = {
      lang_a: updatedLangA,
      lang_b: updatedLangB,
      ...(promptVal ? { prompt: promptVal } : {}),
      ...(genProvider ? { provider: genProvider } : {}),
      ...(genModel ? { model: genModel } : {}),
    }
    const next = {
      ...prefs,
      lang_a: updatedLangA,
      lang_b: updatedLangB,
      level: updatedLevel,
      next_request: params,
    }
    onPrefsChange(next)
    await savePrefs(appId, token, next)
    gen.start({ ...params, level: updatedLevel }, index || [])
  }, [appId, token, prefs, onPrefsChange, gen, index])

  const confirmDelete = useCallback(async () => {
    const entry = pendingDelete
    if (!entry) return
    setDeleting(true)
    const res = await deleteJSON(
      `/api/storage/apps/${appId}/stories/${entry.id}.json`, token, appId,
    )
    if (!res.ok) {
      setDeleting(false)
      setPendingDelete(null)
      flashError('Could not delete story.')
      return
    }
    // Serialized + fresh-read: drop the entry from the FRESHEST index, not a
    // stale snapshot, so a concurrent rate can't re-add it and a story the
    // server appended after this client's last render isn't lost.
    await mutateIndex((fresh) => removeStoryFromIndex(fresh, entry.id))
    setStories((prev) => {
      if (!(entry.id in prev)) return prev
      const next = { ...prev }
      delete next[entry.id]
      return next
    })
    setDeleting(false)
    setPendingDelete(null)
  }, [appId, token, pendingDelete, mutateIndex, flashError])

  const handleRetry = useCallback(async () => {
    const params = gen.params || {}
    await gen.dismiss()
    // Restore next_request — generate.sh clears it after each run, so a
    // retry without this would fall back to the prefs defaults.
    if (params.lang_a && params.lang_b) {
      // Rebuild next_request from the same per-run params (generate.sh cleared
      // it after the failed run). The free-form prompt is carried verbatim so
      // the retry asks for exactly what the reader asked for.
      const next = {
        ...prefs,
        next_request: {
          lang_a: params.lang_a,
          lang_b: params.lang_b,
          ...(params.prompt ? { prompt: params.prompt } : {}),
          ...(params.provider ? { provider: params.provider } : {}),
          ...(params.model ? { model: params.model } : {}),
        },
      }
      onPrefsChange(next)
      await savePrefs(appId, token, next)
    }
    gen.start(params, index || [])
  }, [gen, prefs, onPrefsChange, appId, token, index])

  // Show first-run setup if no prefs are set.
  const needsSetup = !prefs.lang_a || !prefs.lang_b

  if (needsSetup) {
    return (
      <SetupView
        appId={appId}
        token={token}
        prefs={prefs}
        onPrefsChange={onPrefsChange}
        onComplete={() => {}} // parent will re-render
      />
    )
  }

  const genBusy = gen.phase === 'running'
  const genFailed = gen.phase === 'error'
  const generateDisabled = genBusy || !online

  return (
    <div className="tn-list-wrap">
      {!online && (
        <div className="tn-offline-banner">
          Offline — showing saved stories. New stories resume once you're back online.
        </div>
      )}
      <div className="tn-top-row">
        <button
          type="button"
          className="tn-generate-btn"
          onClick={() => setShowGenerateSheet(true)}
          disabled={generateDisabled}
          title={!online ? 'Online required to generate' : undefined}
          aria-busy={genBusy}
        >
          {genBusy ? 'Generating…' : '+ Generate story'}
        </button>
        {gen.phase === 'done' && <span className="tn-status-hint">Story ready!</span>}
        {errorMsg && <span className="tn-error-hint">{errorMsg}</span>}
      </div>

      {/* In-progress placeholder card — the new story's seat at the top of
          the library. */}
      {genBusy && (
        <div className="tn-card tn-gen-card" aria-live="polite">
          <div className="tn-spinner tn-spinner-sm" aria-hidden="true" />
          <div className="tn-card-main">
            <div className="tn-card-title">Writing your story…</div>
            <div className="tn-card-sub">
              {gen.params?.lang_b
                ? `A new ${gen.params.lang_b} story — usually ready in a minute or two.`
                : 'Usually ready in a minute or two.'}
            </div>
          </div>
        </div>
      )}

      {/* Failure card — a run that errored (run-job rejected, the script left
          a failure marker, or the poll timed out) surfaces the reason here
          instead of spinning forever, with Retry / Dismiss to recover. */}
      {genFailed && (
        <div className="tn-card tn-gen-card tn-gen-card-error" role="alert" aria-live="assertive">
          <div className="tn-card-main">
            <div className="tn-card-title">Generation failed</div>
            <div className="tn-card-sub tn-error-hint">
              {gen.error || GEN_TIMEOUT_MESSAGE}
            </div>
          </div>
          <span className="tn-stale-actions">
            <button type="button" className="tn-stale-btn" onClick={handleRetry}>Retry</button>
            <button type="button" className="tn-stale-btn" onClick={gen.dismiss}>Dismiss</button>
          </span>
        </div>
      )}

      {index === null ? (
        <div className="tn-loading">
          <div className="tn-spinner" role="status" aria-label="Loading stories" />
          <span>Loading stories…</span>
        </div>
      ) : index.length === 0 ? (
        // While the first story is being written the placeholder card above
        // already says everything — an empty-state lecture under it would
        // just contradict the "something is happening" signal.
        genBusy ? null : (
          <div className="tn-empty" style={{ margin: '0 auto' }}>
            <div className="tn-empty-mark" aria-hidden="true">📖</div>
            <div className="tn-empty-title">No stories yet</div>
            <p className="tn-empty-text">
              Tap “+ Generate story” to get your first{' '}
              {prefs.lang_b || 'target language'} story at CEFR&nbsp;
              {adaptLevel(prefs.level || 'B1', prefs.feedback_history)} level —
              it takes a minute or two to write.
            </p>
          </div>
        )
      ) : (
        index.map((entry) => {
          const effRating = stories[entry.id]?.rating ?? entry.rating ?? null
          return (
            <div key={entry.id} className={`tn-card${effRating ? ' has-rate' : ''}`}>
              <div className="tn-card-row">
                <button
                  type="button"
                  className="tn-card-open"
                  onClick={() => openStory(entry)}
                >
                  <div className="tn-card-main">
                    <div className="tn-card-title">{entry.title_b}</div>
                    <div className="tn-card-sub">{entry.title_a} · {entry.lang_b} / {entry.lang_a}</div>
                  </div>
                  <span className="tn-level-pill">{entry.level}</span>
                </button>
                <button
                  type="button"
                  className="tn-card-del"
                  aria-label={`Delete ${entry.title_b}`}
                  onClick={() => setPendingDelete(entry)}
                >
                  {TrashIcon}
                </button>
              </div>
              {effRating && (
                <div className="tn-card-rate-row">
                  {rateEditId === entry.id ? (
                    RATE_OPTIONS.map(({ verdict, label }) => (
                      <button
                        key={verdict}
                        type="button"
                        className={`tn-rate-chip${effRating === verdict ? ' is-selected' : ''}`}
                        onClick={() => rateFromCard(entry, verdict)}
                        aria-pressed={effRating === verdict}
                      >
                        {label}
                      </button>
                    ))
                  ) : (
                    <button
                      type="button"
                      className="tn-card-rating"
                      onClick={() => setRateEditId(entry.id)}
                      aria-label={`Change difficulty rating (currently ${RATE_LABELS[effRating] || effRating})`}
                    >
                      {RATE_LABELS[effRating] || effRating} <span aria-hidden="true">✎</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}

      {showGenerateSheet && (
        <GenerateSheet
          onGenerate={handleSheetGenerate}
          onCancel={() => setShowGenerateSheet(false)}
          initialLangA={prefs.lang_a}
          initialLangB={prefs.lang_b}
          initialLevel={prefs.level}
          recentTitle={(index && index[0] && index[0].title_b) || ''}
        />
      )}

      {pendingDelete && (
        <DeleteConfirmModal
          entry={pendingDelete}
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {activeStory && (
        <StoryReader
          story={stories[activeStory.id] || activeStory}
          onClose={closeStory}
          onRate={handleRate}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SetupView — first-run language collection.
// ---------------------------------------------------------------------------
function SetupView({ appId, token, prefs, onPrefsChange }) {
  const [langA, setLangA] = useState(prefs.lang_a || 'English')
  const [langB, setLangB] = useState(prefs.lang_b || '')
  const [level, setLevel] = useState(prefs.level || 'B1')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = useCallback(async () => {
    const a = langA.trim()
    const b = langB.trim()
    if (!a || !b) { setError('Please fill in both languages.'); return }
    setSaving(true)
    setError('')
    const next = { ...prefs, lang_a: a, lang_b: b, level }
    const res = await savePrefs(appId, token, next)
    setSaving(false)
    if (res && (res.synced || res.queued)) {
      onPrefsChange(next)
    } else {
      setError('Could not save preferences. Try again.')
    }
  }, [appId, token, prefs, langA, langB, level, onPrefsChange])

  return (
    <div className="tn-setup-wrap">
      <div className="tn-empty-mark" style={{ alignSelf: 'center' }} aria-hidden="true">🗣️</div>
      <div style={{ textAlign: 'center' }}>
        <div className="tn-empty-title">Welcome to Tandem</div>
        <p className="tn-empty-text">
          Tell us which languages to use and we'll generate bilingual stories
          matched to your level. Tap any word in a story to see its meaning.
        </p>
      </div>

      <div className="tn-setup-row">
        <label className="tn-setup-label" htmlFor="tn-lang-a">Language you know</label>
        <p className="tn-setup-note">Your native or strongest language (e.g. English, French, Mandarin).</p>
        <input
          id="tn-lang-a"
          className="tn-input"
          value={langA}
          onChange={(e) => setLangA(e.target.value)}
          placeholder="e.g. English"
          autoComplete="off"
        />
      </div>

      <div className="tn-setup-row">
        <label className="tn-setup-label" htmlFor="tn-lang-b">Language you're learning</label>
        <p className="tn-setup-note">The language you want to read stories in (e.g. Spanish, Japanese, German).</p>
        <input
          id="tn-lang-b"
          className="tn-input"
          value={langB}
          onChange={(e) => setLangB(e.target.value)}
          placeholder="e.g. Spanish"
          autoComplete="off"
        />
      </div>

      <div className="tn-setup-row">
        <label className="tn-setup-label" htmlFor="tn-level">Starting level (CEFR)</label>
        <p className="tn-setup-note">A rough estimate is fine — Tandem adapts based on your ratings.</p>
        <select
          id="tn-level"
          className="tn-select"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        >
          <option value="A1">A1 — Beginner</option>
          <option value="A2">A2 — Elementary</option>
          <option value="B1">B1 — Intermediate</option>
          <option value="B2">B2 — Upper intermediate</option>
          <option value="C1">C1 — Advanced</option>
          <option value="C2">C2 — Mastery</option>
        </select>
      </div>

      {error && <div className="tn-error-toast">{error}</div>}

      <button
        type="button"
        className="tn-btn tn-btn-primary"
        onClick={handleSave}
        disabled={saving}
        style={{ width: '100%' }}
      >
        {saving ? 'Saving…' : 'Start reading'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root component. Languages and level are chosen per-generation in the
// generate sheet (and remembered in prefs), so the library IS the app; the
// gear opens the one remaining settings surface (the generation model).
// The story index and the generation engine live here because they must
// survive any view change.
// ---------------------------------------------------------------------------
export default function App({ appId, token }) {
  const [prefs, setPrefs] = useState(null) // null while loading
  // Single owner of stories/index.json: all client mutations go through
  // storyIndex.mutate (serialized + fresh-read). setIndex is for non-mutating
  // refreshes (mount load, generation-complete poll reading the server's
  // appended story).
  const storyIndex = useStoryIndex({ appId, token })
  const { index, setIndex, mutate: mutateIndex } = storyIndex
  const [showSettings, setShowSettings] = useState(false)
  const online = useOnline()
  const gen = useGeneration({ appId, token, onStoryReady: setIndex })

  // Selecting an agent persists immediately — there is no save button on the
  // sheet. The picker now only ever passes a concrete provider+model (the
  // selectable "Default" row was removed); the empty-arg branches remain as a
  // defensive clear so an empty selection still reads as "no preference"
  // everywhere. provider+model are written together so generate.sh can route
  // to the right CLI.
  const handleSelectModel = useCallback(async (provider, id) => {
    const next = { ...prefs }
    if (provider) next.gen_provider = provider
    else delete next.gen_provider
    if (id) next.gen_model = id
    else delete next.gen_model
    setPrefs(next)
    await savePrefs(appId, token, next)
  }, [appId, token, prefs])

  // Load prefs + story index on mount. The "Default" generation row was removed
  // from the picker, so a user who was sitting on it (empty/missing gen_model)
  // would otherwise open Settings to NO selected row. migrateGenPrefs rewrites
  // that one time to a concrete real model; we persist only when it actually
  // changed (migrateGenPrefs returns the same reference when it didn't), so a
  // user with a real model already chosen incurs no write.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [loadedPrefs, entries] = await Promise.all([
        loadPrefs(appId, token),
        loadStoryIndex(appId, token),
      ])
      if (cancelled) return
      const migrated = migrateGenPrefs(loadedPrefs)
      setPrefs(migrated)
      setIndex(entries)
      if (migrated !== loadedPrefs) {
        savePrefs(appId, token, migrated).catch(() => {})
      }
    })()
    return () => { cancelled = true }
  }, [appId, token])

  if (prefs === null) {
    return (
      <div className="tn-root">
        <style>{CSS}</style>
        <div className="tn-loading">
          <div className="tn-spinner" role="status" aria-label="Loading" />
        </div>
      </div>
    )
  }

  return (
    <div className="tn-root">
      <style>{CSS}</style>
      <header className="tn-header">
        {/* Brand mark = the real glossy app icon plus the name + tagline below.
            The icon is downscaled + cached server-side (?size=64); onError hides
            the broken img and reveals the accent-dot fallback for installs with
            no custom icon. */}
        <div className="tn-brand">
          <img
            src={`/api/apps/${appId}/icon?size=64`}
            alt=""
            width={34}
            height={34}
            className="tn-brand-icon"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
              const f = e.currentTarget.nextElementSibling
              if (f) f.style.display = 'flex'
            }}
          />
          <span className="tn-brand-fallback" style={{ display: 'none' }} aria-hidden="true">·</span>
          {/* Static name + tagline. NOT the old dynamic language indicator
              (removed in v0.7.0) — this never changes per story/language. */}
          <div className="tn-brand-text">
            <span className="tn-brand-name">Tandem</span>
            <span className="tn-brand-tagline">Read side by side in two languages</span>
          </div>
        </div>
        <div className="tn-header-right">
          <button
            type="button"
            className="tn-btn tn-btn-ghost tn-btn-icon"
            aria-label="Settings"
            title="Settings"
            onClick={() => setShowSettings(true)}
          >
            {GearIcon}
          </button>
        </div>
      </header>

      <div className="tn-scroll">
        <LibraryTab
          appId={appId}
          token={token}
          online={online}
          prefs={prefs}
          onPrefsChange={setPrefs}
          index={index}
          onIndexChange={setIndex}
          mutateIndex={mutateIndex}
          gen={gen}
        />
      </div>

      {showSettings && (
        <SettingsSheet
          token={token}
          prefs={prefs}
          onSelectModel={handleSelectModel}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
