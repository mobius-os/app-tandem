// Guards on the GENERATION side of the contract: system-prompt.md and
// generate.sh must ask for the longer stories, full glossary coverage, and
// difficulty-rating steering. These are generation-only requirements — the
// read path (normalizeStory) must stay lenient and is tested separately.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SYSTEM_PROMPT = readFileSync(join(HERE, '..', 'system-prompt.md'), 'utf8')
const GENERATE_SH = readFileSync(join(HERE, '..', 'generate.sh'), 'utf8')

// ---------------------------------------------------------------------------
// system-prompt.md
// ---------------------------------------------------------------------------
test('system prompt targets 14–20 paragraph pairs', () => {
  assert.ok(SYSTEM_PROMPT.includes('14–20 paragraph pairs'),
    'expected the global 14–20 paragraph target')
  // No CEFR band may still carry the old short targets.
  assert.ok(!/1[0-3]–1[0-6] paragraph pairs/.test(SYSTEM_PROMPT),
    'found a stale 10–16-range paragraph target')
})

test('system prompt demands glossary coverage of all non-trivial content words', () => {
  assert.match(SYSTEM_PROMPT, /ALL non-trivial content words/i)
  assert.ok(SYSTEM_PROMPT.includes('4–8 entries per paragraph'))
})

test('system prompt requires glossary words verbatim from the paragraph text', () => {
  assert.match(SYSTEM_PROMPT, /VERBATIM/i)
})

test('system prompt explains difficulty-rating steering', () => {
  assert.match(SYSTEM_PROMPT, /recent difficulty ratings/i)
  assert.match(SYSTEM_PROMPT, /too hard/)
  assert.match(SYSTEM_PROMPT, /too easy/)
})

// v0.9.0 — premise-level anti-repeat + persistent series continuity.
test('system prompt requires a one-sentence summary in the output format', () => {
  // The summary field must be in the JSON output schema...
  assert.match(SYSTEM_PROMPT, /"summary":/)
  // ...with the ≤25-word, lang_a, premise (not moral) contract spelled out.
  assert.match(SYSTEM_PROMPT, /≤25 words/)
  assert.match(SYSTEM_PROMPT, /premise/i)
})

test('system prompt steers variety toward PREMISES, not just titles', () => {
  // v0.10: the per-premise steer now lives in "Story variety" and keys off the
  // library index summaries rather than a "recent stories" block.
  assert.match(SYSTEM_PROMPT, /premise/i)
  assert.match(SYSTEM_PROMPT, /Library index/)
})

// v0.10 — single free-form request + library index + load-on-demand.
test('system prompt explains the free-form Reader request', () => {
  assert.match(SYSTEM_PROMPT, /Reader request/)
  assert.match(SYSTEM_PROMPT, /free-form/i)
})

test('system prompt has a Continuing-an-existing-story section (replaces storyline)', () => {
  assert.match(SYSTEM_PROMPT, /Continuing an existing story/)
  // It must NOT still carry the old persistent-storyline framing.
  assert.ok(!/Series continuity/.test(SYSTEM_PROMPT),
    'the old Series continuity section must be gone')
  assert.ok(!/Previously in this series/.test(SYSTEM_PROMPT),
    'the old per-series continuity line must be gone')
})

test('system prompt documents loading a story by id via the library', () => {
  assert.match(SYSTEM_PROMPT, /Using the library/)
  assert.match(SYSTEM_PROMPT, /<id>\.json/)
})

// ---------------------------------------------------------------------------
// generate.sh
// ---------------------------------------------------------------------------
test('generate.sh surfaces recent ratings into the prompt parameters', () => {
  assert.ok(GENERATE_SH.includes('Recent difficulty ratings from the reader'),
    'prompt must carry the recent ratings line')
  assert.ok(GENERATE_SH.includes('"$RATINGS"'),
    'the ratings shell variable must be interpolated into the prompt')
})

test('generate.sh maps stored verdicts to reader-facing labels', () => {
  for (const pair of ['"too_simple": "too easy"', '"just_right": "just right"', '"too_complex": "too hard"']) {
    assert.ok(GENERATE_SH.includes(pair), `missing verdict mapping ${pair}`)
  }
})

