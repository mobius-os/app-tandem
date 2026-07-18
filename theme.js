// Stylesheet — prefix `tn-`. One const, rendered once by the App root.
export const CSS = `
/* mobius-ui:Root v1 — keep in sync; library candidate. Diverge below the marker only. */
.tn-root {
  position: relative;
  display: flex; flex-direction: column;
  height: 100dvh; min-height: 100%; width: 100%; max-width: 100%;
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

/* mobius-ui:Scrollskin v2 — keep in sync; hidden by default, content stays scrollable. */
.tn-scroll,
.tn-sheet,
.tn-pane {
  flex: 1 1 0;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.tn-scroll::-webkit-scrollbar,
.tn-sheet::-webkit-scrollbar,
.tn-pane::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
/* /mobius-ui:Scrollskin */

/* mobius-ui:Focus v1 -- shared keyboard focus ring (WCAG 2.4.7); never bare outline:none */
:where(button,a,input,textarea,select,summary,[role="button"],[tabindex]:not([tabindex="-1"])):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
/* /mobius-ui:Focus */

/* mobius-ui:Header v1 — keep in sync; library candidate. Diverge below the marker only. */
.tn-header {
  flex: 0 0 auto;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  min-height: 48px;
  padding: max(12px, env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) 12px max(16px, env(safe-area-inset-left, 0px));
  background: var(--surface); border-bottom: 1px solid var(--border);
}
.tn-brand { display: flex; align-items: center; gap: 11px; min-width: 0; }
/* Brand mark = the real app icon, downscaled + cached server-side. */
.tn-brand-icon {
  flex: 0 0 auto; width: 34px; height: 34px; border-radius: 8px;
  object-fit: cover; display: block;
}
/* Accent-dot fallback shown (via onError) when the install has no custom icon. */
.tn-brand-fallback {
  flex: 0 0 auto; width: 34px; height: 34px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
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
  margin: 0;
  font-size: 15px; font-weight: 700; color: var(--text);
  letter-spacing: 0;
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
.tn-empty-title { font-size: 17px; font-weight: 700; color: var(--text); letter-spacing: 0; }
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
.tn-card-title { font-size: 15px; font-weight: 700; letter-spacing: 0; }
.tn-card-sub { font-size: 12px; font-weight: 500; color: var(--muted); }
.tn-card-badge {
  flex: 0 0 auto; font-size: 11px; font-weight: 700; padding: 3px 8px;
  border-radius: 6px; background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent); letter-spacing: 0;
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
.tn-btn-primary { background: var(--accent-hover, var(--accent)); border-color: var(--accent-hover, var(--accent)); color: var(--accent-fg); }
@media (hover: hover) { .tn-btn-primary:hover { filter: brightness(0.94); } }
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
.tn-input:focus-visible, .tn-select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
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
.tn-textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* mobius-ui:Sheet v1 — keep in sync; library candidate. Diverge below the marker only. */
.tn-scrim {
  position: absolute; inset: 0; z-index: 100;
  display: flex; align-items: flex-end; justify-content: center;
  padding: max(16px, env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) max(16px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px));
  background: rgba(0, 0, 0, 0.5);
}
.tn-sheet {
  width: 100%; max-width: 480px;
  max-height: min(85vh, calc(100dvh - max(16px, env(safe-area-inset-top, 0px)) - max(16px, env(safe-area-inset-bottom, 0px))));
  overflow-y: auto;
  padding: 24px 24px max(24px, env(safe-area-inset-bottom, 0px));
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 16px 16px 0 0; box-shadow: 0 -4px 8px rgba(0, 0, 0, 0.28);
  display: flex; flex-direction: column; gap: 12px;
  overscroll-behavior: contain;
  scroll-padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
}
@keyframes tn-scrim-in {
  from { background: rgba(0, 0, 0, 0); }
  to { background: rgba(0, 0, 0, 0.5); }
}
@keyframes tn-sheet-in {
  from { opacity: 0.4; transform: translateY(24px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .tn-scrim { animation: tn-scrim-in 0.18s ease-out; }
  .tn-sheet { animation: tn-sheet-in 0.22s cubic-bezier(0.2, 0.8, 0.2, 1); }
}
.tn-sheet-title { margin: 0 0 4px; font-size: 16px; font-weight: 700; letter-spacing: 0; }
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
.tn-list-wrap {
  padding: 14px max(16px, env(safe-area-inset-right, 0px)) max(32px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px));
  display: flex; flex-direction: column; gap: 8px;
}
.tn-divider { height: 1px; background: var(--border); margin: 4px 0 10px; }
.tn-top-row {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-bottom: 6px;
}
.tn-generate-btn {
  min-height: 44px; padding: 10px 16px; border-radius: 10px;
  background: var(--accent-hover, var(--accent)); border: 1px solid var(--accent-hover, var(--accent)); color: var(--accent-fg);
  font-family: var(--font); font-size: 14px; font-weight: 600; cursor: pointer;
  white-space: nowrap; touch-action: manipulation; user-select: none;
  transition: filter 0.14s ease, transform 0.1s ease;
}
@media (hover: hover) { .tn-generate-btn:not(:disabled):hover { filter: brightness(0.94); } }
.tn-generate-btn:active { transform: scale(0.97); }
.tn-generate-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tn-generate-btn:disabled { background: var(--surface); border-color: var(--border); color: var(--muted); cursor: default; pointer-events: none; }
.tn-status-hint { font-size: 12px; color: var(--muted); }
.tn-error-hint { font-size: 12px; color: var(--danger); }
.tn-stale-actions { display: inline-flex; gap: 6px; }
.tn-stale-btn {
  min-height: 44px; padding: 7px 12px; border-radius: 8px;
  border: 1px solid var(--border); background: transparent;
  color: var(--accent); font-family: var(--font); font-size: 12px; font-weight: 650;
  cursor: pointer; touch-action: manipulation; user-select: none;
}
@media (hover: hover) { .tn-stale-btn:hover { border-color: var(--accent); } }
.tn-stale-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Library card: the card itself is a row container; the open affordance and
   the delete affordance are sibling buttons (no nested-button markup). */
.tn-card-open {
  flex: 1; min-width: 0; min-height: 44px; display: flex; align-items: center; gap: 14px;
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
  flex: 0 0 auto; width: 44px; height: 44px; margin-left: auto; margin-right: -16px;
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
  min-height: 44px; padding: 9px 12px; border-radius: 10px;
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
  color: var(--accent); letter-spacing: 0;
}

/* Reader — full-bleed overlay anchored to the app root */
.tn-reader {
  position: absolute; inset: 0; z-index: 5;
  display: flex; flex-direction: column;
  background: var(--bg);
}
.tn-reader-bar {
  display: flex; align-items: center; gap: 10px;
  padding: max(10px, env(safe-area-inset-top, 0px)) max(14px, env(safe-area-inset-right, 0px)) 10px max(14px, env(safe-area-inset-left, 0px));
  border-bottom: 1px solid var(--border);
  background: var(--surface); flex-shrink: 0;
}
.tn-reader-back {
  min-height: 44px; padding: 7px 12px; border-radius: 9px;
  border: 1px solid var(--border); background: var(--bg);
  color: var(--text); font-size: 13px; font-weight: 650;
  cursor: pointer; font-family: var(--font);
  touch-action: manipulation; user-select: none;
}
.tn-reader-back:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
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
  min-height: 44px; padding: 8px 12px; border-radius: 10px;
  border: 1px solid var(--border); background: var(--surface);
  color: var(--text); font-size: 12px; font-weight: 650; cursor: pointer;
  touch-action: manipulation; user-select: none;
}
@media (hover: hover) { .tn-lang-toggle:hover { border-color: var(--accent); } }
.tn-lang-toggle:active { transform: scale(0.96); }
.tn-lang-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
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
  padding: 0 0 max(32px, env(safe-area-inset-bottom, 0px));
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
.tn-pane::-webkit-scrollbar { display: none; width: 0; height: 0; }

.tn-pane-top { border-bottom: 1px solid var(--border); }
.tn-pane-bottom {}

/* Draggable divider: a quiet 6px visual bar; the ::before overlay extends
   the pointer hit area to 44px without adding visual weight. z-index keeps
   the overlay above the adjacent panes so the extra hit area actually
   receives the pointer. (Same recipe as app-latex / app-webstudio.) */
.tn-divider-handle {
  flex: 0 0 6px; height: 6px;
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
  left: 0; right: 0; top: -19px; bottom: -19px;
}
.tn-divider-handle:hover,
.tn-divider-handle:focus-visible {
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
}
.tn-divider-pip {
  width: 30px; height: 3px; border-radius: 999px;
  background: color-mix(in srgb, var(--muted) 52%, transparent);
  pointer-events: none;
}

/* Story head inside each pane */
.tn-story-head {
  padding: 16px 18px 10px;
  border-bottom: 1px solid var(--border-light, var(--border));
}
.tn-story-title-a {
  font-size: 20px; font-weight: 800; letter-spacing: 0;
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

/* Inline tap highlight: context is visibly linked across the two existing
   texts; the tapped word and its verified glossary translation stay strongest. */
.tn-ctx {
  background: color-mix(in srgb, var(--accent) 13%, transparent);
  box-shadow: none;
}
.tn-word.is-hit {
  background: color-mix(in srgb, var(--accent) 52%, transparent);
  color: var(--text); font-weight: 700;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 70%, transparent);
}

/* Lookup card: the verified pair (when the glossary has one), an optional
   note, and ALWAYS the aligned other-language sentence — the tap's payoff is
   reading the word in its translated context without hunting the other pane. */
.tn-lookup-card {
  position: absolute; left: 12px; right: 12px;
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  z-index: 9;
  padding: 10px 13px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 95%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border));
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.26);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  display: flex; flex-direction: column; gap: 4px;
}
@keyframes tn-lookup-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .tn-lookup-card { animation: tn-lookup-in 0.16s ease-out; }
}
.tn-lookup-main {
  display: flex; align-items: baseline; gap: 8px; min-width: 0;
  font-size: 14px; line-height: 1.35;
}
.tn-lookup-source {
  color: var(--muted); min-width: 0; overflow: hidden; text-overflow: ellipsis;
}
.tn-lookup-arrow { color: var(--accent); font-weight: 800; }
.tn-lookup-target {
  color: var(--text); font-weight: 760; min-width: 0;
  overflow: hidden; text-overflow: ellipsis;
}
.tn-lookup-note { color: var(--muted); font-size: 12px; line-height: 1.4; }
/* The aligned sentence from the other pane; the located glossary phrase is
   emphasized inside it, mirroring the in-pane .tn-word.is-hit accent. */
.tn-lookup-sentence {
  color: var(--text); font-size: 13px; line-height: 1.55;
  overflow-wrap: anywhere;
}
.tn-lookup-strong { color: var(--accent); font-weight: 750; }

/* Wide web reader: languages sit left/right with a vertical drag divider.
   Phones and narrow windows keep the more readable stacked arrangement. */
@media (min-width: 720px) {
  .tn-reader-body { flex-direction: row; }
  .tn-pane-top { border-bottom: 0; border-right: 1px solid var(--border); }
  .tn-divider-handle {
    flex: 0 0 6px; width: 6px; height: auto;
    cursor: col-resize;
    border-top: 0; border-bottom: 0;
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
  }
  .tn-divider-handle::before {
    left: -19px; right: -19px; top: 0; bottom: 0;
  }
  .tn-divider-pip { width: 3px; height: 30px; }
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
@media (prefers-reduced-motion: reduce) {
  .tn-rate-bar,
  .tn-rate-bar.is-noted {
    animation: none;
  }
}
.tn-rate-label { font-weight: 600; }
.tn-rate-chip {
  min-height: 44px; padding: 9px 13px; border-radius: 10px;
  border: 1px solid var(--border); background: transparent;
  color: var(--muted); font-size: 12.5px; font-weight: 600;
  cursor: pointer; font-family: var(--font);
  touch-action: manipulation; user-select: none;
  transition: border-color 0.14s, color 0.14s, background 0.14s;
}
@media (hover: hover) { .tn-rate-chip:hover { border-color: var(--accent); color: var(--text); } }
.tn-rate-chip:active { transform: scale(0.96); }
.tn-rate-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
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
.tn-setup-mark { align-self: center; }
.tn-setup-intro { text-align: center; }
.tn-full-width { width: 100%; }
.tn-prompt-hint { margin: 6px 0 0; }
/* Generate sheet: languages pair up side by side; the level select takes the
   full row below them. Compact enough that the prompt stays the visual lead. */
.tn-gen-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
}
.tn-gen-grid-wide { grid-column: 1 / -1; }
.tn-model-fallback-note { margin-top: 8px; }
.tn-settings-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(96px, 0.55fr);
  gap: 10px;
}
.tn-settings-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.tn-settings-field > span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;
}
@media (max-width: 560px) {
  .tn-settings-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* Toasts + destructive button */
.tn-error-toast { font-size: 12px; color: var(--danger); }
.tn-btn-danger { background: var(--danger); border-color: var(--danger); color: var(--accent-fg); }
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

/* Scrollskin lives in the shared mobius-ui:Scrollskin block above. */

/* Settings sheet — provider-grouped model picker (mirrors app-news) */
.tn-model-list { display: flex; flex-direction: column; gap: 10px; }
.tn-model-group { display: flex; flex-direction: column; gap: 6px; }
.tn-model-group-header {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 600;
  text-transform: none; letter-spacing: 0;
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
