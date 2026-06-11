// Pure story-schema helpers shared by index.jsx (inlined) and the unit tests.
// No React, no I/O.
//
// CANONICAL SOURCE — edit here, then mirror the changes to the
// ===== INLINE-SCHEMA START / END ===== block inside index.jsx.
// __tests__/story-schema.test.mjs asserts the inlined copy stays in sync.

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

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

// Find the glossary entry for a given word in paragraph `para`.
// Matches case-insensitively against both word_a and word_b.
// Returns the matching glossary entry object, or null.
export function lookupGlossary(para, word) {
  if (!para || !Array.isArray(para.glossary)) return null
  if (typeof word !== 'string' || !word.trim()) return null
  const needle = word.trim().toLowerCase()
  return para.glossary.find((entry) => {
    if (typeof entry.word_a === 'string' && entry.word_a.toLowerCase().includes(needle)) return true
    if (typeof entry.word_b === 'string' && entry.word_b.toLowerCase().includes(needle)) return true
    return false
  }) || null
}

// Validate a parsed story object, returning a normalized version or null.
// Accepts stories from storage (they may have been written by older code).
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
  return { id, title_a, title_b, lang_a, lang_b, level, created, paragraphs }
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

// Build a normalized index entry from a story (for storing in stories/index.json).
export function buildIndexEntry(story) {
  return {
    id: story.id,
    title_a: story.title_a,
    title_b: story.title_b,
    lang_a: story.lang_a,
    lang_b: story.lang_b,
    level: story.level,
    created: story.created,
  }
}
