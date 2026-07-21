import { useState, useEffect, useCallback, useRef } from 'react'
import { adaptLevel, recordFeedback, removeStoryFromIndex, setRatingInIndex, CEFR_LEVELS } from '../story-schema.mjs'
import { normalizeGenProvider, normalizeGenModel } from '../gen-model.mjs'
import { loadStory, savePrefs, putJSON, deleteJSON, GEN_TIMEOUT_MESSAGE } from '../storage.js'
import { signal, signalError } from '../signals.js'
import { RATE_OPTIONS, RATE_LABELS } from '../constants.js'
import { StoryReader } from './StoryReader.jsx'
import { GenerateSheet } from './GenerateSheet.jsx'
import { DeleteConfirmModal } from './DeleteConfirmModal.jsx'
import { SetupView } from './SetupView.jsx'
import { TrashIcon } from './Icons.jsx'

// ---------------------------------------------------------------------------
// LibraryTab — story list + generate button. The story index and the
// generation engine live in App (they must outlive any view), so they arrive
// as props.
// ---------------------------------------------------------------------------
export function LibraryTab({ appId, token, online, prefs, onPrefsChange, onSetupComplete, index, onIndexChange, mutateIndex, gen }) {
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
    // Load the full story before registering shell back nav; a missing/corrupt
    // story should not leave a back sentinel behind.
    let story = stories[entry.id]
    if (!story) {
      story = await loadStory(appId, token, entry.id)
      if (!story) {
        flashError('Could not load story.')
        signalError('Could not load story.', 'story_open')
        return
      }
      setStories((prev) => ({ ...prev, [story.id]: story }))
    }

    if (window.mobius?.nav?.open) {
      const handle = window.mobius.nav.open('tandem-reader', () => {
        navRef.current = null
        setActiveStory(null)
      })
      navRef.current = handle
      await handle.ready?.catch(() => false)
      if (navRef.current !== handle) return
    }
    setActiveStory(story)
    signal('item_opened', {
      type: 'story',
      level: story.level || entry.level || '',
      target_lang: story.lang_b || entry.lang_b || '',
      has_rating: Boolean(story.rating || entry.rating),
    })
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
    const storyRes = await putJSON(`/api/storage/apps/${appId}/stories/${story.id}.json`, token, updated, appId)
    if (storyRes && storyRes.ok === false) {
      signalError('Could not save story rating.', 'story_rate')
    }
    // Mirror onto the index entry so the library card shows the rating
    // (and can edit it) without loading the full story record. Serialized +
    // fresh-read: a delete that landed first leaves no entry to rate (the map
    // is a no-op over the post-delete array), so a rate can't resurrect a
    // deleted story, and a story the server appended mid-rate survives.
    await mutateIndex((fresh) => setRatingInIndex(fresh, story.id, verdict))
    // Re-rating any story replaces its earlier verdict, even when other stories
    // were rated in between. Otherwise one story can skew the last-three sample.
    const history = recordFeedback(
      prefs.feedback_history,
      story.id,
      verdict,
      new Date().toISOString(),
    )
    const next = { ...prefs, feedback_history: history }
    onPrefsChange(next)
    const prefsRes = await savePrefs(appId, token, next)
    if (prefsRes && prefsRes.ok === false) {
      signalError('Could not save rating history.', 'story_rate')
    } else if (!storyRes || storyRes.ok !== false) {
      signal('item_updated', {
        type: 'story',
        action: 'rated',
        verdict,
        level: story.level || '',
        target_lang: story.lang_b || '',
      })
    }
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
        signalError('Could not load story.', 'story_rate')
        return
      }
      setStories((prev) => ({ ...prev, [story.id]: story }))
    }
    await handleRate(story, verdict)
  }, [stories, appId, token, handleRate, flashError])

  const handleSheetGenerate = useCallback(async ({ prompt, lang_a, lang_b, level }) => {
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
    const prefsRes = await savePrefs(appId, token, next)
    // The server-side job reads prefs.json at startup. A queued-only write is
    // safe for ordinary settings but not here: launching now could generate
    // with an older language, level, or prompt.
    if (!prefsRes?.synced) {
      signalError('Could not sync story settings before generation.', 'generation_prefs')
      return {
        ok: false,
        message: 'Could not sync your story settings. Check your connection and try again.',
      }
    }
    onPrefsChange(next)
    signal('generation_started', {
      level: updatedLevel,
      target_lang: updatedLangB || '',
      base_lang: updatedLangA || '',
      provider: genProvider || '',
      has_model: Boolean(genModel),
      has_prompt: Boolean(promptVal),
      library_count: Array.isArray(index) ? index.length : 0,
    })
    await gen.start({ ...params, level: updatedLevel }, index || [])
    setShowGenerateSheet(false)
    return { ok: true }
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
      signalError('Could not delete story.', 'story_delete')
      return
    }
    // Serialized + fresh-read: drop the entry from the FRESHEST index, not a
    // stale snapshot, so a concurrent rate can't re-add it and a story the
    // server appended after this client's last render isn't lost.
    const nextIndex = await mutateIndex((fresh) => removeStoryFromIndex(fresh, entry.id))
    if (nextIndex === null) {
      signalError('Could not remove story from index.', 'story_delete')
    } else {
      signal('item_deleted', { type: 'story' })
    }
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
      const prefsRes = await savePrefs(appId, token, next)
      if (!prefsRes?.synced) {
        flashError('Could not sync story settings. Check your connection and retry.')
        signalError('Could not sync story settings before retry.', 'generation_retry_prefs')
        return
      }
      onPrefsChange(next)
    }
    await gen.dismiss()
    await gen.start(params, index || [])
  }, [gen, prefs, onPrefsChange, appId, token, index, flashError])

  // Show first-run setup if no prefs are set.
  const needsSetup = !prefs.lang_a || !prefs.lang_b

  if (needsSetup) {
    return (
      <SetupView
        appId={appId}
        token={token}
        prefs={prefs}
        onPrefsChange={onPrefsChange}
        onComplete={onSetupComplete}
      />
    )
  }

  const genBusy = gen.phase === 'running'
  const genFailed = gen.phase === 'error'
  const generateDisabled = genBusy || !online

  return (
    <div className="tn-list-wrap">
      {!online && (
        <div className="tn-offline-banner" role="status" aria-live="polite">
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
        {gen.phase === 'done' && (
          <span className="tn-status-hint" role="status" aria-live="polite">Story ready!</span>
        )}
        {errorMsg && (
          <span className="tn-error-hint" role="alert" aria-live="assertive">{errorMsg}</span>
        )}
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
          <div className="tn-empty">
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
