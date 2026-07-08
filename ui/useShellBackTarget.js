import { useLayoutEffect, useRef } from 'react'

// Registers a Mobius shell back target for a local overlay (a sheet/modal). The
// shell owns the actual pop; local close buttons unmount the overlay, whose
// cleanup closes the handle.
//
// useLayoutEffect, not useEffect: it runs after the DOM is mutated but BEFORE
// paint, so the nav-push is sent before the overlay is visible — the shell
// installs the back target essentially as the overlay appears, instead of a
// frame later (a useEffect fires post-paint, leaving a brief window where a
// back gesture escaped the overlay). The nav contract (locked by mobius-runtime's
// own tests): handle.ready RESOLVES true (target owned) or false (push refused /
// timed out) — it never rejects. On false there is simply no back target to own;
// the overlay stays up and device back falls through to the shell (best-effort,
// same as the documented reader pattern). We only read the flag to avoid a
// stale close() after the overlay already unmounted.
export function useShellBackTarget(id, onBack, { enabled = true } = {}) {
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useLayoutEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.mobius?.nav?.open) return undefined
    let cancelled = false
    const handle = window.mobius.nav.open(id, () => { onBackRef.current?.() })

    Promise.resolve(handle.ready).then(
      (owned) => { if (cancelled && owned) { try { handle.close?.() } catch {} } },
      () => {},
    )

    return () => {
      cancelled = true
      try { handle.close?.() } catch {}
    }
  }, [id, enabled])
}
