export function signal(name, payload = {}) {
  try {
    window.mobius?.signal?.(name, payload)
  } catch {}
}

export function signalError(message, source) {
  signal('error', {
    message: String(message || 'Unknown error.'),
    source: String(source || 'unknown'),
  })
}
