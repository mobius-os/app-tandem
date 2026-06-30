// UI-only difficulty-rating constants. These live here (NOT in story-schema.mjs)
// because they pair a STORY_RATINGS verdict with a human label for the rate
// chips / library card — a presentation concern, not part of the storage schema.
export const RATE_OPTIONS = [
  { verdict: 'too_simple', label: 'Too easy' },
  { verdict: 'just_right', label: 'Just right' },
  { verdict: 'too_complex', label: 'Too hard' },
]
export const RATE_LABELS = Object.fromEntries(RATE_OPTIONS.map((o) => [o.verdict, o.label]))
