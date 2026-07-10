import { useState, useCallback } from 'react'
import { savePrefs } from '../storage.js'
import { signalError } from '../signals.js'

// ---------------------------------------------------------------------------
// SetupView — first-run language collection.
// ---------------------------------------------------------------------------
export function SetupView({ appId, token, prefs, onPrefsChange }) {
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
    let res
    try {
      res = await savePrefs(appId, token, next)
    } catch {
      res = { ok: false }
    }
    setSaving(false)
    if (res && (res.synced || res.queued)) {
      onPrefsChange(next)
    } else {
      setError('Could not save preferences. Try again.')
      signalError('Could not save preferences.', 'setup')
    }
  }, [appId, token, prefs, langA, langB, level, onPrefsChange])

  return (
    <div className="tn-setup-wrap">
      <div className="tn-empty-mark tn-setup-mark" aria-hidden="true">🗣️</div>
      <div className="tn-setup-intro">
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
          name="language_known"
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
          name="language_learning"
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
          name="level"
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

      {error && <div className="tn-error-toast" role="alert" aria-live="assertive">{error}</div>}

      <button
        type="button"
        className="tn-btn tn-btn-primary tn-full-width"
        onClick={handleSave}
        disabled={saving}
        aria-busy={saving}
      >
        {saving ? 'Saving…' : 'Start reading'}
      </button>
    </div>
  )
}
