#!/bin/bash
# Möbius app-tandem on-demand story generator.
# Called by POST /api/apps/<APP_ID>/run-job when the user taps "Generate story".
#
# Usage: generate.sh <APP_ID>
#   APP_ID — numeric id of the installed tandem app (passed by the run-job endpoint).
#
# What it does:
#   1. Loads the service token and reads prefs.json (target language, base language,
#      CEFR level, the free-form generation prompt, generation model). Applies
#      feedback_history to adapt the requested level.
#   2a. Builds a metadata INDEX of every existing story — the same registry the
#      reader sees in the library list, with the same card fields (id, titles,
#      languages, level, created date, the reader's difficulty rating) plus the
#      one-line summary — bounded to one line each, so it scales with the library.
#   2b. Reads system-prompt.md (baked schema, role + output format).
#
#   The agent NEVER touches the filesystem. Both passes are tool-free; the
#   "agent picks which existing stories are relevant" vision is preserved by
#   giving the agent the metadata INDEX (not file access) and having generate.sh
#   load the validated files itself:
#
#   3. Pass 1 — selection (tool-free, max-turns 1–2). Feed the agent the library
#      index + the reader's free-form request; it returns ONLY a compact JSON
#      `{"relevant_ids": [...]}` naming the existing stories it judges relevant
#      (empty for a fresh topic). NO --add-dir, NO --allowedTools Read, NO tools.
#   4. generate.sh VALIDATES + LOADS (no agent). Each returned id is kept only if
#      it matches the story-id (UUID v4) format AND is present in the library
#      index (provably a member of THIS app's stories dir — never an arbitrary
#      path); the list is capped at ≤6. generate.sh then fetches each kept story's
#      full text via the SAME authenticated storage-API curl it uses for
#      index.json/prefs.json. The agent never names a path, so it can never make
#      generate.sh read /data/cli-auth or any out-of-dir file.
#   5. Pass 2 — generation (tool-free). Feed the system prompt + parameters + the
#      INLINED full text of only the validated stories + the request; the agent
#      returns the story JSON. NO tools. Both providers share one code path:
#      claude → `claude -p` (no tools); codex → `codex exec --json --sandbox
#      read-only`. The model is passed via --model; a failed custom-model run
#      retries once on the same provider's default model.
#   6. Extracts the JSON story object from stdout and validates it minimally.
#   7. Writes stories/<id>.json and updates stories/index.json.
#   8. Clears next_request from prefs so the next generation starts with no prompt.
#   9. Sends a push notification on success.
#  10. Logs to /data/cron-logs/tandem.log

set -uo pipefail

APP_ID="${1:-}"
API_BASE_URL="${API_BASE_URL:-http://localhost:8000}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LOG_DIR=/data/cron-logs
LOG_FILE="$LOG_DIR/tandem.log"
LOCK_FILE="$LOG_DIR/tandem-$APP_ID.lock"
TANDEM_TIMEOUT="${TANDEM_TIMEOUT:-300}"
WORK_DIR=$(mktemp -d -t app-tandem.XXXXXX)
RUN_SUCCEEDED=0
FAIL_REASON=""
SERVICE_TOKEN=""

mkdir -p "$LOG_DIR"

log() {
  echo "[$NOW] $*" >> "$LOG_FILE"
}

failure_context_available() {
  case "${APP_ID:-}" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ -n "${SERVICE_TOKEN:-}" ]
}

write_failure_marker() {
  failure_context_available || return 0
  local reason="$1"
  local payload="$WORK_DIR/generation-failed.json"

  MESSAGE="$reason" python3 - "$payload" <<'PY' || return 0
import json
import os
import sys

with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({"message": os.environ.get("MESSAGE") or "Generation failed."}, f, ensure_ascii=False)
PY

  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" \
    -X PUT "$API_BASE_URL/api/storage/apps/$APP_ID/generation-failed.json" \
    -H "Authorization: Bearer $SERVICE_TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary @"$payload") || code=000
  if [ "$code" != "200" ] && [ "$code" != "201" ] && [ "$code" != "204" ]; then
    log "WARN: failed to write generation-failed.json (HTTP $code)"
  fi
}

send_failure_notification() {
  failure_context_available || return 0
  local reason="$1"
  local payload="$WORK_DIR/failure-notification.json"

  MESSAGE="$reason" APP_ID="$APP_ID" python3 - "$payload" <<'PY' || return 0
import json
import os
import sys

app_id = os.environ["APP_ID"]
payload = {
    "title": "Tandem: story generation failed",
    "body": os.environ.get("MESSAGE") or "Generation failed.",
    "source_type": "app",
    "source_id": app_id,
    "target": f"/shell/?app={app_id}",
}
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False)
PY

  curl -sS -X POST "$API_BASE_URL/api/notifications/send" \
    -H "Authorization: Bearer $SERVICE_TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary @"$payload" >> "$LOG_FILE" 2>&1 || true
}

finish_generation() {
  local code="$1"
  if [ "$RUN_SUCCEEDED" != "1" ] && [ "$code" -ne 0 ]; then
    local reason="${FAIL_REASON:-Tandem story generation failed (exit $code).}"
    write_failure_marker "$reason"
    send_failure_notification "$reason"
  fi
  rm -rf "$WORK_DIR"
}

