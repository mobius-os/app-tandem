// Unit tests for scroll-sync helpers. Run with:
//   node --test __tests__/scroll-sync.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { computeSyncScrollTop, computeParaOffsets, computeProportionalScrollTop } from '../scroll-sync.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Sync guard: index.jsx ships an INLINED copy of these scroll-sync helpers
// (same pattern as story-schema / gen-model). If the canonical source changes
// but the inline doesn't, the shipped app silently diverges. Assert the
// distinctive function bodies appear verbatim (whitespace-normalised) inside
// index.jsx. computeProportionalScrollTop is the v0.8.0 driver/follower map.
// ---------------------------------------------------------------------------
test('inlined scroll-sync helpers in index.jsx stay in sync with scroll-sync.mjs', () => {
  const norm = (s) => s.replace(/\s+/g, ' ')
  const index = norm(readFileSync(join(HERE, '..', 'index.jsx'), 'utf8'))
  const distinctive = [
    // computeParaOffsets
    'if (!ref || !ref.current) return null',
    'height: ref.current.offsetHeight || 1,',
    // computeSyncScrollTop
    'if (!srcOffsets || !dstOffsets || srcOffsets.length !== dstOffsets.length) return null',
    'if (srcOffsets[i].top <= scrollTop) anchorIdx = i',
    'const frac = Math.min(1, Math.max(0, (scrollTop - src.top) / src.height))',
    'return dst.top + frac * dst.height',
    // computeProportionalScrollTop (the canonical v0.8.0 driver/follower body)
    'const driverMax = driver.scrollHeight - driver.clientHeight',
    'const followerMax = follower.scrollHeight - follower.clientHeight',
    'if (driverMax <= 0 || followerMax <= 0) return null',
    'const ratio = Math.min(1, Math.max(0, driver.scrollTop / driverMax))',
    'return ratio * followerMax',
  ]
  for (const snippet of distinctive) {
    assert.ok(
      index.includes(norm(snippet)),
      `index.jsx inline scroll-sync drifted: missing "${snippet}"`,
    )
  }
})

// ---------------------------------------------------------------------------
// computeSyncScrollTop
// ---------------------------------------------------------------------------
test('computeSyncScrollTop returns null when srcOffsets is null', () => {
  const dst = [{ top: 0, height: 100 }]
  assert.equal(computeSyncScrollTop(0, null, dst), null)
})

test('computeSyncScrollTop returns null when dstOffsets is null', () => {
  const src = [{ top: 0, height: 100 }]
  assert.equal(computeSyncScrollTop(0, src, null), null)
})

test('computeSyncScrollTop returns null when arrays have different lengths', () => {
  const src = [{ top: 0, height: 100 }, { top: 100, height: 100 }]
  const dst = [{ top: 0, height: 200 }]
  assert.equal(computeSyncScrollTop(0, src, dst), null)
})

test('computeSyncScrollTop returns null for empty arrays', () => {
  assert.equal(computeSyncScrollTop(0, [], []), null)
})

test('computeSyncScrollTop at scrollTop=0 with identical offsets returns 0', () => {
  const offsets = [{ top: 0, height: 100 }, { top: 100, height: 100 }]
  const result = computeSyncScrollTop(0, offsets, offsets)
  assert.equal(result, 0)
})

test('computeSyncScrollTop simple mapping: para 0, frac=0.5, dst double height', () => {
  // src: 2 paras at 100px each; dst: 2 paras at 200px each
  const src = [{ top: 0, height: 100 }, { top: 100, height: 100 }]
  const dst = [{ top: 0, height: 200 }, { top: 200, height: 200 }]
  // scrollTop=50 → anchor=0, frac=0.5 → target = 0 + 0.5*200 = 100
  assert.equal(computeSyncScrollTop(50, src, dst), 100)
})

test('computeSyncScrollTop scrolled past first para: anchor is para 1', () => {
  const src = [{ top: 0, height: 100 }, { top: 100, height: 100 }]
  const dst = [{ top: 0, height: 200 }, { top: 200, height: 200 }]
  // scrollTop=150 → anchor=1 (150 >= 100), frac=(150-100)/100=0.5 → target=200+0.5*200=300
  assert.equal(computeSyncScrollTop(150, src, dst), 300)
})

test('computeSyncScrollTop at the very start of para 1 (frac=0)', () => {
  const src = [{ top: 0, height: 100 }, { top: 100, height: 100 }]
  const dst = [{ top: 0, height: 200 }, { top: 200, height: 200 }]
  // scrollTop=100 → anchor=1, frac=0 → target=200
  assert.equal(computeSyncScrollTop(100, src, dst), 200)
})

