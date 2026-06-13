// Concurrency tests for the serialized stories/index.json writer.
//
// Run with: node --test __tests__/index-write-race.test.mjs
// (No React/loader needed — these drive the pure transforms through a state
// machine that mirrors useStoryIndex.mutate's contract: every client write is
// serialized on one promise chain and RE-READS the freshest index immediately
// before applying its pure transform, then PUTs THAT.)
//
// Before the fix, rating and delete each transformed a STALE in-memory copy of
// the whole array and PUT it, so two near-simultaneous mutations clobbered each
// other — a rating right after a delete resurrected the deleted entry, a delete
// right after a rating dropped the rating, and a client mutation built on a
// pre-generation snapshot dropped the server-appended story. These tests pin
// the post-fix behavior.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  removeStoryFromIndex,
  setRatingInIndex,
  buildIndexEntry,
} from '../story-schema.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// Guard: the state machine below models useStoryIndex.mutate. If the real hook
// drops the serialize-and-fresh-read contract, this assertion fails so the
// tests can't silently pass against a parallel re-implementation while the
// shipped app regresses.
test('index.jsx routes index writes through serialized fresh-read mutate', () => {
  const src = readFileSync(join(HERE, '..', 'index.jsx'), 'utf8')
  const norm = src.replace(/\s+/g, ' ')
  const required = [
    'function useStoryIndex(',
    // mutate re-reads fresh inside the queue, refuses a failed read, then PUTs.
    'const fresh = await readFresh()',
    'if (fresh === null) return null',
    'const next = transform(fresh)',
    // readFresh distinguishes a genuine empty index from a failed read.
    "return res.status === 404 ? [] : null",
    // the chain stays alive past a failure.
    'chainRef.current = run.catch(() => {})',
    // both client mutations go through mutate, not a stale in-memory transform.
    'await mutateIndex((fresh) => setRatingInIndex(fresh, story.id, verdict))',
    'await mutateIndex((fresh) => removeStoryFromIndex(fresh, entry.id))',
  ]
  for (const snippet of required) {
    assert.ok(
      norm.includes(snippet.replace(/\s+/g, ' ')),
      `index.jsx is missing the serialized-mutate contract: "${snippet}"`,
    )
  }
})

// In-memory model of stories/index.json. `read()` is the authoritative read
// the queue performs INSIDE each op (returns null on a simulated failure so the
// queue can refuse to clobber). `serverAppend` models generate.sh writing the
// index server-side, out of band of the client queue.
function makeIndexStore(initial = []) {
  let value = initial.map((e) => ({ ...e }))
  let failNextRead = false
  return {
    read: async () => {
      if (failNextRead) { failNextRead = false; return null }
      return value.map((e) => ({ ...e }))
    },
    write: async (next) => { value = next.map((e) => ({ ...e })); return { ok: true } },
    serverAppend: (entry) => { value = [...value, { ...entry }] },
    failOnce: () => { failNextRead = true },
    snapshot: () => value.map((e) => ({ ...e })),
  }
}

// Faithful model of useStoryIndex: serialize every write on one chain; each op
// re-reads fresh, applies the pure transform, and writes — refusing to write a
// failed (null) read.
function makeSerializedWriter(store) {
  let chain = Promise.resolve()
  const mutate = (transform) => {
    const run = chain.then(async () => {
      const fresh = await store.read()
      if (fresh === null) return null
      const next = transform(fresh)
      const res = await store.write(next)
      if (res && res.ok === false) return null
      return next
    })
    chain = run.catch(() => {})
    return run
  }
  return { mutate }
}

const SEED = [
  { id: 'x', title_a: 'X' },
  { id: 'y', title_a: 'Y' },
  { id: 'z', title_a: 'Z' },
]

test('delete then rate (same target): the rate cannot resurrect the deleted entry', async () => {
  const store = makeIndexStore(SEED)
  const { mutate } = makeSerializedWriter(store)
  // Both fire "at once" off the same stale on-screen snapshot.
  const del = mutate((fresh) => removeStoryFromIndex(fresh, 'z'))
  const rate = mutate((fresh) => setRatingInIndex(fresh, 'z', 'just_right'))
  await Promise.all([del, rate])
  // z stays gone — the rate re-read the post-delete index, where z is absent,
  // so setRatingInIndex is a no-op map.
  assert.deepEqual(store.snapshot().map((e) => e.id), ['x', 'y'])
  assert.equal(store.snapshot().find((e) => e.id === 'z'), undefined)
})

