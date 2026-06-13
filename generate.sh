#!/bin/bash
# Möbius app-tandem on-demand story generator.
# Called by POST /api/apps/<APP_ID>/run-job when the user taps "Generate story".
#
# Usage: generate.sh <APP_ID>
#   APP_ID — numeric id of the installed tandem app (passed by the run-job endpoint).
#
# What it does:
#   1. Loads the service token and reads prefs.json (target language, base language,
#      CEFR level, topic, mode, generation model). Applies feedback_history to adapt
#      the requested level.
#   2a. Fetches recent story titles to avoid repeats.
#   2b. Reads system-prompt.md (baked schema, role + output format) and appends the
#      generation parameters as a trailing section.
#   3. Runs the chosen provider's CLI with NO tools — output is pure JSON from the
#      model's reasoning alone. No web search; stories are fictional. The provider
#      (claude | codex) and model come from next_request, falling back to
#      prefs.gen_provider / prefs.gen_model; the model is passed via --model. A
#      failed custom-model run retries once on the same provider's default model.
#      claude → `claude -p`; codex → `codex exec --json --sandbox read-only`.
#   4. Extracts the JSON story object from stdout and validates it minimally.
#   5. Writes stories/<id>.json and updates stories/index.json.
#   6. Clears next_request from prefs so the next generation reverts to free mode.
#   7. Sends a push notification on success.
#   8. Logs to /data/cron-logs/tandem.log

set -uo pipefail

APP_ID="${1:-}"
if [ -z "$APP_ID" ]; then
  echo "generate.sh: APP_ID required" >&2
  exit 2
fi
case "$APP_ID" in
  *[!0-9]*)
    echo "generate.sh: APP_ID must be numeric" >&2
    exit 2
    ;;
esac

API_BASE_URL="${API_BASE_URL:-http://localhost:8000}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LOG_DIR=/data/cron-logs
LOG_FILE="$LOG_DIR/tandem.log"
LOCK_FILE="$LOG_DIR/tandem-$APP_ID.lock"
TANDEM_TIMEOUT="${TANDEM_TIMEOUT:-300}"
WORK_DIR=$(mktemp -d -t app-tandem.XXXXXX)
trap 'rm -rf "$WORK_DIR"' EXIT

mkdir -p "$LOG_DIR"

log() {
  echo "[$NOW] $*" >> "$LOG_FILE"
}

log "Starting story generation for app_id=$APP_ID"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Another tandem generation is already active; skipping."
  exit 5
fi

if [ ! -r /data/service-token.txt ]; then
  log "ERROR: /data/service-token.txt missing or unreadable"
  exit 1
fi
SERVICE_TOKEN=$(cat /data/service-token.txt)
if [ -z "$SERVICE_TOKEN" ]; then
  log "ERROR: /data/service-token.txt is empty"
  exit 1
fi

# 1. Read system-prompt.md (baked schema).
SYSTEM_FILE="$WORK_DIR/system-prompt.md"
SYS_CODE=$(curl -sS -o "$SYSTEM_FILE" -w "%{http_code}" \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  "$API_BASE_URL/api/storage/apps/$APP_ID/system-prompt.md") || SYS_CODE=000
if [ "$SYS_CODE" != "200" ]; then
  log "ERROR: could not fetch system-prompt.md (HTTP $SYS_CODE)"
  exit 1
fi

# 2. Read prefs.json for language pair, level, feedback history, topic, mode.
PREFS_FILE="$WORK_DIR/prefs.json"
PREFS_CODE=$(curl -sS -o "$PREFS_FILE" -w "%{http_code}" \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  "$API_BASE_URL/api/storage/apps/$APP_ID/prefs.json") || PREFS_CODE=000

# Parse prefs; fall back to English/Spanish B1 defaults.
# Output 7 tab-separated fields: lang_a, lang_b, level, topic, mode, ratings, model
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

# Read topic, mode, and optional language override from next_request if present.
next_req = prefs.get("next_request") or {}
if not isinstance(next_req, dict):
    next_req = {}
topic = (next_req.get("topic") or "").strip()
mode = (next_req.get("mode") or "free").strip()
if mode not in ("free", "classic", "daily_life", "travel"):
    mode = "free"
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

print(f"{lang_a}\t{lang_b}\t{level}\t{topic}\t{mode}\t{ratings}\t{provider}\t{model}")
PY
)
LANG_A="${PARAMS%%$'\t'*}"
REST1="${PARAMS#*$'\t'}"
LANG_B="${REST1%%$'\t'*}"
REST2="${REST1#*$'\t'}"
LEVEL="${REST2%%$'\t'*}"
REST3="${REST2#*$'\t'}"
TOPIC="${REST3%%$'\t'*}"
REST4="${REST3#*$'\t'}"
MODE="${REST4%%$'\t'*}"
REST5="${REST4#*$'\t'}"
RATINGS="${REST5%%$'\t'*}"
REST6="${REST5#*$'\t'}"
GEN_PROVIDER="${REST6%%$'\t'*}"
GEN_MODEL="${REST6#*$'\t'}"
log "Generating level=$LEVEL mode=$MODE provider=${GEN_PROVIDER:-claude} model=${GEN_MODEL:-default} story: $LANG_A / $LANG_B (recent ratings: $RATINGS)"

