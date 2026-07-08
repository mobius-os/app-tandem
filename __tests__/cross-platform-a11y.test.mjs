import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const root = (...parts) => join(HERE, '..', ...parts)

const read = (...parts) => readFileSync(root(...parts), 'utf8')

test('local overlays register Mobius shell back targets and await readiness', () => {
  const hook = read('ui', 'useShellBackTarget.js')
  assert.match(hook, /window\.mobius\?\.nav\?\.open/, 'hook must use shell nav.open when available')
  // Register BEFORE paint so a back gesture can't escape the overlay in the
  // frame between mount and effect (useLayoutEffect runs pre-paint, useEffect
  // does not).
  assert.match(hook, /useLayoutEffect\(/, 'hook must register the back target before paint (useLayoutEffect)')
  assert.doesNotMatch(hook, /\buseEffect\(/, 'registration must not use post-paint useEffect')
  // Observe the ready flag per the shell protocol (ready resolves true/false and
  // never rejects, so the hook must reference it, not assume a throw).
  assert.match(hook, /handle\.ready/, 'hook must observe handle.ready per shell protocol')
  assert.match(hook, /handle\.close\?\.\(\)/, 'hook cleanup must close the shell handle')

  const generate = read('ui', 'GenerateSheet.jsx')
  const settings = read('ui', 'SettingsSheet.jsx')
  const deleteModal = read('ui', 'DeleteConfirmModal.jsx')

  assert.match(generate, /useShellBackTarget\('tandem-generate-sheet', onCancel\)/)
  assert.match(settings, /useShellBackTarget\('tandem-settings-sheet', onClose\)/)
  assert.match(deleteModal, /useShellBackTarget\('tandem-delete-modal', onCancel, \{ enabled: !busy \}\)/)
})

test('online state subscribes to Mobius runtime reachability when present', () => {
  const storage = read('storage.js')
  assert.match(storage, /typeof window\.mobius\.onOnlineChange === 'function'/)
  assert.match(storage, /window\.mobius\.onOnlineChange\(\(nextOnline\)/)
  assert.doesNotMatch(storage, /window\.mobius\.onChange/, 'old generic runtime change hook is not the online API')
})

test('fixed bars and sheets account for standalone PWA safe areas', () => {
  const css = read('theme.js')
  assert.match(css, /\.tn-header[\s\S]*env\(safe-area-inset-top/)
  assert.match(css, /\.tn-scrim[\s\S]*env\(safe-area-inset-bottom/)
  assert.match(css, /\.tn-sheet[\s\S]*100dvh/)
  assert.match(css, /\.tn-reader-bar[\s\S]*env\(safe-area-inset-top/)
  assert.match(css, /\.tn-rate-bar[\s\S]*env\(safe-area-inset-bottom/)
})