trap 'finish_generation $?' EXIT

fail() {
  FAIL_REASON="$1"
  log "ERROR: $FAIL_REASON"
  exit "${2:-1}"
}

if [ -z "$APP_ID" ]; then
  fail "APP_ID required." 2
fi
case "$APP_ID" in
  *[!0-9]*)
    fail "APP_ID must be numeric." 2
    ;;
esac

log "Starting story generation for app_id=$APP_ID"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  fail "Another tandem generation is already active." 5
fi

if [ ! -r /data/service-token.txt ]; then
  fail "/data/service-token.txt missing or unreadable."
fi
SERVICE_TOKEN=$(cat /data/service-token.txt)
if [ -z "$SERVICE_TOKEN" ]; then
  fail "/data/service-token.txt is empty."
fi

# 1. Read system-prompt.md (baked schema).
SYSTEM_FILE="$WORK_DIR/system-prompt.md"
SYS_CODE=$(curl -sS -o "$SYSTEM_FILE" -w "%{http_code}" \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  "$API_BASE_URL/api/storage/apps/$APP_ID/system-prompt.md") || SYS_CODE=000
if [ "$SYS_CODE" != "200" ]; then
  fail "Could not fetch system-prompt.md (HTTP $SYS_CODE)."
fi

# 2. Read prefs.json for language pair, level, feedback history, free-form prompt.
PREFS_FILE="$WORK_DIR/prefs.json"
PREFS_CODE=$(curl -sS -o "$PREFS_FILE" -w "%{http_code}" \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  "$API_BASE_URL/api/storage/apps/$APP_ID/prefs.json") || PREFS_CODE=000

# Parse prefs; fall back to English/Spanish B1 defaults.
# Output tab-separated fields (one per line via a NUL-safe scheme would be
# overkill; the free-form prompt is the only field that can contain arbitrary
# text, so it goes LAST and we read it with the-rest-of-line semantics):
#   lang_a, lang_b, level, ratings, provider, model, prompt.
PARAMS=$(python3 - "$PREFS_FILE" "$PREFS_CODE" <<'PY'
import json
import re
import sys

prefs_file, prefs_code = sys.argv[1], sys.argv[2]
defaults = {"lang_a": "English", "lang_b": "Spanish", "level": "B1"}
CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"]

prefs = {}
if prefs_code == "200":
    try:
        with open(prefs_file, encoding="utf-8") as f:
            prefs = json.load(f)
    except Exception:
        pass

lang_a = prefs.get("lang_a") or defaults["lang_a"]
lang_b = prefs.get("lang_b") or defaults["lang_b"]
level = prefs.get("level") or defaults["level"]
if level not in CEFR:
    level = defaults["level"]

# Adapt level from feedback history (last 3 entries), and surface those
# recent ratings to the model so it can fine-tune difficulty WITHIN the level.
ratings = "(none)"
history = prefs.get("feedback_history") or []
if isinstance(history, list):
    recent = history[-3:]
    score = 0
    labels = []
    verdict_label = {
        "too_simple": "too easy",
        "just_right": "just right",
        "too_complex": "too hard",
    }
    for entry in recent:
        if not isinstance(entry, dict):
            continue
        v = entry.get("verdict", "")
        if v in verdict_label:
            labels.append(verdict_label[v])
        if v == "too_simple":
            score += 1
        elif v == "too_complex":
            score -= 1
    if labels:
        ratings = ", ".join(labels)
    idx = CEFR.index(level)
    if score > 0:
        level = CEFR[min(idx + 1, len(CEFR) - 1)]
    elif score < 0:
        level = CEFR[max(idx - 1, 0)]

# Read the single free-form prompt and optional language override from
# next_request if present. The prompt REPLACES the old topic + storyline +
# mode split (v0.10): the reader types one natural-language ask ("a sci-fi
# mystery in French", "continue the cartographer story but darker") and the
# selection pass (pass 1) decides which existing stories it judges relevant.
# It is per-run by design — it lives ONLY inside next_request, so the post-run
# wipe clears it and the next free generation starts blank. Old prefs that
# still carry a legacy top-level `storyline` or a next_request `topic`/
# `storyline` fold into the prompt (lenient migration) so a mid-upgrade run is
# not silently dropped. Collapse internal whitespace so an embedded newline can
# not inject extra prompt lines downstream.
next_req = prefs.get("next_request") or {}
if not isinstance(next_req, dict):
    next_req = {}
prompt = next_req.get("prompt")
if not isinstance(prompt, str):
    prompt = ""
prompt = prompt.strip()
if not prompt:
    # Lenient migration from the pre-0.10 split fields, newest wins.
    legacy_bits = []
    for src in (next_req.get("topic"), next_req.get("storyline"), prefs.get("storyline")):
        if isinstance(src, str) and src.strip():
            legacy_bits.append(src.strip())
    prompt = " ".join(legacy_bits)
prompt = " ".join(prompt.split())
# Allow per-generate language override (from the generate sheet)
req_lang_a = (next_req.get("lang_a") or "").strip()
req_lang_b = (next_req.get("lang_b") or "").strip()
if req_lang_a:
    lang_a = req_lang_a
if req_lang_b:
    lang_b = req_lang_b

# Generation provider + model: the per-run record (next_request) wins over the
# persisted setting (prefs); scheduled runs have no next_request and use the
# setting directly. Empty model means the chosen CLI's default. Old prefs
# without gen_provider/gen_model fall through to "" by construction (lenient
# read). An empty/unknown provider with a model set routes to claude (the
# legacy default); "codex" routes to the codex CLI. Restrict the model to
# plausible model-id characters — anything else reads as default so a corrupted
# value can't reach the CLI argv.
provider = next_req.get("provider") or prefs.get("gen_provider") or ""
if not isinstance(provider, str):
    provider = ""
provider = provider.strip()
model = next_req.get("model") or prefs.get("gen_model") or ""
if not isinstance(model, str):
    model = ""
model = model.strip()
if model and not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", model):
    model = ""
# Normalize the provider to the two we support. Anything else (or empty with a
# model present) routes to claude; empty with no model is the platform default
# (still the claude CLI, no --model flag).
if provider not in ("claude", "codex"):
    provider = "claude" if model else ""

# prompt goes LAST: it is the only field that may carry arbitrary user text,
# and we read it with the-rest-of-line semantics in the shell so a stray tab
# inside it can not shift the earlier positional fields.
print(f"{lang_a}\t{lang_b}\t{level}\t{ratings}\t{provider}\t{model}\t{prompt}")
PY
)
LANG_A="${PARAMS%%$'\t'*}"
REST1="${PARAMS#*$'\t'}"
LANG_B="${REST1%%$'\t'*}"
REST2="${REST1#*$'\t'}"
LEVEL="${REST2%%$'\t'*}"
REST3="${REST2#*$'\t'}"
RATINGS="${REST3%%$'\t'*}"
REST4="${REST3#*$'\t'}"
GEN_PROVIDER="${REST4%%$'\t'*}"
REST5="${REST4#*$'\t'}"
GEN_MODEL="${REST5%%$'\t'*}"
# PROMPT is the rest-of-line: read with #* (strip up to the first tab) so an
# embedded tab inside it (already collapsed in python, but belt-and-braces)
# can not truncate it.
PROMPT_TEXT="${REST5#*$'\t'}"
log "Generating level=$LEVEL provider=${GEN_PROVIDER:-claude} model=${GEN_MODEL:-default} prompt=${PROMPT_TEXT:-(none)} story: $LANG_A / $LANG_B (recent ratings: $RATINGS)"

