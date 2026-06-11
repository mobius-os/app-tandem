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
