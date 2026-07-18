export const MIN_SPLIT_RATIO = 0.2
export const MAX_SPLIT_RATIO = 0.8
export const DEFAULT_STACKED_SPLIT_RATIO = 0.58
export const DEFAULT_WIDE_SPLIT_RATIO = 0.5

export const STACKED_SPLIT_RATIO_KEY = 'tn-split-ratio-stacked-v3'
export const WIDE_SPLIT_RATIO_KEY = 'tn-split-ratio-wide-v3'
export const PREVIOUS_SPLIT_RATIO_KEY = 'tn-split-ratio-v2'
export const LEGACY_SPLIT_RATIO_KEY = 'tn-split-ratio'

const DIVIDER_SIZE = 6
const LOOKUP_GAP = 12
const SAFE_BOTTOM = 'env(safe-area-inset-bottom, 0px)'

export function clampSplitRatio(value) {
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, value))
}

function parseSplitRatio(value) {
  const parsed = parseFloat(value)
  return parsed >= MIN_SPLIT_RATIO && parsed <= MAX_SPLIT_RATIO ? parsed : null
}

export function resolveInitialSplitRatios(stored = {}) {
  const stackedCurrent = parseSplitRatio(stored[STACKED_SPLIT_RATIO_KEY])
  const wideCurrent = parseSplitRatio(stored[WIDE_SPLIT_RATIO_KEY])
  const previous = parseSplitRatio(stored[PREVIOUS_SPLIT_RATIO_KEY])
  const legacy = parseSplitRatio(stored[LEGACY_SPLIT_RATIO_KEY])

  // The previous single ratio was tuned and persisted for the stacked reader.
  // Wide readers start centered so that inherited phone sizing cannot skew them.
  const intentionalLegacy = legacy !== null && (legacy < 0.45 || legacy > 0.55)
    ? legacy
    : null

  return {
    stacked: stackedCurrent ?? previous ?? intentionalLegacy ?? DEFAULT_STACKED_SPLIT_RATIO,
    wide: wideCurrent ?? DEFAULT_WIDE_SPLIT_RATIO,
  }
}

export function isFirstPaneTapped(lang, bLead) {
  return (lang === 'a' && !bLead) || (lang === 'b' && bLead)
}

function formatNumber(value) {
  return String(Number(value.toFixed(4)))
}

export function getLookupCardPlacement({ isWide, tappedFirstPane, splitRatio }) {
  const ratio = clampSplitRatio(splitRatio)
  const firstPercent = formatNumber(ratio * 100)
  const secondPercent = formatNumber((1 - ratio) * 100)

  if (isWide) {
    const maxHeight = `calc(100% - ${LOOKUP_GAP * 2}px - ${SAFE_BOTTOM})`
    if (tappedFirstPane) {
      return {
        left: `calc(${firstPercent}% + ${formatNumber(LOOKUP_GAP + DIVIDER_SIZE * (1 - ratio))}px)`,
        right: `${LOOKUP_GAP}px`,
        bottom: `calc(${LOOKUP_GAP}px + ${SAFE_BOTTOM})`,
        maxHeight,
      }
    }
    return {
      left: `${LOOKUP_GAP}px`,
      right: `calc(${secondPercent}% + ${formatNumber(LOOKUP_GAP + DIVIDER_SIZE * ratio)}px)`,
      bottom: `calc(${LOOKUP_GAP}px + ${SAFE_BOTTOM})`,
      maxHeight,
    }
  }

  if (tappedFirstPane) {
    return {
      left: `${LOOKUP_GAP}px`,
      right: `${LOOKUP_GAP}px`,
      bottom: `calc(${LOOKUP_GAP}px + ${SAFE_BOTTOM})`,
      maxHeight: `calc(${secondPercent}% - ${formatNumber(LOOKUP_GAP * 2 + DIVIDER_SIZE * (1 - ratio))}px - ${SAFE_BOTTOM})`,
    }
  }

  return {
    left: `${LOOKUP_GAP}px`,
    right: `${LOOKUP_GAP}px`,
    bottom: `calc(${secondPercent}% + ${formatNumber(LOOKUP_GAP + DIVIDER_SIZE * ratio)}px)`,
    maxHeight: `calc(${firstPercent}% - ${formatNumber(LOOKUP_GAP * 2 + DIVIDER_SIZE * ratio)}px)`,
  }
}
