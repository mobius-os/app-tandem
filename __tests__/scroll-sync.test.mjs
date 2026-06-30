// Unit tests for scroll-sync helpers. Run with:
//   node --test __tests__/scroll-sync.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeSyncScrollTop, computeParaOffsets, computeProportionalScrollTop, clampScrollTargetToView } from '../scroll-sync.mjs'

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

// ---------------------------------------------------------------------------
// clampScrollTargetToView — comfortable, on-screen word-tap landing (v0.9.1)
//
// Models the word-tap fix end-to-end: with .tn-pane now position:relative,
// each pane is the offsetParent of its own paragraphs, so computeSyncScrollTop
// returns a PANE-RELATIVE aligned scrollTop for BOTH tap directions. The clamp
// then pads it off the top edge and keeps it inside the scrollable range so the
// matched paragraph is comfortably visible whichever pane was tapped.
//
// Helper for the assertions below: given the aligned paragraph's pane-relative
// top + its height, the final pane scrollTop, and the viewport height, is the
// paragraph (or at least its top) inside the viewport?
// ---------------------------------------------------------------------------
function paraVisible(paraTop, paraHeight, scrollTop, clientHeight) {
  // The paragraph's top must sit within the viewport [scrollTop, scrollTop+clientHeight].
  return paraTop >= scrollTop && paraTop < scrollTop + clientHeight
}

test('clampScrollTargetToView pads the target down off the top edge', () => {
  // aligned target 1000 in a 400px-tall pane, default margin 0.25 → pull up 100
  const out = clampScrollTargetToView(1000, 400, 5000)
  assert.equal(out, 900) // 1000 - 400*0.25, well within [0, 5000-400]
})

test('clampScrollTargetToView clamps a near-start match to 0 (no negative scroll)', () => {
  // aligned 30; padding would go negative → clamp to 0
  const out = clampScrollTargetToView(30, 400, 5000)
  assert.equal(out, 0)
})

test('clampScrollTargetToView clamps a near-end match to maxScroll (no overscroll)', () => {
  // maxScroll = 5000-400 = 4600; aligned 4900 - 100 = 4800 > 4600 → clamp to 4600
  const out = clampScrollTargetToView(4900, 400, 5000)
  assert.equal(out, 4600)
})

test('clampScrollTargetToView returns null on missing/non-finite measurements', () => {
  assert.equal(clampScrollTargetToView(null, 400, 5000), null)
  assert.equal(clampScrollTargetToView(NaN, 400, 5000), null)
  assert.equal(clampScrollTargetToView(100, NaN, 5000), null)
  assert.equal(clampScrollTargetToView(100, 400, NaN), null)
})

test('word-tap landing keeps the match on-screen for BOTH directions (the asymmetry fix)', () => {
  // Two panes, pane-relative offsets (the position:relative fix guarantees this).
  // TOP pane: 6 paras of 200px each (clientHeight 400, scrollHeight 1200).
  // BOTTOM pane: 6 paras of 350px each (clientHeight 350, scrollHeight 2100).
  const topOffsets = Array.from({ length: 6 }, (_, i) => ({ top: i * 200, height: 200 }))
  const botOffsets = Array.from({ length: 6 }, (_, i) => ({ top: i * 350, height: 350 }))
  const TOP = { clientHeight: 400, scrollHeight: 1200 }
  const BOT = { clientHeight: 350, scrollHeight: 2100 }

  for (const tappedIdx of [0, 3, 5]) {
    // --- TOP-tap → land the BOTTOM pane (the direction the owner saw fail) ---
    {
      const anchorTop = topOffsets[tappedIdx].top // tapped para's pane-relative top
      const aligned = computeSyncScrollTop(anchorTop, topOffsets, botOffsets)
      const scrollTop = clampScrollTargetToView(aligned, BOT.clientHeight, BOT.scrollHeight)
      const match = botOffsets[tappedIdx]
      assert.ok(
        paraVisible(match.top, match.height, scrollTop, BOT.clientHeight),
        `TOP-tap para ${tappedIdx}: bottom match top ${match.top} not in [${scrollTop}, ${scrollTop + BOT.clientHeight})`,
      )
    }
    // --- BOTTOM-tap → land the TOP pane (the direction that already worked) ---
    {
      const anchorTop = botOffsets[tappedIdx].top
      const aligned = computeSyncScrollTop(anchorTop, botOffsets, topOffsets)
      const scrollTop = clampScrollTargetToView(aligned, TOP.clientHeight, TOP.scrollHeight)
      const match = topOffsets[tappedIdx]
      assert.ok(
        paraVisible(match.top, match.height, scrollTop, TOP.clientHeight),
        `BOTTOM-tap para ${tappedIdx}: top match top ${match.top} not in [${scrollTop}, ${scrollTop + TOP.clientHeight})`,
      )
    }
  }
})

