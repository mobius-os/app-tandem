# Tandem

Parallel bilingual stories for language learning. The Möbius agent generates a short story in two languages side-by-side; tap any word to see its meaning or paired paragraph.

> **Icon note:** The icon follows the catalog's glossy-3D infinity-motif pipeline. `icon.png` is absent from this repository — generate it through the standard catalog icon process before publishing.

## What it does

1. You set a base language (the one you know) and a target language (the one you're learning), plus a starting CEFR level (A1–C2).
2. Tap **Generate story** to have the agent write a fresh bilingual story aligned paragraph-by-paragraph, with 8–15 glossary entries per paragraph.
3. Read the story in interleaved mode (phone) or side-by-side columns (tablet/desktop — CSS-only, same DOM). The language-toggle pill swaps which language leads.
4. Tap any word: if it's in the paragraph's glossary, you see the pair + note; otherwise you see the full paired paragraph with the tapped word highlighted.
5. Rate each story (too simple / just right / too complex) — the next story's level adapts automatically based on your last three ratings.

## Storage layout

| Path | Contents |
|------|----------|
| `prefs.json` | `{ lang_a, lang_b, level, feedback_history: [{story_id, verdict, ts}] }` |
| `stories/index.json` | Array of index entries (id, titles, languages, level, created) |
| `stories/<id>.json` | Full story: `{ id, title_a, title_b, lang_a, lang_b, level, created, paragraphs }` |

Each paragraph: `{ a: string, b: string, glossary: [{word_a, word_b, note?}] }`.

The full story files are large (a few KB each); the index stays lightweight so the story list loads fast.

## How generation works

Generation is triggered by `POST /api/apps/<id>/run-job`, which runs `generate.sh <APP_ID>`:

1. Reads `prefs.json` to get the language pair and CEFR level.
2. Applies the feedback history to the level (too-simple ratings push it up; too-complex push it down — last 3 entries, score threshold ≥ 1).
3. Composes `system-prompt.md` (baked schema) with the generation parameters.
4. Runs the Claude CLI with NO tools — stories are fictional, no web search needed. `--max-turns 3`.
5. Extracts and validates the JSON story object from stdout.
6. Writes `stories/<id>.json` and updates `stories/index.json`.
7. Sends a push notification.

Security model: the service token is held by `generate.sh` and never exposed to the model. The model only produces a JSON story; the shell script does the PUT.

## Schema

See `story-schema.mjs` for the canonical pure helpers. `index.jsx` inlines them (the esbuild compile path can't import sibling `.mjs` files). The test suite (`__tests__/story-schema.test.mjs`) asserts the inline copy stays in sync.

Key functions:

- `adaptLevel(currentLevel, feedbackHistory)` — pure, testable level adaptation.
- `lookupGlossary(para, word)` — case-insensitive glossary lookup.
- `normalizeStory(story)` — validates + normalises a stored story; returns null on failure.
- `buildIndexEntry(story)` — strips paragraphs for the lightweight index.

## Dev loop

```bash
# Run the tests
node --test __tests__/story-schema.test.mjs

# Compile smoke (must pass before shipping)
/home/hmzmrzx/projects/node_modules/.bin/esbuild index.jsx \
  --bundle \
  --format=esm \
  --external:react \
  --external:react/jsx-runtime \
  --external:react-dom \
  --external:react-dom/client \
  --log-level=warning \
  --outfile=/dev/null

# Install in a running Möbius test instance
curl -s -X POST http://localhost:8001/api/apps/install \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"manifest_url":"file:///path/to/app-tandem/mobius.json"}'
```
