import { useMemo } from 'react'
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
  const inPara = highlight && highlight.paraIdx === paraIdx
  const isTappedPane = inPara && highlight.lang === paneLang

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
            tabIndex={0}
            onClick={() => onWordTap(paraIdx, paneLang, tok)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onWordTap(paraIdx, paneLang, tok) } }}
          >
            {tok.text}
          </span>
        )
      })}
    </p>
  )
}
