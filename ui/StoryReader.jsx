import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { sentenceText, stripWordPunct, tokenizeParagraph } from '../text-align.mjs'
import { lookupGlossary } from '../story-schema.mjs'
import { computeParaOffsets, computeSyncScrollTop, computeProportionalScrollTop, clampScrollTargetToView } from '../scroll-sync.mjs'
import { RATE_OPTIONS } from '../constants.js'
import { signal } from '../signals.js'
import { ParaText } from './ParaText.jsx'

const DEFAULT_SPLIT_RATIO = 0.58
const MIN_SPLIT_RATIO = 0.2
const MAX_SPLIT_RATIO = 0.8
const SPLIT_KEY_STEP = 0.03
const SPLIT_KEY_LARGE_STEP = 0.1
const SPLIT_RATIO_KEY = 'tn-split-ratio-v2'
const LEGACY_SPLIT_RATIO_KEY = 'tn-split-ratio'
const WIDE_READER_QUERY = '(min-width: 720px)'

function clampSplitRatio(value) {
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, value))
}

function readInitialSplitRatio() {
  const read = (key) => {
    try {
      const v = parseFloat(localStorage.getItem(key))
      return v >= MIN_SPLIT_RATIO && v <= MAX_SPLIT_RATIO ? v : null
    } catch {
      return null
    }
  }
  const current = read(SPLIT_RATIO_KEY)
  if (current !== null) return current
  const legacy = read(LEGACY_SPLIT_RATIO_KEY)
  // Old installs auto-saved the old 50/50 default, so treat near-half as
  // "not chosen" and move the divider lower. Preserve clearly intentional
  // manual drags.
  if (legacy !== null && (legacy < 0.45 || legacy > 0.55)) return legacy
  return DEFAULT_SPLIT_RATIO
}

function readInitialWideReader() {
  return typeof window !== 'undefined' && window.matchMedia?.(WIDE_READER_QUERY).matches
}

