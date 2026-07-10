import { useEffect, useMemo, useRef, useState } from 'react'
import { tokenizeParagraph, sentenceCount, alignSentenceIndex, findPhraseTokenRange } from '../text-align.mjs'

// ---------------------------------------------------------------------------
// ParaText — one paragraph rendered as tappable word spans with the inline
// tap highlight. No bottom sheet: the tapped word gets the strong accent,
// its sentence the soft accent, and the OTHER pane shows the aligned
// sentence (index-clamped) plus — when the glossary maps the word — the
// exact translated word, also strong.
//
// `highlight` is the reader-level state:
//   { paraIdx, lang, wordIdx, sentIdx, otherWord }
// This component renders both roles: when its (paraIdx, paneLang) matches
// the tapped side it shows the tapped word; when it's the same paragraph in
// the other pane it shows the aligned context.
//
// Language learners need to be able to SELECT text (copy/paste), so
// user-select stays `text` on .tn-para-text.
// ---------------------------------------------------------------------------
export function ParaText({ text, paraIdx, paneLang, highlight, onWordTap }) {
  const tokens = useMemo(() => tokenizeParagraph(text), [text])
  const wordRefs = useRef([])
  const wordIndices = useMemo(
    () => tokens.filter((tok) => tok.isWord).map((tok) => tok.wordIdx),
    [tokens],
  )
  const firstWordIdx = wordIndices[0] ?? -1
  const [tabWordIdx, setTabWordIdx] = useState(firstWordIdx)
  const inPara = highlight && highlight.paraIdx === paraIdx
  const isTappedPane = inPara && highlight.lang === paneLang

  // One tab stop per paragraph: Tab enters the current word, then arrow keys move
  // word-by-word inside the paragraph. This preserves word lookup without making
  // a long story expose hundreds of separate tab stops.
  useEffect(() => {
    setTabWordIdx((current) => (wordIndices.includes(current) ? current : firstWordIdx))
  }, [wordIndices, firstWordIdx])

  const focusWord = (wordIdx) => {
    if (wordIdx < 0) return
    setTabWordIdx(wordIdx)
    requestAnimationFrame(() => {
      wordRefs.current[wordIdx]?.focus()
    })
  }

  const moveWordFocus = (currentWordIdx, delta) => {
    const pos = wordIndices.indexOf(currentWordIdx)
    if (pos === -1) return
    const nextPos = Math.min(wordIndices.length - 1, Math.max(0, pos + delta))
    focusWord(wordIndices[nextPos])
  }

  const handleWordKeyDown = (e, tok) => {
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault()
        onWordTap(paraIdx, paneLang, tok)
        return
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        moveWordFocus(tok.wordIdx, -1)
        return
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        moveWordFocus(tok.wordIdx, 1)
        return
      case 'Home':
        e.preventDefault()
        focusWord(wordIndices[0])
        return
      case 'End':
        e.preventDefault()
        focusWord(wordIndices[wordIndices.length - 1])
        return
      default:
    }
  }

  let ctxSentIdx = -1
  let strongStart = -1
  let strongEnd = -1
  if (isTappedPane) {
    ctxSentIdx = highlight.sentIdx
    strongStart = strongEnd = highlight.wordIdx
  } else if (inPara) {
    ctxSentIdx = alignSentenceIndex(highlight.sentIdx, sentenceCount(tokens))
    if (highlight.otherWord) {
      const range = findPhraseTokenRange(tokens, highlight.otherWord)
      if (range) { strongStart = range.start; strongEnd = range.end }
    }
  }

  return (
    <p className="tn-para-text">
      {tokens.map((tok, i) => {
        const inCtx = ctxSentIdx >= 0 && tok.sentIdx === ctxSentIdx
        if (!tok.isWord) {
          return inCtx ? <span key={i} className="tn-ctx">{tok.text}</span> : tok.text
        }
        const isHit = strongStart >= 0 && tok.wordIdx >= strongStart && tok.wordIdx <= strongEnd
        const hitClass = isHit
          ? (isTappedPane || highlight?.matchKind === 'glossary' ? ' is-hit' : ' is-guess')
          : ''
        return (
          <span
            key={i}
            className={`tn-word${inCtx ? ' tn-ctx' : ''}${hitClass}`}
            role="button"
            tabIndex={tok.wordIdx === tabWordIdx ? 0 : -1}
            ref={(el) => {
              if (el) wordRefs.current[tok.wordIdx] = el
              else delete wordRefs.current[tok.wordIdx]
            }}
            onClick={() => onWordTap(paraIdx, paneLang, tok)}
            onFocus={() => setTabWordIdx(tok.wordIdx)}
            onKeyDown={(e) => handleWordKeyDown(e, tok)}
          >
            {tok.text}
          </span>
        )
      })}
    </p>
  )
}
