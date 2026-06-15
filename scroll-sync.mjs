// Pure scroll-sync helpers. No React, no DOM globals.
// Inlined into index.jsx (without `export` keywords).
// __tests__/scroll-sync.test.mjs imports from here.

/**
 * Compute per-paragraph cumulative offsets within a scroll pane.
 * paraRefs: array of { current: HTMLElement | null }
 * Returns an array of { top, height } for each paragraph index,
 * or null if any ref is missing.
 */
export function computeParaOffsets(paraRefs) {
  const offsets = []
  for (const ref of paraRefs) {
    if (!ref || !ref.current) return null
    offsets.push({
      top: ref.current.offsetTop,
      height: ref.current.offsetHeight || 1,
    })
  }
  return offsets
}

/**
 * Given the current scrollTop + clientHeight of the source pane,
 * and the computed offset arrays for both panes, compute the target
 * scrollTop for the other pane.
 *
 * Algorithm:
 * 1. Find which paragraph is at the top of the viewport (first para
 *    whose bottom is > scrollTop).
 * 2. Compute the intra-paragraph fraction: how far into that para we are.
 * 3. Map that to the corresponding para in the other pane at the same fraction.
 * Returns a number (target scrollTop) or null if data is missing.
 */
export function computeSyncScrollTop(scrollTop, srcOffsets, dstOffsets) {
  if (!srcOffsets || !dstOffsets || srcOffsets.length !== dstOffsets.length) return null
  const n = srcOffsets.length
  if (n === 0) return null

  // Find anchor paragraph: last para whose top <= scrollTop
  let anchorIdx = 0
  for (let i = 0; i < n; i++) {
    if (srcOffsets[i].top <= scrollTop) anchorIdx = i
    else break
  }

  const src = srcOffsets[anchorIdx]
  const dst = dstOffsets[anchorIdx]

  // Intra-paragraph fraction (clamp 0–1)
  const frac = Math.min(1, Math.max(0, (scrollTop - src.top) / src.height))

  // Target scrollTop: dst para top + same fraction of dst para height
  return dst.top + frac * dst.height
}

/**
 * Proportional driver→follower mapping for synchronized panes.
 *
 * follower.scrollTop = (driver.scrollTop / driverMax) * followerMax
 * where each pane's max scroll = scrollHeight - clientHeight.
 *
 * This is the robust mapping for aligning EXTREMES: driver at 0 maps the
 * follower to 0, driver at its max maps the follower to its max. Paragraph
 * heights differing between the two languages no longer leaves the follower
 * unable to reach the top/bottom (the v0.7.0 anchor-based map could strand
 * the follower because it never forced 0→0 / max→max).
 *
 * `driver`/`follower` are plain measurements: { scrollTop, scrollHeight,
 * clientHeight }. Returns a number (the follower's target scrollTop) or null
 * when either pane isn't scrollable (max <= 0) so callers can no-op safely
 * instead of dividing by zero.
 */
export function computeProportionalScrollTop(driver, follower) {
  if (!driver || !follower) return null
  const driverMax = driver.scrollHeight - driver.clientHeight
  const followerMax = follower.scrollHeight - follower.clientHeight
  // Either pane unscrollable → no meaningful mapping; let the caller skip.
  if (driverMax <= 0 || followerMax <= 0) return null
  const ratio = Math.min(1, Math.max(0, driver.scrollTop / driverMax))
  return ratio * followerMax
}

/**
 * Pad a raw word-tap target so the matched paragraph lands COMFORTABLY in view
 * rather than flush against the pane's top edge.
 *
 * computeSyncScrollTop returns the aligned paragraph's own top as a scrollTop,
 * which pins that paragraph to the very top pixel of the viewport — technically
 * visible but cramped. We pull the target up by a fraction of the viewport
 * height so the paragraph sits ~`margin` of the way down (default a quarter,
 * i.e. high in the top third), then clamp to the scrollable range so a match
 * near the very start can't scroll negative and a match near the end can't
 * overscroll past the bottom. The clamp is what keeps BOTH tap directions
 * on-screen: the symmetric offsetTop fix lands the right paragraph, and this
 * keeps it inside [scrollTop, scrollTop + clientHeight] at either extreme.
 *
 * `rawTarget` is the aligned scrollTop (e.g. from computeSyncScrollTop).
 * Returns a clamped number, or null if measurements are missing/non-finite.
 */
export function clampScrollTargetToView(rawTarget, clientHeight, scrollHeight, margin = 0.25) {
  if (rawTarget == null || !Number.isFinite(rawTarget)) return null
  if (!Number.isFinite(clientHeight) || !Number.isFinite(scrollHeight)) return null
  const maxScroll = Math.max(0, scrollHeight - clientHeight)
  const padded = rawTarget - clientHeight * margin
  return Math.min(maxScroll, Math.max(0, padded))
}
