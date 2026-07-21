// Pure story-schema helpers imported by the UI and the unit tests.
// No React, no I/O.
import {
  findPhraseTokenRangeAt,
  stripWordPunct,
  tokenizeParagraph,
  tokensLooselyMatch,
} from './text-align.mjs'

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

// Difficulty verdicts a reader can give a story. Stored both on the story
// record (story.rating) and in prefs.feedback_history; generate.sh feeds the
// recent ones back into the next generation prompt.
export const STORY_RATINGS = ['too_simple', 'just_right', 'too_complex']

// Keep one current difficulty verdict per story. A reader may re-rate an older
// story after rating newer ones; removing every prior record for that story
// prevents one story from being counted twice in the last-three adaptation.
export function recordFeedback(history, storyId, verdict, ts) {
  const current = Array.isArray(history) ? history : []
  const next = current.filter((entry) => !(entry && entry.story_id === storyId))
  next.push({ story_id: storyId, verdict, ts })
  return next
}

// Return the next CEFR level up or down from the given level.
// Used to adapt difficulty based on feedback history.
export function adaptLevel(currentLevel, feedbackHistory) {
  if (!Array.isArray(feedbackHistory) || feedbackHistory.length === 0) {
    return currentLevel
  }
  // Look at the last 3 feedback entries to compute a signal.
  const recent = feedbackHistory.slice(-3)
  let score = 0
  for (const entry of recent) {
    if (entry.verdict === 'too_simple') score += 1
    else if (entry.verdict === 'too_complex') score -= 1
    // 'just_right' contributes 0
  }
  const idx = CEFR_LEVELS.indexOf(currentLevel)
  if (idx === -1) return currentLevel // unknown level — leave unchanged
  if (score > 0) return CEFR_LEVELS[Math.min(idx + 1, CEFR_LEVELS.length - 1)]
  if (score < 0) return CEFR_LEVELS[Math.max(idx - 1, 0)]
  return currentLevel
}

// Find the glossary entry for the exact occurrence a reader tapped. Lookup is
// directional (only the term for the tapped language is considered) and
// occurrence-aware: a common word inside "a hundred" must not make every other
// "a" in the paragraph resolve to that entry. Slash-separated alternatives in
// generated terms ("figures / numbers") are checked independently.
export function lookupGlossary(para, word, lang, wordIdx) {
  if (!para || !Array.isArray(para.glossary)) return null
  if (typeof word !== 'string' || !word.trim()) return null
  if (lang !== 'a' && lang !== 'b') return null
  if (!Number.isInteger(wordIdx) || wordIdx < 0) return null
  const needle = stripWordPunct(word)
  if (!needle) return null
  const text = typeof para[lang] === 'string' ? para[lang] : ''
  const tokens = tokenizeParagraph(text)
  const tappedToken = tokens.find((token) => token.isWord && token.wordIdx === wordIdx)
  if (!tappedToken || !tokensLooselyMatch(tappedToken.text, needle)) return null
  const termKey = lang === 'a' ? 'word_a' : 'word_b'
  return para.glossary.find((entry) => {
    if (typeof entry?.[termKey] !== 'string') return false
    return entry[termKey]
      .split(/\s*\/\s*/)
      .some((alternative) => Boolean(findPhraseTokenRangeAt(tokens, alternative, wordIdx)))
  }) || null
}

// Validate a parsed story object, returning a normalized version or null.
// Accepts stories from storage (they may have been written by older code).
// LENIENT BY DESIGN: optional fields (glossary, rating) may be absent — a
// read-time validator that requires them would brick the existing library.
export function normalizeStory(story) {
  if (!story || typeof story !== 'object') return null
  const id = typeof story.id === 'string' ? story.id.trim() : ''
  if (!id) return null
  const title_a = typeof story.title_a === 'string' ? story.title_a.trim() : ''
  const title_b = typeof story.title_b === 'string' ? story.title_b.trim() : ''
  if (!title_a || !title_b) return null
  const lang_a = typeof story.lang_a === 'string' ? story.lang_a.trim() : ''
  const lang_b = typeof story.lang_b === 'string' ? story.lang_b.trim() : ''
  if (!lang_a || !lang_b) return null
  const level = CEFR_LEVELS.includes(story.level) ? story.level : 'B1'
  const created = typeof story.created === 'string' ? story.created.trim() : ''
  const paragraphs = []
  for (const p of Array.isArray(story.paragraphs) ? story.paragraphs : []) {
    if (!p || typeof p !== 'object') continue
    const a = typeof p.a === 'string' ? p.a.trim() : ''
    const b = typeof p.b === 'string' ? p.b.trim() : ''
    if (!a || !b) continue
    const glossary = []
    for (const g of Array.isArray(p.glossary) ? p.glossary : []) {
      if (!g || typeof g !== 'object') continue
      const word_a = typeof g.word_a === 'string' ? g.word_a.trim() : ''
      const word_b = typeof g.word_b === 'string' ? g.word_b.trim() : ''
      if (!word_a || !word_b) continue
      const entry = { word_a, word_b }
      if (typeof g.note === 'string' && g.note.trim()) entry.note = g.note.trim()
      glossary.push(entry)
    }
    paragraphs.push({ a, b, glossary })
  }
  if (paragraphs.length < 1) return null
  const normalized = { id, title_a, title_b, lang_a, lang_b, level, created, paragraphs }
  const summary = typeof story.summary === 'string' ? story.summary.trim() : ''
  if (summary) normalized.summary = summary
  if (STORY_RATINGS.includes(story.rating)) normalized.rating = story.rating
  return normalized
}

// Total glossary entries across all paragraphs
export function totalGlossaryCount(story) {
  if (!story || !Array.isArray(story.paragraphs)) return 0
  return story.paragraphs.reduce((n, p) => n + (Array.isArray(p.glossary) ? p.glossary.length : 0), 0)
}

// Whether the story meets minimum content bar (≥10 paragraphs, ≥15 total glossary entries)
export function meetsContentBar(story) {
  if (!story) return false
  return story.paragraphs.length >= 10 && totalGlossaryCount(story) >= 15
}

// Drop a story's entry from the index array (for stories/index.json after a
// delete). Tolerates a non-array index and malformed entries.
export function removeStoryFromIndex(index, storyId) {
  if (!Array.isArray(index)) return []
  return index.filter((e) => !(e && typeof e === 'object' && e.id === storyId))
}

// Mirror a rating onto the story's index entry so the library card can show
// and edit it without loading the full story record.
export function setRatingInIndex(index, storyId, verdict) {
  if (!Array.isArray(index)) return []
  return index.map((e) =>
    e && typeof e === 'object' && e.id === storyId ? { ...e, rating: verdict } : e,
  )
}

// Build a normalized index entry from a story (for storing in stories/index.json).
// `summary` (Feature 1) feeds the next generation's premise-level anti-repeat
// list; old stories without one project to '' so the index entry shape is stable.
export function buildIndexEntry(story) {
  return {
    id: story.id,
    title_a: story.title_a,
    title_b: story.title_b,
    lang_a: story.lang_a,
    lang_b: story.lang_b,
    level: story.level,
    created: story.created,
    summary: story.summary || '',
  }
}
