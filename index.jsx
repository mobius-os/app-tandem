import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

// ===== INLINE-SCHEMA START (canonical source: story-schema.mjs) =====
// The Möbius installer fetches and compiles ONLY the entry file (index.jsx)
// — a relative `import './story-schema.mjs'` would 404 at compile time.
// story-schema.mjs is the canonical, unit-tested copy; the inline block
// here must stay in sync. __tests__/story-schema.test.mjs asserts this.
// Edit story-schema.mjs first, then mirror the change here.

const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

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
  return { id, title_a, title_b, lang_a, lang_b, level, created, paragraphs }
}

function totalGlossaryCount(story) {
  if (!story || !Array.isArray(story.paragraphs)) return 0
  return story.paragraphs.reduce((n, p) => n + (Array.isArray(p.glossary) ? p.glossary.length : 0), 0)
}

function meetsContentBar(story) {
  if (!story) return false
  return story.paragraphs.length >= 10 && totalGlossaryCount(story) >= 15
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
.tn-tab, .tn-level-pill, .tn-feedback-row {
  user-select: none; -webkit-user-select: none;
}
/* buttons / interactive: manipulation for fast tap, contain for scroll bounce */
.tn-root button, .tn-root select, .tn-root input {
  touch-action: manipulation;
}
.tn-scroll { overscroll-behavior: contain; }
/* end NativeTouch */

/* ---------- App-specific styles ---------- */

/* Tab bar */
.tn-tabs {
  display: flex; gap: 2px; padding: 3px;
  background: var(--surface2, var(--surface));
  border: 1px solid var(--border); border-radius: 10px;
}
.tn-tab {
  min-height: 44px; padding: 6px 14px; border: none; border-radius: 7px;
  background: transparent; color: var(--muted);
  font-family: var(--font); font-size: 13px; font-weight: 650; cursor: pointer;
  transition: background 0.15s, color 0.15s;
  touch-action: manipulation; user-select: none;
}
.tn-tab:hover { color: var(--text); }
.tn-tab.is-active { background: var(--bg); color: var(--text); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18); }

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

/* Draggable divider */
.tn-divider-handle {
  flex: 0 0 auto; height: 20px;
  display: flex; align-items: center; justify-content: center;
  cursor: row-resize; background: var(--surface);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  user-select: none; -webkit-user-select: none; touch-action: none;
}
.tn-divider-pip {
  width: 32px; height: 4px; border-radius: 2px;
  background: var(--border);
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

/* Highlighted paragraph (word tap) */
.tn-para.is-highlighted {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
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

/* Feedback row after last paragraph */
.tn-feedback-row {
  padding: 16px 18px 20px;
  border-top: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 10px;
}
.tn-feedback-label { font-size: 13px; font-weight: 700; color: var(--text); }
.tn-feedback-btns { display: flex; gap: 8px; flex-wrap: wrap; }
.tn-feedback-btn {
  min-height: 38px; padding: 6px 14px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--surface);
  color: var(--muted); font-size: 13px; font-weight: 600;
  cursor: pointer; font-family: var(--font);
  touch-action: manipulation; user-select: none;
  transition: border-color 0.14s, color 0.14s, background 0.14s;
}
@media (hover: hover) { .tn-feedback-btn:hover { border-color: var(--accent); color: var(--text); } }
.tn-feedback-btn:active { transform: scale(0.97); }
.tn-feedback-btn.is-selected {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-color: var(--accent); color: var(--accent);
}
.tn-feedback-confirm { font-size: 12px; color: var(--muted); line-height: 1.5; }

/* Glossary sheet content */
.tn-gloss-word-a { font-size: 18px; font-weight: 800; letter-spacing: -0.01em; margin: 0 0 2px; }
.tn-gloss-word-b { font-size: 14px; color: var(--accent); font-weight: 600; margin: 0 0 10px; }
.tn-gloss-note { font-size: 13px; color: var(--muted); line-height: 1.55; margin: 0 0 4px; }
.tn-gloss-context-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 12px 0 6px; }
.tn-gloss-context-a {
  font-size: 14px; line-height: 1.6; color: var(--text); padding: 10px 12px;
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
  border-radius: 8px; border-left: 3px solid var(--accent);
  margin-bottom: 8px;
}
.tn-gloss-context-b {
  font-size: 13px; line-height: 1.6; color: var(--muted); padding: 10px 12px;
  background: var(--surface); border-radius: 8px;
}
.tn-gloss-highlight { font-weight: 750; color: var(--accent); }

