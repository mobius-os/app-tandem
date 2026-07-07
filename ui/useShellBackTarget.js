import { useEffect, useRef } from 'react'

// Registers a Mobius shell back target for a local overlay. The shell owns the
// actual pop; local close buttons unmount the overlay and close the handle.
export function useShellBackTarget(id, onBack, { enabled = true } = {}) {
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.mobius?.nav?.open) return
    let cancelled = false
    const handle = window.mobius.nav.open(id, () => {
      onBackRef.current?.()
    })

    ;(async () => {
      try { await handle.ready }
      catch {}
      if (cancelled) {
        try { handle.close?.() } catch {}
      }
    })()

    return () => {
      cancelled = true
      try { handle.close?.() } catch {}
    }
  }, [id, enabled])
}
