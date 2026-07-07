// Regression for failed story opens: a missing/malformed story must not register
// a shell back target that later consumes the user's next back gesture.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIBRARY = readFileSync(join(HERE, '..', 'ui', 'LibraryTab.jsx'), 'utf8')

test('openStory loads the story before opening shell back navigation', () => {
  const openStoryIdx = LIBRARY.indexOf('const openStory = useCallback')
  const loadIdx = LIBRARY.indexOf('story = await loadStory(appId, token, entry.id)', openStoryIdx)
  const failReturnIdx = LIBRARY.indexOf("flashError('Could not load story.')", loadIdx)
  const navOpenIdx = LIBRARY.indexOf("window.mobius.nav.open('tandem-reader'", openStoryIdx)

  assert.ok(openStoryIdx !== -1, 'could not locate openStory')
  assert.ok(loadIdx !== -1, 'openStory must load uncached stories')
  assert.ok(failReturnIdx !== -1 && failReturnIdx < navOpenIdx,
    'failed story loads must return before shell back navigation opens')
  assert.ok(loadIdx < navOpenIdx, 'story load must happen before nav.open')
})
