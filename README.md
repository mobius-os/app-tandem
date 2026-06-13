# Tandem

Parallel bilingual stories for language learning. The Möbius agent generates a story in two languages shown in a split-pane reader; tap any word to highlight it, its sentence context, and its translation inline in both panes.

> **Icon note:** The icon follows the catalog's glossy-3D infinity-motif pipeline (`icon.png` on this repo's main).

## What it does

1. First run asks for your base language, target language, and CEFR level — after that, every generation is configured directly in the **Generate story** sheet (languages, level, topic, genre; all remembered). The gear in the header opens the one settings surface: the **story generation model**, listed from the platform's model registry (`GET /api/models`; Claude models only, since generation runs the Claude CLI). "Default" follows the platform's current model. The choice persists as `prefs.gen_model`; a failed registry fetch degrades to a Default-only list and never blocks generation.
2. Tap **Generate story** to have the agent write a fresh bilingual story, 14–20 paragraphs aligned pair-by-pair, with a per-paragraph glossary covering all non-trivial content words. Generation survives navigation and even an app reload: a pending record (`generation-pending.json`) is persisted to storage and the root component resumes the poll.
3. Read in the split-pane reader (drag the slim divider to resize; panes sync-scroll paragraph-by-paragraph; the pill swaps which language leads).
4. Tap any word: the word gets a strong highlight, its sentence a soft one, and the OTHER pane highlights the aligned sentence (index-clamped) — plus the exact translated word when the story's glossary maps it. Tap the same word (or anywhere else) to clear. No bottom sheets.
5. After the last paragraph a quiet one-line row asks "How was it?" (Too easy / Just right / Too hard). The rating is stored on the story record and in `prefs.feedback_history`; the next generation both adapts the CEFR level (last 3 ratings) and feeds the ratings into the prompt to steer difficulty within the level.
6. Delete a story from the library card's trash affordance — an in-app confirm modal (the iframe sandbox silently no-ops `window.confirm`) removes the story file and its index entry.

## Storage layout

| Path | Contents |
|------|----------|
| `prefs.json` | `{ lang_a, lang_b, level, feedback_history: [{story_id, verdict, ts}], next_request, gen_model? }` |
| `stories/index.json` | Array of index entries (id, titles, languages, level, created) |
| `stories/<id>.json` | Full story: `{ id, title_a, title_b, lang_a, lang_b, level, created, paragraphs, rating? }` |
| `generation-pending.json` | Present only while a generation is in flight: `{ started_at, params, known_ids }` |

Each paragraph: `{ a: string, b: string, glossary: [{word_a, word_b, note?}] }`.

**Lenient read is a hard rule.** `normalizeStory` must accept stories written by any past version — missing `glossary`, missing `rating`, short paragraph counts — and degrade gracefully (context-only highlighting when there is no glossary). A strict read-time validator once bricked the whole library; never require generation-side fields on read.

## How generation works

Generation is triggered by `POST /api/apps/<id>/run-job`, which runs `generate.sh <APP_ID>`:

1. Reads `prefs.json` for the language pair, CEFR level, topic/mode/model (`next_request`, with `prefs.gen_model` as the model fallback for runs that have no per-run record), and feedback history.
2. Applies the feedback history to the level (too-easy ratings push it up; too-hard push it down — last 3 entries), and passes the recent ratings into the prompt so the model steers difficulty within the level.
3. Composes `system-prompt.md` (baked schema; 14–20 paragraph pairs; glossary covering all non-trivial content words verbatim) with the generation parameters.
4. Runs the Claude CLI with NO tools — stories are fictional, no web search needed. `--max-turns 3`. The chosen model is passed via `--model` (sanitized to model-id characters first); Default means no flag. A failed custom-model run — nonzero exit OR no extractable story (the CLI exits 0 with an error sentence on unknown model ids) — retries once on the platform default, so a retired model id degrades to a default-model story instead of a hard failure.
5. Extracts and validates the JSON story object from stdout.
6. Writes `stories/<id>.json` and updates `stories/index.json`.
7. Sends a push notification.

The frontend never owns the run: it persists `generation-pending.json` (params + `known_ids` snapshot), POSTs run-job, and polls the index from the root component. The poll detects the new story by diffing against `known_ids`, then clears the pending record. Failures surface, they don't spin: if `generate.sh` drops a `generation-failed.json` marker (`{ message }`) the poll reads it and shows the body verbatim; otherwise a run that outlives the ~6-minute timeout with no story is shown as a rate-limit-flavoured error. Either way the UI lands on a "Generation failed" card with Retry / Dismiss instead of an open-ended spinner.

Security model: the service token is held by `generate.sh` and never exposed to the model. The model only produces a JSON story; the shell script does the PUT.

## Pure helper modules

`index.jsx` inlines three React-free modules (the esbuild compile path can't import sibling `.mjs` files); each test file asserts the inline copy stays in sync:

- `story-schema.mjs` — `adaptLevel`, `lookupGlossary`, `normalizeStory` (lenient), `removeStoryFromIndex`, `buildIndexEntry`, `STORY_RATINGS`.
- `text-align.mjs` — `tokenizeParagraph` (word + sentence indices), `sentenceCount`, `alignSentenceIndex` (clamped sentence-by-index pane alignment), `stripWordPunct`, `findPhraseTokenRange` (verbatim glossary phrase → token range).
- `gen-model.mjs` — `normalizeGenModel` (lenient `prefs.gen_model` read), `modelOptionsFrom` (settings-sheet option list from the `/api/models` registry — curated to the entries carrying a polished label, dropping raw/dated aliases, with Default first and the current selection always kept).

## Dev loop

```bash
# Run the tests
node --test __tests__/

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
