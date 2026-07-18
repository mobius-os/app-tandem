import { useCallback, useEffect, useRef } from 'react'

// ---------------------------------------------------------------------------
// useModalFocus — the shared focus contract for every .tn-scrim dialog. Mobius
// mini-apps run sandboxed with no native dialog, so each sheet is a plain DOM
// overlay that must manage focus itself: capture the opener at open, move focus
// into the dialog, trap Tab inside it, close on Escape, and restore the opener
// on unmount. `active` lets a destructive sheet block close while a delete is
// in flight (Escape and the focusable set must respect that). `focusFirst`
// chooses the landing control: 'cancel'/'done' for a button the caller refs,
// 'auto' for the dialog's first focusable. The focusable set is recomputed per
// keydown because disabled state (busy) changes which controls are tabbable.
// ---------------------------------------------------------------------------
export function useModalFocus(containerRef, { onClose, allowClose = true, initialFocusRef } = {}) {
  // Capture the opener once, at mount, before focus moves into the dialog — it
  // is the element focus returns to on close. A ref (not state) so it survives
  // every render without becoming a dependency.
  const openerRef = useRef(null)

  useEffect(() => {
    openerRef.current = document.activeElement
    const landing = initialFocusRef?.current
      || containerRef.current?.querySelector(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    landing?.focus()
    return () => {
      const opener = openerRef.current
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
        opener.focus()
      }
    }
    // Mount-only: the opener and initial focus are established once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape closes; Tab is trapped to the dialog's focusable set so focus can't
  // wander to the inert surface behind the scrim. Recomputed per keydown rather
  // than cached: a sheet's controls (and their disabled state) change with the
  // in-flight busy state, so a cached list would trap against stale nodes.
  const onKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      if (allowClose) onClose()
      return
    }
    if (e.key !== 'Tab') return
    const focusable = containerRef.current?.querySelectorAll(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    if (!focusable || focusable.length === 0) {
      // Everything is disabled (mid-action) — keep focus pinned in-dialog.
      e.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const activeEl = document.activeElement
    // Focus can legitimately sit OUTSIDE the focusable list — the landing
    // control may be the dialog container itself (tabIndex -1, used so a
    // sheet can open without popping the mobile keyboard). The browser's
    // default order from there walks the page BEHIND the scrim on Shift+Tab,
    // so route both directions into the list explicitly.
    const inList = Array.prototype.indexOf.call(focusable, activeEl) !== -1
    if (!inList) {
      e.preventDefault()
      ;(e.shiftKey ? last : first).focus()
      return
    }
    if (e.shiftKey && activeEl === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && activeEl === last) {
      e.preventDefault()
      first.focus()
    }
  }, [containerRef, onClose, allowClose])

  return onKeyDown
}
