import { useState, useRef } from 'react'
import { CEFR_LEVELS } from '../story-schema.mjs'
import { useModalFocus } from './useModalFocus.js'

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
export function GenerateSheet({ onGenerate, onCancel, initialLangA, initialLangB, initialLevel, recentTitle }) {
  const sheetRef = useRef(null)
  const onKeyDown = useModalFocus(sheetRef, { onClose: onCancel })
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
    <div className="tn-scrim" onClick={onCancel} role="dialog" aria-modal="true"
      aria-labelledby="tn-gen-title" onKeyDown={onKeyDown}>
      <div className="tn-sheet" ref={sheetRef} onClick={(e) => e.stopPropagation()}>
        <p className="tn-sheet-title" id="tn-gen-title">Generate a story</p>
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
          <p id="tn-gen-prompt-hint" className="tn-setup-note tn-prompt-hint">
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
