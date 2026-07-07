export function signal(name, payload = {}) {
  try {
    window.mobius?.signal?.(name, payload)
  } catch {}
}

// Identical errors within this window are emitted once. Retry loops (the 4s
// generation poller, storage retries) would otherwise flood signals.jsonl with
// the same row every tick while offline — Reflection reads the last 5 error
// messages, so one row per distinct failure carries the same information.
const ERROR_DEDUPE_MS = 60_000
const lastErrorAt = new Map()

export function signalError(message, source) {
  const msg = String(message || 'Unknown error.')
  const src = String(source || 'unknown')
  const key = `${src}|${msg}`
  const now = Date.now()
  const prev = lastErrorAt.get(key)
  if (prev != null && now - prev < ERROR_DEDUPE_MS) return
  lastErrorAt.set(key, now)
  signal('error', { message: msg, source: src })
}
