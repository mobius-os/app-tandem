import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const storageSource = readFileSync(join(HERE, '..', 'storage.js'), 'utf8')

async function loadStorageModule() {
  const source = storageSource
    .replace(/^import .*$/gm, '')
    .replace(
      '// ---------------------------------------------------------------------------\n// Storage + generation state.',
      `const useState = () => {}; const useEffect = () => {}; const useCallback = (fn) => fn; const useRef = (value) => ({ current: value });\nconst normalizeStory = (value) => value; const signal = () => {}; const signalError = () => {};\n// ---------------------------------------------------------------------------\n// Storage + generation state.`,
    )
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

test('manifest describes Tandem cached reads and queued writes', () => {
  const manifest = JSON.parse(readFileSync(join(HERE, '..', 'mobius.json'), 'utf8'))

  assert.equal(manifest.offline_capable, true)
  assert.deepEqual(
    { reads: manifest.offline.reads, writes: manifest.offline.writes, execution: manifest.offline.execution },
    { reads: true, writes: 'queued', execution: 'none' },
  )
  assert.match(manifest.offline.reads_detail, /generation.*requires a connection/i)
})

test('storage helpers stay on the Mobius offline runtime and preserve queued results', async () => {
  const { deleteJSON, getJSON, putJSON } = await loadStorageModule()
  const calls = []
  globalThis.window = {
    mobius: {
      storage: {
        async get(path) {
          calls.push(['get', path])
          return { title: 'Cached story' }
        },
        async set(path, value) {
          calls.push(['set', path, value])
          return { queued: true }
        },
        async remove(path) {
          calls.push(['remove', path])
          return { queued: true }
        },
      },
    },
  }
  globalThis.fetch = async () => {
    throw new Error('network fallback must not run when runtime storage is present')
  }

  const url = '/api/storage/apps/tandem/stories/cached.json'
  assert.deepEqual(await getJSON(url, 'token', 'tandem'), {
    ok: true,
    data: { title: 'Cached story' },
  })
  assert.deepEqual(await putJSON(url, 'token', { rating: 3 }, 'tandem'), { queued: true })
  assert.deepEqual(await deleteJSON(url, 'token', 'tandem'), { ok: true })
  assert.deepEqual(calls, [
    ['get', 'stories/cached.json'],
    ['set', 'stories/cached.json', { rating: 3 }],
    ['remove', 'stories/cached.json'],
  ])

  delete globalThis.fetch
  delete globalThis.window
})
