// ---------------------------------------------------------------------------
// Storage + generation state.
//
// Storage helpers route through window.mobius.storage when available (offline
// queuing + SWR), falling back to direct fetch. The generation engine
// (useGeneration) persists a pending record to storage and polls the story
// index so the "Generating…" indicator survives any view unmount or reload.
// useStoryIndex is the single owner of stories/index.json (serialized writes).
// useOnline mirrors the app-news online-detection pattern.
// ---------------------------------------------------------------------------
import { useState, useEffect, useCallback, useRef } from 'react'
import { normalizeStory } from './story-schema.mjs'
import { signal, signalError } from './signals.js'

export function getRuntimeStorage() {
  return (typeof window !== 'undefined' && window.mobius?.storage) || null
}

export function storagePathFromUrl(url, appId) {
  if (appId == null) return null
  const prefix = `/api/storage/apps/${appId}/`
  return url.startsWith(prefix) ? url.slice(prefix.length) : null
}

export async function getJSON(url, token, appId) {
  const path = storagePathFromUrl(url, appId)
  const native = path ? getRuntimeStorage() : null
  if (native && typeof native.get === 'function') {
    try {
      const data = await native.get(path)
      if (data === null || data === undefined) return { ok: false, status: 404 }
      return { ok: true, data }
    } catch {
      signalError('Storage cache read failed.', 'storage.get')
    }
  }
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return { ok: false, status: r.status }
    try { return { ok: true, data: await r.json() } }
    catch {
      signalError('Storage response was not valid JSON.', 'storage.get')
      return { ok: false, status: 500 }
    }
  } catch {
    signalError('Storage read failed.', 'storage.get')
    return { ok: false, status: 0 }
  }
}

export async function putJSON(url, token, obj, appId) {
  const path = storagePathFromUrl(url, appId)
  const native = path ? getRuntimeStorage() : null
  if (native && typeof native.set === 'function') {
    try { return await native.set(path, obj) }
    catch {
      signalError('Storage cache write failed.', 'storage.put')
    }
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
    signalError('Storage write failed.', 'storage.put')
    return { ok: false, status: 0 }
  }
}

export async function deleteJSON(url, token, appId) {
  const path = storagePathFromUrl(url, appId)
  const native = path ? getRuntimeStorage() : null
  if (native) {
    const fn = native.remove || native.del
    if (typeof fn === 'function') {
      try { await fn.call(native, path); return { ok: true } }
      catch {
        signalError('Storage cache delete failed.', 'storage.delete')
      }
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
    signalError('Storage delete failed.', 'storage.delete')
    return { ok: false, status: 0 }
  }
}

// List story entries from storage; returns [] on network failure.
export async function loadStoryIndex(appId, token) {
  const res = await getJSON(
    `/api/storage/apps/${appId}/stories/index.json`, token, appId,
  )
  if (!res.ok) return []
  return Array.isArray(res.data) ? res.data : []
}

export async function loadStory(appId, token, storyId) {
  const res = await getJSON(
    `/api/storage/apps/${appId}/stories/${storyId}.json`, token, appId,
  )
  return res.ok ? normalizeStory(res.data) : null
}

export async function loadPrefs(appId, token) {
  const res = await getJSON(
    `/api/storage/apps/${appId}/prefs.json`, token, appId,
  )
  return res.ok && res.data ? res.data : {}
}

export async function savePrefs(appId, token, prefs) {
  return putJSON(`/api/storage/apps/${appId}/prefs.json`, token, prefs, appId)
}

// Provider/model registry for the settings sheet — platform routes (NOT app
// storage), so they go through fetch directly. Mirrors app-news:
//   - GET /api/auth/providers/models → { claude: [{id,name}], codex: [...] }
//   - GET /api/auth/providers/status → { claude: {authenticated}, ... }
// Each returns null on ANY failure; the sheet then degrades (fallback groups,
// "show everything as connected") and generation proceeds unblocked — this
// preference must never gate the app.
export async function loadProviderModels(token) {
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

export async function loadProviderStatus(token) {
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
export const GEN_POLL_MS = 4000
// generate.sh self-kills at TANDEM_TIMEOUT (300s); past this we stop trusting
// the run and surface an error so a stuck generation never reads as an
// infinite spinner (the owner hit a silent "took forever, nothing generated"
// when a transient rate limit ate the run). Slightly past the script's own
// timeout to give a genuinely-late story room to land first.
export const GEN_TIMEOUT_MS = 6 * 60_000
// The default user-facing message when a run produces no story past the
// timeout and generate.sh left no failure marker to explain why. Rate limits
// are the common cause and self-heal, so the copy invites a retry.
export const GEN_TIMEOUT_MESSAGE =
  'Generation failed — the model may be rate-limited. Try again shortly.'

export function pendingUrl(appId) {
  return `/api/storage/apps/${appId}/generation-pending.json`
}

// generate.sh may drop a failure marker { message } when a run can't produce a
// story (e.g. the agent erred or returned nothing). When present the app reads
// it and surfaces the body verbatim instead of the generic timeout copy.
export function failedUrl(appId) {
  return `/api/storage/apps/${appId}/generation-failed.json`
}

// Pulls a human message out of whatever shape generate.sh wrote: a bare string,
// or an object with a message/body/error field. Falls back to the generic
// timeout copy so the UI always has something concrete to show.
export function failureMessageFrom(data) {
  if (typeof data === 'string' && data.trim()) return data.trim()
  if (data && typeof data === 'object') {
    for (const key of ['message', 'body', 'error']) {
      const v = data[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  }
  return GEN_TIMEOUT_MESSAGE
}

export function useGeneration({ appId, token, onStoryReady }) {
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
  const failGeneration = useCallback(async (startedAt, params, message, source = 'generation') => {
    stopPolling()
    await deleteJSON(pendingUrl(appId), token, appId)
    const elapsed = startedAt ? Math.max(0, Date.now() - startedAt) : 0
    signal('generation_failed', {
      source,
      elapsed_ms: elapsed,
      provider: params?.provider || '',
      has_model: Boolean(params?.model),
    })
    signalError(message, source)
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
        signal('item_created', {
          type: 'story',
          level: fresh.level || params?.level || '',
          target_lang: fresh.lang_b || params?.lang_b || '',
          base_lang: fresh.lang_a || params?.lang_a || '',
          has_prompt: Boolean(params?.prompt),
        })
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
        await failGeneration(startedAt, params, failureMessageFrom(marker.data), 'generation_marker')
        return
      }
      // No story, no marker, but the run has outlived the script's own
      // timeout — treat it as failed instead of an endless spinner.
      if (Date.now() - startedAt > GEN_TIMEOUT_MS) {
        await failGeneration(startedAt, params, GEN_TIMEOUT_MESSAGE, 'generation_timeout')
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
      signal('generation_failed', {
        source: 'run_job_start',
        elapsed_ms: 0,
        provider: params?.provider || '',
        has_model: Boolean(params?.model),
      })
      signalError(failure, 'run_job_start')
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
export function useStoryIndex({ appId, token }) {
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
export function useOnline() {
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
    if (window.mobius && typeof window.mobius.onOnlineChange === 'function') {
      mobiusUnsub = window.mobius.onOnlineChange((nextOnline) => {
        if (typeof nextOnline === 'boolean') setOnline(nextOnline)
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
