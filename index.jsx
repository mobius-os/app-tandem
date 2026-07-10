import { useState, useEffect, useCallback } from 'react'
import { CSS } from './theme.js'
import {
  useStoryIndex,
  useOnline,
  useGeneration,
  loadPrefs,
  loadStoryIndex,
  savePrefs,
} from './storage.js'
import { migrateGenPrefs } from './gen-model.mjs'
import { signal } from './signals.js'
import { GearIcon } from './ui/Icons.jsx'
import { LibraryTab } from './ui/LibraryTab.jsx'
import { SettingsSheet } from './ui/SettingsSheet.jsx'

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
  const [iconFailed, setIconFailed] = useState(false)
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
      signal('app_ready', { item_count: entries.length })
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
          {!iconFailed && (
            <img
              src={`/api/apps/${appId}/icon?size=64`}
              alt=""
              width={34}
              height={34}
              className="tn-brand-icon"
              onError={() => setIconFailed(true)}
            />
          )}
          {iconFailed && <span className="tn-brand-fallback" aria-hidden="true">·</span>}
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
          appId={appId}
          token={token}
          prefs={prefs}
          onPrefsChange={setPrefs}
          onSelectModel={handleSelectModel}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