test('rate then delete (same target): the delete still wins, no rating revives the entry', async () => {
  const store = makeIndexStore(SEED)
  const { mutate } = makeSerializedWriter(store)
  const rate = mutate((fresh) => setRatingInIndex(fresh, 'y', 'too_complex'))
  const del = mutate((fresh) => removeStoryFromIndex(fresh, 'y'))
  await Promise.all([rate, del])
  assert.deepEqual(store.snapshot().map((e) => e.id), ['x', 'z'])
})

test('rate one, delete another: both land, neither clobbers the other', async () => {
  const store = makeIndexStore(SEED)
  const { mutate } = makeSerializedWriter(store)
  const rate = mutate((fresh) => setRatingInIndex(fresh, 'x', 'just_right'))
  const del = mutate((fresh) => removeStoryFromIndex(fresh, 'z'))
  await Promise.all([rate, del])
  const final = store.snapshot()
  assert.deepEqual(final.map((e) => e.id), ['x', 'y'])
  assert.equal(final.find((e) => e.id === 'x').rating, 'just_right')
})

test('a client mutation does NOT drop a story the server appended just before it', async () => {
  const store = makeIndexStore(SEED)
  const { mutate } = makeSerializedWriter(store)
  // generate.sh finishes and appends a new story to the index server-side,
  // BEFORE the client's queued rate runs (and after the client's last render).
  const newStory = buildIndexEntry({
    id: 'g', title_a: 'Generated', title_b: 'Generada',
    lang_a: 'en', lang_b: 'es', level: 'B1', created: '2026-06-13',
  })
  store.serverAppend(newStory)
  // The rate re-reads the FRESH index (which now includes g) and transforms
  // that, so g survives.
  await mutate((fresh) => setRatingInIndex(fresh, 'x', 'too_simple'))
  assert.deepEqual(store.snapshot().map((e) => e.id), ['x', 'y', 'z', 'g'])
  assert.equal(store.snapshot().find((e) => e.id === 'x').rating, 'too_simple')
})

test('a delete does NOT drop a concurrently server-appended story', async () => {
  const store = makeIndexStore(SEED)
  const { mutate } = makeSerializedWriter(store)
  const newStory = buildIndexEntry({
    id: 'g', title_a: 'Generated', title_b: 'Generada',
    lang_a: 'en', lang_b: 'es', level: 'B1', created: '2026-06-13',
  })
  store.serverAppend(newStory)
  await mutate((fresh) => removeStoryFromIndex(fresh, 'y'))
  assert.deepEqual(store.snapshot().map((e) => e.id), ['x', 'z', 'g'])
})

test('a failed re-read refuses to write — never wipes the index to []', async () => {
  const store = makeIndexStore(SEED)
  const { mutate } = makeSerializedWriter(store)
  store.failOnce()
  const result = await mutate((fresh) => removeStoryFromIndex(fresh, 'z'))
  assert.equal(result, null) // op skipped
  // The index is intact — a transient read blip didn't clobber it with [].
  assert.deepEqual(store.snapshot().map((e) => e.id), ['x', 'y', 'z'])
})

test('serialized ops never interleave a read-modify-write (three rapid mutations)', async () => {
  const store = makeIndexStore(SEED)
  const { mutate } = makeSerializedWriter(store)
  const a = mutate((fresh) => setRatingInIndex(fresh, 'x', 'just_right'))
  const b = mutate((fresh) => removeStoryFromIndex(fresh, 'y'))
  const c = mutate((fresh) => setRatingInIndex(fresh, 'z', 'too_complex'))
  await Promise.all([a, b, c])
  const final = store.snapshot()
  assert.deepEqual(final.map((e) => e.id), ['x', 'z'])
  assert.equal(final.find((e) => e.id === 'x').rating, 'just_right')
  assert.equal(final.find((e) => e.id === 'z').rating, 'too_complex')
})