# 2b. Build a metadata INDEX of EVERY existing story (id, both titles,
# languages, level, created date, the reader's difficulty rating, one-line
# summary) — the full library registry, not just the 5/10 most recent. This is
# what lets the free-form prompt work: the SELECTION pass (pass 1) sees the
# whole library as metadata and decides which (if any) stories are relevant to
# the reader's ask ("continue X", "a sequel to Y"). The agent returns only the
# ids; generate.sh — not the agent — then loads the full text of those stories.
# The index stays bounded (one line per story) while the heavyweight full text
# is pulled on demand, so the context cost does not grow with the library.
#
# The index entry carries the story id so pass 1 can map a title in the prompt
# to a concrete id, and so generate.sh can validate that id against the index
# (provable membership of THIS app's stories) before loading it. The library
# is fetched through the authenticated storage API (index.json then each
# <id>.json) — the agent has NO filesystem access at any point.
STORIES_INDEX="(no stories yet)"
INDEX_EARLY_FILE="$WORK_DIR/index-early.json"
EARLY_CODE=$(curl -sS -o "$INDEX_EARLY_FILE" -w "%{http_code}" \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  "$API_BASE_URL/api/storage/apps/$APP_ID/stories/index.json") || EARLY_CODE=000
if [ "$EARLY_CODE" != "200" ]; then
  # No index yet (first-ever generation) — there is nothing to select from.
  : > "$INDEX_EARLY_FILE"
