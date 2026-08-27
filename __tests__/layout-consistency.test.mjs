import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const theme = readFileSync(new URL('../theme.js', import.meta.url), 'utf8')
const index = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')

test('the library is centered without constraining the full-bleed reader', () => {
  assert.match(theme, /\.tn-library-shell[^}]*max-width:\s*720px[^}]*margin-inline:\s*auto/s)
  assert.match(theme, /\.tn-header\s*\{[^}]*width:\s*100%[^}]*background:\s*var\(--bg\)/s)
  assert.doesNotMatch(theme, /\.tn-header\s*\{[^}]*border-bottom:\s*1px solid var\(--border\)/s)
  assert.match(theme, /\.tn-header-inner[^}]*max-width:\s*760px[^}]*margin-inline:\s*auto/s)
  assert.doesNotMatch(theme, /\.tn-header-inner\s*\{[^}]*border-bottom/s)
  assert.match(theme, /\.tn-header-inner::after\s*\{[^}]*left:\s*max\(16px,\s*env\(safe-area-inset-left,\s*0px\)\)[^}]*right:\s*max\(16px,\s*env\(safe-area-inset-right,\s*0px\)\)[^}]*background:\s*var\(--border\)/s)
  assert.match(theme, /\.tn-reader\s*\{[^}]*position:\s*absolute;\s*inset:\s*0/s)
  assert.match(index, /className="tn-header-inner"/)
  assert.doesNotMatch(index, /immersive\.holdToToggle/)
  assert.doesNotMatch(theme, /radial-gradient\(ellipse 76% 112%/)
})