/* First-run / setup state */
.tn-setup-wrap { padding: 24px 18px 32px; display: flex; flex-direction: column; gap: 16px; max-width: 480px; margin: 0 auto; }
.tn-setup-label { font-size: 14px; font-weight: 700; color: var(--text); margin: 0 0 6px; display: block; }
.tn-setup-note { font-size: 12px; color: var(--muted); line-height: 1.5; margin: 0 0 8px; }
.tn-setup-row { margin-bottom: 16px; }

/* Settings */
.tn-settings-wrap { padding: 18px 16px 32px; display: flex; flex-direction: column; gap: 20px; max-width: 480px; }
.tn-section-label { font-size: 14px; font-weight: 700; color: var(--text); margin: 0 0 6px; display: block; }
.tn-section-note { font-size: 12px; color: var(--muted); line-height: 1.5; margin: 0 0 8px; }
.tn-save-row { display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
.tn-toast { font-size: 12px; color: var(--green, #4caf50); }
.tn-error-toast { font-size: 12px; color: var(--danger); }

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
// Utility: split paragraph text into tappable word spans.
// Language learners need to be able to SELECT text (copy/paste), so
// user-select is set to text on .tn-para-text, not suppressed.
// ---------------------------------------------------------------------------
function WordSpan({ text, onTap }) {
  // Split on whitespace but keep the whitespace tokens so re-joining is correct.
  const tokens = text.split(/(\s+)/)
  return (
    <>
      {tokens.map((tok, i) => {
        if (/^\s+$/.test(tok)) return tok
        return (
          <span
            key={i}
            className="tn-word"
            role="button"
            tabIndex={0}
            aria-label={`Look up: ${tok}`}
            onClick={() => onTap(tok)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(tok) } }}
          >
            {tok}
          </span>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// Highlight a word within a paragraph text string.
// Returns an array of React elements.
// ---------------------------------------------------------------------------
function highlightWord(text, word) {
  if (!word || typeof text !== 'string') return [text]
  const re = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const parts = text.split(re)
  return parts.map((part, i) =>
    re.test(part)
      ? <span key={i} className="tn-gloss-highlight">{part}</span>
      : part
  )
}

// ---------------------------------------------------------------------------
// GlossarySheet — bottom sheet for a tapped word.
// ---------------------------------------------------------------------------
function GlossarySheet({ entry, para, langA, langB, tappedLang, onClose }) {
  const wordInA = tappedLang === 'a' ? entry.word_a : entry.word_b
  const wordInB = tappedLang === 'a' ? entry.word_b : entry.word_a
  const leadLang = tappedLang === 'a' ? langA : langB
  const otherLang = tappedLang === 'a' ? langB : langA
  return (
    <div className="tn-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label="Word meaning">
      <div className="tn-sheet" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="tn-gloss-word-a">{wordInA}</p>
          <p className="tn-gloss-word-b">{leadLang} → {otherLang}: {wordInB}</p>
          {entry.note && <p className="tn-gloss-note">{entry.note}</p>}
        </div>
        <div className="tn-gloss-context-label">Context</div>
        <div className="tn-gloss-context-a" aria-label={`${leadLang} paragraph`}>
          {tappedLang === 'a'
            ? highlightWord(para.a, entry.word_a)
            : highlightWord(para.b, entry.word_b)}
        </div>
        <div className="tn-gloss-context-b" aria-label={`${otherLang} paragraph`}>
          {tappedLang === 'a'
            ? highlightWord(para.b, entry.word_b)
            : highlightWord(para.a, entry.word_a)}
        </div>
        <div className="tn-sheet-actions">
          <button className="tn-btn tn-btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// Full-paragraph fallback sheet when the tapped word isn't in the glossary.
function ParagraphSheet({ para, langA, langB, tappedLang, tappedWord, onClose }) {
  return (
    <div className="tn-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label="Paragraph context">
      <div className="tn-sheet" onClick={(e) => e.stopPropagation()}>
        <p className="tn-sheet-title">{tappedLang === 'a' ? langA : langB}</p>
        <div className="tn-gloss-context-a">
          {highlightWord(tappedLang === 'a' ? para.a : para.b, tappedWord)}
        </div>
        <div className="tn-gloss-context-label">{tappedLang === 'a' ? langB : langA}</div>
        <div className="tn-gloss-context-b">
          {tappedLang === 'a' ? para.b : para.a}
        </div>
        <div className="tn-sheet-actions">
          <button className="tn-btn tn-btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
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

function StoryReader({ story, prefs, appId, token, onClose, onFeedback }) {
  const [bLead, setBLead] = useState(false)
  const [sheet, setSheet] = useState(null)
  const [feedbackVerdict, setFeedbackVerdict] = useState(null)
  const [splitRatio, setSplitRatio] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem('tn-split-ratio'))
      if (v >= 0.2 && v <= 0.8) return v
    } catch {}
    return 0.5
  })
  const [highlightedPara, setHighlightedPara] = useState(null)

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

  const handleWordTap = useCallback((paraIdx, word, lang) => {
    setHighlightedPara(paraIdx)
    const para = story.paragraphs[paraIdx]
    const entry = lookupGlossary(para, word)
    if (entry) {
      setSheet({ type: 'glossary', paraIdx, word, lang, entry })
    } else {
      setSheet({ type: 'para', paraIdx, word, lang })
    }
    // Scroll the opposite pane to show the highlighted paragraph
    setTimeout(() => {
      const isTop = (lang === 'a' && !bLead) || (lang === 'b' && bLead)
      const otherRef = isTop ? botParaRefs[paraIdx] : topParaRefs[paraIdx]
      if (otherRef?.current) {
        otherRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }, 0)
  }, [story, bLead, topParaRefs, botParaRefs])

  const closeSheet = useCallback(() => setSheet(null), [])

  const handleFeedback = useCallback(async (verdict) => {
    setFeedbackVerdict(verdict)
    onFeedback(story.id, verdict)
  }, [story.id, onFeedback])

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
        >
          <div className="tn-story-head">
            <p className="tn-story-title-a">{bLead ? story.title_b : story.title_a}</p>
            <p className="tn-story-title-b">{bLead ? langA : langB} (translated)</p>
          </div>
          {story.paragraphs.map((para, i) => (
            <div
              key={i}
              ref={(el) => { topParaRefs[i].current = el }}
              className={`tn-para${highlightedPara === i ? ' is-highlighted' : ''}`}
            >
              <p className="tn-para-text">
                <WordSpan
                  text={bLead ? para.b : para.a}
                  onTap={(w) => handleWordTap(i, w, bLead ? 'b' : 'a')}
                />
              </p>
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
        >
          <div className="tn-story-head">
            <p className="tn-story-title-a">{bLead ? story.title_a : story.title_b}</p>
            <p className="tn-story-title-b">{bLead ? langB : langA}</p>
          </div>
          {story.paragraphs.map((para, i) => (
            <div
              key={i}
              ref={(el) => { botParaRefs[i].current = el }}
              className={`tn-para${highlightedPara === i ? ' is-highlighted' : ''}`}
            >
              <p className="tn-para-text">
                <WordSpan
                  text={bLead ? para.a : para.b}
                  onTap={(w) => handleWordTap(i, w, bLead ? 'a' : 'b')}
                />
              </p>
            </div>
          ))}
          {/* Feedback row — in the bottom pane after the last paragraph */}
          <div className="tn-feedback-row">
            <div className="tn-feedback-label">How was this story for you?</div>
            <div className="tn-feedback-btns">
              {[
                { verdict: 'too_simple', label: 'Too simple' },
                { verdict: 'just_right', label: 'Just right' },
                { verdict: 'too_complex', label: 'Too complex' },
              ].map(({ verdict, label }) => (
                <button
                  key={verdict}
                  type="button"
                  className={`tn-feedback-btn${feedbackVerdict === verdict ? ' is-selected' : ''}`}
                  onClick={() => handleFeedback(verdict)}
                  aria-pressed={feedbackVerdict === verdict}
                >
                  {label}
                </button>
              ))}
            </div>
            {feedbackVerdict && (
              <div className="tn-feedback-confirm">
                Saved! Future stories will adapt to your feedback.
              </div>
            )}
          </div>
        </div>
      </div>

      {sheet && sheet.type === 'glossary' && (
        <GlossarySheet
          entry={sheet.entry}
          para={story.paragraphs[sheet.paraIdx]}
          langA={langA}
          langB={langB}
          tappedLang={sheet.lang}
          onClose={closeSheet}
        />
      )}
      {sheet && sheet.type === 'para' && (
        <ParagraphSheet
          para={story.paragraphs[sheet.paraIdx]}
          langA={langA}
          langB={langB}
          tappedLang={sheet.lang}
          tappedWord={sheet.word}
          onClose={closeSheet}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// GenerateSheet — bottom sheet for choosing story topic + mode before generating.
// ---------------------------------------------------------------------------
function GenerateSheet({ onGenerate, onCancel, initialLangA, initialLangB }) {
  const [topicInput, setTopicInput] = useState('')
  const [selectedMode, setSelectedMode] = useState(null)
  const [langA, setLangA] = useState(initialLangA || 'English')
  const [langB, setLangB] = useState(initialLangB || '')

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
// LibraryTab — story list + generate button.
// ---------------------------------------------------------------------------
function LibraryTab({ appId, token, online, prefs, onPrefsChange }) {
  const [index, setIndex] = useState(null) // null = loading, [] = empty
  const [stories, setStories] = useState({})
  const [activeStory, setActiveStory] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [showGenerateSheet, setShowGenerateSheet] = useState(false)
  const generatingRef = useRef(false)
  const pollRef = useRef(null)
  const navRef = useRef(null)

  // Load story index on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const entries = await loadStoryIndex(appId, token)
      if (!cancelled) setIndex(entries)
    })()
    return () => { cancelled = true }
  }, [appId, token])

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current)
    try { navRef.current?.close?.() } catch {}
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
        setErrorMsg('Could not load story.')
        setTimeout(() => setErrorMsg(''), 3000)
      }
    } else {
      setActiveStory(stories[entry.id])
    }
  }, [appId, token, stories])

  const closeStory = useCallback(() => {
    try { navRef.current?.close?.() } catch {}
    navRef.current = null
    setActiveStory(null)
  }, [])

  const handleFeedback = useCallback(async (storyId, verdict) => {
    const entry = { story_id: storyId, verdict, ts: new Date().toISOString() }
    const next = {
      ...prefs,
      feedback_history: [...(prefs.feedback_history || []), entry],
    }
    onPrefsChange(next)
    await savePrefs(appId, token, next)
  }, [appId, token, prefs, onPrefsChange])

  const handleGenerate = useCallback(async () => {
    if (generatingRef.current) return
    generatingRef.current = true
    setGenerating(true)
    setErrorMsg('')
    setStatusMsg('Generating story…')
    const knownIds = new Set((index || []).map((e) => e.id))
    let started
    try {
      const r = await fetch(`/api/apps/${appId}/run-job`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) {
        setStatusMsg('')
        setErrorMsg(`Could not start generation (HTTP ${r.status}).`)
        setGenerating(false)
        generatingRef.current = false
        return
      }
      started = Date.now()
    } catch {
      setStatusMsg('')
      setErrorMsg('Could not reach the server.')
      setGenerating(false)
      generatingRef.current = false
      return
    }
    // Poll every 4s; give up after 5 minutes.
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const elapsed = Date.now() - started
      const entries = await loadStoryIndex(appId, token)
      const newEntry = entries.find((e) => !knownIds.has(e.id))
      if (newEntry) {
        clearInterval(pollRef.current)
        pollRef.current = null
        setIndex(entries)
        setGenerating(false)
        generatingRef.current = false
        setStatusMsg('Story ready!')
        setTimeout(() => setStatusMsg(''), 3500)
        return
      }
      if (elapsed > 300_000) {
        clearInterval(pollRef.current)
        pollRef.current = null
        setGenerating(false)
        generatingRef.current = false
        setStatusMsg('')
        setErrorMsg('Generation is taking longer than expected. Check back soon.')
      }
    }, 4000)
  }, [appId, token, index])

  const handleSheetGenerate = useCallback(async ({ topic, mode, lang_a, lang_b }) => {
    setShowGenerateSheet(false)
    // Persist lang choice back to prefs so next sheet opens with same defaults.
    // Also save next_request (topic, mode, langs) so generate.sh can use them.
    const updatedLangA = lang_a || prefs.lang_a
    const updatedLangB = lang_b || prefs.lang_b
    const next = {
      ...prefs,
      lang_a: updatedLangA,
      lang_b: updatedLangB,
      next_request: { topic, mode, lang_a: updatedLangA, lang_b: updatedLangB },
    }
    onPrefsChange(next)
    await savePrefs(appId, token, next)
    handleGenerate()
  }, [appId, token, prefs, onPrefsChange, handleGenerate])

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

  const generateDisabled = generating || !online

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
          aria-busy={generating}
        >
          {generating ? 'Generating…' : '+ Generate story'}
        </button>
        {statusMsg && <span className="tn-status-hint">{statusMsg}</span>}
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
          <button
            key={entry.id}
            type="button"
            className="tn-card"
            onClick={() => openStory(entry)}
          >
            <div className="tn-card-main">
              <div className="tn-card-title">{entry.title_a}</div>
              <div className="tn-card-sub">{entry.title_b} · {entry.lang_a} / {entry.lang_b}</div>
            </div>
            <span className="tn-level-pill">{entry.level}</span>
          </button>
        ))
      )}

      {showGenerateSheet && (
        <GenerateSheet
          onGenerate={handleSheetGenerate}
          onCancel={() => setShowGenerateSheet(false)}
          initialLangA={prefs.lang_a}
          initialLangB={prefs.lang_b}
        />
      )}

      {activeStory && (
        <StoryReader
          story={activeStory}
          prefs={prefs}
          appId={appId}
          token={token}
          onClose={closeStory}
          onFeedback={handleFeedback}
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
// SettingsTab — language pair, level, and feedback history summary.
// ---------------------------------------------------------------------------
function SettingsTab({ appId, token, prefs, onPrefsChange }) {
  const [langA, setLangA] = useState(prefs.lang_a || 'English')
  const [langB, setLangB] = useState(prefs.lang_b || '')
  const [level, setLevel] = useState(prefs.level || 'B1')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [errorToast, setErrorToast] = useState('')

  // Sync local state if prefs prop changes externally.
  useEffect(() => {
    setLangA(prefs.lang_a || 'English')
    setLangB(prefs.lang_b || '')
    setLevel(prefs.level || 'B1')
  }, [prefs.lang_a, prefs.lang_b, prefs.level])

  const handleSave = useCallback(async () => {
    const a = langA.trim()
    const b = langB.trim()
    if (!a || !b) { setErrorToast('Both languages are required.'); return }
    setSaving(true)
    setToast(''); setErrorToast('')
    const next = { ...prefs, lang_a: a, lang_b: b, level }
    const res = await savePrefs(appId, token, next)
    setSaving(false)
    if (res && (res.synced || res.queued)) {
      onPrefsChange(next)
      setToast(res.queued ? 'Saved offline — will sync' : 'Saved ✓')
      setTimeout(() => setToast(''), 2500)
    } else {
      setErrorToast('Could not save. Try again.')
    }
  }, [appId, token, prefs, langA, langB, level, onPrefsChange])

  const clearFeedback = useCallback(async () => {
    const next = { ...prefs, feedback_history: [] }
    const res = await savePrefs(appId, token, next)
    if (res && (res.synced || res.queued)) {
      onPrefsChange(next)
      setToast('Feedback history cleared.')
      setTimeout(() => setToast(''), 2500)
    }
  }, [appId, token, prefs, onPrefsChange])

  const history = prefs.feedback_history || []
  const adaptedLevel = adaptLevel(level, history)

  return (
    <div className="tn-settings-wrap">
      <div>
        <label className="tn-section-label" htmlFor="tn-s-lang-a">Language you know</label>
        <input
          id="tn-s-lang-a"
          className="tn-input"
          value={langA}
          onChange={(e) => setLangA(e.target.value)}
          placeholder="e.g. English"
          autoComplete="off"
        />
      </div>
      <div>
        <label className="tn-section-label" htmlFor="tn-s-lang-b">Language you're learning</label>
        <input
          id="tn-s-lang-b"
          className="tn-input"
          value={langB}
          onChange={(e) => setLangB(e.target.value)}
          placeholder="e.g. Spanish"
          autoComplete="off"
        />
      </div>
      <div>
        <label className="tn-section-label" htmlFor="tn-s-level">Starting level</label>
        <p className="tn-section-note">
          Current adapted level based on your feedback:{' '}
          <strong>{adaptedLevel}</strong>
          {adaptedLevel !== level ? ` (base: ${level})` : ''}.
        </p>
        <select
          id="tn-s-level"
          className="tn-select"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        >
          {CEFR_LEVELS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>

      <div className="tn-save-row">
        <button type="button" className="tn-btn tn-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {toast && <span className="tn-toast">{toast}</span>}
        {errorToast && <span className="tn-error-toast">{errorToast}</span>}
      </div>

      <div>
        <label className="tn-section-label">Feedback history</label>
        <p className="tn-section-note">
          {history.length === 0
            ? 'No feedback yet. Rate stories to help Tandem adapt.'
            : `${history.length} feedback entry${history.length > 1 ? 's' : ''}. Next story will be at level ${adaptedLevel}.`}
        </p>
        {history.length > 0 && (
          <button type="button" className="tn-btn tn-btn-secondary" onClick={clearFeedback}>
            Clear feedback history
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root component.
// ---------------------------------------------------------------------------
export default function App({ appId, token }) {
  const [tab, setTab] = useState('library')
  const [prefs, setPrefs] = useState(null) // null while loading
  const online = useOnline()

  // Load prefs on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const loaded = await loadPrefs(appId, token)
      if (!cancelled) setPrefs(loaded)
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
        <div className="tn-header-right">
          <div className="tn-tabs" role="tablist" aria-label="View">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'library'}
              className={`tn-tab${tab === 'library' ? ' is-active' : ''}`}
              onClick={() => setTab('library')}
            >
              Library
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'settings'}
              className={`tn-tab${tab === 'settings' ? ' is-active' : ''}`}
              onClick={() => setTab('settings')}
            >
              Settings
            </button>
          </div>
        </div>
      </header>

      <div className="tn-scroll">
        {tab === 'library'
          ? <LibraryTab
              appId={appId}
              token={token}
              online={online}
              prefs={prefs}
              onPrefsChange={setPrefs}
            />
          : <SettingsTab
              appId={appId}
              token={token}
              prefs={prefs}
              onPrefsChange={setPrefs}
            />
        }
      </div>
    </div>
  )
}
