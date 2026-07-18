import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_STACKED_SPLIT_RATIO,
  DEFAULT_WIDE_SPLIT_RATIO,
  STACKED_SPLIT_RATIO_KEY,
  WIDE_SPLIT_RATIO_KEY,
  PREVIOUS_SPLIT_RATIO_KEY,
  LEGACY_SPLIT_RATIO_KEY,
  clampSplitRatio,
  resolveInitialSplitRatios,
  isFirstPaneTapped,
  getLookupCardPlacement,
} from '../reader-layout.mjs'

test('split ratios have independent orientation defaults', () => {
  assert.deepEqual(resolveInitialSplitRatios(), {
    stacked: DEFAULT_STACKED_SPLIT_RATIO,
    wide: DEFAULT_WIDE_SPLIT_RATIO,
  })
})

test('orientation-specific split ratios remain independent', () => {
  const ratios = resolveInitialSplitRatios({
    [STACKED_SPLIT_RATIO_KEY]: '0.7',
    [WIDE_SPLIT_RATIO_KEY]: '0.36',
  })
  assert.deepEqual(ratios, { stacked: 0.7, wide: 0.36 })
})

test('the previous single ratio migrates only to stacked layout', () => {
  const ratios = resolveInitialSplitRatios({ [PREVIOUS_SPLIT_RATIO_KEY]: '0.67' })
  assert.deepEqual(ratios, { stacked: 0.67, wide: DEFAULT_WIDE_SPLIT_RATIO })
})

test('legacy near-half defaults are ignored while deliberate drags migrate to stacked', () => {
  assert.equal(
    resolveInitialSplitRatios({ [LEGACY_SPLIT_RATIO_KEY]: '0.5' }).stacked,
    DEFAULT_STACKED_SPLIT_RATIO,
  )
  assert.equal(resolveInitialSplitRatios({ [LEGACY_SPLIT_RATIO_KEY]: '0.72' }).stacked, 0.72)
})

test('split ratio clamps retain the existing resize bounds', () => {
  assert.equal(clampSplitRatio(0.1), 0.2)
  assert.equal(clampSplitRatio(0.55), 0.55)
  assert.equal(clampSplitRatio(0.9), 0.8)
})

test('language order identifies the first rendered pane in both lead modes', () => {
  assert.equal(isFirstPaneTapped('b', true), true)
  assert.equal(isFirstPaneTapped('a', true), false)
  assert.equal(isFirstPaneTapped('a', false), true)
  assert.equal(isFirstPaneTapped('b', false), false)
})

test('wide lookup placement confines the card to the untapped column', () => {
  assert.deepEqual(
    getLookupCardPlacement({ isWide: true, tappedFirstPane: true, splitRatio: 0.5 }),
    {
      left: 'calc(50% + 15px)',
      right: '12px',
      bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
      maxHeight: 'calc(100% - 24px - env(safe-area-inset-bottom, 0px))',
    },
  )
  assert.deepEqual(
    getLookupCardPlacement({ isWide: true, tappedFirstPane: false, splitRatio: 0.5 }),
    {
      left: '12px',
      right: 'calc(50% + 15px)',
      bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
      maxHeight: 'calc(100% - 24px - env(safe-area-inset-bottom, 0px))',
    },
  )
})

test('stacked lookup placement uses the bottom of the untapped region', () => {
  assert.deepEqual(
    getLookupCardPlacement({ isWide: false, tappedFirstPane: true, splitRatio: 0.58 }),
    {
      left: '12px',
      right: '12px',
      bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
      maxHeight: 'calc(42% - 26.52px - env(safe-area-inset-bottom, 0px))',
    },
  )
  assert.deepEqual(
    getLookupCardPlacement({ isWide: false, tappedFirstPane: false, splitRatio: 0.58 }),
    {
      left: '12px',
      right: '12px',
      bottom: 'calc(42% + 15.48px)',
      maxHeight: 'calc(58% - 27.48px)',
    },
  )
})
