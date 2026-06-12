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
  const needle = word.trim().toLowerCase()
  return para.glossary.find((entry) => {
    if (typeof entry.word_a === 'string' && entry.word_a.toLowerCase().includes(needle)) return true
    if (typeof entry.word_b === 'string' && entry.word_b.toLowerCase().includes(needle)) return true
    return false
  }) || null
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

function buildIndexEntry(story) {
  return {
    id: story.id,
    title_a: story.title_a,
    title_b: story.title_b,
    lang_a: story.lang_a,
    lang_b: story.lang_b,
    level: story.level,
    created: story.created,
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
// generate.sh self-kills at TANDEM_TIMEOUT (300s); past this the record is
// presumed orphaned and the UI offers Retry / Dismiss. The poll keeps
// running while stale so a late story still surfaces.
const GEN_STALE_MS = 6 * 60_000

function pendingUrl(appId) {
  return `/api/storage/apps/${appId}/generation-pending.json`
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

  const beginPolling = useCallback((pending) => {
    stopPolling()
    const startedAt = Date.parse(pending.started_at) || Date.now()
    const known = new Set(Array.isArray(pending.known_ids) ? pending.known_ids : [])
    const params = pending.params || null
    const phaseFor = () => (Date.now() - startedAt > GEN_STALE_MS ? 'stale' : 'running')
    setGen({ phase: phaseFor(), startedAt, params, error: '' })
    pollRef.current = setInterval(async () => {
      const entries = await loadStoryIndex(appId, token)
      const fresh = entries.find((e) => e && !known.has(e.id))
      if (fresh) {
        stopPolling()
        await deleteJSON(pendingUrl(appId), token, appId)
        setGen({ phase: 'done', startedAt, params, error: '' })
        onReadyRef.current?.(entries)
        // Cosmetic toast auto-hide only — the story is already delivered.
        if (toastRef.current) clearTimeout(toastRef.current)
        toastRef.current = setTimeout(() => {
          setGen((g) => (g.phase === 'done' ? { ...g, phase: 'idle' } : g))
        }, 3500)
        return
      }
      setGen((g) => (g.phase === 'running' && phaseFor() === 'stale' ? { ...g, phase: 'stale' } : g))
    }, GEN_POLL_MS)
  }, [appId, token, stopPolling])

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
.tn-mark {
  flex: 0 0 auto; width: 30px; height: 30px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent); font-size: 16px; font-weight: 700; line-height: 1;
}
.tn-brand-text { min-width: 0; line-height: 1.15; }
.tn-title { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.015em; }
.tn-subtitle {
  display: block; margin-top: 2px; font-size: 12px; font-weight: 500; color: var(--muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tn-header-right { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
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
.tn-brand, .tn-mark, .tn-card-badge,
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

/* Paragraphs in each pane */
.tn-para {
  padding: 12px 18px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
}
.tn-para:last-of-type { border-bottom: none; }
.tn-para-text {
  font-size: 15px; line-height: 1.72; margin: 0 0 12px;
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
   panes, aligned sentence-by-index — gets the soft accent. */
.tn-ctx { background: color-mix(in srgb, var(--accent) 11%, transparent); }
.tn-word.is-hit {
  background: color-mix(in srgb, var(--accent) 34%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 34%, transparent);
}

/* Difficulty rating — a compact one-line chip row after the final paragraph.
   Deliberately quiet: no card chrome, appears exactly when reading ends. */
.tn-rate-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 18px 18px 28px;
  font-size: 13px; color: var(--muted);
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

/* Generation variety chips */
.tn-chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0 4px; }
.tn-chip {
  min-height: 36px; padding: 5px 13px; border-radius: 20px;
  border: 1px solid var(--border); background: var(--surface);
  color: var(--muted); font-size: 13px; font-weight: 600;
  cursor: pointer; font-family: var(--font);
  touch-action: manipulation; user-select: none;
  transition: border-color 0.14s, color 0.14s, background 0.14s;
}
.tn-chip.is-active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-color: var(--accent); color: var(--accent);
}
@media (hover: hover) { .tn-chip:hover { border-color: var(--accent); color: var(--text); } }
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

function StoryReader({ story, onClose, onRate }) {
  const [bLead, setBLead] = useState(false)
  const [rating, setRating] = useState(story.rating || null)
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
  const isSyncingRef = useRef(false)
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

  const handleTopScroll = useCallback(() => {
    if (isSyncingRef.current) return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const topPane = topPaneRef.current
      const botPane = botPaneRef.current
      if (!topPane || !botPane) return
      const srcOffsets = computeParaOffsets(topParaRefs)
      const dstOffsets = computeParaOffsets(botParaRefs)
      const target = computeSyncScrollTop(topPane.scrollTop, srcOffsets, dstOffsets)
      if (target === null) return
      isSyncingRef.current = true
      botPane.scrollTop = target
      requestAnimationFrame(() => { isSyncingRef.current = false })
    })
  }, [topParaRefs, botParaRefs])

  const handleBotScroll = useCallback(() => {
    if (isSyncingRef.current) return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const topPane = topPaneRef.current
      const botPane = botPaneRef.current
      if (!topPane || !botPane) return
      const srcOffsets = computeParaOffsets(botParaRefs)
      const dstOffsets = computeParaOffsets(topParaRefs)
      const target = computeSyncScrollTop(botPane.scrollTop, srcOffsets, dstOffsets)
      if (target === null) return
      isSyncingRef.current = true
      topPane.scrollTop = target
      requestAnimationFrame(() => { isSyncingRef.current = false })
    })
  }, [topParaRefs, botParaRefs])

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

  // After a tap, bring the aligned paragraph in the OTHER pane into view so
  // the highlighted context is visible. Runs post-render (no timers).
  useEffect(() => {
    if (!highlight) return
    const tappedIsTop = (highlight.lang === 'a' && !bLead) || (highlight.lang === 'b' && bLead)
    const otherRef = tappedIsTop ? botParaRefs[highlight.paraIdx] : topParaRefs[highlight.paraIdx]
    if (otherRef?.current) {
      otherRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [highlight, bLead, topParaRefs, botParaRefs])

  const handleRate = useCallback((verdict) => {
    setRating(verdict)
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
          {/* Difficulty rating — one quiet row right after the last paragraph */}
          <div className="tn-rate-row">
            <span className="tn-rate-label">How was it?</span>
            {[
              { verdict: 'too_simple', label: 'Too easy' },
              { verdict: 'just_right', label: 'Just right' },
              { verdict: 'too_complex', label: 'Too hard' },
            ].map(({ verdict, label }) => (
              <button
                key={verdict}
                type="button"
                className={`tn-rate-chip${rating === verdict ? ' is-selected' : ''}`}
                onClick={() => handleRate(verdict)}
                aria-pressed={rating === verdict}
              >
                {label}
              </button>
            ))}
            {rating && <span className="tn-rate-note">Noted — the next story will adapt.</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GenerateSheet — bottom sheet for choosing story topic + mode before generating.
// ---------------------------------------------------------------------------
function GenerateSheet({ onGenerate, onCancel, initialLangA, initialLangB, initialLevel }) {
  const [topicInput, setTopicInput] = useState('')
  const [selectedMode, setSelectedMode] = useState(null)
  const [langA, setLangA] = useState(initialLangA || 'English')
  const [langB, setLangB] = useState(initialLangB || '')
  const [level, setLevel] = useState(CEFR_LEVELS.includes(initialLevel) ? initialLevel : 'B1')

  const CHIPS = [
    { label: 'Surprise me', mode: 'free' },
    { label: 'A classic tale', mode: 'classic' },
    { label: 'Daily life', mode: 'daily_life' },
    { label: 'Travel', mode: 'travel' },
  ]

  const handleChip = (mode) => {
    setSelectedMode((prev) => prev === mode ? null : mode)
  }

  const handleGenerate = () => {
    onGenerate({
      topic: topicInput.trim(),
      mode: selectedMode || 'free',
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
          <label className="tn-setup-label" htmlFor="tn-gen-topic">Topic (optional)</label>
          <input
            id="tn-gen-topic"
            className="tn-input"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            placeholder="e.g. a street musician in Tokyo, friendship, a rainy day"
            autoComplete="off"
          />
        </div>
        <div>
          <div className="tn-setup-label" style={{ marginBottom: 0 }}>Genre</div>
          <div className="tn-chips">
            {CHIPS.map(({ label, mode }) => (
              <button
                key={mode}
                type="button"
                className={`tn-chip${selectedMode === mode ? ' is-active' : ''}`}
                onClick={() => handleChip(mode)}
              >
                {label}
              </button>
            ))}
          </div>
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
        <p className="tn-sheet-title">Delete “{entry.title_a}”?</p>
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
function LibraryTab({ appId, token, online, prefs, onPrefsChange, index, onIndexChange, gen }) {
  const [stories, setStories] = useState({})
  const [activeStory, setActiveStory] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [showGenerateSheet, setShowGenerateSheet] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
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
    const history = [...(prefs.feedback_history || [])]
    // Re-rating the same story replaces its last entry instead of stacking.
    if (history.length && history[history.length - 1]?.story_id === story.id) history.pop()
    history.push({ story_id: story.id, verdict, ts: new Date().toISOString() })
    const next = { ...prefs, feedback_history: history }
    onPrefsChange(next)
    await savePrefs(appId, token, next)
  }, [appId, token, prefs, onPrefsChange])

  const handleSheetGenerate = useCallback(async ({ topic, mode, lang_a, lang_b, level }) => {
    setShowGenerateSheet(false)
    // Persist choices back to prefs so the next sheet opens with the same
    // defaults, and save next_request so generate.sh picks them up.
    const updatedLangA = lang_a || prefs.lang_a
    const updatedLangB = lang_b || prefs.lang_b
    const updatedLevel = CEFR_LEVELS.includes(level) ? level : (prefs.level || 'B1')
    const next = {
      ...prefs,
      lang_a: updatedLangA,
      lang_b: updatedLangB,
      level: updatedLevel,
      next_request: { topic, mode, lang_a: updatedLangA, lang_b: updatedLangB },
    }
    onPrefsChange(next)
    await savePrefs(appId, token, next)
    gen.start(
      { topic, mode, lang_a: updatedLangA, lang_b: updatedLangB, level: updatedLevel },
      index || [],
    )
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
    const nextIndex = removeStoryFromIndex(index || [], entry.id)
    await putJSON(`/api/storage/apps/${appId}/stories/index.json`, token, nextIndex, appId)
    onIndexChange(nextIndex)
    setStories((prev) => {
      if (!(entry.id in prev)) return prev
      const next = { ...prev }
      delete next[entry.id]
      return next
    })
    setDeleting(false)
    setPendingDelete(null)
  }, [appId, token, pendingDelete, index, onIndexChange, flashError])

  const handleRetry = useCallback(async () => {
    const params = gen.params || {}
    await gen.dismiss()
    // Restore next_request — generate.sh clears it after each run, so a
    // retry without this would fall back to the prefs defaults.
    if (params.lang_a && params.lang_b) {
      const next = {
        ...prefs,
        next_request: {
          topic: params.topic || '',
          mode: params.mode || 'free',
          lang_a: params.lang_a,
          lang_b: params.lang_b,
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

  const genBusy = gen.phase === 'running' || gen.phase === 'stale'
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
        {gen.phase === 'running' && <span className="tn-status-hint">Generating story…</span>}
        {gen.phase === 'done' && <span className="tn-status-hint">Story ready!</span>}
        {gen.phase === 'stale' && (
          <>
            <span className="tn-status-hint">Taking longer than expected.</span>
            <span className="tn-stale-actions">
              <button type="button" className="tn-stale-btn" onClick={handleRetry}>Retry</button>
              <button type="button" className="tn-stale-btn" onClick={gen.dismiss}>Dismiss</button>
            </span>
          </>
        )}
        {gen.phase === 'error' && <span className="tn-error-hint">{gen.error}</span>}
        {errorMsg && <span className="tn-error-hint">{errorMsg}</span>}
      </div>

      {index === null ? (
        <div className="tn-loading">
          <div className="tn-spinner" role="status" aria-label="Loading stories" />
          <span>Loading stories…</span>
        </div>
      ) : index.length === 0 ? (
        <div className="tn-empty" style={{ margin: '0 auto' }}>
          <div className="tn-empty-mark" aria-hidden="true">📖</div>
          <div className="tn-empty-title">No stories yet</div>
          <p className="tn-empty-text">
            Press "Generate story" to create your first{' '}
            {prefs.lang_b || 'target language'} story at CEFR&nbsp;
            {adaptLevel(prefs.level || 'B1', prefs.feedback_history)} level.
          </p>
        </div>
      ) : (
        index.map((entry) => (
          <div key={entry.id} className="tn-card">
            <button
              type="button"
              className="tn-card-open"
              onClick={() => openStory(entry)}
            >
              <div className="tn-card-main">
                <div className="tn-card-title">{entry.title_a}</div>
                <div className="tn-card-sub">{entry.title_b} · {entry.lang_a} / {entry.lang_b}</div>
              </div>
              <span className="tn-level-pill">{entry.level}</span>
            </button>
            <button
              type="button"
              className="tn-card-del"
              aria-label={`Delete ${entry.title_a}`}
              onClick={() => setPendingDelete(entry)}
            >
              {TrashIcon}
            </button>
          </div>
        ))
      )}

      {showGenerateSheet && (
        <GenerateSheet
          onGenerate={handleSheetGenerate}
          onCancel={() => setShowGenerateSheet(false)}
          initialLangA={prefs.lang_a}
          initialLangB={prefs.lang_b}
          initialLevel={prefs.level}
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
// Root component. There is no settings screen — languages and level are
// chosen per-generation in the generate sheet (and remembered in prefs), so
// the library IS the app. The story index and the generation engine live
// here because they must survive any view change.
// ---------------------------------------------------------------------------
export default function App({ appId, token }) {
  const [prefs, setPrefs] = useState(null) // null while loading
  const [index, setIndex] = useState(null) // null = loading, [] = empty
  const online = useOnline()
  const gen = useGeneration({ appId, token, onStoryReady: setIndex })

  // Load prefs + story index on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [loadedPrefs, entries] = await Promise.all([
        loadPrefs(appId, token),
        loadStoryIndex(appId, token),
      ])
      if (cancelled) return
      setPrefs(loadedPrefs)
      setIndex(entries)
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
        <div className="tn-brand">
          <span className="tn-mark" aria-hidden="true">T</span>
          <div className="tn-brand-text">
            <h1 className="tn-title">Tandem</h1>
            {prefs.lang_a && prefs.lang_b && (
              <span className="tn-subtitle">{prefs.lang_a} / {prefs.lang_b}</span>
            )}
          </div>
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
          gen={gen}
        />
      </div>
    </div>
  )
}
