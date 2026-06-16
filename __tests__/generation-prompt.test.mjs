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

// v0.11 — two-pass tool-free design. The generation pass has NO file access;
// the relevant stories' full text is inlined by generate.sh (the selection
// pass + shell loader), so the system prompt must point at the inlined block,
// not a Read tool / on-disk path.
test('system prompt documents the inlined full text, not a Read tool', () => {
  // The generation prompt is told the relevant stories arrive inlined.
  assert.match(SYSTEM_PROMPT, /Stories to continue/)
  // It must state it has no file access / no tools.
  assert.match(SYSTEM_PROMPT, /NO file access|no file access/)
  // The old Read-tool framing must be gone.
  assert.ok(!/Using the library/.test(SYSTEM_PROMPT),
    'the old "Using the library" Read-tool section must be gone')
  assert.ok(!/Read its full text|Read the relevant file|Read tool/.test(SYSTEM_PROMPT),
    'the system prompt must not instruct the agent to Read files')
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

// v0.10/0.11 — free-form prompt + full library index, agent picks ids (no file access).
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
  // Index entries must carry the id so the selection pass can name it and
  // generate.sh can validate it against the index before loading.
  assert.ok(GENERATE_SH.includes('id={sid}'),
    'each index line must expose the story id')
})

test('the registry line exposes the SAME fields the reader sees on the library card', () => {
  // v0.12 — the agent registry mirrors the user-facing library list: per story
  // it must surface both titles, languages, level, the created date, AND the
  // reader's difficulty rating (the card shows all of these), plus the summary.
  // These are the fields the index-building python reads off each entry.
  for (const field of ['title_a', 'title_b', 'lang_a', 'lang_b', 'level', 'created', 'rating', 'summary']) {
    assert.ok(GENERATE_SH.includes(`e.get("${field}"`),
      `the registry line must read the ${field} field the library card shows`)
  }
  // The rating is shown in the reader's own words, not the raw enum.
  assert.ok(GENERATE_SH.includes('RATING_LABELS'),
    'the registry must render the difficulty rating in human-readable words')
})

// v0.11 — SECURE two-pass, TOOL-FREE design. The agent gets ZERO filesystem
// access: no --add-dir, no --allowedTools Read, no --permission-mode dontAsk on
// EITHER pass. The "agent picks relevant stories" vision survives via a
// selection pass that returns ids, which generate.sh validates against the
// index and loads itself.
test('generate.sh grants the agent NO filesystem tools (security: no Read/add-dir/dontAsk)', () => {
  // Strip comment lines: the header legitimately documents that these flags are
  // ABSENT ("NO --add-dir, ..."). The security guarantee is that they never
  // appear as ACTUAL CLI arguments, so we check only the executable lines.
  const CODE = GENERATE_SH.split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n')
  assert.ok(!CODE.includes('--add-dir'),
    'the agent must NOT be granted a directory via --add-dir (additive grant, not a sandbox)')
  assert.ok(!CODE.includes('--allowedTools'),
    'the agent must NOT be granted any tool via --allowedTools')
  assert.ok(!CODE.includes('--permission-mode'),
    'no --permission-mode — there are no tool prompts to auto-grant')
})

test('generate.sh runs a tool-free selection pass that returns relevant_ids', () => {
  // Pass 1: the agent sees only the index + request and returns a compact JSON.
  assert.ok(GENERATE_SH.includes('relevant_ids'),
    'the selection pass must ask for a relevant_ids list')
  assert.ok(GENERATE_SH.includes('## Library index'),
    'the selection prompt must carry the library index to choose from')
  // claude runs -p with only a system-prompt-file + a max-turns cap (no tools).
  assert.ok(GENERATE_SH.includes('--system-prompt-file'),
    'the agent runs from a system-prompt-file (prompt in, text out)')
})

test('generate.sh validates selected ids against the index and caps the load (security)', () => {
  // An id is loadable only if it is a real story-id (UUID) AND a member of the
  // app's own index — this is what makes an arbitrary out-of-dir path impossible.
  // The id-shape gate is now a canonical-UUID-v4 check (see behavioral tests
  // below for the actual rejection/accept proof — these string-matches only
  // confirm the structural pieces are present).
  assert.ok(GENERATE_SH.includes('is_canonical_v4(rid)'),
    'each selected id must pass a canonical-UUID-v4 check')
  assert.ok(GENERATE_SH.includes('parsed.version == 4'),
    'the id-shape check must pin the UUID variant to v4')
  assert.ok(GENERATE_SH.includes('if rid not in known:'),
    'each selected id must be a member of THIS app\'s library index')
  assert.ok(GENERATE_SH.includes('if len(valid) >= 6:'),
    'the loaded-story set must be capped (≤6)')
})

test('generate.sh — NOT the agent — loads the validated story files via the storage API', () => {
  // The full text is fetched by the shell through the authenticated storage API
  // (same path as index.json/prefs.json), then inlined into pass 2.
  assert.ok(GENERATE_SH.includes('/api/storage/apps/$APP_ID/stories/$SID.json'),
    'generate.sh loads each validated story by id via the storage API')
  assert.ok(GENERATE_SH.includes('Stories to continue'),
    'the generation prompt inlines the loaded stories under a Stories-to-continue heading')
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