test('generate.sh still adapts the CEFR level from the last 3 ratings', () => {
  assert.ok(GENERATE_SH.includes('history[-3:]'))
  assert.ok(GENERATE_SH.includes('CEFR[min(idx + 1, len(CEFR) - 1)]'))
  assert.ok(GENERATE_SH.includes('CEFR[max(idx - 1, 0)]'))
})

test('generate.sh read-side validation stays lenient (no glossary/length requirement)', () => {
  // The extraction block keeps paragraphs with any a/b text and tolerates
  // missing glossaries — it must never require the generation-side targets.
  assert.ok(GENERATE_SH.includes('if len(clean_paragraphs) < 1:'),
    'only the ≥1-paragraph floor may be enforced on extraction')
  assert.ok(!GENERATE_SH.includes('len(clean_paragraphs) < 10'),
    'extraction must not enforce a paragraph-count bar')
})

// v0.10 — free-form prompt + full library index + scoped Read tool.
test('generate.sh carries the reader free-form prompt into the prompt file', () => {
  // The single prompt field is read from next_request and surfaced under a
  // "Reader request" heading.
  assert.match(GENERATE_SH, /next_req\.get\("prompt"\)/)
  assert.ok(GENERATE_SH.includes('## Reader request'),
    'the prompt file must have a Reader request section')
  assert.ok(GENERATE_SH.includes('"$PROMPT_TEXT"'),
    'the free-form prompt shell var must be interpolated into the prompt')
})

test('generate.sh builds a library index over EVERY story, not just the recent few', () => {
  // No more `entries[:10]` / `entries[:5]` slicing — the index must iterate all.
  assert.ok(!/entries\[:\d+\]/.test(GENERATE_SH),
    'the index must not be truncated to the N most-recent stories')
  assert.ok(GENERATE_SH.includes('for e in entries:'),
    'the index loop must walk all entries')
  assert.ok(GENERATE_SH.includes('## Library index'),
    'the prompt file must have a Library index section')
  // Index entries must carry the id (so the agent can open <id>.json).
  assert.ok(GENERATE_SH.includes('id={sid}'),
    'each index line must expose the story id')
})

test('generate.sh runs claude with a Read tool scoped to the stories dir', () => {
  // The pivotal mechanism: claude gets ONLY the Read tool, scoped via --add-dir
  // to the on-disk stories directory, so it loads relevant stories on demand.
  assert.ok(GENERATE_SH.includes('--allowedTools "Read"'),
    'claude must allow only the Read tool')
  assert.ok(GENERATE_SH.includes('--add-dir "$STORIES_DIR"'),
    'claude must scope file access to the stories dir')
  assert.ok(GENERATE_SH.includes('apps/$APP_ID/stories'),
    'the stories dir must resolve under the per-app storage path')
  // It must NOT regress to the old no-tools invocation.
  assert.ok(!GENERATE_SH.includes('--allowedTools ""'),
    'the no-tools generation must be gone')
})

test('generate.sh lenient-migrates legacy topic/storyline into the prompt', () => {
  // A mid-upgrade run whose next_request still has topic/storyline (no prompt)
  // must fold those into the free-form prompt rather than silently drop them.
  assert.match(GENERATE_SH, /next_req\.get\("topic"\)/)
  assert.match(GENERATE_SH, /prefs\.get\("storyline"\)/)
})

test('generate.sh no longer plumbs the old topic/mode/storyline prompt lines', () => {
  // The old structured fields must be gone from the BUILT prompt (the only
  // surviving mentions are the migration fallback + comments).
  assert.ok(!/printf 'Topic: /.test(GENERATE_SH),
    'the Topic: prompt line must be gone')
  assert.ok(!/printf 'Storyline \/ series/.test(GENERATE_SH),
    'the Storyline/series prompt line must be gone')
  assert.ok(!/printf 'Mode: /.test(GENERATE_SH),
    'the Mode: prompt line must be gone')
})
