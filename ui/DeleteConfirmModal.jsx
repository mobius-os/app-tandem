import { useRef } from 'react'
import { useModalFocus } from './useModalFocus.js'
import { useShellBackTarget } from './useShellBackTarget.js'

// ---------------------------------------------------------------------------
// DeleteConfirmModal — browser modal dialogs (window.confirm) silently no-op
// inside the AppCanvas iframe (sandbox lacks `allow-modals`), so we ship our
// own confirmation.
// ---------------------------------------------------------------------------
export function DeleteConfirmModal({ entry, busy, onConfirm, onCancel }) {
  const sheetRef = useRef(null)
  const cancelRef = useRef(null)
  // Cancel is the safe landing for a destructive confirm; Escape and the
  // backdrop are blocked while the delete is in flight so a stray key can't
  // race the request (mirrors the busy-guarded backdrop onClick).
  const onKeyDown = useModalFocus(sheetRef, {
    onClose: onCancel, allowClose: !busy, initialFocusRef: cancelRef,
  })
  useShellBackTarget('tandem-delete-modal', onCancel, { enabled: !busy })
  return (
    <div className="tn-scrim" onClick={busy ? undefined : onCancel}
      role="dialog" aria-modal="true" aria-labelledby="tn-delete-title" onKeyDown={onKeyDown}>
      <div className="tn-sheet" ref={sheetRef} onClick={(e) => e.stopPropagation()}>
        <p className="tn-sheet-title" id="tn-delete-title">Delete “{entry.title_b}”?</p>
        <p className="tn-sheet-sub">
          This removes the story permanently. It cannot be undone.
        </p>
        <div className="tn-sheet-actions">
          <button type="button" className="tn-btn tn-btn-secondary" ref={cancelRef}
            onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="tn-btn tn-btn-danger"
            onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
