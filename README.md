# Tandem

Parallel bilingual stories for language learning. The Möbius agent generates a story in two languages shown in a split-pane reader; tap any word to highlight it, its sentence context, and its translation inline in both panes.

> **Icon note:** The icon is a 3D glossy open bilingual book — two facing pages (warm + cool) bound in gold with a violet gem on the spine, matching the catalog's house style (`icon-v8.png`). Earlier revisions are kept as `icon.png`, `icon-v5.png`, `icon-v6.png`, and `icon-v7.png`.

## What it does

1. First run asks for your base language, target language, and CEFR level. After that, every generation is configured in the **Generate story** sheet: languages, level (remembered), and ONE free-form prompt. Type whatever you want — "a sci-fi mystery in French", "a classic fable", or "continue the cartographer story, but darker". Leave it blank to be surprised. One example phrasing lives in the placeholder (context-aware: it suggests continuing the most recent story when one exists) with a one-line hint underneath — text guidance, not clickable buttons. The sheet opens with focus on the sheet itself, never an input, so the mobile keyboard stays closed until the reader taps a field. The gear in the header opens the one settings surface: the **story generation agent** (Claude or OpenAI Codex), listed from the platform's model registry. Old unset/default selections are migrated to a concrete model row. The choice persists as `prefs.gen_provider`/`prefs.gen_model`; a failed registry fetch degrades to the bundled fallback list and never blocks generation.
2. Tap **Generate story** to have the agent write a fresh bilingual story, 14–20 paragraphs aligned pair-by-pair, with a dense per-paragraph glossary covering learner-useful words and constructions. Generation survives navigation and even an app reload: a pending record (`generation-pending.json`) is persisted to storage and the root component resumes the poll.
3. Read in the split-pane reader (left/right on wide web screens, top/bottom on phones and narrow windows; drag the slim divider to resize; panes sync-scroll paragraph-by-paragraph; the pill swaps which language leads).
4. Tap any word to visibly highlight its sentence in both texts. A lookup card at the bottom always shows the aligned other-language sentence (the tap's payoff — context without hunting the other pane); exact glossary entries add the word → word pair and note, with the located phrase emphasized both in the other pane and inside the card's sentence. No positional word matches are guessed. Tap the same word (or anywhere else) to clear.
5. After the last paragraph a quiet one-line row asks "How was it?" (Too easy / Just right / Too hard). The rating is stored on the story record and in `prefs.feedback_history`; re-rating replaces that story's earlier verdict so it cannot be counted twice. The next generation both adapts the CEFR level (last 3 unique story ratings) and feeds the ratings into the prompt to steer difficulty within the level.
6. Delete a story from the library card's trash affordance — an in-app confirm modal (the iframe sandbox silently no-ops `window.confirm`) removes the story file and its index entry.

## Storage layout

| Path | Contents |
|------|----------|
| `prefs.json` | `{ lang_a, lang_b, level, feedback_history: [{story_id, verdict, ts}], next_request?, gen_provider?, gen_model? }` |
| `stories/index.json` | Array of index entries (id, titles, languages, level, created, summary, rating?) |
| `stories/<id>.json` | Full story: `{ id, title_a, title_b, lang_a, lang_b, level, created, summary?, paragraphs, rating? }` |
| `generation-pending.json` | Present only while a generation is in flight: `{ started_at, params, known_ids }` |
| `generation-failed.json` | Optional failure marker from `generate.sh`: `{ message }` |

Each paragraph: `{ a: string, b: string, glossary: [{word_a, word_b, note?}] }`.

**Lenient read is a hard rule.** `normalizeStory` must accept stories written by any past version — missing `glossary`, missing `rating`, short paragraph counts — and degrade gracefully (context-only highlighting when there is no glossary). A strict read-time validator once bricked the whole library; never require generation-side fields on read.

## How generation works

The free-form prompt drives everything. When it names or describes an existing story ("continue X", "a sequel to Y"), a tool-free **selection pass** picks that story out of a metadata index of the WHOLE library and returns its id; `generate.sh` validates the id against the index and loads the full text itself, then a tool-free **generation pass** continues it coherently from the inlined text. When the prompt describes a fresh story, the agent writes a new one in that vein. The reader never manages a separate "series" field, and the agent never touches the filesystem.

Generation is triggered by `POST /api/apps/<id>/run-job`, which runs `generate.sh <APP_ID>`:

1. Reads `prefs.json` for the language pair, CEFR level, the free-form prompt and model (`next_request`, with `prefs.gen_provider`/`prefs.gen_model` as the fallback for runs that have no per-run record), and feedback history. The prompt is per-run: it lives only inside `next_request`, which is removed after each run.
2. Applies the feedback history to the level (too-easy ratings push it up; too-hard push it down — last 3 entries), and passes the recent ratings into the prompt so the model steers difficulty within the level.
3. Composes `system-prompt.md` (baked schema; 14–20 paragraph pairs; glossary covering all non-trivial content words verbatim) with the generation parameters.
4. Builds a metadata INDEX of every existing story — the same registry the reader sees in the library list, with the same card fields (id, both titles, languages, level, created date, the reader's difficulty rating) plus the one-line summary — bounded to one line each, so the prompt scales with the library. Both passes run the CLI **tool-free** (no `--add-dir`, no `--allowedTools Read`, no `--permission-mode dontAsk`): the agent reads a prompt and writes text, nothing else. Claude and Codex now share one code path (Claude via `claude -p`, Codex via `codex exec --json --sandbox read-only`).
   - **Pass 1 (selection):** when the reader supplied a request, the agent sees the index + request and returns only `{"relevant_ids": [...]}` — the existing stories it judges relevant (empty for a fresh topic). A blank “surprise me” request skips this pass entirely. `generate.sh` then keeps an id only if it is a real story-id (UUID v4) **and** a member of this app's index, caps the list at ≤6, and loads each kept story's full text via the same authenticated storage-API curl it uses for `index.json`/`prefs.json`. The agent never names a path, so it can never make `generate.sh` read an out-of-dir file.
   - **Pass 2 (generation):** the system prompt + parameters + the reader request + the **inlined** full text of the validated stories go to the agent, which returns the JSON story.
   The chosen model is passed via `--model` (sanitized first); Default means no flag. A failed custom-model run — nonzero exit OR no extractable story — retries once on the provider default, so a retired model id degrades to a default-model story instead of a hard failure.
5. Extracts and validates the JSON story object from stdout.
6. Writes `stories/<id>.json` and updates `stories/index.json`.
7. Re-fetches fresh `prefs.json`, removes only `next_request`, then sends a push notification.

The frontend never owns the run: it persists `generation-pending.json` (params + `known_ids` snapshot), POSTs run-job, and polls the index from the root component. The poll detects the new story by diffing against `known_ids`, then clears the pending record. Failures surface, they don't spin: if `generate.sh` drops a `generation-failed.json` marker (`{ message }`) the poll reads it and shows the body verbatim; otherwise a run that outlives the ~6-minute timeout with no story is shown as a rate-limit-flavoured error. Either way the UI lands on a "Generation failed" card with Retry / Dismiss instead of an open-ended spinner.

Security model: the service token is held by `generate.sh` and never exposed to the model, and the model has **zero filesystem access** — both passes are tool-free. The agent only ever sees the metadata index and any story text `generate.sh` chose to inline; it cannot read, write, run commands, or reach the network. The selection pass returns *ids*, never paths, and an id is honoured only if it is a UUID present in this app's own index — so a prompt-injection inside a stored story cannot coax the agent into reading `/data/cli-auth` or any other file. The shell script does the loading and the PUT.

## File layout

`index.jsx` is the Mobius entrypoint and composes sibling modules listed in `mobius.json` `source_files`:

- `story-schema.mjs` — `adaptLevel`, `lookupGlossary`, `normalizeStory` (lenient), `removeStoryFromIndex`, `buildIndexEntry`, `STORY_RATINGS`.
- `text-align.mjs` — `tokenizeParagraph` (word + sentence indices), `sentenceCount`, `alignSentenceIndex` (clamped sentence-by-index pane alignment), `stripWordPunct`, `findPhraseTokenRange` (verbatim glossary phrase → token range), `contextSentenceIndex` (phrase sentence wins over positional alignment), `buildAlignedContext` (the lookup card's {text, strong} sentence runs).
- `gen-model.mjs` — `normalizeGenProvider`, `normalizeGenModel`, `migrateGenPrefs`, and provider-group construction for the settings-sheet model list.
- `scroll-sync.mjs` — pure split-pane scroll and word-tap alignment helpers.
- `storage.js` — Mobius storage wrappers, story-index mutation queue, online state, and generation polling.
- `signals.js` — guarded `window.mobius.signal` helpers for Reflection analytics.
- `theme.js` — one exported CSS string rendered by the app root.
- `ui/` — React components for the library, reader, sheets, modal focus, and setup flow.

## Dev loop

```bash
# Run the tests
npm test

# Compile smoke (must pass before shipping)
npx esbuild index.jsx \
  --bundle \
  --packages=external \
  --format=esm \
  --loader:.js=jsx \
  --log-level=warning \
  --outfile=/dev/null

# Install in a running Möbius test instance
curl -s -X POST http://localhost:8001/api/apps/install \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"manifest_url":"file:///path/to/app-tandem/mobius.json"}'
```