# 2b. Fetch recent story titles to avoid repeats.
RECENT_TITLES="(none yet)"
INDEX_EARLY_FILE="$WORK_DIR/index-early.json"
EARLY_CODE=$(curl -sS -o "$INDEX_EARLY_FILE" -w "%{http_code}" \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  "$API_BASE_URL/api/storage/apps/$APP_ID/stories/index.json") || EARLY_CODE=000
if [ "$EARLY_CODE" = "200" ]; then
  RECENT_TITLES=$(python3 -c '
import json, sys
try:
    idx = json.load(open(sys.argv[1], encoding="utf-8"))
    titles = [e.get("title_a","") for e in (idx if isinstance(idx,list) else []) if e.get("title_a")]
    print("\n".join(f"- {t}" for t in titles[:5]) or "(none yet)")
except Exception:
    print("(none yet)")
' "$INDEX_EARLY_FILE")
fi

# 3. Build the combined prompt file (system prompt + generation parameters).
PROMPT_FILE="$WORK_DIR/prompt.md"
{
  cat "$SYSTEM_FILE"
  printf '\n\n## Generation parameters\n\n'
  printf 'Base language (lang_a): %s\n' "$LANG_A"
  printf 'Target language (lang_b): %s\n' "$LANG_B"
  printf 'CEFR level: %s\n' "$LEVEL"
  printf 'Mode: %s   (one of: free | classic | daily_life | travel)\n' "$MODE"
  printf 'Topic: %s  (empty = no constraint; non-empty = use this as the story'"'"'s theme/setting)\n' "$TOPIC"
  printf 'Recent difficulty ratings from the reader (oldest first): %s\n' "$RATINGS"
  printf 'Steer within the CEFR level: ratings leaning "too hard" mean simpler sentences and more common vocabulary; "too easy" means richer structures and rarer words.\n'
  printf '\nRecent story titles to avoid repeating (titles in lang_a):\n'
  printf '%s\n' "$RECENT_TITLES"
  printf '\nGenerate a fresh story now. Output ONLY the JSON object described above.\n'
} > "$PROMPT_FILE"

# 4+5. Run the Claude CLI and extract + validate the JSON story.
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

# Provider routing mirrors app-news/fetch.sh: claude runs `claude -p` with NO
# tools (the story is pure-reasoning JSON), codex runs `codex exec --json` with
# a read-only sandbox (no disk-write, no network — closes the prompt-injection
# blast radius). Both pass --model only when one is set, so an empty model
# falls back to the CLI's own default. The model id is passed verbatim; the
# CLI is the authority on what resolves, and a rejected id degrades to the
# default-model retry below.
USER_TURN="Generate the bilingual story now. Output only the JSON object."

run_agent() {
  # $1 — model id, or empty for the chosen CLI's default (no --model flag).
  if [ "$GEN_PROVIDER" = "codex" ]; then
    if ! command -v codex >/dev/null 2>&1; then
      log "ERROR: provider=codex but codex CLI not installed"
      return 127
    fi
    local codex_flags=( exec --json --sandbox read-only )
    if [ -n "$1" ]; then
      codex_flags+=( --model "$1" )
    fi
    codex_flags+=( - )
    printf '%s\n\n---\n\n%s\n' "$(cat "$PROMPT_FILE")" "$USER_TURN" \
      | timeout "$TANDEM_TIMEOUT" codex "${codex_flags[@]}" \
      > "$RAW_OUTPUT" 2>>"$LOG_FILE"
    return $?
  fi
  # Default provider: claude.
  if ! command -v claude >/dev/null 2>&1; then
    log "ERROR: provider=claude but claude CLI not installed"
    return 127
  fi
  local flags=(
    --system-prompt-file "$PROMPT_FILE"
    --allowedTools ""
    --max-turns 3
  )
  if [ -n "$1" ]; then
    flags+=( --model "$1" )
  fi
  timeout "$TANDEM_TIMEOUT" env CLAUDE_CONFIG_DIR=/data/cli-auth/claude \
    claude -p "$USER_TURN" \
    "${flags[@]}" > "$RAW_OUTPUT" 2>>"$LOG_FILE"
}

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
  run_agent "$ATTEMPT_MODEL"
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
  curl -sS -X POST "$API_BASE_URL/api/notifications/send" \
    -H "Authorization: Bearer $SERVICE_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"title\": \"Tandem: story generation failed\",
      \"body\": \"$FAIL_BODY\",
      \"source_type\": \"app\",
      \"source_id\": \"$APP_ID\",
      \"target\": \"/shell/?app=$APP_ID\"
    }" >> "$LOG_FILE" 2>&1
  exit 1
fi

# 6. PUT stories/<id>.json to storage.
STORY_URL="$API_BASE_URL/api/storage/apps/$APP_ID/stories/$STORY_ID.json"
PUT_CODE=$(curl -sS -o /dev/null -w "%{http_code}" \
  -X PUT "$STORY_URL" \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @"$STORY_FILE") || PUT_CODE=000

if [ "$PUT_CODE" != "200" ] && [ "$PUT_CODE" != "201" ] && [ "$PUT_CODE" != "204" ]; then
  log "ERROR: failed to save story (HTTP $PUT_CODE)"
  exit 1
fi

log "Saved story $STORY_ID (level=$LEVEL)"

# 7. Update stories/index.json — fetch existing, append new entry, PUT back.
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
         ["id", "title_a", "title_b", "lang_a", "lang_b", "level", "created"]}

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

# 7b. Clear next_request from prefs so the next generation reverts to free mode.
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

# 8. Push notification.
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
