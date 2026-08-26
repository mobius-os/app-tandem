import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const theme = readFileSync(new URL('../theme.js', import.meta.url), 'utf8')
const index = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')

test('the library is centered without constraining the full-bleed reader', () => {
  assert.match(theme, /\.tn-library-shell[^}]*max-width:\s*720px[^}]*margin-inline:\s*auto/s)
  assert.match(theme, /\.tn-reader\s*\{[^}]*position:\s*absolute;\s*inset:\s*0/s)
  assert.match(index, /className="tn-library-shell"/)
})
