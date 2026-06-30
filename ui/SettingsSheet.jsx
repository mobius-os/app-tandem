import { useState, useEffect, useRef } from 'react'
import { FALLBACK_GROUPS, normalizeGenProvider, normalizeGenModel, buildProviderGroups } from '../gen-model.mjs'
import { loadProviderModels, loadProviderStatus } from '../storage.js'
import { useModalFocus } from './useModalFocus.js'

// ---------------------------------------------------------------------------
// SettingsSheet — the app's one settings surface (everything else moved into
// the generate sheet). Holds only the story-generation agent: a provider-grouped
// model picker (Claude / OpenAI Codex), matching app-news. Models are fetched
// from `GET /api/auth/providers/models`; provider connection state from
// `GET /api/auth/providers/status`. A tap selects AND persists immediately
// (prefs.gen_provider + prefs.gen_model); Done just closes. Endpoint failure
// degrades to FALLBACK_GROUPS / "Default only" — never blocks anything.
// ---------------------------------------------------------------------------
export function SettingsSheet({ token, prefs, onSelectModel, onClose }) {
  const sheetRef = useRef(null)
  const doneRef = useRef(null)
  // Land on Done, not the first model radio: this is a settings surface, not
  // a prompt for a choice, so the safe exit should hold focus (parallels news).
  const onKeyDown = useModalFocus(sheetRef, { onClose, initialFocusRef: doneRef })
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
    <div className="tn-scrim" onClick={onClose} role="dialog" aria-modal="true"
      aria-labelledby="tn-settings-title" onKeyDown={onKeyDown}>
      <div className="tn-sheet" ref={sheetRef} onClick={(e) => e.stopPropagation()}>
        <p className="tn-sheet-title" id="tn-settings-title">Settings</p>
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
          <button type="button" className="tn-btn tn-btn-primary" ref={doneRef} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