fi
if [ "$EARLY_CODE" = "200" ]; then
  STORIES_INDEX=$(python3 -c '
import json, sys
# The registry the agent sees is the SAME library list the reader sees before
# tapping a story: every story, with the same fields the library card shows
# (title_a, title_b, lang_a/lang_b, level, and the reader-set difficulty
# rating), plus the one-line summary as extra context. Every entry in the
# library index is listed — there is no truncation; the agent "sees what the
# user sees".
RATING_LABELS = {"too_simple": "too easy", "just_right": "just right", "too_complex": "too hard"}
try:
    idx = json.load(open(sys.argv[1], encoding="utf-8"))
    entries = [e for e in (idx if isinstance(idx, list) else []) if isinstance(e, dict) and e.get("title_a")]
    lines = []
    for e in entries:
        # Collapse internal whitespace so a stored title/summary with an
        # embedded newline can not inject extra index lines and break structure.
        sid = " ".join(str(e.get("id", "")).split())
        title_a = " ".join(str(e.get("title_a", "")).split())
        title_b = " ".join(str(e.get("title_b", "")).split())
        la = " ".join(str(e.get("lang_a", "")).split())
        lb = " ".join(str(e.get("lang_b", "")).split())
        lvl = " ".join(str(e.get("level", "")).split())
        summary = " ".join(str(e.get("summary", "")).split())
        # created is an ISO timestamp; show just the date the reader would read.
        created = " ".join(str(e.get("created", "")).split())[:10]
        rating = RATING_LABELS.get(e.get("rating"), "")
        meta_bits = []
        if la or lb or lvl:
            meta_bits.append(f"{la}/{lb} {lvl}".strip())
        if created:
            meta_bits.append(created)
        if rating:
            meta_bits.append(f"rated {rating}")
        meta = f"[{'; '.join(meta_bits)}]" if meta_bits else ""
        head = f"- id={sid} | {title_a} / {title_b} {meta}".rstrip()
        lines.append(f"{head}\n    {summary}" if summary else head)
    print("\n".join(lines) or "(no stories yet)")
except Exception:
    print("(no stories yet)")
' "$INDEX_EARLY_FILE")
fi

# ---------------------------------------------------------------------------
# Provider runner — TOOL-FREE for BOTH passes and BOTH providers.
#
# Neither pass grants the agent any tool. There is NO --add-dir, NO
# --allowedTools Read, NO --permission-mode dontAsk: the agent reads a prompt
# and writes text, nothing else. claude runs `claude -p` with the prompt as a
# system prompt and a fixed user turn; codex runs `codex exec --json` in a
# read-only sandbox (also no /data access). The model id is passed via --model
# only when one is set, so an empty model falls back to the CLI's own default;
# the CLI is the authority on what resolves, and a rejected id degrades to the
# default-model retry. This makes the two providers symmetric — there is no
# provider-specific "Using the library / Read tool" divergence any more.
# ---------------------------------------------------------------------------

# run_agent <prompt-file> <model-or-empty> <raw-output-file> <user-turn>
# Returns the CLI's exit code; writes the model's stdout to <raw-output-file>.
run_agent() {
  local prompt_file="$1" model="$2" raw_out="$3" user_turn="$4"
  if [ "$GEN_PROVIDER" = "codex" ]; then
    if ! command -v codex >/dev/null 2>&1; then
      log "ERROR: provider=codex but codex CLI not installed"
      return 127
    fi
    local codex_flags=( exec --json --sandbox read-only )
    if [ -n "$model" ]; then
      codex_flags+=( --model "$model" )
    fi
    codex_flags+=( - )
    printf '%s\n\n---\n\n%s\n' "$(cat "$prompt_file")" "$user_turn" \
      | timeout "$TANDEM_TIMEOUT" codex "${codex_flags[@]}" \
      > "$raw_out" 2>>"$LOG_FILE"
    return $?
  fi
  # Default provider: claude. NO tools — the prompt file is the system prompt
  # and the user turn is the only message.
  if ! command -v claude >/dev/null 2>&1; then
    log "ERROR: provider=claude but claude CLI not installed"
    return 127
  fi
  local flags=(
    --system-prompt-file "$prompt_file"
    --max-turns 2
  )
  if [ -n "$model" ]; then
    flags+=( --model "$model" )
  fi
  timeout "$TANDEM_TIMEOUT" env CLAUDE_CONFIG_DIR=/data/cli-auth/claude \
    claude -p "$user_turn" \
    "${flags[@]}" > "$raw_out" 2>>"$LOG_FILE"
}

# ---------------------------------------------------------------------------
# PASS 1 — selection (tool-free). Give the agent the library index + the
# reader's request; it returns ONLY {"relevant_ids": [...]}. generate.sh then
# validates those ids against the index and loads the matching files itself.
# Skipped entirely when the library is empty (nothing to select).
# ---------------------------------------------------------------------------
RELEVANT_IDS=""           # newline-separated validated ids (may be empty)
LOADED_STORIES=""         # inlined full text of the validated stories for pass 2

if [ "$EARLY_CODE" = "200" ] && [ "$STORIES_INDEX" != "(no stories yet)" ]; then
  SELECT_PROMPT_FILE="$WORK_DIR/select-prompt.md"
  {
    printf '# Tandem story-selection pass\n\n'
    printf 'You are the selection step for a bilingual story generator. You do NOT write a story here. Your only job is to decide which (if any) of the EXISTING stories listed below the reader is asking to continue, extend, or build on.\n\n'
    printf '## Reader request\n\n'
    if [ -n "$PROMPT_TEXT" ]; then
      printf 'The reader asked for: %s\n\n' "$PROMPT_TEXT"
      printf 'If this request names or describes one of the existing stories below (e.g. "continue X", "a sequel to Y", "more of the cartographer story", or an explicit id), return that story'"'"'s id (or the few ids it clearly concerns). If it just describes a fresh genre/theme/setting ("a sci-fi mystery in French", "something funny") and does NOT point at an existing story, return an empty list.\n\n'
    else
      printf 'There is no specific request — a fresh, original story will be written. Return an empty list.\n\n'
    fi
    printf '## Library index (every existing story — metadata only)\n\n'
    printf 'Each line is one existing story, exactly as the reader sees it in the library list: its id, both titles, [languages level; created date; the reader'"'"'s difficulty rating if any], and a one-line summary.\n\n'
    printf '%s\n\n' "$STORIES_INDEX"
    printf '## Output\n\n'
    printf 'Output ONLY a single JSON object and nothing else, no prose, no markdown fences:\n'
    printf '{"relevant_ids": ["<id>", ...]}\n\n'
    printf 'Use ONLY ids that appear VERBATIM in the index above. Pick the smallest set that genuinely answers the request — usually zero or one; include more only when several existing stories are truly relevant (e.g. a series or recurring characters), and never more than six. If nothing is clearly relevant, return {"relevant_ids": []}.\n'
  } > "$SELECT_PROMPT_FILE"

  SELECT_RAW="$WORK_DIR/select.out"
  SELECT_TURN="Return the relevant story ids now as {\"relevant_ids\": [...]} and nothing else."
  # The selection pass is cheap and order-insensitive to the model — run it on
  # the chosen model, then the provider default, just like generation, so an
  # invalid model id still yields a selection rather than a hard failure.
  SELECT_JSON=""
  for SEL_MODEL in ${GEN_MODEL:+"$GEN_MODEL"} ""; do
    run_agent "$SELECT_PROMPT_FILE" "$SEL_MODEL" "$SELECT_RAW" "$SELECT_TURN"
    SELECT_JSON=$(python3 - "$SELECT_RAW" "$INDEX_EARLY_FILE" "$GEN_PROVIDER" <<'PY' 2>>"$LOG_FILE"
import json
import re
import sys
import uuid as uuid_mod

raw_path, index_path, provider = sys.argv[1], sys.argv[2], sys.argv[3]

with open(raw_path, encoding="utf-8", errors="replace") as f:
    raw = f.read()

# codex `exec --json` emits JSONL — unwrap the final agent_message to its body.
if provider == "codex":
    last = ""
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = obj.get("msg", obj) if isinstance(obj, dict) else {}
        if isinstance(msg, dict) and msg.get("type") == "agent_message":
            m = msg.get("message", "")
            if isinstance(m, str):
                last = m
    if last:
        raw = last

stripped = re.sub(r'```(?:json)?\s*', '', raw).strip()
first = stripped.find('{')
last = stripped.rfind('}')
if first == -1 or last == -1 or last <= first:
    # Nothing parseable — treat as "no relevant stories" (fresh generation).
    print("[]", end="")
    sys.exit(0)
try:
    obj = json.loads(stripped[first:last + 1])
except json.JSONDecodeError:
    print("[]", end="")
    sys.exit(0)

requested = obj.get("relevant_ids") if isinstance(obj, dict) else None
if not isinstance(requested, list):
    print("[]", end="")
    sys.exit(0)

# Build the set of ids that PROVABLY belong to this app's library, straight
# from the index we fetched through the storage API. An id is loadable only if
# it is (a) a valid story-id (UUID v4) AND (b) present here. This is the gate
# that makes an arbitrary path impossible: the agent never supplies a path, only
# an id, and only ids that are members of THIS index survive.
known = set()
try:
    idx = json.load(open(index_path, encoding="utf-8"))
    for e in (idx if isinstance(idx, list) else []):
        if isinstance(e, dict) and isinstance(e.get("id"), str):
            known.add(e["id"])
except Exception:
    pass

# story ids are minted only by uuid_mod.uuid4() (this script) — always a
# canonical, lowercase UUID v4. The id the agent hands back must match that
# exact shape: anything else (a v1/v3/v5 uuid, an uppercased or brace-wrapped
# form, a path with a uuid prefix, trailing ?query/CRLF junk) is not a story we
# minted and must not be loadable. The anchored fullmatch rejects surrounding
# junk; the parse-and-recanonicalize check is the belt to that regex's braces:
# str(UUID(rid)) round-trips to the canonical lowercase form, and .version == 4
# pins the variant. Membership + cap below stay as defense-in-depth.
V4_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
)

def is_canonical_v4(s):
    if not V4_RE.fullmatch(s):
        return False
    try:
        parsed = uuid_mod.UUID(s)
    except Exception:
        return False
    return parsed.version == 4 and str(parsed) == s

valid = []
seen = set()
for rid in requested:
    if not isinstance(rid, str):
        continue
    rid = rid.strip().lower()
    if rid in seen:
        continue
    if not is_canonical_v4(rid):    # must be a canonical UUID v4 story-id
        continue
    if rid not in known:            # must be a member of this app's index
        continue
    seen.add(rid)
    valid.append(rid)
    if len(valid) >= 6:             # cap at ≤6 loaded stories (context-bounded;
        break                       # each loaded story inlines its FULL text)

print(json.dumps(valid), end="")
PY
)
    # A pass that parsed (even to "[]") is a success; only a hard CLI failure
    # with NO output retries on the default model.
    if [ -n "$SELECT_JSON" ]; then
      break
    fi
    if [ -n "$SEL_MODEL" ]; then
      log "Selection pass produced no output; retrying with the default model."
    fi
  done
  [ -z "$SELECT_JSON" ] && SELECT_JSON="[]"

  # Newline-list the validated ids for the shell, then load each story's full
  # text via the SAME authenticated storage-API curl used for index.json. The
  # agent is NOT involved in this step.
  RELEVANT_IDS=$(python3 -c 'import json,sys
try:
    ids=json.loads(sys.argv[1])
except Exception:
    ids=[]
print("\n".join(i for i in ids if isinstance(i,str)))' "$SELECT_JSON")

  if [ -n "$RELEVANT_IDS" ]; then
    log "Selection pass chose ${RELEVANT_IDS//$'\n'/, } for prompt: ${PROMPT_TEXT:-(none)}"
    LOADED_FILE="$WORK_DIR/loaded-stories.md"
    : > "$LOADED_FILE"
    while IFS= read -r SID; do
      [ -z "$SID" ] && continue
      STORY_TXT="$WORK_DIR/loaded-$SID.json"
      LOAD_CODE=$(curl -sS -o "$STORY_TXT" -w "%{http_code}" \
        -H "Authorization: Bearer $SERVICE_TOKEN" \
        "$API_BASE_URL/api/storage/apps/$APP_ID/stories/$SID.json") || LOAD_CODE=000
      if [ "$LOAD_CODE" != "200" ]; then
        log "WARN: could not load selected story $SID (HTTP $LOAD_CODE); continuing without it"
        continue
      fi
      {
        printf '### Existing story (id=%s)\n\n' "$SID"
        printf '```json\n'
        cat "$STORY_TXT"
        printf '\n```\n\n'
      } >> "$LOADED_FILE"
    done <<< "$RELEVANT_IDS"
    if [ -s "$LOADED_FILE" ]; then
      LOADED_STORIES=$(cat "$LOADED_FILE")
    fi
  fi
fi

# ---------------------------------------------------------------------------
# PASS 2 — generation (tool-free). Build the generation prompt: system prompt +
# parameters + the reader's request + the INLINED full text of the validated
# stories (if any). The agent has no file access; it works only from what is in
# this prompt. NO tools.
# ---------------------------------------------------------------------------
PROMPT_FILE="$WORK_DIR/prompt.md"
{
  cat "$SYSTEM_FILE"
  printf '\n\n## Generation parameters\n\n'
  printf 'Base language (lang_a): %s\n' "$LANG_A"
  printf 'Target language (lang_b): %s\n' "$LANG_B"
  printf 'CEFR level: %s\n' "$LEVEL"
  printf 'Recent difficulty ratings from the reader (oldest first): %s\n' "$RATINGS"
  printf 'Steer within the CEFR level: ratings leaning "too hard" mean simpler sentences and more common vocabulary; "too easy" means richer structures and rarer words.\n'
  printf '\n## Reader request\n\n'
  if [ -n "$PROMPT_TEXT" ]; then
    printf 'The reader asked for: %s\n' "$PROMPT_TEXT"
    printf 'Interpret this freely. If it asks to continue or extend an existing story, the relevant story (or stories) is inlined under "Stories to continue" below — continue it coherently, same characters, world, and voice, a NEW incident. If it just describes a genre/theme/setting ("a sci-fi mystery in French", "something funny") and no story is inlined, write a fresh standalone story in that vein. The base/target languages and level above are defaults; if the request explicitly asks for a different language or difficulty, honor the request.\n'
  else
    printf 'No specific request — write a fresh, original standalone story. Vary setting, genre, and mood from the recent library entries below; do not repeat a premise that already appears there.\n'
  fi
  printf '\n## Library index (every existing story — metadata only)\n\n'
  printf 'Each line is one existing story, exactly as the reader sees it in the library list: its id, both titles, [languages level; created date; the reader'"'"'s difficulty rating if any], and a one-line summary. This is METADATA only — do NOT assume you know a story'"'"'s full content from its summary. You have NO file access; if you need a story'"'"'s full text it is inlined under "Stories to continue" below (the selection step already loaded the relevant ones).\n\n'
  printf '%s\n' "$STORIES_INDEX"
  if [ -n "$LOADED_STORIES" ]; then
    printf '\n## Stories to continue (full text, loaded for you)\n\n'
    printf 'The selection step judged these existing stories relevant to the request and loaded their FULL text for you. Continue from them — match the established characters, plot, names, and tone, and write a NEW incident (never a retelling). Keep the same lang_a/lang_b/level as the story you are continuing unless the request explicitly changes them.\n\n'
    printf '%s\n' "$LOADED_STORIES"
  fi
  printf '\nGenerate the story now. Output ONLY the JSON object described above.\n'
} > "$PROMPT_FILE"

# 6. Run the generation pass and extract + validate the JSON story.
#
# Model fallback contract: when a custom model is set and the run fails —
# nonzero exit OR no extractable story — retry ONCE with the platform
# default. An invalid or retired model id must degrade to a default-model
# story, never to a hard failure. Extraction is the real success test:
# the CLI has been observed to exit 0 while printing only an error
# sentence ("There's an issue with the selected model…") for an unknown
# model id.
RAW_OUTPUT="$WORK_DIR/agent.out"
STORY_FILE="$WORK_DIR/story.json"
USER_TURN="Generate the bilingual story now. Output only the JSON object."

# Prints the story id on success (story written to $STORY_FILE); prints
# nothing on failure.
extract_story() {
  python3 - "$RAW_OUTPUT" "$STORY_FILE" "$LANG_A" "$LANG_B" "$LEVEL" "$GEN_PROVIDER" <<'PY' 2>>"$LOG_FILE"
import json
import re
import sys
import uuid as uuid_mod

raw_path, out_path, lang_a, lang_b, level = sys.argv[1:6]
provider = sys.argv[6] if len(sys.argv) > 6 else ""
CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"]

with open(raw_path, encoding="utf-8", errors="replace") as f:
    raw = f.read()

# Codex `exec --json` emits JSONL — the final `agent_message` event holds the
# model's text. Unwrap it to the message body before brace-searching; fall back
# to the raw stream if nothing parses (older codex shapes / truncation). Claude
# `-p` already writes plain text, so this only runs for the codex provider.
if provider == "codex":
    last = ""
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = obj.get("msg", obj) if isinstance(obj, dict) else {}
        if isinstance(msg, dict) and msg.get("type") == "agent_message":
            m = msg.get("message", "")
            if isinstance(m, str):
                last = m
    if last:
        raw = last

# Strip markdown code fences if the model wrapped the JSON.
# Then find the first { ... last } span.
raw_stripped = re.sub(r'```(?:json)?\s*', '', raw).strip()
first_brace = raw_stripped.find('{')
last_brace = raw_stripped.rfind('}')
if first_brace == -1 or last_brace == -1 or last_brace <= first_brace:
    print("", end="")
    sys.exit(2)
candidate = raw_stripped[first_brace:last_brace + 1]

try:
    story = json.loads(candidate)
except json.JSONDecodeError:
    print("", end="")
    sys.exit(2)

# Validate + normalise.
if not isinstance(story, dict):
    sys.exit(2)

# Ensure id is a valid UUID; generate one if missing/invalid.
sid = story.get("id", "")
try:
    uuid_mod.UUID(str(sid))
except Exception:
    story["id"] = str(uuid_mod.uuid4())

# Enforce languages (the model may have misread them).
story.setdefault("lang_a", lang_a)
story.setdefault("lang_b", lang_b)
if story.get("level") not in CEFR:
    story["level"] = level

title_a = (story.get("title_a") or "").strip()
title_b = (story.get("title_b") or "").strip()
if not title_a or not title_b:
    sys.exit(2)

# Carry the one-line premise summary through (Feature 1). Optional on read —
# a story without one is still valid; the field just won't feed the next
# generation's anti-repeat list. Drop an empty/blank summary so the stored
# record stays clean.
summary = story.get("summary")
if isinstance(summary, str) and summary.strip():
    story["summary"] = summary.strip()
else:
    story.pop("summary", None)

paragraphs = story.get("paragraphs") or []
if not isinstance(paragraphs, list):
    sys.exit(2)

# Normalise paragraphs + glossary.
clean_paragraphs = []
for p in paragraphs:
    if not isinstance(p, dict):
        continue
    a = (p.get("a") or "").strip()
    b = (p.get("b") or "").strip()
    if not a or not b:
        continue
    glossary = []
    for g in (p.get("glossary") or []):
        if not isinstance(g, dict):
            continue
        word_a = (g.get("word_a") or "").strip()
        word_b = (g.get("word_b") or "").strip()
        if not word_a or not word_b:
            continue
        entry = {"word_a": word_a, "word_b": word_b}
        note = (g.get("note") or "").strip()
        if note:
            entry["note"] = note
        glossary.append(entry)
    clean_paragraphs.append({"a": a, "b": b, "glossary": glossary})

if len(clean_paragraphs) < 1:
    sys.exit(2)

story["paragraphs"] = clean_paragraphs
if not story.get("created"):
    from datetime import datetime, timezone
    story["created"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(story, f, ensure_ascii=False, indent=2)

print(story["id"], end="")
PY
}

# Attempt list: the chosen model first (when set), then the chosen provider's
# own default. With no model set this is a single default-model attempt. The
# provider is fixed across both attempts — an invalid/retired model id (or a
# disconnected provider's rejected pick) degrades to that provider's default,
# never to a hard failure.
STORY_ID=""
FAIL_BODY=""
for ATTEMPT_MODEL in ${GEN_MODEL:+"$GEN_MODEL"} ""; do
  run_agent "$PROMPT_FILE" "$ATTEMPT_MODEL" "$RAW_OUTPUT" "$USER_TURN"
  CLI_EXIT=$?
  if [ "$CLI_EXIT" -ne 0 ]; then
    log "ERROR: agent exited with code $CLI_EXIT (provider=${GEN_PROVIDER:-claude} model=${ATTEMPT_MODEL:-default})"
    FAIL_BODY="The story generator exited with an error. Check Settings."
  else
    STORY_ID=$(extract_story)
    if [ -n "$STORY_ID" ]; then
      break
    fi
    log "ERROR: could not extract a valid story from agent output (provider=${GEN_PROVIDER:-claude} model=${ATTEMPT_MODEL:-default})"
    FAIL_BODY="The agent did not return a valid story. Try again."
  fi
  if [ -n "$ATTEMPT_MODEL" ]; then
    log "Retrying with the default model."
  fi
done

if [ -z "$STORY_ID" ]; then
  fail "${FAIL_BODY:-The story generator did not produce a story. Try again.}"
fi

# 7. PUT stories/<id>.json to storage.
STORY_URL="$API_BASE_URL/api/storage/apps/$APP_ID/stories/$STORY_ID.json"
PUT_CODE=$(curl -sS -o /dev/null -w "%{http_code}" \
  -X PUT "$STORY_URL" \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @"$STORY_FILE") || PUT_CODE=000

if [ "$PUT_CODE" != "200" ] && [ "$PUT_CODE" != "201" ] && [ "$PUT_CODE" != "204" ]; then
  fail "Failed to save story (HTTP $PUT_CODE)."
fi

log "Saved story $STORY_ID (level=$LEVEL)"

# 8. Update stories/index.json — fetch existing, append new entry, PUT back.
INDEX_FILE="$WORK_DIR/index.json"
INDEX_CODE=$(curl -sS -o "$INDEX_FILE" -w "%{http_code}" \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  "$API_BASE_URL/api/storage/apps/$APP_ID/stories/index.json") || INDEX_CODE=000

python3 - "$STORY_FILE" "$INDEX_FILE" "$INDEX_CODE" <<'PY' > "$WORK_DIR/new-index.json" 2>>"$LOG_FILE"
import json
import sys

story_file, index_file, index_code = sys.argv[1:4]

with open(story_file, encoding="utf-8") as f:
    story = json.load(f)

entry = {k: story.get(k, "") for k in
         ["id", "title_a", "title_b", "lang_a", "lang_b", "level", "created", "summary"]}

index = []
if index_code == "200":
    try:
        with open(index_file, encoding="utf-8") as f:
            index = json.load(f)
        if not isinstance(index, list):
            index = []
    except Exception:
        index = []

# Remove any existing entry with the same id (replace), then prepend.
index = [e for e in index if isinstance(e, dict) and e.get("id") != entry["id"]]
index = [entry] + index

print(json.dumps(index, ensure_ascii=False, indent=2))
PY

IDX_PUT_CODE=$(curl -sS -o /dev/null -w "%{http_code}" \
  -X PUT "$API_BASE_URL/api/storage/apps/$APP_ID/stories/index.json" \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @"$WORK_DIR/new-index.json") || IDX_PUT_CODE=000

if [ "$IDX_PUT_CODE" != "200" ] && [ "$IDX_PUT_CODE" != "201" ] && [ "$IDX_PUT_CODE" != "204" ]; then
  log "WARN: failed to update stories/index.json (HTTP $IDX_PUT_CODE)"
fi

# 8b. Clear next_request from prefs so the next generation starts with no prompt.
CLEAR_PREFS_CODE=$(python3 - "$PREFS_FILE" "$PREFS_CODE" <<'PY' > "$WORK_DIR/prefs-cleared.json" 2>>"$LOG_FILE"
import json
import sys

prefs_file, prefs_code = sys.argv[1], sys.argv[2]
prefs = {}
if prefs_code == "200":
    try:
        with open(prefs_file, encoding="utf-8") as f:
            prefs = json.load(f)
    except Exception:
        pass

prefs["next_request"] = None
print(json.dumps(prefs, ensure_ascii=False, indent=2))
PY
)
if [ -s "$WORK_DIR/prefs-cleared.json" ]; then
  PREFS_PUT_CODE=$(curl -sS -o /dev/null -w "%{http_code}" \
    -X PUT "$API_BASE_URL/api/storage/apps/$APP_ID/prefs.json" \
    -H "Authorization: Bearer $SERVICE_TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary @"$WORK_DIR/prefs-cleared.json") || PREFS_PUT_CODE=000
  if [ "$PREFS_PUT_CODE" != "200" ] && [ "$PREFS_PUT_CODE" != "201" ] && [ "$PREFS_PUT_CODE" != "204" ]; then
    log "WARN: failed to clear next_request in prefs (HTTP $PREFS_PUT_CODE)"
  fi
fi

# 9. Push notification.
curl -sS -X POST "$API_BASE_URL/api/notifications/send" \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Tandem: new story ready\",
    \"body\": \"Your new $LEVEL $LANG_B story is ready to read.\",
    \"source_type\": \"app\",
    \"source_id\": \"$APP_ID\",
    \"target\": \"/shell/?app=$APP_ID\",
    \"actions\": [
      {\"action\": \"open_app\", \"title\": \"Read\", \"target\": \"/shell/?app=$APP_ID\"}
    ]
  }" >> "$LOG_FILE" 2>&1

log "Done."
RUN_SUCCEEDED=1
