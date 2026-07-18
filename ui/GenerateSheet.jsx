import { useState, useRef } from 'react'
import { CEFR_LEVELS } from '../story-schema.mjs'
import { useModalFocus } from './useModalFocus.js'
import { useShellBackTarget } from './useShellBackTarget.js'

// ---------------------------------------------------------------------------
// GenerateSheet — bottom sheet for languages/level + one free-form prompt.
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
export function GenerateSheet({ onGenerate, onCancel, initialLangA, initialLangB, initialLevel, recentTitle }) {
  const sheetRef = useRef(null)
  // Land focus on the SHEET, not its first input: an input focus opens the
  // mobile keyboard the moment the sheet appears, covering half the screen
  // before the reader has even seen the form. Tab still enters the fields.
  const onKeyDown = useModalFocus(sheetRef, { onClose: onCancel, initialFocusRef: sheetRef })
  useShellBackTarget('tandem-generate-sheet', onCancel)
  const [promptInput, setPromptInput] = useState('')
  const [langA, setLangA] = useState(initialLangA || 'English')
  const [langB, setLangB] = useState(initialLangB || '')
  const [level, setLevel] = useState(CEFR_LEVELS.includes(initialLevel) ? initialLevel : 'B1')

  // Examples are TEXT, not buttons. One full phrasing in the placeholder —
  // context-aware "continue <recent title>" when there is one — and a single
  // short hint line below. (A longer example list used to overflow the
  // textarea into a scrollbar, which read as clutter.)
  const promptPlaceholder = recentTitle
    ? `e.g. “continue ‘${recentTitle}’, but darker”`
    : 'e.g. “a travel adventure in Japan”'

  const handleGenerate = () => {
    onGenerate({
      prompt: promptInput.trim(),
      lang_a: langA.trim() || (initialLangA || 'English'),
      lang_b: langB.trim() || (initialLangB || ''),
      level,
    })
  }

  return (
    <div className="tn-scrim" onClick={onCancel} role="dialog" aria-modal="true"
      aria-labelledby="tn-gen-title" onKeyDown={onKeyDown}>
      <div className="tn-sheet" ref={sheetRef} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="tn-gen-head">
          <p className="tn-sheet-title" id="tn-gen-title">Generate a story</p>
          <p className="tn-sheet-sub">Check your reading setup.</p>
        </div>
        <fieldset className="tn-gen-prefs">
          <legend className="tn-visually-hidden">Reading setup</legend>
          <div className="tn-gen-grid">
            <div>
              <label className="tn-setup-label" htmlFor="tn-gen-lang-a">Language you know</label>
              <input
                id="tn-gen-lang-a"
                name="language_known"
                className="tn-input"
                value={langA}
                onChange={(e) => setLangA(e.target.value)}
                placeholder="e.g. English"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="tn-setup-label" htmlFor="tn-gen-lang-b">Learning</label>
              <input
                id="tn-gen-lang-b"
                name="language_learning"
                className="tn-input"
                value={langB}
                onChange={(e) => setLangB(e.target.value)}
                placeholder="e.g. Spanish"
                autoComplete="off"
              />
            </div>
            <div className="tn-gen-grid-wide">
              <label className="tn-setup-label" htmlFor="tn-gen-level">Level</label>
              <select
                id="tn-gen-level"
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
          </div>
        </fieldset>
        <div className="tn-gen-prompt">
          <label className="tn-setup-label" htmlFor="tn-gen-prompt">
            Story idea <span className="tn-field-optional">Optional</span>
          </label>
          <textarea
            id="tn-gen-prompt"
            name="story_prompt"
            className="tn-textarea"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            placeholder={promptPlaceholder}
            rows={2}
            aria-describedby="tn-gen-prompt-hint"
          />
          <p id="tn-gen-prompt-hint" className="tn-setup-note tn-prompt-hint">
            Leave blank for a surprise, or continue a story by name.
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