test('computeSyncScrollTop beyond last para top still returns a valid number', () => {
  const src = [{ top: 0, height: 100 }, { top: 100, height: 100 }]
  const dst = [{ top: 0, height: 200 }, { top: 200, height: 200 }]
  // scrollTop=9999 → anchor=1 (last), frac clamped to 1 → target=200+200=400
  const result = computeSyncScrollTop(9999, src, dst)
  assert.equal(typeof result, 'number')
  assert.ok(result >= 200)
})

test('computeSyncScrollTop handles a single paragraph', () => {
  const src = [{ top: 0, height: 150 }]
  const dst = [{ top: 0, height: 300 }]
  // frac = 75/150 = 0.5 → target = 0 + 0.5*300 = 150
  assert.equal(computeSyncScrollTop(75, src, dst), 150)
})

// ---------------------------------------------------------------------------
// computeProportionalScrollTop — driver/follower extreme alignment
// ---------------------------------------------------------------------------
test('computeProportionalScrollTop maps driver top (0) to follower 0', () => {
  const driver = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 }
  const follower = { scrollTop: 0, scrollHeight: 3000, clientHeight: 400 }
  assert.equal(computeProportionalScrollTop(driver, follower), 0)
})

test('computeProportionalScrollTop maps driver max to follower max', () => {
  // driverMax = 1000-200 = 800; followerMax = 3000-400 = 2600
  const driver = { scrollTop: 800, scrollHeight: 1000, clientHeight: 200 }
  const follower = { scrollTop: 0, scrollHeight: 3000, clientHeight: 400 }
  assert.equal(computeProportionalScrollTop(driver, follower), 2600)
})

test('computeProportionalScrollTop maps the midpoint to the follower midpoint', () => {
  // driverMax = 800; halfway = 400 → ratio 0.5 → 0.5 * 2600 = 1300
  const driver = { scrollTop: 400, scrollHeight: 1000, clientHeight: 200 }
  const follower = { scrollTop: 0, scrollHeight: 3000, clientHeight: 400 }
  assert.equal(computeProportionalScrollTop(driver, follower), 1300)
})

test('computeProportionalScrollTop returns null when the driver is unscrollable', () => {
  const driver = { scrollTop: 0, scrollHeight: 200, clientHeight: 200 }
  const follower = { scrollTop: 0, scrollHeight: 3000, clientHeight: 400 }
  assert.equal(computeProportionalScrollTop(driver, follower), null)
})

test('computeProportionalScrollTop returns null when the follower is unscrollable', () => {
  const driver = { scrollTop: 100, scrollHeight: 1000, clientHeight: 200 }
  const follower = { scrollTop: 0, scrollHeight: 400, clientHeight: 400 }
  assert.equal(computeProportionalScrollTop(driver, follower), null)
})

test('computeProportionalScrollTop clamps overscroll to the follower max', () => {
  // scrollTop beyond max (rubber-band) → ratio clamped to 1 → followerMax
  const driver = { scrollTop: 950, scrollHeight: 1000, clientHeight: 200 }
  const follower = { scrollTop: 0, scrollHeight: 3000, clientHeight: 400 }
  assert.equal(computeProportionalScrollTop(driver, follower), 2600)
})

// ---------------------------------------------------------------------------
// computeParaOffsets
// ---------------------------------------------------------------------------
test('computeParaOffsets returns null if any ref is null', () => {
  const refs = [
    { current: { offsetTop: 0, offsetHeight: 100 } },
    null,
  ]
  assert.equal(computeParaOffsets(refs), null)
})

test('computeParaOffsets returns null if any ref.current is null', () => {
  const refs = [
    { current: { offsetTop: 0, offsetHeight: 100 } },
    { current: null },
  ]
  assert.equal(computeParaOffsets(refs), null)
})

test('computeParaOffsets returns empty array for empty refs', () => {
  assert.deepEqual(computeParaOffsets([]), [])
})

test('computeParaOffsets returns correct top and height from mock elements', () => {
  const refs = [
    { current: { offsetTop: 0, offsetHeight: 80 } },
    { current: { offsetTop: 80, offsetHeight: 120 } },
    { current: { offsetTop: 200, offsetHeight: 60 } },
  ]
  const result = computeParaOffsets(refs)
  assert.deepEqual(result, [
    { top: 0, height: 80 },
    { top: 80, height: 120 },
    { top: 200, height: 60 },
  ])
})

test('computeParaOffsets uses 1 as minimum height when offsetHeight is 0', () => {
  const refs = [
    { current: { offsetTop: 0, offsetHeight: 0 } },
  ]
  const result = computeParaOffsets(refs)
  assert.deepEqual(result, [{ top: 0, height: 1 }])
})