export function StoryReader({ story, onClose, onRate }) {
  // The TARGET language (lang_b, the one being learned) leads by default — it
  // sits in the top pane and titles, with the base language (lang_a) below as
  // the translation aid. The toggle still lets a reader swap which leads.
  const [bLead, setBLead] = useState(true)
  const [rating, setRating] = useState(story.rating || null)
  // The difficulty bar lives OUTSIDE the two language panes (it can't fairly
  // belong to either split). It appears once the reader reaches the end of an
  // UNRATED story; after rating, it shows a brief note and goes away — from
  // then on the rating is edited from the story's library card.
  const [atEnd, setAtEnd] = useState(false)
  const [showNoted, setShowNoted] = useState(false)
  const atEndRef = useRef(false)
  const [splitRatio, setSplitRatio] = useState(readInitialSplitRatio)
  const [wideReader, setWideReader] = useState(readInitialWideReader)
  // Inline word-tap highlight:
  // { paraIdx, lang, wordIdx, sentIdx, sourceWord, otherWord, otherSentence, note, matchKind }
  const [highlight, setHighlight] = useState(null)

  const topPaneRef = useRef(null)
  const botPaneRef = useRef(null)
  const readerBodyRef = useRef(null)
  // Driver/follower sync (replaces the old reciprocal isSyncingRef guard).
  // activePaneRef names the pane the user is actively scrolling ('top' | 'bot').
  // ONLY the active pane's onScroll drives the other; the follower's resulting
  // onScroll is ignored because it isn't the active pane — so there is no
  // reciprocal feedback loop to debounce, and no jitter. A pointer/wheel/touch
  // interaction over a pane (re)claims it as the driver; the claim simply gets
  // reassigned by the next interaction (no timer to expire).
  const activePaneRef = useRef(null)
  const rafRef = useRef(null)

  // Stable per-paragraph ref arrays (one object per paragraph, reused across renders)
  const topParaRefs = useMemo(
    () => story.paragraphs.map(() => ({ current: null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [story.paragraphs.length],
  )
  const botParaRefs = useMemo(
    () => story.paragraphs.map(() => ({ current: null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [story.paragraphs.length],
  )

  // Persist split ratio
  useEffect(() => {
    try { localStorage.setItem(SPLIT_RATIO_KEY, String(splitRatio)) } catch {}
  }, [splitRatio])

  useEffect(() => {
    const media = window.matchMedia?.(WIDE_READER_QUERY)
    if (!media) return undefined
    const update = () => setWideReader(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  // Cleanup rAF on unmount
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  // Latch "reached the end" — once true it stays true for this story, so the
  // rate bar doesn't flicker as the reader scrolls back up.
  const maybeLatchEnd = useCallback((pane) => {
    if (atEndRef.current || !pane) return
    if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 48) {
      atEndRef.current = true
      setAtEnd(true)
    }
  }, [])

  // A story short enough to not scroll counts as "at end" immediately.
  useEffect(() => {
    atEndRef.current = false
    setAtEnd(false)
    setShowNoted(false)
    const raf = requestAnimationFrame(() => {
      const pane = botPaneRef.current
      if (pane && pane.scrollHeight <= pane.clientHeight + 4) {
        atEndRef.current = true
        setAtEnd(true)
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [story.id])

  // The single rAF-throttled sync. Whichever pane is the active driver maps its
  // scroll position PROPORTIONALLY onto the follower (extremes align: top→top,
  // bottom→bottom). The follower's own onScroll re-enters here but is dropped
  // because the follower is never the active pane — the feedback loop is gone,
  // so there is nothing to debounce and nothing to jitter.
  const syncFromActive = useCallback((source) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      // Use the `source` captured when the scroll fired, NOT a live re-read of
      // activePaneRef. A driver-claim (onMouseEnter over the other pane) can land
      // between the handler's gate check and this frame; re-reading the ref here
      // would then sync from the wrong pane — the exact jitter this design fixes.
      if (!source) return
      const topPane = topPaneRef.current
      const botPane = botPaneRef.current
      if (!topPane || !botPane) return
      const driver = source === 'top' ? topPane : botPane
      const follower = source === 'top' ? botPane : topPane
      maybeLatchEnd(driver)
      const target = computeProportionalScrollTop(driver, follower)
      if (target === null) return
      // Instant assignment (no smooth tween): the follower lands in one frame so
      // it can never lag/jitter behind an animation, and its echo onScroll is a
      // no-op anyway (follower isn't the active pane).
      follower.scrollTop = target
    })
  }, [maybeLatchEnd])

  // A pointer/wheel/touch over a pane claims it as the scroll driver. Cheap and
  // idempotent; the next interaction over the other pane simply reassigns it.
  const claimTop = useCallback(() => { activePaneRef.current = 'top' }, [])
  const claimBot = useCallback(() => { activePaneRef.current = 'bot' }, [])

  const handleTopScroll = useCallback(() => {
    // Only drive when the top pane is the active driver; otherwise this is the
    // follower echoing a top-driven (or word-tap-driven) move — ignore it.
    if (activePaneRef.current !== 'top') { maybeLatchEnd(topPaneRef.current); return }
    syncFromActive('top')
  }, [syncFromActive, maybeLatchEnd])

  const handleBotScroll = useCallback(() => {
    if (activePaneRef.current !== 'bot') { maybeLatchEnd(botPaneRef.current); return }
    syncFromActive('bot')
  }, [syncFromActive, maybeLatchEnd])

  const handleDividerPointerDown = useCallback((e) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const handleDividerPointerMove = useCallback((e) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const body = readerBodyRef.current
    if (!body) return
    const rect = body.getBoundingClientRect()
    const newRatio = wideReader
      ? (e.clientX - rect.left) / rect.width
      : (e.clientY - rect.top) / rect.height
    setSplitRatio(clampSplitRatio(newRatio))
  }, [wideReader])

  const handleDividerPointerUp = useCallback((e) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  const handleDividerKeyDown = useCallback((e) => {
    let nextRatio = null
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowLeft':
        nextRatio = (current) => current - SPLIT_KEY_STEP
        break
      case 'ArrowDown':
      case 'ArrowRight':
        nextRatio = (current) => current + SPLIT_KEY_STEP
        break
      case 'PageUp':
        nextRatio = (current) => current - SPLIT_KEY_LARGE_STEP
        break
      case 'PageDown':
        nextRatio = (current) => current + SPLIT_KEY_LARGE_STEP
        break
      case 'Home':
        nextRatio = () => MIN_SPLIT_RATIO
        break
      case 'End':
        nextRatio = () => MAX_SPLIT_RATIO
        break
      default:
        return
    }
    e.preventDefault()
    setSplitRatio((current) => clampSplitRatio(nextRatio(current)))
  }, [])

  const handleWordTap = useCallback((paraIdx, lang, tok) => {
    setHighlight((prev) => {
      // Tapping the same word again clears the highlight.
      if (prev && prev.paraIdx === paraIdx && prev.lang === lang && prev.wordIdx === tok.wordIdx) {
        return null
      }
      const para = story.paragraphs[paraIdx]
      const word = stripWordPunct(tok.text)
      const entry = word ? lookupGlossary(para, word, lang, tok.wordIdx) : null
      const otherText = lang === 'a' ? para.b : para.a
      let otherWord = entry ? (lang === 'a' ? entry.word_b : entry.word_a) : ''
      let otherSentence = ''
      let matchKind = entry ? 'glossary' : 'sentence'
      if (!entry) {
        otherSentence = sentenceText(tokenizeParagraph(otherText), tok.sentIdx)
      }
      signal('word_highlighted', {
        level: story.level || '',
        target_lang: story.lang_b || '',
        has_glossary_match: Boolean(entry),
        match_kind: matchKind,
      })
      return {
        paraIdx,
        lang,
        wordIdx: tok.wordIdx,
        sentIdx: tok.sentIdx,
        sourceWord: word,
        otherWord,
        otherSentence,
        note: entry?.note || '',
        matchKind,
      }
    })
  }, [story])

  // Tapping anywhere that isn't a word clears the highlight.
  const handlePaneClick = useCallback((e) => {
    const target = e.target?.nodeType === Node.ELEMENT_NODE ? e.target : e.target?.parentElement
    if (target?.closest && target.closest('.tn-word')) return
    setHighlight(null)
  }, [])

  // After a tap, bring the aligned paragraph in the OTHER pane into view so the
  // highlighted context is visible — WITHOUT moving the pane the reader just
  // tapped. scrollIntoView walks every scrollable ancestor and so nudges the
  // tapped pane (and the reader body) too; instead we compute the other pane's
  // aligned scrollTop directly (paragraph-offset math — proportional mapping
  // wouldn't land the SAME paragraph, which is the whole point of a word tap)
  // and assign it on that one element. Runs post-render, no timers.
  //
  // Driver/follower keeps this from regressing into a self-nudge: we mark the
  // TAPPED pane as the active driver, then write the OTHER (follower) pane. The
  // follower's resulting onScroll re-enters handleTop/BotScroll, sees it is not
  // the active pane, and is dropped — so this targeted move is never misread as
  // a user scroll that would drag the tapped pane back. The move is instant
  // (no smooth tween) so the follower settles in one frame.
  useEffect(() => {
    if (!highlight) return
    const tappedIsTop = (highlight.lang === 'a' && !bLead) || (highlight.lang === 'b' && bLead)
    const tappedPane = tappedIsTop ? topPaneRef.current : botPaneRef.current
    const otherPane = tappedIsTop ? botPaneRef.current : topPaneRef.current
    const tappedParaRefs = tappedIsTop ? topParaRefs : botParaRefs
    const otherParaRefs = tappedIsTop ? botParaRefs : topParaRefs
    if (!tappedPane || !otherPane) return
    // Anchor from the tapped paragraph's own top so the SAME paragraph aligns
    // in the other pane, regardless of where the tapped pane happens to be
    // scrolled. Fall back to the tapped pane's current scrollTop if the tapped
    // paragraph element isn't measurable yet.
    const tappedParaEl = tappedParaRefs[highlight.paraIdx]?.current
    const anchorTop = tappedParaEl ? tappedParaEl.offsetTop : tappedPane.scrollTop
    const srcOffsets = computeParaOffsets(tappedParaRefs)
    const dstOffsets = computeParaOffsets(otherParaRefs)
    const aligned = computeSyncScrollTop(anchorTop, srcOffsets, dstOffsets)
    if (aligned === null) return
    // Pull the aligned paragraph down off the top edge into the comfortable
    // top-third, clamped so a match near the story start/end can't overscroll.
    // This is what makes both tap directions land the match ON-SCREEN.
    const target = clampScrollTargetToView(aligned, otherPane.clientHeight, otherPane.scrollHeight)
    if (target === null) return
    activePaneRef.current = tappedIsTop ? 'top' : 'bot' // tapped pane is the driver
    otherPane.scrollTop = target // instant; the follower's echo onScroll is ignored
  }, [highlight, bLead, topParaRefs, botParaRefs])

  const handleRate = useCallback((verdict) => {
    setRating(verdict)
    setShowNoted(true)
    onRate(story, verdict)
  }, [story, onRate])

  useEffect(() => {
    if (!showNoted) return undefined
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!reduceMotion) return undefined
    const timer = window.setTimeout(() => setShowNoted(false), 1800)
    return () => window.clearTimeout(timer)
  }, [showNoted])

  const langA = story.lang_a
  const langB = story.lang_b

  return (
    <div className="tn-reader">
      <div className="tn-reader-bar">
        <button type="button" className="tn-reader-back" onClick={onClose}
          aria-label="Back to story list">← Back</button>
        <div className="tn-reader-title-wrap">
          <div className="tn-reader-title">{bLead ? story.title_b : story.title_a}</div>
          <div className="tn-reader-subtitle">{langA} / {langB} · {story.level}</div>
        </div>
        <div className="tn-reader-controls">
          <button
            type="button"
            className="tn-lang-toggle"
            onClick={() => setBLead((v) => !v)}
            aria-label={`Switch leading language. Currently: ${bLead ? langB : langA}`}
            title="Swap which language leads"
          >
            <span>{bLead ? langB : langA}</span>
            <span className="tn-lang-toggle-arrow" aria-hidden="true">⇄</span>
          </button>
        </div>
      </div>

      <div className={`tn-reader-body${wideReader ? ' is-wide' : ''}`} ref={readerBodyRef}>
        {/* TOP PANE */}
        <div
          className="tn-pane tn-pane-top"
          ref={topPaneRef}
          style={{ flexGrow: splitRatio }}
          onScroll={handleTopScroll}
          onClick={handlePaneClick}
          onPointerDown={claimTop}
          onWheel={claimTop}
          onTouchStart={claimTop}
          onMouseEnter={claimTop}
        >
          <div className="tn-story-head">
            <p className="tn-story-title-a">{bLead ? story.title_b : story.title_a}</p>
            <p className="tn-story-title-b">{bLead ? langB : langA}</p>
          </div>
          {story.paragraphs.map((para, i) => (
            <div
              key={i}
              ref={(el) => { topParaRefs[i].current = el }}
              className="tn-para"
            >
              <ParaText
                text={bLead ? para.b : para.a}
                paraIdx={i}
                paneLang={bLead ? 'b' : 'a'}
                highlight={highlight}
                onWordTap={handleWordTap}
              />
            </div>
          ))}
        </div>

        {/* DIVIDER */}
        <div
          className="tn-divider-handle"
          onPointerDown={handleDividerPointerDown}
          onPointerMove={handleDividerPointerMove}
          onPointerUp={handleDividerPointerUp}
          onPointerCancel={handleDividerPointerUp}
          onKeyDown={handleDividerKeyDown}
          aria-label="Resize story panes"
          role="separator"
          aria-orientation={wideReader ? 'vertical' : 'horizontal'}
          aria-valuemin={MIN_SPLIT_RATIO * 100}
          aria-valuemax={MAX_SPLIT_RATIO * 100}
          aria-valuenow={Math.round(splitRatio * 100)}
          aria-valuetext={wideReader
            ? `Left pane ${Math.round(splitRatio * 100)}%, right pane ${Math.round((1 - splitRatio) * 100)}%`
            : `Top pane ${Math.round(splitRatio * 100)}%, bottom pane ${Math.round((1 - splitRatio) * 100)}%`}
          tabIndex={0}
        >
          <div className="tn-divider-pip" aria-hidden="true" />
        </div>

        {/* BOTTOM PANE */}
        <div
          className="tn-pane tn-pane-bottom"
          ref={botPaneRef}
          style={{ flexGrow: 1 - splitRatio }}
          onScroll={handleBotScroll}
          onClick={handlePaneClick}
          onPointerDown={claimBot}
          onWheel={claimBot}
          onTouchStart={claimBot}
          onMouseEnter={claimBot}
        >
          <div className="tn-story-head">
            <p className="tn-story-title-a">{bLead ? story.title_a : story.title_b}</p>
            <p className="tn-story-title-b">{bLead ? langA : langB} (translated)</p>
          </div>
          {story.paragraphs.map((para, i) => (
            <div
              key={i}
              ref={(el) => { botParaRefs[i].current = el }}
              className="tn-para"
            >
              <ParaText
                text={bLead ? para.a : para.b}
                paraIdx={i}
                paneLang={bLead ? 'a' : 'b'}
                highlight={highlight}
                onWordTap={handleWordTap}
              />
            </div>
          ))}
        </div>
      </div>

      {highlight && (
        <div className={`tn-lookup-card is-${highlight.matchKind || 'sentence'}`} role="status" aria-live="polite">
          <div className="tn-lookup-main">
            <span className="tn-lookup-source">{highlight.sourceWord}</span>
            <span className="tn-lookup-arrow" aria-hidden="true">→</span>
            <span className="tn-lookup-target">
              {highlight.otherWord || 'translated sentence'}
            </span>
          </div>
          {highlight.note && <div className="tn-lookup-note">{highlight.note}</div>}
          {highlight.matchKind !== 'glossary' && (
            <div className="tn-lookup-note">
              No exact word match in this story. Here is the aligned sentence instead.
            </div>
          )}
          {highlight.otherSentence && (
            <div className="tn-lookup-sentence">{highlight.otherSentence}</div>
          )}
        </div>
      )}

      {/* Difficulty bar — floats over the reader, belonging to NEITHER pane.
          Shows only when an unrated story has been read to the end; after
          rating it confirms briefly and retires (edit later from the card). */}
      {!rating && atEnd && (
        <div className="tn-rate-bar" role="group" aria-label="Rate story difficulty">
          <span className="tn-rate-label">How was it?</span>
          {RATE_OPTIONS.map(({ verdict, label }) => (
            <button
              key={verdict}
              type="button"
              className="tn-rate-chip"
              onClick={() => handleRate(verdict)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {rating && showNoted && (
        <div
          className="tn-rate-bar is-noted"
          role="status"
          aria-live="polite"
          onAnimationEnd={() => setShowNoted(false)}
        >
          <span className="tn-rate-note">Noted — the next story will adapt.</span>
        </div>
      )}
    </div>
  )
}
